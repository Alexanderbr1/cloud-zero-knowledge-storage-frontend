import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { finalize } from 'rxjs';

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
