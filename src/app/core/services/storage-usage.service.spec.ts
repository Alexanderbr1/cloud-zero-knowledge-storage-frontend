import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';

import { StorageUsageService } from './storage-usage.service';
import { environment } from '../../../environments/environment';

const BASE = `${environment.apiBaseUrl}/storage`;

describe('StorageUsageService', () => {
  let svc: StorageUsageService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    svc  = TestBed.inject(StorageUsageService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  // ─── initial state ────────────────────────────────────────────────────────

  it('usage signal is null initially', () => {
    expect(svc.usage()).toBeNull();
  });

  it('pct computed is 0 when usage is null', () => {
    expect(svc.pct()).toBe(0);
  });

  // ─── refresh ──────────────────────────────────────────────────────────────

  it('refresh() GETs /storage/usage', fakeAsync(() => {
    svc.refresh();
    tick();

    const req = http.expectOne(`${BASE}/usage`);
    expect(req.request.method).toBe('GET');
    req.flush({ used_bytes: 500, quota_bytes: 1000 });
    tick();
  }));

  it('refresh() updates usage signal on success', fakeAsync(() => {
    svc.refresh();
    tick();
    http.expectOne(`${BASE}/usage`).flush({ used_bytes: 200, quota_bytes: 1000 });
    tick();

    expect(svc.usage()).toEqual({ used_bytes: 200, quota_bytes: 1000 });
  }));

  it('refresh() silently ignores HTTP errors', fakeAsync(() => {
    svc.refresh();
    tick();
    http.expectOne(`${BASE}/usage`).flush('Server Error', { status: 500, statusText: 'Internal Server Error' });
    tick();

    // usage remains null — no thrown error
    expect(svc.usage()).toBeNull();
  }));

  // ─── pct computed ─────────────────────────────────────────────────────────

  it('pct() is 50 when half quota used', fakeAsync(() => {
    svc.refresh();
    tick();
    http.expectOne(`${BASE}/usage`).flush({ used_bytes: 500, quota_bytes: 1000 });
    tick();

    expect(svc.pct()).toBe(50);
  }));

  it('pct() is 100 when quota exceeded', fakeAsync(() => {
    svc.refresh();
    tick();
    http.expectOne(`${BASE}/usage`).flush({ used_bytes: 2000, quota_bytes: 1000 });
    tick();

    expect(svc.pct()).toBe(100);
  }));

  it('pct() is 0 when quota_bytes is 0', fakeAsync(() => {
    svc.refresh();
    tick();
    http.expectOne(`${BASE}/usage`).flush({ used_bytes: 0, quota_bytes: 0 });
    tick();

    expect(svc.pct()).toBe(0);
  }));

  it('pct() updates reactively after a second refresh()', fakeAsync(() => {
    svc.refresh();
    tick();
    http.expectOne(`${BASE}/usage`).flush({ used_bytes: 100, quota_bytes: 1000 });
    tick();
    expect(svc.pct()).toBe(10);

    svc.refresh();
    tick();
    http.expectOne(`${BASE}/usage`).flush({ used_bytes: 750, quota_bytes: 1000 });
    tick();
    expect(svc.pct()).toBe(75);
  }));
});
