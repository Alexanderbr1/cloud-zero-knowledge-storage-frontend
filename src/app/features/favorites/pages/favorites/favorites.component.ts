import { DatePipe } from '@angular/common';
import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { ToastService } from '../../../../core/services/toast.service';
import { FilesService } from '../../../storage/services/files.service';
import { FileItem } from '../../../storage/models/file-item.model';
import { FolderItem } from '../../../storage/models/folder.model';
import { FavoritesService } from '../../services/favorites.service';
import { shortMimeType } from '../../../../core/utils/browser.utils';

@Component({
  selector: 'app-favorites',
  imports: [DatePipe],
  templateUrl: './favorites.component.html',
  styleUrl: './favorites.component.scss',
})
export class FavoritesComponent implements OnInit {
  private readonly favoritesService = inject(FavoritesService);
  private readonly filesService     = inject(FilesService);
  private readonly toast            = inject(ToastService);
  private readonly destroyRef       = inject(DestroyRef);

  readonly blobs    = signal<FileItem[]>([]);
  readonly folders  = signal<FolderItem[]>([]);
  readonly loading  = signal(true);
  readonly error    = signal<string | null>(null);

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.favoritesService.list().subscribe({
      next: ({ blobs, folders }) => {
        this.blobs.set(blobs);
        this.folders.set(folders);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Не удалось загрузить избранное');
        this.loading.set(false);
      },
    });
  }

  download(file: FileItem): void {
    this.filesService.downloadFile(file.blob_id, file.file_name).pipe(
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      error: () => this.toast.error('Не удалось скачать файл.'),
    });
  }

  unstarBlob(file: FileItem): void {
    this.favoritesService.removeBlob(file.blob_id).pipe(
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: () => {
        this.blobs.update(list => list.filter(b => b.blob_id !== file.blob_id));
        this.toast.success(`«${file.file_name}» убран из избранного.`);
      },
      error: () => this.toast.error('Не удалось убрать из избранного.'),
    });
  }

  unstarFolder(folder: FolderItem): void {
    this.favoritesService.removeFolder(folder.folder_id).pipe(
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: () => {
        this.folders.update(list => list.filter(f => f.folder_id !== folder.folder_id));
        this.toast.success(`«${folder.name}» убран из избранного.`);
      },
      error: () => this.toast.error('Не удалось убрать из избранного.'),
    });
  }

  shortType(mime: string): string { return shortMimeType(mime); }

  formatSize(bytes: number): string {
    if (bytes < 1024)        return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
}
