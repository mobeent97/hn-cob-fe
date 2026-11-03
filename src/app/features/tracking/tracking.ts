import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, effect, inject, signal, untracked,
  viewChild,
} from '@angular/core';
import type { FeatureCollection } from 'geojson';
import maplibregl, { GeoJSONSource, Map as MapLibreMap, MapLayerMouseEvent } from 'maplibre-gl';
import { Store } from '../../core/data/store';
import { Vehicle } from '../../core/data/models';
import { Icon } from '../../shared/ui/icon';
import { CountUp } from '@iotility/shared-ui';
import { simulateLoad } from '../../shared/ui/loading';
import { Theme } from '../../core/theme/theme';
import { LiveVehicle, StateFilter, VehicleState, clock, popupHtml, relTime, simulateStep } from './tracking-sim';
import { Select, SelectOption } from '../../shared/ui/select';
import { cssColor } from '../../shared/ui/css-color';
import { LatLng, LayerWithoutSource, createIotMap, fitLatLngs, upsertGeoJson } from '../../shared/maps/maplibre';
import { environment } from '../../../environments/environment';

const TICK_MS = 5000;
const STATES: VehicleState[] = ['Moving', 'Idle', 'Offline'];
const STATE_ORDER: Record<VehicleState, number> = { Moving: 0, Idle: 1, Offline: 2 };
/** Vehicle state colours, as FleetPoint's map legend (vehicle-legend.ts). */
const STATE_TOKEN: Record<VehicleState, string> = {
  Moving: 'var(--color-success)',
  Idle: 'var(--color-warning)',
  Offline: 'var(--color-muted)',
};
const SOURCE = 'trk-vehicles';
const DOTS = 'trk-dots';

/**
 * Live tracking — "Where is every vehicle right now, and which ones are offline?"
 * Biggest block: the map, one dot per vehicle coloured by state. The left panel filters it
 * (count cards by state, customer, search) and lists the same vehicles. Positions update
 * every 5 s from ONE interval (the legacy screen stacked a new poll on every filter change).
 * The map is MapLibre on IoTility's OpenFreeMap styles (shared/maps/maplibre.ts); the dots are a circle layer.
 */
