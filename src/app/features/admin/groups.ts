import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { Store } from '../../core/data/store';
import { Access } from '../../core/access/access';
import { FEATURES, FeatureDef } from '../../core/access/features';
import { TonePipe } from '../../core/data/format';
import { Group, Organization, Permission } from '../../core/data/models';
import { RoleCode, RoleImpact, RolesApi } from '../../core/api/roles.api';
import { UsersApi } from '../../core/api/users.api';
import { ApiError, errorText } from '../../core/api/api-client';
import { SessionLoader } from '../../core/auth/session-loader';
import { Icon } from '../../shared/ui/icon';
import { Menu, MenuItem } from '../../shared/ui/menu';
import { Dialog } from '../../shared/ui/dialog';
import { Toaster } from '../../shared/ui/toast';
import { LoadError, loadState } from '../../shared/ui/load-state';

type Draft = { id: number | null; orgId: number | null; name: string; description: string; status: Group['status']; permissions: Record<string, Permission> };
type Row = Group & { sum: { rw: number; r: number; none: number }; tpl: boolean };
type Section = { key: string; heading: string | null; sub: string | null; rows: Row[] };
type Errors = { name?: string; description?: string; permissions?: string; form?: string };

export const PERMISSION_LABEL: Record<'none' | 'R' | 'RW', string> = { none: 'None', R: 'Read', RW: 'Read & write' };
const RANK: Record<string, number> = { none: 0, R: 1, RW: 2 };
const rank = (p: Permission) => RANK[p ?? 'none'];
const minP = (a: Permission, b: Permission): Permission => (rank(a) <= rank(b) ? a : b);
const LABEL = new Map(FEATURES.map((f) => [f.key, f.label]));

/** Counts by level. Compares each value exactly: the legacy `includes('R')` read RW as R. */
export function permissionSummary(p: Record<string, Permission>, features: string[]) {
  let rw = 0;
  let r = 0;
  for (const f of features) {
    if (p[f] === 'RW') rw++;
    else if (p[f] === 'R') r++;
  }
  return { rw, r, none: features.length - rw - r };
}

/**
 * Roles — "What can each role in this organization see and change, and who does that affect?"
 * GET /roles/ (sections per organization, then templates). A role belongs to one organization (orgId null
 * = a system template partners copy). Its permissions are capped by that organization's plan (the
 * organization's `features` from GET /organizations/options/); platform-only features never appear for
 * partner roles. The drawer previews who loses access (POST /roles/{id}/preview/) while editing.
 */
@Component({
  selector: 'app-groups',
  imports: [Icon, Menu, Dialog, TonePipe, LoadError],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './groups.html',
  styleUrl: './groups.css',
})
export class Groups {
  protected readonly store = inject(Store);
  protected readonly access = inject(Access);
  private readonly api = inject(RolesApi);
  private readonly users = inject(UsersApi);
  private readonly session = inject(SessionLoader);
  private readonly toast = inject(Toaster);
  protected readonly state = loadState();
  protected readonly levels: Permission[] = [null, 'R', 'RW'];
  protected readonly label = (p: Permission) => PERMISSION_LABEL[p ?? 'none'];

  protected readonly canWrite = computed(() => this.access.can('Roles', 'RW'));
  protected readonly platform = this.store.crossTenant;
  protected readonly allOrgs = computed(() => this.store.crossTenant() && this.store.scopeOrgId() == null);
  private readonly orgById = computed(() => new Map(this.store.organizations().map((o) => [o.id, o])));
  protected readonly writeOrg = computed(() => this.orgById().get(this.store.writeOrgId()) ?? this.store.currentOrg());
  /** "N users have no role" (GET /users/?no_role=true&limit=1 → count); null when unknown. */
  protected readonly noRole = signal<number | null>(null);

  /** The organization the list is narrowed to, when a platform user picked one in the switcher. */
  private readonly orgParam = computed(() => (this.store.crossTenant() ? this.store.scopeOrgId() : null));

  constructor() {
    effect(() => {
      const org = this.orgParam();
      untracked(() => void this.load(org));
    });
    inject(DestroyRef).onDestroy(() => clearTimeout(this.previewTimer));
  }

