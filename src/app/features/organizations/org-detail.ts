import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { Store } from '../../core/data/store';
import { Access } from '../../core/access/access';
import { DatePipe, RelativePipe, DateTimePipe, TonePipe } from '../../core/data/format';
import { FEATURES, FEATURE_KEYS } from '../../core/access/features';
import { AdminUser, Group, Organization, Permission } from '../../core/data/models';
import { EntitlementImpact, LogoCode, OrganizationsApi, fullFeatureMap } from '../../core/api/organizations.api';
import { UsersApi, UserCode } from '../../core/api/users.api';
import { RolesApi } from '../../core/api/roles.api';
import { ApiError, ApiCode, errorText } from '../../core/api/api-client';
import { SessionLoader } from '../../core/auth/session-loader';
import { Icon } from '../../shared/ui/icon';
import { Menu, MenuItem } from '../../shared/ui/menu';
import { Dialog } from '../../shared/ui/dialog';
import { Tabs, TabItem } from '../../shared/ui/tabs';
import { Toaster } from '../../shared/ui/toast';
import { LoadError, loadState } from '../../shared/ui/load-state';
import { CountUp, SpotlightBorder } from '@iotility/shared-ui';
import { EMAIL_RE, FEATURES_BY_AREA, GRANTABLE, LEVELS, ORG_SWATCHES, PHONE_RE, featureCount, levelLabel, orgTone, parseLimit, rank } from './org-util';
import { statsOf } from './org-stats';
import { OrgLogo } from '../../shared/ui/org-logo';
import { normalizeHex } from '../../core/theme/brand-scale';
import { BrandPreview } from './brand-preview';
import { LOGO_ACCEPT, LOGO_HINT, checkLogoFile } from './logo-file';

type Tab = 'profile' | 'features' | 'limits' | 'people' | 'roles';
const TAB_IDS: Tab[] = ['profile', 'features', 'limits', 'people', 'roles'];
const LABEL = new Map(FEATURES.map((f) => [f.key, f.label]));

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
type ProfileErrors = Partial<Record<keyof ProfileDraft | 'form', string>>;

/**
 * One organization: profile, entitlements, limits, people and roles. Shown in place of the list (?org=<id>).
 * GET /organizations/{id}/; People is GET /users/?organization=<id> and Roles is GET /roles/?organization=<id>,
 * each loaded when its tab opens. Entitlement changes are staged, previewed by the server
 * (POST …/features/preview/) and saved as the full map, with Undo.
 */
@Component({
  selector: 'app-org-detail',
  imports: [Icon, Menu, Dialog, Tabs, CountUp, SpotlightBorder, DatePipe, DateTimePipe, RelativePipe, TonePipe, LoadError, OrgLogo, BrandPreview],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './org-detail.html',
  styleUrls: ['./org-shared.css', './org-detail.css'],
})
export class OrgDetail {
  protected readonly store = inject(Store);
  private readonly access = inject(Access);
  private readonly router = inject(Router);
  private readonly toast = inject(Toaster);
  private readonly api = inject(OrganizationsApi);
  private readonly usersApi = inject(UsersApi);
  private readonly rolesApi = inject(RolesApi);
  private readonly session = inject(SessionLoader);
  protected readonly state = loadState();
  protected readonly peopleState = loadState();
  protected readonly rolesState = loadState();

  readonly orgId = input.required<number>();
  readonly tabParam = input<string | undefined>(undefined);
  readonly canWrite = input(false);
  /** Bumped by the list after a status change made from here. */
  readonly version = input(0);
  readonly back = output<void>();
  readonly viewAs = output<Organization>();
  readonly resend = output<Organization>();
  readonly status = output<{ kind: 'suspend' | 'reactivate'; org: Organization }>();
  readonly remove = output<Organization>();

