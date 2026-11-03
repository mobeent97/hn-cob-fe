import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, effect, inject, signal,
  viewChild,
} from '@angular/core';
import type { FeatureCollection } from 'geojson';
import type { Map as MapLibreMap, StyleSpecification } from 'maplibre-gl';
import { Store } from '../../core/data/store';
import { cssColor } from '../../shared/ui/css-color';
import { environment } from '../../../environments/environment';

/** City centres for the customer zones in the sample data (lat, lng). */
const CITIES: Record<string, [number, number]> = {
  Dubai: [25.2, 55.27], 'Abu Dhabi': [24.45, 54.38], Sharjah: [25.34, 55.42], Ajman: [25.4, 55.48],
  Doha: [25.29, 51.53], 'Al Rayyan': [25.29, 51.42], Lusail: [25.42, 51.49], 'Al Wakrah': [25.17, 51.6],
  Karachi: [24.86, 67.0], Lahore: [31.55, 74.34], Islamabad: [33.68, 73.05], Manama: [26.23, 50.59],
  Muharraq: [26.26, 50.62], Lagos: [6.52, 3.38], Abuja: [9.06, 7.5], London: [51.51, -0.13],
  Manchester: [53.48, -2.24], Beirut: [33.89, 35.5],
};

/** The Gulf: where the globe starts facing (lat, lng). */
const START: [number, number] = [24, 53];
/** One turn every ~105 s. */
const SPIN_DEG_PER_S = 360 / 105;
/** After the user turns the globe, it rests this long before spinning again. */
const RESUME_AFTER_MS = 3000;
/** Share of the stage the globe's visible disc fills. */
const FILL = 0.96;
/** MapLibre's default vertical field of view, in degrees. */
const FOV = 36.87;
const SOURCE = 'globe-points';
/** Cities closer than this share one marker, so neighbours (Dubai, Sharjah, Ajman…) don't stack into a knot. */
const MERGE_KM = 150;

/**
 * The sign-in screen's one live thing: a map on a globe (MapLibre's globe projection on the OpenFreeMap vector
 * tiles) drawn deliberately quiet — land and sea in the brand's dark tones and thin country borders, no labels —
 * with a dot at every tracked vehicle and a soft marker on each customer city. It turns slowly; drag it or use
 * the arrow keys to look around.
 * MapLibre loads only on wide screens (the brand panel is hidden below 1024px), the spin runs only while the
 * globe is on screen and the tab is visible, and reduced motion keeps it still.
 */
