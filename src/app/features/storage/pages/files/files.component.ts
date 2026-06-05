import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, HostListener, NgZone, OnInit,
  computed, inject, signal, viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { Subject, Subscription, catchError, debounceTime, distinctUntilChanged, finalize, forkJoin, from, of, switchMap } from 'rxjs';

import { AuthService } from '../../../../core/services/auth.service';
import { DownloadService } from '../../../../core/services/download.service';
import { StorageUsageService } from '../../../../core/services/storage-usage.service';
import { ToastService } from '../../../../core/services/toast.service';
import { FileItem } from '../../models/file-item.model';
import { BreadcrumbItem, FolderItem } from '../../models/folder.model';
import { FilesService } from '../../services/files.service';
import { FavoritesService } from '../../../favorites/services/favorites.service';
import { formatSize, shortMimeType } from '../../../../core/utils/browser.utils';
import { InputModalComponent } from '../../../../shared/components/input-modal/input-modal.component';
import { FolderPickerComponent } from '../../../../shared/components/folder-picker/folder-picker.component';
import { FileShareDialogComponent } from '../../components/file-share-dialog/file-share-dialog.component';
import { FileUploadBarComponent } from '../../components/file-upload-bar/file-upload-bar.component';

interface SearchResults {
  blobs: FileItem[];
  folders: FolderItem[];
}

