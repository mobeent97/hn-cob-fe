import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Store } from '../../core/data/store';
import { Access } from '../../core/access/access';
import { FEATURES, FeatureDef } from '../../core/access/features';
import { TonePipe } from '../../core/data/format';
import { AdminUser, Group, Organization, Permission } from '../../core/data/models';
import { Icon } from '../../shared/ui/icon';
import { Menu, MenuItem } from '../../shared/ui/menu';
import { Dialog } from '../../shared/ui/dialog';
import { Toaster } from '../../shared/ui/toast';
import { simulateLoad } from '../../shared/ui/loading';

type Draft = { id: number | null; orgId: number | null; name: string; description: string; status: Group['status']; permissions: Record<string, Permission> };
type Row = Group & { members: number; activeMembers: number; sum: { rw: number; r: number; none: number }; template: boolean };
type Section = { key: string; heading: string | null; sub: string | null; rows: Row[] };

export const PERMISSION_LABEL: Record<'none' | 'R' | 'RW', string> = { none: 'None', R: 'Read', RW: 'Read & write' };
const RANK: Record<string, number> = { none: 0, R: 1, RW: 2 };
const rank = (p: Permission) => RANK[p ?? 'none'];
const minP = (a: Permission, b: Permission): Permission => (rank(a) <= rank(b) ? a : b);
const maxP = (a: Permission, b: Permission): Permission => (rank(a) >= rank(b) ? a : b);

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
 * A role belongs to one organization (orgId null = a system template partners copy). Its permissions
 * are capped by that organization's plan; platform-only features never appear for partner roles.
 * Editing opens a drawer with the permission matrix grouped by area.
 */
