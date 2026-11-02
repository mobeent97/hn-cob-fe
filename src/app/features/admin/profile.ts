import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal, signal } from '@angular/core';
import { Store } from '../../core/data/store';
import { Access } from '../../core/access/access';
import { FEATURES, FeatureDef } from '../../core/access/features';
import { Permission } from '../../core/data/models';
import { RelativePipe } from '../../core/data/format';
import { Icon } from '../../shared/ui/icon';
import { Toaster } from '../../shared/ui/toast';
import { simulateLoad } from '../../shared/ui/loading';
import { Select, SelectOption } from '../../shared/ui/select';

type Rule = { id: string; label: string; ok: boolean };
type AccessRow = { f: FeatureDef; level: Permission; reason: string | null };

const RANK: Record<string, number> = { none: 0, R: 1, RW: 2 };
const rank = (p: Permission) => RANK[p ?? 'none'];
export const LEVEL_LABEL: Record<string, string> = { none: 'None', R: 'Read', RW: 'Read & write' };

/**
 * My profile — "Are my details right, what can I do here, and can I change my password safely?"
 * The "Organization & access" panel shows the effective level per feature (the lower of the
 * organization's plan and the user's best role) and why anything is lower than the role grants.
 * Legacy fixes: the phone keeps its own country code (no hard-coded 974 / 8 digits), every user can
 * edit their own name and phone (not only super admins), and the password rules come from Settings.
 */
@Component({
  selector: 'app-profile',
  imports: [Select, SelectOption, Icon, RelativePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './profile.html',
  styleUrl: './profile.scss',
})
export class Profile {
  protected readonly store = inject(Store);
  private readonly toast = inject(Toaster);
  protected readonly loading = simulateLoad('profile');
  protected readonly me = this.store.currentUser;
  protected readonly access = inject(Access);
  protected readonly org = this.store.currentOrg;
  protected readonly levelLabel = (p: Permission) => LEVEL_LABEL[p ?? 'none'];

  // ── Organization & access ──────────────────────────────────
  /** Every feature by area with the effective level and, when below the role, the reason. */
  protected readonly accessAreas = computed(() => {
    const levels = this.access.levels();
    const roles = this.access.roles();
    const partner = this.org().kind !== 'Platform';
    const su = this.access.isSuperuser();
    const out: { area: string; rows: AccessRow[] }[] = [];
    for (const f of FEATURES) {
      const level = levels[f.key] ?? null;
      const fromRoles = roles.reduce((best, r) => Math.max(best, rank(r.permissions[f.key] ?? null)), 0);
      let reason: string | null = null;
      if (!su && f.platformOnly && partner) reason = 'HyperNym only';
      else if (!su && rank(level) < fromRoles) reason = 'Capped by organization plan';
      const last = out[out.length - 1];
      const row = { f, level, reason };
      if (last?.area === f.area) last.rows.push(row);
      else out.push({ area: f.area, rows: [row] });
    }
    return out;
  });
  protected readonly accessSum = computed(() => {
    const l = Object.values(this.access.levels());
    return { rw: l.filter((x) => x === 'RW').length, r: l.filter((x) => x === 'R').length, total: l.length };
  });

  // ── Details ────────────────────────────────────────────────
  // The user model has no phone yet; kept here for the design phase (see report).
  private readonly savedPhone = signal({ dial: '+971', number: '50 412 7781' });
  protected readonly name = linkedSignal(() => this.me().name);
  protected readonly dial = linkedSignal(() => this.savedPhone().dial);
  protected readonly phone = linkedSignal(() => this.savedPhone().number);
  protected readonly detailsTried = signal(false);

  protected readonly detailErrors = computed(() => {
    const e: { name?: string; phone?: string } = {};
    if (!this.name().trim()) e.name = 'Enter your name.';
    const digits = this.phone().replace(/[\s-]/g, '');
    if (!digits) e.phone = 'Enter your mobile number.';
    else if (!/^\d{6,12}$/.test(digits)) e.phone = 'Use 6 to 12 digits, without the country code.';
    return e;
  });
  protected readonly detailsDirty = computed(
    () => this.name().trim() !== this.me().name || this.dial() !== this.savedPhone().dial || this.phone().trim() !== this.savedPhone().number,
  );

  protected saveDetails() {
    this.detailsTried.set(true);
    if (Object.keys(this.detailErrors()).length || !this.detailsDirty()) return;
    const u = { ...this.me(), name: this.name().trim() };
    this.store.saveUser(u);
    this.savedPhone.set({ dial: this.dial(), number: this.phone().trim() });
    this.detailsTried.set(false);
    this.toast.show('Profile saved');
  }
  protected discardDetails() {
    this.name.set(this.me().name);
    this.dial.set(this.savedPhone().dial);
    this.phone.set(this.savedPhone().number);
    this.detailsTried.set(false);
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
  protected readonly policy = computed(() => this.store.settings().password);

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

  protected changePassword() {
    this.pwTried.set(true);
    if (!this.canChange()) return;
    this.current.set('');
    this.next.set('');
    this.confirm.set('');
    this.show.set(false);
    this.pwTried.set(false);
    const days = this.policy().expiryDays;
    this.toast.show('Password changed', { body: days ? `You'll be asked to change it again in ${days} days.` : 'Other sessions were signed out.' });
  }
}
