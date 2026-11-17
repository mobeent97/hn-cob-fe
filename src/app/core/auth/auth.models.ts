/** Types for the Auth API v1 (hn-cob-be/docs/AUTH_API.md). */

/** Every response, success or error: `status` is the backend's internal code, `message` its text. */
export interface ApiEnvelope<T = unknown> {
  status: number;
  message: string;
  data: T;
}

export interface AuthOrganization {
  id: number;
  name: string;
  kind: 'Platform' | 'Partner' | string;
  status: string;
  /** BRANDING_MEDIA_EMAIL.md 1.3: `#rrggbb`, or null when the organization has no brand. */
  brand_colour?: string | null;
  /** A read-only SAS URL (valid for at least 24 hours), or null. */
  logo_url?: string | null;
}

export interface AuthUser {
  id: number;
  email: string;
  full_name: string;
  phone: string;
  is_superuser: boolean;
  status: string;
  last_login: string | null;
  /** Null only for a superuser whose organization hasn't been assigned yet. */
  organization: AuthOrganization | null;
  /** USERS_API "Me object" extensions. */
  roles?: { id: number; name: string; is_admin: boolean }[];
  manager?: { id: number; full_name: string; email: string } | null;
  password_changed_at?: string | null;
  /** Null when passwords never expire (`password.expiry_days` = 0). */
  password_expires_at?: string | null;
}

export type AccessReason = null | 'platform_only' | 'capped_by_plan' | 'no_role' | 'superuser';

/** GET /auth/me/access/ — the server's effective levels (USERS_API "Access object"). */
export interface MeAccess {
  is_superuser: boolean;
  organization: { id: number; name: string; kind: string } | null;
  /** Every feature key; `null` = no access. */
  levels: Record<string, 'R' | 'RW' | null>;
  /** In catalogue order, with why a level is what it is. */
  features: { key: string; level: 'R' | 'RW' | null; org_level: 'R' | 'RW' | null; role_level: 'R' | 'RW' | null; reason: AccessReason }[];
}

/** POST /auth/set-password/verify/ — what an invitation or admin-reset link is for. */
export interface SetPasswordInfo {
  purpose: 'invite' | 'reset';
  email: string;
  full_name: string;
  /** The inviting organization's brand (BRANDING_MEDIA_EMAIL.md 1.3); `kind` Platform keeps the default look. */
  organization: { name: string; kind?: 'Platform' | 'Partner' | string; brand_colour?: string | null; logo_url?: string | null } | null;
  expires_at: string;
}

export interface TokenPair {
  access: string;
  refresh: string;
}

export interface LoginData extends TokenPair {
  user: AuthUser;
}

export interface ForgotPasswordData {
  expires_in?: number;
}

export interface VerifyCodeData {
  reset_token: string;
}

/** Internal status codes the screens branch on. */
export const AuthCode = {
  MissingFields: 4001,
  WrongCredentials: 4002,
  Locked: 4003,
  Inactive: 4004,
  RefreshInvalid: 4005,
  CodeSent: 4010,
  WrongCode: 4011,
  TooManyCodeAttempts: 4012,
  PasswordMismatch: 4013,
  PasswordWeak: 4014,
  ResetTokenInvalid: 4015,
  TooManyRequests: 4016,
  PasswordChanged: 4017,
  PasswordExpired: 4020,
  WrongCurrentPassword: 4117,
  LinkInvalid: 4121,
} as const;

export const NETWORK_ERROR_MESSAGE = "Can't reach the server. Check your connection and try again.";

/** A failed auth call: the HTTP status, the envelope's code and message, and its data (if any). */
export class AuthError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly code: number | null,
    message: string,
    readonly data: Record<string, unknown> | null = null,
  ) {
    super(message);
    this.name = 'AuthError';
  }

  /** True when the request never got an HTTP answer (offline, CORS, server down). */
  get isNetwork() {
    return this.httpStatus === 0;
  }
}
