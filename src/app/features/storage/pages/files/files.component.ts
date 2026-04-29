import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, ElementRef, HostListener, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { finalize, switchMap } from 'rxjs';

import { AuthService } from '../../../../core/services/auth.service';
import { ShareItem, SharingService } from '../../../../core/services/sharing.service';
import { FileItem } from '../../models/file-item.model';
import { FilesService } from '../../services/files.service';

@Component({
  selector: 'app-files',
  standalone: true,
  imports: [DatePipe],
  templateUrl: './files.component.html',
  styleUrl: './files.component.scss',
})
export class FilesComponent implements OnInit {
  private readonly filesService = inject(FilesService);
  private readonly sharingService = inject(SharingService);
  private readonly auth = inject(AuthService);

  @ViewChild('shareEmailInput') private shareEmailInputRef?: ElementRef<HTMLInputElement>;
  @ViewChild('fileInput') private fileInputRef?: ElementRef<HTMLInputElement>;

  readonly files = signal<FileItem[]>([]);
  readonly isLoading = signal(false);
  readonly isSelectingFile = signal(false);
  readonly uploadPhase = signal<'idle' | 'reading' | 'encrypting' | 'uploading'>('idle');
  readonly uploadProgress = signal(0);
  readonly isUploading = computed(() => this.uploadPhase() !== 'idle');
  readonly selectedFile = signal<File | null>(null);
  readonly actionMessage = signal('');
  readonly errorMessage = signal('');

  // Access management dialog
  readonly accessFile = signal<FileItem | null>(null);
  readonly fileShares = signal<ShareItem[]>([]);
  readonly isLoadingShares = signal(false);
  readonly shareEmail = signal('');
  readonly isSharing = signal(false);
  readonly shareError = signal('');
  readonly revokingId = signal<string | null>(null);

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.accessFile()) this.closeAccessDialog();
  }

  onFilePickerCancel(): void {
    this.isSelectingFile.set(false);
  }

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
    this.isSelectingFile.set(false);
    const input = event.target as HTMLInputElement;
    const file = input.files?.item(0) ?? null;
    if (!file) return;
    this.selectedFile.set(file);
    this.actionMessage.set('');
    this.errorMessage.set('');
    this.upload();
  }

  openFilePicker(): void {
    this.isSelectingFile.set(true);
    this.fileInputRef?.nativeElement.click();
  }

  upload(): void {
    const file = this.selectedFile();
    if (!file) return;

    this.actionMessage.set('');
    this.errorMessage.set('');
    this.uploadPhase.set('reading');
    this.uploadProgress.set(0);

    this.filesService
      .uploadFile(file, (phase, pct) => {
        this.uploadPhase.set(phase);
        this.uploadProgress.set(pct);
      })
      .pipe(finalize(() => {
        this.uploadPhase.set('idle');
        this.uploadProgress.set(0);
        if (this.fileInputRef) this.fileInputRef.nativeElement.value = '';
      }))
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

  // ─── Access management ──────────────────────────────────────────────────

  openAccessDialog(file: FileItem): void {
    this.accessFile.set(file);
    this.fileShares.set([]);
    this.shareEmail.set('');
    this.shareError.set('');
    this.actionMessage.set('');
    this.errorMessage.set('');
    this.loadFileShares(file.blob_id);
    setTimeout(() => this.shareEmailInputRef?.nativeElement.focus());
  }

  closeAccessDialog(): void {
    this.accessFile.set(null);
    this.fileShares.set([]);
    this.shareEmail.set('');
    this.shareError.set('');
  }

  private loadFileShares(blobId: string): void {
    this.isLoadingShares.set(true);
    this.sharingService.listMyShares(blobId).pipe(
      finalize(() => this.isLoadingShares.set(false)),
    ).subscribe({
      next: resp => this.fileShares.set(resp.items ?? []),
      error: () => {},
    });
  }

  submitShare(): void {
    const file = this.accessFile();
    const email = this.shareEmail().trim().toLowerCase();
    if (!file || !email) return;

    this.isSharing.set(true);
    this.shareError.set('');

    this.sharingService.getRecipientPublicKey(email).pipe(
      switchMap(publicKey =>
        this.sharingService.shareFileWithUser(file.blob_id, file.encrypted_file_key, email, publicKey)
      ),
      finalize(() => this.isSharing.set(false)),
    ).subscribe({
      next: () => {
        this.shareEmail.set('');
        this.loadFileShares(file.blob_id);
      },
      error: (err: unknown) => {
        if (this.isMasterKeyMissing(err)) {
          this.auth.clearAccess();
          this.errorMessage.set('Сессия истекла — войдите снова.');
          this.closeAccessDialog();
          return;
        }
        if (err instanceof HttpErrorResponse) {
          if (err.status === 404) {
            this.shareError.set('Пользователь с таким email не найден.');
          } else if (err.status === 429) {
            this.shareError.set('Слишком много запросов. Подождите немного.');
          } else if (err.status === 409) {
            this.shareError.set('Вы уже открыли доступ этому пользователю.');
          } else if (err.status === 400) {
            this.shareError.set('Нельзя открыть доступ самому себе.');
          } else {
            this.shareError.set('Не удалось поделиться файлом.');
          }
        } else {
          this.shareError.set('Не удалось поделиться файлом.');
        }
      },
    });
  }

  revokeShare(shareId: string): void {
    this.revokingId.set(shareId);
    this.sharingService.revokeShare(shareId).pipe(
      finalize(() => this.revokingId.set(null)),
    ).subscribe({
      next: () => this.fileShares.update(list => list.filter(s => s.share_id !== shareId)),
      error: () => this.shareError.set('Не удалось отозвать доступ.'),
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
      'image/jpeg': 'JPEG', 'image/png': 'PNG', 'image/gif': 'GIF',
      'image/webp': 'WebP', 'image/svg+xml': 'SVG', 'application/pdf': 'PDF',
      'text/plain': 'TXT', 'text/csv': 'CSV', 'application/zip': 'ZIP',
      'application/json': 'JSON', 'video/mp4': 'MP4', 'audio/mpeg': 'MP3',
    };
    return map[mime] ?? mime.split('/')[1]?.toUpperCase() ?? mime;
  }

  private isMasterKeyMissing(err: unknown): boolean {
    return err instanceof Error && err.message.startsWith('Master key');
  }
}
