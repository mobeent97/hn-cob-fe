import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { Store } from '../../core/data/store';
import { Access } from '../../core/access/access';
import { RelativePipe, TonePipe } from '../../core/data/format';
import { AdminUser, Group, Organization } from '../../core/data/models';
import { UserCode, UserCounts, UserQuery, UsersApi } from '../../core/api/users.api';
import { RolesApi } from '../../core/api/roles.api';
import { AuditApi } from '../../core/api/audit.api';
import { ApiError, errorText } from '../../core/api/api-client';
import { SessionLoader } from '../../core/auth/session-loader';
import { Icon } from '../../shared/ui/icon';
import { Tabs, TabItem } from '../../shared/ui/tabs';
import { Pager } from '../../shared/ui/pager';
import { Menu, MenuItem } from '../../shared/ui/menu';
import { Dialog } from '../../shared/ui/dialog';
import { Toaster } from '../../shared/ui/toast';
import { LoadError, loadState } from '../../shared/ui/load-state';
import { Select, SelectOption } from '../../shared/ui/select';

type View = 'all' | 'Active' | 'Inactive' | 'Invited' | 'never';
type Draft = { id: number | null; orgId: number | null; name: string; email: string; phone: string; roleIds: number[]; managerId: number | null };
type Errors = Partial<Record<'orgId' | 'name' | 'email' | 'phone' | 'roles' | 'manager' | 'form', string>>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
/** USERS_API: `+`, country code and number (spaces or dashes optional), 8 to 15 digits in all. */
const PHONE_RE = /^\+[0-9][0-9 -]{5,22}[0-9]$/;
const phoneOk = (p: string) => {
  const digits = p.replace(/\D/g, '').length;
  return PHONE_RE.test(p) && digits >= 8 && digits <= 15;
};
const NO_COUNTS: UserCounts = { all: 0, active: 0, inactive: 0, invited: 0, never_signed_in: 0 };
export const SUPERUSER_REASON = 'Superusers are managed with manage.py createsuperuser';

/** An "admin role" lets its members manage users (ROLES_API `is_admin`: Active with Users read & write). */
export const isAdminRole = (g: Pick<Group, 'isAdmin'>) => g.isAdmin;

/**
 * Users — "Who can sign in to this organization, with which roles, and how many seats are left?"
 * GET /users/ with the tab, search, role, organization and page as query params; the tab badges come
 * from `counts` and the seats line from `seats`. Users belong to one organization and get their access
 * from that organization's roles (by id). Superusers come from `manage.py createsuperuser` and can't be
 * changed here. Active and invited users hold a seat. Deleting goes through the deletion audit.
 */
@Component({
  selector: 'app-users',
  imports: [Select, SelectOption, Icon, Tabs, Pager, Menu, Dialog, RelativePipe, TonePipe, LoadError],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './users.html',
  styleUrl: './users.css',
})
export class Users {
  protected readonly store = inject(Store);
  protected readonly access = inject(Access);
  private readonly api = inject(UsersApi);
  private readonly rolesApi = inject(RolesApi);
  private readonly audit = inject(AuditApi);
  private readonly session = inject(SessionLoader);
  private readonly toast = inject(Toaster);
  protected readonly state = loadState();

  protected readonly view = signal<View>('all');
  protected readonly q = signal('');
  /** The search actually sent, 250 ms after typing stops. */
  private readonly qSent = signal('');
  protected readonly role = signal<'all' | number>('all');
  protected readonly org = signal<'all' | number>('all');
  protected readonly page = signal(1);
  protected readonly size = computed(() => this.store.settings().pagination.pageSize);

  protected readonly rows = signal<AdminUser[]>([]);
  protected readonly count = signal(0);
  protected readonly counts = signal<UserCounts>(NO_COUNTS);
  protected readonly seatsData = signal<{ used: number; max: number | null } | null>(null);
  /** Roles for the filter (this scope's own roles, never templates). */
  protected readonly roleOptions = signal<Group[]>([]);

