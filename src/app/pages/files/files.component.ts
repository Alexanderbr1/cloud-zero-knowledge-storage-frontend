import { DatePipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { finalize } from 'rxjs';

import { AuthService } from '../../core/services/auth.service';
import { FileItem } from '../../core/models/file-item.model';
import { FilesService } from '../../core/services/files.service';

@Component({
  selector: 'app-files',
  standalone: true,
  imports: [DatePipe],
  templateUrl: './files.component.html',
  styleUrl: './files.component.scss',
})
export class FilesComponent implements OnInit {
  private readonly filesService = inject(FilesService);
  private readonly auth = inject(AuthService);

  readonly files = signal<FileItem[]>([]);
  readonly isLoading = signal(false);
  readonly isUploading = signal(false);
  readonly selectedFile = signal<File | null>(null);
  readonly actionMessage = signal('');
  readonly errorMessage = signal('');

  ngOnInit(): void {
    this.loadFiles();
  }

  loadFiles(): void {
    this.isLoading.set(true);
    this.actionMessage.set('');
    this.errorMessage.set('');
    this.filesService
      .listFiles()
      .pipe(finalize(() => this.isLoading.set(false)))
      .subscribe({
        next: files => this.files.set(files),
        error: () => this.errorMessage.set('Не удалось загрузить список файлов.'),
      });
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.selectedFile.set(input.files?.item(0) ?? null);
    this.actionMessage.set('');
    this.errorMessage.set('');
  }

  upload(): void {
    const file = this.selectedFile();
    if (!file) return;

    this.actionMessage.set('');
    this.errorMessage.set('');
    this.isUploading.set(true);

    this.filesService
      .uploadFile(file)
      .pipe(finalize(() => this.isUploading.set(false)))
      .subscribe({
        next: () => {
          this.actionMessage.set(`Файл «${file.name}» загружен.`);
          this.selectedFile.set(null);
          this.loadFiles();
        },
        error: (err: unknown) => {
          if (this.isMasterKeyMissing(err)) {
            this.auth.clearAccess();
            this.errorMessage.set('Сессия истекла — войдите снова.');
            return;
          }
          this.errorMessage.set('Не удалось загрузить файл.');
        },
      });
  }

  download(file: FileItem): void {
    this.errorMessage.set('');
    this.filesService.downloadFile(file.blob_id, file.file_name).subscribe({
      next: () => this.actionMessage.set(`Файл «${file.file_name}» скачан.`),
      error: (err: unknown) => {
        if (this.isMasterKeyMissing(err)) {
          this.auth.clearAccess();
          this.errorMessage.set('Сессия истекла — войдите снова.');
          return;
        }
        this.errorMessage.set(`Не удалось скачать «${file.file_name}».`);
      },
    });
  }

  delete(file: FileItem): void {
    this.errorMessage.set('');
    this.filesService.deleteFile(file.blob_id).subscribe({
      next: () => {
        this.actionMessage.set(`Файл «${file.file_name}» удалён.`);
        this.loadFiles();
      },
      error: () => this.errorMessage.set(`Не удалось удалить «${file.file_name}».`),
    });
  }

  formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  shortType(mime: string): string {
    if (!mime) return '—';
    const map: Record<string, string> = {
      'image/jpeg': 'JPEG',
      'image/png': 'PNG',
      'image/gif': 'GIF',
      'image/webp': 'WebP',
      'image/svg+xml': 'SVG',
      'application/pdf': 'PDF',
      'text/plain': 'TXT',
      'text/csv': 'CSV',
      'application/zip': 'ZIP',
      'application/json': 'JSON',
      'video/mp4': 'MP4',
      'audio/mpeg': 'MP3',
    };
    return map[mime] ?? mime.split('/')[1]?.toUpperCase() ?? mime;
  }

  private isMasterKeyMissing(err: unknown): boolean {
    return err instanceof Error && err.message.startsWith('Master key');
  }
}
