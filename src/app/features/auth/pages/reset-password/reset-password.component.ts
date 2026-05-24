import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { finalize, map, startWith } from 'rxjs';

import { AuthService } from '../../../../core/services/auth.service';
import { passwordScore, passwordReqs } from '../../../../core/utils/browser.utils';

const STRENGTH_LABELS: Record<number, string> = { 1: 'Слабый', 2: 'Средний', 3: 'Хороший', 4: 'Надёжный' };

@Component({
  selector: 'app-reset-password',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './reset-password.component.html',
  styleUrl: './reset-password.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ResetPasswordComponent {
  private readonly auth  = inject(AuthService);
  private readonly route = inject(ActivatedRoute);

  private readonly token = this.route.snapshot.queryParamMap.get('token') ?? '';

  readonly form = new FormGroup({
    recoveryPhrase: new FormControl('', [Validators.required]),
    newPassword:    new FormControl('', [Validators.required, Validators.minLength(8)]),
  });

  readonly isSubmitting = signal(false);
  readonly errorMessage = signal('');
  readonly done         = signal(false);
  readonly tokenMissing = signal(!this.token);

  readonly strengthSegs = [0, 1, 2, 3] as const;

  private readonly newPwValue = toSignal(
    this.form.controls.newPassword.valueChanges.pipe(
      startWith(this.form.controls.newPassword.value),
      map(v => v ?? ''),
    ),
    { initialValue: '' },
  );

  private readonly strengthScore = computed(() => passwordScore(this.newPwValue()));

  readonly strengthLevel = computed((): 0 | 1 | 2 | 3 | 4 => {
    const v = this.newPwValue();
    if (!v) return 0;
    const s = this.strengthScore();
    if (s <= 2) return 1;
    if (s === 3) return 2;
    if (s === 4) return 3;
    return 4;
  });

  readonly strengthLabel = computed(() => STRENGTH_LABELS[this.strengthLevel()] ?? '');
  readonly strengthReqs  = computed(() => passwordReqs(this.newPwValue()));

  submit(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.isSubmitting()) return;

    const { recoveryPhrase, newPassword } = this.form.getRawValue();
    this.isSubmitting.set(true);
    this.errorMessage.set('');

    this.auth.resetPassword(this.token, recoveryPhrase!.trim(), newPassword!).pipe(
      finalize(() => this.isSubmitting.set(false)),
    ).subscribe({
      next: () => this.done.set(true),
      error: (err: unknown) => {
        if (err instanceof HttpErrorResponse) {
          this.errorMessage.set(
            err.status === 404 || err.status === 422
              ? 'Ссылка устарела или уже использована. Запросите новую.'
              : 'Не удалось сбросить пароль. Попробуйте позже.',
          );
          return;
        }
        // DOMException из Web Crypto — неверная ключевая фраза вызывает ошибку AES-KW unwrap
        this.errorMessage.set('Неверная ключевая фраза. Проверьте написание слов.');
      },
    });
  }
}
