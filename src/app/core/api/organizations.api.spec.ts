import { TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { environment } from '../../../environments/environment';
import { ApiError } from './api-client';
import { OrganizationDto, OrganizationsApi } from './organizations.api';
import { fail, ok, setupHttp } from './testing';

const API = `${environment.apiUrl}/organizations`;
const VQ: OrganizationDto = {
  id: 3, name: 'Vodafone Qatar', legal_name: 'Vodafone Qatar P.Q.S.C.', kind: 'Partner', status: 'Active', countries: ['QA'],
  segments: ['B2B', 'B2C'], features: { Customers: 'RW', Audit: 'R' }, limits: { max_customers: 50, max_users: 10 },
  contact: { name: 'Omar Haddad', email: 'omar@vodafone.qa', phone: '+974 4400 1234' }, brand_colour: '#a81c26',
  logo_url: null, logo_updated_at: null,
  admin: { id: 40, full_name: 'Omar Haddad', email: 'omar@vodafone.qa', status: 'Active' },
  usage: { users: 6, active_users: 5, invited_users: 1, seats_used: 6, roles: 4, customers: 0, consumers: 0, devices: 0, devices_in_service: 0, orders: 0 },
  created_at: '2026-11-01T10:00:00Z', updated_at: '2026-11-10T12:00:00Z',
};

describe('OrganizationsApi', () => {
  let api: OrganizationsApi;
  let http: HttpTestingController;

  beforeEach(() => {
    http = setupHttp();
    api = TestBed.inject(OrganizationsApi);
  });
  afterEach(() => http.verify());

  it('reads the options list for the switcher and pickers', async () => {
    const done = api.options();
    http.expectOne(`${API}/options/`).flush(ok([
      { id: 1, name: 'HyperNym', kind: 'Platform', status: 'Active', brand_colour: '#4c1d95', logo_url: null, segments: ['B2B'], features: {}, limits: { max_customers: null, max_users: null } },
      { id: 3, name: 'Vodafone Qatar', kind: 'Partner', status: 'Active', brand_colour: null, logo_url: 'https://acct.blob.core.windows.net/c/organizations/3/logo-1.png?sig=x', segments: ['B2B'], features: {}, limits: { max_customers: null, max_users: null } },
    ]));
    expect(await done).toEqual([
      expect.objectContaining({ id: 1, name: 'HyperNym', kind: 'Platform', brandColour: '#4c1d95', logoUrl: null, limits: { maxCustomers: null, maxUsers: null } }),
      expect.objectContaining({ id: 3, brandColour: '', logoUrl: 'https://acct.blob.core.windows.net/c/organizations/3/logo-1.png?sig=x' }),
    ]);
  });

  it('lists organizations with usage and summary', async () => {
    const done = api.list({ limit: 100 });
    http.expectOne((r) => r.url === `${API}/` && r.params.get('limit') === '100').flush(ok({ results: [VQ], count: 1, summary: { partners: 1, invited: 0, suspended: 0 } }));
    const res = await done;
    expect(res.summary.partners).toBe(1);
    expect(res.rows[0]).toMatchObject({
      legalName: 'Vodafone Qatar P.Q.S.C.', brandColour: '#a81c26', limits: { maxCustomers: 50, maxUsers: 10 },
      admin: { id: 40, name: 'Omar Haddad' }, usage: { seatsUsed: 6, devicesInService: 0, invitedUsers: 1 },
    });
  });

  it('saves the full entitlement map and returns the impact', async () => {
    const done = api.setFeatures(3, { Customers: 'RW', Audit: null });
    const req = http.expectOne(`${API}/3/features/`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ features: { Customers: 'RW', Audit: null } });
    req.flush(ok({ organization: VQ, impact: { changes: [], affected_total: 2, affected: [] } }, 4304));
    expect((await done).impact.affected_total).toBe(2);
  });

  it('maps 409 4302 (name taken) on create to an ApiError', async () => {
    const done = api.create({
      name: 'Vodafone Qatar', legal_name: 'x', countries: ['QA'], segments: ['B2B'], brand_colour: '#0a6f96', features: { Customers: 'RW' },
      limits: { max_customers: null, max_users: 10 }, admin: { full_name: 'A', email: 'a@x.qa' },
    });
    http.expectOne(`${API}/`).flush(fail(4302, 'An organization with this name already exists.'), { status: 409, statusText: 'Conflict' });
    const err = await done.catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ code: 4302, httpStatus: 409 });
  });

  it('suspends, and returns who got a new invitation', async () => {
    const s = api.suspend(3);
    http.expectOne(`${API}/3/suspend/`).flush(ok({ ...VQ, status: 'Suspended' }, 4308));
    expect((await s).status).toBe('Suspended');
    const r = api.resendInvitation(3);
    http.expectOne(`${API}/3/resend-invitation/`).flush(ok({ sent_to: ['omar@vodafone.qa'] }, 4311));
    expect(await r).toEqual(['omar@vodafone.qa']);
  });

  it('uploads a logo as multipart with one field `file`', async () => {
    const file = new Blob([new Uint8Array([0x89, 0x50])], { type: 'image/png' });
    const done = api.uploadLogo(3, file, 'logo.png');
    const req = http.expectOne(`${API}/3/logo/`);
    expect(req.request.method).toBe('POST');
    const body = req.request.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get('file')).toBeTruthy();
    req.flush(ok({ ...VQ, logo_url: 'https://x/logo.png?sig=1', logo_updated_at: '2026-11-18T09:00:00Z' }, 4600, 'Logo saved.'));
    expect(await done).toMatchObject({ logoUrl: 'https://x/logo.png?sig=1', logoUpdatedAt: '2026-11-18T09:00:00Z' });
  });

  it('maps logo errors (400 4604 with its data, 503 4607) to ApiError', async () => {
    const up = api.uploadLogo(3, new Blob(['x']));
    http.expectOne(`${API}/3/logo/`).flush(
      fail(4604, 'The image must be 64 to 2048 pixels on each side and at most four times wider than it is tall.', { min: 64, max: 2048, width: 32, height: 32 }),
      { status: 400, statusText: 'Bad Request' },
    );
    expect(await up.catch((e) => e)).toMatchObject({ code: 4604, httpStatus: 400, data: { width: 32 } });
    const down = api.uploadLogo(3, new Blob(['x']));
    http.expectOne(`${API}/3/logo/`).flush(fail(4607, "File storage isn't available right now. Try again in a few minutes."), { status: 503, statusText: 'Unavailable' });
    const err = await down.catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toContain('File storage');
  });

  it('removes the logo', async () => {
    const done = api.deleteLogo(3);
    const req = http.expectOne(`${API}/3/logo/`);
    expect(req.request.method).toBe('DELETE');
    req.flush(ok({ ...VQ, logo_url: null }, 4601, 'Logo removed.'));
    expect((await done).logoUrl).toBeNull();
  });
});
