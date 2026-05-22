import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';

import { AuthService } from '../../../../core/services/auth.service';
import { ShareItem, SharingService } from '../../../../core/services/sharing.service';
import { ToastService } from '../../../../core/services/toast.service';
import { shortMimeType } from '../../../../core/utils/browser.utils';

@Component({
    selector: 'app-shared-with-me',
    imports: [DatePipe],
    templateUrl: './shared-with-me.component.html',
    styleUrl: './shared-with-me.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class SharedWithMeComponent implements OnInit {
  private readonly sharingService = inject(SharingService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly shares = signal<ShareItem[]>([]);
  readonly isLoading = signal(false);
  readonly downloadingId = signal<string | null>(null);

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.isLoading.set(true);
    this.sharingService.listSharedWithMe().pipe(
      finalize(() => this.isLoading.set(false)),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: resp => this.shares.set(resp.items ?? []),
      error: () => this.toast.error('Не удалось загрузить список файлов.'),
    });
  }

  download(item: ShareItem): void {
    if (this.downloadingId() === item.share_id) return;
    this.downloadingId.set(item.share_id);

    this.sharingService.downloadSharedFile(item.share_id, item.content_type).pipe(
      finalize(() => this.downloadingId.set(null)),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: () => this.toast.success(`Файл «${item.file_name}» скачан.`),
      error: (err: unknown) => {
        if (err instanceof Error && err.message.startsWith('EC private key')) {
          this.auth.clearAccess();
          this.toast.error('Сессия истекла — войдите снова.');
          return;
        }
        this.toast.error(`Не удалось скачать «${item.file_name}».`);
      },
    });
  }

  shortType(mime: string): string {
    return shortMimeType(mime);
  }
}
