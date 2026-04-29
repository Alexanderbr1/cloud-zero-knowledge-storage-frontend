import { DatePipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { finalize, from, switchMap } from 'rxjs';

import { AuthService } from '../../../../core/services/auth.service';
import { CryptoService } from '../../../../core/services/crypto.service';
import { ShareItem, SharingService } from '../../../../core/services/sharing.service';

@Component({
  selector: 'app-shared-with-me',
  standalone: true,
  imports: [DatePipe],
  templateUrl: './shared-with-me.component.html',
  styleUrl: './shared-with-me.component.scss',
})
export class SharedWithMeComponent implements OnInit {
  private readonly sharingService = inject(SharingService);
  private readonly crypto = inject(CryptoService);
  private readonly auth = inject(AuthService);

  readonly shares = signal<ShareItem[]>([]);
  readonly isLoading = signal(false);
  readonly downloadingId = signal<string | null>(null);
  readonly actionMessage = signal('');
  readonly errorMessage = signal('');

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.isLoading.set(true);
    this.actionMessage.set('');
    this.errorMessage.set('');
    this.sharingService.listSharedWithMe().pipe(
      finalize(() => this.isLoading.set(false)),
    ).subscribe({
      next: resp => this.shares.set(resp.items ?? []),
      error: () => this.errorMessage.set('Не удалось загрузить список файлов.'),
    });
  }

  download(item: ShareItem): void {
    if (this.downloadingId() === item.share_id) return;
    this.errorMessage.set('');
    this.downloadingId.set(item.share_id);

    this.sharingService.getSharedFile(item.share_id).pipe(
      switchMap(result => from(this.fetchAndSave(result, item.content_type))),
      finalize(() => this.downloadingId.set(null)),
    ).subscribe({
      next: () => this.actionMessage.set(`Файл «${item.file_name}» скачан.`),
      error: (err: unknown) => {
        if (err instanceof Error && err.message.startsWith('EC private key')) {
          this.auth.clearAccess();
          this.errorMessage.set('Сессия истекла — войдите снова.');
          return;
        }
        this.errorMessage.set(`Не удалось скачать «${item.file_name}».`);
      },
    });
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

  private async fetchAndSave(
    result: { downloadUrl: string; fileKey: CryptoKey; fileIVb64: string; fileName: string },
    contentType: string,
  ): Promise<void> {
    const resp = await fetch(result.downloadUrl);
    if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);
    const encrypted = await resp.arrayBuffer();
    const plaintext = await this.crypto.decryptFile(encrypted, result.fileKey, result.fileIVb64);
    this.triggerBrowserDownload(plaintext, result.fileName, contentType);
  }

  private triggerBrowserDownload(data: ArrayBuffer, fileName: string, contentType: string): void {
    const blob = new Blob([data], { type: contentType || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
