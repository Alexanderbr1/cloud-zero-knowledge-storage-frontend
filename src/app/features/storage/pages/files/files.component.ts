import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  Component, DestroyRef, ElementRef, HostListener, OnInit,
  ViewChild, computed, inject, signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, catchError, finalize, forkJoin, of, switchMap } from 'rxjs';

import { AuthService } from '../../../../core/services/auth.service';
import { ShareItem, SharingService } from '../../../../core/services/sharing.service';
import { FileItem } from '../../models/file-item.model';
import { BreadcrumbItem, FolderItem } from '../../models/folder.model';
import { FilesService } from '../../services/files.service';
import { shortMimeType } from '../../../../core/utils/browser.utils';

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
  private readonly destroyRef = inject(DestroyRef);

  @ViewChild('fileInput')       private fileInputRef?: ElementRef<HTMLInputElement>;
  @ViewChild('shareEmailInput') private shareEmailInputRef?: ElementRef<HTMLInputElement>;
  @ViewChild('newFolderInput')  private newFolderInputRef?: ElementRef<HTMLInputElement>;

  // ─── File state ───────────────────────────────────────────────────────────

  readonly files            = signal<FileItem[]>([]);
  readonly isLoading        = signal(false);
  readonly isSelectingFile  = signal(false);
  readonly uploadPhase      = signal<'idle' | 'reading' | 'encrypting' | 'uploading'>('idle');
  readonly uploadProgress   = signal(0);
  readonly isUploading      = computed(() => this.uploadPhase() !== 'idle');
  readonly selectedFile     = signal<File | null>(null);
  readonly actionMessage    = signal('');
  readonly errorMessage     = signal('');

  // ─── Folder navigation ────────────────────────────────────────────────────

  readonly currentFolderId = signal<string | null>(null);
  readonly folders         = signal<FolderItem[]>([]);
  readonly breadcrumbs     = signal<BreadcrumbItem[]>([{ folder_id: null, name: 'Мои файлы' }]);

  // ─── Derived state (used in @if conditions to avoid Angular 17 tmp-variable
  // scoping bug: calling the same signal in @if condition + @for iterable
  // generates a tmp_N_0 variable that escapes its block scope) ────────────────

  readonly hasFolders     = computed(() => this.folders().length > 0);
  readonly hasFiles       = computed(() => this.files().length > 0);
  readonly hasBreadcrumbs = computed(() => this.breadcrumbs().length > 1);
  readonly hasShares      = computed(() => this.fileShares().length > 0);

  // ─── Create folder ────────────────────────────────────────────────────────

  readonly isCreatingFolder    = signal(false);
  readonly newFolderName       = signal('');
  readonly creatingFolderError = signal('');

  // ─── Rename folder ────────────────────────────────────────────────────────

  readonly renamingFolderId = signal<string | null>(null);
  readonly renameFolderName = signal('');

  // ─── Drag-and-drop ────────────────────────────────────────────────────────

  readonly draggingId       = signal<string | null>(null);
  readonly dragOverFolderId = signal<string | null>(null);

  // ─── Sharing dialog ───────────────────────────────────────────────────────

  readonly accessFile       = signal<FileItem | null>(null);
  readonly fileShares       = signal<ShareItem[]>([]);
  readonly isLoadingShares  = signal(false);
  readonly shareEmail       = signal('');
  readonly isSharing        = signal(false);
  readonly shareError       = signal('');
  readonly revokingId       = signal<string | null>(null);

  // ─── Load stream ──────────────────────────────────────────────────────────

  private readonly loadSubject = new Subject<void>();

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  ngOnInit(): void {
    // switchMap cancels any in-flight requests when a new loadContent() fires,
    // preventing stale responses from overwriting fresher data.
    this.loadSubject.pipe(
      switchMap(() => {
        const folderId = this.currentFolderId();
        console.debug('[load] GET start — folderId:', folderId);
        return forkJoin({
          folders: this.filesService.listFolders(folderId).pipe(
            catchError(() => {
              this.errorMessage.set('Не удалось загрузить папки.');
              return of([] as FolderItem[]);
            }),
          ),
          files: this.filesService.listFilesInFolder(folderId).pipe(
            catchError(() => {
              this.errorMessage.set('Не удалось загрузить файлы.');
              return of([] as FileItem[]);
            }),
          ),
        });
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(({ folders, files }) => {
      console.debug('[load] GET done — folderId:', this.currentFolderId(), '| files:', files.length, '| folders:', folders.length);
      this.folders.set(folders);
      this.files.set(files);
      this.isLoading.set(false);
    });

    this.loadContent();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.accessFile())         { this.closeAccessDialog(); return; }
    if (this.renamingFolderId())   { this.cancelRenameFolder(); return; }
    if (this.isCreatingFolder())   { this.cancelCreateFolder(); }
  }

  // ─── Content loading ──────────────────────────────────────────────────────

  loadContent(): void {
    this.isLoading.set(true);
    this.actionMessage.set('');
    this.errorMessage.set('');
    this.loadSubject.next();
  }

  // ─── Folder navigation ────────────────────────────────────────────────────

  navigateIntoFolder(folder: FolderItem): void {
    if (this.renamingFolderId() === folder.folder_id) return;
    console.debug('[navigate] into folder:', folder.folder_id, folder.name);
    this.currentFolderId.set(folder.folder_id);
    this.breadcrumbs.update(crumbs => [...crumbs, { folder_id: folder.folder_id, name: folder.name }]);
    this.isCreatingFolder.set(false);
    this.loadContent();
  }

  navigateToBreadcrumb(index: number): void {
    const crumbs = this.breadcrumbs();
    const crumb  = crumbs[index];
    this.currentFolderId.set(crumb.folder_id);
    this.breadcrumbs.set(crumbs.slice(0, index + 1));
    this.isCreatingFolder.set(false);
    this.loadContent();
  }

  // ─── Create folder ────────────────────────────────────────────────────────

  openCreateFolder(): void {
    this.cancelRenameFolder();
    this.isCreatingFolder.set(true);
    this.newFolderName.set('');
    this.creatingFolderError.set('');
    setTimeout(() => this.newFolderInputRef?.nativeElement.focus());
  }

  cancelCreateFolder(): void {
    this.isCreatingFolder.set(false);
    this.newFolderName.set('');
    this.creatingFolderError.set('');
  }

  confirmCreateFolder(): void {
    const name = this.newFolderName().trim();
    if (!name) { this.cancelCreateFolder(); return; }

    this.filesService.createFolder(name, this.currentFolderId()).pipe(
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: folder => {
        this.folders.update(list => [...list, folder].sort((a, b) => a.name.localeCompare(b.name)));
        this.cancelCreateFolder();
      },
      error: (err: HttpErrorResponse) => {
        this.creatingFolderError.set(
          err.status === 409 ? 'Папка с таким именем уже существует.' : 'Не удалось создать папку.',
        );
      },
    });
  }

  // ─── Rename folder ────────────────────────────────────────────────────────

  startRenameFolder(folder: FolderItem, event: Event): void {
    event.stopPropagation();
    this.cancelCreateFolder();
    this.renamingFolderId.set(folder.folder_id);
    this.renameFolderName.set(folder.name);
    setTimeout(() => {
      const input = document.querySelector<HTMLInputElement>('.folder-rename-input');
      if (input) { input.focus(); input.select(); }
    });
  }

  cancelRenameFolder(): void {
    this.renamingFolderId.set(null);
    this.renameFolderName.set('');
  }

  confirmRenameFolder(folder: FolderItem): void {
    // Guard against the double-call from (keydown.enter) followed by (blur):
    // clearing renamingFolderId before the API call ensures the blur event that
    // fires after Enter finds nothing to do.
    if (this.renamingFolderId() !== folder.folder_id) return;
    const name = this.renameFolderName().trim();
    if (!name || name === folder.name) { this.cancelRenameFolder(); return; }

    this.cancelRenameFolder();

    this.filesService.renameFolder(folder.folder_id, name).pipe(
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: updated => {
        this.folders.update(list =>
          list.map(f => f.folder_id === updated.folder_id ? updated : f)
              .sort((a, b) => a.name.localeCompare(b.name)),
        );
      },
      error: (err: HttpErrorResponse) => {
        this.errorMessage.set(
          err.status === 409 ? 'Папка с таким именем уже существует.' : 'Не удалось переименовать папку.',
        );
      },
    });
  }

  // ─── Delete folder ────────────────────────────────────────────────────────

  deleteFolder(folder: FolderItem, event: Event): void {
    event.stopPropagation();
    this.filesService.deleteFolder(folder.folder_id).pipe(
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: () => {
        this.folders.update(list => list.filter(f => f.folder_id !== folder.folder_id));
        this.actionMessage.set(`Папка «${folder.name}» удалена.`);
      },
      error: (err: HttpErrorResponse) => {
        this.errorMessage.set(
          err.status === 409
            ? `Папка «${folder.name}» не пуста. Удалите содержимое.`
            : `Не удалось удалить папку «${folder.name}».`,
        );
      },
    });
  }

  // ─── Drag-and-drop ────────────────────────────────────────────────────────

  onBlobDragStart(event: DragEvent, blobId: string): void {
    this.draggingId.set(blobId);
    event.dataTransfer!.setData('blob-id', blobId);
    event.dataTransfer!.effectAllowed = 'move';
  }

  onFolderDragStart(event: DragEvent, folderId: string): void {
    event.stopPropagation();
    this.draggingId.set(folderId);
    event.dataTransfer!.setData('folder-id', folderId);
    event.dataTransfer!.effectAllowed = 'move';
  }

  onDragEnd(): void {
    this.draggingId.set(null);
    this.dragOverFolderId.set(null);
  }

  onFolderDragOver(event: DragEvent, folderId: string): void {
    if (this.draggingId() === folderId) return;
    event.preventDefault();
    event.dataTransfer!.dropEffect = 'move';
    this.dragOverFolderId.set(folderId);
  }

  onFolderDragLeave(event: DragEvent, folderId: string): void {
    const related = event.relatedTarget as Node | null;
    const card    = event.currentTarget as HTMLElement;
    if (!related || !card.contains(related)) {
      if (this.dragOverFolderId() === folderId) {
        this.dragOverFolderId.set(null);
      }
    }
  }

  onFolderDrop(event: DragEvent, targetFolderId: string): void {
    event.preventDefault();
    this.draggingId.set(null);
    this.dragOverFolderId.set(null);

    const blobId      = event.dataTransfer?.getData('blob-id')   ?? '';
    const srcFolderId = event.dataTransfer?.getData('folder-id') ?? '';

    if (blobId) {
      this.moveBlobToFolder(blobId, targetFolderId);
    } else if (srcFolderId && srcFolderId !== targetFolderId) {
      this.moveFolderIntoFolder(srcFolderId, targetFolderId);
    }
  }

  private moveBlobToFolder(blobId: string, targetFolderId: string): void {
    const sourceFolderId = this.currentFolderId();
    const file = this.files().find(f => f.blob_id === blobId);
    console.debug('[moveBlob] start — blobId:', blobId, '| targetFolderId:', targetFolderId, '| sourceFolderId:', sourceFolderId, '| file found:', !!file);
    if (!file) return;

    this.files.update(list => list.filter(f => f.blob_id !== blobId));
    console.debug('[moveBlob] optimistic remove done, sending PATCH...');

    this.filesService.moveBlob(blobId, targetFolderId).pipe(
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: () => {
        console.debug('[moveBlob] PATCH success — currentFolderId:', this.currentFolderId(), '| targetFolderId:', targetFolderId);
        if (this.currentFolderId() === targetFolderId) {
          console.debug('[moveBlob] user is in target folder, reloading content...');
          this.loadContent();
        }
      },
      error: (err: unknown) => {
        console.error('[moveBlob] PATCH error:', err, '| currentFolderId:', this.currentFolderId(), '| sourceFolderId:', sourceFolderId);
        if (this.currentFolderId() === sourceFolderId) {
          this.files.update(list => [...list, file]);
        }
        this.errorMessage.set(`Не удалось переместить «${file.file_name}».`);
      },
    });
  }

  private moveFolderIntoFolder(srcFolderId: string, targetFolderId: string): void {
    const sourceFolderId = this.currentFolderId();
    const folder = this.folders().find(f => f.folder_id === srcFolderId);
    if (!folder) return;

    this.folders.update(list => list.filter(f => f.folder_id !== srcFolderId));

    this.filesService.moveFolder(srcFolderId, targetFolderId).pipe(
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: () => {
        if (this.currentFolderId() === targetFolderId) {
          this.loadContent();
        }
      },
      error: () => {
        if (this.currentFolderId() === sourceFolderId) {
          this.folders.update(list => [...list, folder]);
        }
        this.errorMessage.set(`Не удалось переместить папку «${folder.name}».`);
      },
    });
  }

  // ─── File upload ──────────────────────────────────────────────────────────

  onFilePickerCancel(): void {
    this.isSelectingFile.set(false);
  }

  onFileSelected(event: Event): void {
    this.isSelectingFile.set(false);
    const input = event.target as HTMLInputElement;
    const file  = input.files?.item(0) ?? null;
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
      .uploadFile(
        file,
        (phase, pct) => { this.uploadPhase.set(phase); this.uploadProgress.set(pct); },
        this.currentFolderId(),
      )
      .pipe(
        finalize(() => {
          this.uploadPhase.set('idle');
          this.uploadProgress.set(0);
          if (this.fileInputRef) this.fileInputRef.nativeElement.value = '';
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => {
          this.actionMessage.set(`Файл «${file.name}» загружен.`);
          this.selectedFile.set(null);
          this.loadContent();
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

  // ─── File download / delete ───────────────────────────────────────────────

  download(file: FileItem): void {
    this.errorMessage.set('');
    this.filesService.downloadFile(file.blob_id, file.file_name).pipe(
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
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
    this.filesService.deleteFile(file.blob_id).pipe(
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: () => {
        this.actionMessage.set(`Файл «${file.file_name}» удалён.`);
        this.loadContent();
      },
      error: () => this.errorMessage.set(`Не удалось удалить «${file.file_name}».`),
    });
  }

  // ─── Sharing dialog ───────────────────────────────────────────────────────

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
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: resp => this.fileShares.set(resp.items ?? []),
      error: () => {},
    });
  }

  submitShare(): void {
    const file  = this.accessFile();
    const email = this.shareEmail().trim().toLowerCase();
    if (!file || !email) return;

    this.isSharing.set(true);
    this.shareError.set('');

    this.sharingService.getRecipientPublicKey(email).pipe(
      switchMap(publicKey =>
        this.sharingService.shareFileWithUser(file.blob_id, file.encrypted_file_key, email, publicKey),
      ),
      finalize(() => this.isSharing.set(false)),
      takeUntilDestroyed(this.destroyRef),
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
          if (err.status === 404)      this.shareError.set('Пользователь с таким email не найден.');
          else if (err.status === 429) this.shareError.set('Слишком много запросов. Подождите.');
          else if (err.status === 409) this.shareError.set('Вы уже открыли доступ этому пользователю.');
          else if (err.status === 400) this.shareError.set('Нельзя открыть доступ самому себе.');
          else                         this.shareError.set('Не удалось поделиться файлом.');
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
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: () => this.fileShares.update(list => list.filter(s => s.share_id !== shareId)),
      error: () => this.shareError.set('Не удалось отозвать доступ.'),
    });
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  formatSize(bytes: number): string {
    if (bytes < 1024)             return `${bytes} B`;
    if (bytes < 1024 * 1024)      return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  shortType(mime: string): string {
    return shortMimeType(mime);
  }

  private isMasterKeyMissing(err: unknown): boolean {
    return err instanceof Error && err.message.startsWith('Master key');
  }
}
