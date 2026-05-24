import { ChangeDetectionStrategy, Component, HostListener, computed, input, output } from '@angular/core';

import { BreadcrumbItem, FolderItem } from '../../../features/storage/models/folder.model';

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
  readonly loading         = input(false);
  readonly excludeFolderId = input<string | null>(null);

  readonly picked       = output<string | null>();
  readonly cancelled    = output<void>();
  readonly navigateInto = output<FolderItem>();
  readonly navigateTo   = output<number>();

  readonly visibleFolders = computed(() =>
    this.folders().filter(f => f.folder_id !== this.excludeFolderId()),
  );

  @HostListener('document:keydown.escape')
  onEscape(): void { this.cancelled.emit(); }

  openFolder(folder: FolderItem): void { this.navigateInto.emit(folder); }
  jumpTo(index: number): void          { this.navigateTo.emit(index); }
  cancel(): void                       { this.cancelled.emit(); }

  confirm(): void {
    this.picked.emit(this.breadcrumbs().at(-1)?.folder_id ?? null);
  }
}