@Component({
  selector: 'app-tracking',
  imports: [Select, SelectOption, Icon, CountUp],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './tracking.html',
  styleUrl: './tracking.css',
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
  protected readonly dotColour = STATE_TOKEN;

  // ── Map ───────────────────────────────────────────────────
  private map?: MapLibreMap;
  private popup?: maplibregl.Popup;
  private hoverTip?: maplibregl.Popup;
  private readonly mapReady = signal(false);
  private readonly theme = inject(Theme);
  /** Dot fills and the halo around each dot, resolved from the theme tokens (see readColours). */
  private colours: Record<VehicleState, string> = { Moving: '#21a179', Idle: '#e7a92d', Offline: '#6e6a85' };
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

    // Dots follow the filtered rows and the live positions.
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

    // Theme switch: re-resolve the token colours and repaint the dots and the open popup.
    // (The base map swaps style by itself, see createIotMap.)
    effect(() => {
      this.theme.version();
      if (!this.mapReady()) return;
      untracked(() => {
        this.readColours();
        this.syncMarkers(this.rows(), this.selectedId());
      });
    });

    destroyRef.onDestroy(() => {
      this.stopTicking();
      clearTimeout(this.fitTimer);
      this.ro?.disconnect();
      this.popup?.remove();
      this.hoverTip?.remove();
      this.map?.remove();
      this.map = this.popup = this.hoverTip = undefined;
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
    this.colours = {
      Moving: cssColor(STATE_TOKEN.Moving),
      Idle: cssColor(STATE_TOKEN.Idle),
      Offline: cssColor(STATE_TOKEN.Offline),
    };
    this.halo = cssColor(this.theme.mode() === 'dark' ? 'var(--color-dark-surface)' : '#fff');
  }

  private initMap() {
    this.readColours();
    const map = createIotMap(this.mapEl().nativeElement, [25.1, 53.4], 6.5);
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    this.popup = new maplibregl.Popup({ closeButton: true, closeOnClick: true, offset: 12, maxWidth: '280px', className: 'trk-popup' });
    this.hoverTip = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 10, className: 'trk-tip' });
    this.map = map;

    // A light/dark switch swaps the style and drops our source and layers: add them back each time.
    map.on('style.load', () => {
      this.addVehicleLayers();
      if (!this.mapReady()) {
        this.mapReady.set(true);
        // First paint: show every vehicle.
        this.fit(false);
      }
    });

    // The background didn't load (offline, blocked tiles): say so; the dots still draw once a style is up.
    let loaded = false;
    let errors = 0;
    map.on('load', () => {
      loaded = true;
      if (this.tilesFailed()) this.tilesFailed.set(false);
    });
    map.on('error', () => {
      if (!loaded && ++errors >= 2) this.tilesFailed.set(true);
    });

    map.on('click', DOTS, (e: MapLayerMouseEvent) => {
      const id = e.features?.[0]?.properties?.['id'];
      if (typeof id === 'string') this.select(id, 'map');
    });
    map.on('mousemove', DOTS, (e: MapLayerMouseEvent) => {
      const feature = e.features?.[0];
      if (!feature || feature.geometry.type !== 'Point') return;
      map.getCanvas().style.cursor = 'pointer';
      this.hoverTip
        ?.setLngLat(feature.geometry.coordinates as [number, number])
        .setText(String(feature.properties?.['plate'] ?? ''))
        .addTo(map);
    });
    map.on('mouseleave', DOTS, () => {
      map.getCanvas().style.cursor = '';
      this.hoverTip?.remove();
    });

    // Until the user takes over the map, keep every vehicle in frame as the layout settles.
    map.on('dragstart', () => (this.autoFit = false));
    this.ro = new ResizeObserver(() => {
      map.resize();
      if (this.autoFit && this.mapReady()) this.fit(false);
    });
    this.ro.observe(this.mapEl().nativeElement);
  }

  protected retryTiles() {
    this.tilesFailed.set(false);
    const style = this.theme.mode() === 'dark' ? environment.mapDarkStyleUrl : environment.mapLightStyleUrl;
    this.map?.setStyle(style, { diff: false });
  }

  /** One circle per vehicle, plus a ring round the selected one, drawn from a GeoJSON source. */
  private addVehicleLayers() {
    if (!this.map) return;
    const layers: LayerWithoutSource[] = [
      {
        id: 'trk-selected-ring',
        type: 'circle',
        filter: ['==', ['get', 'selected'], true],
        paint: {
          'circle-radius': 13,
          'circle-color': 'rgba(0,0,0,0)',
          'circle-stroke-width': 2,
          'circle-stroke-color': ['get', 'color'],
        },
      },
      {
        id: DOTS,
        type: 'circle',
        paint: {
          'circle-radius': ['case', ['get', 'selected'], 8, 5.5],
          'circle-color': ['get', 'color'],
          'circle-stroke-color': ['get', 'halo'],
          'circle-stroke-width': ['case', ['get', 'selected'], 2, 1.5],
        },
      },
    ];
    upsertGeoJson(this.map, SOURCE, this.collection(untracked(this.rows), untracked(this.selectedId)), layers);
  }

  private collection(rows: LiveVehicle[], sel: string | null): FeatureCollection {
    // The selected vehicle last, so its dot draws on top.
    const ordered = sel ? [...rows.filter((v) => v.deviceId !== sel), ...rows.filter((v) => v.deviceId === sel)] : rows;
    return {
      type: 'FeatureCollection',
      features: ordered.map((v) => ({
        type: 'Feature',
        properties: { id: v.deviceId, plate: v.plate, selected: v.deviceId === sel, color: this.colours[v.state], halo: this.halo },
        geometry: { type: 'Point', coordinates: [v.lng, v.lat] },
      })),
    };
  }

  private syncMarkers(rows: LiveVehicle[], sel: string | null) {
    const source = this.map?.getSource(SOURCE) as GeoJSONSource | undefined;
    if (!this.map || !source) return;
    source.setData(this.collection(rows, sel));

    const s = sel ? rows.find((v) => v.deviceId === sel) : undefined;
    if (s && this.popup?.isOpen()) this.popup.setLngLat([s.lng, s.lat]).setHTML(this.popupFor(s));
    else if (!s && sel) this.popup?.remove();
  }

  private popupFor(v: LiveVehicle) {
    return popupHtml(v, this.company(v.customerId), relTime(v.updatedAt, this.now()), this.colours[v.state]);
  }

  private fit(animate = !this.reduced) {
    if (!this.map) return;
    const rows = untracked(this.rows);
    if (!rows.length) return;
    // On a phone the bottom sheet covers the lower part of the map.
    const bottom = this.phone.matches ? this.panelEl().nativeElement.offsetHeight + 24 : 40;
    const points = rows.map((v) => [v.lat, v.lng] as LatLng);
    fitLatLngs(this.map, points, { top: 40, left: 40, right: 40, bottom }, 14, animate ? 700 : 0);
  }

  // ── Selection ─────────────────────────────────────────────
  protected select(id: string, from: 'list' | 'map') {
    const v = this.vehicles().find((x) => x.deviceId === id);
    if (!v || !this.map || !this.popup) return;
    this.selectedId.set(id);
    this.autoFit = false;
    const at: [number, number] = [v.lng, v.lat];
    if (from === 'list') {
      const zoom = Math.max(this.map.getZoom(), 14);
      if (this.reduced) this.map.jumpTo({ center: at, zoom });
      else this.map.flyTo({ center: at, zoom, duration: 600 });
    } else {
      // Bring the row into view (after the selection class lands).
      setTimeout(() =>
        this.listEl()
          ?.nativeElement.querySelector(`[data-id="${CSS.escape(id)}"]`)
          ?.scrollIntoView({ block: 'nearest', behavior: this.reduced ? 'auto' : 'smooth' }),
      );
    }
    this.popup.setLngLat(at).setHTML(this.popupFor(v)).addTo(this.map);
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
