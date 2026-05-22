import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

import { DeviceSession } from '../../models/session.model';

@Component({
    selector: 'app-sessions',
    imports: [],
    templateUrl: './sessions.component.html',
    styleUrl: './sessions.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SessionsComponent {
  readonly sessions      = input.required<readonly DeviceSession[]>();
  readonly isLoading     = input.required<boolean>();
  readonly revoking      = input<string | null>(null);
  readonly errorMessage  = input<string>('');

  readonly sessionRevoked = output<DeviceSession>();
  readonly othersRevoked  = output<void>();

  revokeSession(session: DeviceSession): void {
    this.sessionRevoked.emit(session);
  }

  revokeOthers(): void {
    this.othersRevoked.emit();
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
