import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';

import { shortMimeType } from '../../../../core/utils/browser.utils';
import { StorageUsageService } from '../../../../core/services/storage-usage.service';
import { FilesService } from '../../services/files.service';
import { TrashFileItem, TrashFolderItem } from '../../models/trash.model';
import { ConfirmModalComponent } from '../../../../shared/components/confirm-modal/confirm-modal.component';

type PendingDelete =
  | { type: 'blob';   item: TrashFileItem }
  | { type: 'folder'; item: TrashFolderItem }
  | { type: 'empty' };

@Component({
    selector: 'app-trash',
    imports: [DatePipe, ConfirmModalComponent],
    templateUrl: './trash.component.html',
    styleUrl: './trash.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class TrashComponent implements OnInit {
  private readonly filesService = inject(FilesService);
  private readonly usageSvc = inject(StorageUsageService);
  private readonly destroyRef = inject(DestroyRef);

  readonly blobs = signal<TrashFileItem[]>([]);
  readonly folders = signal<TrashFolderItem[]>([]);
  readonly isLoading = signal(false);
  readonly actionMessage = signal('');
  readonly errorMessage = signal('');
  readonly pendingDelete = signal<PendingDelete | null>(null);
  readonly deleteLoading = signal(false);

  private readonly fadingOut = signal(new Set<string>());

  get isEmpty(): boolean {
    return this.blobs().length === 0 && this.folders().length === 0;
  }

  isFading(id: string): boolean {
    return this.fadingOut().has(id);
  }

  shortType(mime: string): string {
    return shortMimeType(mime);
  }

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.isLoading.set(true);
    this.actionMessage.set('');
    this.errorMessage.set('');
    this.filesService.listTrash().pipe(
      finalize(() => this.isLoading.set(false)),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: r => {
        this.blobs.set(r.blobs ?? []);
        this.folders.set(r.folders ?? []);
      },
      error: () => this.errorMessage.set('Не удалось загрузить корзину.'),
    });
  }

  restoreBlob(item: TrashFileItem): void {
    this.filesService.restoreBlob(item.blob_id).pipe(
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: () => this.animateOut(item.blob_id, () => {
        this.blobs.update(list => list.filter(b => b.blob_id !== item.blob_id));
        this.actionMessage.set(`«${item.file_name}» восстановлен.`);
        this.errorMessage.set('');
      }),
      error: () => this.errorMessage.set(`Не удалось восстановить «${item.file_name}».`),
    });
  }

  hardDeleteBlob(item: TrashFileItem): void {
    this.pendingDelete.set({ type: 'blob', item });
  }

  private doHardDeleteBlob(item: TrashFileItem): void {
    this.deleteLoading.set(true);
    this.filesService.hardDeleteBlob(item.blob_id).pipe(
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: () => {
        this.pendingDelete.set(null);
        this.deleteLoading.set(false);
        this.animateOut(item.blob_id, () => {
          this.blobs.update(list => list.filter(b => b.blob_id !== item.blob_id));
          this.actionMessage.set(`«${item.file_name}» удалён безвозвратно.`);
          this.errorMessage.set('');
          this.usageSvc.refresh();
        });
      },
      error: () => {
        this.pendingDelete.set(null);
        this.deleteLoading.set(false);
        this.errorMessage.set(`Не удалось удалить «${item.file_name}».`);
      },
    });
  }

  restoreFolder(item: TrashFolderItem): void {
    this.filesService.restoreFolder(item.folder_id).pipe(
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: () => this.animateOut(item.folder_id, () => {
        this.folders.update(list => list.filter(f => f.folder_id !== item.folder_id));
        this.actionMessage.set(`«${item.name}» восстановлена.`);
        this.errorMessage.set('');
      }),
      error: () => this.errorMessage.set(`Не удалось восстановить «${item.name}».`),
    });
  }

  hardDeleteFolder(item: TrashFolderItem): void {
    this.pendingDelete.set({ type: 'folder', item });
  }

  private doHardDeleteFolder(item: TrashFolderItem): void {
    this.deleteLoading.set(true);
    this.filesService.hardDeleteFolder(item.folder_id).pipe(
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: () => {
        this.pendingDelete.set(null);
        this.deleteLoading.set(false);
        this.animateOut(item.folder_id, () => {
          this.folders.update(list => list.filter(f => f.folder_id !== item.folder_id));
          this.actionMessage.set(`«${item.name}» удалена безвозвратно.`);
          this.errorMessage.set('');
          this.usageSvc.refresh();
        });
      },
      error: () => {
        this.pendingDelete.set(null);
        this.deleteLoading.set(false);
        this.errorMessage.set(`Не удалось удалить «${item.name}».`);
      },
    });
  }

  emptyTrash(): void {
    this.pendingDelete.set({ type: 'empty' });
  }

  private doEmptyTrash(): void {
    this.deleteLoading.set(true);
    this.filesService.emptyTrash().pipe(
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: () => {
        this.pendingDelete.set(null);
        this.deleteLoading.set(false);
        this.blobs.set([]);
        this.folders.set([]);
        this.actionMessage.set('Корзина очищена.');
        this.errorMessage.set('');
        this.usageSvc.refresh();
      },
      error: () => {
        this.pendingDelete.set(null);
        this.deleteLoading.set(false);
        this.errorMessage.set('Не удалось очистить корзину.');
      },
    });
  }

  confirmDelete(): void {
    const p = this.pendingDelete();
    if (!p) return;
    if (p.type === 'blob')   this.doHardDeleteBlob(p.item);
    if (p.type === 'folder') this.doHardDeleteFolder(p.item);
    if (p.type === 'empty')  this.doEmptyTrash();
  }

  cancelDelete(): void {
    this.pendingDelete.set(null);
  }

  confirmModalTitle(): string {
    const p = this.pendingDelete();
    if (!p) return '';
    if (p.type === 'empty') return 'Очистить корзину?';
    const name = p.type === 'blob' ? p.item.file_name : p.item.name;
    return `Удалить «${name}»?`;
  }

  confirmModalBody(): string {
    const p = this.pendingDelete();
    if (!p) return '';
    if (p.type === 'empty') return 'Все файлы и папки будут удалены безвозвратно. Это действие нельзя отменить.';
    return 'Файл будет удалён безвозвратно. Это действие нельзя отменить.';
  }

  confirmModalLabel(): string {
    const p = this.pendingDelete();
    if (p?.type === 'empty') return 'Очистить корзину';
    return 'Удалить';
  }

  private animateOut(id: string, after: () => void): void {
    this.fadingOut.update(s => new Set([...s, id]));
    setTimeout(() => {
      after();
      this.fadingOut.update(s => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
    }, 240);
  }
}