@Component({
  selector: 'app-globe',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="stage" [class.fallback]="fallback()" [class.ready]="ready()">
      @if (!fallback()) {
        <div class="map" #map></div>
      }
    </div>
    <p class="caption num">{{ caption() }}</p>
  `,
  styleUrl: './globe.css',
})
export class Globe {
  private readonly store = inject(Store);
  private readonly mapEl = viewChild<ElementRef<HTMLDivElement>>('map');
  protected readonly fallback = signal(false);
  protected readonly ready = signal(false);

  private readonly reporting = computed(() => this.store.vehicles().filter((v) => v.state !== 'Offline'));
  protected readonly caption = computed(() => {
    const zones = new Set(this.reporting().map((v) => this.store.customer(v.customerId)?.zone).filter(Boolean));
    const n = this.reporting().length;
    const m = zones.size;
    return `${n} ${n === 1 ? 'vehicle' : 'vehicles'} reporting now across ${m} ${m === 1 ? 'city' : 'cities'}`;
  });

  private map?: MapLibreMap;
  private raf = 0;
  private running = false;
  private destroyed = false;
  private inView = false;
  private reduced = false;
  private pausedUntil = 0;
  private lastFrame = 0;
  private teardown: (() => void)[] = [];

  constructor() {
    inject(DestroyRef).onDestroy(() => this.dispose());

    // The canvas carries the description screen readers hear.
    effect(() => {
      const label = `Globe showing ${this.caption()}. Drag or use the arrow keys to turn it.`;
      this.map?.getCanvas().setAttribute('aria-label', label);
    });

    afterNextRender(() => {
      const wide = matchMedia('(min-width: 1024px)');
      const motion = matchMedia('(prefers-reduced-motion: reduce)');
      this.reduced = motion.matches;
      const onMotion = () => {
        this.reduced = motion.matches;
        this.kick();
      };
      motion.addEventListener('change', onMotion);
      this.teardown.push(() => motion.removeEventListener('change', onMotion));
      // Don't download MapLibre for a panel the phone never shows.
      if (wide.matches) void this.init();
      else {
        const onWide = () => {
          if (!wide.matches || this.map) return;
          wide.removeEventListener('change', onWide);
          void this.init();
        };
        wide.addEventListener('change', onWide);
        this.teardown.push(() => wide.removeEventListener('change', onWide));
      }
    });
  }

  private async init() {
    const container = this.mapEl()?.nativeElement;
    if (!container) return;
    let maps: typeof import('../../shared/maps/maplibre');
    try {
      maps = await import('../../shared/maps/maplibre');
    } catch {
      this.fallback.set(true);
      return;
    }
    if (this.destroyed) return;

    let map: MapLibreMap;
    try {
      const zoom = this.fitZoom(container, START[0]);
      map = maps.createIotMap(
        container,
        START,
        zoom,
        {
          style: this.styleSpec(),
          minZoom: zoom - 1,
          maxZoom: zoom + 1,
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
          touchZoomRotate: false,
          scrollZoom: false,
          boxZoom: false,
          doubleClickZoom: false,
          keyboard: true,
        },
        // No map credit: the portal is internal-only. If this screen is ever public, OpenStreetMap's licence
        // needs it back ("OpenFreeMap © OpenMapTiles Data from OpenStreetMap", linked).
        { theme: 'dark', attribution: false },
      );
    } catch {
      // No WebGL: the plain disc stands in.
      this.fallback.set(true);
      return;
    }
    this.map = map;
    map.getCanvas().setAttribute('aria-label', `Globe showing ${this.caption()}. Drag or use the arrow keys to turn it.`);

    map.on('style.load', () => {
      maps.upsertGeoJson(map, SOURCE, this.points(), [
        {
          id: 'globe-cities',
          type: 'circle',
          filter: ['==', ['get', 'kind'], 'city'],
          paint: {
            'circle-radius': ['get', 'r'],
            'circle-color': cssColor('var(--color-brand-400)'),
            'circle-opacity': 0.22,
            'circle-stroke-width': 1,
            'circle-stroke-color': cssColor('var(--color-brand-300)'),
            'circle-stroke-opacity': 0.6,
          },
        },
        {
          id: 'globe-vehicles',
          type: 'circle',
          filter: ['!=', ['get', 'kind'], 'city'],
          paint: {
            'circle-radius': 2.5,
            'circle-color': ['get', 'color'],
            'circle-stroke-width': 0.5,
            'circle-stroke-color': cssColor('var(--color-dark-surface)'),
          },
        },
      ]);
    });
    map.once('load', () => this.ready.set(true));

    // Turning the globe pauses the spin for a moment.
    const pause = () => (this.pausedUntil = performance.now() + RESUME_AFTER_MS);
    for (const type of ['pointerdown', 'keydown', 'touchstart'] as const) {
      container.addEventListener(type, pause, { passive: true });
      this.teardown.push(() => container.removeEventListener(type, pause));
    }

    // The globe always fills the stage: the zoom follows the stage's size. (Turning it north or south keeps its
    // size by itself: MapLibre adjusts the zoom for latitude while panning.)
    const ro = new ResizeObserver(() => {
      map.resize();
      const zoom = this.fitZoom(container, map.getCenter().lat);
      map.setMinZoom(null);
      map.setMaxZoom(null);
      map.setZoom(zoom);
      map.setMinZoom(zoom - 1);
      map.setMaxZoom(zoom + 1);
    });
    ro.observe(container);
    const io = new IntersectionObserver(([entry]) => {
      this.inView = entry.isIntersecting;
      this.kick();
    });
    io.observe(container);
    const onVisibility = () => this.kick();
    document.addEventListener('visibilitychange', onVisibility);
    this.teardown.push(() => {
      ro.disconnect();
      io.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    });
  }

  /**
   * The planet itself: sea, land and country borders from the vector tiles, in the brand's dark tones (the panel
   * is always dark). No labels, roads or places, and no atmosphere: globe.css draws a brand glow at the rim.
   */
  private styleSpec(): StyleSpecification {
    return {
      version: 8,
      projection: { type: 'globe' },
      sources: { openmaptiles: { type: 'vector', url: environment.mapVectorTilesUrl } },
      sky: { 'atmosphere-blend': 0 },
      layers: [
        {
          id: 'globe-land',
          type: 'background',
          paint: { 'background-color': cssColor('color-mix(in srgb, var(--color-brand-500) 30%, var(--color-dark-surface))') },
        },
        {
          id: 'globe-sea',
          type: 'fill',
          source: 'openmaptiles',
          'source-layer': 'water',
          filter: ['all', ['match', ['geometry-type'], ['MultiPolygon', 'Polygon'], true, false], ['!=', ['get', 'brunnel'], 'tunnel']],
          paint: { 'fill-color': cssColor('color-mix(in srgb, var(--color-brand-950) 60%, var(--color-dark-canvas))') },
        },
        {
          id: 'globe-borders',
          type: 'line',
          source: 'openmaptiles',
          'source-layer': 'boundary',
          filter: ['all', ['==', ['get', 'admin_level'], 2], ['!', ['has', 'claimed_by']], ['!=', ['get', 'maritime'], 1]],
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': cssColor('var(--color-brand-200)'),
            'line-opacity': 0.35,
            'line-width': 0.6,
          },
        },
      ],
    };
  }

  /** One marker per metro area (cities within MERGE_KM merged), sized by its customers, then every vehicle. */
  private points(): FeatureCollection {
    const live = cssColor('var(--color-brand-300)');
    const offline = cssColor('color-mix(in srgb, var(--color-white) 35%, var(--color-dark-surface))');
    const perCity = new Map<string, number>();
    for (const c of this.store.customers()) if (CITIES[c.zone]) perCity.set(c.zone, (perCity.get(c.zone) ?? 0) + 1);
    return {
      type: 'FeatureCollection',
      features: [
        ...metros(perCity).map(({ lat, lng, n }) => ({
          type: 'Feature' as const,
          properties: { kind: 'city', r: Math.min(12, 4 + Math.sqrt(n) * 1.8) },
          geometry: { type: 'Point' as const, coordinates: [lng, lat] },
        })),
        ...this.store.vehicles().map((v) => ({
          type: 'Feature' as const,
          properties: { kind: v.state === 'Offline' ? 'offline' : 'live', color: v.state === 'Offline' ? offline : live },
          geometry: { type: 'Point' as const, coordinates: [v.lng, v.lat] },
        })),
      ],
    };
  }

  /**
   * The zoom at which the globe's visible disc is FILL of the stage. MapLibre views the globe in perspective from
   * a camera `d` px in front of the map centre (d = height / 2 / tan(fov / 2)), so the disc's edge is where the
   * line of sight grazes the sphere: on-screen radius r = d · tan θ with sin θ = R / (d + R). Solving for the
   * sphere radius R, then R = worldSize / (2π · cos lat) (MapLibre scales the globe with the centre's latitude)
   * and worldSize = 512 · 2^zoom.
   */
  private fitZoom(container: HTMLElement, lat: number) {
    const size = Math.max(160, container.clientWidth);
    const d = size / 2 / Math.tan(((FOV / 2) * Math.PI) / 180);
    const tanTheta = (size * FILL) / 2 / d;
    const sinTheta = tanTheta / Math.sqrt(1 + tanTheta * tanTheta);
    const radius = (sinTheta * d) / (1 - sinTheta);
    return Math.log2((radius * 2 * Math.PI * Math.cos((lat * Math.PI) / 180)) / 512);
  }

  private get visible() {
    return this.inView && document.visibilityState === 'visible';
  }

  /** Start the spin if it should run; it stops itself when hidden, and never runs under reduced motion. */
  private kick() {
    if (!this.map || this.running || !this.visible || this.reduced) return;
    this.running = true;
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private readonly frame = (now: number) => {
    const map = this.map;
    const dt = Math.min(64, now - this.lastFrame) / 1000;
    this.lastFrame = now;
    if (map && now > this.pausedUntil && !map.isMoving()) {
      const center = map.getCenter();
      map.jumpTo({ center: [center.lng + SPIN_DEG_PER_S * dt, center.lat] });
    }
    if (map && this.visible && !this.reduced && !this.destroyed) this.raf = requestAnimationFrame(this.frame);
    else this.running = false;
  };

  private dispose() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.running = false;
    for (const t of this.teardown) t();
    this.teardown = [];
    this.map?.remove();
    this.map = undefined;
  }
}

/**
 * Greedy merge of customer cities into metro areas: biggest city first, each later city joins the first metro
 * within MERGE_KM of it. A metro sits at its customer-weighted centre and counts all their customers.
 */
function metros(perCity: Map<string, number>): { lat: number; lng: number; n: number }[] {
  const out: { lat: number; lng: number; n: number }[] = [];
  for (const [zone, n] of [...perCity].sort((a, b) => b[1] - a[1])) {
    const [lat, lng] = CITIES[zone];
    const metro = out.find((m) => km(m.lat, m.lng, lat, lng) < MERGE_KM);
    if (!metro) {
      out.push({ lat, lng, n });
      continue;
    }
    metro.lat = (metro.lat * metro.n + lat * n) / (metro.n + n);
    metro.lng = (metro.lng * metro.n + lng * n) / (metro.n + n);
    metro.n += n;
  }
  return out;
}

/** Great-circle distance in km (haversine). */
function km(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lng2 - lng1) * rad) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}
