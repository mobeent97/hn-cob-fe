import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { ApiEnvelope } from '../auth/auth.models';
import { Group, Permission } from '../data/models';
import { Page, apiUrl, query, unwrap } from './api-client';

/** Roles API v1 (hn-cob-be/docs/ROLES_API.md). */

export type Level = 'R' | 'RW';

export interface FeatureDto {
  key: string;
  label: string;
  area: string;
  description: string;
  platform_only: boolean;
}

export interface RoleDto {
  id: number;
  organization: { id: number; name: string; kind: string } | null;
  is_template: boolean;
  template: { id: number; name: string; key: string } | null;
  key: string | null;
  is_admin: boolean;
  name: string;
  description: string;
  status: 'Active' | 'Inactive';
  permissions: Record<string, Level>;
  effective_permissions: Record<string, Level> | null;
  members: { total: number; active: number };
  created_at: string;
  updated_at: string;
}

export interface RoleImpact {
  members_affected: number;
  affected: { user: { id: number; full_name: string; email: string }; features: string[] }[];
}

export interface RoleQuery {
  organization?: number | null;
  include_templates?: boolean;
  templates_only?: boolean;
  status?: 'Active' | 'Inactive';
  search?: string;
  ordering?: string;
  offset?: number;
  limit?: number;
}

export interface RoleCreate {
  name: string;
  description: string;
  permissions: Record<string, Permission>;
  status?: 'Active' | 'Inactive';
  organization_id?: number;
  is_template?: boolean;
}

export type RolePatch = Partial<Pick<RoleCreate, 'name' | 'description' | 'permissions' | 'status'>>;

export const RoleCode = {
  NameTaken: 4202,
  TemplateByPartner: 4203,
  AbovePlan: 4204,
  BadFeature: 4205,
  OwnAdmin: 4206,
  NoPermission: 4207,
  HasMembers: 4211,
} as const;

/** `null` levels mean none and are dropped before sending (ROLES_API, validation rule 1). */
export function compactPermissions(p: Record<string, Permission>): Record<string, Level> {
  const out: Record<string, Level> = {};
  for (const [k, v] of Object.entries(p)) if (v) out[k] = v;
  return out;
}

export function toGroup(d: RoleDto): Group {
  return {
    id: d.id,
    orgId: d.organization?.id ?? null,
    orgName: d.organization?.name ?? '',
    name: d.name,
    description: d.description,
    status: d.status,
    permissions: { ...d.permissions },
    effectivePermissions: d.effective_permissions ? { ...d.effective_permissions } : null,
    isTemplate: d.is_template,
    key: d.key,
    template: d.template,
    isAdmin: d.is_admin,
    members: d.members ?? { total: 0, active: 0 },
  };
}

@Injectable({ providedIn: 'root' })
export class RolesApi {
  private readonly http = inject(HttpClient);
  private readonly base = apiUrl('/roles');

  /** The feature catalogue (same keys and order as core/access/features.ts). */
  features(): Promise<FeatureDto[]> {
    return unwrap(this.http.get<ApiEnvelope<FeatureDto[]>>(`${this.base}/features/`));
  }

  async list(q: RoleQuery = {}): Promise<{ rows: Group[]; count: number }> {
    const d = await unwrap(this.http.get<ApiEnvelope<Page<RoleDto>>>(`${this.base}/`, { params: query({ ...q }) }));
    return { rows: d.results.map(toGroup), count: d.count };
  }

  async get(id: number): Promise<Group> {
    return toGroup(await unwrap(this.http.get<ApiEnvelope<RoleDto>>(`${this.base}/${id}/`)));
  }

  async create(body: RoleCreate): Promise<Group> {
    const payload = { ...body, permissions: compactPermissions(body.permissions) };
    return toGroup(await unwrap(this.http.post<ApiEnvelope<RoleDto>>(`${this.base}/`, payload)));
  }

  async update(id: number, body: RolePatch): Promise<Group> {
    const payload = body.permissions ? { ...body, permissions: compactPermissions(body.permissions) } : body;
    return toGroup(await unwrap(this.http.patch<ApiEnvelope<RoleDto>>(`${this.base}/${id}/`, payload)));
  }

  /** Who loses access if the draft were saved. */
  preview(id: number, draft: { permissions?: Record<string, Permission>; status?: 'Active' | 'Inactive' }): Promise<RoleImpact> {
    const payload = draft.permissions ? { ...draft, permissions: compactPermissions(draft.permissions) } : draft;
    return unwrap(this.http.post<ApiEnvelope<RoleImpact>>(`${this.base}/${id}/preview/`, payload));
  }

  /** Copies a template, silently capped to the target organization's plan. */
  async copy(id: number, body: { organization_id?: number; name?: string } = {}): Promise<Group> {
    return toGroup(await unwrap(this.http.post<ApiEnvelope<RoleDto>>(`${this.base}/${id}/copy/`, body)));
  }

  async remove(id: number): Promise<void> {
    await unwrap(this.http.delete<ApiEnvelope<unknown>>(`${this.base}/${id}/`));
  }
}