  protected readonly loaded = signal<Organization | null>(null);
  protected readonly notFound = signal(false);
  protected readonly org = computed(() => this.loaded());
  protected readonly isPlatform = computed(() => this.org()?.kind === 'Platform');
  /** Entitlements and limits are editable for partners only, and only with RW on Organizations. */
  protected readonly editable = computed(() => this.canWrite() && !this.isPlatform());
  protected readonly stats = computed(() => statsOf(this.org()));
  protected readonly orgTone = orgTone;
  protected readonly levels = LEVELS;
  protected readonly levelLabel = levelLabel;
  protected readonly areas = FEATURES_BY_AREA;
  protected readonly swatches = ORG_SWATCHES;
  protected readonly grantable = GRANTABLE.length;
  protected readonly canSeeUsers = computed(() => this.access.can('Users', 'R'));
  protected readonly canSeeRoles = computed(() => this.access.can('Roles', 'R'));

  protected readonly tab = signal<Tab>('profile');
  protected readonly members = signal<AdminUser[]>([]);
  protected readonly roles = signal<Group[]>([]);
  private peopleFor = 0;
  private rolesFor = 0;

  constructor() {
    // A new organization (or ?tab=) resets the view and every staged change.
    effect(() => {
      const id = this.orgId();
      this.version();
      const t = this.tabParam() as Tab | undefined;
      untracked(() => {
        this.tab.set(t && TAB_IDS.includes(t) ? t : 'profile');
        this.featDraft.set({});
        this.impact.set(null);
        this.peopleFor = 0;
        this.rolesFor = 0;
        void this.load(id);
      });
    });
    // People and Roles load the first time their tab opens.
    effect(() => {
      const t = this.tab();
      const o = this.org();
      if (!o) return;
      untracked(() => {
        if (t === 'people' && this.peopleFor !== o.id) void this.loadPeople();
        if (t === 'roles' && this.rolesFor !== o.id) void this.loadRoles();
      });
    });
    inject(DestroyRef).onDestroy(() => clearTimeout(this.previewTimer));
  }

  protected async load(id = this.orgId()) {
    this.notFound.set(false);
    try {
      const o = await this.state.run(async () => {
        try {
          return await this.api.get(id);
        } catch (err) {
          if (err instanceof ApiError && err.code === ApiCode.NotFound) {
            this.notFound.set(true);
            return null;
          }
          throw err;
        }
      });
      if (o) {
        this.loaded.set(o);
        this.store.saveOrganization(o);
        this.resetLimits();
      } else if (this.notFound()) {
        this.loaded.set(null);
      }
    } catch {
      /* shown by state.error() */
    }
  }

  protected async loadPeople() {
    const o = this.org();
    if (!o || !this.canSeeUsers()) return;
    this.peopleFor = o.id;
    const res = await this.peopleState.run(() => this.usersApi.list({ organization: o.id, limit: 100 }));
    if (res) this.members.set([...res.rows].sort((a, b) => Number(b.isSuperuser) - Number(a.isSuperuser) || a.name.localeCompare(b.name)));
  }
  protected async loadRoles() {
    const o = this.org();
    if (!o || !this.canSeeRoles()) return;
    this.rolesFor = o.id;
    const res = await this.rolesState.run(() => this.rolesApi.list({ organization: o.id, include_templates: false, limit: 100 }));
    if (res) this.roles.set(res.rows);
  }

  protected readonly tabs = computed<TabItem<Tab>[]>(() => {
    const s = this.stats();
    return [
      { id: 'profile', label: 'Profile' },
      { id: 'features', label: 'Features', count: this.org() ? featureCount(this.org()!).on : 0 },
      { id: 'limits', label: 'Limits & usage' },
      { id: 'people', label: 'People', count: s.users },
      { id: 'roles', label: 'Roles', count: s.roles },
    ];
  });

  protected readonly featureTotal = computed(() => (this.org() ? featureCount(this.org()!) : { on: 0, of: 0 }));

