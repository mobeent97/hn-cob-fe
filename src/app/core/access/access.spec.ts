import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { environment } from '../../../environments/environment';
import { AuthService } from '../auth/auth.service';
import { authInterceptor } from '../auth/auth.interceptor';
import { MeAccess } from '../auth/auth.models';
import { Store } from '../data/store';
import { Access } from './access';
import { FEATURE_KEYS } from './features';

const ME = {
  id: 41, email: 'sara@vodafone.qa', full_name: 'Sara Al-Kuwari', phone: '+974 5512 3456', is_superuser: false, status: 'Active',
  last_login: null, organization: { id: 3, name: 'Vodafone Qatar', kind: 'Partner', status: 'Active' },
  roles: [{ id: 12, name: 'Viewer', is_admin: false }],
};
const ACCESS: MeAccess = {
  is_superuser: false,
  organization: { id: 3, name: 'Vodafone Qatar', kind: 'Partner' },
  levels: { ...Object.fromEntries(FEATURE_KEYS.map((k) => [k, null])), Dashboard: 'R', Customers: 'RW', Audit: 'R' },
  features: [
    { key: 'Customers', level: 'RW', org_level: 'RW', role_level: 'RW', reason: null },
    { key: 'Audit', level: 'R', org_level: 'R', role_level: 'RW', reason: 'capped_by_plan' },
    { key: 'Settings', level: null, org_level: null, role_level: null, reason: 'platform_only' },
  ],
};

describe('Access (GET /auth/me/access/)', () => {
  let access: Access;
  let auth: AuthService;
  let store: Store;
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('hn_cob_access', 'a1');
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(withInterceptors([authInterceptor])), provideHttpClientTesting()],
    });
    access = TestBed.inject(Access);
    auth = TestBed.inject(AuthService);
    store = TestBed.inject(Store);
    http = TestBed.inject(HttpTestingController);
    store.setSession(ME);
  });
  afterEach(() => http.verify());

  it('uses the server levels as the answer once loaded', async () => {
    // Before the call: the local fallback knows no partner entitlements, so nothing is open.
    expect(access.can('Customers')).toBe(false);
    const done = auth.loadAccess();
    http.expectOne(`${environment.apiUrl}/auth/me/access/`).flush({ status: 1000, message: 'Success', data: ACCESS });
    await done;
    expect(access.fromServer()).toBe(true);
    expect(access.can('Customers', 'RW')).toBe(true);
    expect(access.can('Audit', 'R')).toBe(true);
    expect(access.can('Audit', 'RW')).toBe(false);
    expect(access.readOnly('Audit')).toBe(true);
    expect(access.can('Settings')).toBe(false);
    expect(access.reasons()?.['Audit']).toBe('capped_by_plan');
    expect(access.roles()).toEqual([{ id: 12, name: 'Viewer', isAdmin: false }]);
  });

  it('falls back to the local rule (roles by id, capped by the plan) until the server answers', () => {
    store.mergeOrganizations([{ ...store.currentOrg(), features: { Customers: 'R', Dashboard: 'R' } }]);
    store.groups.all.set([{
      id: 12, orgId: 3, orgName: 'Vodafone Qatar', name: 'Viewer', description: '', status: 'Active', isTemplate: false, key: null,
      template: null, isAdmin: false, effectivePermissions: null, members: { total: 1, active: 1 },
      permissions: { Customers: 'RW', Dashboard: 'R', Settings: 'RW' },
    }]);
    expect(access.fromServer()).toBe(false);
    expect(access.level('Customers')).toBe('R'); // capped by the plan
    expect(access.level('Dashboard')).toBe('R');
    expect(access.level('Settings')).toBeNull(); // platform-only
  });

  it('forgets the server answer on sign-out', async () => {
    const done = auth.loadAccess();
    http.expectOne(`${environment.apiUrl}/auth/me/access/`).flush({ status: 1000, message: 'Success', data: ACCESS });
    await done;
    auth.clearSession();
    expect(access.fromServer()).toBe(false);
    expect(access.can('Customers')).toBe(false);
  });
});
