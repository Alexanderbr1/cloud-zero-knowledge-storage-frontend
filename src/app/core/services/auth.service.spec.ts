import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';

import { AuthService } from './auth.service';
import { environment } from '../../../environments/environment';

const BASE = `${environment.apiBaseUrl}/auth`;

describe('AuthService', () => {
  let svc: AuthService;
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    svc  = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  // ─── initial state ────────────────────────────────────────────────────────

  it('isAuthenticated is false initially', () => {
    expect(svc.isAuthenticated()).toBeFalse();
  });

  it('isUnlocked is false initially', () => {
    expect(svc.isUnlocked()).toBeFalse();
  });

  it('accessToken() returns null initially', () => {
    expect(svc.accessToken()).toBeNull();
  });

  it('userId() returns null initially', () => {
    expect(svc.userId()).toBeNull();
  });

  it('getFileKey() returns null initially', () => {
    expect(svc.getFileKey()).toBeNull();
  });

  it('getECPrivateKey() returns null initially', () => {
    expect(svc.getECPrivateKey()).toBeNull();
  });

  // ─── hadSession ───────────────────────────────────────────────────────────

  it('hadSession() returns false when localStorage is empty', () => {
    expect(svc.hadSession()).toBeFalse();
  });

  it('hadSession() returns true when auth.session_existed is set', () => {
    localStorage.setItem('auth.session_existed', '1');
    // Re-create service to pick up localStorage state.
    const fresh = TestBed.runInInjectionContext(() => new AuthService());
    expect(fresh.hadSession()).toBeTrue();
  });

  // ─── clearAccess ──────────────────────────────────────────────────────────

  it('clearAccess() resets isAuthenticated to false', fakeAsync(() => {
    let done = false;
    svc.tryRestoreSession().subscribe(() => (done = true));
    http.expectOne(`${BASE}/refresh`).flush({
      access_token: makeJwt({ sub: 'user-1' }),
      expires_in: 900,
    });
    tick();

    expect(svc.isAuthenticated()).toBeTrue();

    svc.clearAccess();
    expect(svc.isAuthenticated()).toBeFalse();
    expect(svc.accessToken()).toBeNull();
    expect(svc.userId()).toBeNull();
    void done;
  }));

  // ─── recoveryPhrase signal ────────────────────────────────────────────────

  it('recoveryPhrase is null by default', () => {
    expect(svc.recoveryPhrase()).toBeNull();
  });

  it('clearRecoveryPhrase() sets recoveryPhrase to null', () => {
    (svc as any)._recoveryPhrase.set('word1 word2');
    svc.clearRecoveryPhrase();
    expect(svc.recoveryPhrase()).toBeNull();
  });

  // ─── tryRestoreSession ────────────────────────────────────────────────────

  it('tryRestoreSession() returns false when refresh HTTP call fails', fakeAsync(() => {
    let result: boolean | undefined;
    svc.tryRestoreSession().subscribe(v => (result = v));
    http.expectOne(`${BASE}/refresh`).flush('Unauthorized', { status: 401, statusText: 'Unauthorized' });
    tick();
    expect(result).toBeFalse();
  }));

  it('tryRestoreSession() sets access token and returns true on success', fakeAsync(() => {
    let result: boolean | undefined;
    svc.tryRestoreSession().subscribe(v => (result = v));

    http.expectOne(`${BASE}/refresh`).flush({
      access_token: makeJwt({ sub: 'user-123' }),
      expires_in: 900,
    });
    tick();

    expect(result).toBeTrue();
    expect(svc.isAuthenticated()).toBeTrue();
    expect(svc.userId()).toBe('user-123');
  }));

  // ─── startOrJoinRefresh (deduplication) ──────────────────────────────────

  it('startOrJoinRefresh() sends only one HTTP request when called multiple times concurrently', fakeAsync(() => {
    let completions = 0;
    svc.startOrJoinRefresh().subscribe(() => completions++);
    svc.startOrJoinRefresh().subscribe(() => completions++);
    svc.startOrJoinRefresh().subscribe(() => completions++);
    tick();

    // Only one HTTP request should be in flight.
    const reqs = http.match(`${BASE}/refresh`);
    expect(reqs.length).toBe(1);

    reqs[0]!.flush({ access_token: makeJwt({ sub: 'u' }), expires_in: 900 });
    tick();

    // All three subscribers received the completion.
    expect(completions).toBe(3);
  }));

  it('startOrJoinRefresh() allows a new request after the first completes', fakeAsync(() => {
    let completions = 0;
    svc.startOrJoinRefresh().subscribe(() => completions++);
    tick();
    http.expectOne(`${BASE}/refresh`).flush({ access_token: makeJwt({ sub: 'u' }), expires_in: 900 });
    tick();
    expect(completions).toBe(1);

    // Second call after first completed — must create a new request.
    svc.startOrJoinRefresh().subscribe(() => completions++);
    tick();
    http.expectOne(`${BASE}/refresh`).flush({ access_token: makeJwt({ sub: 'u' }), expires_in: 900 });
    tick();
    expect(completions).toBe(2);
  }));

  // ─── logout ───────────────────────────────────────────────────────────────

  it('logout() posts to /auth/logout and clears access state', fakeAsync(() => {
    // First set a token.
    svc.tryRestoreSession().subscribe();
    http.expectOne(`${BASE}/refresh`).flush({ access_token: makeJwt({ sub: 'u' }), expires_in: 900 });
    tick();
    expect(svc.isAuthenticated()).toBeTrue();

    svc.logout();
    tick();
    http.expectOne(`${BASE}/logout`).flush(null, { status: 204, statusText: 'No Content' });
    tick();

    expect(svc.isAuthenticated()).toBeFalse();
    expect(svc.accessToken()).toBeNull();
  }));

  it('logout() clears state even if the HTTP call fails', fakeAsync(() => {
    svc.tryRestoreSession().subscribe();
    http.expectOne(`${BASE}/refresh`).flush({ access_token: makeJwt({ sub: 'u' }), expires_in: 900 });
    tick();

    svc.logout();
    tick();
    http.expectOne(`${BASE}/logout`).flush('Error', { status: 500, statusText: 'Error' });
    tick();

    expect(svc.isAuthenticated()).toBeFalse();
  }));

  it('logout() removes auth-related localStorage keys', fakeAsync(() => {
    localStorage.setItem('auth.email', 'alice@example.com');
    localStorage.setItem('auth.session_existed', '1');
    localStorage.setItem('auth.ec_private_key', 'somekey');

    svc.logout();
    tick();
    http.expectOne(`${BASE}/logout`).flush(null);
    tick();

    expect(localStorage.getItem('auth.email')).toBeNull();
    expect(localStorage.getItem('auth.session_existed')).toBeNull();
    expect(localStorage.getItem('auth.ec_private_key')).toBeNull();
  }));

  // ─── requestPasswordReset ─────────────────────────────────────────────────

  it('requestPasswordReset() POSTs to /auth/reset-password/request', fakeAsync(() => {
    let done = false;
    svc.requestPasswordReset('alice@example.com').subscribe(() => (done = true));
    tick();

    const req = http.expectOne(`${BASE}/reset-password/request`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ email: 'alice@example.com' });
    req.flush(null, { status: 204, statusText: 'No Content' });
    tick();

    expect(done).toBeTrue();
  }));
});

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Builds a minimal JWT with the given payload. Not cryptographically signed — just for testing. */
function makeJwt(payload: Record<string, unknown>): string {
  const header  = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body    = btoa(JSON.stringify(payload));
  return `${header}.${body}.fakesig`;
}
