import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';
import { CryptoService } from './crypto.service';

interface PresignGetResponse {
  download_url:       string;
  content_type:       string;
  encrypted_file_key: string;
  file_size:          number;
  chunk_size:         number;
}

// In-memory store for pending SW downloads. Keyed by random UUID.
// The SW retrieves entries via MessageChannel and we delete them after handoff.
declare global { interface Window { __swDownloads?: Map<string, SwDownloadMeta> } }

interface SwDownloadMeta {
  downloadUrl:  string;
  rawKey:       ArrayBuffer;
  chunkSize:    number;
  fileSize:     number;
  contentType:  string;
  ownerUserId:  string;
}

@Injectable({ providedIn: 'root' })
export class DownloadService {
  private readonly http   = inject(HttpClient);
  private readonly auth   = inject(AuthService);
  private readonly crypto = inject(CryptoService);

  private readonly baseUrl = `${environment.apiBaseUrl}/storage`;
  private swRegistered     = false;

  async init(): Promise<void> {
    if (!('serviceWorker' in navigator)) return;
    try {
      await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      this.swRegistered = true;
      navigator.serviceWorker.addEventListener('message', event => {
        if (event.data?.type === 'GET_SW_DOWNLOAD') {
          const meta = window.__swDownloads?.get(event.data.id) ?? null;
          event.ports[0]?.postMessage(meta);
          if (meta) window.__swDownloads?.delete(event.data.id);
        }
      });
    } catch {
      // SW unavailable (e.g. non-HTTPS dev env) — fall back to legacy download.
    }
  }

  // Streaming download for chunked files via Service Worker.
  // Falls back to legacy ArrayBuffer download if SW is not available or file is legacy.
  async download(blobId: string, fileName: string): Promise<void> {
    const kek = this.auth.getFileKey();
    if (!kek) throw new Error('KEK not available. Please log in again.');

    const resp = await firstValueFrom(
      this.http.post<PresignGetResponse>(
        `${this.baseUrl}/blobs/${encodeURIComponent(blobId)}/presign-get`, {},
      )
    );

    // Chunked + SW available → stream directly to disk, no full buffer in memory.
    if (this.swRegistered) {
      const fileKey    = await this.crypto.unwrapFileKeyRaw(resp.encrypted_file_key, kek);
      const downloadId = crypto.randomUUID();

      window.__swDownloads = window.__swDownloads ?? new Map();
      window.__swDownloads.set(downloadId, {
        downloadUrl:  resp.download_url,
        rawKey:       fileKey,
        chunkSize:    resp.chunk_size,
        fileSize:     resp.file_size,
        contentType:  resp.content_type,
        ownerUserId:  this.auth.userId() ?? '',
      });

      const a        = document.createElement('a');
      a.href         = `/sw-download/${downloadId}/${encodeURIComponent(fileName)}`;
      a.download     = fileName;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return;
    }

    // SW unavailable — decrypt in memory (chunked).
    const encryptedData = await (await fetch(resp.download_url)).arrayBuffer();
    const fileKey       = await this.crypto.unwrapFileKey(resp.encrypted_file_key, kek);
    const aad           = this.ownerAad();
    const plaintext     = await this.crypto.decryptFileChunked(encryptedData, fileKey, resp.chunk_size, aad);

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
