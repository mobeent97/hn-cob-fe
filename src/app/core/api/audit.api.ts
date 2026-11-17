import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope } from '../auth/auth.models';
import { DeletionAudit, DeletionEntity, DeletionRequestStatus } from '../data/models';
import { Page, apiUrl, blobError, query, unwrap } from './api-client';

/** Deletion audit API v1 (hn-cob-be/docs/AUDIT_API.md). */

export interface DeletionRequestDto {
  id: number;
  entity_type: DeletionEntity;
  entity_id: number;
  organization: { id: number; name: string } | null;
  organization_name: string;
  name: string;
  email: string;
  entity_created_at: string | null;
  related: { devices?: string[]; users?: string[]; roles?: string[] };
  reason: string;
  status: DeletionRequestStatus;
  requested_by: { id: number; full_name: string } | null;
  requested_by_name: string;
  requested_at: string;
  decided_by: { id: number; full_name: string } | null;
  decided_by_name: string;
  decided_at: string | null;
  deleted_at: string | null;
}

export interface DeletionSummary {
  deleted: number;
  by_type: { user: number; organization: number; customer: number };
  related: { devices: number; users: number };
}

export interface RequestQuery {
  status?: DeletionRequestStatus;
  entity_type?: DeletionEntity;
  organization?: number | null;
  search?: string;
  ordering?: string;
  offset?: number;
  limit?: number;
}

export interface DeletionQuery {
  search?: string;
  entity_type?: DeletionEntity;
  organization?: number | null;
  deleted_from?: string;
  deleted_to?: string;
  ordering?: string;
  offset?: number;
  limit?: number;
}

export const AuditCode = {
  Requested: 4400,
  AlreadyPending: 4403,
  DeactivateFirst: 4404,
  OwnRequest: 4405,
  NotPending: 4406,
  CantDelete: 4408,
} as const;

export function toDeletion(d: DeletionRequestDto): DeletionAudit {
  return {
    id: d.id,
    entityType: d.entity_type,
    entityId: d.entity_id,
    orgId: d.organization?.id ?? null,
    orgName: d.organization_name ?? d.organization?.name ?? '',
    customer: d.name,
    email: d.email,
    reason: d.reason ?? '',
    status: d.status,
    requestedById: d.requested_by?.id ?? null,
    deletedBy: d.requested_by_name,
    requestedAt: d.requested_at,
    approvedBy: d.decided_by_name ?? '',
    decidedAt: d.decided_at,
    createdAt: d.entity_created_at,
    deletedAt: d.deleted_at,
    devices: d.related?.devices ?? [],
    related: d.related ?? {},
  };
}

@Injectable({ providedIn: 'root' })
export class AuditApi {
  private readonly http = inject(HttpClient);
  private readonly base = apiUrl('/audit');

  /** Deletion requests; the server defaults `status` to Pending. */
  async requests(q: RequestQuery = {}): Promise<{ rows: DeletionAudit[]; count: number }> {
    const d = await unwrap(this.http.get<ApiEnvelope<Page<DeletionRequestDto>>>(`${this.base}/deletion-requests/`, { params: query({ ...q }) }));
    return { rows: d.results.map(toDeletion), count: d.count };
  }

  /** Asks for a deletion; someone else with Audit read & write approves it. */
  async request(entityType: DeletionEntity, entityId: number, reason = ''): Promise<DeletionAudit> {
    const body = reason.trim() ? { entity_type: entityType, entity_id: entityId, reason: reason.trim() } : { entity_type: entityType, entity_id: entityId };
    return toDeletion(await unwrap(this.http.post<ApiEnvelope<DeletionRequestDto>>(`${this.base}/deletion-requests/`, body)));
  }

  async approve(id: number): Promise<DeletionAudit> {
    return toDeletion(await unwrap(this.http.post<ApiEnvelope<DeletionRequestDto>>(`${this.base}/deletion-requests/${id}/approve/`, {})));
  }

  async cancel(id: number): Promise<DeletionAudit> {
    return toDeletion(await unwrap(this.http.post<ApiEnvelope<DeletionRequestDto>>(`${this.base}/deletion-requests/${id}/cancel/`, {})));
  }

  /** The audit trail (Completed rows only), with a summary over the whole filtered set. */
  async deletions(q: DeletionQuery = {}): Promise<{ rows: DeletionAudit[]; count: number; summary: DeletionSummary }> {
    const d = await unwrap(
      this.http.get<ApiEnvelope<Page<DeletionRequestDto> & { summary: DeletionSummary }>>(`${this.base}/deletions/`, { params: query({ ...q }) }),
    );
    return { rows: d.results.map(toDeletion), count: d.count, summary: d.summary };
  }

  /** The CSV file (not enveloped). Errors are enveloped JSON inside the blob. */
  async export(q: Omit<DeletionQuery, 'offset' | 'limit'> = {}): Promise<{ blob: Blob; filename: string }> {
    try {
      const res = await firstValueFrom(
        this.http.get(`${this.base}/deletions/export/`, { params: query({ ...q }), responseType: 'blob', observe: 'response' }),
      );
      const cd = res.headers.get('Content-Disposition') ?? '';
      const filename = /filename="?([^";]+)"?/.exec(cd)?.[1] ?? `deletion-audit-${new Date().toISOString().slice(0, 10)}.csv`;
      return { blob: res.body ?? new Blob([]), filename };
    } catch (err) {
      throw await blobError(err);
    }
  }
}
