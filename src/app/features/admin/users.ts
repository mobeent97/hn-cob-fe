import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { Store } from '../../core/data/store';
import { Access } from '../../core/access/access';
import { RelativePipe, TonePipe } from '../../core/data/format';
import { AdminUser, Group, Organization } from '../../core/data/models';
import { Icon } from '../../shared/ui/icon';
import { Tabs, TabItem } from '../../shared/ui/tabs';
import { Pager, pageOf } from '../../shared/ui/pager';
import { Menu, MenuItem } from '../../shared/ui/menu';
import { Dialog } from '../../shared/ui/dialog';
import { Toaster } from '../../shared/ui/toast';
import { simulateLoad } from '../../shared/ui/loading';
import { Select, SelectOption } from '../../shared/ui/select';

type View = 'all' | 'Active' | 'Inactive' | 'never';
type Draft = { id: number | null; orgId: number | null; name: string; email: string; username: string; groups: string[]; manager: string };
type Errors = Partial<Record<keyof Draft, string>>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const USERNAME_RE = /^[a-z][a-z0-9._-]{2,31}$/;
export const SUPERUSER_REASON = 'Superusers are managed with manage.py createsuperuser';

/** An "admin role" lets its members manage users. Losing the last one locks you out of this screen. */
export const isAdminRole = (g: Group) => g.permissions['Users'] === 'RW' && g.status === 'Active';

/**
 * Users — "Who can sign in to this organization, with which roles, and how many seats are left?"
 * Users belong to one organization and get their access from that organization's roles.
 * Superusers come from `manage.py createsuperuser` and can't be changed here. You can't
 * deactivate yourself or remove your own last admin role.
 */
