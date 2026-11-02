import {
  ChangeDetectionStrategy, ChangeDetectorRef, Component, DestroyRef, ElementRef, HostListener, booleanAttribute,
  computed, contentChildren, forwardRef, inject, input, model, signal, viewChild,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { Icon } from './icon';

/**
 * One choice inside <app-select>. Mirrors <option>: `value` (stringified like a native option),
 * `disabled`, `selected`, and the label is the element's text (or the `label` input).
 * An option with value "" that is disabled acts as the placeholder.
 */
@Component({
  selector: 'app-option',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { hidden: '' },
  template: '<ng-content />',
})
export class SelectOption {
  readonly value = input<unknown>('');
  readonly label = input<string | null>(null);
  readonly hint = input<string | null>(null);
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly selected = input(false, { transform: booleanAttribute });
  private readonly el = inject(ElementRef<HTMLElement>).nativeElement;
  get key(): string {
    const v = this.value();
    return v == null ? '' : String(v);
  }
  get text(): string {
    return (this.label() ?? this.el.textContent ?? '').replace(/\s+/g, ' ').trim();
  }
}

let uid = 0;

/**
 * Custom dropdown that replaces the native <select> everywhere.
 * Drop-in: `<app-select [value]="x" (valueChange)="x = $event">` or `formControlName="x"`, with
 * <app-option> children. Values are strings, exactly like a native select, so handlers keep working.
 * Keyboard: ↑ ↓ Home End, Enter/Space to choose, Esc to close, type to jump. Long lists get a search box.
 * The panel is position: fixed (never clipped by a scrolling table) and flips up near the bottom.
 */
@Component({
  selector: 'app-select',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => Select), multi: true }],
  host: {
    class: 'app-select',
    '[attr.id]': 'null',
    '[attr.aria-label]': 'null',
    '[class.open]': 'open()',
    '[class.is-disabled]': 'isDisabled()',
  },
  template: `
    <button
      #trigger
      type="button"
      class="trigger"
      [id]="id() ?? autoId"
      role="combobox"
      aria-haspopup="listbox"
      [attr.aria-expanded]="open()"
      [attr.aria-controls]="listId"
      [attr.aria-label]="ariaLabel()"
      [attr.aria-activedescendant]="open() && active() >= 0 ? listId + '-' + active() : null"
      [disabled]="isDisabled()"
      (click)="toggle()"
      (keydown)="onTriggerKey($event)"
      (blur)="onTouched()"
    >
      <span class="current" [class.placeholder]="!current()">{{ current()?.text ?? placeholderText() }}</span>
      <app-icon name="chevron-down" [size]="14" class="chev" />
    </button>
    <ng-content />

    @if (open()) {
      <div
        class="panel"
        [class.up]="up()"
        [style.left.px]="pos().left"
        [style.top.px]="up() ? null : pos().top"
        [style.bottom.px]="up() ? pos().bottom : null"
        [style.min-width.px]="pos().width"
        (mousedown)="$event.preventDefault()"
      >
        @if (showSearch()) {
          <div class="search">
            <app-icon name="search" [size]="14" />
            <input
              #search
              class="search-input"
              type="text"
              placeholder="Search"
              aria-label="Search options"
              [value]="query()"
              (input)="query.set($any($event.target).value); active.set(0)"
              (keydown)="onListKey($event)"
            />
          </div>
        }
        <ul class="list" role="listbox" [id]="listId" [attr.aria-label]="ariaLabel()">
          @for (o of visible(); track o.key + $index; let i = $index) {
            <li
              role="option"
              [id]="listId + '-' + i"
              [attr.aria-selected]="o.key === key()"
              [attr.aria-disabled]="o.disabled() || null"
              [class.active]="i === active()"
              [class.selected]="o.key === key()"
              [class.disabled]="o.disabled()"
              (mouseenter)="active.set(i)"
              (click)="choose(o)"
            >
              <span class="lbl">{{ o.text }}</span>
              @if (o.hint()) { <span class="hint">{{ o.hint() }}</span> }
              @if (o.key === key()) { <app-icon name="check" [size]="14" class="tick" /> }
            </li>
          } @empty {
            <li class="none">No matches for “{{ query() }}”</li>
          }
        </ul>
      </div>
    }
  `,
  styles: `
    :host { display: inline-flex; position: relative; width: 100%; min-width: 0; vertical-align: middle; }
    .trigger {
      width: 100%; height: var(--control-h); display: flex; align-items: center; gap: 8px;
      padding: 0 10px; text-align: left; cursor: pointer;
      border: 1px solid var(--control); border-radius: var(--radius-control);
      background: var(--surface); color: var(--text); font: inherit;
      transition: border-color var(--duration-quick) ease, box-shadow var(--duration-quick) ease, background-color var(--duration-quick) ease;
    }
    .trigger:hover:not(:disabled) { border-color: color-mix(in srgb, var(--control) 70%, var(--text)); }
    .trigger:focus-visible, :host(.open) .trigger { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-weak); }
    .trigger:disabled { background: var(--raised); color: var(--muted); cursor: not-allowed; }
    :host(.invalid) .trigger { border-color: var(--negative); box-shadow: 0 0 0 3px var(--negative-bg); }
    .current { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .placeholder { color: var(--faint); }
    .chev { color: var(--muted); transition: transform var(--duration-fast) var(--ease-out); }
    :host(.open) .chev { transform: rotate(180deg); }

    .panel {
      position: fixed; z-index: 1100; max-width: min(420px, calc(100vw - 16px));
      background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-card);
      box-shadow: var(--shadow-float); padding: 4px; display: flex; flex-direction: column;
      transform-origin: top center;
      transition: opacity var(--duration-quick) var(--ease-out), transform var(--duration-fast) var(--ease-out);
      @starting-style { opacity: 0; transform: scale(var(--scale-menu)) translateY(-4px); }
    }
    .panel.up { transform-origin: bottom center; }
    @starting-style { .panel.up { opacity: 0; transform: scale(var(--scale-menu)) translateY(4px); } }
    .search { position: relative; display: flex; align-items: center; padding: 2px 2px 6px; border-bottom: 1px solid var(--rule); margin-bottom: 4px; }
    .search app-icon { position: absolute; left: 10px; color: var(--muted); }
    .search-input {
      width: 100%; height: 30px; padding: 0 8px 0 28px; border: 1px solid var(--control); border-radius: var(--radius-control);
      background: var(--surface); color: var(--text); font: inherit; font-size: 13px;
    }
    .search-input:focus { outline: none; border-color: var(--accent); }
    .list { list-style: none; margin: 0; padding: 0; max-height: 264px; overflow-y: auto; overscroll-behavior: contain; }
    li[role='option'] {
      display: flex; align-items: center; gap: 8px; min-height: 32px; padding: 6px 10px; border-radius: 4px;
      cursor: pointer; color: var(--text); white-space: nowrap;
    }
    li.active { background: var(--raised); }
    li.selected { font-weight: 500; }
    li.disabled { color: var(--faint); cursor: not-allowed; }
    .lbl { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
    .hint { color: var(--muted); font-size: 12px; }
    .tick { color: var(--accent); }
    .none { padding: 10px; color: var(--muted); }
  `,
})
export class Select implements ControlValueAccessor {
  /** Current value (string, like a native select). Two-way: [(value)]. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- string at runtime, like a native select
  readonly value = model<any>(undefined);
  readonly id = input<string | null>(null);
  readonly ariaLabel = input<string | null>(null, { alias: 'aria-label' });
  readonly placeholder = input<string>('Choose…');
  readonly disabled = input(false, { transform: booleanAttribute });
  /** Force the search box on or off; by default it shows for more than 8 options. */
  readonly searchable = input<boolean | undefined>(undefined);

