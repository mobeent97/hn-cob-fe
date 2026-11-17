import { ChangeDetectionStrategy, Component, computed, inject, input, linkedSignal, signal } from '@angular/core';
import { Store } from '../../core/data/store';
import { Access } from '../../core/access/access';
import { FEATURES, FeatureDef } from '../../core/access/features';
import { Permission } from '../../core/data/models';
import { DatePipe, RelativePipe } from '../../core/data/format';
import { AuthService } from '../../core/auth/auth.service';
import { AuthCode, AuthError } from '../../core/auth/auth.models';
import { ApiError, errorText } from '../../core/api/api-client';
import { Icon } from '../../shared/ui/icon';
import { Toaster } from '../../shared/ui/toast';
import { LoadError, loadState } from '../../shared/ui/load-state';
import { Select, SelectOption } from '../../shared/ui/select';
import { NotificationPrefsPanel } from './notification-prefs';

type Rule = { id: string; label: string; ok: boolean };
type AccessRow = { f: FeatureDef; level: Permission; reason: string | null };

export const LEVEL_LABEL: Record<string, string> = { none: 'None', R: 'Read', RW: 'Read & write' };
/** GET /auth/me/access/ `features[].reason`, as the panel says it. `no_role` stays quiet: "None" says enough. */
const REASON_TEXT: Record<string, string> = { platform_only: 'HyperNym only', capped_by_plan: 'Capped by organization plan' };
/** USERS_API phone: `+<1–4 digit country code> <6–15 digits, spaces or dashes>`. */
const NUMBER_RE = /^[0-9][0-9 -]{4,18}[0-9]$/;

/**
 * My profile — "Are my details right, what can I do here, and can I change my password safely?"
 * Details save with PATCH /auth/me/, the access panel is the server's answer (GET /auth/me/access/,
 * with the reason a level is lower), the password changes with POST /auth/me/change-password/
 * (this session continues with the returned tokens), and the notification preferences are here so
 * every user can reach them. Sign-in is by email; there are no usernames.
 */
