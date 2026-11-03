import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, ViewEncapsulation, afterNextRender, computed, effect,
  inject, signal, untracked, viewChild,
} from '@angular/core';
import * as L from 'leaflet';
import { Store } from '../../core/data/store';
import { Vehicle } from '../../core/data/models';
import { Icon } from '../../shared/ui/icon';
import { CountUp } from '@iotility/shared-ui';
import { simulateLoad } from '../../shared/ui/loading';
import { Theme } from '../../core/theme/theme';
import { LiveVehicle, StateFilter, VehicleState, clock, popupHtml, relTime, simulateStep } from './tracking-sim';
import { Select, SelectOption } from '../../shared/ui/select';

const TICK_MS = 5000;
const STATES: VehicleState[] = ['Moving', 'Idle', 'Offline'];
const STATE_ORDER: Record<VehicleState, number> = { Moving: 0, Idle: 1, Offline: 2 };

/**
 * Live tracking — "Where is every vehicle right now, and which ones are offline?"
 * Biggest block: the map, one dot per vehicle coloured by state. The left panel filters it
 * (count cards by state, customer, search) and lists the same vehicles. Positions update
 * every 5 s from ONE interval (the legacy screen stacked a new poll on every filter change).
 */
@Component({
  selector: 'app-tracking',
  imports: [Select, SelectOption, Icon, CountUp],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  templateUrl: './tracking.html',
  styleUrl: './tracking.scss',
})
export class Tracking {
  protected readonly store = inject(Store);
  protected readonly loading = simulateLoad('tracking');
  private readonly mapEl = viewChild.required<ElementRef<HTMLDivElement>>('map');
  private readonly panelEl = viewChild.required<ElementRef<HTMLElement>>('panel');
  private readonly listEl = viewChild<ElementRef<HTMLElement>>('list');

  protected readonly states = STATES;
  /** The simulated clock: starts at the sample data's "now" and advances one tick at a time. */
  protected readonly now = signal(this.store.today.getTime());
  protected readonly vehicles = signal<LiveVehicle[]>(this.seed(this.store.vehicles()));

  protected readonly state = signal<StateFilter>('all');
  protected readonly customerId = signal<number | 'all'>('all');
  protected readonly q = signal('');
  protected readonly selectedId = signal<string | null>(null);
  protected readonly paused = signal(false);
  protected readonly listOpen = signal(false);
  protected readonly tilesFailed = signal(false);

  private readonly custName = computed(() => new Map(this.store.customers().map((c) => [c.id, c.company])));
  protected company(id: number) {
    return this.custName().get(id) ?? '—';
  }

