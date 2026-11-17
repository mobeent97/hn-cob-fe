import { TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { environment } from '../../../environments/environment';
import { ApiError } from './api-client';
import { RoleDto, RolesApi } from './roles.api';
import { fail, ok, setupHttp } from './testing';

const API = `${environment.apiUrl}/roles`;
const ROLE: RoleDto = {
  id: 12, organization: { id: 3, name: 'Vodafone Qatar', kind: 'Partner' }, is_template: false,
  template: { id: 1, name: 'Organization admin', key: 'org-admin' }, key: null, is_admin: true, name: 'Organization admin',
  description: 'Vodafone Qatar administrators', status: 'Active',
  permissions: { Users: 'RW', Audit: 'RW' }, effective_permissions: { Users: 'RW', Audit: 'R' },
  members: { total: 2, active: 2 }, created_at: '2026-11-17T09:12:00Z', updated_at: '2026-11-17T09:12:00Z',
};

describe('RolesApi', () => {
  let api: RolesApi;
  let http: HttpTestingController;

  beforeEach(() => {
    http = setupHttp();
    api = TestBed.inject(RolesApi);
  });
  afterEach(() => http.verify());

  it('lists roles and maps them to groups (orgId, effective permissions, members)', async () => {
    const done = api.list({ organization: 3, include_templates: false, limit: 100 });
    const req = http.expectOne((r) => r.url === `${API}/`);
    expect(req.request.params.get('include_templates')).toBe('false');
    expect(req.request.params.get('organization')).toBe('3');
    req.flush(ok({ results: [ROLE], count: 1 }));
    const g = (await done).rows[0];
    expect(g).toMatchObject({ id: 12, orgId: 3, orgName: 'Vodafone Qatar', isAdmin: true, isTemplate: false, members: { total: 2, active: 2 } });
    expect(g.effectivePermissions).toEqual({ Users: 'RW', Audit: 'R' });
  });

  it('drops null levels before sending permissions', async () => {
    const done = api.update(12, { permissions: { Users: 'RW', Audit: null, Customers: 'R' } });
    const req = http.expectOne(`${API}/12/`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ permissions: { Users: 'RW', Customers: 'R' } });
    req.flush(ok(ROLE, 4201));
    await done;
  });

  it('previews and copies', async () => {
    const p = api.preview(12, { status: 'Inactive' });
    http.expectOne(`${API}/12/preview/`).flush(ok({ members_affected: 1, affected: [{ user: { id: 41, full_name: 'Sara', email: 's@x.qa' }, features: ['Users'] }] }));
    expect((await p).members_affected).toBe(1);
    const c = api.copy(1, { organization_id: 3 });
    const req = http.expectOne(`${API}/1/copy/`);
    expect(req.request.body).toEqual({ organization_id: 3 });
    req.flush(ok({ ...ROLE, id: 13 }, 4208), { status: 201, statusText: 'Created' });
    expect((await c).id).toBe(13);
  });

  it('maps 409 4206 (own admin access) to an ApiError with the server message', async () => {
    const done = api.update(12, { status: 'Inactive' });
    http.expectOne(`${API}/12/`).flush(fail(4206, 'This change would remove your own admin access. Ask another admin.'), { status: 409, statusText: 'Conflict' });
    const err = await done.catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ httpStatus: 409, code: 4206, message: 'This change would remove your own admin access. Ask another admin.' });
  });
});
