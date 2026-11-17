import { TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { environment } from '../../../environments/environment';
import { ApiError } from './api-client';
import { AuditApi, DeletionRequestDto } from './audit.api';
import { fail, ok, setupHttp } from './testing';

const API = `${environment.apiUrl}/audit`;
const REQ: DeletionRequestDto = {
  id: 7, entity_type: 'user', entity_id: 41, organization: { id: 3, name: 'Vodafone Qatar' }, organization_name: 'Vodafone Qatar',
  name: 'Sara Al-Kuwari', email: 'sara@vodafone.qa', entity_created_at: '2026-11-01T10:00:00Z', related: {}, reason: 'Left',
  status: 'Pending', requested_by: { id: 40, full_name: 'Omar Haddad' }, requested_by_name: 'Omar Haddad', requested_at: '2026-11-17T09:00:00Z',
  decided_by: null, decided_by_name: '', decided_at: null, deleted_at: null,
};

describe('AuditApi', () => {
  let api: AuditApi;
  let http: HttpTestingController;

  beforeEach(() => {
    http = setupHttp();
    api = TestBed.inject(AuditApi);
  });
  afterEach(() => http.verify());

  it('lists pending requests and maps them to audit rows', async () => {
    const done = api.requests({ status: 'Pending', limit: 100 });
    http.expectOne((r) => r.url === `${API}/deletion-requests/` && r.params.get('status') === 'Pending').flush(ok({ results: [REQ], count: 1 }));
    const row = (await done).rows[0];
    expect(row).toMatchObject({ entityType: 'user', entityId: 41, orgId: 3, customer: 'Sara Al-Kuwari', deletedBy: 'Omar Haddad', requestedById: 40, devices: [] });
  });

  it('requests a deletion, omitting an empty reason', async () => {
    const done = api.request('user', 41, '  ');
    const req = http.expectOne(`${API}/deletion-requests/`);
    expect(req.request.body).toEqual({ entity_type: 'user', entity_id: 41 });
    req.flush(ok(REQ, 4400), { status: 202, statusText: 'Accepted' });
    await done;
  });

  it('maps 403 4405 (own request) on approve', async () => {
    const done = api.approve(7);
    http.expectOne(`${API}/deletion-requests/7/approve/`).flush(fail(4405, 'Someone else must approve your deletion request.'), { status: 403, statusText: 'Forbidden' });
    const err = await done.catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ httpStatus: 403, code: 4405 });
  });

  it('reads the trail with its summary', async () => {
    const done = api.deletions({ entity_type: 'customer', offset: 0, limit: 10 });
    http.expectOne((r) => r.url === `${API}/deletions/`).flush(ok({
      results: [{ ...REQ, entity_type: 'customer', status: 'Completed', related: { devices: ['DEV-1', 'DEV-2'] }, deleted_at: '2026-11-17T09:30:00Z' }],
      count: 1, summary: { deleted: 1, by_type: { user: 0, organization: 0, customer: 1 }, related: { devices: 2, users: 0 } },
    }));
    const res = await done;
    expect(res.rows[0].devices).toEqual(['DEV-1', 'DEV-2']);
    expect(res.summary.related.devices).toBe(2);
  });

  it('exports the CSV as a file and reads an enveloped error out of a blob', async () => {
    const d1 = api.export({ search: 'x' });
    const r1 = http.expectOne((r) => r.url === `${API}/deletions/export/`);
    expect(r1.request.responseType).toBe('blob');
    r1.flush(new Blob(['Type,Name\n']), { headers: { 'Content-Disposition': 'attachment; filename="deletion-audit-2026-11-18.csv"' } });
    expect((await d1).filename).toBe('deletion-audit-2026-11-18.csv');

    const d2 = api.export({});
    http.expectOne((r) => r.url === `${API}/deletions/export/`).flush(
      new Blob([JSON.stringify(fail(4019, 'Check the highlighted fields.'))], { type: 'application/json' }),
      { status: 400, statusText: 'Bad Request' },
    );
    await expect(d2).rejects.toMatchObject({ httpStatus: 400, code: 4019, message: 'Check the highlighted fields.' });
  });
});
