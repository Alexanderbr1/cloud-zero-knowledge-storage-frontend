import { Component, OnInit, inject, signal } from '@angular/core';
import { finalize } from 'rxjs';

import { DeviceSession } from '../core/models/session.model';
import { SessionsService } from '../core/services/sessions.service';

@Component({
  selector: 'app-sessions',
  standalone: true,
  imports: [],
  templateUrl: './sessions.component.html',
  styleUrl: './sessions.component.scss',
})
export class SessionsComponent implements OnInit {
  private readonly sessionsService = inject(SessionsService);

  readonly sessions = signal<DeviceSession[]>([]);
  readonly isLoading = signal(false);
  readonly revoking = signal<string | null>(null);
  readonly errorMessage = signal('');

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.isLoading.set(true);
    this.errorMessage.set('');
    this.sessionsService
      .list()
      .pipe(finalize(() => this.isLoading.set(false)))
      .subscribe({
        next: sessions => this.sessions.set(sessions),
        error: () => this.errorMessage.set('Не удалось загрузить список сессий.'),
      });
  }

  revokeSession(session: DeviceSession): void {
    this.revoking.set(session.id);
    this.sessionsService
      .revoke(session.id)
      .pipe(finalize(() => this.revoking.set(null)))
      .subscribe({
        next: () => this.sessions.update(list => list.filter(s => s.id !== session.id)),
        error: () => this.errorMessage.set('Не удалось завершить сессию.'),
      });
  }

  revokeOthers(): void {
    this.revoking.set('others');
    this.sessionsService
      .revokeOthers()
      .pipe(finalize(() => this.revoking.set(null)))
      .subscribe({
        next: () => this.sessions.update(list => list.filter(s => s.is_current)),
        error: () => this.errorMessage.set('Не удалось завершить другие сессии.'),
      });
  }

  pluralSessions(n: number): string {
    if (n % 10 === 1 && n % 100 !== 11) return 'сессия';
    if ([2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100)) return 'сессии';
    return 'сессий';
  }

  formatRelative(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 2) return 'только что';
    if (mins < 60) return `${mins} мин. назад`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs} ч. назад`;
    const days = Math.floor(hrs / 24);
    if (days === 1) return 'вчера';
    if (days < 30) return `${days} дн. назад`;
    return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  }
}
