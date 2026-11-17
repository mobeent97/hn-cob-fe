import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { ApiEnvelope } from '../auth/auth.models';
import { Organization, Permission } from '../data/models';
import { Page, apiUrl, query, unwrap } from './api-client';
import { UserDto, toAdminUser } from './users.api';
import { AdminUser } from '../data/models';

/** Organizations API v1 (hn-cob-be/docs/ORGANIZATIONS_API.md). */

type Kind = 'Platform' | 'Partner';
type Status = 'Active' | 'Invited' | 'Suspended';
type Segment = 'B2B' | 'B2C';

export interface LimitsDto {
  max_customers: number | null;
  max_users: number | null;
}

export interface OrganizationDto {
  id: number;
  name: string;
  legal_name: string;
  kind: Kind;
  status: Status;
  countries: string[];
  segments: Segment[];
  features: Record<string, 'R' | 'RW'>;
  limits: LimitsDto;
  contact: { name: string; email: string; phone: string };
  /** Null when blank (BRANDING_MEDIA_EMAIL.md 1.3). */
  brand_colour: string | null;
  logo_url: string | null;
  logo_updated_at: string | null;
  admin: { id: number; full_name: string; email: string; status: string } | null;
  usage: {
    users: number;
    active_users: number;
    invited_users: number;
    seats_used: number;
    roles: number;
    customers: number;
    consumers: number;
    devices: number;
    devices_in_service: number;
    orders: number;
  };
  created_at: string;
  updated_at: string;
}

export interface OrganizationOptionDto {
  id: number;
  name: string;
  kind: Kind;
  status: Status;
  brand_colour: string | null;
  logo_url: string | null;
  segments: Segment[];
  features: Record<string, 'R' | 'RW'>;
  limits: LimitsDto;
}

export interface EntitlementImpact {
  changes: { feature: string; from: 'R' | 'RW' | null; to: 'R' | 'RW' | null; direction: 'lower' | 'raise'; affected_users: number }[];
  affected_total: number;
  affected: { user: { id: number; full_name: string; email: string }; features: string[] }[];
}

export interface OrganizationListDto extends Page<OrganizationDto> {
  summary: { partners: number; invited: number; suspended: number };
}

export interface OrganizationQuery {
  search?: string;
  status?: Status;
  kind?: Kind;
  country?: string;
  ordering?: string;
  offset?: number;
  limit?: number;
}

export interface OrganizationCreate {
  name: string;
  legal_name: string;
  countries: string[];
  segments: Segment[];
  brand_colour: string;
  features: Record<string, Permission>;
  limits: LimitsDto;
  admin: { full_name: string; email: string; phone?: string };
  contact?: { name: string; email: string; phone: string };
}

export interface OrganizationPatch {
  name?: string;
  legal_name?: string;
  countries?: string[];
  segments?: Segment[];
  brand_colour?: string;
  contact?: { name: string; email: string; phone: string };
}

export const OrgCode = {
  NameTaken: 4302,
  PlatformLocked: 4303,
  PlatformOnly: 4305,
  ConsumersNeedB2C: 4306,
  SameStatus: 4310,
  NoPendingInvite: 4312,
  NoFeature: 4314,
} as const;

/** BRANDING_MEDIA_EMAIL.md section 3: logo upload and removal. The server's `message` is shown as is. */
export const LogoCode = {
  Saved: 4600,
  Removed: 4601,
  NotPngOrJpeg: 4602,
  TooLarge: 4603,
  Dimensions: 4604,
  Unreadable: 4605,
  NoLogo: 4606,
  StorageUnavailable: 4607,
} as const;

/** The full feature map with `null` for "none", as PUT /features/ expects. */
export function fullFeatureMap(keys: string[], f: Record<string, Permission>): Record<string, Permission> {
  return Object.fromEntries(keys.map((k) => [k, f[k] ?? null]));
}

const blankUsage = () => ({
  users: 0, activeUsers: 0, invitedUsers: 0, seatsUsed: 0, roles: 0, customers: 0, consumers: 0, devices: 0, devicesInService: 0, orders: 0,
});

export function toOrganization(d: OrganizationDto): Organization {
  const u = d.usage;
  return {
    id: d.id,
    name: d.name,
    legalName: d.legal_name,
    kind: d.kind,
    status: d.status,
    countries: d.countries ?? [],
    segments: d.segments ?? [],
    features: { ...d.features },
    limits: { maxCustomers: d.limits?.max_customers ?? null, maxUsers: d.limits?.max_users ?? null },
    contact: { name: d.contact?.name ?? '', email: d.contact?.email ?? '', phone: d.contact?.phone ?? '' },
    brandColour: d.brand_colour ?? '',
    logoUrl: d.logo_url ?? null,
    logoUpdatedAt: d.logo_updated_at ?? null,
    createdAt: d.created_at,
    updatedAt: d.updated_at,
    admin: d.admin ? { id: d.admin.id, name: d.admin.full_name, email: d.admin.email, status: d.admin.status } : null,
    usage: u
      ? {
          users: u.users, activeUsers: u.active_users, invitedUsers: u.invited_users, seatsUsed: u.seats_used, roles: u.roles,
          customers: u.customers, consumers: u.consumers, devices: u.devices, devicesInService: u.devices_in_service, orders: u.orders,
        }
      : blankUsage(),
  };
}

