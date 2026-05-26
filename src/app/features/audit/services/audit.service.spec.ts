import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';

import { AuditService } from './audit.service';
import { AuditEvent } from '../models/audit.model';
import { environment } from '../../../../environments/environment';

const BASE = `${environment.apiBaseUrl}/audit`;

const EVENT_A: AuditEvent = {
  id: 'evt-1',
  event_type: 'file.upload',
  ip_address: '127.0.0.1',
  device_name: 'Chrome',
  resource_id: 'blob-1',
  resource_name: 'photo.jpg',
  created_at: '2025-05-01T10:00:00Z',
};

const EVENT_B: AuditEvent = {
  id: 'evt-2',
  event_type: 'auth.login',
  ip_address: '10.0.0.5',
  device_name: 'Firefox',
  created_at: '2025-05-01T09:00:00Z',
};

describe('AuditService', () => {
  let svc: AuditService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    svc  = TestBed.inject(AuditService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  // ─── list ─────────────────────────────────────────────────────────────────

  it('list() GETs /audit with default limit=50', fakeAsync(() => {
    let result: readonly AuditEvent[] | undefined;
    svc.list().subscribe(r => (result = r));
    tick();

    const req = http.expectOne(r => r.url === BASE);
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('limit')).toBe('50');
    expect(req.request.params.has('before')).toBeFalse();
    req.flush({ events: [EVENT_A, EVENT_B] });
    tick();

    expect(result).toEqual([EVENT_A, EVENT_B]);
  }));

  it('list() uses a custom limit when provided', fakeAsync(() => {
    svc.list(10).subscribe();
    tick();

    const req = http.expectOne(r => r.url === BASE);
    expect(req.request.params.get('limit')).toBe('10');
    req.flush({ events: [] });
  }));

  it('list() includes a `before` param when provided', fakeAsync(() => {
    const cursor = '2025-05-01T09:00:00Z';
    svc.list(50, cursor).subscribe();
    tick();

    const req = http.expectOne(r => r.url === BASE);
    expect(req.request.params.get('before')).toBe(cursor);
    req.flush({ events: [] });
  }));

  it('list() does NOT include `before` param when omitted', fakeAsync(() => {
    svc.list(50).subscribe();
    tick();

    const req = http.expectOne(r => r.url === BASE);
    expect(req.request.params.has('before')).toBeFalse();
    req.flush({ events: [] });
  }));

  it('list() returns empty array when events key is absent', fakeAsync(() => {
    let result: readonly AuditEvent[] | undefined;
    svc.list().subscribe(r => (result = r));
    tick();

    http.expectOne(r => r.url === BASE).flush({});
    tick();

    expect(result).toEqual([]);
  }));

  it('list() propagates HTTP errors to subscribers', fakeAsync(() => {
    let error: unknown;
    svc.list().subscribe({ error: e => (error = e) });
    tick();

    http.expectOne(r => r.url === BASE).flush('Forbidden', { status: 403, statusText: 'Forbidden' });
    tick();

    expect(error).toBeTruthy();
  }));
});
