import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { finalize, map, startWith } from 'rxjs';

import { AuthService } from '../../../../core/services/auth.service';

@Component({
  selector: 'app-reset-password',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './reset-password.component.html',
  styleUrl: './reset-password.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ResetPasswordComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);

  private token = '';

  readonly form = new FormGroup({
    recoveryPhrase: new FormControl('', [Validators.required]),
    newPassword:    new FormControl('', [Validators.required, Validators.minLength(8)]),
  });

  readonly isSubmitting = signal(false);
  readonly errorMessage = signal('');
  readonly done = signal(false);
  readonly tokenMissing = signal(false);

  readonly strengthSegs = [0, 1, 2, 3] as const;

  private readonly newPwValue = toSignal(
    this.form.controls.newPassword.valueChanges.pipe(
      startWith(this.form.controls.newPassword.value),
      map(v => v ?? ''),
    ),
    { initialValue: '' },
  );

  private readonly strengthScore = computed((): number => {
    const v = this.newPwValue();
    let s = 0;
    if (v.length >= 8)           s++;
    if (/[A-Z]/.test(v))         s++;
    if (/[a-z]/.test(v))         s++;
    if (/[0-9]/.test(v))         s++;
    if (/[^A-Za-z0-9]/.test(v))  s++;
    return s;
  });

  readonly strengthLevel = computed((): 0 | 1 | 2 | 3 | 4 => {
    const v = this.newPwValue();
    if (!v) return 0;
    const s = this.strengthScore();
    if (s <= 2) return 1;
    if (s === 3) return 2;
    if (s === 4) return 3;
    return 4;
  });

  readonly strengthLabel = computed((): string => {
    const labels: Record<number, string> = { 1: 'Слабый', 2: 'Средний', 3: 'Хороший', 4: 'Надёжный' };
    return labels[this.strengthLevel()] ?? '';
  });

  readonly strengthReqs = computed((): { label: string; met: boolean }[] => {
    const v = this.newPwValue();
    return [
      { label: 'Минимум 8 символов', met: v.length >= 8 },
      { label: 'Заглавная буква',     met: /[A-Z]/.test(v) },
      { label: 'Строчная буква',      met: /[a-z]/.test(v) },
      { label: 'Цифра (0–9)',         met: /[0-9]/.test(v) },
      { label: 'Спецсимвол (!@#…)',   met: /[^A-Za-z0-9]/.test(v) },
    ];
  });

  ngOnInit(): void {
    const t = this.route.snapshot.queryParamMap.get('token');
    if (!t) {
      this.tokenMissing.set(true);
      return;
    }
    this.token = t;
  }

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
          if (err.status === 404 || err.status === 422) {
            this.errorMessage.set('Ссылка устарела или уже использована. Запросите новую.');
          } else {
            this.errorMessage.set('Не удалось сбросить пароль. Попробуйте позже.');
          }
          return;
        }
        // DOMException from Web Crypto — wrong recovery phrase causes AES-KW unwrap failure.
        this.errorMessage.set('Неверная ключевая фраза. Проверьте написание слов.');
      },
    });
  }
}
