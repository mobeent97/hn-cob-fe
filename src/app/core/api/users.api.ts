import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { ApiEnvelope } from '../auth/auth.models';
import { AdminUser, UserStatus } from '../data/models';
import { Page, apiUrl, query, unwrap } from './api-client';

/** Users API v1 (hn-cob-be/docs/USERS_API.md). JSON is snake_case; screens use the camelCase models. */

export interface RoleRefDto {
  id: number;
  name: string;
  is_admin: boolean;
}

export interface UserDto {
  id: number;
  email: string;
  full_name: string;
  phone: string;
  status: UserStatus;
  is_superuser: boolean;
  organization: { id: number; name: string; kind: string; status: string } | null;
  roles: RoleRefDto[];
  manager: { id: number; full_name: string; email: string } | null;
  last_login: string | null;
  invited_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserCounts {
  all: number;
  active: number;
  inactive: number;
  invited: number;
  never_signed_in: number;
}

export interface UserListDto extends Page<UserDto> {
  counts: UserCounts;
  seats: { used: number; max: number | null } | null;
}

export interface UserQuery {
  search?: string;
  status?: UserStatus;
  never_signed_in?: boolean;
  role?: number;
  no_role?: boolean;
  organization?: number | null;
  ordering?: string;
  offset?: number;
  limit?: number;
}

export interface UserCreate {
  full_name: string;
  email: string;
  phone?: string;
  role_ids: number[];
  manager_id?: number | null;
  organization_id?: number;
}

export interface UserPatch {
  full_name?: string;
  phone?: string;
  role_ids?: number[];
  manager_id?: number | null;
}

export interface UserList {
  rows: AdminUser[];
  count: number;
  counts: UserCounts;
  seats: { used: number; max: number | null } | null;
}

/** Message codes the Users screens branch on. */
export const UserCode = {
  Created: 4100,
  EmailTaken: 4102,
  NoSeats: 4103,
  Superuser: 4104,
  Yourself: 4105,
  OwnAdmin: 4106,
  NoRole: 4107,
  BadRole: 4108,
  BadManager: 4109,
  Suspended: 4119,
  SameStatus: 4120,
} as const;

export function toAdminUser(d: UserDto): AdminUser {
  return {
    id: d.id,
    orgId: d.organization?.id ?? 0,
    orgName: d.organization?.name ?? '',
    isSuperuser: d.is_superuser,
    name: d.full_name,
    email: d.email,
    phone: d.phone ?? '',
    roles: (d.roles ?? []).map((r) => ({ id: r.id, name: r.name, isAdmin: r.is_admin })),
    manager: d.manager ? { id: d.manager.id, name: d.manager.full_name, email: d.manager.email } : null,
    status: d.status,
    lastLogin: d.last_login,
    invitedAt: d.invited_at ?? null,
    createdAt: d.created_at ?? null,
  };
}

@Injectable({ providedIn: 'root' })
export class UsersApi {
  private readonly http = inject(HttpClient);
  private readonly base = apiUrl('/users');

  async list(q: UserQuery = {}): Promise<UserList> {
    const d = await unwrap(this.http.get<ApiEnvelope<UserListDto>>(`${this.base}/`, { params: query({ ...q }) }));
    return { rows: d.results.map(toAdminUser), count: d.count, counts: d.counts, seats: d.seats ?? null };
  }

  async get(id: number): Promise<AdminUser> {
    return toAdminUser(await unwrap(this.http.get<ApiEnvelope<UserDto>>(`${this.base}/${id}/`)));
  }

  async create(body: UserCreate): Promise<AdminUser> {
    return toAdminUser(await unwrap(this.http.post<ApiEnvelope<UserDto>>(`${this.base}/`, body)));
  }

  async update(id: number, body: UserPatch): Promise<AdminUser> {
    return toAdminUser(await unwrap(this.http.patch<ApiEnvelope<UserDto>>(`${this.base}/${id}/`, body)));
  }

  async deactivate(id: number): Promise<AdminUser> {
    return toAdminUser(await unwrap(this.http.post<ApiEnvelope<UserDto>>(`${this.base}/${id}/deactivate/`, {})));
  }

  /** Back to Active, or Invited again (with a fresh link) for someone who never accepted. */
  async activate(id: number): Promise<AdminUser> {
    return toAdminUser(await unwrap(this.http.post<ApiEnvelope<UserDto>>(`${this.base}/${id}/activate/`, {})));
  }

  /** Emails a 24-hour reset link. */
  async sendPasswordReset(id: number): Promise<void> {
    await unwrap(this.http.post<ApiEnvelope<unknown>>(`${this.base}/${id}/send-password-reset/`, {}));
  }

  /** A new 7-day invitation link; the old one stops working. */
  async resendInvitation(id: number): Promise<void> {
    await unwrap(this.http.post<ApiEnvelope<unknown>>(`${this.base}/${id}/resend-invitation/`, {}));
  }
}
