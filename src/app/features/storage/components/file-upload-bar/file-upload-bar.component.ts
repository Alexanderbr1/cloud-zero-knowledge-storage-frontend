import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

import { formatSize } from '../../../../core/utils/browser.utils';

@Component({
  selector: 'app-file-upload-bar',
  templateUrl: './file-upload-bar.component.html',
  styleUrl: './file-upload-bar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FileUploadBarComponent {
  readonly file     = input.required<File>();
  readonly phase    = input.required<'idle' | 'reading' | 'encrypting' | 'uploading'>();
  readonly progress = input.required<number>();
  readonly cancel   = output<void>();

  protected readonly formatSize = formatSize;
}
