import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthUser } from './auth.models';
import { AuthService } from './auth.service';
import { authInterceptor } from './auth.interceptor';
import { TokenStorageService } from './token-storage.service';

const API = `${environment.apiUrl}/auth`;
const USER: AuthUser = {
  id: 1, email: 'admin@hypernymbiz.com', full_name: 'Ada Admin', phone: '', is_superuser: true, status: 'Active',
  last_login: null, organization: { id: 1, name: 'HyperNym', kind: 'Platform', status: 'Active' },
};
const ok = <T>(data: T) => ({ status: 1000, message: 'Success', data });

describe('AuthService', () => {
  let auth: AuthService;
  let http: HttpTestingController;
  let tokens: TokenStorageService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(withInterceptors([authInterceptor])), provideHttpClientTesting()],
    });
    auth = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
    tokens = TestBed.inject(TokenStorageService);
  });

  afterEach(() => http.verify());

  it('login stores both tokens and the user', async () => {
    const done = auth.login('admin@hypernymbiz.com', 'Secret123!');
    const req = http.expectOne(`${API}/login/`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ email: 'admin@hypernymbiz.com', password: 'Secret123!' });
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush(ok({ access: 'a1', refresh: 'r1', user: USER }));

    await expect(done).resolves.toEqual(USER);
    expect(tokens.accessToken).toBe('a1');
    expect(tokens.refreshToken).toBe('r1');
    expect(auth.user()).toEqual(USER);
    expect(auth.isAuthenticated()).toBe(true);
  });

  it('login maps an error envelope to an AuthError', async () => {
    const done = auth.login('admin@hypernymbiz.com', 'nope');
    http
      .expectOne(`${API}/login/`)
      .flush({ status: 4003, message: 'Account locked.', data: { locked_until: '2026-11-17T10:00:00Z' } }, { status: 423, statusText: 'Locked' });
    await expect(done).rejects.toMatchObject({
      httpStatus: 423, code: 4003, message: 'Account locked.', data: { locked_until: '2026-11-17T10:00:00Z' },
    });
    expect(tokens.accessToken).toBeNull();
    expect(auth.isAuthenticated()).toBe(false);
  });

  it('maps a network failure to the offline message', async () => {
    const done = auth.forgotPassword('a@b.co');
    http.expectOne(`${API}/forgot-password/`).error(new ProgressEvent('error'));
    await expect(done).rejects.toMatchObject({
      httpStatus: 0, message: "Can't reach the server. Check your connection and try again.",
    });
  });

  it('refresh shares one in-flight request between concurrent callers and stores the rotated pair', async () => {
    tokens.save('a1', 'r1');
    const first = firstValueFrom(auth.refresh());
    const second = firstValueFrom(auth.refresh());
    const req = http.expectOne(`${API}/refresh-token/`);
    expect(req.request.body).toEqual({ refresh: 'r1' });
    req.flush(ok({ access: 'a2', refresh: 'r2' }));

    await expect(first).resolves.toBe('a2');
    await expect(second).resolves.toBe('a2');
    expect(tokens.accessToken).toBe('a2');
    expect(tokens.refreshToken).toBe('r2');

    // Once settled, the next refresh is a new request.
    const third = firstValueFrom(auth.refresh());
    http.expectOne(`${API}/refresh-token/`).flush(ok({ access: 'a3', refresh: 'r3' }));
    await expect(third).resolves.toBe('a3');
  });

  it('logout posts the refresh token and clears the session', async () => {
    tokens.save('a1', 'r1');
    const done = auth.logout();
    const req = http.expectOne(`${API}/logout/`);
    expect(req.request.body).toEqual({ refresh: 'r1' });
    expect(req.request.headers.get('Authorization')).toBe('Bearer a1');
    req.flush(ok({}));
    await done;
    expect(tokens.accessToken).toBeNull();
    expect(tokens.refreshToken).toBeNull();
    expect(auth.user()).toBeNull();
  });

  it('logout clears the session even when the server call fails, without trying a refresh', async () => {
    tokens.save('a1', 'r1');
    const done = auth.logout();
    http.expectOne(`${API}/logout/`).flush({ status: 9999, message: 'Unauthorized', data: null }, { status: 401, statusText: 'Unauthorized' });
    await done;
    http.expectNone(`${API}/refresh-token/`);
    expect(tokens.accessToken).toBeNull();
    expect(tokens.refreshToken).toBeNull();
  });

  it('restoreSession loads the user when tokens exist and clears them silently on failure', async () => {
    tokens.save('a1', 'r1');
    const done = auth.restoreSession();
    http.expectOne(`${API}/me/`).flush(null, { status: 401, statusText: 'Unauthorized' });
    // The interceptor tries one refresh; it fails, so the stored tokens are dropped.
    http.expectOne(`${API}/refresh-token/`).flush(null, { status: 401, statusText: 'Unauthorized' });
    await done;
    expect(tokens.accessToken).toBeNull();
    expect(auth.user()).toBeNull();
  });

  it('verifyCode returns the reset token', async () => {
    const done = auth.verifyCode('a@b.co', '123456');
    http.expectOne(`${API}/forgot-password/verify/`).flush(ok({ reset_token: 'rt' }));
    await expect(done).resolves.toBe('rt');
  });
});
