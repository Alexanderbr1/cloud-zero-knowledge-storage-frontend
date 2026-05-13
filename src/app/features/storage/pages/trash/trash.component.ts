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
import { FilesService } from '../../services/files.service';
import { TrashFileItem, TrashFolderItem } from '../../models/trash.model';

@Component({
  selector: 'app-trash',
  standalone: true,
  imports: [DatePipe],
  templateUrl: './trash.component.html',
  styleUrl: './trash.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TrashComponent implements OnInit {
  private readonly filesService = inject(FilesService);
  private readonly destroyRef = inject(DestroyRef);

  readonly blobs = signal<TrashFileItem[]>([]);
  readonly folders = signal<TrashFolderItem[]>([]);
  readonly isLoading = signal(false);
  readonly actionMessage = signal('');
  readonly errorMessage = signal('');

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
    this.filesService.hardDeleteBlob(item.blob_id).pipe(
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: () => this.animateOut(item.blob_id, () => {
        this.blobs.update(list => list.filter(b => b.blob_id !== item.blob_id));
        this.actionMessage.set(`«${item.file_name}» удалён безвозвратно.`);
        this.errorMessage.set('');
      }),
      error: () => this.errorMessage.set(`Не удалось удалить «${item.file_name}».`),
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
    this.filesService.hardDeleteFolder(item.folder_id).pipe(
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: () => this.animateOut(item.folder_id, () => {
        this.folders.update(list => list.filter(f => f.folder_id !== item.folder_id));
        this.actionMessage.set(`«${item.name}» удалена безвозвратно.`);
        this.errorMessage.set('');
      }),
      error: () => this.errorMessage.set(`Не удалось удалить «${item.name}».`),
    });
  }

  emptyTrash(): void {
    if (!confirm('Очистить всю корзину? Это действие необратимо.')) return;
    this.filesService.emptyTrash().pipe(
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: () => {
        this.blobs.set([]);
        this.folders.set([]);
        this.actionMessage.set('Корзина очищена.');
        this.errorMessage.set('');
      },
      error: () => this.errorMessage.set('Не удалось очистить корзину.'),
    });
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
