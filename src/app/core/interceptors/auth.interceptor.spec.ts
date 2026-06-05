import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import {
  HttpClient,
  HttpErrorResponse,
  provideHttpClient,
  withInterceptors,
} from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';

import { authInterceptor } from './auth.interceptor';
import { AuthService } from '../services/auth.service';

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeMockAuth(overrides: Partial<{
  token: string | null;
  startOrJoinRefresh: () => ReturnType<AuthService['startOrJoinRefresh']>;
  logout: () => void;
}> = {}) {
  return {
    accessToken:       jasmine.createSpy('accessToken').and.returnValue(overrides.token ?? null),
    startOrJoinRefresh: jasmine.createSpy('startOrJoinRefresh').and.callFake(
      overrides.startOrJoinRefresh ?? (() => of(void 0))
    ),
    logout:            jasmine.createSpy('logout').and.callFake(overrides.logout ?? (() => {})),
  };
}

function setup(mockAuth: ReturnType<typeof makeMockAuth>) {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(withInterceptors([authInterceptor])),
      provideHttpClientTesting(),
      provideRouter([{ path: '**', redirectTo: '' }]),
      { provide: AuthService, useValue: mockAuth },
    ],
  });
  return {
    http:       TestBed.inject(HttpClient),
    controller: TestBed.inject(HttpTestingController),
  };
}

// ─────────────────────────────────────────────────────────────────────────────