@Component({
  selector: 'app-groups',
  imports: [Icon, Menu, Dialog, TonePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './groups.html',
  styleUrl: './groups.css',
})
export class Groups {
  protected readonly store = inject(Store);
  protected readonly access = inject(Access);
  private readonly toast = inject(Toaster);
  protected readonly loading = simulateLoad('groups');
  protected readonly levels: Permission[] = [null, 'R', 'RW'];
  protected readonly label = (p: Permission) => PERMISSION_LABEL[p ?? 'none'];

  protected readonly canWrite = computed(() => this.access.can('Roles', 'RW'));
  protected readonly platform = this.store.crossTenant;
  protected readonly allOrgs = computed(() => this.store.crossTenant() && this.store.scopeOrgId() == null);
  private readonly orgById = computed(() => new Map(this.store.organizations().map((o) => [o.id, o])));
  protected readonly writeOrg = computed(() => this.orgById().get(this.store.writeOrgId())!);

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
    const kind = this.orgOf(orgId)?.kind;
    return FEATURES.filter((f) => !f.platformOnly || kind === 'Platform');
  }
  /** The most the role's organization allows per feature (templates are uncapped). */
  protected capFor(orgId: number | null, key: string): Permission {
    const org = this.orgOf(orgId);
    return org ? (org.features[key] ?? null) : 'RW';
  }
  /** Stored permissions clamped to what the role can really grant. */
  private clamp(orgId: number | null, p: Record<string, Permission>) {
    const shown = new Set(this.featuresFor(orgId).map((f) => f.key));
    return Object.fromEntries(FEATURES.map((f) => [f.key, shown.has(f.key) ? minP(p[f.key] ?? null, this.capFor(orgId, f.key)) : null])) as Record<string, Permission>;
  }

  private membersOf(g: Group): AdminUser[] {
    if (g.orgId == null) return [];
    return this.store.allUsers().filter((u) => u.orgId === g.orgId && u.groups.includes(g.name));
  }

  protected readonly rows = computed<Row[]>(() =>
    this.store.groups().map((g) => {
      const members = this.membersOf(g);
      const keys = this.featuresFor(g.orgId).map((f) => f.key);
      return {
        ...g,
        template: g.orgId == null,
        members: members.length,
        activeMembers: members.filter((u) => u.status === 'Active').length,
        sum: permissionSummary(this.clamp(g.orgId, g.permissions), keys),
      };
    }),
  );

  /** One section per organization (all-organizations view), then templates. */
  protected readonly sections = computed<Section[]>(() => {
    const rows = this.rows();
    const out: Section[] = [];
    const orgIds = [...new Set(rows.filter((r) => !r.template).map((r) => r.orgId!))];
    const ordered = this.store.organizations().filter((o) => orgIds.includes(o.id));
    const multi = this.allOrgs();
    for (const o of ordered) {
      out.push({ key: 'o' + o.id, heading: multi ? o.name : null, sub: multi ? (o.kind === 'Platform' ? 'Platform' : 'Partner') : null, rows: rows.filter((r) => r.orgId === o.id) });
    }
    const templates = rows.filter((r) => r.template);
    if (templates.length) {
      out.push({
        key: 'templates',
        heading: 'Templates',
        sub: this.platform() ? 'Starting points every organization can copy' : `Starting points from HyperNym. Copy one to make it ${this.writeOrg().name}'s own.`,
        rows: templates,
      });
    }
    if (!multi && out.length && out[0].key !== 'templates') {
      out[0] = { ...out[0], heading: out.length > 1 ? `${this.orgOf(out[0].rows[0].orgId)?.name} roles` : null };
    }
    return out;
  });

  protected readonly ownRoles = computed(() => this.rows().filter((r) => !r.template));
  protected readonly templateCount = computed(() => this.rows().filter((r) => r.template).length);
  protected readonly noRole = computed(() => this.store.users().filter((u) => !u.isSuperuser && !u.groups.length).length);

  protected menu(g: Row): MenuItem[] {
    const items: MenuItem[] = [];
    if (this.editable(g)) items.push({ label: 'Edit permissions', icon: 'shield', run: () => this.edit(g) });
    else items.push({ label: 'View permissions', icon: 'eye', run: () => this.edit(g) });
    if (g.template && this.canWrite()) {
      items.push({ label: `Copy to ${this.writeOrg().name}`, icon: 'copy', run: () => this.copy(g) });
    }
    if (this.editable(g)) {
      const mine = this.myLastAdmin(g);
      items.push(
        g.status === 'Active'
          ? { label: mine ? 'Deactivate (your last admin role)' : 'Deactivate', icon: 'power', danger: true, disabled: mine, run: () => this.setStatus(g, 'Inactive') }
          : { label: 'Activate', icon: 'power', run: () => this.setStatus(g, 'Active') },
      );
    }
    return items;
  }

  /** True when this role is the only one giving the signed-in user Users/Roles read & write. */
  private myLastAdmin(g: Group) {
    const me = this.store.currentUser();
    if (me.isSuperuser || g.orgId !== me.orgId || !me.groups.includes(g.name)) return false;
    const grants = (x: Group) => x.status === 'Active' && (x.permissions['Users'] === 'RW' || x.permissions['Roles'] === 'RW');
    if (!grants(g)) return false;
    return !this.access.roles().some((r) => r.id !== g.id && grants(r));
  }

  private setStatus(g: Group, status: Group['status']) {
    const { members, activeMembers, sum, template, ...plain } = g as Row;
    this.store.saveGroup({ ...plain, status });
    const n = this.membersOf(g).length;
    this.toast.show(`${g.name} ${status === 'Active' ? 'activated' : 'deactivated'}`, {
      body: status === 'Inactive' ? `${n} ${n === 1 ? 'member loses' : 'members lose'} the access it grants at their next sign-in.` : undefined,
      action: { label: 'Undo', run: () => this.store.saveGroup(plain) },
    });
  }

  /** Copy a template into the organization being worked in, capped to its plan, with a unique name. */
  protected copy(t: Group) {
    const orgId = this.store.writeOrgId();
    const taken = new Set(this.store.groups.all().filter((g) => g.orgId === orgId).map((g) => g.name.toLowerCase()));
    let name = t.name;
    for (let i = 1; taken.has(name.toLowerCase()); i++) name = i === 1 ? `${t.name} (copy)` : `${t.name} (copy ${i})`;
    const g: Group = {
      id: Math.max(0, ...this.store.groups.all().map((x) => x.id)) + 1,
      orgId,
      name,
      description: t.description.replace(/^Template · /, ''),
      status: 'Active',
      permissions: this.clamp(orgId, t.permissions),
    };
    this.store.groups.all.update((xs) => [...xs, g]);
    this.toast.show(`${name} added to ${this.writeOrg().name}`, {
      body: "Capped to the organization's plan. Adjust it, then give it to people from Users.",
      action: { label: 'Edit', run: () => this.edit(g) },
    });
    this.open.set(false);
  }

  // ── Drawer ─────────────────────────────────────────────────
  protected readonly open = signal(false);
  protected readonly tried = signal(false);
  protected readonly draft = signal<Draft>(this.blank(null));
  private readonly original = signal<Group | null>(null);

  protected readonly draftOrg = computed(() => this.orgOf(this.draft().orgId));
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
    this.open.set(true);
  }
  protected edit(g: Group) {
    const { members, activeMembers, sum, template, ...plain } = g as Row;
    const clamped = { ...plain, permissions: this.clamp(g.orgId, g.permissions) };
    this.original.set(clamped);
    this.draft.set({ id: g.id, orgId: g.orgId, name: g.name, description: g.description, status: g.status, permissions: clamped.permissions });
    this.tried.set(false);
    this.open.set(true);
  }
  protected set<K extends keyof Draft>(k: K, v: Draft[K]) {
    this.draft.update((d) => ({ ...d, [k]: v }));
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
    const org = this.draftOrg();
    if (!org || c === 'RW') return null;
    return c === 'R' ? `Read & write is not in ${org.name}'s plan` : `Not in ${org.name}'s plan`;
  }
  protected setPerm(f: string, p: Permission) {
    if (this.readOnly() || !this.allowed(f, p)) return;
    this.draft.update((d) => ({ ...d, permissions: { ...d.permissions, [f]: p } }));
  }
  protected setAll(p: Permission) {
    if (this.readOnly()) return;
    const keys = new Set(this.visible().map((f) => f.key));
    this.draft.update((d) => ({
      ...d,
      permissions: Object.fromEntries(FEATURES.map((f) => [f.key, keys.has(f.key) ? minP(p, this.cap(f.key)) : null])),
    }));
  }

  private readonly keys = computed(() => this.visible().map((f) => f.key));
  protected readonly draftSum = computed(() => permissionSummary(this.draft().permissions, this.keys()));
  protected readonly changed = computed(() => {
    const o = this.original();
    if (!o) return 0;
    return this.keys().filter((f) => (o.permissions[f] ?? null) !== (this.draft().permissions[f] ?? null)).length;
  });
  protected readonly wasActive = computed(() => this.original()?.status === 'Active');
  /** Active, non-superuser members: the people whose access this role decides. */
  private readonly affected = computed(() => {
    const o = this.original();
    return o ? this.membersOf(o).filter((u) => u.status === 'Active' && !u.isSuperuser) : [];
  });
  protected readonly memberCount = computed(() => {
    const o = this.original();
    return o ? this.membersOf(o).length : 0;
  });
  protected readonly reach = computed(() => (this.draft().status === 'Active' ? this.affected().length : 0));

  /**
   * Members whose effective access drops with this draft, taking their other roles and
   * the organization's plan into account. Lists the features they lose or get less of.
   */
  protected readonly losers = computed(() => {
    const o = this.original();
    if (!o || o.orgId == null) return [];
    const d = this.draft();
    const lowered = this.visible().filter((f) => rank(d.permissions[f.key]) < rank(o.permissions[f.key]) || (d.status === 'Inactive' && o.status === 'Active' && rank(o.permissions[f.key]) > 0));
    if (!lowered.length) return [];
    const others = this.store.groups.all().filter((g) => g.orgId === o.orgId && g.id !== o.id && g.status === 'Active');
    const out: { user: AdminUser; features: string[] }[] = [];
    for (const u of this.affected()) {
      const theirs = others.filter((g) => u.groups.includes(g.name));
      const lost: string[] = [];
      for (const f of lowered) {
        const rest = theirs.reduce<Permission>((acc, g) => maxP(acc, g.permissions[f.key] ?? null), null);
        const cap = this.cap(f.key);
        const before = minP(cap, o.status === 'Active' ? maxP(rest, o.permissions[f.key] ?? null) : rest);
        const after = minP(cap, d.status === 'Active' ? maxP(rest, d.permissions[f.key] ?? null) : rest);
        if (rank(after) < rank(before)) lost.push(f.label);
      }
      if (lost.length) out.push({ user: u, features: lost });
    }
    return out;
  });

  protected readonly errors = computed(() => {
    const d = this.draft();
    const e: { name?: string; description?: string; permissions?: string } = {};
    const sameOrg = this.store.groups.all().filter((g) => g.orgId === d.orgId && g.id !== d.id);
    if (!d.name.trim()) e.name = 'Enter a role name.';
    else if (d.name.trim().length > 60) e.name = 'Keep the name under 60 characters.';
    else if (sameOrg.some((g) => g.name.toLowerCase() === d.name.trim().toLowerCase())) e.name = 'A role with this name already exists here.';
    if (!d.description.trim()) e.description = 'Say what this role is for.';
    if (this.draftSum().none === this.keys().length) e.permissions = 'Give the role access to at least one screen.';
    else {
      const o = this.original();
      if (o && this.myLastAdmin(o) && !(d.status === 'Active' && (d.permissions['Users'] === 'RW' || d.permissions['Roles'] === 'RW'))) {
        e.permissions = "This is your last admin role: keep Users or Roles at Read & write, or you'd lock yourself out.";
      }
    }
    return e;
  });

  protected save() {
    this.tried.set(true);
    if (this.readOnly() || Object.keys(this.errors()).length) return;
    const d = this.draft();
    const old = this.original();
    const g: Group = {
      orgId: old ? old.orgId : d.orgId,
      id: d.id ?? Math.max(0, ...this.store.groups.all().map((x) => x.id)) + 1,
      name: d.name.trim(),
      description: d.description.trim(),
      status: d.status,
      permissions: d.permissions,
    };
    this.store.saveGroup(g);
    if (old && old.name !== g.name && g.orgId != null) {
      for (const u of this.store.allUsers().filter((u) => u.orgId === g.orgId && u.groups.includes(old.name))) {
        this.store.saveUser({ ...u, groups: u.groups.map((x) => (x === old.name ? g.name : x)) });
      }
    }
    const n = this.memberCount();
    this.toast.show(old ? `${g.name} saved` : `${g.name} created`, {
      body: old
        ? g.orgId == null
          ? 'Copies already made from this template keep their own permissions.'
          : `${this.changed()} permission ${this.changed() === 1 ? 'change applies' : 'changes apply'} to ${n} ${n === 1 ? 'member' : 'members'} at their next sign-in.`
        : 'Give it to people from Users.',
    });
    this.open.set(false);
  }
}