  protected async load(org = this.orgParam()) {
    const res = await this.state.run(() => this.api.list({ organization: org, limit: 100 }));
    if (res) this.store.groups.all.set(res.rows);
    if (this.access.can('Users', 'R')) {
      this.users.list({ no_role: true, organization: org, limit: 1 }).then(
        (r) => this.noRole.set(r.count),
        () => this.noRole.set(null),
      );
    }
  }

  /** Templates are edited by HyperNym only; partners copy them. */
  protected editable(g: Group) {
    return this.canWrite() && (g.orgId != null || this.platform());
  }

  // ── Features a role can hold, and the cap from its organization ──
  private orgOf(orgId: number | null): Organization | null {
    return orgId == null ? null : (this.orgById().get(orgId) ?? null);
  }
  /** Features shown for a role: platform-only ones are hidden unless the role is HyperNym's own. */
  protected featuresFor(orgId: number | null): FeatureDef[] {
    // Templates may hold platform-only features (they are dropped when a partner copies them).
    if (orgId == null) return this.platform() ? FEATURES : FEATURES.filter((f) => !f.platformOnly);
    const kind = this.orgOf(orgId)?.kind ?? (orgId === this.store.currentUser().orgId ? this.store.currentOrg().kind : 'Partner');
    return FEATURES.filter((f) => !f.platformOnly || kind === 'Platform');
  }
  /** The most the role's organization allows per feature (templates are uncapped). */
  protected capFor(orgId: number | null, key: string): Permission {
    const org = this.orgOf(orgId);
    if (!org) return 'RW';
    return org.kind === 'Platform' ? 'RW' : (org.features[key] ?? null);
  }
  /** Stored permissions clamped to what the role can really grant, with every feature listed. */
  private clamp(orgId: number | null, p: Record<string, Permission>) {
    const shown = new Set(this.featuresFor(orgId).map((f) => f.key));
    return Object.fromEntries(FEATURES.map((f) => [f.key, shown.has(f.key) ? minP(p[f.key] ?? null, this.capFor(orgId, f.key)) : null])) as Record<string, Permission>;
  }

  protected readonly rows = computed<Row[]>(() =>
    this.store.groups().map((g) => {
      const keys = this.featuresFor(g.orgId).map((f) => f.key);
      return { ...g, tpl: g.isTemplate || g.orgId == null, sum: permissionSummary(g.effectivePermissions ?? this.clamp(g.orgId, g.permissions), keys) };
    }),
  );

  /** One section per organization (all-organizations view), then templates. */
  protected readonly sections = computed<Section[]>(() => {
    const rows = this.rows();
    const out: Section[] = [];
    const own = rows.filter((r) => !r.tpl);
    const orgIds = [...new Set(own.map((r) => r.orgId!))];
    const known = this.store.organizations().map((o) => o.id);
    orgIds.sort((a, b) => (known.indexOf(a) + 1 || 1e6) - (known.indexOf(b) + 1 || 1e6));
    const multi = this.allOrgs();
    for (const id of orgIds) {
      const o = this.orgOf(id);
      const sectionRows = own.filter((r) => r.orgId === id).sort((a, b) => a.name.localeCompare(b.name));
      const name = o?.name ?? sectionRows[0]?.orgName ?? '';
      out.push({ key: 'o' + id, heading: multi ? name : null, sub: multi ? (o?.kind ?? 'Partner') : null, rows: sectionRows });
    }
    const templates = rows.filter((r) => r.tpl).sort((a, b) => a.name.localeCompare(b.name));
    if (templates.length) {
      out.push({
        key: 'templates',
        heading: 'Templates',
        sub: this.platform() ? 'Starting points every organization can copy' : `Starting points from HyperNym. Copy one to make it ${this.writeOrg().name}'s own.`,
        rows: templates,
      });
    }
    if (!multi && out.length && out[0].key !== 'templates') {
      out[0] = { ...out[0], heading: out.length > 1 ? `${this.orgOf(out[0].rows[0].orgId)?.name ?? out[0].rows[0].orgName} roles` : null };
    }
    return out;
  });

  protected readonly ownRoles = computed(() => this.rows().filter((r) => !r.tpl));
  protected readonly orgSections = computed(() => this.sections().filter((s) => s.key !== 'templates').length);
  protected readonly templateCount = computed(() => this.rows().filter((r) => r.tpl).length);