  private readonly options = contentChildren(SelectOption);
  private readonly trigger = viewChild.required<ElementRef<HTMLButtonElement>>('trigger');
  private readonly searchEl = viewChild<ElementRef<HTMLInputElement>>('search');
  private readonly host = inject(ElementRef<HTMLElement>).nativeElement;
  private readonly cdr = inject(ChangeDetectorRef);

  protected readonly autoId = `app-select-${++uid}`;
  protected readonly listId = `${this.autoId}-list`;
  protected readonly open = signal(false);
  protected readonly up = signal(false);
  protected readonly pos = signal({ left: 0, top: 0, bottom: 0, width: 0 });
  protected readonly active = signal(-1);
  protected readonly query = signal('');
  private readonly cvaDisabled = signal(false);
  private typeahead = '';
  private typeaheadTimer: ReturnType<typeof setTimeout> | null = null;

  protected readonly isDisabled = computed(() => this.disabled() || this.cvaDisabled());
  /** The placeholder option (disabled, value ""), if any. */
  private readonly placeholderOpt = computed(() => this.options().find((o) => o.key === '' && o.disabled()));
  protected readonly choices = computed(() => this.options().filter((o) => o !== this.placeholderOpt()));
  protected readonly showSearch = computed(() => this.searchable() ?? this.choices().length > 8);
  protected readonly visible = computed(() => {
    const q = this.query().trim().toLowerCase();
    return q ? this.choices().filter((o) => o.text.toLowerCase().includes(q)) : this.choices();
  });

  /** The selected key; falls back like a native select (a [selected] option, else the first one). */
  protected readonly key = computed(() => {
    const v = this.value();
    const opts = this.options();
    if (v !== undefined && v !== null) {
      const k = String(v);
      if (opts.some((o) => o.key === k)) return k;
      if (k === '' && this.placeholderOpt()) return '';
    }
    const sel = opts.find((o) => o.selected());
    if (sel) return sel.key;
    if (this.placeholderOpt()) return '';
    return opts.find((o) => !o.disabled())?.key ?? '';
  });
  protected readonly current = computed(() => this.choices().find((o) => o.key === this.key()) ?? null);
  protected readonly placeholderText = computed(() => this.placeholderOpt()?.text || this.placeholder());

