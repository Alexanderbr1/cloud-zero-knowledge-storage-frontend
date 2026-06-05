import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import { AuthService } from '../../../../core/services/auth.service';
import { UnlockPanelComponent } from '../../components/unlock-panel/unlock-panel.component';

@Component({
  selector: 'app-unlock-page',
  imports: [UnlockPanelComponent],
  template: `
    <app-unlock-panel
      [email]="auth.email() ?? ''"
      [isSubmitting]="isSubmitting()"
      [errorText]="errorMessage()"
      (submitted)="submit($event)"
      (logoutRequested)="logout()"
    />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UnlockPageComponent {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route  = inject(ActivatedRoute);

  readonly isSubmitting = signal(false);
  readonly errorMessage = signal('');

  async submit(password: string): Promise<void> {
    this.errorMessage.set('');
    this.isSubmitting.set(true);
    try {
      await this.auth.unlockSession(password);
      const returnUrl = this.route.snapshot.queryParams['returnUrl'] ?? '/files';
      this.router.navigateByUrl(returnUrl);
    } catch (err) {
      this.errorMessage.set(
        err instanceof Error && err.message ? err.message : 'Неверный пароль или сессия устарела.',
      );
    } finally {
      this.isSubmitting.set(false);
    }
  }

  logout(): void {
    this.auth.logout();
    this.router.navigate(['/auth/login']);
  }
}