  protected menu(g: Row): MenuItem[] {
    const items: MenuItem[] = [];
    if (this.editable(g)) items.push({ label: 'Edit permissions', icon: 'shield', run: () => this.edit(g) });
    else items.push({ label: 'View permissions', icon: 'eye', run: () => this.edit(g) });
    if (g.tpl && this.canWrite()) {
      items.push({ label: `Copy to ${this.writeOrg().name}`, icon: 'copy', run: () => void this.copy(g) });
    }
    if (this.editable(g)) {
      const mine = this.myLastAdmin(g);
      items.push(
        g.status === 'Active'
          ? { label: mine ? 'Deactivate (your last admin role)' : 'Deactivate', icon: 'power', danger: true, disabled: mine, run: () => void this.setStatus(g, 'Inactive') }
          : { label: 'Activate', icon: 'power', run: () => void this.setStatus(g, 'Active') },
      );
      if (!g.tpl && g.members.total === 0) items.push({ label: 'Delete role…', icon: 'trash', danger: true, run: () => this.askDelete(g) });
    }
    return items;
  }

  /** True when this role is the only one giving the signed-in user Users/Roles read & write. */
  private myLastAdmin(g: Group) {
    const me = this.store.currentUser();
    const mine = new Set(me.roles.map((r) => r.id));
    if (me.isSuperuser || !mine.has(g.id)) return false;
    const grants = (x: Group) => x.status === 'Active' && (x.permissions['Users'] === 'RW' || x.permissions['Roles'] === 'RW');
    if (!grants(g)) return false;
    return !this.store.groups.all().some((r) => r.id !== g.id && mine.has(r.id) && grants(r));
  }

  private async setStatus(g: Group, status: Group['status'], undo = false) {
    try {
      await this.api.update(g.id, { status });
      await this.load();
      void this.session.refreshAccess();
      if (undo) return;
      const n = g.members.active;
      this.toast.show(`${g.name} ${status === 'Active' ? 'activated' : 'deactivated'}`, {
        body: status === 'Inactive' ? `${n} ${n === 1 ? 'member loses' : 'members lose'} the access it grants, straight away.` : undefined,
        action: { label: 'Undo', run: () => void this.setStatus(g, g.status, true) },
      });
    } catch (err) {
      this.toast.error(`Couldn't ${status === 'Active' ? 'activate' : 'deactivate'} ${g.name}`, errorText(err));
    }
  }

  /** Copy a template into the organization being worked in; the server caps it to the plan and names it. */
  protected async copy(t: Group) {
    const target = this.writeOrg();
    try {
      // Only a platform user who picked an organization in the switcher names one.
      const org = this.orgParam();
      const g = await this.api.copy(t.id, org != null ? { organization_id: org } : {});
      this.open.set(false);
      await this.load();
      this.toast.show(`${g.name} added to ${target.name}`, {
        body: "Capped to the organization's plan. Adjust it, then give it to people from Users.",
        action: { label: 'Edit', run: () => this.edit(g) },
      });
    } catch (err) {
      this.toast.error(`Couldn't copy ${t.name}`, errorText(err));
    }
  }

  // ── Delete ─────────────────────────────────────────────────
  protected readonly deleteOpen = signal(false);
  protected readonly deleteTarget = signal<Group | null>(null);
  protected readonly deleteBusy = signal(false);
  private askDelete(g: Group) {
    this.deleteTarget.set(g);
    this.deleteOpen.set(true);
  }
  protected async remove() {
    const g = this.deleteTarget();
    if (!g || this.deleteBusy()) return;
    this.deleteBusy.set(true);
    try {
      await this.api.remove(g.id);
      this.deleteOpen.set(false);
      await this.load();
      this.toast.show(`${g.name} deleted`);
    } catch (err) {
      this.toast.error(`Couldn't delete ${g.name}`, errorText(err));
    } finally {
      this.deleteBusy.set(false);
    }
  }

  // ── Drawer ─────────────────────────────────────────────────
  protected readonly open = signal(false);
  protected readonly tried = signal(false);
  protected readonly saving = signal(false);
  protected readonly draft = signal<Draft>(this.blank(null));
  protected readonly original = signal<Group | null>(null);
  protected readonly serverErrors = signal<Errors>({});