@Component({
  selector: 'app-users',
  imports: [Select, SelectOption, Icon, Tabs, Pager, Menu, Dialog, RelativePipe, TonePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './users.html',
  styleUrl: './users.scss',
})
export class Users {
  protected readonly store = inject(Store);
  protected readonly access = inject(Access);
  private readonly toast = inject(Toaster);
  protected readonly loading = simulateLoad('users');

  protected readonly view = signal<View>('all');
  protected readonly q = signal('');
  protected readonly group = signal('all');
  protected readonly org = signal<'all' | number>('all');
  protected readonly page = signal(1);
  protected readonly size = computed(() => this.store.settings().pagination.pageSize);

  /** Platform user looking across every tenant: show the Organization column and filter. */
  protected readonly allOrgs = computed(() => this.store.crossTenant() && this.store.scopeOrgId() == null);
  protected readonly canWrite = computed(() => this.access.can('Users', 'RW'));
  private readonly orgById = computed(() => new Map(this.store.organizations().map((o) => [o.id, o])));
  protected orgName(id: number | null) {
    return id == null ? '' : (this.orgById().get(id)?.name ?? '');
  }

  constructor() {
    effect(() => {
      this.view();
      this.q();
      this.group();
      this.org();
      this.page.set(1);
    });
    // Leaving "All organizations" drops the organization filter.
    effect(() => {
      if (!this.allOrgs()) this.org.set('all');
    });
  }

  // ── Seats ──────────────────────────────────────────────────
  /** Active users hold a seat; deactivating someone frees theirs. */
  protected seatsUsed(orgId: number) {
    return this.store.allUsers().filter((u) => u.orgId === orgId && u.status === 'Active').length;
  }
  protected atLimit(orgId: number | null) {
    if (orgId == null) return false;
    const max = this.orgById().get(orgId)?.limits.maxUsers;
    return max != null && this.seatsUsed(orgId) >= max;
  }
  protected readonly seats = computed(() => {
    const o = this.store.scopeOrg();
    const max = o?.limits.maxUsers;
    if (!o || max == null) return null;
    return { used: this.seatsUsed(o.id), max, org: o };
  });
  protected readonly createBlocked = computed(() => {
    const s = this.seats();
    return s && s.used >= s.max ? `${s.org.name} has used all ${s.max} seats in its plan. Deactivate someone or ask HyperNym for more.` : null;
  });

  // ── List ───────────────────────────────────────────────────
  private readonly searched = computed(() => {
    const q = this.q().trim().toLowerCase();
    const org = this.org();
    return this.store
      .users()
      .filter((u) => org === 'all' || u.orgId === org)
      .filter((u) => !q || u.name.toLowerCase().includes(q) || u.username.includes(q) || u.email.toLowerCase().includes(q) || (u.manager ?? '').toLowerCase().includes(q))
      .filter((u) => this.group() === 'all' || u.groups.includes(this.group()));
  });
  private readonly matches = (u: AdminUser, v: View) => v === 'all' || (v === 'never' ? !u.lastLogin : u.status === v);

  /** Role names for the filter: the scope's own roles (templates have no members). */
  protected readonly roleNames = computed(() => {
    const org = this.org();
    const names = this.store
      .groups()
      .filter((g) => g.orgId != null && (org === 'all' || g.orgId === org))
      .map((g) => g.name);
    return [...new Set(names)].sort((a, b) => a.localeCompare(b));
  });
  /** Organizations that have users, for the filter. */
  protected readonly orgOptions = computed(() => this.store.organizations().filter((o) => this.store.allUsers().some((u) => u.orgId === o.id)));

  protected readonly tabs = computed<TabItem<View>[]>(() => {
    const rows = this.searched();
    const n = (v: View) => rows.filter((u) => this.matches(u, v)).length;
    return [
      { id: 'all', label: 'All', count: n('all') },
      { id: 'Active', label: 'Active', count: n('Active') },
      { id: 'Inactive', label: 'Inactive', count: n('Inactive') },
      { id: 'never', label: 'Never signed in', count: n('never') },
    ];
  });

  protected readonly rows = computed(() =>
    this.searched()
      .filter((u) => this.matches(u, this.view()))
      .sort((a, b) => a.name.localeCompare(b.name)),
  );
  protected readonly pageRows = computed(() => pageOf(this.rows(), this.page(), this.size()));
  protected readonly activeCount = computed(() => this.store.users().filter((u) => u.status === 'Active').length);
  protected readonly dormant = computed(() => this.store.users().filter((u) => u.status === 'Active' && !u.lastLogin).length);
  protected readonly orgCount = computed(() => new Set(this.store.users().map((u) => u.orgId)).size);
  protected readonly cols = computed(() => 6 + (this.allOrgs() ? 1 : 0) + (this.canWrite() ? 1 : 0));
  protected readonly filtered = computed(() => !!this.q() || this.group() !== 'all' || this.org() !== 'all');

  protected clearFilters() {
    this.q.set('');
    this.group.set('all');
    this.org.set('all');
    this.view.set('all');
  }

  protected isMe(u: AdminUser) {
    return u.id === this.store.currentUser().id;
  }
  protected editable(u: AdminUser) {
    return this.canWrite() && !u.isSuperuser;
  }
  protected rowClick(u: AdminUser) {
    if (this.editable(u)) this.edit(u);
  }

  protected menu(u: AdminUser): MenuItem[] {
    if (u.isSuperuser) {
      return [
        { label: SUPERUSER_REASON, icon: 'lock', disabled: true, run: () => {} },
        { label: 'Edit', icon: 'pencil', disabled: true, run: () => {} },
        { label: 'Send password reset link', icon: 'key', disabled: true, run: () => {} },
        { label: 'Deactivate', icon: 'power', disabled: true, run: () => {} },
      ];
    }
    const noSeat = u.status !== 'Active' && this.atLimit(u.orgId);
    return [
      { label: 'Edit', icon: 'pencil', run: () => this.edit(u) },
      { label: 'Send password reset link', icon: 'key', disabled: u.status !== 'Active', run: () => this.reset(u) },
      u.status === 'Active'
        ? { label: this.isMe(u) ? "Deactivate (that's you)" : 'Deactivate', icon: 'power', danger: true, disabled: this.isMe(u), run: () => this.setStatus(u, 'Inactive') }
        : { label: noSeat ? 'Activate (no seats left)' : 'Activate', icon: 'power', disabled: noSeat, run: () => this.setStatus(u, 'Active') },
    ];
  }

  private reset(u: AdminUser) {
    this.toast.show('Reset link sent', { body: `${u.name} gets a link at ${u.email}. It expires in 24 hours.`, tone: 'info' });
  }
  private setStatus(u: AdminUser, status: AdminUser['status']) {
    this.store.saveUser({ ...u, status });
    if (status === 'Inactive') {
      this.toast.show(`${u.name} deactivated`, { body: 'They are signed out and can no longer sign in.', action: { label: 'Undo', run: () => this.store.saveUser(u) } });
    } else {
      this.toast.show(`${u.name} activated`);
    }
  }

  // ── Dialog ─────────────────────────────────────────────────
  protected readonly open = signal(false);
  protected readonly tried = signal(false);
  protected readonly draft = signal<Draft>(this.blank());
  private readonly original = signal<AdminUser | null>(null);

  /** Organizations a platform user can add people to from "All organizations". */
  protected readonly orgChoices = computed<Organization[]>(() => this.store.organizations().filter((o) => o.status !== 'Suspended'));
  /** Pick the organization in the dialog only for new users in the all-organizations view. */
  protected readonly pickOrg = computed(() => this.allOrgs() && this.draft().id == null);
  /** The draft's organization's own roles (never templates). */
  protected readonly dialogRoles = computed(() => {
    const id = this.draft().orgId;
    return id == null ? [] : this.store.groups.all().filter((g) => g.orgId === id);
  });
  protected readonly managers = computed(() => {
    const d = this.draft();
    return this.store.allUsers().filter((u) => u.orgId === d.orgId && u.status === 'Active' && u.id !== d.id);
  });
  /** Editing yourself: the one admin role you still hold can't be unticked. */
  protected readonly lockedRole = computed(() => {
    const o = this.original();
    if (!o || !this.isMe(o) || o.isSuperuser) return null;
    const admin = this.dialogRoles().filter((g) => isAdminRole(g) && this.draft().groups.includes(g.name));
    return admin.length === 1 ? admin[0].name : null;
  });

  private blank(): Draft {
    return { id: null, orgId: this.allOrgs() ? null : this.store.writeOrgId(), name: '', email: '', username: '', groups: [], manager: '' };
  }
  protected add() {
    if (!this.canWrite() || this.createBlocked()) return;
    this.original.set(null);
    this.draft.set(this.blank());
    this.tried.set(false);
    this.open.set(true);
  }
  protected edit(u: AdminUser) {
    if (!this.editable(u)) return;
    this.original.set(u);
    this.draft.set({ id: u.id, orgId: u.orgId, name: u.name, email: u.email, username: u.username, groups: [...u.groups], manager: u.manager ?? '' });
    this.tried.set(false);
    this.open.set(true);
  }
  protected set<K extends keyof Draft>(k: K, v: Draft[K]) {
    this.draft.update((d) => ({ ...d, [k]: v }));
  }
  /** Roles and managers belong to one organization: changing it clears both. */
  protected setOrg(v: string) {
    this.draft.update((d) => ({ ...d, orgId: v ? Number(v) : null, groups: [], manager: '' }));
  }
  /** Suggest a username from the email while the user hasn't typed one. */
  protected setEmail(v: string) {
    this.draft.update((d) => {
      const auto = !d.username || d.username === d.email.split('@')[0].toLowerCase();
      return { ...d, email: v.trim(), username: auto && d.id == null ? v.split('@')[0].toLowerCase() : d.username };
    });
  }
  protected toggleGroup(name: string, on: boolean) {
    if (!on && name === this.lockedRole()) return;
    this.draft.update((d) => ({ ...d, groups: this.dialogRoles().map((g) => g.name).filter((g) => (g === name ? on : d.groups.includes(g))) }));
  }

  protected readonly errors = computed<Errors>(() => {
    const d = this.draft();
    const others = this.store.allUsers().filter((u) => u.id !== d.id);
    const e: Errors = {};
    if (d.orgId == null) e.orgId = 'Choose the organization they work for.';
    else if (d.id == null && this.atLimit(d.orgId)) e.orgId = `${this.orgName(d.orgId)} has used all its seats.`;
    if (!d.name.trim()) e.name = 'Enter their full name.';
    else if (d.name.trim().length > 120) e.name = 'Keep the name under 120 characters.';
    if (!d.email) e.email = 'Enter their work email.';
    else if (!EMAIL_RE.test(d.email)) e.email = 'Enter an email such as name@company.com.';
    else if (others.some((u) => u.email.toLowerCase() === d.email.toLowerCase())) e.email = 'Another user already has this email.';
    if (!d.username) e.username = 'Enter a username.';
    else if (!USERNAME_RE.test(d.username)) e.username = '3–32 lower-case letters, digits, dots or dashes, starting with a letter.';
    else if (others.some((u) => u.username === d.username)) e.username = 'This username is taken.';
    if (d.orgId != null && !d.groups.length) e.groups = 'Choose at least one role.';
    const o = this.original();
    if (o && this.isMe(o) && o.groups.some((n) => this.dialogRoles().some((g) => g.name === n && isAdminRole(g)))
        && !d.groups.some((n) => this.dialogRoles().some((g) => g.name === n && isAdminRole(g)))) {
      e.groups = "You can't remove your own last admin role. Ask another admin.";
    }
    return e;
  });

  protected save() {
    this.tried.set(true);
    if (Object.keys(this.errors()).length) return;
    const d = this.draft();
    const prev = this.original();
    const u: AdminUser = {
      orgId: prev?.orgId ?? d.orgId ?? this.store.writeOrgId(),
      // Superusers only come from `manage.py createsuperuser`; the portal never grants it.
      isSuperuser: prev?.isSuperuser ?? false,
      id: d.id ?? Math.max(0, ...this.store.allUsers().map((x) => x.id)) + 1,
      name: d.name.trim(),
      email: d.email,
      username: d.username,
      groups: d.groups,
      manager: d.manager || null,
      // Legacy account type: kept in the data, no longer chosen here (access comes from roles).
      type: prev?.type ?? 'Admin',
      status: prev?.status ?? 'Active',
      lastLogin: prev?.lastLogin ?? null,
    };
    this.store.saveUser(u);
    this.toast.show(prev ? `${u.name} updated` : `${u.name} invited`, prev ? {} : { body: `A link to set a password went to ${u.email}.` });
    this.open.set(false);
  }
}
