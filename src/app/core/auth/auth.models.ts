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
