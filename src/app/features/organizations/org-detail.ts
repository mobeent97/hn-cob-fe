import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { Store } from '../../core/data/store';
import { DatePipe, RelativePipe, DateTimePipe, TonePipe } from '../../core/data/format';
import { FEATURES } from '../../core/access/features';
import { Organization, Permission } from '../../core/data/models';
import { Icon } from '../../shared/ui/icon';
import { Menu, MenuItem } from '../../shared/ui/menu';
import { Dialog } from '../../shared/ui/dialog';
import { Tabs, TabItem } from '../../shared/ui/tabs';
import { Toaster } from '../../shared/ui/toast';
import { simulateLoad } from '../../shared/ui/loading';
import { CountUp } from '@iotility/shared-ui';
import {
  EMAIL_RE, FEATURES_BY_AREA, GRANTABLE, LEVELS, ORG_SWATCHES, PHONE_RE, addAdministrator, emailTaken, featureCount, levelLabel, orgTone, rank,
} from './org-util';
import { orgStats } from './org-stats';

type Tab = 'profile' | 'features' | 'limits' | 'people' | 'roles';
const TAB_IDS: Tab[] = ['profile', 'features', 'limits', 'people', 'roles'];

interface ProfileDraft {
  name: string;
  legalName: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  countries: string[];
  segments: ('B2B' | 'B2C')[];
  brandColour: string;
}