  /** Platform user looking across every tenant: show the Organization column and filter. */
  protected readonly allOrgs = computed(() => this.store.crossTenant() && this.store.scopeOrgId() == null);
  protected readonly canWrite = computed(() => this.access.can('Users', 'RW'));
  private readonly orgById = computed(() => new Map(this.store.organizations().map((o) => [o.id, o])));
  protected orgName(id: number | null) {
    return id == null ? '' : (this.orgById().get(id)?.name ?? '');
  }

  /** The organization the list is narrowed to, as the API param (never one the user didn't choose). */
  private readonly orgParam = computed<number | null>(() => {
    if (!this.store.crossTenant()) return null;
    if (this.allOrgs()) return this.org() === 'all' ? null : (this.org() as number);
    return this.store.scopeOrgId();
  });

  constructor() {
    // Typing waits for a pause; every other filter applies at once.
    let t: ReturnType<typeof setTimeout> | undefined;
    effect(() => {
      const q = this.q();
      clearTimeout(t);
      t = setTimeout(() => this.qSent.set(q.trim()), 250);
    });
    inject(DestroyRef).onDestroy(() => clearTimeout(t));
    // A filter change goes back to page 1.
    effect(() => {
      this.view();
      this.qSent();
      this.role();
      this.org();
      this.store.scopeOrgId();
      untracked(() => this.page.set(1));
    });
    effect(() => {
      const query = this.query();
      untracked(() => void this.load(query));
    });
    effect(() => {
      const org = this.orgParam();
      untracked(() => void this.loadRoleOptions(org));
    });
    // Leaving "All organizations" drops the organization filter.
    effect(() => {
      if (!this.allOrgs()) untracked(() => this.org.set('all'));
    });
  }

  private readonly query = computed<UserQuery>(() => {
    const v = this.view();
    const size = this.size();
    return {
      search: this.qSent() || undefined,
      status: v === 'Active' || v === 'Inactive' || v === 'Invited' ? v : undefined,
      never_signed_in: v === 'never' ? true : undefined,
      role: this.role() === 'all' ? undefined : (this.role() as number),
      organization: this.orgParam(),
      offset: (this.page() - 1) * size,
      limit: size,
    };
  });

  protected async load(query = this.query()) {
    const res = await this.state.run(() => this.api.list(query));
    if (!res) return;
    this.rows.set(res.rows);
    this.store.users.all.set(res.rows);
    this.count.set(res.count);
    this.counts.set(res.counts ?? NO_COUNTS);
    this.seatsData.set(res.seats);
  }
  protected reload() {
    return this.load();
  }

  private async loadRoleOptions(org: number | null) {
    if (!this.access.can('Roles', 'R')) {
      this.roleOptions.set([]);
      return;
    }
    try {
      const res = await this.rolesApi.list({ include_templates: false, organization: org, limit: 100 });
      this.roleOptions.set(res.rows);
    } catch {
      this.roleOptions.set([]);
    }
  }

  // ── Seats ──────────────────────────────────────────────────
  /** Active and invited users hold a seat (`seats` is returned when the list is scoped to one organization). */
  protected readonly seats = computed(() => {
    const s = this.seatsData();
    if (!s || s.max == null) return null;
    const id = this.orgParam() ?? this.store.currentUser().orgId;
    return { used: s.used, max: s.max, name: this.orgName(id) || 'This organization' };
  });
  protected readonly createBlocked = computed(() => {
    const s = this.seats();
    return s && s.used >= s.max ? `${s.name} has used all ${s.max} seats in its plan. Deactivate someone or ask HyperNym for more.` : null;
  });

  // ── List ───────────────────────────────────────────────────
  /** Organizations for the filter (all-organizations view). */
  protected readonly orgOptions = computed(() => this.store.organizations());

  protected readonly tabs = computed<TabItem<View>[]>(() => {
    const c = this.counts();
    return [
      { id: 'all', label: 'All', count: c.all },
      { id: 'Active', label: 'Active', count: c.active },
      { id: 'Invited', label: 'Invited', count: c.invited },
      { id: 'Inactive', label: 'Inactive', count: c.inactive },
      { id: 'never', label: 'Never signed in', count: c.never_signed_in },
    ];
  });