  /** Customers that have tracked vehicles, for the select. */
  protected readonly customerOptions = computed(() => {
    const n = new Map<number, number>();
    for (const v of this.vehicles()) n.set(v.customerId, (n.get(v.customerId) ?? 0) + 1);
    return [...n.entries()]
      .map(([id, count]) => ({ id, count, name: this.company(id) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  /** After customer and search, before the state filter: the count cards count this. */
  private readonly searched = computed(() => {
    const q = this.q().trim().toLowerCase();
    const cid = this.customerId();
    return this.vehicles().filter(
      (v) =>
        (cid === 'all' || v.customerId === cid) &&
        (!q || v.plate.toLowerCase().includes(q) || v.deviceId.toLowerCase().includes(q) || v.driver.toLowerCase().includes(q)),
    );
  });

  protected readonly counts = computed(() => {
    const c: Record<StateFilter, number> = { all: 0, Moving: 0, Idle: 0, Offline: 0 };
    for (const v of this.searched()) {
      c.all++;
      c[v.state]++;
    }
    return c;
  });

  protected readonly rows = computed(() => {
    const s = this.state();
    return this.searched()
      .filter((v) => s === 'all' || v.state === s)
      .sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.plate.localeCompare(b.plate));
  });

  protected readonly selected = computed(() => this.vehicles().find((v) => v.deviceId === this.selectedId()) ?? null);

  /** The subline's one finding: how many are dark, and for how long the longest has been. */
  protected readonly finding = computed(() => {
    const all = this.vehicles();
    const off = all.filter((v) => v.state === 'Offline');
    if (!off.length) return `All ${all.length} vehicles are reporting.`;
    const oldest = Math.max(...off.map((v) => this.now() - new Date(v.updatedAt).getTime()));
    const days = Math.floor(oldest / 86400000);
    const since = days >= 1 ? `${days} ${days === 1 ? 'day' : 'days'}` : `${Math.floor(oldest / 3600000)} h`;
    return `${off.length} of ${all.length} vehicles offline · the longest silent for ${since}`;
  });

  protected readonly stamp = computed(() => clock(this.now()));
  protected rel(iso: string) {
    return relTime(iso, this.now());
  }
  protected readonly dotColour: Record<VehicleState, string> = {
    Moving: 'var(--accent)',
    Idle: 'var(--chart-2)',
    Offline: 'var(--chart-3)',
  };

  // ── Map ───────────────────────────────────────────────────
  private map?: L.Map;
  private layer?: L.LayerGroup;
  private ring?: L.CircleMarker;
  private popup?: L.Popup;
  private readonly markers = new Map<string, L.CircleMarker>();
  private readonly mapReady = signal(false);
  private readonly theme = inject(Theme);
  /** Marker fills and the halo around each dot, read from the theme tokens (see readColours). */
  private colours: Record<VehicleState, string> = { Moving: '#0a6f96', Idle: '#a86f0c', Offline: '#8a96a0' };
  private halo = '#ffffff';
  private interval?: ReturnType<typeof setInterval>;
  private fitTimer?: ReturnType<typeof setTimeout>;
  private readonly reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private readonly phone = matchMedia('(max-width: 640px)');

  constructor() {
    const destroyRef = inject(DestroyRef);

    afterNextRender(() => {
      this.initMap();
      this.startTicking();
    });

    // Markers follow the filtered rows and the live positions.
    effect(() => {
      const rows = this.rows();
      const sel = this.selectedId();
      if (!this.mapReady()) return;
      untracked(() => this.syncMarkers(rows, sel));
    });

    // Fit to the filtered vehicles when a filter changes (not on every tick).
    effect(() => {
      this.state();
      this.customerId();
      this.q();
      if (!this.mapReady()) return;
      clearTimeout(this.fitTimer);
      this.fitTimer = setTimeout(() => this.fit(), 250);
    });

    // Theme switch: re-read the tokens and repaint markers, ring and the open popup.
    effect(() => {
      this.theme.version();
      if (!this.mapReady()) return;
      untracked(() => {
        this.readColours();
        // Hidden markers pick up the new style when they are shown again.
        this.syncMarkers(this.rows(), this.selectedId());
      });
    });

    destroyRef.onDestroy(() => {
      this.stopTicking();
      clearTimeout(this.fitTimer);
      this.ro?.disconnect();
      this.map?.remove();
      this.markers.clear();
      this.map = this.layer = this.ring = this.popup = undefined;
    });
  }

  private ro?: ResizeObserver;
  private autoFit = true;

  private seed(src: Vehicle[]): LiveVehicle[] {
    const now = this.store.today.getTime();
    return src.map((v, i) => ({
      ...v,
      heading: (i * 137.5) % 360,
      // A few sample stamps fall after "now"; pull them back into the last few minutes.
      updatedAt: new Date(Math.min(new Date(v.updatedAt).getTime(), now - ((i % 9) + 1) * 40_000)).toISOString(),
    }));
  }

  private readColours() {
    const css = getComputedStyle(document.documentElement);
    const read = (n: string, fb: string) => css.getPropertyValue(n).trim() || fb;
    this.colours = { Moving: read('--accent', '#0a6f96'), Idle: read('--chart-2', '#a86f0c'), Offline: read('--chart-3', '#8a96a0') };
    this.halo = read('--surface', '#ffffff');
  }

  private initMap() {
    this.readColours();

    const map = L.map(this.mapEl().nativeElement, {
      preferCanvas: true,
      zoomControl: false,
      attributionControl: true,
      zoomSnap: 0.5,
    }).setView([25.1, 53.4], 7);
    L.control.zoom({ position: 'topright' }).addTo(map);
    const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    let loaded = false;
    let errors = 0;
    tiles.on('tileload', () => {
      loaded = true;
      if (this.tilesFailed()) this.tilesFailed.set(false);
    });
    tiles.on('tileerror', () => {
      if (!loaded && ++errors >= 4) this.tilesFailed.set(true);
    });
    this.tiles = tiles;

    this.layer = L.layerGroup().addTo(map);
    this.ring = L.circleMarker([0, 0], { radius: 13, weight: 2, fill: false, interactive: false, color: this.colours.Moving });
    this.popup = L.popup({ closeButton: true, autoPan: true, offset: [0, -6], maxWidth: 280, className: 'trk-popup' });
    this.map = map;

    // Until the user takes over the map, keep every vehicle in frame as the layout settles.
    map.on('dragstart', () => (this.autoFit = false));
    this.ro = new ResizeObserver(() => {
      map.invalidateSize();
      if (this.autoFit) this.fit(false);
    });
    this.ro.observe(this.mapEl().nativeElement);

    this.mapReady.set(true);
    // First paint: show every vehicle.
    this.fit(false);
  }

  private tiles?: L.TileLayer;
  protected retryTiles() {
    this.tilesFailed.set(false);
    this.tiles?.redraw();
  }

  private style(v: LiveVehicle, selected: boolean): L.CircleMarkerOptions {
    return {
      radius: selected ? 8 : 5.5,
      color: this.halo,
      weight: selected ? 2 : 1.5,
      fillColor: this.colours[v.state],
      fillOpacity: 1,
      opacity: 1,
    };
  }

  private syncMarkers(rows: LiveVehicle[], sel: string | null) {
    if (!this.map || !this.layer || !this.ring) return;
    const visible = new Set<string>();
    for (const v of rows) {
      visible.add(v.deviceId);
      let m = this.markers.get(v.deviceId);
      if (!m) {
        m = L.circleMarker([v.lat, v.lng], this.style(v, false));
        const id = v.deviceId;
        m.on('click', () => this.select(id, 'map'));
        m.bindTooltip(v.plate, { direction: 'top', offset: [0, -6], className: 'trk-tip' });
        this.markers.set(id, m);
      }
      m.setLatLng([v.lat, v.lng]);
      m.setStyle(this.style(v, v.deviceId === sel));
      if (!this.layer.hasLayer(m)) this.layer.addLayer(m);
    }
    for (const [id, m] of this.markers) if (!visible.has(id) && this.layer.hasLayer(m)) this.layer.removeLayer(m);

    const s = sel ? rows.find((v) => v.deviceId === sel) : undefined;
    if (s) {
      this.ring.setLatLng([s.lat, s.lng]).setStyle({ color: this.colours[s.state] });
      if (!this.layer.hasLayer(this.ring)) this.layer.addLayer(this.ring);
      this.markers.get(s.deviceId)?.bringToFront();
      if (this.popup?.isOpen()) this.popup.setLatLng([s.lat, s.lng]).setContent(this.popupFor(s));
    } else {
      this.layer.removeLayer(this.ring);
      if (sel) this.map.closePopup();
    }
  }

  private popupFor(v: LiveVehicle) {
    return popupHtml(v, this.company(v.customerId), relTime(v.updatedAt, this.now()), this.colours[v.state]);
  }

  private fit(animate = !this.reduced) {
    if (!this.map) return;
    const rows = untracked(this.rows);
    if (!rows.length) return;
    const bounds = L.latLngBounds(rows.map((v) => [v.lat, v.lng] as L.LatLngTuple));
    // On a phone the bottom sheet covers the lower part of the map.
    const bottom = this.phone.matches ? this.panelEl().nativeElement.offsetHeight + 24 : 40;
    this.map.fitBounds(bounds, { paddingTopLeft: [40, 40], paddingBottomRight: [40, bottom], maxZoom: 14, animate });
  }

  // ── Selection ─────────────────────────────────────────────
  protected select(id: string, from: 'list' | 'map') {
    const v = this.vehicles().find((x) => x.deviceId === id);
    if (!v || !this.map || !this.popup) return;
    this.selectedId.set(id);
    this.autoFit = false;
    const at: L.LatLngTuple = [v.lat, v.lng];
    if (from === 'list') {
      const zoom = Math.max(this.map.getZoom(), 14);
      if (this.reduced) this.map.setView(at, zoom, { animate: false });
      else this.map.flyTo(at, zoom, { duration: 0.6 });
    } else {
      // Bring the row into view (after the selection class lands).
      setTimeout(() =>
        this.listEl()
          ?.nativeElement.querySelector(`[data-id="${CSS.escape(id)}"]`)
          ?.scrollIntoView({ block: 'nearest', behavior: this.reduced ? 'auto' : 'smooth' }),
      );
    }
    this.popup.setLatLng(at).setContent(this.popupFor(v)).openOn(this.map);
    if (from === 'list' && this.phone.matches) this.listOpen.set(false);
  }

  protected clearFilters() {
    this.q.set('');
    this.state.set('all');
    this.customerId.set('all');
  }

  protected setCustomer(value: string) {
    this.customerId.set(value === 'all' ? 'all' : Number(value));
  }

  // ── Live updates: one interval, owned here, cleared on destroy ──
  private startTicking() {
    this.stopTicking();
    this.interval = setInterval(() => this.tick(), TICK_MS);
  }
  private stopTicking() {
    clearInterval(this.interval);
    this.interval = undefined;
  }
  protected togglePause() {
    this.paused.update((p) => !p);
    if (this.paused()) this.stopTicking();
    else {
      this.tick();
      this.startTicking();
    }
  }

  private tick() {
    // Hidden tab: skip the work (the legacy screen kept polling in the background).
    if (document.visibilityState === 'hidden') return;
    const now = this.now() + TICK_MS;
    this.now.set(now);
    this.vehicles.update((vs) => simulateStep(vs, now, TICK_MS));
  }
}
