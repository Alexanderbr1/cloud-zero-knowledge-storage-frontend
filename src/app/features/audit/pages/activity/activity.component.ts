import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';

import { AuditService } from '../../services/audit.service';
import { AuditEvent } from '../../models/audit.model';
import { ToastService } from '../../../../core/services/toast.service';

type FilterCategory = 'all' | 'files' | 'folders' | 'auth';
type IconType       = 'auth' | 'upload' | 'download' | 'trash' | 'restore' | 'share' | 'file' | 'folder';

const PAGE_SIZE = 50;

const EVENT_LABELS: Record<string, string> = {
  login_success:          'Вход в аккаунт',
  login_failed:           'Неудачная попытка входа',
  logout:                 'Выход из аккаунта',
  password_reset:         'Пароль сброшен',
  session_revoked:        'Завершена сессия',
  sessions_revoked_other: 'Завершены другие сессии',
  file_uploaded:          'Файл загружен',
  file_downloaded:        'Файл скачан',
  file_deleted:           'Файл перемещён в корзину',
  file_restored:          'Файл восстановлен',
  file_hard_deleted:      'Файл удалён навсегда',
  file_renamed:           'Файл переименован',
  file_moved:             'Файл перемещён',
  folder_moved:           'Папка перемещена',
  file_shared:                  'Открыт доступ к файлу',
  file_share_revoked:           'Доступ к файлу отозван',
  file_downloaded_via_share:    'Файл скачан по ссылке доступа',
  folder_created:         'Папка создана',
  folder_deleted:         'Папка перемещена в корзину',
  folder_hard_deleted:    'Папка удалена навсегда',
  folder_restored:        'Папка восстановлена',
  folder_renamed:         'Папка переименована',
};

const EVENT_ICON_CLASS: Record<string, string> = {
  login_success:          'event-icon--success',
  login_failed:           'event-icon--danger',
  logout:                 'event-icon--neutral',
  password_reset:         'event-icon--warn',
  session_revoked:        'event-icon--warn',
  sessions_revoked_other: 'event-icon--warn',
  file_uploaded:          'event-icon--success',
  file_downloaded:        'event-icon--info',
  file_deleted:           'event-icon--warn',
  file_restored:          'event-icon--success',
  file_hard_deleted:      'event-icon--danger',
  file_renamed:           'event-icon--neutral',
  file_moved:             'event-icon--neutral',
  file_shared:                  'event-icon--info',
  file_share_revoked:           'event-icon--warn',
  file_downloaded_via_share:    'event-icon--info',
  folder_created:         'event-icon--success',
  folder_deleted:         'event-icon--warn',
  folder_hard_deleted:    'event-icon--danger',
  folder_restored:        'event-icon--success',
  folder_renamed:         'event-icon--neutral',
  folder_moved:           'event-icon--neutral',
};

function resolveCategory(type: string): FilterCategory {
  if (type.startsWith('file_'))   return 'files';
  if (type.startsWith('folder_')) return 'folders';
  return 'auth';
}

function resolveIconType(type: string): IconType {
  if (type.startsWith('login') || type === 'logout' || type.startsWith('session')) return 'auth';
  if (type === 'file_uploaded')                                  return 'upload';
  if (type === 'file_downloaded')                                return 'download';
  if (type === 'file_deleted'   || type === 'file_hard_deleted') return 'trash';
  if (type === 'folder_deleted' || type === 'folder_hard_deleted') return 'trash';
  if (type === 'file_restored'  || type === 'folder_restored')   return 'restore';
  if (type === 'file_shared' || type === 'file_share_revoked' || type === 'file_downloaded_via_share') return 'share';
  if (type.startsWith('file_')) return 'file';
  return 'folder';
}

@Component({
  selector: 'app-activity',
  imports: [DatePipe],
  templateUrl: './activity.component.html',
  styleUrl: './activity.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ActivityComponent implements OnInit {
  private readonly auditService = inject(AuditService);
  private readonly destroyRef   = inject(DestroyRef);
  private readonly toast        = inject(ToastService);

  readonly events      = signal<readonly AuditEvent[]>([]);
  readonly loading     = signal(true);
  readonly error       = signal<string | null>(null);
  readonly loadingMore = signal(false);
  readonly hasMore     = signal(false);
  readonly activeFilter = signal<FilterCategory>('all');
  readonly searchQuery  = signal('');

  readonly filteredEvents = computed(() => {
    const filter = this.activeFilter();
    const query  = this.searchQuery().toLowerCase().trim();
    return this.events().filter(e => {
      if (filter !== 'all' && resolveCategory(e.event_type) !== filter) return false;
      if (query) {
        const label    = (EVENT_LABELS[e.event_type] ?? e.event_type).toLowerCase();
        const resource = (e.resource_name ?? '').toLowerCase();
        if (!label.includes(query) && !resource.includes(query)) return false;
      }
      return true;
    });
  });

  protected readonly eventLabel     = (type: string) => EVENT_LABELS[type]    ?? type;
  protected readonly eventIconClass = (type: string) => EVENT_ICON_CLASS[type] ?? 'event-icon--neutral';
  protected readonly eventIconType  = resolveIconType;

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.auditService.list(PAGE_SIZE).pipe(
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: evts => {
        this.events.set(evts);
        this.hasMore.set(evts.length === PAGE_SIZE);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Не удалось загрузить журнал активности');
        this.loading.set(false);
      },
    });
  }

  loadMore(): void {
    const oldest = this.events().at(-1);
    if (!oldest) return;

    this.loadingMore.set(true);
    this.auditService.list(PAGE_SIZE, oldest.created_at).pipe(
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: evts => {
        this.events.update(prev => [...prev, ...evts]);
        this.hasMore.set(evts.length === PAGE_SIZE);
        this.loadingMore.set(false);
      },
      error: () => {
        this.loadingMore.set(false);
        this.toast.error('Не удалось загрузить следующую страницу.');
      },
    });
  }

  setFilter(f: FilterCategory): void  { this.activeFilter.set(f); }
  clearFilters(): void                 { this.activeFilter.set('all'); this.searchQuery.set(''); }
  onSearchInput(e: Event): void       { this.searchQuery.set((e.target as HTMLInputElement).value); }
}