  protected countryNames(codes: string[]) {
    return codes.map((c) => this.store.countries.find((x) => x.code === c)?.name ?? c).join(', ');
  }
  /** The first user holding a role copied from the org-admin template (server-computed). */
  protected readonly admin = computed(() => this.org()?.admin ?? null);
  protected roleNames(u: AdminUser) {
    return u.roles.map((r) => r.name).join(', ');
  }
  protected roleSum(g: Group) {
    const p = g.effectivePermissions ?? g.permissions;
    const vals = Object.values(p);
    return { rw: vals.filter((v) => v === 'RW').length, r: vals.filter((v) => v === 'R').length };
  }

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
    if (o.status !== 'Active') items.push({ label: 'Delete…', icon: 'trash', danger: true, run: () => this.remove.emit(o) });
    return items;
  });

  // ── Profile ────────────────────────────────────────────────
  protected readonly editOpen = signal(false);
  protected readonly profile = signal<ProfileDraft>(this.blankProfile());
  protected readonly profileTried = signal(false);
  protected readonly profileSaving = signal(false);
  private readonly profileServer = signal<ProfileErrors>({});

  private blankProfile(): ProfileDraft {
    return { name: '', legalName: '', contactName: '', contactEmail: '', contactPhone: '', countries: [], segments: [], brandColour: ORG_SWATCHES[0] };
  }
  protected editProfile() {
    const o = this.org()!;
    this.profile.set({
      name: o.name, legalName: o.legalName, contactName: o.contact.name, contactEmail: o.contact.email, contactPhone: o.contact.phone,
      countries: [...o.countries], segments: [...o.segments], brandColour: o.brandColour || ORG_SWATCHES[0],
    });
    this.profileTried.set(false);
    this.profileServer.set({});
    this.editOpen.set(true);
  }
  protected setP<K extends keyof ProfileDraft>(k: K, v: ProfileDraft[K]) {
    this.profile.update((p) => ({ ...p, [k]: v }));
    this.profileServer.set({});
  }
  protected toggleIn<K extends 'countries' | 'segments'>(k: K, v: ProfileDraft[K][number], on: boolean) {
    this.profile.update((p) => {
      const list = (p[k] as string[]).filter((x) => x !== v);
      return { ...p, [k]: on ? [...list, v] : list };
    });
    this.profileServer.set({});
  }
  protected readonly profileErrors = computed<ProfileErrors>(() => {
    const p = this.profile();
    const e: ProfileErrors = {};
    if (!p.name.trim()) e.name = 'Enter the organization’s name.';
    else if (p.name.trim().length > 150) e.name = 'Keep the name under 150 characters.';
    if (!p.legalName.trim()) e.legalName = 'Enter the registered legal name.';
    if (!p.contactName.trim()) e.contactName = 'Enter who we contact about this organization.';
    if (!EMAIL_RE.test(p.contactEmail.trim())) e.contactEmail = 'Enter an email like name@company.com.';
    if (!PHONE_RE.test(p.contactPhone.trim())) e.contactPhone = 'Enter the number with its country code, like +974 4400 1234.';
    if (!p.countries.length) e.countries = 'Choose at least one country.';
    if (!p.segments.length) e.segments = 'Choose at least one segment.';
    if (!normalizeHex(p.brandColour)) e.brandColour = 'Enter a colour as # and six hex digits, like #a81c26.';
    return { ...e, ...this.profileServer() };
  });
  /** The draft colour when it is a valid `#rrggbb` (lower-case), for the colour well and the preview. */
  protected readonly validColour = computed(() => normalizeHex(this.profile().brandColour));
  /** A colour that isn't one of the presets gets its own checked swatch. */
  protected readonly customColour = computed(() => {
    const c = this.validColour();
    return c && !ORG_SWATCHES.includes(c) ? c : null;
  });
  protected readonly dropsConsumers = computed(() => {
    const o = this.org();
    return !!o && !this.isPlatform() && !this.profile().segments.includes('B2C') && !!o.features['Consumers'];
  });
  protected async saveProfile() {
    this.profileTried.set(true);
    this.profileServer.set({});
    if (Object.keys(this.profileErrors()).length || this.profileSaving()) return;
    const o = this.org()!;
    const p = this.profile();
    this.profileSaving.set(true);
    try {
      const { org, removedFeatures } = await this.api.update(o.id, {
        name: p.name.trim(), legal_name: p.legalName.trim(), countries: p.countries, segments: p.segments,
        brand_colour: normalizeHex(p.brandColour) ?? p.brandColour,
        contact: { name: p.contactName.trim(), email: p.contactEmail.trim(), phone: p.contactPhone.trim() },
      });
      this.loaded.set(org);
      this.store.saveOrganization(org);
      this.editOpen.set(false);
      const removed = removedFeatures.map((k) => LABEL.get(k) ?? k);
      this.toast.show('Profile saved', { body: removed.length ? `${removed.join(', ')} turned off: it needs the B2C segment.` : `${org.name} is up to date.` });
    } catch (err) {
      const e = err instanceof ApiError ? err : null;
      const f = e?.fieldErrors ?? {};
      const out: ProfileErrors = {};
      if (f['name'] || e?.code === 4302) out.name = f['name']?.[0] ?? e!.message;
      if (f['legal_name']) out.legalName = f['legal_name'][0];
      if (f['countries']) out.countries = f['countries'][0];
      if (f['segments']) out.segments = f['segments'][0];
      if (f['brand_colour']) out.brandColour = f['brand_colour'][0];
      if (f['contact.email'] ?? f['contact']) out.contactEmail = (f['contact.email'] ?? f['contact'])[0];
      if (f['contact.phone']) out.contactPhone = f['contact.phone'][0];
      if (f['contact.name']) out.contactName = f['contact.name'][0];
      if (!Object.keys(out).length) out.form = errorText(err);
      this.profileServer.set(out);
    } finally {
      this.profileSaving.set(false);
    }
  }

  // ── Logo (POST / DELETE /organizations/{id}/logo/) ──────────
  protected readonly logoAccept = LOGO_ACCEPT;
  protected readonly logoHint = LOGO_HINT;
  protected readonly logoBusy = signal<'upload' | 'remove' | null>(null);
  protected readonly logoError = signal('');
  protected readonly removeLogoOpen = signal(false);

  /** Checks the file as the server will (type, size, frames, pixels), then uploads it. */
  protected async pickLogo(ev: Event) {
    const inputEl = ev.target as HTMLInputElement;
    const file = inputEl.files?.[0];
    inputEl.value = ''; // picking the same file again still fires
    const o = this.org();
    if (!file || !o || this.logoBusy()) return;
    this.logoError.set('');
    const check = await checkLogoFile(file);
    if (!check.ok) {
      this.logoError.set(check.message);
      return;
    }
    this.logoBusy.set('upload');
    try {
      const org = await this.api.uploadLogo(o.id, file, `logo.${check.type === 'image/png' ? 'png' : 'jpg'}`);
      this.applyOrg(org);
      this.toast.show(o.logoUrl ? 'Logo replaced' : 'Logo saved', { body: `${org.name}’s users see it from their next page load.` });
    } catch (err) {
      // 4602–4605 (file), 4303 (platform), 4607 (storage), 403/404: the server's message says what to do.
      this.logoError.set(errorText(err));
    } finally {
      this.logoBusy.set(null);
    }
  }

  protected async removeLogo() {
    const o = this.org();
    if (!o || this.logoBusy()) return;
    this.logoBusy.set('remove');
    this.logoError.set('');
    try {
      this.applyOrg(await this.api.deleteLogo(o.id));
      this.removeLogoOpen.set(false);
      this.toast.show('Logo removed', { body: `${o.name} shows its initials instead.` });
    } catch (err) {
      this.removeLogoOpen.set(false);
      if (err instanceof ApiError && err.code === LogoCode.NoLogo) {
        // Someone else removed it first: show the current state.
        this.applyOrg({ ...o, logoUrl: null });
        return;
      }
      this.logoError.set(errorText(err));
    } finally {
      this.logoBusy.set(null);
    }
  }

  private applyOrg(org: Organization) {
    this.loaded.set(org);
    this.store.saveOrganization(org);
  }

  // ── Features (entitlements) ────────────────────────────────
  /** Staged changes only: feature key → new level. */
  protected readonly featDraft = signal<Record<string, Permission>>({});
  protected readonly impact = signal<EntitlementImpact | null>(null);
  protected readonly featSaving = signal(false);
  protected readonly featError = signal('');
  private previewTimer?: ReturnType<typeof setTimeout>;
  private previewSeq = 0;

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
    this.featError.set('');
    this.schedulePreview();
  }
  protected readonly stagedCount = computed(() => Object.keys(this.featDraft()).length);
  protected readonly enabledCount = computed(() => FEATURES.filter((f) => !!this.level(f.key)).length);

  private draftMap(): Record<string, Permission> {
    const o = this.org()!;
    return fullFeatureMap(FEATURE_KEYS, { ...o.features, ...this.featDraft() });
  }
  private schedulePreview() {
    clearTimeout(this.previewTimer);
    const o = this.org();
    if (!o || !this.stagedCount()) {
      this.impact.set(null);
      return;
    }
    this.previewTimer = setTimeout(async () => {
      const mine = ++this.previewSeq;
      try {
        const res = await this.api.previewFeatures(o.id, this.draftMap());
        if (mine === this.previewSeq) this.impact.set(res);
      } catch {
        if (mine === this.previewSeq) this.impact.set(null);
      }
    }, 300);
  }

  /** One line per staged feature, from the server's preview. */
  protected readonly impacts = computed(() => {
    const out: Record<string, { text: string; down: boolean }> = {};
    const changes = new Map((this.impact()?.changes ?? []).map((c) => [c.feature, c]));
    for (const [key, l] of Object.entries(this.featDraft())) {
      const label = LABEL.get(key) ?? key;
      const before = this.org()?.features[key] ?? null;
      const down = rank(l) < rank(before);
      const c = changes.get(key);
      if (!down) {
        out[key] = { text: `Roles here can now be given ${levelLabel(l)} on ${label}. No one gains access until a role grants it.`, down };
      } else if (!c) {
        out[key] = { text: `Checking who this affects…`, down };
      } else {
        const n = c.affected_users;
        const who = `${n} ${n === 1 ? 'user' : 'users'}`;
        out[key] = {
          text: !n ? `No one here loses access: no role goes beyond ${l ? 'Read' : 'none'}.` : l ? `Lowering ${label} to Read affects ${who}.` : `Removing ${label} affects ${who}.`,
          down,
        };
      }
    }
    return out;
  });
  protected readonly affectedTotal = computed(() => this.impact()?.affected_total ?? 0);
  protected discardFeatures() {
    clearTimeout(this.previewTimer);
    this.featDraft.set({});
    this.impact.set(null);
    this.featError.set('');
  }
  protected async saveFeatures(map = this.draftMap(), undo = false) {
    const o = this.org()!;
    const before = fullFeatureMap(FEATURE_KEYS, o.features);
    const n = this.stagedCount();
    this.featSaving.set(true);
    this.featError.set('');
    try {
      const { org, impact } = await this.api.setFeatures(o.id, map);
      this.loaded.set(org);
      this.store.saveOrganization(org);
      this.discardFeatures();
      void this.session.refreshOrganizations();
      void this.session.refreshAccess();
      if (this.rolesFor === o.id) void this.loadRoles();
      if (undo) return;
      const less = impact.affected_total;
      this.toast.show(`Entitlements saved for ${o.name}`, {
        body: `${n} ${n === 1 ? 'change' : 'changes'}${less ? ` · ${less} ${less === 1 ? 'user has' : 'users have'} less access from now` : ''}.`,
        action: { label: 'Undo', run: () => void this.saveFeatures(before, true) },
      });
    } catch (err) {
      this.featError.set(errorText(err));
    } finally {
      this.featSaving.set(false);
    }
  }

  // ── Limits ─────────────────────────────────────────────────
  protected readonly maxCustomers = signal('');
  protected readonly maxUsers = signal('');
  protected readonly limitsSaving = signal(false);
  protected readonly limitsError = signal('');
  private resetLimits() {
    const o = this.org();
    this.maxCustomers.set(o?.limits.maxCustomers != null ? String(o.limits.maxCustomers) : '');
    this.maxUsers.set(o?.limits.maxUsers != null ? String(o.limits.maxUsers) : '');
    this.limitsError.set('');
  }
  protected readonly limitErrors = computed(() => ({
    customers: parseLimit(this.maxCustomers()) === 'bad' ? 'Enter a whole number above 0, or leave it empty for no limit.' : '',
    users: parseLimit(this.maxUsers()) === 'bad' ? 'Enter a whole number above 0, or leave it empty for no limit.' : '',
  }));
  protected readonly limitDraft = computed(() => {
    const c = parseLimit(this.maxCustomers());
    const u = parseLimit(this.maxUsers());
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
  protected async saveLimits() {
    if (!this.limitsValid() || this.limitsSaving()) return;
    const o = this.org()!;
    const d = this.limitDraft();
    this.limitsSaving.set(true);
    this.limitsError.set('');
    try {
      const { org, overLimit } = await this.api.setLimits(o.id, { max_customers: d.maxCustomers, max_users: d.maxUsers });
      this.loaded.set(org);
      this.store.saveOrganization(org);
      this.resetLimits();
      const over = overLimit.length ? ` Already above the new limit on ${overLimit.join(' and ')}: nobody is removed, but nothing new can be added.` : '';
      this.toast.show('Limits saved', { body: `${o.name}: ${this.limitText(d.maxCustomers)} customers, ${this.limitText(d.maxUsers)} users.${over}` });
    } catch (err) {
      this.limitsError.set(errorText(err));
    } finally {
      this.limitsSaving.set(false);
    }
  }
  protected limitText(n: number | null) {
    return n == null ? 'unlimited' : `up to ${n}`;
  }
  protected cancelLimits() {
    this.resetLimits();
  }

  // ── People ─────────────────────────────────────────────────
  protected readonly inviteOpen = signal(false);
  protected readonly invite = signal({ name: '', email: '', phone: '' });
  protected readonly inviteTried = signal(false);
  protected readonly inviteSaving = signal(false);
  private readonly inviteServer = signal<{ name?: string; email?: string; phone?: string; form?: string }>({});
  /** Active and invited users hold a seat. */
  protected readonly atUserLimit = computed(() => {
    const max = this.org()?.limits.maxUsers;
    return max != null && this.stats().seatsUsed >= max;
  });
  protected openInvite() {
    this.invite.set({ name: '', email: '', phone: '' });
    this.inviteTried.set(false);
    this.inviteServer.set({});
    this.inviteOpen.set(true);
  }
  protected setInvite(k: 'name' | 'email' | 'phone', v: string) {
    this.invite.update((x) => ({ ...x, [k]: v }));
    this.inviteServer.set({});
  }
  protected readonly inviteErrors = computed(() => {
    const v = this.invite();
    const e: { name?: string; email?: string; phone?: string; form?: string } = {};
    if (!v.name.trim()) e.name = 'Enter their full name.';
    if (!EMAIL_RE.test(v.email.trim())) e.email = 'Enter an email like name@company.com.';
    if (v.phone.trim() && !PHONE_RE.test(v.phone.trim())) e.phone = 'Include the country code, like +974 5512 3456.';
    return { ...e, ...this.inviteServer() };
  });
  protected async sendInvite() {
    this.inviteTried.set(true);
    this.inviteServer.set({});
    if (Object.keys(this.inviteErrors()).length || this.inviteSaving()) return;
    const o = this.org()!;
    const v = this.invite();
    this.inviteSaving.set(true);
    try {
      const u = await this.api.addAdministrator(o.id, {
        full_name: v.name.trim(), email: v.email.trim().toLowerCase(), ...(v.phone.trim() ? { phone: v.phone.trim() } : {}),
      });
      this.inviteOpen.set(false);
      this.toast.show(`Invitation sent to ${u.email}`, { body: `${u.name} joins ${o.name} as an Organization admin. The link works for 7 days.` });
      await this.load();
      void this.loadPeople();
    } catch (err) {
      const e = err instanceof ApiError ? err : null;
      this.inviteServer.set(
        e?.code === UserCode.EmailTaken
          ? { email: e.message }
          : e?.field('full_name') || e?.field('email') || e?.field('phone')
            ? { name: e.field('full_name'), email: e.field('email'), phone: e.field('phone') }
            : { form: errorText(err) },
      );
    } finally {
      this.inviteSaving.set(false);
    }
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