  private onChange: (v: string) => void = () => {};
  protected onTouched: () => void = () => {};

  constructor() {
    const close = (e: Event) => {
      if (!this.open()) return;
      // Scrolling inside our own list is fine; anything else would detach the fixed panel.
      if (e.type === 'scroll' && this.host.contains(e.target as Node)) return;
      this.close(false);
    };
    document.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    inject(DestroyRef).onDestroy(() => {
      document.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    });
  }

  // ── ControlValueAccessor ──
  writeValue(v: unknown) {
    this.value.set(v);
    this.cdr.markForCheck();
  }
  registerOnChange(fn: (v: string) => void) {
    this.onChange = fn;
  }
  registerOnTouched(fn: () => void) {
    this.onTouched = fn;
  }
  setDisabledState(d: boolean) {
    this.cvaDisabled.set(d);
  }

  // ── Open / close ──
  protected toggle() {
    this.open() ? this.close(true) : this.openPanel();
  }

  private openPanel() {
    if (this.isDisabled()) return;
    const r = this.trigger().nativeElement.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom;
    this.up.set(spaceBelow < 300 && r.top > spaceBelow);
    this.pos.set({ left: Math.min(r.left, window.innerWidth - Math.max(r.width, 180) - 8), top: r.bottom + 4, bottom: window.innerHeight - r.top + 4, width: r.width });
    this.query.set('');
    const i = this.visible().findIndex((o) => o.key === this.key());
    this.active.set(i >= 0 ? i : this.firstEnabled(0, 1));
    this.open.set(true);
    requestAnimationFrame(() => {
      this.searchEl()?.nativeElement.focus();
      this.scrollActive();
    });
  }

  private close(refocus: boolean) {
    this.open.set(false);
    if (refocus) this.trigger().nativeElement.focus();
  }

  protected choose(o: SelectOption) {
    if (o.disabled()) return;
    const k = o.key;
    const changed = k !== this.key();
    this.value.set(k);
    if (changed) this.onChange(k);
    this.onTouched();
    this.close(true);
  }

  // ── Keyboard ──
  protected onTriggerKey(e: KeyboardEvent) {
    if (this.open()) {
      this.onListKey(e);
      return;
    }
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
      e.preventDefault();
      this.openPanel();
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Type-ahead while closed changes the value directly, like a native select.
      const hit = this.typeaheadMatch(e.key);
      if (hit) this.choose(hit);
    }
  }

  protected onListKey(e: KeyboardEvent) {
    const n = this.visible().length;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        this.active.set(this.firstEnabled(this.active() + 1, 1));
        this.scrollActive();
        break;
      case 'ArrowUp':
        e.preventDefault();
        this.active.set(this.firstEnabled(this.active() - 1, -1));
        this.scrollActive();
        break;
      case 'Home':
        if (e.target === this.searchEl()?.nativeElement) return;
        e.preventDefault();
        this.active.set(this.firstEnabled(0, 1));
        this.scrollActive();
        break;
      case 'End':
        if (e.target === this.searchEl()?.nativeElement) return;
        e.preventDefault();
        this.active.set(this.firstEnabled(n - 1, -1));
        this.scrollActive();
        break;
      case 'Enter':
        e.preventDefault();
        if (this.visible()[this.active()]) this.choose(this.visible()[this.active()]);
        break;
      case ' ':
        if (this.showSearch()) return; // typing a space in the search box
        e.preventDefault();
        if (this.visible()[this.active()]) this.choose(this.visible()[this.active()]);
        break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation(); // don't also close a surrounding dialog
        this.close(true);
        break;
      case 'Tab':
        this.close(false);
        break;
      default:
        if (!this.showSearch() && e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
          const hit = this.typeaheadMatch(e.key);
          if (hit) {
            this.active.set(this.visible().indexOf(hit));
            this.scrollActive();
          }
        }
    }
  }

  private firstEnabled(from: number, step: 1 | -1) {
    const list = this.visible();
    const n = list.length;
    if (!n) return -1;
    let i = Math.max(0, Math.min(n - 1, from));
    for (let k = 0; k < n; k++, i = (i + step + n) % n) if (!list[i].disabled()) return i;
    return -1;
  }

  private typeaheadMatch(ch: string) {
    this.typeahead += ch.toLowerCase();
    if (this.typeaheadTimer) clearTimeout(this.typeaheadTimer);
    this.typeaheadTimer = setTimeout(() => (this.typeahead = ''), 600);
    return this.choices().find((o) => !o.disabled() && o.text.toLowerCase().startsWith(this.typeahead));
  }

  private scrollActive() {
    requestAnimationFrame(() => {
      const el = document.getElementById(`${this.listId}-${this.active()}`);
      el?.scrollIntoView({ block: 'nearest' });
    });
  }

  @HostListener('document:mousedown', ['$event'])
  protected outside(e: MouseEvent) {
    if (this.open() && !this.host.contains(e.target as Node)) this.close(false);
  }
}
