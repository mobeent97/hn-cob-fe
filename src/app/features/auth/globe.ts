import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, effect, inject, signal, untracked,
  viewChild,
} from '@angular/core';
import type * as ThreeNS from 'three';
import { Store } from '../../core/data/store';
import { Theme } from '../../core/theme/theme';

type Three = typeof ThreeNS;
type Rgb = [number, number, number];
/** Which token colours a dot: the grey land, a live device / city, or an offline device. */
type Tone = 0 | 1 | 2;

/** The globe's colours, read from the theme tokens. */
function palette() {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fb: string) => hex(css.getPropertyValue(name), fb);
  return {
    tones: [v('--chart-3', '#8a96a0'), v('--accent', '#0a6f96'), v('--chart-4', '#c9d1d7')] as Rgb[],
    surface: v('--surface', '#ffffff'),
  };
}

/** City centres for the customer zones in the sample data (lat, lng). */
const CITIES: Record<string, [number, number]> = {
  Dubai: [25.2, 55.27], 'Abu Dhabi': [24.45, 54.38], Sharjah: [25.34, 55.42], Ajman: [25.4, 55.48],
  Doha: [25.29, 51.53], 'Al Rayyan': [25.29, 51.42], Lusail: [25.42, 51.49], 'Al Wakrah': [25.17, 51.6],
  Karachi: [24.86, 67.0], Lahore: [31.55, 74.34], Islamabad: [33.68, 73.05], Manama: [26.23, 50.59],
  Muharraq: [26.26, 50.62], Lagos: [6.52, 3.38], Abuja: [9.06, 7.5], London: [51.51, -0.13],
  Manchester: [53.48, -2.24], Beirut: [33.89, 35.5],
};

/** The Gulf: where the globe starts facing. */
const START: [number, number] = [24, 53];
const DOTS = 2600;
const DEG = Math.PI / 180;

const VERT = /* glsl */ `
  attribute float aSize;
  attribute vec3 aColor;
  uniform float uDpr;
  varying vec3 vColor;
  varying float vFace;
  void main() {
    vec3 n = normalize(normalMatrix * position);
    vFace = smoothstep(0.0, 0.5, n.z);
    vColor = aColor;
    gl_PointSize = aSize * uDpr;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
// Flat round dots. Near the limb a dot fades into the sheet colour instead of glowing.
const FRAG = /* glsl */ `
  uniform vec3 uBg;
  varying vec3 vColor;
  varying float vFace;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float a = 1.0 - smoothstep(0.4, 0.5, d);
    gl_FragColor = vec4(mix(uBg, vColor, vFace), a);
  }
`;

const hex = (css: string, fallback: string): [number, number, number] => {
  const m = /^#?([0-9a-f]{6})$/i.exec(css.trim()) ?? /^#?([0-9a-f]{6})$/i.exec(fallback)!;
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

const toXYZ = (lat: number, lng: number, r: number): [number, number, number] => [
  r * Math.cos(lat * DEG) * Math.sin(lng * DEG),
  r * Math.sin(lat * DEG),
  r * Math.cos(lat * DEG) * Math.cos(lng * DEG),
];

/**
 * The login screen's one live thing: a flat dotted globe with a dot at every tracked device.
 * three.js loads only on wide screens (the panel is hidden below 900px), renders only while
 * the canvas is on screen and the tab is visible, and frees every GPU resource on destroy.
 */
@Component({
  selector: 'app-globe',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="stage" #stage [class.fallback]="fallback()">
      @if (!fallback()) {
        <canvas
          #canvas
          tabindex="0"
          role="img"
          [attr.aria-label]="'Globe showing ' + caption() + '. Drag or use the arrow keys to turn it.'"
          (pointerdown)="down($event)"
          (pointermove)="move($event)"
          (pointerup)="up($event)"
          (pointercancel)="up($event)"
          (keydown)="key($event)"
        ></canvas>
      }
    </div>
    <p class="caption num">{{ caption() }}</p>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 20px;
      width: 100%;
    }
    .stage {
      width: min(560px, 100%, calc(100dvh - 200px));
      aspect-ratio: 1;
      position: relative;
    }
    .stage.fallback {
      border-radius: 50%;
      background: var(--surface);
      border: 1px solid var(--border);
    }
    canvas {
      display: block;
      width: 100%;
      height: 100%;
      cursor: grab;
      touch-action: none;
      border-radius: 50%;
    }
    canvas:active {
      cursor: grabbing;
    }
    .caption {
      color: var(--muted);
      text-align: center;
    }
  `,
})
export class Globe {
  private readonly store = inject(Store);
  private readonly stage = viewChild.required<ElementRef<HTMLDivElement>>('stage');
  protected readonly fallback = signal(false);

  private readonly reporting = computed(() => this.store.vehicles().filter((v) => v.state !== 'Offline'));
  protected readonly caption = computed(() => {
    const zones = new Set(this.reporting().map((v) => this.store.customer(v.customerId)?.zone).filter(Boolean));
    const n = this.reporting().length;
    const m = zones.size;
    return `${n} ${n === 1 ? 'vehicle' : 'vehicles'} reporting now across ${m} ${m === 1 ? 'city' : 'cities'}`;
  });