/** The options row lacks the profile fields; they stay empty until the full object is loaded. */
export function fromOption(d: OrganizationOptionDto): Organization {
  return {
    id: d.id,
    name: d.name,
    legalName: '',
    kind: d.kind,
    status: d.status,
    countries: [],
    segments: d.segments ?? [],
    features: { ...d.features },
    limits: { maxCustomers: d.limits?.max_customers ?? null, maxUsers: d.limits?.max_users ?? null },
    contact: { name: '', email: '', phone: '' },
    brandColour: d.brand_colour ?? '',
    logoUrl: d.logo_url ?? null,
    createdAt: '',
  };
}

@Injectable({ providedIn: 'root' })
export class OrganizationsApi {
  private readonly http = inject(HttpClient);
  private readonly base = apiUrl('/organizations');

  /** Every signed-in user: their own organization, or all of them for platform users. */
  async options(): Promise<Organization[]> {
    return (await unwrap(this.http.get<ApiEnvelope<OrganizationOptionDto[]>>(`${this.base}/options/`))).map(fromOption);
  }

  async list(q: OrganizationQuery = {}): Promise<{ rows: Organization[]; count: number; summary: OrganizationListDto['summary'] }> {
    const d = await unwrap(this.http.get<ApiEnvelope<OrganizationListDto>>(`${this.base}/`, { params: query({ ...q }) }));
    return { rows: d.results.map(toOrganization), count: d.count, summary: d.summary };
  }

  async get(id: number): Promise<Organization> {
    return toOrganization(await unwrap(this.http.get<ApiEnvelope<OrganizationDto>>(`${this.base}/${id}/`)));
  }

  /** Creates the partner (Invited), copies the role templates and invites its first administrator. */
  async create(body: OrganizationCreate): Promise<Organization> {
    return toOrganization(await unwrap(this.http.post<ApiEnvelope<OrganizationDto>>(`${this.base}/`, body)));
  }

  /** `removedFeatures` lists what dropping B2C took away (`Consumers`). */
  async update(id: number, body: OrganizationPatch): Promise<{ org: Organization; removedFeatures: string[] }> {
    const d = await unwrap(
      this.http.patch<ApiEnvelope<OrganizationDto & { removed_features?: string[] }>>(`${this.base}/${id}/`, body),
    );
    return { org: toOrganization(d), removedFeatures: d.removed_features ?? [] };
  }

  /** Saves the full entitlement map; the impact was computed before the save. */
  async setFeatures(id: number, features: Record<string, Permission>): Promise<{ org: Organization; impact: EntitlementImpact }> {
    const d = await unwrap(
      this.http.put<ApiEnvelope<{ organization: OrganizationDto; impact: EntitlementImpact }>>(`${this.base}/${id}/features/`, { features }),
    );
    return { org: toOrganization(d.organization), impact: d.impact };
  }

  previewFeatures(id: number, features: Record<string, Permission>): Promise<EntitlementImpact> {
    return unwrap(this.http.post<ApiEnvelope<EntitlementImpact>>(`${this.base}/${id}/features/preview/`, { features }));
  }

  /** `overLimit` = `["users"]` when usage is already above a new limit. */
  async setLimits(id: number, limits: LimitsDto): Promise<{ org: Organization; overLimit: string[] }> {
    const d = await unwrap(this.http.patch<ApiEnvelope<OrganizationDto & { over_limit?: string[] }>>(`${this.base}/${id}/limits/`, limits));
    return { org: toOrganization(d), overLimit: d.over_limit ?? [] };
  }

  async suspend(id: number): Promise<Organization> {
    return toOrganization(await unwrap(this.http.post<ApiEnvelope<OrganizationDto>>(`${this.base}/${id}/suspend/`, {})));
  }

  async reactivate(id: number): Promise<Organization> {
    return toOrganization(await unwrap(this.http.post<ApiEnvelope<OrganizationDto>>(`${this.base}/${id}/reactivate/`, {})));
  }

  async resendInvitation(id: number): Promise<string[]> {
    return (await unwrap(this.http.post<ApiEnvelope<{ sent_to: string[] }>>(`${this.base}/${id}/resend-invitation/`, {}))).sent_to ?? [];
  }

  /** Uploads or replaces the logo (multipart, one field `file`); returns the organization with its new `logo_url`. */
  async uploadLogo(id: number, file: Blob, filename = 'logo'): Promise<Organization> {
    const body = new FormData();
    body.append('file', file, filename);
    return toOrganization(await unwrap(this.http.post<ApiEnvelope<OrganizationDto>>(`${this.base}/${id}/logo/`, body)));
  }

  /** Removes the logo; 409 `4606` when there is none. */
  async deleteLogo(id: number): Promise<Organization> {
    return toOrganization(await unwrap(this.http.delete<ApiEnvelope<OrganizationDto>>(`${this.base}/${id}/logo/`)));
  }

  async addAdministrator(id: number, body: { full_name: string; email: string; phone?: string }): Promise<AdminUser> {
    return toAdminUser(await unwrap(this.http.post<ApiEnvelope<UserDto>>(`${this.base}/${id}/administrators/`, body)));
  }
}
