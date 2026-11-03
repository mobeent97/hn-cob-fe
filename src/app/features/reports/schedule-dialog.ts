import { ChangeDetectionStrategy, Component, computed, effect, inject, input, model, signal, untracked } from '@angular/core';
import { Store } from '../../core/data/store';
import { fmtDate } from '../../core/data/format';
import { Dialog } from '../../shared/ui/dialog';
import { Icon } from '../../shared/ui/icon';
import { Toaster } from '../../shared/ui/toast';
import { DEFAULT_FILTERS, Filters, filterSummary, reportById } from './report-data';
import {
  Frequency, RUN_HOUR, ReportSchedule, WEEKDAYS, cadence, nextRun, nextScheduleId, saveSchedule,
} from './report-schedules';
import { Select, SelectOption } from '../../shared/ui/select';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Create or edit a report schedule: cadence, day, and who receives it. */
@Component({
  selector: 'app-schedule-dialog',
  imports: [Select, SelectOption, Dialog, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-dialog [(open)]="open" [heading]="existing() ? 'Edit schedule' : 'Schedule this report'" [subheading]="subheading()" width="520px">
      <div class="form">
        <div class="row">
          <div class="field">
            <label for="sch-freq">Frequency</label>
            <app-select id="sch-freq" (valueChange)="setFrequency($event)">
              <app-option value="Weekly" [selected]="frequency() === 'Weekly'">Weekly</app-option>
              <app-option value="Monthly" [selected]="frequency() === 'Monthly'">Monthly</app-option>
            </app-select>
          </div>
          <div class="field">
            <label for="sch-day">{{ frequency() === 'Weekly' ? 'Day of the week' : 'Day of the month' }}</label>
            <app-select id="sch-day" (valueChange)="day.set(+$event)">
              @if (frequency() === 'Weekly') {
                @for (d of weekdays; track d; let i = $index) { <app-option [value]="'' + (i + 1)" [selected]="day() === i + 1">{{ d }}</app-option> }
              } @else {
                @for (d of monthDays; track d) { <app-option [value]="'' + d" [selected]="day() === d">{{ d }}</app-option> }
              }
            </app-select>
          </div>
        </div>

        <div class="field">
          <label for="sch-to">Recipients</label>
          <div class="chips ui-control" [class.invalid]="!!error()" (click)="focusInput(inputEl)">
            @for (r of recipients(); track r) {
              <span class="chip">
                {{ r }}
                <button type="button" [attr.aria-label]="'Remove ' + r" (click)="remove(r); $event.stopPropagation()"><app-icon name="x" [size]="12" /></button>
              </span>
            }
            <input #inputEl id="sch-to" type="email" [value]="draft()" placeholder="name@hypernymbiz.com"
                   (input)="draft.set($any($event.target).value); error.set('')"
                   (keydown)="key($event)" (blur)="commit()" (paste)="paste($event)" autocomplete="off" />
          </div>
          @if (error()) { <span class="error">{{ error() }}</span> }
          @else { <span class="hint">Press Enter or comma after each address.</span> }
        </div>

        <p class="summary">
          Sends <strong>{{ filtersText() }}</strong> as CSV and PDF at {{ runHour }}:00 Gulf time.
          @if (existing()?.paused) { Paused: nothing goes out until you resume it. } @else if (canSave()) { Next run {{ next() }}. }
        </p>
      </div>
      <ng-container slot="footer">
        <button class="btn" (click)="open.set(false)">Cancel</button>
        <button class="btn primary" [disabled]="!canSave()" (click)="save()">{{ existing() ? 'Save changes' : 'Save schedule' }}</button>
      </ng-container>
    </app-dialog>
  `,
  styles: `
    .form { display: flex; flex-direction: column; gap: 16px; }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .chips {
      height: auto; min-height: var(--control-h); display: flex; flex-wrap: wrap; align-items: center;
      gap: 6px; padding: 5px 8px; cursor: text;
    }
    .chips:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-weak); }
    .chips.invalid:focus-within { border-color: var(--negative); box-shadow: 0 0 0 3px var(--negative-bg); }
    .chips input { flex: 1; min-width: 160px; border: 0; outline: none; background: none; color: var(--text); height: 24px; padding: 0 2px; }
    .chips input::placeholder { color: var(--faint); }
    .chip {
      display: inline-flex; align-items: center; gap: 4px; height: 24px; padding: 0 4px 0 8px;
      border-radius: var(--radius-chip); background: var(--neutral-bg); color: var(--neutral-ink); font-size: 13px;
      max-width: 100%; overflow: hidden; text-overflow: ellipsis;
    }
    .chip button {
      display: inline-flex; border: 0; background: none; color: var(--muted); padding: 2px; border-radius: 3px;
    }
    .chip button:hover { background: var(--active); color: var(--text); }
    .summary { color: var(--muted); line-height: 20px; }
    .summary strong { color: var(--text); font-weight: 500; }
    @media (max-width: 480px) { .row { grid-template-columns: 1fr; } }
  `,
})
export class ScheduleDialog {
  private readonly store = inject(Store);
  private readonly toast = inject(Toaster);

  readonly open = model(false);
  /** The schedule being edited, or null to create one for reportId + filters. */
  readonly existing = input<ReportSchedule | null>(null);
  readonly reportId = input<string>('');
  readonly filters = input<Filters>(DEFAULT_FILTERS);

  protected readonly weekdays = WEEKDAYS;
  protected readonly monthDays = Array.from({ length: 28 }, (_, i) => i + 1);
  protected readonly runHour = String(RUN_HOUR).padStart(2, '0');

  protected readonly frequency = signal<Frequency>('Weekly');
  protected readonly day = signal(1);
  protected readonly recipients = signal<string[]>([]);
  protected readonly draft = signal('');
  protected readonly error = signal('');

  private readonly report = computed(() => reportById(this.existing()?.reportId ?? this.reportId()));
  private readonly activeFilters = computed(() => this.existing()?.filters ?? this.filters());
  protected readonly subheading = computed(() => this.report()?.name ?? '');
  protected readonly filtersText = computed(() => filterSummary(this.activeFilters(), this.store, this.report()?.forward));
  protected readonly canSave = computed(() => this.recipients().length > 0 && !this.error());
  protected readonly next = computed(() => fmtDate(nextRun({ frequency: this.frequency(), day: this.day() }, this.store.today).toISOString()));

  constructor() {
    // Reset the form each time the dialog opens.
    effect(() => {
      if (!this.open()) return;
      untracked(() => {
        const s = this.existing();
        this.frequency.set(s?.frequency ?? 'Weekly');
        this.day.set(s?.day ?? 1);
        this.recipients.set(s ? [...s.recipients] : [this.store.currentUser().email]);
        this.draft.set('');
        this.error.set('');
      });
    });
  }

  protected setFrequency(f: Frequency) {
    this.frequency.set(f);
    this.day.set(1);
  }

  protected focusInput(el: HTMLInputElement) {
    el.focus();
  }

  protected key(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ',' || e.key === ';') {
      e.preventDefault();
      this.commit();
    } else if (e.key === 'Backspace' && !this.draft() && this.recipients().length) {
      this.recipients.update((xs) => xs.slice(0, -1));
    }
  }

  protected paste(e: ClipboardEvent) {
    const text = e.clipboardData?.getData('text') ?? '';
    if (!/[,;\s]/.test(text.trim())) return;
    e.preventDefault();
    for (const part of text.split(/[,;\s]+/)) this.add(part);
  }

  protected commit() {
    this.add(this.draft());
  }

  private add(raw: string) {
    const v = raw.trim().replace(/[,;]$/, '').toLowerCase();
    if (!v) return;
    if (!EMAIL.test(v)) {
      this.draft.set(v);
      this.error.set(`“${v}” isn’t an email address.`);
      return;
    }
    if (!this.recipients().includes(v)) this.recipients.update((xs) => [...xs, v]);
    this.draft.set('');
    this.error.set('');
  }

  protected remove(r: string) {
    this.recipients.update((xs) => xs.filter((x) => x !== r));
  }

  protected save() {
    this.commit();
    if (!this.canSave()) return;
    const s: ReportSchedule = {
      id: this.existing()?.id ?? nextScheduleId(),
      reportId: this.report()!.id,
      frequency: this.frequency(),
      day: this.day(),
      recipients: this.recipients(),
      filters: this.activeFilters(),
      paused: this.existing()?.paused ?? false,
    };
    saveSchedule(s);
    const n = s.recipients.length;
    this.toast.show(this.existing() ? 'Schedule updated' : 'Report scheduled', {
      body: `${this.report()!.name} · ${cadence(s)} · ${n} ${n === 1 ? 'recipient' : 'recipients'}. Next run ${this.next()}.`,
    });
    this.open.set(false);
  }
}