@Component({
  selector: 'app-files',
  imports: [DatePipe, InputModalComponent, FolderPickerComponent, FileShareDialogComponent, FileUploadBarComponent],
  templateUrl: './files.component.html',
  styleUrl: './files.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FilesComponent implements OnInit {
  private readonly filesService     = inject(FilesService);
  private readonly favoritesService = inject(FavoritesService);
  private readonly auth             = inject(AuthService);
  private readonly downloadService  = inject(DownloadService);
  private readonly usageSvc         = inject(StorageUsageService);
  private readonly destroyRef       = inject(DestroyRef);
  private readonly toast            = inject(ToastService);
  private readonly ngZone           = inject(NgZone);
  private readonly route            = inject(ActivatedRoute);

  private readonly fileInputRef = viewChild<ElementRef<HTMLInputElement>>('fileInput');

  // ─── File state ───────────────────────────────────────────────────────────

  readonly files            = signal<FileItem[]>([]);
  readonly isLoading        = signal(false);
  readonly isSelectingFile  = signal(false);
  readonly uploadPhase      = signal<'idle' | 'reading' | 'encrypting' | 'uploading'>('idle');
  readonly uploadProgress   = signal(0);
  readonly isUploading      = computed(() => this.uploadPhase() !== 'idle');
  readonly selectedFile     = signal<File | null>(null);
  private uploadSub: Subscription | null = null;

  // ─── Folder navigation ────────────────────────────────────────────────────

  readonly currentFolderId = signal<string | null>(null);
  readonly folders         = signal<FolderItem[]>([]);
  readonly breadcrumbs     = signal<BreadcrumbItem[]>([{ folder_id: null, name: 'Мои файлы' }]);

  // ─── Search & sort ────────────────────────────────────────────────────────

  readonly searchQuery   = signal('');
  readonly searchResults = signal<SearchResults | null>(null);
  readonly isSearching   = signal(false);
  readonly sortField     = signal<'name' | 'date' | 'size' | 'type'>('date');
  readonly sortDir       = signal<'asc' | 'desc'>('desc');

  private readonly searchSubject = new Subject<string>();

  setSort(field: 'name' | 'date' | 'size' | 'type'): void {
    if (this.sortField() === field) {
      this.sortDir.update(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      this.sortField.set(field);
      this.sortDir.set(field === 'date' ? 'desc' : 'asc');
    }
  }

  onSearchInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.searchQuery.set(value);
    const trimmed = value.trim();
    if (trimmed.length >= 2) {
      this.searchSubject.next(trimmed);
    } else {
      this.searchResults.set(null);
    }
  }

  clearSearch(): void {
    this.searchQuery.set('');
    this.searchResults.set(null);
  }

  readonly filteredFolders = computed(() => {
    const results = this.searchResults();
    if (results !== null) return results.folders;
    const q     = this.searchQuery().trim().toLowerCase();
    const field = this.sortField();
    const dir   = this.sortDir() === 'asc' ? 1 : -1;
    const list  = q ? this.folders().filter(f => f.name.toLowerCase().includes(q)) : [...this.folders()];
    return list.sort((a, b) => {
      if (field === 'date') return dir * (new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      return dir * a.name.localeCompare(b.name);
    });
  });

  readonly filteredFiles = computed(() => {
    const results = this.searchResults();
    if (results !== null) return results.blobs;
    const q     = this.searchQuery().trim().toLowerCase();
    const field = this.sortField();
    const dir   = this.sortDir() === 'asc' ? 1 : -1;
    const list  = q ? this.files().filter(f => f.file_name.toLowerCase().includes(q)) : [...this.files()];
    return list.sort((a, b) => {
      switch (field) {
        case 'name': return dir * a.file_name.localeCompare(b.file_name);
        case 'date': return dir * (new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        case 'size': return dir * (a.file_size_plain - b.file_size_plain);
        case 'type': return dir * a.content_type.localeCompare(b.content_type);
      }
    });
  });

  // ─── Derived state (used in @if conditions to avoid Angular 17 tmp-variable
  // scoping bug: calling the same signal in @if condition + @for iterable
  // generates a tmp_N_0 variable that escapes its block scope) ────────────────

  readonly hasFolders     = computed(() => this.folders().length > 0);
  readonly hasFiles       = computed(() => this.files().length > 0);
  readonly hasBreadcrumbs = computed(() => this.breadcrumbs().length > 1);
  readonly hasResults     = computed(() => this.filteredFolders().length > 0 || this.filteredFiles().length > 0);

  // ─── Create folder ────────────────────────────────────────────────────────

  readonly isCreatingFolder    = signal(false);
  readonly newFolderName       = signal('');
  readonly creatingFolderError = signal('');

  // ─── Move dialog + folder picker ─────────────────────────────────────────

  readonly moveTarget          = signal<{ type: 'file' | 'folder'; id: string; name: string } | null>(null);
  readonly pickerFolders       = signal<FolderItem[]>([]);
  readonly pickerBreadcrumbs   = signal<BreadcrumbItem[]>([{ folder_id: null, name: 'Мой диск' }]);
  readonly pickerLoading       = signal(false);

  // ─── Rename modal ─────────────────────────────────────────────────────────

  readonly renameTarget     = signal<{ type: 'file' | 'folder'; id: string; name: string } | null>(null);
  readonly renameInputValue = signal('');
  readonly renameError      = signal('');
  readonly isRenaming       = signal(false);

  // ─── Drag-and-drop ────────────────────────────────────────────────────────

  readonly draggingId       = signal<string | null>(null);
  readonly dragOverFolderId = signal<string | null>(null);

  // ─── Favorites ────────────────────────────────────────────────────────────

  readonly favoriteBlobIds   = signal<Set<string>>(new Set());
  readonly favoriteFolderIds = signal<Set<string>>(new Set());

  // ─── Overflow menu ────────────────────────────────────────────────────────

  readonly openMenuId = signal<string | null>(null);

  // ─── Download ─────────────────────────────────────────────────────────────

  readonly downloadingBlobId = signal<string | null>(null);
  readonly downloadProgress    = signal(0);

  // ─── Sharing dialog ───────────────────────────────────────────────────────

  readonly accessFile = signal<FileItem | null>(null);

  // ─── Load stream ──────────────────────────────────────────────────────────

  private readonly loadSubject = new Subject<void>();

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  ngOnInit(): void {
    this.searchSubject.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      switchMap(query => {
        this.isSearching.set(true);
        return this.filesService.search(query).pipe(
          finalize(() => this.isSearching.set(false)),
          catchError(() => {
            this.toast.error('Поиск не удался.');
            return of(null);
          }),
        );
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(results => {
      this.searchResults.set(results);
    });

    // switchMap cancels any in-flight requests when a new loadContent() fires,
    // preventing stale responses from overwriting fresher data.
    this.loadSubject.pipe(
      switchMap(() => {
        const folderId = this.currentFolderId();
        return forkJoin({
          folders: this.filesService.listFolders(folderId).pipe(
            catchError(() => {
              this.toast.error('Не удалось загрузить папки.');
              return of([] as FolderItem[]);
            }),
          ),
          files: this.filesService.listFilesInFolder(folderId).pipe(
            catchError(() => {
              this.toast.error('Не удалось загрузить файлы.');
              return of([] as FileItem[]);
            }),
          ),
        });
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(({ folders, files }) => {
      this.folders.set(folders);
      this.files.set(files);
      this.isLoading.set(false);
    });

    const qp = this.route.snapshot.queryParamMap;
    const folderId   = qp.get('folder');
    const folderName = qp.get('folderName');
    if (folderId) {
      this.currentFolderId.set(folderId);
      this.breadcrumbs.set([
        { folder_id: null, name: 'Мои файлы' },
        { folder_id: folderId, name: folderName ?? folderId },
      ]);
    }

    this.loadContent();
    this.loadFavorites();
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    this.openMenuId.set(null);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.openMenuId())        { this.closeMenu(); return; }
    if (this.moveTarget())        { this.moveTarget.set(null); return; }
    if (this.accessFile())        { this.closeAccessDialog(); return; }
    if (this.renameTarget())      { this.closeRenameModal(); return; }
    if (this.isCreatingFolder())  { this.cancelCreateFolder(); }
  }

  // ─── Content loading ──────────────────────────────────────────────────────

  loadContent(): void {
    this.isLoading.set(true);
    this.loadSubject.next();
  }

  // ─── Folder navigation ────────────────────────────────────────────────────

  navigateIntoFolder(folder: FolderItem): void {
    this.clearSearch();
    this.currentFolderId.set(folder.folder_id);
    this.breadcrumbs.update(crumbs => [...crumbs, { folder_id: folder.folder_id, name: folder.name }]);
    this.isCreatingFolder.set(false);
    this.loadContent();
  }

  navigateToBreadcrumb(index: number): void {
    const crumbs = this.breadcrumbs();
    const crumb  = crumbs[index];
    if (!crumb) return;
    this.clearSearch();
    this.currentFolderId.set(crumb.folder_id);
    this.breadcrumbs.set(crumbs.slice(0, index + 1));
    this.isCreatingFolder.set(false);
    this.loadContent();
  }

  // ─── Create folder ────────────────────────────────────────────────────────

  openCreateFolder(): void {
    this.isCreatingFolder.set(true);
    this.newFolderName.set('');
    this.creatingFolderError.set('');
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

  // ─── Rename modal ─────────────────────────────────────────────────────────

  openRenameModal(target: { type: 'file' | 'folder'; id: string; name: string }, event: Event): void {
    event.stopPropagation();
    this.renameTarget.set(target);
    this.renameInputValue.set(target.name);
    this.renameError.set('');
    this.isRenaming.set(false);
  }

  closeRenameModal(): void {
    this.renameTarget.set(null);
    this.renameInputValue.set('');
    this.renameError.set('');
    this.isRenaming.set(false);
  }

  confirmRename(): void {
    const target = this.renameTarget();
    if (!target) return;
    const name = this.renameInputValue().trim();
    if (!name || name === target.name) { this.closeRenameModal(); return; }

    this.isRenaming.set(true);
    this.renameError.set('');

    if (target.type === 'folder') {
      this.filesService.renameFolder(target.id, name).pipe(
        finalize(() => this.isRenaming.set(false)),
        takeUntilDestroyed(this.destroyRef),
      ).subscribe({
        next: updated => {
          this.folders.update(list =>
            list.map(f => f.folder_id === target.id ? updated : f)
                .sort((a, b) => a.name.localeCompare(b.name)),
          );
          this.closeRenameModal();
        },
        error: (err: HttpErrorResponse) => {
          this.renameError.set(
            err.status === 409 ? 'Папка с таким именем уже существует.' : 'Не удалось переименовать папку.',
          );
        },
      });
    } else {
      this.filesService.renameFile(target.id, name).pipe(
        finalize(() => this.isRenaming.set(false)),
        takeUntilDestroyed(this.destroyRef),
      ).subscribe({
        next: () => {
          this.files.update(list =>
            list.map(f => f.blob_id === target.id ? { ...f, file_name: name } : f),
          );
          this.closeRenameModal();
        },
        error: (err: HttpErrorResponse) => {
          this.renameError.set(
            err.status === 404 ? 'Файл не найден.' : 'Не удалось переименовать файл.',
          );
        },
      });
    }
  }

  // ─── Delete folder ────────────────────────────────────────────────────────

  deleteFolder(folder: FolderItem, event: Event): void {
    event.stopPropagation();
    this.filesService.deleteFolder(folder.folder_id).pipe(
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: () => {
        this.folders.update(list => list.filter(f => f.folder_id !== folder.folder_id));
        this.toast.success(`Папка «${folder.name}» удалена.`);
      },
      error: (err: HttpErrorResponse) => {
        this.toast.error(
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

    const destName = this.folders().find(f => f.folder_id === targetFolderId)?.name ?? 'Мой диск';
    if (blobId) {
      this.moveBlobToFolder(blobId, targetFolderId, destName);
    } else if (srcFolderId && srcFolderId !== targetFolderId) {
      this.moveFolderIntoFolder(srcFolderId, targetFolderId, destName);
    }
  }

  openMoveDialog(item: { type: 'file' | 'folder'; id: string; name: string }, event: Event): void {
    event.stopPropagation();
    this.closeMenu();
    this.moveTarget.set(item);
    this.pickerBreadcrumbs.set([{ folder_id: null, name: 'Мой диск' }]);
    this.loadPickerFolders(null);
  }

  onPickerNavigateInto(folder: FolderItem): void {
    this.pickerBreadcrumbs.update(b => [...b, { folder_id: folder.folder_id, name: folder.name }]);
    this.loadPickerFolders(folder.folder_id);
  }

  onPickerNavigateTo(index: number): void {
    const crumbs = this.pickerBreadcrumbs();
    const crumb = crumbs[index];
    if (!crumb) return;
    this.pickerBreadcrumbs.set(crumbs.slice(0, index + 1));
    this.loadPickerFolders(crumb.folder_id);
  }

  private loadPickerFolders(folderId: string | null): void {
    this.pickerLoading.set(true);
    this.filesService.listFolders(folderId).pipe(
      finalize(() => this.pickerLoading.set(false)),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: folders => this.pickerFolders.set(folders),
      error: () => this.toast.error('Не удалось загрузить папки.'),
    });
  }

  onMovePicked(folderId: string | null): void {
    const target = this.moveTarget();
    if (!target) return;
    const destName = this.pickerBreadcrumbs().at(-1)?.name ?? 'Мой диск';
    this.moveTarget.set(null);
    if (target.type === 'file') {
      this.moveBlobToFolder(target.id, folderId, destName);
    } else {
      this.moveFolderIntoFolder(target.id, folderId, destName);
    }
  }

  private moveBlobToFolder(blobId: string, targetFolderId: string | null, destName: string): void {
    const sourceFolderId = this.currentFolderId();
    const file = this.files().find(f => f.blob_id === blobId);
    if (!file) return;

    this.files.update(list => list.filter(f => f.blob_id !== blobId));

    this.filesService.moveBlob(blobId, targetFolderId).pipe(
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: () => {
        this.toast.success(`«${file.file_name}» перемещён в «${destName}».`);
        if (this.currentFolderId() === targetFolderId) {
          this.loadContent();
        }
      },
      error: () => {
        if (this.currentFolderId() === sourceFolderId) {
          this.files.update(list => [...list, file]);
        }
        this.toast.error(`Не удалось переместить «${file.file_name}».`);
      },
    });
  }

  private moveFolderIntoFolder(srcFolderId: string, targetFolderId: string | null, destName: string): void {
    const sourceFolderId = this.currentFolderId();
    const folder = this.folders().find(f => f.folder_id === srcFolderId);
    if (!folder) return;

    this.folders.update(list => list.filter(f => f.folder_id !== srcFolderId));

    this.filesService.moveFolder(srcFolderId, targetFolderId).pipe(
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: () => {
        this.toast.success(`«${folder.name}» перемещена в «${destName}».`);
        if (this.currentFolderId() === targetFolderId) {
          this.loadContent();
        }
      },
      error: () => {
        if (this.currentFolderId() === sourceFolderId) {
          this.folders.update(list => [...list, folder]);
        }
        this.toast.error(`Не удалось переместить папку «${folder.name}».`);
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
    input.value = '';
    if (!file) return;
    if (file.size > 1024 * 1024 * 1024) {
      this.toast.error('Файл слишком большой. Максимальный размер — 1 ГБ.');
      return;
    }
    this.selectedFile.set(file);
    this.upload();
  }

  openFilePicker(): void {
    this.isSelectingFile.set(true);
    const el = this.fileInputRef()?.nativeElement;
    this.ngZone.runOutsideAngular(() => el?.click());
  }

  upload(): void {
    const file = this.selectedFile();
    if (!file) return;

    this.uploadPhase.set('reading');
    this.uploadProgress.set(0);

    this.uploadSub = this.filesService
      .uploadFile(
        file,
        (phase, pct) => { this.uploadPhase.set(phase); this.uploadProgress.set(pct); },
        this.currentFolderId(),
      )
      .pipe(
        finalize(() => {
          this.uploadSub = null;
          this.uploadPhase.set('idle');
          this.uploadProgress.set(0);
          const fileRef = this.fileInputRef(); if (fileRef) fileRef.nativeElement.value = '';
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => {
          this.toast.success(`Файл «${file.name}» загружен.`);
          this.selectedFile.set(null);
          this.loadContent();
          this.usageSvc.refresh();
        },
        error: (err: unknown) => {
          this.selectedFile.set(null);
          if (this.isKekMissing(err)) {
            this.auth.clearAccess();
            this.toast.error('Сессия истекла — войдите снова.');
            return;
          }
          this.toast.error('Не удалось загрузить файл.');
        },
      });
  }

  cancelUpload(): void {
    this.uploadSub?.unsubscribe();
    this.selectedFile.set(null);
  }

  // ─── File download / delete ───────────────────────────────────────────────

  download(file: FileItem): void {
    if (this.downloadingBlobId()) return;
    this.downloadingBlobId.set(file.blob_id);
    this.downloadProgress.set(0);

    from(this.downloadService.download(file.blob_id, file.file_name, pct => {
      this.ngZone.run(() => this.downloadProgress.set(pct));
    })).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => {
        this.downloadingBlobId.set(null);
        this.downloadProgress.set(0);
      }),
    ).subscribe({
      next: () => this.toast.success(`Файл «${file.file_name}» скачан.`),
      error: (err: unknown) => {
        if (this.isKekMissing(err)) {
          this.auth.clearAccess();
          this.toast.error('Сессия истекла — войдите снова.');
          return;
        }
        this.toast.error(`Не удалось скачать «${file.file_name}».`);
      },
    });
  }

  delete(file: FileItem): void {
    this.filesService.deleteFile(file.blob_id).pipe(
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: () => {
        this.files.update(list => list.filter(f => f.blob_id !== file.blob_id));
        this.toast.success(`Файл «${file.file_name}» удалён.`);
      },
      error: () => this.toast.error(`Не удалось удалить «${file.file_name}».`),
    });
  }

  // ─── Sharing dialog ───────────────────────────────────────────────────────

  openAccessDialog(file: FileItem): void {
    this.accessFile.set(file);
  }

  closeAccessDialog(): void {
    this.accessFile.set(null);
  }

  // ─── Favorites ────────────────────────────────────────────────────────────

  private loadFavorites(): void {
    this.favoritesService.list().pipe(
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: ({ blobs, folders }) => {
        this.favoriteBlobIds.set(new Set(blobs.map(b => b.blob_id)));
        this.favoriteFolderIds.set(new Set(folders.map(f => f.folder_id)));
      },
      error: () => this.toast.error('Не удалось загрузить избранное.'),
    });
  }

  toggleBlobFavorite(file: FileItem, event: Event): void {
    event.stopPropagation();
    const wasStarred = this.favoriteBlobIds().has(file.blob_id);
    this.favoriteBlobIds.update(s => {
      const next = new Set(s);
      wasStarred ? next.delete(file.blob_id) : next.add(file.blob_id);
      return next;
    });
    const req = wasStarred
      ? this.favoritesService.removeBlob(file.blob_id)
      : this.favoritesService.addBlob(file.blob_id);
    req.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => this.toast.success(wasStarred ? `«${file.file_name}» убран из избранного.` : `«${file.file_name}» добавлен в избранное.`),
      error: () => {
        this.favoriteBlobIds.update(s => {
          const prev = new Set(s);
          wasStarred ? prev.add(file.blob_id) : prev.delete(file.blob_id);
          return prev;
        });
        this.toast.error(wasStarred ? 'Не удалось убрать из избранного.' : 'Не удалось добавить в избранное.');
      },
    });
  }

  toggleFolderFavorite(folder: FolderItem, event: Event): void {
    event.stopPropagation();
    const wasStarred = this.favoriteFolderIds().has(folder.folder_id);
    this.favoriteFolderIds.update(s => {
      const next = new Set(s);
      wasStarred ? next.delete(folder.folder_id) : next.add(folder.folder_id);
      return next;
    });
    const req = wasStarred
      ? this.favoritesService.removeFolder(folder.folder_id)
      : this.favoritesService.addFolder(folder.folder_id);
    req.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => this.toast.success(wasStarred ? `«${folder.name}» убрана из избранного.` : `«${folder.name}» добавлена в избранное.`),
      error: () => {
        this.favoriteFolderIds.update(s => {
          const prev = new Set(s);
          wasStarred ? prev.add(folder.folder_id) : prev.delete(folder.folder_id);
          return prev;
        });
        this.toast.error(wasStarred ? 'Не удалось убрать из избранного.' : 'Не удалось добавить в избранное.');
      },
    });
  }

  // ─── Overflow menu ────────────────────────────────────────────────────────

  toggleMenu(id: string, event: Event): void {
    event.stopPropagation();
    this.openMenuId.update(cur => (cur === id ? null : id));
  }

  closeMenu(): void {
    this.openMenuId.set(null);
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  protected readonly formatSize = formatSize;
  protected readonly shortType  = shortMimeType;

  private isKekMissing(err: unknown): boolean {
    return err instanceof Error && err.message.startsWith('KEK');
  }
}
