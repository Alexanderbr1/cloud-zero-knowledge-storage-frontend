import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';

import { SessionsService } from './sessions.service';
import { DeviceSession } from '../models/session.model';
import { environment } from '../../../../environments/environment';

const BASE = `${environment.apiBaseUrl}/sessions`;

const SESSION_A: DeviceSession = {
  id: 'sess-1',
  device_name: 'Chrome on Mac',
  ip_address: '192.168.1.1',
  user_agent: 'Mozilla/5.0',
  created_at: '2025-01-01T00:00:00Z',
  last_active_at: '2025-01-02T00:00:00Z',
  is_current: true,
};

const SESSION_B: DeviceSession = {
  id: 'sess-2',
  device_name: 'Firefox on Linux',
  ip_address: '10.0.0.1',
  user_agent: 'Mozilla/5.0 Firefox',
  created_at: '2025-01-01T00:00:00Z',
  last_active_at: '2025-01-01T12:00:00Z',
  is_current: false,
};

describe('SessionsService', () => {
  let svc: SessionsService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    svc  = TestBed.inject(SessionsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  // ─── list ─────────────────────────────────────────────────────────────────

  it('list() GETs /sessions', fakeAsync(() => {
    let result: readonly DeviceSession[] | undefined;
    svc.list().subscribe(r => (result = r));
    tick();

    const req = http.expectOne(BASE);
    expect(req.request.method).toBe('GET');
    req.flush({ sessions: [SESSION_A, SESSION_B] });
    tick();

    expect(result).toEqual([SESSION_A, SESSION_B]);
  }));

  it('list() returns empty array when sessions key is absent', fakeAsync(() => {
    let result: readonly DeviceSession[] | undefined;
    svc.list().subscribe(r => (result = r));
    tick();

    // Server returns response without the sessions key (e.g. unexpected shape).
    http.expectOne(BASE).flush({});
    tick();

    expect(result).toEqual([]);
  }));

  it('list() returns empty array when sessions is empty', fakeAsync(() => {
    let result: readonly DeviceSession[] | undefined;
    svc.list().subscribe(r => (result = r));
    tick();
    http.expectOne(BASE).flush({ sessions: [] });
    tick();

    expect(result).toEqual([]);
  }));

  // ─── revoke ───────────────────────────────────────────────────────────────

  it('revoke() DELETEs /sessions/:id', fakeAsync(() => {
    let done = false;
    svc.revoke('sess-2').subscribe(() => (done = true));
    tick();

    const req = http.expectOne(`${BASE}/sess-2`);
    expect(req.request.method).toBe('DELETE');
    req.flush(null, { status: 204, statusText: 'No Content' });
    tick();

    expect(done).toBeTrue();
  }));

  it('revoke() propagates HTTP errors', fakeAsync(() => {
    let error: unknown;
    svc.revoke('sess-gone').subscribe({ error: e => (error = e) });
    tick();

    http.expectOne(`${BASE}/sess-gone`).flush('Not Found', { status: 404, statusText: 'Not Found' });
    tick();

    expect(error).toBeTruthy();
  }));

  // ─── revokeOthers ─────────────────────────────────────────────────────────

  it('revokeOthers() DELETEs /sessions (no id)', fakeAsync(() => {
    let done = false;
    svc.revokeOthers().subscribe(() => (done = true));
    tick();

    const req = http.expectOne(BASE);
    expect(req.request.method).toBe('DELETE');
    req.flush(null, { status: 204, statusText: 'No Content' });
    tick();

    expect(done).toBeTrue();
  }));
});