  protected readonly draftOrg = computed(() => this.orgOf(this.draft().orgId));
  protected readonly draftOrgName = computed(() => this.draftOrg()?.name ?? this.original()?.orgName ?? '');
  protected readonly draftTemplate = computed(() => this.draft().id != null && this.draft().orgId == null);
  protected readonly readOnly = computed(() => {
    const o = this.original();
    return !this.canWrite() || (!!o && o.orgId == null && !this.platform());
  });
  protected readonly visible = computed(() => this.featuresFor(this.draft().orgId));
  protected readonly areas = computed(() => {
    const out: { area: string; features: FeatureDef[] }[] = [];
    for (const f of this.visible()) {
      const last = out[out.length - 1];
      if (last?.area === f.area) last.features.push(f);
      else out.push({ area: f.area, features: [f] });
    }
    return out;
  });

  private blank(orgId: number | null): Draft {
    return { id: null, orgId, name: '', description: '', status: 'Active', permissions: Object.fromEntries(FEATURES.map((f) => [f.key, null])) };
  }
  protected add() {
    if (!this.canWrite()) return;
    this.original.set(null);
    this.draft.set(this.blank(this.store.writeOrgId()));
    this.tried.set(false);
    this.serverErrors.set({});
    this.impact.set(null);
    this.open.set(true);
  }
  protected edit(g: Group) {
    const clamped = { ...g, permissions: this.clamp(g.orgId, g.permissions) };
    this.original.set(clamped);
    this.draft.set({ id: g.id, orgId: g.orgId, name: g.name, description: g.description, status: g.status, permissions: clamped.permissions });
    this.tried.set(false);
    this.serverErrors.set({});
    this.impact.set(null);
    this.open.set(true);
  }
  protected set<K extends keyof Draft>(k: K, v: Draft[K]) {
    this.draft.update((d) => ({ ...d, [k]: v }));
    this.serverErrors.set({});
    if (k === 'status') this.schedulePreview();
  }

  // ── Matrix ─────────────────────────────────────────────────
  protected cap(key: string): Permission {
    return this.capFor(this.draft().orgId, key);
  }
  protected allowed(key: string, l: Permission) {
    return rank(l) <= rank(this.cap(key));
  }
  /** Why an option is off, e.g. "Not in Vodafone Qatar's plan". */
  protected capHint(key: string): string | null {
    const c = this.cap(key);
    const name = this.draftOrgName();
    if (this.draft().orgId == null || c === 'RW') return null;
    return c === 'R' ? `Read & write is not in ${name}'s plan` : `Not in ${name}'s plan`;
  }
  protected setPerm(f: string, p: Permission) {
    if (this.readOnly() || !this.allowed(f, p)) return;
    this.draft.update((d) => ({ ...d, permissions: { ...d.permissions, [f]: p } }));
    this.serverErrors.set({});
    this.schedulePreview();
  }
  protected setAll(p: Permission) {
    if (this.readOnly()) return;
    const keys = new Set(this.visible().map((f) => f.key));
    this.draft.update((d) => ({
      ...d,
      permissions: Object.fromEntries(FEATURES.map((f) => [f.key, keys.has(f.key) ? minP(p, this.cap(f.key)) : null])),
    }));
    this.serverErrors.set({});
    this.schedulePreview();
  }

  private readonly keys = computed(() => this.visible().map((f) => f.key));
  protected readonly draftSum = computed(() => permissionSummary(this.draft().permissions, this.keys()));
  protected readonly changed = computed(() => {
    const o = this.original();
    if (!o) return 0;
    return this.keys().filter((f) => (o.permissions[f] ?? null) !== (this.draft().permissions[f] ?? null)).length + (o.status !== this.draft().status ? 1 : 0);
  });
  protected readonly wasActive = computed(() => this.original()?.status === 'Active');
  protected readonly memberCount = computed(() => this.original()?.members.total ?? 0);
  protected readonly reach = computed(() => (this.draft().status === 'Active' ? (this.original()?.members.active ?? 0) : 0));

