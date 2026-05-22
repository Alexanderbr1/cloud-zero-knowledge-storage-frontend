import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';

import { AuthService } from '../../../../core/services/auth.service';
import { DeviceSession } from '../../models/session.model';
import { SessionsService } from '../../services/sessions.service';
import { SessionsComponent } from '../../components/sessions-list/sessions.component';

@Component({
    selector: 'app-profile',
    imports: [RouterLink, SessionsComponent],
    templateUrl: './profile.component.html',
    styleUrl: './profile.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfileComponent implements OnInit {
  private readonly auth            = inject(AuthService);
  private readonly sessionsService = inject(SessionsService);
  private readonly destroyRef      = inject(DestroyRef);
  private readonly router          = inject(Router);

  readonly email = computed(() => this.auth.email() ?? '—');
  readonly userInitial = computed(() => {
    const e = this.auth.email();
    return e ? e.charAt(0).toUpperCase() : '?';
  });

  readonly sessions      = signal<readonly DeviceSession[]>([]);
  readonly isLoading     = signal(false);
  readonly revoking      = signal<string | null>(null);
  readonly errorMessage  = signal('');

  ngOnInit(): void {
    this.loadSessions();
  }

  private loadSessions(): void {
    this.isLoading.set(true);
    this.errorMessage.set('');
    this.sessionsService.list().pipe(
      finalize(() => this.isLoading.set(false)),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: s => this.sessions.set(s),
      error: () => this.errorMessage.set('Не удалось загрузить список сессий.'),
    });
  }

  onRevokeSession(session: DeviceSession): void {
    this.revoking.set(session.id);
    this.sessionsService.revoke(session.id).pipe(
      finalize(() => this.revoking.set(null)),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: () => this.sessions.update(list => list.filter(s => s.id !== session.id)),
      error: () => this.errorMessage.set('Не удалось завершить сессию.'),
    });
  }

  onRevokeOthers(): void {
    this.revoking.set('others');
    this.sessionsService.revokeOthers().pipe(
      finalize(() => this.revoking.set(null)),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: () => this.sessions.update(list => list.filter(s => s.is_current)),
      error: () => this.errorMessage.set('Не удалось завершить другие сессии.'),
    });
  }

  logout(): void {
    this.auth.logout();
    this.router.navigate(['/']);
  }
}
