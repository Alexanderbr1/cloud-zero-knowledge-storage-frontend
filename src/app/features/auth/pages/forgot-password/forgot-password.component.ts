import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';

import { AuthService } from '../../../../core/services/auth.service';

@Component({
  selector: 'app-forgot-password',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './forgot-password.component.html',
  styleUrl: './forgot-password.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ForgotPasswordComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly email = new FormControl('', [Validators.required, Validators.email]);
  readonly isSubmitting = signal(false);
  readonly errorMessage = signal('');
  readonly sent = signal(false);

  submit(): void {
    this.email.markAsTouched();
    if (this.email.invalid || this.isSubmitting()) return;

    this.isSubmitting.set(true);
    this.errorMessage.set('');

    this.auth.requestPasswordReset(this.email.value!).pipe(
      finalize(() => this.isSubmitting.set(false)),
    ).subscribe({
      next: () => this.sent.set(true),
      error: () => this.errorMessage.set('Не удалось отправить письмо. Попробуйте позже.'),
    });
  }
}