  // Scene state (outside Angular's change detection: nothing here touches the template).
  private three?: Three;
  private renderer?: ThreeNS.WebGLRenderer;
  private scene?: ThreeNS.Scene;
  private camera?: ThreeNS.PerspectiveCamera;
  private tilt?: ThreeNS.Group;
  private spin?: ThreeNS.Group;
  private disposables: { dispose(): void }[] = [];
  private raf = 0;
  private running = false;
  private destroyed = false;
  private inView = false;
  private reduced = false;
  private rotY = 0;
  private rotX = 0;
  private velY = 0;
  private velX = 0;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private lastMoveAt = 0;
  private lastFrame = 0;
  private teardown: (() => void)[] = [];
  private tones: Tone[] = [];
  private ballMat?: ThreeNS.MeshBasicMaterial;
  private dotMat?: ThreeNS.ShaderMaterial;
  private dotGeo?: ThreeNS.BufferGeometry;

  constructor() {
    const destroyRef = inject(DestroyRef);
    destroyRef.onDestroy(() => this.dispose());

    // Theme switch: re-read the tokens into the ball, the limb fade and every dot.
    const theme = inject(Theme);
    effect(() => {
      theme.version();
      untracked(() => this.recolour());
    });

    afterNextRender(() => {
      const wide = matchMedia('(min-width: 900px)');
      const motion = matchMedia('(prefers-reduced-motion: reduce)');
      this.reduced = motion.matches;
      const onMotion = () => {
        this.reduced = motion.matches;
        this.kick();
      };
      motion.addEventListener('change', onMotion);
      this.teardown.push(() => motion.removeEventListener('change', onMotion));

      // Don't download three.js for a panel the phone never shows.
      if (wide.matches) void this.init();
      else {
        const onWide = () => {
          if (!wide.matches || this.three) return;
          wide.removeEventListener('change', onWide);
          void this.init();
        };
        wide.addEventListener('change', onWide);
        this.teardown.push(() => wide.removeEventListener('change', onWide));
      }
    });
  }

  private async init() {
    let THREE: Three;
    try {
      THREE = await import('three');
    } catch {
      this.fallback.set(true);
      return;
    }
    if (this.destroyed) return;
    const stage = this.stage().nativeElement;
    const canvas = stage.querySelector('canvas');
    if (!canvas) return;

    let renderer: ThreeNS.WebGLRenderer;
    try {
      const probe = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
      if (!probe) throw new Error('no webgl');
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
    } catch {
      this.fallback.set(true);
      return;
    }
    this.three = THREE;
    this.renderer = renderer;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);

