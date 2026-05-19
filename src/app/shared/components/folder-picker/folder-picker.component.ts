import { Component, DestroyRef, EventEmitter, HostListener, Input, OnInit, Output, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { FolderItem, BreadcrumbItem } from '../../../features/storage/models/folder.model';
import { FilesService } from '../../../features/storage/services/files.service';

@Component({
  selector: 'app-folder-picker',
  templateUrl: './folder-picker.component.html',
  styleUrl: './folder-picker.component.scss',
})
export class FolderPickerComponent implements OnInit {
  @Input() title = 'Переместить';
  @Input() excludeFolderId: string | null = null;
  @Output() picked    = new EventEmitter<string | null>();
  @Output() cancelled = new EventEmitter<void>();

  private readonly filesService = inject(FilesService);
  private readonly destroyRef   = inject(DestroyRef);

  readonly loading         = signal(false);
  readonly currentFolderId = signal<string | null>(null);
  readonly breadcrumbs     = signal<BreadcrumbItem[]>([{ folder_id: null, name: 'Мой диск' }]);
  readonly allFolders      = signal<FolderItem[]>([]);

  readonly folders = computed(() =>
    this.allFolders().filter(f => f.folder_id !== this.excludeFolderId),
  );

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.cancelled.emit();
  }

  ngOnInit(): void {
    this.loadFolders();
  }

  private loadFolders(): void {
    this.loading.set(true);
    this.filesService.listFolders(this.currentFolderId()).pipe(
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: folders => { this.allFolders.set(folders); this.loading.set(false); },
      error: ()      => { this.loading.set(false); },
    });
  }

  navigateInto(folder: FolderItem): void {
    this.currentFolderId.set(folder.folder_id);
    this.breadcrumbs.update(b => [...b, { folder_id: folder.folder_id, name: folder.name }]);
    this.loadFolders();
  }

  navigateTo(index: number): void {
    const crumbs = this.breadcrumbs();
    this.currentFolderId.set(crumbs[index].folder_id);
    this.breadcrumbs.set(crumbs.slice(0, index + 1));
    this.loadFolders();
  }

  confirm(): void { this.picked.emit(this.currentFolderId()); }
  cancel(): void  { this.cancelled.emit(); }
}