@Component({
  selector: 'app-profile',
  imports: [Select, SelectOption, Icon, RelativePipe, DatePipe, LoadError, NotificationPrefsPanel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './profile.html',
  styleUrls: ['./settings-layout.css', './profile.css'],
})
export class Profile {
  protected readonly store = inject(Store);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(Toaster);
  protected readonly me = this.store.currentUser;
  protected readonly access = inject(Access);
  protected readonly org = this.store.currentOrg;
  protected readonly levelLabel = (p: Permission) => LEVEL_LABEL[p ?? 'none'];
  /** ?section=notifications (bell → Preferences). */
  readonly section = input<string | undefined>(undefined);
  protected readonly accessState = loadState();

  constructor() {
    void this.loadAccess();
  }

  protected async loadAccess() {
    await this.accessState.run(() => this.auth.loadAccess());
  }

  // ── Organization & access ──────────────────────────────────
  /** Every feature by area with the effective level and, when lowered, the server's reason. */
  protected readonly accessAreas = computed(() => {
    const levels = this.access.levels();
    const reasons = this.access.reasons() ?? {};
    const out: { area: string; rows: AccessRow[] }[] = [];
    for (const f of FEATURES) {
      const level = levels[f.key] ?? null;
      const r = reasons[f.key];
      const row = { f, level, reason: r ? (REASON_TEXT[r] ?? null) : null };
      const last = out[out.length - 1];
      if (last?.area === f.area) last.rows.push(row);
      else out.push({ area: f.area, rows: [row] });
    }
    return out;
  });
  protected readonly accessSum = computed(() => {
    const l = Object.values(this.access.levels());
    return { rw: l.filter((x) => x === 'RW').length, r: l.filter((x) => x === 'R').length, total: l.length };
  });
  protected readonly roleNames = computed(() => this.me().roles.map((r) => r.name).join(', '));

  // ── Details ────────────────────────────────────────────────
  /** The saved phone split into the country code (from the portal's list) and the number. */
  private readonly savedPhone = computed(() => splitPhone(this.me().phone, this.store.countries.map((c) => c.dial)));
  protected readonly dials = computed(() => [...new Set([...this.store.countries.map((c) => c.dial), this.savedPhone().dial])]);
  protected readonly name = linkedSignal(() => this.me().name);
  protected readonly dial = linkedSignal(() => this.savedPhone().dial);
  protected readonly phone = linkedSignal(() => this.savedPhone().number);
  protected readonly detailsTried = signal(false);
  protected readonly detailsSaving = signal(false);
  protected readonly detailsServer = signal<{ name?: string; phone?: string; form?: string }>({});

  protected readonly detailErrors = computed(() => {
    const e: { name?: string; phone?: string } = {};
    if (!this.name().trim()) e.name = 'Enter your name.';
    else if (this.name().trim().length > 120) e.name = 'Keep your name under 120 characters.';
    const n = this.phone().trim();
    if (!n) e.phone = 'Enter your mobile number.';
    else if (!NUMBER_RE.test(n) || n.replace(/\D/g, '').length < 6 || n.replace(/\D/g, '').length > 15) {
      e.phone = 'Use 6 to 15 digits, without the country code.';
    }
    return { ...e, ...this.detailsServer() };
  });
  protected readonly detailsDirty = computed(
    () => this.name().trim() !== this.me().name || this.dial() !== this.savedPhone().dial || this.phone().trim() !== this.savedPhone().number,
  );

  protected async saveDetails() {
    this.detailsTried.set(true);
    this.detailsServer.set({});
    const { name, phone } = this.detailErrors();
    if (name || phone || !this.detailsDirty() || this.detailsSaving()) return;
    this.detailsSaving.set(true);
    try {
      await this.auth.updateMe({ full_name: this.name().trim(), phone: `${this.dial()} ${this.phone().trim()}` });
      this.detailsTried.set(false);
      this.toast.show('Profile saved');
    } catch (err) {
      const e = err instanceof ApiError ? err : null;
      this.detailsServer.set({ name: e?.field('full_name'), phone: e?.field('phone'), form: e?.fieldErrors && Object.keys(e.fieldErrors).length ? undefined : errorText(err) });
    } finally {
      this.detailsSaving.set(false);
    }
  }
  protected discardDetails() {
    this.name.set(this.me().name);
    this.dial.set(this.savedPhone().dial);
    this.phone.set(this.savedPhone().number);
    this.detailsTried.set(false);
    this.detailsServer.set({});
  }

  protected readonly initials = computed(() =>
    this.me()
      .name.split(' ')
      .filter(Boolean)
      .map((w) => w[0])
      .slice(0, 2)
      .join(''),
  );

  // ── Password ───────────────────────────────────────────────
  protected readonly current = signal('');
  protected readonly next = signal('');
  protected readonly confirm = signal('');
  protected readonly show = signal(false);
  protected readonly pwTried = signal(false);
  protected readonly pwSaving = signal(false);
  protected readonly pwError = signal<{ message: string; list: string[]; current: boolean } | null>(null);
  protected readonly policy = computed(() => this.store.settings().password);
  protected readonly expiresAt = computed(() => this.auth.user()?.password_expires_at ?? null);

  protected readonly rules = computed<Rule[]>(() => {
    const p = this.policy();
    const v = this.next();
    return [
      { id: 'len', label: `At least ${p.minLength} characters`, ok: v.length >= p.minLength },
      ...(p.requireNumber ? [{ id: 'num', label: 'A number', ok: /\d/.test(v) }] : []),
      ...(p.requireSymbol ? [{ id: 'sym', label: 'A symbol, such as ! or #', ok: /[^A-Za-z0-9\s]/.test(v) }] : []),
      { id: 'diff', label: 'Different from your current password', ok: !!v && v !== this.current() },
      { id: 'match', label: 'Both new passwords match', ok: !!v && v === this.confirm() },
    ];
  });
  protected readonly passed = computed(() => this.rules().filter((r) => r.ok).length);
  protected readonly canChange = computed(() => !!this.current() && this.passed() === this.rules().length);

  protected async changePassword() {
    this.pwTried.set(true);
    this.pwError.set(null);
    if (!this.canChange() || this.pwSaving()) return;
    this.pwSaving.set(true);
    try {
      await this.auth.changePassword(this.current(), this.next(), this.confirm());
      this.current.set('');
      this.next.set('');
      this.confirm.set('');
      this.show.set(false);
      this.pwTried.set(false);
      // password_changed_at / password_expires_at moved on.
      this.auth.loadMe().catch(() => undefined);
      const days = this.policy().expiryDays;
      this.toast.show('Password changed', {
        body: `Your other sessions were signed out.${days ? ` You'll be asked to change it again in ${days} days.` : ''}`,
      });
    } catch (err) {
      const e = err instanceof AuthError ? err : null;
      const raw = e?.data?.['errors'];
      this.pwError.set({
        message: e?.httpStatus === 423 ? lockMessage(e) : errorText(err),
        list: e?.code === AuthCode.PasswordWeak && Array.isArray(raw) ? raw.map(String) : [],
        current: e?.code === AuthCode.WrongCurrentPassword,
      });
    } finally {
      this.pwSaving.set(false);
    }
  }
}

/** "+974 5512 3456" → { dial: '+974', number: '5512 3456' }, matching the longest known code. */
export function splitPhone(phone: string, dials: string[]): { dial: string; number: string } {
  const p = (phone ?? '').trim();
  const known = [...dials].sort((a, b) => b.length - a.length).find((d) => p.startsWith(d));
  if (known) return { dial: known, number: p.slice(known.length).trim() };
  const m = /^(\+\d{1,4})\s+(.*)$/.exec(p);
  if (m) return { dial: m[1], number: m[2] };
  return { dial: dials[0] ?? '+971', number: p };
}

function lockMessage(e: AuthError): string {
  const until = new Date(String(e.data?.['locked_until'] ?? ''));
  if (isNaN(until.getTime())) return e.message;
  return `Too many wrong passwords. Try again at ${until.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}.`;
}