describe('authInterceptor', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  // ─── Authorization header ─────────────────────────────────────────────────

  describe('Authorization header', () => {
    it('adds Bearer header when access token is present', fakeAsync(() => {
      const auth = makeMockAuth({ token: 'my.access.token' });
      const { http, controller } = setup(auth);

      http.get('/api/storage/blobs').subscribe();
      tick();

      const req = controller.expectOne('/api/storage/blobs');
      expect(req.request.headers.get('Authorization')).toBe('Bearer my.access.token');
      req.flush([]);
    }));

    it('does NOT add Authorization header when no token', fakeAsync(() => {
      const auth = makeMockAuth({ token: null });
      const { http, controller } = setup(auth);

      http.get('/api/storage/blobs').subscribe();
      tick();

      const req = controller.expectOne('/api/storage/blobs');
      expect(req.request.headers.has('Authorization')).toBeFalse();
      req.flush([]);
    }));

    it('does NOT add Authorization header for /auth/login', fakeAsync(() => {
      const auth = makeMockAuth({ token: 'token' });
      const { http, controller } = setup(auth);

      http.post('/api/auth/login/init', {}).subscribe();
      tick();

      const req = controller.expectOne('/api/auth/login/init');
      expect(req.request.headers.has('Authorization')).toBeFalse();
      req.flush({});
    }));

    it('does NOT add Authorization header for /auth/register', fakeAsync(() => {
      const auth = makeMockAuth({ token: 'token' });
      const { http, controller } = setup(auth);

      http.post('/api/auth/register', {}).subscribe();
      tick();

      const req = controller.expectOne('/api/auth/register');
      expect(req.request.headers.has('Authorization')).toBeFalse();
      req.flush({});
    }));

    it('does NOT add Authorization header for /auth/refresh', fakeAsync(() => {
      const auth = makeMockAuth({ token: 'token' });
      const { http, controller } = setup(auth);

      http.post('/api/auth/refresh', {}).subscribe();
      tick();

      const req = controller.expectOne('/api/auth/refresh');
      expect(req.request.headers.has('Authorization')).toBeFalse();
      req.flush({});
    }));

    it('does NOT add Authorization header for /auth/logout', fakeAsync(() => {
      const auth = makeMockAuth({ token: 'token' });
      const { http, controller } = setup(auth);

      http.post('/api/auth/logout', {}).subscribe();
      tick();

      const req = controller.expectOne('/api/auth/logout');
      expect(req.request.headers.has('Authorization')).toBeFalse();
      req.flush({});
    }));
  });

  // ─── 401 → refresh & retry ────────────────────────────────────────────────

  describe('401 handling', () => {
    it('on 401, calls startOrJoinRefresh and retries with new token', fakeAsync(() => {
      let callCount = 0;
      const auth = makeMockAuth({
        token: 'old.token',
        startOrJoinRefresh: () => {
          // After refresh, token changes.
          auth.accessToken.and.returnValue('new.token');
          return of(void 0);
        },
      });
      const { http, controller } = setup(auth);

      let result: unknown;
      http.get('/api/storage/blobs').subscribe({ next: v => (result = v) });
      tick();

      // First attempt.
      const req1 = controller.expectOne('/api/storage/blobs');
      expect(req1.request.headers.get('Authorization')).toBe('Bearer old.token');
      req1.flush('Unauthorized', { status: 401, statusText: 'Unauthorized' });
      tick();

      // Retry after refresh.
      const req2 = controller.expectOne('/api/storage/blobs');
      expect(req2.request.headers.get('Authorization')).toBe('Bearer new.token');
      req2.flush({ items: [] });
      tick();

      expect(auth.startOrJoinRefresh).toHaveBeenCalledTimes(1);
      expect(auth.logout).not.toHaveBeenCalled();
      void result; void callCount;
    }));

    it('on 401, if refresh succeeds but token is still null, calls logout()', fakeAsync(() => {
      const auth = makeMockAuth({
        token: 'old.token',
        startOrJoinRefresh: () => {
          // Refresh "succeeds" but token remains null.
          auth.accessToken.and.returnValue(null);
          return of(void 0);
        },
      });
      const { http, controller } = setup(auth);

      let error: unknown;
      http.get('/api/storage/blobs').subscribe({ error: e => (error = e) });
      tick();

      const req = controller.expectOne('/api/storage/blobs');
      req.flush('Unauthorized', { status: 401, statusText: 'Unauthorized' });
      tick();

      expect(auth.logout).toHaveBeenCalled();
      expect(error).toBeInstanceOf(HttpErrorResponse);
    }));

    it('on 401, if refresh itself fails, calls logout() and propagates error', fakeAsync(() => {
      const refreshError = new Error('refresh failed');
      const auth = makeMockAuth({
        token: 'old.token',
        startOrJoinRefresh: () => throwError(() => refreshError),
      });
      const { http, controller } = setup(auth);

      let error: unknown;
      http.get('/api/storage/blobs').subscribe({ error: e => (error = e) });
      tick();

      const req = controller.expectOne('/api/storage/blobs');
      req.flush('Unauthorized', { status: 401, statusText: 'Unauthorized' });
      tick();

      expect(auth.logout).toHaveBeenCalledTimes(1);
      expect(error).toBe(refreshError);
    }));

    it('does NOT attempt refresh on 401 for auth requests', fakeAsync(() => {
      const auth = makeMockAuth({ token: 'token' });
      const { http, controller } = setup(auth);

      let error: unknown;
      http.post('/api/auth/refresh', {}).subscribe({ error: e => (error = e) });
      tick();

      const req = controller.expectOne('/api/auth/refresh');
      req.flush('Unauthorized', { status: 401, statusText: 'Unauthorized' });
      tick();

      expect(auth.startOrJoinRefresh).not.toHaveBeenCalled();
      expect(auth.logout).not.toHaveBeenCalled();
      expect(error).toBeInstanceOf(HttpErrorResponse);
    }));

    it('passes through non-401 errors unchanged', fakeAsync(() => {
      const auth = makeMockAuth({ token: 'token' });
      const { http, controller } = setup(auth);

      let error: unknown;
      http.get('/api/storage/blobs').subscribe({ error: e => (error = e) });
      tick();

      const req = controller.expectOne('/api/storage/blobs');
      req.flush('Server Error', { status: 500, statusText: 'Internal Server Error' });
      tick();

      expect(auth.startOrJoinRefresh).not.toHaveBeenCalled();
      expect(auth.logout).not.toHaveBeenCalled();
      expect((error as HttpErrorResponse).status).toBe(500);
    }));

    it('passes through 403 errors unchanged', fakeAsync(() => {
      const auth = makeMockAuth({ token: 'token' });
      const { http, controller } = setup(auth);

      let error: unknown;
      http.get('/api/storage/blobs').subscribe({ error: e => (error = e) });
      tick();

      const req = controller.expectOne('/api/storage/blobs');
      req.flush('Forbidden', { status: 403, statusText: 'Forbidden' });
      tick();

      expect(auth.startOrJoinRefresh).not.toHaveBeenCalled();
      expect((error as HttpErrorResponse).status).toBe(403);
    }));
  });
});