    const { tones, surface } = palette();

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 10);
    camera.position.set(0, 0, 4.25);
    this.scene = scene;
    this.camera = camera;

    // tilt (x) holds the spin group (y) so dragging feels like turning a ball on a stand.
    const tilt = new THREE.Group();
    const spin = new THREE.Group();
    tilt.rotation.x = START[0] * DEG;
    spin.rotation.y = -START[1] * DEG;
    tilt.add(spin);
    scene.add(tilt);
    this.tilt = tilt;
    this.spin = spin;

    // A flat sheet-coloured ball hides the far side's dots.
    const ballGeo = new THREE.SphereGeometry(0.985, 64, 48);
    const ballMat = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(...surface, THREE.SRGBColorSpace) });
    spin.add(new THREE.Mesh(ballGeo, ballMat));

    // Every dot in one buffer → one draw call: grey Fibonacci sphere, then cities, then vehicles.
    const pos: number[] = [];
    const col: number[] = [];
    const size: number[] = [];
    const push = (xyz: Rgb, tone: Tone, s: number) => {
      pos.push(...xyz);
      col.push(...tones[tone]);
      size.push(s);
      this.tones.push(tone);
    };
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < DOTS; i++) {
      const y = 1 - (i / (DOTS - 1)) * 2;
      const r = Math.sqrt(1 - y * y);
      const t = golden * i;
      push([Math.cos(t) * r, y, Math.sin(t) * r], 0, 2);
    }
    const perCity = new Map<string, number>();
    for (const c of this.store.customers()) if (CITIES[c.zone]) perCity.set(c.zone, (perCity.get(c.zone) ?? 0) + 1);
    for (const [zone, n] of perCity) {
      const [lat, lng] = CITIES[zone];
      push(toXYZ(lat, lng, 1.004), 1, Math.min(10, 4 + Math.sqrt(n) * 1.4));
    }
    for (const veh of this.store.vehicles()) {
      push(toXYZ(veh.lat, veh.lng, 1.006), veh.state === 'Offline' ? 2 : 1, 4);
    }
    const dotGeo = new THREE.BufferGeometry();
    dotGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    dotGeo.setAttribute('aColor', new THREE.Float32BufferAttribute(col, 3));
    dotGeo.setAttribute('aSize', new THREE.Float32BufferAttribute(size, 1));
    const dotMat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uDpr: { value: renderer.getPixelRatio() }, uBg: { value: new THREE.Vector3(...surface) } },
      transparent: true,
      depthWrite: false,
    });
    spin.add(new THREE.Points(dotGeo, dotMat));
    this.disposables.push(ballGeo, ballMat, dotGeo, dotMat);
    this.ballMat = ballMat;
    this.dotMat = dotMat;
    this.dotGeo = dotGeo;

    // Size to the stage; observers gate rendering.
    const resize = () => {
      const w = stage.clientWidth;
      if (!w) return;
      renderer.setSize(w, w, false);
      this.renderOnce();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(stage);
    const io = new IntersectionObserver(([e]) => {
      this.inView = e.isIntersecting;
      this.kick();
    });
    io.observe(stage);
    const onVis = () => this.kick();
    document.addEventListener('visibilitychange', onVis);
    this.teardown.push(() => {
      ro.disconnect();
      io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
    });
    resize();
  }

  private recolour() {
    const THREE = this.three;
    if (!THREE || !this.ballMat || !this.dotMat || !this.dotGeo) return;
    const { tones, surface } = palette();
    this.ballMat.color.setRGB(...surface, THREE.SRGBColorSpace);
    (this.dotMat.uniforms['uBg'].value as ThreeNS.Vector3).set(...surface);
    const attr = this.dotGeo.getAttribute('aColor') as ThreeNS.BufferAttribute;
    this.tones.forEach((t, i) => attr.setXYZ(i, ...tones[t]));
    attr.needsUpdate = true;
    this.renderOnce();
  }

  private get visible() {
    return this.inView && document.visibilityState === 'visible';
  }

  private get moving() {
    return this.dragging || Math.abs(this.velY) > 1e-5 || Math.abs(this.velX) > 1e-5 || !this.reduced;
  }

  /** Start the loop if it should run; it stops itself when hidden or at rest. */
  private kick() {
    if (!this.renderer || this.running || !this.visible) return;
    this.running = true;
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private readonly frame = (now: number) => {
    const dt = Math.min(64, now - this.lastFrame) / 1000;
    this.lastFrame = now;
    if (!this.dragging) {
      const decay = Math.pow(0.9, dt * 60);
      if (Math.abs(this.velY) > 1e-5 || Math.abs(this.velX) > 1e-5) {
        this.rotY += this.velY * dt * 60;
        this.rotX = this.clampX(this.rotX + this.velX * dt * 60);
        this.velY *= decay;
        this.velX *= decay;
      } else if (!this.reduced) {
        this.rotY += 0.06 * dt; // one turn every ~105 s
      }
    }
    this.renderOnce();
    if (this.visible && this.moving && !this.destroyed) this.raf = requestAnimationFrame(this.frame);
    else this.running = false;
  };

  private renderOnce() {
    if (!this.renderer || !this.scene || !this.camera) return;
    this.spin!.rotation.y = -START[1] * DEG + this.rotY;
    this.tilt!.rotation.x = START[0] * DEG + this.rotX;
    this.renderer.render(this.scene, this.camera);
  }

  private clampX(x: number) {
    return Math.max(-0.6, Math.min(0.6, x));
  }

  private perPx() {
    return Math.PI / Math.max(1, this.stage().nativeElement.clientWidth);
  }

  protected down(e: PointerEvent) {
    if (!this.renderer) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    this.dragging = true;
    this.velX = this.velY = 0;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.lastMoveAt = performance.now();
    this.kick();
  }

  protected move(e: PointerEvent) {
    if (!this.dragging) return;
    const k = this.perPx();
    const dx = (e.clientX - this.lastX) * k;
    const dy = (e.clientY - this.lastY) * k;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.lastMoveAt = performance.now();
    this.rotY += dx;
    this.rotX = this.clampX(this.rotX + dy);
    this.velY = dx;
    this.velX = dy;
  }

  protected up(e: PointerEvent) {
    if (!this.dragging) return;
    this.dragging = false;
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    // A pause before release means "put it down", not "throw it"; reduced motion never coasts.
    if (this.reduced || performance.now() - this.lastMoveAt > 80) this.velX = this.velY = 0;
    this.kick();
  }

  /** Arrow keys turn the globe in steps, without animation (keyboard actions don't animate). */
  protected key(e: KeyboardEvent) {
    const step = 12 * DEG;
    const moves: Record<string, () => void> = {
      ArrowLeft: () => (this.rotY -= step),
      ArrowRight: () => (this.rotY += step),
      ArrowUp: () => (this.rotX = this.clampX(this.rotX - step)),
      ArrowDown: () => (this.rotX = this.clampX(this.rotX + step)),
    };
    if (!moves[e.key]) return;
    e.preventDefault();
    moves[e.key]();
    this.renderOnce();
  }

  private dispose() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.running = false;
    for (const t of this.teardown) t();
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.forceContextLoss();
    }
    this.renderer = this.scene = this.camera = this.tilt = this.spin = undefined;
    this.ballMat = this.dotMat = this.dotGeo = undefined;
  }
}
