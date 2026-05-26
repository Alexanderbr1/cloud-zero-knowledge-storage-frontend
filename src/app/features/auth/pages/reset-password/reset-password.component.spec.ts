import { TestBed, ComponentFixture, fakeAsync, tick } from '@angular/core/testing';
import { provideHttpClient, HttpErrorResponse } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';

import { ResetPasswordComponent } from './reset-password.component';
import { AuthService } from '../../../../core/services/auth.service';
import { environment } from '../../../../../environments/environment';

const RESET_URL = `${environment.apiBaseUrl}/auth/reset-password/confirm`;

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeRoute(token: string) {
  return {
    snapshot: {
      queryParamMap: {
        get: (key: string) => (key === 'token' ? token : null),
      },
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────

describe('ResetPasswordComponent', () => {
  let fixture: ComponentFixture<ResetPasswordComponent>;
  let comp:    ResetPasswordComponent;
  let http:    HttpTestingController;

  async function create(token = 'valid-reset-token') {
    await TestBed.configureTestingModule({
      imports:   [ResetPasswordComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: ActivatedRoute, useValue: makeRoute(token) },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ResetPasswordComponent);
    comp    = fixture.componentInstance;
    http    = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  }

  afterEach(() => http?.verify());

  // ─── tokenMissing ─────────────────────────────────────────────────────────

  it('tokenMissing is false when a token is present in the route', async () => {
    await create('abc123');
    expect(comp.tokenMissing()).toBeFalse();
  });

  it('tokenMissing is true when no token param', async () => {
    await create('');
    expect(comp.tokenMissing()).toBeTrue();
  });

  // ─── initial state ────────────────────────────────────────────────────────

  it('isSubmitting is false initially', async () => {
    await create();
    expect(comp.isSubmitting()).toBeFalse();
  });

  it('done is false initially', async () => {
    await create();
    expect(comp.done()).toBeFalse();
  });

  it('errorMessage is empty initially', async () => {
    await create();
    expect(comp.errorMessage()).toBe('');
  });

  // ─── submit guard — invalid form ──────────────────────────────────────────

  it('submit() does nothing when form is invalid', fakeAsync(async () => {
    await create();
    comp.form.controls.recoveryPhrase.setValue('');
    comp.form.controls.newPassword.setValue('');

    comp.submit();
    tick();

    http.expectNone(RESET_URL);
    expect(comp.done()).toBeFalse();
  }));

  it('submit() does nothing when already submitting', fakeAsync(async () => {
    await create();
    comp.form.setValue({ recoveryPhrase: 'word1 word2', newPassword: 'newpassword1' });
    (comp as unknown as { isSubmitting: { set: (v: boolean) => void } }).isSubmitting.set(true);

    comp.submit();
    tick();

    http.expectNone(RESET_URL);
  }));

  // ─── submit success ───────────────────────────────────────────────────────

  it('submit() calls auth.resetPassword and sets done=true on success', fakeAsync(async () => {
    await create('tok123');
    const authSvc = TestBed.inject(AuthService);
    spyOn(authSvc, 'resetPassword').and.returnValue(of(undefined));

    comp.form.setValue({ recoveryPhrase: 'word1 word2 word3', newPassword: 'NewPass#1234' });
    comp.submit();
    tick();

    expect(comp.done()).toBeTrue();
    expect(comp.isSubmitting()).toBeFalse();
  }));

  // ─── submit error — 404/422 → link expired ────────────────────────────────

  it('submit() sets "link expired" message on 404', fakeAsync(async () => {
    await create('tok123');
    const authSvc = TestBed.inject(AuthService);
    spyOn(authSvc, 'resetPassword').and.returnValue(
      throwError(() => new HttpErrorResponse({ status: 404 })),
    );

    comp.form.setValue({ recoveryPhrase: 'word1 word2', newPassword: 'NewPass#1234' });
    comp.submit();
    tick();

    expect(comp.done()).toBeFalse();
    expect(comp.errorMessage()).toContain('устарела');
  }));

  it('submit() sets "link expired" message on 422', fakeAsync(async () => {
    await create('tok123');
    const authSvc = TestBed.inject(AuthService);
    spyOn(authSvc, 'resetPassword').and.returnValue(
      throwError(() => new HttpErrorResponse({ status: 422 })),
    );

    comp.form.setValue({ recoveryPhrase: 'word1 word2', newPassword: 'NewPass#1234' });
    comp.submit();
    tick();

    expect(comp.errorMessage()).toContain('устарела');
  }));

  // ─── submit error — DOMException → bad recovery phrase ───────────────────

  it('submit() sets "неверная ключевая фраза" on DOMException (crypto failure)', fakeAsync(async () => {
    await create('tok123');
    const authSvc = TestBed.inject(AuthService);
    spyOn(authSvc, 'resetPassword').and.returnValue(
      throwError(() => new DOMException('The operation failed', 'OperationError')),
    );

    comp.form.setValue({ recoveryPhrase: 'wrong phrase here', newPassword: 'NewPass#1234' });
    comp.submit();
    tick();

    expect(comp.errorMessage()).toContain('Неверная ключевая фраза');
  }));

  // ─── strengthLevel ────────────────────────────────────────────────────────

  it('strengthLevel is 0 for empty new password', async () => {
    await create();
    comp.form.controls.newPassword.setValue('');
    comp.form.controls.newPassword.updateValueAndValidity();
    fixture.detectChanges();
    expect(comp.strengthLevel()).toBe(0);
  });

  it('strengthLevel is 4 for a very strong new password', async () => {
    await create();
    comp.form.controls.newPassword.setValue('C0rrect!Horse#Battery$Staple99');
    comp.form.controls.newPassword.updateValueAndValidity();
    fixture.detectChanges();
    expect(comp.strengthLevel()).toBe(4);
  });
});
