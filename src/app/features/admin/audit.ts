import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { Store } from '../../core/data/store';
import { DatePipe, RelativePipe } from '../../core/data/format';
import { DeletionAudit, DeletionEntity } from '../../core/data/models';
import { AuditApi, DeletionQuery, DeletionSummary } from '../../core/api/audit.api';
import { errorText } from '../../core/api/api-client';
import { Icon } from '../../shared/ui/icon';
import { Pager } from '../../shared/ui/pager';
import { Dialog } from '../../shared/ui/dialog';
import { Toaster } from '../../shared/ui/toast';
import { LoadError, loadState } from '../../shared/ui/load-state';
import { Select, SelectOption } from '../../shared/ui/select';
import { OrgFilter, OrgTag, ReadOnlyNote, orgContext, writeAccess } from '../tenancy';

type TypeFilter = 'all' | DeletionEntity;
const TYPE_LABEL: Record<DeletionEntity, string> = { user: 'User', organization: 'Organization', customer: 'Customer' };
const NO_SUMMARY: DeletionSummary = { deleted: 0, by_type: { user: 0, organization: 0, customer: 0 }, related: { devices: 0, users: 0 } };

/**
 * Deletion audit — "Which deletions are waiting for me, and who removed what?"
 * Pending requests (GET /audit/deletion-requests/) sit above the log because they are the only thing
 * here that needs action. The log is the audit trail (GET /audit/deletions/, Completed rows) with a
 * summary over the whole filtered set. Four eyes: the approver is never the requester (superusers excepted).
 * Related items are real arrays (the legacy API sent a Python-repr string).
 */
@Component({
  selector: 'app-audit',
  imports: [Icon, Pager, Dialog, DatePipe, RelativePipe, OrgTag, OrgFilter, ReadOnlyNote, LoadError, Select, SelectOption],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './audit.html',
  styleUrl: './audit.css',
})
export class Audit {
  protected readonly store = inject(Store);
  private readonly api = inject(AuditApi);
  private readonly toast = inject(Toaster);
  protected readonly typeLabel = TYPE_LABEL;

  protected readonly q = signal('');
  private readonly qSent = signal('');
  protected readonly type = signal<TypeFilter>('all');
  protected readonly page = signal(1);
  protected readonly size = computed(() => this.store.settings().pagination.pageSize);
  /** Approving or cancelling a deletion needs read/write on the Audit feature. */
  protected readonly access = writeAccess('Audit');
  protected readonly canApprove = this.access.rw;
  protected readonly orgs = orgContext();
  protected readonly orgId = signal<number | null>(null);
  protected readonly me = this.store.currentUser;

  protected readonly pendingState = loadState();
  protected readonly logState = loadState();
  protected readonly pending = signal<DeletionAudit[]>([]);
  protected readonly rows = signal<DeletionAudit[]>([]);
  protected readonly count = signal(0);
  protected readonly summary = signal<DeletionSummary>(NO_SUMMARY);

  /** The organization filter as the API param: the toolbar pick (all-organizations view) or the switcher's. */
  private readonly orgParam = computed<number | null>(() => {
    if (!this.store.crossTenant()) return null;
    return this.orgs.showOrg() ? this.orgId() : this.store.scopeOrgId();
  });
  private readonly typeParam = computed(() => (this.type() === 'all' ? undefined : (this.type() as DeletionEntity)));

  constructor() {
    let t: ReturnType<typeof setTimeout> | undefined;
    effect(() => {
      const q = this.q();
      clearTimeout(t);
      t = setTimeout(() => this.qSent.set(q.trim()), 250);
    });
    inject(DestroyRef).onDestroy(() => clearTimeout(t));
    effect(() => {
      this.qSent();
      this.orgParam();
      this.type();
      untracked(() => this.page.set(1));
    });
    effect(() => {
      const org = this.orgParam();
      const type = this.typeParam();
      untracked(() => void this.loadPending(org, type));
    });
    effect(() => {
      const q = this.logQuery();
      untracked(() => void this.loadLog(q));
    });
  }

  private readonly filters = computed(() => ({ search: this.qSent() || undefined, organization: this.orgParam(), entity_type: this.typeParam() }));
  private readonly logQuery = computed<DeletionQuery>(() => ({
    ...this.filters(),
    offset: (this.page() - 1) * this.size(),
    limit: this.size(),
  }));

  protected async loadPending(org = this.orgParam(), type = this.typeParam()) {
    const res = await this.pendingState.run(() => this.api.requests({ status: 'Pending', organization: org, entity_type: type, limit: 100 }));
    if (res) this.pending.set(res.rows);
  }
  protected async loadLog(q = this.logQuery()) {
    const res = await this.logState.run(() => this.api.deletions(q));
    if (!res) return;
    this.rows.set(res.rows);
    this.store.audit.all.set(res.rows);
    this.count.set(res.count);
    this.summary.set(res.summary ?? NO_SUMMARY);
  }

