import { TestBed, ComponentFixture, fakeAsync, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import { ForgotPasswordComponent } from './forgot-password.component';
import { environment } from '../../../../../environments/environment';

const RESET_URL = `${environment.apiBaseUrl}/auth/reset-password/request`;

describe('ForgotPasswordComponent', () => {
  let fixture: ComponentFixture<ForgotPasswordComponent>;
  let comp:    ForgotPasswordComponent;
  let http:    HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports:   [ForgotPasswordComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ForgotPasswordComponent);
    comp    = fixture.componentInstance;
    http    = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  it('should create', () => {
    expect(comp).toBeTruthy();
  });

  // ─── initial state ────────────────────────────────────────────────────────

  it('isSubmitting is false initially', () => {
    expect(comp.isSubmitting()).toBeFalse();
  });

  it('sent is false initially', () => {
    expect(comp.sent()).toBeFalse();
  });

  it('errorMessage is empty initially', () => {
    expect(comp.errorMessage()).toBe('');
  });

  // ─── submit guard — invalid email ─────────────────────────────────────────

  it('submit() does nothing when email is empty', fakeAsync(() => {
    comp.email.setValue('');
    comp.submit();
    tick();

    http.expectNone(RESET_URL);
    expect(comp.sent()).toBeFalse();
  }));

  it('submit() does nothing when email is invalid', fakeAsync(() => {
    comp.email.setValue('not-an-email');
    comp.submit();
    tick();

    http.expectNone(RESET_URL);
    expect(comp.sent()).toBeFalse();
  }));

  it('submit() does nothing when already submitting', fakeAsync(() => {
    comp.email.setValue('alice@example.com');
    // Force isSubmitting state.
    (comp as unknown as { isSubmitting: { set: (v: boolean) => void } }).isSubmitting.set(true);

    comp.submit();
    tick();

    http.expectNone(RESET_URL);
  }));

  // ─── submit success ───────────────────────────────────────────────────────

  it('submit() POSTs to reset-password/request and sets sent=true on success', fakeAsync(() => {
    comp.email.setValue('alice@example.com');
    comp.submit();
    tick();

    const req = http.expectOne(RESET_URL);
    expect(req.request.method).toBe('POST');
    req.flush(null, { status: 204, statusText: 'No Content' });
    tick();

    expect(comp.sent()).toBeTrue();
    expect(comp.isSubmitting()).toBeFalse();
  }));

  // ─── submit error ─────────────────────────────────────────────────────────

  it('submit() sets errorMessage and resets isSubmitting on HTTP error', fakeAsync(() => {
    comp.email.setValue('alice@example.com');
    comp.submit();
    tick();

    http.expectOne(RESET_URL).flush('Error', { status: 500, statusText: 'Internal Server Error' });
    tick();

    expect(comp.sent()).toBeFalse();
    expect(comp.isSubmitting()).toBeFalse();
    expect(comp.errorMessage().length).toBeGreaterThan(0);
  }));

  // ─── isSubmitting during request ─────────────────────────────────────────

  it('isSubmitting is true while the request is in-flight', fakeAsync(() => {
    comp.email.setValue('alice@example.com');
    comp.submit();
    tick();

    expect(comp.isSubmitting()).toBeTrue();

    http.expectOne(RESET_URL).flush(null);
    tick();

    expect(comp.isSubmitting()).toBeFalse();
  }));
});
