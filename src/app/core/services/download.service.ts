import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, firstValueFrom, from } from 'rxjs';

import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';
import { CryptoService } from './crypto.service';

interface PresignGetResponse {
  download_url:       string;
  content_type:       string;
  encrypted_file_key: string;
  file_size:          number;
  file_size_plain:    number;
  chunk_size:         number;
}

interface SwSingleFileMeta {
  downloadUrl:  string;
  rawKey:       ArrayBuffer;
  chunkSize:    number;
  fileSize:     number;
  contentType:  string;
  ownerUserId:  string;
}

declare global { interface Window { __swDownloads?: Map<string, SwSingleFileMeta> } }

@Injectable({ providedIn: 'root' })
export class DownloadService {
  private readonly http   = inject(HttpClient);
  private readonly auth   = inject(AuthService);
  private readonly crypto = inject(CryptoService);

  private readonly baseUrl    = `${environment.apiBaseUrl}/storage`;
  private swRegistered        = false;
  private readonly progressHandlers = new Map<string, (pct: number) => void>();

  async init(): Promise<void> {
    if (!('serviceWorker' in navigator)) return;
    try {
      await navigator.serviceWorker.register('/sw.js', { scope: '/' });

      if (!navigator.serviceWorker.controller) {
        await new Promise<void>(resolve => {
          navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true });
        });
      }

      this.swRegistered = true;
      navigator.serviceWorker.addEventListener('message', event => {
        if (event.data?.type === 'GET_SW_DOWNLOAD') {
          const meta = window.__swDownloads?.get(event.data.id) ?? null;
          event.ports[0]?.postMessage(meta);
          if (meta) window.__swDownloads?.delete(event.data.id);
        }
        if (event.data?.type === 'SW_DOWNLOAD_PROGRESS') {
          this.progressHandlers.get(event.data.id)?.(event.data.pct as number);
        }
      });
    } catch {
    }
  }

  downloadFile(blobId: string, fileName: string): Observable<void> {
    return from(this.download(blobId, fileName));
  }

  async download(
    blobId: string,
    fileName: string,
    onProgress?: (pct: number) => void,
  ): Promise<void> {
    const kek = this.auth.getFileKey();
    if (!kek) throw new Error('KEK not available. Please log in again.');

    const resp = await firstValueFrom(
      this.http.post<PresignGetResponse>(
        `${this.baseUrl}/blobs/${encodeURIComponent(blobId)}/presign-get`, {},
      ),
    );

    if (this.swRegistered) {
      const fileKey    = await this.crypto.unwrapFileKeyRaw(resp.encrypted_file_key, kek);
      const downloadId = crypto.randomUUID();
      const swUrl      = `/sw-download/${downloadId}/${encodeURIComponent(fileName)}`;

      window.__swDownloads ??= new Map();
      window.__swDownloads.set(downloadId, {
        downloadUrl:  resp.download_url,
        rawKey:       fileKey,
        chunkSize:    resp.chunk_size,
        fileSize:     resp.file_size,
        contentType:  resp.content_type,
        ownerUserId:  this.auth.userId() ?? '',
      });

      setTimeout(() => window.__swDownloads?.delete(downloadId), 60_000);

      const done = new Promise<void>(resolve => {
        this.progressHandlers.set(downloadId, pct => {
          onProgress?.(pct);
          if (pct >= 100) {
            this.progressHandlers.delete(downloadId);
            resolve();
          }
        });
        // Safety valve: resolve after 10 min if SW never signals completion.
        setTimeout(() => { this.progressHandlers.delete(downloadId); resolve(); }, 10 * 60 * 1000);
      });

      const a = document.createElement('a');
      a.href  = swUrl;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      await done;
      return;
    }

    const encryptedData = await (await fetch(resp.download_url)).arrayBuffer();
    const fileKey       = await this.crypto.unwrapFileKey(resp.encrypted_file_key, kek);
    const aad           = this.ownerAad();
    const plaintext     = await this.crypto.decryptFileChunked(encryptedData, fileKey, resp.chunk_size, aad);
    onProgress?.(100);

    const blob = new Blob([plaintext], { type: resp.content_type });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  private ownerAad(): Uint8Array {
    const id = this.auth.userId();
    if (!id) throw new Error('User ID unavailable.');
    return new TextEncoder().encode(id);
  }
}
