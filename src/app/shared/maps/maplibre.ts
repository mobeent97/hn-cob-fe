/*
 * MapLibre helpers, ported from IoTility (iotility@035c514, projects/fleetpoint/src/app/shared/maps/maplibre.ts).
 * Only the pieces the COB uses: the map factory with the OpenFreeMap light/dark styles (following the `.dark`
 * class), English labels, IoTility's fleet map palette, the compact attribution, and the GeoJSON, fit, marker,
 * popup and circle helpers. Left out: 3D buildings, the sky/atmosphere, timezone centring and location search.
 */
import type { Feature, FeatureCollection } from 'geojson';
import maplibregl, { GeoJSONSource, LngLatBounds, Map, MapOptions, PaddingOptions } from 'maplibre-gl';
import { attachTooltip } from '@iotility/shared-ui';
import { environment } from '../../../environments/environment';

export type LatLng = [number, number];

/** A style layer with its `source` omitted — `upsertGeoJson` supplies it. */
export type LayerWithoutSource<T = maplibregl.LayerSpecification> = T extends { source: unknown } ? Omit<T, 'source'> : T;

/**
 * A map on the OpenFreeMap style for the current theme. A light/dark switch swaps the style, which drops every
 * custom source and layer: re-add yours on the map's 'style.load' event (it also fires for the first style).
 * `theme: 'dark'` pins the dark style for maps that always sit on a dark surface (the sign-in globe);
 * `attribution: false` leaves out the credit button for a page that prints the credit itself.
 */
export function createIotMap(
  container: HTMLElement,
  center: LatLng,
  zoom: number,
  options: Partial<MapOptions> = {},
  { theme = 'follow', attribution = true }: { theme?: 'follow' | 'dark'; attribution?: boolean } = {},
): Map {
  const dark = () => theme === 'dark' || isDark();
  const map = new maplibregl.Map({
    container,
    center: [center[1], center[0]],
    zoom,
    pitch: 0,
    bearing: 0,
    attributionControl: false,
    canvasContextAttributes: { antialias: true },
    style: dark() ? environment.mapDarkStyleUrl : environment.mapLightStyleUrl,
    ...options,
  });
  if (attribution) map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
  const collapseAttribution = () => {
    const attribution = map
      .getContainer()
      .querySelector<HTMLDetailsElement>('.maplibregl-ctrl-attrib.maplibregl-compact');
    attribution?.classList.remove('maplibregl-compact-show');
    if (attribution) attribution.open = false;
  };
  collapseAttribution();
  map.once('load', collapseAttribution);
  replaceNativeTitles(map.getContainer());

  map.on('style.load', () => {
    applyEnglishLabels(map);
    applyFleetMapStyle(map, dark());
  });
  if (theme === 'dark') return map;

  let darkTheme = isDark();
  const themeObserver = new MutationObserver(() => {
    const nextDarkTheme = isDark();
    if (nextDarkTheme === darkTheme) return;
    darkTheme = nextDarkTheme;
    map.setStyle(nextDarkTheme ? environment.mapDarkStyleUrl : environment.mapLightStyleUrl, { diff: false });
  });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  map.once('remove', () => themeObserver.disconnect());
  return map;
}

export function upsertGeoJson(
  map: Map,
  id: string,
  data: FeatureCollection | Feature,
  layers: LayerWithoutSource[],
): void {
  for (const layer of layers) if (map.getLayer(layer.id)) map.removeLayer(layer.id);
  const source = map.getSource(id) as GeoJSONSource | undefined;
  if (source) source.setData(data);
  else map.addSource(id, { type: 'geojson', data });
  for (const layer of layers) map.addLayer({ ...layer, source: id } as maplibregl.LayerSpecification);
}

// Overlay chrome (zoom controls, legends, panels) floats above the map, usually in a corner. Framing a marker set
// edge-to-edge parks corner markers underneath it, so every fit keeps at least this inset per side.
const OVERLAY_INSET = { top: 80, right: 104, bottom: 120, left: 80 };

