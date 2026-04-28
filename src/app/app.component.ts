import { Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, Validators } from '@angular/forms';
import { Router, RouterOutlet } from '@angular/router';
import { finalize } from 'rxjs';

import { AuthService } from './core/services/auth.service';
import { AuthPanelComponent } from './features/auth/components/auth-panel/auth-panel.component';
import { UnlockPanelComponent } from './features/auth/components/unlock-panel/unlock-panel.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, AuthPanelComponent, UnlockPanelComponent],
  template: `
    @switch (appState()) {
      @case ('checking') {
        <div class="app-loading" aria-label="Загрузка" aria-busy="true"></div>
      }
      @case ('login') {
        <app-auth-panel
          [credentialsForm]="loginForm"
          [mode]="authMode()"
          [isSubmitting]="isSubmitting()"
          [errorText]="errorMessage()"
          (modeChange)="setAuthMode($event)"
          (submitted)="submitAuth()"
        />
      }
      @case ('unlock') {
        <app-unlock-panel
          [email]="auth.email() ?? ''"
          [isSubmitting]="isSubmitting()"
          [errorText]="errorMessage()"
          (submitted)="submitUnlock($event)"
          (logoutRequested)="submitLogout()"
        />
      }
      @case ('app') {
        <router-outlet />
      }
    }
  `,
  styles: [`
    .app-loading {
      display: flex;
      min-height: 100vh;
      min-height: 100dvh;
      background: var(--c-bg);
    }
  `],
})
export class AppComponent implements OnInit {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);

  private readonly restoring = signal(true);

  readonly appState = computed<'checking' | 'login' | 'unlock' | 'app'>(() => {
    if (this.auth.isAuthenticated()) {
      return this.auth.isUnlocked() ? 'app' : 'unlock';
    }
    return this.restoring() ? 'checking' : 'login';
  });

  constructor() {
    effect(() => {
      console.log('[AppState]', this.appState(),
        '| isAuthenticated:', this.auth.isAuthenticated(),
        '| isUnlocked:', this.auth.isUnlocked(),
        '| restoring:', this.restoring());
    });
  }

  readonly authMode = signal<'login' | 'register'>('login');
  readonly isSubmitting = signal(false);
  readonly errorMessage = signal('');

  private readonly registerPasswordMinLen = Validators.minLength(8);

  loginForm = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]],
  });

  ngOnInit(): void {
    console.log('[ngOnInit] hadSession:', this.auth.hadSession());
    if (!this.auth.hadSession()) {
      console.log('[ngOnInit] no prior session → restoring=false');
      this.restoring.set(false);
      return;
    }
    console.log('[ngOnInit] calling tryRestoreSession...');
    this.auth.tryRestoreSession().subscribe((ok) => {
      console.log('[ngOnInit] tryRestoreSession result:', ok);
      this.restoring.set(false);
    });
  }

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

  submitUnlock(password: string): void {
    console.log('[submitUnlock] start');
    this.errorMessage.set('');
    this.isSubmitting.set(true);
    this.auth.unlockSession(password).then(
      () => {
        console.log('[submitUnlock] success | isUnlocked:', this.auth.isUnlocked(), '| appState:', this.appState());
        this.isSubmitting.set(false);
      },
      (err: unknown) => {
        console.error('[submitUnlock] error:', err);
        this.isSubmitting.set(false);
        this.errorMessage.set(
          err instanceof Error && err.message
            ? err.message
            : 'Неверный пароль или сессия устарела.',
        );
      },
    );
  }

  submitLogout(): void {
    this.auth.logout();
  }
}
