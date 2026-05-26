import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import {
  HttpClient,
  provideHttpClient,
  withInterceptors,
} from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';

import { credentialsInterceptor } from './credentials.interceptor';
import { environment } from '../../../environments/environment';

// ─── helpers ─────────────────────────────────────────────────────────────────

function setup() {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(withInterceptors([credentialsInterceptor])),
      provideHttpClientTesting(),
    ],
  });
  return {
    http:       TestBed.inject(HttpClient),
    controller: TestBed.inject(HttpTestingController),
  };
}

// ─────────────────────────────────────────────────────────────────────────────

describe('credentialsInterceptor', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  // apiBaseUrl = '/api' in the test environment.

  it('sets withCredentials for requests to the API base URL', fakeAsync(() => {
    const { http, controller } = setup();

    http.get(`${environment.apiBaseUrl}/storage/blobs`).subscribe();
    tick();

    const req = controller.expectOne(`${environment.apiBaseUrl}/storage/blobs`);
    expect(req.request.withCredentials).toBeTrue();
    req.flush([]);
  }));

  it('sets withCredentials for requests to the API base URL itself', fakeAsync(() => {
    const { http, controller } = setup();

    http.get(environment.apiBaseUrl).subscribe();
    tick();

    const req = controller.expectOne(environment.apiBaseUrl);
    expect(req.request.withCredentials).toBeTrue();
    req.flush({});
  }));

  it('does NOT set withCredentials for requests to external URLs (S3/MinIO)', fakeAsync(() => {
    const { http, controller } = setup();

    http.put('https://s3.example.com/upload/some-object', new Uint8Array()).subscribe();
    tick();

    const req = controller.expectOne('https://s3.example.com/upload/some-object');
    expect(req.request.withCredentials).toBeFalse();
    req.flush(null);
  }));

  it('does NOT set withCredentials for other external URLs', fakeAsync(() => {
    const { http, controller } = setup();

    http.get('https://cdn.example.com/file.jpg').subscribe();
    tick();

    const req = controller.expectOne('https://cdn.example.com/file.jpg');
    expect(req.request.withCredentials).toBeFalse();
    req.flush(null);
  }));

  it('sets withCredentials for any sub-path under the base', fakeAsync(() => {
    const { http, controller } = setup();
    const paths = [
      `${environment.apiBaseUrl}/auth/refresh`,
      `${environment.apiBaseUrl}/storage/usage`,
      `${environment.apiBaseUrl}/sessions`,
    ];

    for (const path of paths) {
      http.get(path).subscribe();
      tick();
      const req = controller.expectOne(path);
      expect(req.request.withCredentials)
        .withContext(`expected withCredentials for ${path}`)
        .toBeTrue();
      req.flush({});
    }
  }));
});
