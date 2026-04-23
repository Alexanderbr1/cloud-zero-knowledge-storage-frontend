import { Component, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, Validators } from '@angular/forms';
import { Router, RouterOutlet } from '@angular/router';
import { finalize } from 'rxjs';

import { AuthService } from './core/services/auth.service';
import { AuthPanelComponent } from './features/auth/components/auth-panel/auth-panel.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, AuthPanelComponent],
  template: `
    @if (!isAuthed()) {
      <app-auth-panel
        [credentialsForm]="loginForm"
        [mode]="authMode()"
        [isSubmitting]="isSubmitting()"
        [errorText]="errorMessage()"
        (modeChange)="setAuthMode($event)"
        (submitted)="submitAuth()"
      />
    } @else {
      <router-outlet />
    }
  `,
})
export class AppComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);

  readonly isAuthed = computed(() => this.auth.isAuthenticated());
  readonly authMode = signal<'login' | 'register'>('login');
  readonly isSubmitting = signal(false);
  readonly errorMessage = signal('');

  private readonly registerPasswordMinLen = Validators.minLength(8);

  loginForm = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]],
  });

  setAuthMode(mode: 'login' | 'register'): void {
    this.authMode.set(mode);
    this.errorMessage.set('');
    const pass = this.loginForm.controls.password;
    if (mode === 'register') {
      pass.addValidators(this.registerPasswordMinLen);
    } else {
      pass.removeValidators(this.registerPasswordMinLen);
    }
    pass.updateValueAndValidity();
  }

  submitAuth(): void {
    this.errorMessage.set('');
    if (this.loginForm.invalid) {
      this.errorMessage.set('Введите корректный email и пароль.');
      return;
    }

    const { email, password } = this.loginForm.getRawValue();
    this.isSubmitting.set(true);

    const req$ =
      this.authMode() === 'register'
        ? this.auth.register(email, password)
        : this.auth.login(email, password);

    req$.pipe(finalize(() => this.isSubmitting.set(false))).subscribe({
      next: () => {
        this.loginForm.controls.password.setValue('');
        this.router.navigate(['/files']);
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
        if (err instanceof Error && err.message) {
          this.errorMessage.set(err.message);
          return;
        }
        this.errorMessage.set('Произошла ошибка. Попробуйте снова.');
      },
    });
  }
}
