import { toRgb } from '@iotility/shared-ui';

let probe: HTMLSpanElement | null = null;

/**
 * Resolves any CSS colour, token references and color-mix() included, to rgb() for canvas and WebGL renderers
 * (ECharts, MapLibre), which can't read custom properties or oklch. Resolve again after a light/dark switch.
 */
export function cssColor(value: string): string {
  if (typeof document === 'undefined') return value;
  if (!probe) {
    probe = document.createElement('span');
    probe.style.display = 'none';
    document.body.appendChild(probe);
  }
  probe.style.color = '';
  probe.style.color = value;
  return toRgb(getComputedStyle(probe).color);
}