  // ── Who loses access (server preview, debounced while editing) ──
  protected readonly impact = signal<RoleImpact | null>(null);
  private previewTimer?: ReturnType<typeof setTimeout>;
  private previewSeq = 0;
  private schedulePreview() {
    const o = this.original();
    clearTimeout(this.previewTimer);
    if (!o || o.orgId == null || this.readOnly() || !this.changed()) {
      this.impact.set(null);
      return;
    }
    this.previewTimer = setTimeout(async () => {
      const mine = ++this.previewSeq;
      const d = this.draft();
      try {
        const res = await this.api.preview(o.id, { permissions: d.permissions, status: d.status });
        if (mine === this.previewSeq) this.impact.set(res);
      } catch {
        if (mine === this.previewSeq) this.impact.set(null);
      }
    }, 300);
  }
  protected readonly losers = computed(() =>
    (this.impact()?.affected ?? []).map((a) => ({ id: a.user.id, name: a.user.full_name, features: a.features.map((k) => LABEL.get(k) ?? k) })),
  );

  protected readonly errors = computed<Errors>(() => {
    const d = this.draft();
    const e: Errors = {};
    if (!d.name.trim()) e.name = 'Enter a role name.';
    else if (d.name.trim().length > 60) e.name = 'Keep the name under 60 characters.';
    else if (this.store.groups.all().some((g) => g.orgId === d.orgId && g.id !== d.id && g.name.toLowerCase() === d.name.trim().toLowerCase())) {
      e.name = 'A role with this name already exists here.';
    }
    if (!d.description.trim()) e.description = 'Say what this role is for.';
    else if (d.description.trim().length > 255) e.description = 'Keep the description under 255 characters.';
    if (this.draftSum().none === this.keys().length) e.permissions = 'Give the role access to at least one feature.';
    else {
      const o = this.original();
      if (o && this.myLastAdmin(o) && !(d.status === 'Active' && (d.permissions['Users'] === 'RW' || d.permissions['Roles'] === 'RW'))) {
        e.permissions = "This is your last admin role: keep Users or Roles at Read & write, or you'd lock yourself out.";
      }
    }
    return { ...e, ...this.serverErrors() };
  });

  protected async save() {
    this.tried.set(true);
    this.serverErrors.set({});
    if (this.readOnly() || Object.keys(this.errors()).length || this.saving()) return;
    const d = this.draft();
    const old = this.original();
    const body = { name: d.name.trim(), description: d.description.trim(), permissions: d.permissions };
    this.saving.set(true);
    try {
      let g: Group;
      if (old) {
        g = await this.api.update(old.id, { ...body, status: d.status });
      } else {
        const org = this.orgParam();
        g = await this.api.create({ ...body, ...(org != null ? { organization_id: org } : {}) });
      }
      this.open.set(false);
      await this.load();
      void this.session.refreshAccess();
      const n = old?.members.total ?? 0;
      this.toast.show(old ? `${g.name} saved` : `${g.name} created`, {
        body: old
          ? g.orgId == null
            ? 'Copies already made from this template keep their own permissions.'
            : `${this.changed()} ${this.changed() === 1 ? 'change applies' : 'changes apply'} to ${n} ${n === 1 ? 'member' : 'members'} straight away.`
          : 'Give it to people from Users.',
      });
    } catch (err) {
      this.serverErrors.set(roleErrors(err));
    } finally {
      this.saving.set(false);
    }
  }
}

/** Server refusals → the field they belong to (ROLES_API codes; `data.features` names the features). */
function roleErrors(err: unknown): Errors {
  if (!(err instanceof ApiError)) return { form: errorText(err) };
  const out: Errors = {};
  const f = err.fieldErrors;
  if (f['name']) out.name = f['name'][0];
  if (f['description']) out.description = f['description'][0];
  if (f['permissions']) out.permissions = f['permissions'][0];
  const feats = err.data?.['features'];
  const list = Array.isArray(feats)
    ? feats.map((x) => (typeof x === 'string' ? (LABEL.get(x) ?? x) : `${LABEL.get((x as { feature: string }).feature) ?? (x as { feature: string }).feature} (up to ${PERMISSION_LABEL[(x as { max: 'R' | 'RW' | null }).max ?? 'none']})`))
    : [];
  switch (err.code) {
    case RoleCode.NameTaken:
      out.name = err.message;
      break;
    case RoleCode.AbovePlan:
    case RoleCode.BadFeature:
    case RoleCode.NoPermission:
    case RoleCode.OwnAdmin:
    case RoleCode.TemplateByPartner:
      out.permissions = list.length ? `${err.message} ${list.join(', ')}.` : err.message;
      break;
  }
  if (!Object.keys(out).length) out.form = err.message;
  return out;
}
