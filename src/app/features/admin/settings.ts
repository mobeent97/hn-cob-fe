import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Store } from '../../core/data/store';
import { PortalSettings } from '../../core/data/models';
import { RelativePipe } from '../../core/data/format';
import { SettingsApi, settingsErrorKey, settingsPatch } from '../../core/api/settings.api';
import { ApiError, errorText } from '../../core/api/api-client';
import { Toaster } from '../../shared/ui/toast';
import { LoadError, loadState } from '../../shared/ui/load-state';
import { ReadOnlyNote, writeAccess } from '../tenancy';
import { Select, SelectOption } from '../../shared/ui/select';

type Section = 'password' | 'pagination' | 'login';
type Ranges<T> = Partial<Record<keyof T, [number, number]>>;

/** SETTINGS_API validation; the server checks the same ranges (400 4501). */
const RANGES: { password: Ranges<PortalSettings['password']>; login: Ranges<PortalSettings['login']> } = {
  password: { minLength: [8, 64], expiryDays: [0, 365], history: [0, 24] },
  login: { sessionMinutes: [5, 480], maxAttempts: [3, 10], lockMinutes: [1, 1440] },
};

/**
 * Settings — "What rules apply to every portal account, and are they what we want?"
 * Two-column settings rows: label and current values on the left, the panel on the right with its own
 * Save (PATCH /settings/ with that section only). Platform-only: partners never reach this route.
 * Notification preferences are per user and live on My profile.
 */
@Component({
  selector: 'app-settings',
  imports: [Select, SelectOption, ReadOnlyNote, LoadError, RouterLink, RelativePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './settings.html',
  styleUrls: ['./settings-layout.css', './settings.css'],
})
export class Settings {
  protected readonly store = inject(Store);
  private readonly api = inject(SettingsApi);
  /** Settings RW gates every write action on this screen. */
  protected readonly w = writeAccess('Settings');
  private readonly toast = inject(Toaster);
  protected readonly state = loadState();
  protected readonly pageSizes = [10, 25, 50];
  protected readonly saving = signal<Section | null>(null);
  protected readonly saveError = signal<Partial<Record<Section, string>>>({});
  /** Field messages from the server (`data.errors`), keyed like the client ones. */
  private readonly serverErrors = signal<Record<string, string>>({});

  constructor() {
    void this.load();
  }

  protected async load() {
    const s = await this.state.run(() => this.api.get());
    if (s) this.store.settings.set(s);
  }

  protected readonly password = linkedSignal(() => ({ ...this.store.settings().password }));
  protected readonly pagination = linkedSignal(() => ({ ...this.store.settings().pagination }));
  protected readonly login = linkedSignal(() => ({ ...this.store.settings().login }));

  private readonly drafts = { password: this.password, pagination: this.pagination, login: this.login };

  protected readonly dirty = computed(() => {
    const s = this.store.settings();
    const same = (a: object, b: object) => JSON.stringify(a) === JSON.stringify(b);
    return { password: !same(s.password, this.password()), pagination: !same(s.pagination, this.pagination()), login: !same(s.login, this.login()) };
  });

  protected readonly errors = computed(() => {
    const out: Record<string, string> = { ...this.serverErrors() };
    const check = <T extends object>(sec: 'password' | 'login', draft: T) => {
      for (const [k, [lo, hi]] of Object.entries(RANGES[sec]) as [string, [number, number]][]) {
        const v = (draft as Record<string, number>)[k];
        if (v == null || !Number.isInteger(v) || v < lo || v > hi) out[`${sec}.${k}`] = `Enter a whole number from ${lo} to ${hi}.`;
      }
    };
    check('password', this.password());
    check('login', this.login());
    return out;
  });
  protected err(key: string) {
    return this.errors()[key];
  }
  private sectionValid(sec: Section) {
    return !Object.keys(this.errors()).some((k) => k.startsWith(sec + '.'));
  }
  private clearServer(sec: Section) {
    this.serverErrors.update((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !k.startsWith(sec + '.'))));
    this.saveError.update((e) => ({ ...e, [sec]: undefined }));
  }

  protected num(e: Event): number {
    const v = (e.target as HTMLInputElement).value;
    return v === '' ? (null as unknown as number) : +v;
  }
  protected setPassword<K extends keyof PortalSettings['password']>(k: K, v: PortalSettings['password'][K]) {
    this.clearServer('password');
    this.password.update((d) => ({ ...d, [k]: v }));
  }
  protected setLogin<K extends keyof PortalSettings['login']>(k: K, v: PortalSettings['login'][K]) {
    this.clearServer('login');
    this.login.update((d) => ({ ...d, [k]: v }));
  }

  /** The rules as a person will read them on the change-password screen. */
  protected readonly rules = computed(() => {
    const p = this.password();
    return [
      `At least ${p.minLength || '—'} characters`,
      ...(p.requireNumber ? ['At least one number'] : []),
      ...(p.requireSymbol ? ['At least one symbol, such as ! or #'] : []),
      p.history ? `Different from the last ${p.history} passwords` : 'May reuse a previous password',
      p.expiryDays ? `Must be changed every ${p.expiryDays} days` : 'Never expires',
    ];
  });

  protected discard(sec: Section) {
    const s = this.store.settings();
    this.clearServer(sec);
    if (sec === 'password') this.password.set({ ...s.password });
    if (sec === 'pagination') this.pagination.set({ ...s.pagination });
    if (sec === 'login') this.login.set({ ...s.login });
  }

  protected async save(sec: Section) {
    if (!this.dirty()[sec] || !this.sectionValid(sec) || this.saving()) return;
    const draft: PortalSettings = { ...this.store.settings(), password: this.password(), pagination: this.pagination(), login: this.login() };
    this.saving.set(sec);
    this.clearServer(sec);
    try {
      // Keep the other sections' unsaved drafts: the response resets only what was saved.
      const others = { password: this.password(), pagination: this.pagination(), login: this.login() };
      const saved = await this.api.patch(settingsPatch(sec, draft));
      this.store.settings.set(saved);
      for (const k of ['password', 'pagination', 'login'] as Section[]) {
        if (k !== sec) (this.drafts[k] as { set(v: unknown): void }).set({ ...others[k] });
      }
      const copy: Record<Section, [string, string]> = {
        password: ['Password policy saved', 'New rules apply the next time someone sets a password.'],
        pagination: ['Page size saved', `Lists now show ${saved.pagination.pageSize} rows per page.`],
        login: ['Sign-in settings saved', 'Session changes apply to the next request.'],
      };
      this.toast.show(copy[sec][0], { body: copy[sec][1] });
    } catch (err) {
      if (err instanceof ApiError) {
        const fields = Object.fromEntries(Object.entries(err.fieldErrors).map(([k, v]) => [settingsErrorKey(k), v[0]]));
        this.serverErrors.update((e) => ({ ...e, ...fields }));
      }
      this.saveError.update((e) => ({ ...e, [sec]: errorText(err) }));
    } finally {
      this.saving.set(null);
    }
  }
}
