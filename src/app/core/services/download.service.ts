import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';
import { CryptoService } from './crypto.service';
import { FileItem } from '../../features/storage/models/file-item.model';

interface PresignGetResponse {
  download_url:       string;
  content_type:       string;
  encrypted_file_key: string;
  file_size:          number;
  file_size_plain:    number;
  chunk_size:         number;
}

// Single-file SW metadata
interface SwSingleFileMeta {
  downloadUrl:  string;
  rawKey:       ArrayBuffer;
  chunkSize:    number;
  fileSize:     number;
  contentType:  string;
  ownerUserId:  string;
}

// One file's metadata inside a folder download
interface SwFolderFile {
  name:        string;
  url:         string;
  rawKey:      ArrayBuffer;
  fileSize:    number; // encrypted size (for Range requests)
  chunkSize:   number;
  ownerUserId: string;
}

// Folder SW metadata — discriminated by the `files` field
interface SwFolderMeta {
  files: SwFolderFile[];
}

type SwDownloadMeta = SwSingleFileMeta | SwFolderMeta;

// In-memory store for pending SW downloads. Keyed by random UUID.
// The SW retrieves entries via MessageChannel and we delete them after handoff.
declare global { interface Window { __swDownloads?: Map<string, SwDownloadMeta> } }

@Injectable({ providedIn: 'root' })
export class DownloadService {
  private readonly http   = inject(HttpClient);
  private readonly auth   = inject(AuthService);
  private readonly crypto = inject(CryptoService);

  private readonly baseUrl = `${environment.apiBaseUrl}/storage`;
  private swRegistered     = false;

  get swAvailable(): boolean { return this.swRegistered; }

  async init(): Promise<void> {
    if (!('serviceWorker' in navigator)) return;
    try {
      await navigator.serviceWorker.register('/sw.js', { scope: '/' });

      // register() resolves when the SW is installed, but the SW may not yet
      // control this page (clients.claim() runs asynchronously in activate).
      // Wait for it to take control before marking as ready — otherwise the
      // first download click goes to the server instead of the SW.
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
      });
    } catch {
      // SW unavailable (e.g. non-HTTPS dev env) — fall back to legacy download.
    }
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
      )
    );

    if (this.swRegistered) {
      const fileKey    = await this.crypto.unwrapFileKeyRaw(resp.encrypted_file_key, kek);
      const downloadId = crypto.randomUUID();
      const swUrl      = `/sw-download/${downloadId}/${encodeURIComponent(fileName)}`;
      const plainSize  = resp.file_size_plain;

      window.__swDownloads = window.__swDownloads ?? new Map();
      window.__swDownloads.set(downloadId, {
        downloadUrl:  resp.download_url,
        rawKey:       fileKey,
        chunkSize:    resp.chunk_size,
        fileSize:     resp.file_size,
        contentType:  resp.content_type,
        ownerUserId:  this.auth.userId() ?? '',
      });

      try {
        if ('showSaveFilePicker' in window) {
          // Open the save dialog first (user gesture still active), then start
          // the SW fetch. The pull-based SW stream downloads one chunk at a time
          // as pipeTo consumes it — peak RAM ≈ one chunk (~8 MiB).
          const handle   = await (window as any).showSaveFilePicker({ suggestedName: fileName });
          const writable = await handle.createWritable();
          const swResp   = await fetch(swUrl);
          if (!swResp.ok || !swResp.body) throw new Error(`SW returned ${swResp.status}`);
          await this.pipeWithProgress(swResp.body, writable, plainSize, onProgress);
        } else {
          // Fallback for browsers without File System Access API (Firefox, Safari).
          const swResp = await fetch(swUrl);
          if (!swResp.ok || !swResp.body) throw new Error(`SW returned ${swResp.status}`);
          const blob = await swResp.blob();
          onProgress?.(100);
          const url  = URL.createObjectURL(blob);
          const a    = document.createElement('a');
          a.href     = url;
          a.download = fileName;
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 10_000);
        }
      } finally {
        // Clean up the map entry in case the dialog was cancelled or an error
        // occurred before the SW could pick up and delete the metadata itself.
        window.__swDownloads?.delete(downloadId);
      }
      return;
    }

    // SW unavailable — decrypt in memory (chunked).
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

  // Downloads all files in the folder as a streaming ZIP via Service Worker.
  // Files are processed one at a time — peak RAM ≈ one chunk (~8 MiB) regardless of folder size.
  async downloadFolder(
    files: FileItem[],
    folderName: string,
    onProgress?: (pct: number) => void,
  ): Promise<void> {
    const kek = this.auth.getFileKey();
    if (!kek) throw new Error('KEK not available. Please log in again.');

    // Get presigned URLs for all files in parallel, then unwrap keys.
    const presigned = await Promise.all(
      files.map(f =>
        firstValueFrom(
          this.http.post<PresignGetResponse>(
            `${this.baseUrl}/blobs/${encodeURIComponent(f.blob_id)}/presign-get`, {},
          ),
        ),
      ),
    );

    const ownerUserId = this.auth.userId() ?? '';

    // Pair each FileItem with its presign response and unwrapped raw key
    const fileEntries = await Promise.all(
      files.map(async (f, i) => {
        const p      = presigned[i]!;
        const rawKey = await this.crypto.unwrapFileKeyRaw(p.encrypted_file_key, kek);
        return { f, p, rawKey };
      }),
    );

    const downloadId = crypto.randomUUID();

    window.__swDownloads = window.__swDownloads ?? new Map();
    window.__swDownloads.set(downloadId, {
      files: fileEntries.map(({ f, p, rawKey }) => ({
        name:        f.file_name,
        url:         p.download_url,
        rawKey,
        fileSize:    p.file_size,
        chunkSize:   p.chunk_size,
        ownerUserId,
      })),
    });

    const zipName    = `${folderName}.zip`;
    const swUrl      = `/sw-download-folder/${downloadId}/${encodeURIComponent(zipName)}`;
    const totalPlain = presigned.reduce((s, r) => s + r.file_size_plain, 0);

    try {
      if ('showSaveFilePicker' in window) {
        const handle   = await (window as any).showSaveFilePicker({ suggestedName: zipName });
        const writable = await handle.createWritable();
        const swResp   = await fetch(swUrl);
        if (!swResp.ok || !swResp.body) throw new Error(`SW returned ${swResp.status}`);
        await this.pipeWithProgress(swResp.body, writable, totalPlain, onProgress);
      } else {
        const swResp = await fetch(swUrl);
        if (!swResp.ok || !swResp.body) throw new Error(`SW returned ${swResp.status}`);
        const blob = await swResp.blob();
        onProgress?.(100);
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = zipName;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      }
    } finally {
      window.__swDownloads?.delete(downloadId);
    }
  }

  private async pipeWithProgress(
    readable: ReadableStream<Uint8Array>,
    writable: WritableStream<Uint8Array>,
    totalBytes: number,
    onProgress?: (pct: number) => void,
  ): Promise<void> {
    const reader = readable.getReader();
    const writer = writable.getWriter();
    let received = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        await writer.write(value);
        received += value.byteLength;
        if (totalBytes > 0) {
          onProgress?.(Math.min(99, Math.round((received / totalBytes) * 100)));
        }
      }
      onProgress?.(100);
      await writer.close();
    } catch (err) {
      await writer.abort(err);
      throw err;
    } finally {
      reader.releaseLock();
      writer.releaseLock();
    }
  }

  private ownerAad(): Uint8Array {
    const id = this.auth.userId();
    if (!id) throw new Error('User ID unavailable.');
    return new TextEncoder().encode(id);
  }
}