  protected readonly cols = computed(() => 6 + (this.allOrgs() ? 1 : 0) + (this.canWrite() ? 1 : 0));
  protected readonly filtered = computed(() => !!this.q() || this.role() !== 'all' || this.org() !== 'all');
  protected readonly orgCount = computed(() => new Set(this.rows().map((u) => u.orgId)).size);

  protected clearFilters() {
    this.q.set('');
    this.qSent.set('');
    this.role.set('all');
    this.org.set('all');
    this.view.set('all');
  }
  protected pickRole(v: string) {
    this.role.set(v === 'all' ? 'all' : +v);
  }
  protected pickOrg(v: string) {
    this.org.set(v === 'all' ? 'all' : +v);
    this.role.set('all');
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
  protected roleList(u: AdminUser) {
    return u.roles.map((r) => r.name).join(', ');
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
    const items: MenuItem[] = [{ label: 'Edit', icon: 'pencil', run: () => this.edit(u) }];
    if (u.status === 'Invited') items.push({ label: 'Resend invitation', icon: 'send', run: () => this.resend(u) });
    else items.push({ label: 'Send password reset link', icon: 'key', disabled: u.status !== 'Active', run: () => this.reset(u) });
    if (u.status === 'Inactive') {
      items.push({ label: 'Activate', icon: 'power', run: () => this.setStatus(u, 'activate') });
    } else {
      items.push({
        label: this.isMe(u) ? "Deactivate (that's you)" : 'Deactivate', icon: 'power', danger: true, disabled: this.isMe(u),
        run: () => this.setStatus(u, 'deactivate'),
      });
    }
    if (u.status !== 'Active' && !this.isMe(u)) items.push({ label: 'Delete…', icon: 'trash', danger: true, run: () => this.askDelete(u) });
    return items;
  }

  private async reset(u: AdminUser) {
    try {
      await this.api.sendPasswordReset(u.id);
      this.toast.show('Reset link sent', { body: `${u.name} gets a link at ${u.email}. It expires in 24 hours.`, tone: 'info' });
    } catch (err) {
      this.toast.error("Couldn't send the reset link", errorText(err));
    }
  }
  private async resend(u: AdminUser) {
    try {
      await this.api.resendInvitation(u.id);
      this.toast.show('Invitation sent again', { body: `${u.email} has a new link, valid for 7 days. The old one no longer works.`, tone: 'info' });
    } catch (err) {
      this.toast.error("Couldn't resend the invitation", errorText(err));
    }
  }
  private async setStatus(u: AdminUser, to: 'activate' | 'deactivate', undo = false) {
    try {
      const saved = to === 'deactivate' ? await this.api.deactivate(u.id) : await this.api.activate(u.id);
      await this.load();
      if (undo) return;
      if (to === 'deactivate') {
        this.toast.show(`${u.name} deactivated`, {
          body: 'They are signed out and can no longer sign in.',
          action: { label: 'Undo', run: () => void this.setStatus(saved, 'activate', true) },
        });
      } else {
        this.toast.show(`${u.name} activated`, {
          body: saved.status === 'Invited' ? 'They never accepted their invitation, so we sent a new one.' : undefined,
          action: { label: 'Undo', run: () => void this.setStatus(saved, 'deactivate', true) },
        });
      }
    } catch (err) {
      this.toast.error(to === 'deactivate' ? `Couldn't deactivate ${u.name}` : `Couldn't activate ${u.name}`, errorText(err));
    }
  }

  // ── Delete (through the deletion audit) ────────────────────
  protected readonly deleteOpen = signal(false);
  protected readonly deleteTarget = signal<AdminUser | null>(null);
  protected readonly deleteReason = signal('');
  protected readonly deleteBusy = signal(false);
  protected readonly deleteError = signal('');
  private askDelete(u: AdminUser) {
    this.deleteTarget.set(u);
    this.deleteReason.set('');
    this.deleteError.set('');
    this.deleteOpen.set(true);
  }
  protected async requestDelete() {
    const u = this.deleteTarget();
    if (!u || this.deleteBusy()) return;
    this.deleteBusy.set(true);
    this.deleteError.set('');
    try {
      await this.audit.request('user', u.id, this.deleteReason());
      this.deleteOpen.set(false);
      this.toast.show('Deletion requested', { body: `Someone else with edit access to the deletion audit approves it. ${u.name} stays until then.` });
    } catch (err) {
      this.deleteError.set(errorText(err));
    } finally {
      this.deleteBusy.set(false);
    }
  }

  // ── Dialog ─────────────────────────────────────────────────
  protected readonly open = signal(false);
  protected readonly tried = signal(false);
  protected readonly saving = signal(false);
  protected readonly draft = signal<Draft>(this.blank());
  private readonly original = signal<AdminUser | null>(null);
  protected readonly serverErrors = signal<Errors>({});
  protected readonly dialogRoles = signal<Group[]>([]);
  protected readonly managers = signal<AdminUser[]>([]);
  protected readonly dialogLoading = signal(false);
  protected readonly dialogLoadError = signal('');

  /** Organizations a platform user can add people to from "All organizations". */
  protected readonly orgChoices = computed<Organization[]>(() => this.store.organizations().filter((o) => o.status !== 'Suspended'));
  /** Pick the organization in the dialog only for new users in the all-organizations view. */
  protected readonly pickOrgInDialog = computed(() => this.allOrgs() && this.draft().id == null);

  /** Editing yourself: the one admin role you still hold can't be unticked. */
  protected readonly lockedRole = computed(() => {
    const o = this.original();
    if (!o || !this.isMe(o) || o.isSuperuser) return null;
    const admin = this.dialogRoles().filter((g) => isAdminRole(g) && this.draft().roleIds.includes(g.id));
    return admin.length === 1 ? admin[0].id : null;
  });

  private blank(): Draft {
    return {
      id: null, orgId: this.allOrgs() ? null : this.store.writeOrgId(), name: '', email: '', phone: '', roleIds: [], managerId: null,
    };
  }
  protected add() {
    if (!this.canWrite() || this.createBlocked()) return;
    this.original.set(null);
    this.draft.set(this.blank());
    this.openDialog();
  }
  protected edit(u: AdminUser) {
    if (!this.editable(u)) return;
    this.original.set(u);
    this.draft.set({ id: u.id, orgId: u.orgId, name: u.name, email: u.email, phone: u.phone, roleIds: u.roles.map((r) => r.id), managerId: u.manager?.id ?? null });
    this.openDialog();
  }
  private openDialog() {
    this.tried.set(false);
    this.serverErrors.set({});
    this.open.set(true);
    void this.loadDialogData();
  }
  /** The draft organization's roles (never templates) and its active users as managers. */
  protected async loadDialogData() {
    const d = this.draft();
    this.dialogRoles.set([]);
    this.managers.set([]);
    this.dialogLoadError.set('');
    if (d.orgId == null) return;
    const org = this.store.crossTenant() ? d.orgId : null;
    this.dialogLoading.set(true);
    try {
      const [roles, users] = await Promise.all([
        this.rolesApi.list({ include_templates: false, organization: org, limit: 100 }),
        this.api.list({ organization: org, status: 'Active', limit: 100 }),
      ]);
      if (this.draft().orgId !== d.orgId) return;
      this.dialogRoles.set(roles.rows.filter((r) => r.orgId === d.orgId || r.orgId == null).filter((r) => !r.isTemplate));
      this.managers.set(users.rows.filter((u) => u.id !== d.id));
    } catch (err) {
      this.dialogLoadError.set(errorText(err));
    } finally {
      this.dialogLoading.set(false);
    }
  }
  protected set<K extends keyof Draft>(k: K, v: Draft[K]) {
    this.draft.update((d) => ({ ...d, [k]: v }));
    this.serverErrors.set({});
  }
  /** Roles and managers belong to one organization: changing it clears both. */
  protected setOrg(v: string) {
    this.draft.update((d) => ({ ...d, orgId: v ? Number(v) : null, roleIds: [], managerId: null }));
    this.serverErrors.set({});
    void this.loadDialogData();
  }
  protected setManager(v: string) {
    this.set('managerId', v ? Number(v) : null);
  }
  protected toggleRole(id: number, on: boolean) {
    if (!on && id === this.lockedRole()) return;
    this.draft.update((d) => ({ ...d, roleIds: on ? [...new Set([...d.roleIds, id])] : d.roleIds.filter((x) => x !== id) }));
    this.serverErrors.set({});
  }

  protected readonly errors = computed<Errors>(() => {
    const d = this.draft();
    const e: Errors = {};
    if (d.orgId == null) e.orgId = 'Choose the organization they work for.';
    if (!d.name.trim()) e.name = 'Enter their full name.';
    else if (d.name.trim().length > 120) e.name = 'Keep the name under 120 characters.';
    if (!d.email) e.email = 'Enter their work email.';
    else if (!EMAIL_RE.test(d.email) || d.email.length > 254) e.email = 'Enter an email such as name@company.com.';
    if (d.phone.trim() && !phoneOk(d.phone.trim())) e.phone = 'Include the country code, like +974 5512 3456.';
    if (d.orgId != null && !d.roleIds.length) e.roles = 'Choose at least one role.';
    const o = this.original();
    const admin = (ids: number[]) => ids.some((id) => this.dialogRoles().some((g) => g.id === id && isAdminRole(g)));
    if (o && this.isMe(o) && !o.isSuperuser && admin(o.roles.map((r) => r.id)) && !admin(d.roleIds)) {
      e.roles = "You can't remove your own last admin role. Ask another admin.";
    }
    return { ...e, ...this.serverErrors() };
  });

  protected async save() {
    this.tried.set(true);
    this.serverErrors.set({});
    if (Object.keys(this.errors()).length || this.saving()) return;
    const d = this.draft();
    const prev = this.original();
    this.saving.set(true);
    try {
      if (prev) {
        await this.api.update(prev.id, {
          full_name: d.name.trim(), phone: d.phone.trim(), role_ids: d.roleIds, manager_id: d.managerId,
        });
        this.toast.show(`${d.name.trim()} updated`);
        // Changing my own roles changes what I can do.
        if (this.isMe(prev)) void this.session.refreshAccess();
      } else {
        await this.api.create({
          full_name: d.name.trim(),
          email: d.email.trim().toLowerCase(),
          ...(d.phone.trim() ? { phone: d.phone.trim() } : {}),
          role_ids: d.roleIds,
          ...(d.managerId != null ? { manager_id: d.managerId } : {}),
          // Only a platform user who picked an organization sends one; partners never do.
          ...(this.store.crossTenant() && d.orgId != null ? { organization_id: d.orgId } : {}),
        });
        this.toast.show(`${d.name.trim()} invited`, { body: `A link to set a password went to ${d.email.trim().toLowerCase()}. It works for 7 days.` });
      }
      this.open.set(false);
      await this.load();
    } catch (err) {
      this.serverErrors.set(dialogErrors(err));
    } finally {
      this.saving.set(false);
    }
  }
}

/** Server refusals → the field they belong to (USERS_API codes and `data.errors`). */
function dialogErrors(err: unknown): Errors {
  if (!(err instanceof ApiError)) return { form: errorText(err) };
  const f = err.fieldErrors;
  const out: Errors = {};
  if (f['full_name']) out.name = f['full_name'][0];
  if (f['email']) out.email = f['email'][0];
  if (f['phone']) out.phone = f['phone'][0];
  if (f['role_ids']) out.roles = f['role_ids'][0];
  if (f['manager_id']) out.manager = f['manager_id'][0];
  if (f['organization_id']) out.orgId = f['organization_id'][0];
  switch (err.code) {
    case UserCode.EmailTaken:
      out.email = err.message;
      break;
    case UserCode.NoRole:
    case UserCode.BadRole:
    case UserCode.OwnAdmin:
      out.roles = err.message;
      break;
    case UserCode.BadManager:
      out.manager = err.message;
      break;
    case UserCode.NoSeats:
    case UserCode.Suspended:
      out.form = err.message;
      break;
  }
  if (!Object.keys(out).length) out.form = err.message;
  return out;
}
