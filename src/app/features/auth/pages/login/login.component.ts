import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { finalize } from 'rxjs';

import { AuthService } from '../../../../core/services/auth.service';
import { AuthPanelComponent } from '../../components/auth-panel/auth-panel.component';

@Component({
  selector: 'app-login-page',
  imports: [AuthPanelComponent],
  template: `
    <app-auth-panel
      [credentialsForm]="loginForm"
      [mode]="authMode()"
      [isSubmitting]="isSubmitting()"
      [errorText]="errorMessage()"
      (modeChange)="setAuthMode($event)"
      (submitted)="submit()"
    />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginPageComponent {
  private readonly auth   = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route  = inject(ActivatedRoute);
  private readonly fb     = inject(FormBuilder);

  readonly authMode     = signal<'login' | 'register'>('login');
  readonly isSubmitting = signal(false);
  readonly errorMessage = signal('');

  private readonly passwordMinLen  = Validators.minLength(8);
  private readonly passwordPattern = Validators.pattern(/^(?=.*[A-Za-z])(?=.*\d).+$/);

  readonly loginForm = this.fb.nonNullable.group({
    email:    ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]],
  });

  setAuthMode(mode: 'login' | 'register'): void {
    this.authMode.set(mode);
    this.errorMessage.set('');
    const pass = this.loginForm.controls.password;
    if (mode === 'register') {
      pass.addValidators([this.passwordMinLen, this.passwordPattern]);
    } else {
      pass.removeValidators([this.passwordMinLen, this.passwordPattern]);
    }
    pass.updateValueAndValidity();
  }

  submit(): void {
    this.errorMessage.set('');
    if (this.loginForm.invalid) {
      this.errorMessage.set('Введите корректный email и пароль.');
      return;
    }

    const { email, password } = this.loginForm.getRawValue();
    this.isSubmitting.set(true);

    const req$ = this.authMode() === 'register'
      ? this.auth.register(email, password)
      : this.auth.login(email, password);

    req$.pipe(finalize(() => this.isSubmitting.set(false))).subscribe({
      next: () => {
        this.loginForm.controls.password.setValue('');
        const returnUrl = this.route.snapshot.queryParams['returnUrl'] ?? '/files';
        this.router.navigateByUrl(returnUrl);
      },
      error: (err: unknown) => {
        if (err instanceof HttpErrorResponse) {
          this.errorMessage.set(
            this.authMode() === 'register'
              ? 'Не удалось создать аккаунт. Возможно, email уже используется.'
              : 'Неверный email или пароль.',
          );
          return;
        }
        this.errorMessage.set(
          err instanceof Error && err.message ? err.message : 'Произошла ошибка. Попробуйте снова.',
        );
      },
    });
  }
}
