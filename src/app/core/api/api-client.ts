import { HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Observable, firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ApiEnvelope, AuthError, NETWORK_ERROR_MESSAGE } from '../auth/auth.models';
import { toAuthError } from '../auth/auth.service';

/** `{BACKEND_URL}/api/v1`; every module service builds its paths on it. */
export const apiUrl = (path: string) => `${environment.apiUrl}${path}`;

/** List responses (ARCHITECTURE.md §2): `{ results, count }` plus any extra keys a contract names. */
export interface Page<T> {
  results: T[];
  count: number;
}

/** Shared codes every module uses (ARCHITECTURE.md §2). */
export const ApiCode = {
  NoAccess: 4007,
  NotFound: 4008,
  Validation: 4019,
  PasswordExpired: 4020,
} as const;

/**
 * A failed API call: the HTTP status, the envelope's `status` code and `message` (shown to the user as is)
 * and its `data`. Extends AuthError so auth screens and module screens branch the same way.
 */
export class ApiError extends AuthError {
  constructor(httpStatus: number, code: number | null, message: string, data: Record<string, unknown> | null = null) {
    super(httpStatus, code, message, data);
    this.name = 'ApiError';
  }

  /** `data.errors` of a 400 `4019`/`4501`: `{ field: ["message", …] }`, or `{}`. */
  get fieldErrors(): Record<string, string[]> {
    const raw = this.data?.['errors'];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) out[k] = Array.isArray(v) ? v.map(String) : [String(v)];
    return out;
  }

  /** The first message for a field (`fieldErrors[field][0]`). */
  field(name: string): string | undefined {
    return this.fieldErrors[name]?.[0];
  }
}

/** Any failure → ApiError carrying the envelope's message (or a plain fallback). */
export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  const a = toAuthError(err);
  return new ApiError(a.httpStatus, a.code, a.message, a.data);
}

/** The error's message for a toast, whatever was thrown. */
export function errorText(err: unknown): string {
  if (err instanceof AuthError) return err.message;
  return NETWORK_ERROR_MESSAGE;
}

/** Awaits one request and returns the envelope's `data`; any failure becomes an ApiError. */
export async function unwrap<T>(req: Observable<ApiEnvelope<T>>): Promise<T> {
  try {
    return (await firstValueFrom(req)).data;
  } catch (err) {
    throw toApiError(err);
  }
}

/**
 * Error bodies of a `responseType: 'blob'` request (the CSV export) arrive as a Blob; read the
 * enveloped JSON out of it so the message reaches the user.
 */
export async function blobError(err: unknown): Promise<ApiError> {
  if (err instanceof HttpErrorResponse && err.error instanceof Blob) {
    try {
      const body = JSON.parse(await err.error.text());
      return toApiError(new HttpErrorResponse({ error: body, status: err.status, statusText: err.statusText, url: err.url ?? undefined }));
    } catch {
      /* not JSON: fall through to the generic message */
    }
  }
  return toApiError(err);
}

type ParamValue = string | number | boolean | null | undefined;

/** Query params without the empty ones, so `?search=` is never sent blank. */
export function query(params: Record<string, ParamValue>): HttpParams {
  let p = new HttpParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === '') continue;
    p = p.set(k, String(v));
  }
  return p;
}