/** One organization: profile, entitlements, limits, people and roles. Shown in place of the list (?org=<id>). */
@Component({
  selector: 'app-org-detail',
  imports: [Icon, Menu, Dialog, Tabs, CountUp, DatePipe, DateTimePipe, RelativePipe, TonePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './org-detail.html',
  styleUrls: ['./org-shared.css', './org-detail.css'],
})
export class OrgDetail {
  protected readonly store = inject(Store);
  private readonly router = inject(Router);
  private readonly toast = inject(Toaster);
  protected readonly loading = simulateLoad('organization-detail');

  readonly orgId = input.required<number>();
  readonly tabParam = input<string | undefined>(undefined);
  readonly canWrite = input(false);
  readonly back = output<void>();
  readonly viewAs = output<Organization>();
  readonly resend = output<Organization>();
  readonly status = output<{ kind: 'suspend' | 'reactivate'; org: Organization }>();

  protected readonly org = computed(() => this.store.organizations().find((o) => o.id === this.orgId()) ?? null);
  protected readonly isPlatform = computed(() => this.org()?.kind === 'Platform');
  /** Entitlements and limits are editable for partners only, and only with RW on Organizations. */
  protected readonly editable = computed(() => this.canWrite() && !this.isPlatform());
  protected readonly stats = computed(() => orgStats(this.store).get(this.orgId())!);
  protected readonly orgTone = orgTone;
  protected readonly levels = LEVELS;
  protected readonly levelLabel = levelLabel;
  protected readonly areas = FEATURES_BY_AREA;
  protected readonly swatches = ORG_SWATCHES;
  protected readonly grantable = GRANTABLE.length;

  protected readonly tab = signal<Tab>('profile');

  constructor() {
    // A new organization (or ?tab=) resets the view and every staged change.
    effect(() => {
      this.orgId();
      const t = this.tabParam() as Tab | undefined;
      untracked(() => {
        this.tab.set(t && TAB_IDS.includes(t) ? t : 'profile');
        this.featDraft.set({});
        this.resetLimits();
      });
    });
  }

  protected readonly members = computed(() =>
    this.store.allUsers().filter((u) => u.orgId === this.orgId()).sort((a, b) => Number(b.isSuperuser) - Number(a.isSuperuser) || a.name.localeCompare(b.name)),
  );
  protected readonly roles = computed(() => {
    const users = this.members();
    return this.store.groups
      .all()
      .filter((g) => g.orgId === this.orgId())
      .map((g) => {
        // Effective permissions: a role never exceeds the organization's entitlement.
        const ent = this.org()?.features ?? {};
        const vals = FEATURES.map((f) => {
          const p = g.permissions[f.key] ?? null;
          const e = ent[f.key] ?? null;
          return rank(p) <= rank(e) ? p : e;
        });
        return {
          ...g,
          members: users.filter((u) => u.groups.includes(g.name)).length,
          rw: vals.filter((v) => v === 'RW').length,
          r: vals.filter((v) => v === 'R').length,
        };
      });
  });

  protected readonly tabs = computed<TabItem<Tab>[]>(() => [
    { id: 'profile', label: 'Profile' },
    { id: 'features', label: 'Features', count: this.org() ? featureCount(this.org()!).on : 0 },
    { id: 'limits', label: 'Limits & usage' },
    { id: 'people', label: 'People', count: this.members().length },
    { id: 'roles', label: 'Roles', count: this.roles().length },
  ]);

  protected readonly featureTotal = computed(() => (this.org() ? featureCount(this.org()!) : { on: 0, of: 0 }));

  protected countryNames(codes: string[]) {
    return codes.map((c) => this.store.countries.find((x) => x.code === c)?.name ?? c).join(', ');
  }
  protected readonly admin = computed(() => this.members().find((u) => u.groups.includes('Organization admin')) ?? null);

  protected readonly menu = computed<MenuItem[]>(() => {
    const o = this.org();
    if (!o || !this.canWrite() || o.kind === 'Platform') return [];
    const items: MenuItem[] = [];
    if (o.status === 'Invited') items.push({ label: 'Resend invitation', icon: 'send', run: () => this.resend.emit(o) });
    items.push(
      o.status === 'Suspended'
        ? { label: 'Reactivate', icon: 'play', run: () => this.status.emit({ kind: 'reactivate', org: o }) }
        : { label: 'Suspend', icon: 'pause', danger: true, run: () => this.status.emit({ kind: 'suspend', org: o }) },
    );
    return items;
  });

  // ── Profile ────────────────────────────────────────────────
  protected readonly editOpen = signal(false);
  protected readonly profile = signal<ProfileDraft>(this.blankProfile());
  protected readonly profileTried = signal(false);

  private blankProfile(): ProfileDraft {
    return { name: '', legalName: '', contactName: '', contactEmail: '', contactPhone: '', countries: [], segments: [], brandColour: ORG_SWATCHES[0] };
  }
  protected editProfile() {
    const o = this.org()!;
    this.profile.set({
      name: o.name, legalName: o.legalName, contactName: o.contact.name, contactEmail: o.contact.email, contactPhone: o.contact.phone,
      countries: [...o.countries], segments: [...o.segments], brandColour: o.brandColour,
    });
    this.profileTried.set(false);
    this.editOpen.set(true);
  }
  protected setP<K extends keyof ProfileDraft>(k: K, v: ProfileDraft[K]) {
    this.profile.update((p) => ({ ...p, [k]: v }));
  }
  protected toggleIn<K extends 'countries' | 'segments'>(k: K, v: ProfileDraft[K][number], on: boolean) {
    this.profile.update((p) => {
      const list = (p[k] as string[]).filter((x) => x !== v);
      return { ...p, [k]: on ? [...list, v] : list };
    });
  }
  protected readonly profileErrors = computed(() => {
    const p = this.profile();
    const e: Partial<Record<keyof ProfileDraft, string>> = {};
    if (!p.name.trim()) e.name = 'Enter the organization’s name.';
    else if (this.store.organizations().some((o) => o.id !== this.orgId() && o.name.toLowerCase() === p.name.trim().toLowerCase())) e.name = 'Another organization already has this name.';
    if (!p.legalName.trim()) e.legalName = 'Enter the registered legal name.';
    if (!p.contactName.trim()) e.contactName = 'Enter who we contact about this organization.';
    if (!EMAIL_RE.test(p.contactEmail.trim())) e.contactEmail = 'Enter an email like name@company.com.';
    if (!PHONE_RE.test(p.contactPhone.trim())) e.contactPhone = 'Enter the number with its country code, like +974 4400 1234.';
    if (!p.countries.length) e.countries = 'Choose at least one country.';
    if (!p.segments.length) e.segments = 'Choose at least one segment.';
    return e;
  });
  protected readonly dropsConsumers = computed(() => {
    const o = this.org();
    return !!o && !this.isPlatform() && !this.profile().segments.includes('B2C') && !!o.features['Consumers'];
  });
  protected saveProfile() {
    this.profileTried.set(true);
    if (Object.keys(this.profileErrors()).length) return;
    const o = this.org()!;
    const p = this.profile();
    const features = this.dropsConsumers() ? { ...o.features, Consumers: null } : o.features;
    this.store.saveOrganization({
      ...o, features, name: p.name.trim(), legalName: p.legalName.trim(), countries: p.countries, segments: p.segments, brandColour: p.brandColour,
      contact: { name: p.contactName.trim(), email: p.contactEmail.trim(), phone: p.contactPhone.trim() },
    });
    this.editOpen.set(false);
    this.toast.show('Profile saved', { body: `${p.name.trim()} is up to date.` });
  }

  // ── Features (entitlements) ────────────────────────────────
  /** Staged changes only: feature key → new level. */
  protected readonly featDraft = signal<Record<string, Permission>>({});
  protected level(key: string): Permission {
    const d = this.featDraft();
    return key in d ? d[key] : this.org()?.features[key] ?? null;
  }
  protected isStaged(key: string) {
    return key in this.featDraft();
  }
  protected setLevel(key: string, l: Permission) {
    const orig = this.org()?.features[key] ?? null;
    this.featDraft.update((d) => {
      const n = { ...d };
      if (l === orig) delete n[key];
      else n[key] = l;
      return n;
    });
  }
  protected readonly stagedCount = computed(() => Object.keys(this.featDraft()).length);
  protected readonly enabledCount = computed(() => FEATURES.filter((f) => !!this.level(f.key)).length);

  /** Users who hold a role above the new level for this feature: they lose access when it is saved. */
  private affected(key: string, l: Permission) {
    const over = new Set(this.roles().filter((r) => r.status === 'Active' && rank(r.permissions[key] ?? null) > rank(l)).map((r) => r.name));
    return this.members().filter((u) => u.groups.some((g) => over.has(g)));
  }
  protected readonly impacts = computed(() => {
    const out: Record<string, string> = {};
    for (const [key, l] of Object.entries(this.featDraft())) {
      const f = FEATURES.find((x) => x.key === key)!;
      const before = this.org()?.features[key] ?? null;
      if (rank(l) < rank(before)) {
        const n = this.affected(key, l).length;
        const who = `${n} ${n === 1 ? 'user' : 'users'}`;
        out[key] = !n
          ? `No one here loses access: no role goes beyond ${l ? 'Read' : 'none'}.`
          : l
            ? `Lowering ${f.label} to Read affects ${who} in roles that have Read & write.`
            : `Removing ${f.label} affects ${who} in roles that can open it.`;
      } else {
        out[key] = `Roles here can now be given ${levelLabel(l)} on ${f.label}. No one gains access until a role grants it.`;
      }
    }
    return out;
  });
  protected readonly affectedTotal = computed(() => {
    const ids = new Set<number>();
    for (const [key, l] of Object.entries(this.featDraft())) for (const u of this.affected(key, l)) ids.add(u.id);
    return ids.size;
  });
  protected discardFeatures() {
    this.featDraft.set({});
  }
  protected saveFeatures() {
    const o = this.org()!;
    const n = this.stagedCount();
    const affected = this.affectedTotal();
    this.store.saveOrganization({ ...o, features: { ...o.features, ...this.featDraft() } });
    this.featDraft.set({});
    this.toast.show(`Entitlements saved for ${o.name}`, {
      body: `${n} ${n === 1 ? 'change' : 'changes'}${affected ? ` · ${affected} ${affected === 1 ? 'user has' : 'users have'} less access from now` : ''}.`,
      action: { label: 'Undo', run: () => this.store.saveOrganization({ ...this.org()!, features: o.features }) },
    });
  }

  // ── Limits ─────────────────────────────────────────────────
  protected readonly maxCustomers = signal('');
  protected readonly maxUsers = signal('');
  private resetLimits() {
    const o = this.org();
    this.maxCustomers.set(o?.limits.maxCustomers != null ? String(o.limits.maxCustomers) : '');
    this.maxUsers.set(o?.limits.maxUsers != null ? String(o.limits.maxUsers) : '');
  }
  private parse(v: string): number | null | 'bad' {
    const t = v.trim();
    if (!t) return null;
    return /^\d+$/.test(t) && +t > 0 ? +t : 'bad';
  }
  protected readonly limitErrors = computed(() => ({
    customers: this.parse(this.maxCustomers()) === 'bad' ? 'Enter a whole number above 0, or leave it empty for no limit.' : '',
    users: this.parse(this.maxUsers()) === 'bad' ? 'Enter a whole number above 0, or leave it empty for no limit.' : '',
  }));
  protected readonly limitDraft = computed(() => {
    const c = this.parse(this.maxCustomers());
    const u = this.parse(this.maxUsers());
    return { maxCustomers: c === 'bad' ? null : c, maxUsers: u === 'bad' ? null : u };
  });
  protected readonly limitsChanged = computed(() => {
    const o = this.org();
    const d = this.limitDraft();
    return !!o && (d.maxCustomers !== o.limits.maxCustomers || d.maxUsers !== o.limits.maxUsers);
  });
  protected readonly limitsValid = computed(() => !this.limitErrors().customers && !this.limitErrors().users);
  protected pct(n: number, max: number | null) {
    return max ? Math.min(100, (n / max) * 100) : 0;
  }
  protected saveLimits() {
    if (!this.limitsValid()) return;
    const o = this.org()!;
    this.store.saveOrganization({ ...o, limits: this.limitDraft() });
    this.toast.show('Limits saved', { body: `${o.name}: ${this.limitText(this.limitDraft().maxCustomers)} customers, ${this.limitText(this.limitDraft().maxUsers)} users.` });
  }
  protected limitText(n: number | null) {
    return n == null ? 'unlimited' : `up to ${n}`;
  }
  protected cancelLimits() {
    this.resetLimits();
  }

  // ── People ─────────────────────────────────────────────────
  protected readonly inviteOpen = signal(false);
  protected readonly invite = signal({ name: '', email: '' });
  protected readonly inviteTried = signal(false);
  protected readonly atUserLimit = computed(() => {
    const max = this.org()?.limits.maxUsers;
    return max != null && this.members().length >= max;
  });
  protected openInvite() {
    this.invite.set({ name: '', email: '' });
    this.inviteTried.set(false);
    this.inviteOpen.set(true);
  }
  protected readonly inviteErrors = computed(() => {
    const v = this.invite();
    const e: { name?: string; email?: string } = {};
    if (!v.name.trim()) e.name = 'Enter their full name.';
    if (!EMAIL_RE.test(v.email.trim())) e.email = 'Enter an email like name@company.com.';
    else if (emailTaken(this.store, v.email)) e.email = 'Someone on the portal already uses this email.';
    return e;
  });
  protected sendInvite() {
    this.inviteTried.set(true);
    if (Object.keys(this.inviteErrors()).length) return;
    const u = addAdministrator(this.store, this.org()!, this.invite().name, this.invite().email);
    this.inviteOpen.set(false);
    this.toast.show(`Invitation sent to ${u.email}`, { body: `${u.name} joins ${this.org()!.name} as an Organization admin.` });
  }
  protected openStaff() {
    this.store.activeOrgId.set(this.orgId());
    this.router.navigate(['/users']);
  }

  // ── Roles ──────────────────────────────────────────────────
  protected openRoles() {
    this.store.activeOrgId.set(this.orgId());
    this.router.navigate(['/groups']);
  }
}
