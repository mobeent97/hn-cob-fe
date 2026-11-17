import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { authInterceptor } from './auth.interceptor';
import { AuthService } from './auth.service';
import { TokenStorageService } from './token-storage.service';

const API = environment.apiUrl;
const ok = <T>(data: T) => ({ status: 1000, message: 'Success', data });
const unauthorized = { status: 401, statusText: 'Unauthorized' };

describe('authInterceptor', () => {
  let client: HttpClient;
  let http: HttpTestingController;
  let tokens: TokenStorageService;
  let router: Router;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(withInterceptors([authInterceptor])), provideHttpClientTesting()],
    });
    client = TestBed.inject(HttpClient);
    http = TestBed.inject(HttpTestingController);
    tokens = TestBed.inject(TokenStorageService);
    router = TestBed.inject(Router);
    tokens.save('a1', 'r1');
  });

  afterEach(() => http.verify());

  it('adds the bearer token to API calls only', () => {
    client.get(`${API}/customers/`).subscribe();
    client.get('https://tiles.openfreemap.org/planet').subscribe();

    const api = http.expectOne(`${API}/customers/`);
    expect(api.request.headers.get('Authorization')).toBe('Bearer a1');
    expect(api.request.headers.has('X-Refresh-Token')).toBe(false);
    expect(api.request.withCredentials).toBe(false);
    expect(http.expectOne('https://tiles.openfreemap.org/planet').request.headers.has('Authorization')).toBe(false);
    http.match(() => true).forEach((r) => r.flush({}));
  });

  it('leaves the public auth endpoints without a token', () => {
    for (const path of ['login/', 'refresh-token/', 'forgot-password/', 'forgot-password/verify/', 'reset-password/']) {
      client.post(`${API}/auth/${path}`, {}).subscribe();
      const req = http.expectOne(`${API}/auth/${path}`);
      expect(req.request.headers.has('Authorization')).toBe(false);
      req.flush({});
    }
  });

  it('on a 401 refreshes once and retries with the new token', async () => {
    const result = firstValueFrom(client.get<{ ok: boolean }>(`${API}/customers/`));
    http.expectOne(`${API}/customers/`).flush(null, unauthorized);

    const refresh = http.expectOne(`${API}/auth/refresh-token/`);
    expect(refresh.request.body).toEqual({ refresh: 'r1' });
    refresh.flush(ok({ access: 'a2', refresh: 'r2' }));

    const retry = http.expectOne(`${API}/customers/`);
    expect(retry.request.headers.get('Authorization')).toBe('Bearer a2');
    retry.flush({ ok: true });
    await expect(result).resolves.toEqual({ ok: true });
    expect(tokens.refreshToken).toBe('r2');
  });

  it('concurrent 401s share a single refresh', async () => {
    const one = firstValueFrom(client.get(`${API}/one/`));
    const two = firstValueFrom(client.get(`${API}/two/`));
    http.expectOne(`${API}/one/`).flush(null, unauthorized);
    http.expectOne(`${API}/two/`).flush(null, unauthorized);

    http.expectOne(`${API}/auth/refresh-token/`).flush(ok({ access: 'a2', refresh: 'r2' }));
    for (const p of ['one', 'two']) {
      const retry = http.expectOne(`${API}/${p}/`);
      expect(retry.request.headers.get('Authorization')).toBe('Bearer a2');
      retry.flush({ p });
    }
    await expect(one).resolves.toEqual({ p: 'one' });
    await expect(two).resolves.toEqual({ p: 'two' });
  });

  it('when the refresh fails, clears the session and goes to /login with the return URL', async () => {
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    vi.spyOn(router, 'url', 'get').mockReturnValue('/customers?page=2');
    const auth = TestBed.inject(AuthService);

    const result = firstValueFrom(client.get(`${API}/customers/`));
    http.expectOne(`${API}/customers/`).flush(null, unauthorized);
    http
      .expectOne(`${API}/auth/refresh-token/`)
      .flush({ status: 4005, message: 'Session expired.', data: null }, unauthorized);

    await expect(result).rejects.toMatchObject({ httpStatus: 401, code: 4005 });
    expect(tokens.accessToken).toBeNull();
    expect(tokens.refreshToken).toBeNull();
    expect(auth.user()).toBeNull();
    expect(navigate).toHaveBeenCalledWith(['/login'], { queryParams: { returnUrl: '/customers?page=2' } });
  });

  it('passes a second 401 after the retry through without looping', async () => {
    const result = firstValueFrom(client.get(`${API}/customers/`));
    http.expectOne(`${API}/customers/`).flush(null, unauthorized);
    http.expectOne(`${API}/auth/refresh-token/`).flush(ok({ access: 'a2', refresh: 'r2' }));
    http.expectOne(`${API}/customers/`).flush(null, unauthorized);
    await expect(result).rejects.toMatchObject({ status: 401 });
    http.expectNone(`${API}/auth/refresh-token/`);
  });
});