  // ── Pending requests ───────────────────────────────────────
  /** Four eyes: someone else approves your request, unless you are a superuser. */
  protected ownRequest(r: DeletionAudit) {
    return r.requestedById === this.me().id && !this.me().isSuperuser;
  }
  protected canCancel(r: DeletionAudit) {
    return this.canApprove() || r.requestedById === this.me().id;
  }
  protected relatedLine(r: DeletionAudit) {
    const parts: string[] = [];
    if (r.related.devices?.length) parts.push(`${r.related.devices.length} ${r.related.devices.length === 1 ? 'device' : 'devices'}`);
    if (r.related.users?.length) parts.push(`${r.related.users.length} ${r.related.users.length === 1 ? 'user' : 'users'}`);
    if (r.related.roles?.length) parts.push(`${r.related.roles.length} ${r.related.roles.length === 1 ? 'role' : 'roles'}`);
    return parts.join(' · ');
  }
  protected relatedCount(r: DeletionAudit) {
    return (r.related.devices?.length ?? 0) + (r.related.users?.length ?? 0) + (r.related.roles?.length ?? 0);
  }

  protected readonly approveOpen = signal(false);
  protected readonly target = signal<DeletionAudit | null>(null);
  protected readonly busy = signal(false);
  protected readonly approveError = signal('');

  protected askApprove(r: DeletionAudit) {
    this.target.set(r);
    this.approveError.set('');
    this.approveOpen.set(true);
  }

  protected readonly approveCopy = computed(() => {
    const r = this.target();
    if (!r) return '';
    if (r.entityType === 'customer') return `The account, its users and its settings are removed. Its ${r.devices.length} ${r.devices.length === 1 ? 'device returns' : 'devices return'} to stock as Available.`;
    if (r.entityType === 'organization') {
      const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
      return `The organization, its ${n(r.related.users?.length ?? 0, 'user', 'users')} and ${n(r.related.roles?.length ?? 0, 'role', 'roles')} are removed for good.`;
    }
    return `${r.customer} (${r.email}) is removed for good. Anyone they managed keeps working with no manager.`;
  });

  protected async approve() {
    const r = this.target();
    if (!r || this.busy()) return;
    this.busy.set(true);
    this.approveError.set('');
    try {
      await this.api.approve(r.id);
      this.approveOpen.set(false);
      this.toast.show(`${r.customer} deleted`, {
        body: r.devices.length ? `${r.devices.length} devices returned to stock. The deletion is in the audit log.` : 'The deletion is in the audit log.',
      });
      await Promise.all([this.loadPending(), this.loadLog()]);
    } catch (err) {
      this.approveError.set(errorText(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected async cancel(r: DeletionAudit) {
    try {
      await this.api.cancel(r.id);
      await this.loadPending();
      this.toast.show('Deletion request cancelled', {
        body: `${r.customer} stays on the platform.`,
        action: { label: 'Undo', run: () => void this.requestAgain(r) },
      });
    } catch (err) {
      this.toast.error("Couldn't cancel the request", errorText(err));
    }
  }
  private async requestAgain(r: DeletionAudit) {
    try {
      await this.api.request(r.entityType, r.entityId, r.reason);
      await this.loadPending();
    } catch (err) {
      this.toast.error("Couldn't request the deletion again", errorText(err));
    }
  }

  // ── Audit log ──────────────────────────────────────────────
  protected readonly filtered = computed(() => !!this.q() || this.type() !== 'all' || this.orgId() != null);
  protected clearFilters() {
    this.q.set('');
    this.qSent.set('');
    this.type.set('all');
    this.orgId.set(null);
  }
  protected pickType(v: string) {
    this.type.set(v as TypeFilter);
  }
  protected readonly cols = computed(() => (this.orgs.showOrg() ? 8 : 7));

  protected readonly relatedOpen = signal(false);
  protected readonly shown = signal<DeletionAudit | null>(null);
  protected showRelated(a: DeletionAudit) {
    this.shown.set(a);
    this.relatedOpen.set(true);
  }
  protected readonly shownGroups = computed(() => {
    const a = this.shown();
    if (!a) return [];
    return [
      { key: 'devices', label: 'Devices returned to stock', ids: a.related.devices ?? [], mono: true },
      { key: 'users', label: 'Users removed', ids: a.related.users ?? [], mono: false },
      { key: 'roles', label: 'Roles removed', ids: a.related.roles ?? [], mono: false },
    ].filter((g) => g.ids.length);
  });
  protected async copyIds() {
    const a = this.shown();
    if (!a) return;
    const ids = this.shownGroups().flatMap((g) => g.ids);
    await navigator.clipboard?.writeText(ids.join('\n')).catch(() => undefined);
    this.toast.show('Copied', { body: `${ids.length} ${ids.length === 1 ? 'item' : 'items'} on the clipboard.`, tone: 'info' });
  }

  protected readonly exporting = signal(false);
  /** The server builds the CSV from the same filters (every page, up to 10,000 rows). */
  protected async export() {
    if (this.exporting()) return;
    this.exporting.set(true);
    try {
      const { blob, filename } = await this.api.export(this.filters());
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement('a'), { href: url, download: filename });
      a.click();
      URL.revokeObjectURL(url);
      this.toast.show('Export ready', { body: `${this.count()} deletions saved as ${filename}.`, tone: 'info' });
    } catch (err) {
      this.toast.error("Couldn't export the audit", errorText(err));
    } finally {
      this.exporting.set(false);
    }
  }
}
