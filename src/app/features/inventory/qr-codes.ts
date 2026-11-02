import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, effect, inject, input, signal, viewChild } from '@angular/core';
import QRCode from 'qrcode';
import { Store } from '../../core/data/store';
import { DatePipe, TonePipe } from '../../core/data/format';
import { DeviceStatus } from '../../core/data/models';
import { Icon } from '../../shared/ui/icon';
import { Pager, pageOf } from '../../shared/ui/pager';
import { Toaster } from '../../shared/ui/toast';
import { simulateLoad } from '../../shared/ui/loading';
import { STATUS_LABEL } from './device-status';
import { Select, SelectOption } from '../../shared/ui/select';

/** Avery L7160 / A4: 3 × 7 labels of 63.5 × 38.1 mm. */
const PER_SHEET = 21;

/**
 * QR codes — "Which devices need a label, and what will the sheet look like?"
 * Pick devices (selection survives paging and filtering, unlike the legacy screen), preview the
 * A4 label sheet at true proportions, and print it. QR codes are rendered in the browser.
 */
@Component({
  selector: 'app-qr-codes',
  imports: [Select, SelectOption, Icon, Pager, DatePipe, TonePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './qr-codes.html',
  styleUrl: './qr-codes.scss',
})
export class QrCodes {
  protected readonly store = inject(Store);
  private readonly toast = inject(Toaster);
  protected readonly loading = simulateLoad('qr-codes');
  protected readonly label = STATUS_LABEL;
  protected readonly statuses: DeviceStatus[] = ['Available', 'Allocated', 'Sold', 'Deactivated', 'Faulty'];

  /** ?ids=DEV-1,DEV-2 from the inventory's bulk bar preselects those devices. */
  readonly idsParam = input<string | undefined>(undefined, { alias: 'ids' });

  protected readonly q = signal('');
  protected readonly typeId = signal<number | 'all'>('all');
  protected readonly status = signal<DeviceStatus | 'all'>('all');
  protected readonly page = signal(1);
  protected readonly size = 10;
  protected readonly selected = signal<ReadonlySet<string>>(new Set());

  private readonly types = computed(() => new Map(this.store.deviceTypes().map((t) => [t.id, t])));

  protected readonly rows = computed(() => {
    const q = this.q().trim().toLowerCase();
    const t = this.typeId();
    const s = this.status();
    return this.store
      .devices()
      .filter((d) => (t === 'all' || d.typeId === t) && (s === 'all' || d.status === s))
      .filter((d) => !q || d.id.toLowerCase().includes(q) || (q.length >= 3 && d.imei.includes(q)))
      .map((d) => ({ ...d, type: this.types().get(d.typeId)! }));
  });
  protected readonly pageRows = computed(() => pageOf(this.rows(), this.page(), this.size));

  constructor() {
    effect(() => {
      const ids = this.idsParam();
      if (ids) this.selected.set(new Set(ids.split(',').map((x) => x.trim()).filter(Boolean)));
    });
    effect(() => {
      this.q();
      this.typeId();
      this.status();
      this.page.set(1);
    });
    // Render QR codes for newly selected devices; keep the ones already drawn.
    effect(() => {
      const missing = [...this.selected()].filter((id) => !this.qr().has(id));
      if (!missing.length) return;
      Promise.all(
        missing.map(async (id) => [id, await QRCode.toString(id, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' })] as const),
      ).then((pairs) =>
        this.qr.update((m) => {
          const n = new Map(m);
          for (const [id, svg] of pairs) n.set(id, `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
          return n;
        }),
      );
    });
    // Ctrl+P prints the sheet too, not only the button.
    const before = () => this.mountPrint();
    const after = () => this.unmountPrint();
    addEventListener('beforeprint', before);
    addEventListener('afterprint', after);
    inject(DestroyRef).onDestroy(() => {
      removeEventListener('beforeprint', before);
      removeEventListener('afterprint', after);
      this.unmountPrint();
    });
  }

  // ── Selection ──────────────────────────────────────────────
  protected readonly pageAll = computed(() => this.pageRows().length > 0 && this.pageRows().every((d) => this.selected().has(d.id)));
  protected readonly pageSome = computed(() => !this.pageAll() && this.pageRows().some((d) => this.selected().has(d.id)));
  protected readonly allMatchingSelected = computed(() => this.rows().length > 0 && this.rows().every((d) => this.selected().has(d.id)));

  protected toggle(id: string, on: boolean) {
    this.selected.update((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
  }
  protected setMany(ids: string[], on: boolean) {
    this.selected.update((s) => {
      const n = new Set(s);
      for (const id of ids) {
        if (on) n.add(id);
        else n.delete(id);
      }
      return n;
    });
  }
  protected readonly ids = (rows: { id: string }[]) => rows.map((r) => r.id);

  // ── Sheet ──────────────────────────────────────────────────
  protected readonly qr = signal<ReadonlyMap<string, string>>(new Map());
  /** Labels in the order the devices appear in stock, split into A4 sheets. */
  protected readonly sheets = computed(() => {
    const sel = this.selected();
    const labels = this.store
      .devices()
      .filter((d) => sel.has(d.id))
      .map((d) => ({ id: d.id, imei: d.imei, type: this.types().get(d.typeId)!.name, src: this.qr().get(d.id) ?? null }));
    const out: (typeof labels)[] = [];
    for (let i = 0; i < labels.length; i += PER_SHEET) out.push(labels.slice(i, i + PER_SHEET));
    return out;
  });
  protected readonly blanks = (n: number) => Array.from({ length: PER_SHEET - n }, (_, i) => i);
  protected readonly ready = computed(() => [...this.selected()].every((id) => this.qr().has(id)));
  protected readonly subline = computed(() => {
    const n = this.selected().size;
    if (!n) return 'Select devices to print their QR labels on A4 sheets (3 × 7, 63.5 × 38.1 mm).';
    const s = this.sheets().length;
    return `${n} ${n === 1 ? 'label' : 'labels'} on ${s} A4 ${s === 1 ? 'sheet' : 'sheets'} · ${PER_SHEET * s - n} blank`;
  });

  private readonly sheetEl = viewChild<ElementRef<HTMLElement>>('sheet');
  private printRoot: HTMLElement | null = null;

  protected print() {
    if (!this.selected().size || !this.ready()) return;
    window.print();
  }
  /** Copies the sheet to a body-level node; the print stylesheet hides everything else. */
  private mountPrint() {
    const el = this.sheetEl()?.nativeElement;
    if (!el || !this.selected().size) return;
    this.unmountPrint();
    this.printRoot = document.createElement('div');
    this.printRoot.className = 'qr-print-root';
    this.printRoot.appendChild(el.cloneNode(true));
    document.body.appendChild(this.printRoot);
    document.body.classList.add('qr-printing');
  }
  private unmountPrint() {
    this.printRoot?.remove();
    this.printRoot = null;
    document.body.classList.remove('qr-printing');
  }

  protected clear() {
    const before = this.selected();
    this.selected.set(new Set());
    this.toast.show('Selection cleared', { tone: 'info', action: { label: 'Undo', run: () => this.selected.set(before) } });
  }
  protected resetFilters() {
    this.q.set('');
    this.typeId.set('all');
    this.status.set('all');
  }
}
