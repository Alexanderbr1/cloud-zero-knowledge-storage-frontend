import { ChangeDetectionStrategy, Component, HostListener, computed, input, output } from '@angular/core';

import { FolderItem, BreadcrumbItem } from '../../../features/storage/models/folder.model';

@Component({
  selector: 'app-folder-picker',
  templateUrl: './folder-picker.component.html',
  styleUrl: './folder-picker.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FolderPickerComponent {
  readonly title           = input('Переместить');
  readonly folders         = input.required<FolderItem[]>();
  readonly breadcrumbs     = input.required<BreadcrumbItem[]>();
  readonly loading         = input<boolean>(false);
  readonly excludeFolderId = input<string | null>(null);

  readonly picked        = output<string | null>();
  readonly cancelled     = output<void>();
  readonly navigateInto  = output<FolderItem>();
  readonly navigateTo    = output<number>();

  readonly visibleFolders = computed(() =>
    this.folders().filter(f => f.folder_id !== this.excludeFolderId()),
  );

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.cancelled.emit();
  }

  openFolder(folder: FolderItem): void { this.navigateInto.emit(folder); }
  jumpTo(index: number): void          { this.navigateTo.emit(index); }

  confirm(): void {
    const crumbs = this.breadcrumbs();
    this.picked.emit(crumbs[crumbs.length - 1]?.folder_id ?? null);
  }

  cancel(): void { this.cancelled.emit(); }
}