/** Raises scalar or per-side padding to the overlay-safe minimums. */
export function overlaySafePadding(padding: number | PaddingOptions): PaddingOptions {
  if (typeof padding === 'number') {
    return {
      top: Math.max(padding, OVERLAY_INSET.top),
      right: Math.max(padding, OVERLAY_INSET.right),
      bottom: Math.max(padding, OVERLAY_INSET.bottom),
      left: Math.max(padding, OVERLAY_INSET.left),
    };
  }
  return {
    top: Math.max(padding.top ?? 0, OVERLAY_INSET.top),
    right: Math.max(padding.right ?? 0, OVERLAY_INSET.right),
    bottom: Math.max(padding.bottom ?? 0, OVERLAY_INSET.bottom),
    left: Math.max(padding.left ?? 0, OVERLAY_INSET.left),
  };
}

/** Frames the coordinates, keeping clear of the overlay chrome. `duration: 0` jumps (reduced motion). */
export function fitLatLngs(
  map: Map,
  coordinates: LatLng[],
  padding: number | PaddingOptions = 40,
  maxZoom = 14,
  duration = 700,
): void {
  if (!coordinates.length) return;
  const bounds = new LngLatBounds();
  for (const [lat, lng] of coordinates) bounds.extend([lng, lat]);
  map.fitBounds(bounds, { padding: overlaySafePadding(padding), maxZoom, duration });
}

/** Escapes a value for popup / marker HTML strings, so markup inside the data never runs. */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function markerElement(html: string, className = 'iotility-map-marker'): HTMLElement {
  const element = document.createElement('div');
  element.className = className;
  element.innerHTML = html;
  return element;
}

export function popupHtml(html: string, options: maplibregl.PopupOptions = {}): maplibregl.Popup {
  return new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 20, ...options }).setHTML(html);
}

export function circlePolygon(center: LatLng, radiusMeters: number, steps = 64): LatLng[] {
  const [latitude, longitude] = center;
  const latitudeRadius = radiusMeters / 111_320;
  const longitudeRadius = radiusMeters / (111_320 * Math.cos((latitude * Math.PI) / 180));
  const points: LatLng[] = [];
  for (let index = 0; index <= steps; index++) {
    const angle = (index / steps) * Math.PI * 2;
    points.push([latitude + Math.sin(angle) * latitudeRadius, longitude + Math.cos(angle) * longitudeRadius]);
  }
  return points;
}

function isDark(): boolean {
  return document.documentElement.classList.contains('dark');
}

function applyEnglishLabels(map: Map): void {
  for (const layer of map.getStyle().layers ?? []) {
    if (layer.type !== 'symbol' || !layer.layout?.['text-field']) continue;
    const textField = JSON.stringify(layer.layout['text-field']);
    if (!textField.includes('name')) continue;
    map.setLayoutProperty(layer.id, 'text-field', ['coalesce', ['get', 'name:en'], ['get', 'name_en'], ['get', 'name:latin'], '']);
  }
}

/** Swaps the map's own button titles for the shared tooltip. */
function replaceNativeTitles(root: HTMLElement): void {
  root.querySelectorAll<HTMLButtonElement>('button[title]').forEach((button) => {
    const label = button.title;
    button.removeAttribute('title');
    attachTooltip(button, label, 'left');
  });
}

/*
 * IoTility's "control room" palette over the OpenFreeMap styles: near-black navy in dark mode so live markers
 * pop, crisp slate in light mode. These are map style values (MapLibre paint properties), not UI colours.
 */
