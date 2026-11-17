import { TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { environment } from '../../../environments/environment';
import { ApiError } from './api-client';
import { UserDto, UsersApi } from './users.api';
import { fail, ok, setupHttp } from './testing';

const API = `${environment.apiUrl}/users`;
const SARA: UserDto = {
  id: 41, email: 'sara@vodafone.qa', full_name: 'Sara Al-Kuwari', phone: '+974 5512 3456', status: 'Invited', is_superuser: false,
  organization: { id: 3, name: 'Vodafone Qatar', kind: 'Partner', status: 'Active' },
  roles: [{ id: 12, name: 'Organization admin', is_admin: true }],
  manager: { id: 40, full_name: 'Omar Haddad', email: 'omar@vodafone.qa' },
  last_login: null, invited_at: '2026-11-01T10:00:00Z', created_at: '2026-11-01T10:00:00Z', updated_at: '2026-11-10T12:00:00Z',
};

describe('UsersApi', () => {
  let api: UsersApi;
  let http: HttpTestingController;

  beforeEach(() => {
    http = setupHttp();
    api = TestBed.inject(UsersApi);
  });
  afterEach(() => http.verify());

  it('lists with filters as query params and maps users to the screen model', async () => {
    const done = api.list({ search: 'sara', status: 'Invited', role: 12, organization: 3, offset: 10, limit: 10 });
    const req = http.expectOne((r) => r.url === `${API}/`);
    expect(req.request.params.get('search')).toBe('sara');
    expect(req.request.params.get('status')).toBe('Invited');
    expect(req.request.params.get('role')).toBe('12');
    expect(req.request.params.get('organization')).toBe('3');
    expect(req.request.params.get('offset')).toBe('10');
    expect(req.request.params.has('never_signed_in')).toBe(false);
    req.flush(ok({ results: [SARA], count: 1, counts: { all: 1, active: 0, inactive: 0, invited: 1, never_signed_in: 1 }, seats: { used: 1, max: 10 } }));
    const res = await done;
    expect(res.count).toBe(1);
    expect(res.seats).toEqual({ used: 1, max: 10 });
    expect(res.rows[0]).toEqual(expect.objectContaining({
      id: 41, orgId: 3, orgName: 'Vodafone Qatar', name: 'Sara Al-Kuwari', status: 'Invited',
      roles: [{ id: 12, name: 'Organization admin', isAdmin: true }],
      manager: { id: 40, name: 'Omar Haddad', email: 'omar@vodafone.qa' },
    }));
    expect('username' in res.rows[0]).toBe(false);
  });

  it('creates with role ids and returns the invited user', async () => {
    const done = api.create({ full_name: 'Sara Al-Kuwari', email: 'sara@vodafone.qa', role_ids: [12] });
    const req = http.expectOne(`${API}/`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ full_name: 'Sara Al-Kuwari', email: 'sara@vodafone.qa', role_ids: [12] });
    req.flush(ok(SARA, 4100, 'User added.'), { status: 201, statusText: 'Created' });
    expect((await done).status).toBe('Invited');
  });

  it('maps an error envelope to an ApiError with field errors', async () => {
    const done = api.update(41, { full_name: '' });
    http.expectOne(`${API}/41/`).flush(fail(4019, 'Check the highlighted fields.', { errors: { full_name: ['Enter a name.'] } }), { status: 400, statusText: 'Bad Request' });
    const err = await done.catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ httpStatus: 400, code: 4019, message: 'Check the highlighted fields.' });
    expect(err.field('full_name')).toBe('Enter a name.');
  });

  it('posts the status and link actions', async () => {
    const d1 = api.deactivate(41);
    http.expectOne(`${API}/41/deactivate/`).flush(ok({ ...SARA, status: 'Inactive' }));
    expect((await d1).status).toBe('Inactive');
    const d2 = api.resendInvitation(41);
    http.expectOne(`${API}/41/resend-invitation/`).flush(ok(null, 4114));
    await expect(d2).resolves.toBeUndefined();
    const d3 = api.sendPasswordReset(41);
    http.expectOne(`${API}/41/send-password-reset/`).flush(fail(4113, 'Only active users can be sent a reset link.'), { status: 409, statusText: 'Conflict' });
    await expect(d3).rejects.toMatchObject({ httpStatus: 409, code: 4113 });
  });

  it('turns a network failure into an ApiError with the offline message', async () => {
    const done = api.get(41);
    http.expectOne(`${API}/41/`).error(new ProgressEvent('error'), { status: 0 });
    await expect(done).rejects.toMatchObject({ httpStatus: 0, isNetwork: true });
  });
});