function applyFleetMapStyle(map: Map, dark: boolean): void {
  const paint = (layerId: string, property: string, value: unknown) => {
    if (map.getLayer(layerId)) map.setPaintProperty(layerId, property, value);
  };
  const layout = (layerId: string, property: string, value: unknown) => {
    if (map.getLayer(layerId)) map.setLayoutProperty(layerId, property, value);
  };

  const palette = dark
    ? {
        canvas: '#0b0f19',
        residential: '#141b2e',
        water: '#0d3856',
        waterLine: '#2f8fc4',
        park: '#123a2e',
        grass: '#163f2f',
        wood: '#102e26',
        wetland: '#123531',
        sand: '#332c1f',
        hospital: '#3a2230',
        school: '#1c2740',
        building: '#1f2937',
        buildingEdge: '#2f3b52',
        boundary: '#475569',
        label: '#f1f5f9',
        mutedLabel: '#94a3b8',
        halo: 'rgba(11,15,25,0.92)',
        motorway: '#3b82f6',
        motorwayCase: '#16233a',
        primary: '#60a5fa',
        primaryCase: '#20304a',
        secondary: '#3c4a63',
        secondaryCase: '#1c2637',
        local: '#2a3548',
        localCase: '#182130',
        path: '#475569',
        rail: '#64748b',
        runway: '#2d3648',
      }
    : {
        canvas: '#f8fafc',
        residential: '#eef1f6',
        water: '#a8d8f0',
        waterLine: '#5bb8e0',
        park: '#c8ecd4',
        grass: '#dcf3e1',
        wood: '#bfe4c8',
        wetland: '#cfeee7',
        sand: '#f6edd9',
        hospital: '#fde3e9',
        school: '#e6edfb',
        building: '#e4e8ee',
        buildingEdge: '#cfd7e2',
        boundary: '#94a3b8',
        label: '#1e293b',
        mutedLabel: '#64748b',
        halo: 'rgba(255,255,255,0.94)',
        motorway: '#2563eb',
        motorwayCase: '#c3d7f0',
        primary: '#3b82f6',
        primaryCase: '#d6e4f7',
        secondary: '#dbe8fa',
        secondaryCase: '#c7d8ee',
        local: '#ffffff',
        localCase: '#dde4ec',
        path: '#c2cad4',
        rail: '#94a3b8',
        runway: '#d8dee7',
      };

  paint('background', 'background-color', palette.canvas);
  paint('landuse_residential', 'fill-color', palette.residential);
  paint('water', 'fill-color', palette.water);
  for (const id of ['waterway_river', 'waterway_other', 'waterway_tunnel']) paint(id, 'line-color', palette.waterLine);
  paint('park', 'fill-color', palette.park);
  paint('park_outline', 'line-color', dark ? '#2b5b49' : '#a9d7b6');
  paint('landcover_grass', 'fill-color', palette.grass);
  paint('landcover_wood', 'fill-color', palette.wood);
  paint('landcover_wetland', 'fill-color', palette.wetland);
  paint('landcover_sand', 'fill-color', palette.sand);
  paint('landuse_hospital', 'fill-color', palette.hospital);
  paint('landuse_school', 'fill-color', palette.school);
  paint('building', 'fill-color', palette.building);
  paint('building', 'fill-outline-color', palette.buildingEdge);
  paint('aeroway_fill', 'fill-color', palette.runway);
  paint('aeroway_runway', 'line-color', palette.runway);
  paint('aeroway_taxiway', 'line-color', palette.runway);
  for (const id of ['boundary_2', 'boundary_3', 'boundary_disputed']) {
    paint(id, 'line-color', palette.boundary);
    paint(id, 'line-dasharray', [3, 2]);
  }

  const roadKinds: Array<[string, string, string, unknown, unknown]> = [
    [
      'motorway',
      palette.motorway,
      palette.motorwayCase,
      ['interpolate', ['linear'], ['zoom'], 6.5, 0.45, 9, 1.3, 12, 3.2, 14, 6, 18, 18],
      ['interpolate', ['linear'], ['zoom'], 6.5, 0.9, 9, 2, 12, 4.5, 14, 8, 18, 21],
    ],
    [
      'motorway_link',
      palette.motorway,
      palette.motorwayCase,
      ['interpolate', ['linear'], ['zoom'], 9, 1, 14, 4, 18, 11],
      ['interpolate', ['linear'], ['zoom'], 9, 2, 14, 6, 18, 14],
    ],
    [
      'trunk_primary',
      palette.primary,
      palette.primaryCase,
      ['interpolate', ['linear'], ['zoom'], 8, 0.5, 11, 1.8, 14, 5, 18, 15],
      ['interpolate', ['linear'], ['zoom'], 8, 1, 11, 3, 14, 7, 18, 18],
    ],
    [
      'secondary_tertiary',
      palette.secondary,
      palette.secondaryCase,
      ['interpolate', ['linear'], ['zoom'], 9, 0.7, 12, 1.8, 15, 4, 18, 11],
      ['interpolate', ['linear'], ['zoom'], 9, 1.4, 12, 3, 15, 6, 18, 14],
    ],
    [
      'minor',
      palette.local,
      palette.localCase,
      ['interpolate', ['linear'], ['zoom'], 12, 0.6, 15, 2.2, 18, 7],
      ['interpolate', ['linear'], ['zoom'], 12, 1.2, 15, 3.4, 18, 9],
    ],
    [
      'street',
      palette.local,
      palette.localCase,
      ['interpolate', ['linear'], ['zoom'], 12, 0.7, 15, 2.4, 18, 7.5],
      ['interpolate', ['linear'], ['zoom'], 12, 1.3, 15, 3.6, 18, 9.5],
    ],
    [
      'service_track',
      palette.local,
      palette.localCase,
      ['interpolate', ['linear'], ['zoom'], 13, 0.5, 16, 1.6, 19, 5],
      ['interpolate', ['linear'], ['zoom'], 13, 1, 16, 2.5, 19, 6.5],
    ],
    [
      'link',
      palette.primary,
      palette.primaryCase,
      ['interpolate', ['linear'], ['zoom'], 10, 0.8, 14, 3.5, 18, 10],
      ['interpolate', ['linear'], ['zoom'], 10, 1.6, 14, 5.5, 18, 13],
    ],
  ];
  for (const prefix of ['road', 'bridge', 'tunnel']) {
    for (const [kind, roadColor, casingColor, width, casingWidth] of roadKinds) {
      paint(`${prefix}_${kind}`, 'line-color', roadColor);
      paint(`${prefix}_${kind}`, 'line-width', width);
      layout(`${prefix}_${kind}`, 'line-cap', 'round');
      layout(`${prefix}_${kind}`, 'line-join', 'round');
      paint(`${prefix}_${kind}_casing`, 'line-color', casingColor);
      paint(`${prefix}_${kind}_casing`, 'line-width', casingWidth);
      layout(`${prefix}_${kind}_casing`, 'line-cap', 'round');
      layout(`${prefix}_${kind}_casing`, 'line-join', 'round');
    }
    paint(`${prefix}_motorway`, 'line-blur', 0.3);
  }

  const roadMinZooms: Array<[string, number]> = [
    ['motorway', 6.5],
    ['motorway_link', 9],
    ['trunk_primary', 8],
    ['secondary_tertiary', 10],
    ['link', 10],
    ['minor', 11.5],
    ['street', 12],
    ['service_track', 13.5],
    ['path_pedestrian', 14],
  ];
  for (const prefix of ['road', 'bridge', 'tunnel']) {
    for (const [kind, minZoom] of roadMinZooms) {
      for (const suffix of ['', '_casing']) {
        const id = `${prefix}_${kind}${suffix}`;
        if (map.getLayer(id)) map.setLayerZoomRange(id, minZoom, 24);
      }
    }
    paint(`${prefix}_path_pedestrian`, 'line-color', palette.path);
    paint(`${prefix}_major_rail`, 'line-color', palette.rail);
    paint(`${prefix}_transit_rail`, 'line-color', palette.rail);
  }

  for (const layer of map.getStyle().layers ?? []) {
    if (layer.type !== 'symbol' || !layer.layout?.['text-field']) continue;
    paint(layer.id, 'text-halo-color', palette.halo);
    paint(layer.id, 'text-halo-width', layer.id.startsWith('label_') ? 1.8 : 1.4);
    paint(layer.id, 'text-halo-blur', 0.4);
    if (layer.id.startsWith('label_')) paint(layer.id, 'text-color', palette.label);
    if (layer.id.startsWith('highway-name')) paint(layer.id, 'text-color', palette.mutedLabel);
  }

  for (const [id, minZoom] of [
    ['poi_r1', 7.5],
    ['poi_r7', 8.5],
    ['poi_r20', 9.5],
    ['poi_transit', 7.5],
  ] as const) {
    if (!map.getLayer(id)) continue;
    map.setLayerZoomRange(id, minZoom, 24);
    paint(id, 'text-color', palette.label);
    layout(id, 'text-size', ['interpolate', ['linear'], ['zoom'], 8, 9, 13, 10, 17, 12]);
    layout(id, 'icon-optional', true);
  }

  for (const [id, minZoom] of [
    ['label_city_capital', 3],
    ['label_city', 4],
    ['label_town', 6],
    ['label_village', 8],
    ['label_other', 8.5],
    ['highway-name-major', 8],
    ['highway-name-minor', 11],
  ] as const) {
    if (map.getLayer(id)) map.setLayerZoomRange(id, minZoom, 24);
  }
}
