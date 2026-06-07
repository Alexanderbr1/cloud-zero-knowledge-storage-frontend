import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, firstValueFrom, map, throwError } from 'rxjs';

import { environment } from '../../../../environments/environment';
import { AuthService } from '../../../core/services/auth.service';
import { CryptoService, CHUNK_SIZE, FRAME_OVERHEAD } from '../../../core/services/crypto.service';
import { FileItem } from '../models/file-item.model';
import { FolderItem } from '../models/folder.model';
import { TrashListResponse } from '../models/trash.model';

// ─── Public types ─────────────────────────────────────────────────────────────

export type UploadEvent =
  | { phase: 'reading' | 'encrypting' | 'uploading'; pct: number }
  | { phase: 'done'; blobId: string };

// ─── API shapes ───────────────────────────────────────────────────────────────

interface InitiateMultipartRequest {
  file_name:          string;
  content_type:       string;
  encrypted_file_key: string;
  file_size:          number;
  file_size_plain:    number;
  chunk_size:         number;
  part_count:         number;
  folder_id?:         string;
}

interface InitiateMultipartResponse {
  blob_id:   string;
  upload_id: string;
  part_urls: Array<{ part_number: number; url: string }>;
}

interface ListBlobsResponse   { items: FileItem[]   }
interface ListFoldersResponse { items: FolderItem[] }
interface SearchResponse      { blobs: FileItem[]; folders: FolderItem[] }

// ─── Constants ────────────────────────────────────────────────────────────────

const UPLOAD_CONCURRENCY = 3;
const UPLOAD_RETRIES     = 3;

// ─── Service ──────────────────────────────────────────────────────────────────

type ProgressEmitter = (e: Exclude<UploadEvent, { phase: 'done' }>) => void;

@Injectable({ providedIn: 'root' })
export class FilesService {
  private readonly http   = inject(HttpClient);
  private readonly crypto = inject(CryptoService);
  private readonly auth   = inject(AuthService);

  private readonly baseUrl  = `${environment.apiBaseUrl}/storage`;
  private readonly trashUrl = `${environment.apiBaseUrl}/trash`;

  // ─── Blobs ────────────────────────────────────────────────────────────────

  listFilesInFolder(folderId: string | null): Observable<FileItem[]> {
    return this.http
      .get<ListBlobsResponse>(`${this.baseUrl}/blobs`, { params: { folder_id: folderId ?? 'root' } })
      .pipe(map(r => r.items));
  }

  uploadFile(file: File, folderId?: string | null): Observable<UploadEvent> {
    const kek = this.auth.getFileKey();
    if (!kek) return throwError(() => new Error('KEK not available. Please log in again.'));

    return new Observable<UploadEvent>(subscriber => {
      const abort = new AbortController();

      this.multipartUpload(file, kek, folderId ?? null, abort.signal, e => subscriber.next(e))
        .then(blobId => { subscriber.next({ phase: 'done', blobId }); subscriber.complete(); })
        .catch(err   => { if (!isAbortError(err)) subscriber.error(err); });

      return () => abort.abort();
    });
  }

  moveBlob(blobId: string, folderId: string | null): Observable<void> {
    return this.http.patch<void>(this.blobUrl(blobId, 'folder'), { folder_id: folderId });
  }

  renameFile(blobId: string, name: string): Observable<void> {
    return this.http.patch<void>(this.blobUrl(blobId), { name });
  }

  deleteFile(blobId: string): Observable<void> {
    return this.http.delete<void>(this.blobUrl(blobId));
  }

  // ─── Folders ──────────────────────────────────────────────────────────────

  listFolders(parentId: string | null): Observable<FolderItem[]> {
    const params = parentId ? { parent_id: parentId } : {};
    return this.http
      .get<ListFoldersResponse>(`${this.baseUrl}/folders`, { params })
      .pipe(map(r => r.items));
  }

  createFolder(name: string, parentId: string | null): Observable<FolderItem> {
    return this.http.post<FolderItem>(`${this.baseUrl}/folders`, { name, parent_id: parentId });
  }

  renameFolder(folderId: string, name: string): Observable<FolderItem> {
    return this.http.patch<FolderItem>(this.folderUrl(folderId), { name });
  }

  moveFolder(folderId: string, newParentId: string | null): Observable<void> {
    return this.http.patch<void>(this.folderUrl(folderId, 'move'), { parent_id: newParentId });
  }

  deleteFolder(folderId: string): Observable<void> {
    return this.http.delete<void>(this.folderUrl(folderId));
  }

  search(query: string): Observable<SearchResponse> {
    return this.http.get<SearchResponse>(`${this.baseUrl}/search`, { params: { q: query } });
  }

  // ─── Trash ────────────────────────────────────────────────────────────────

  listTrash(): Observable<TrashListResponse> {
    return this.http.get<TrashListResponse>(this.trashUrl);
  }

  restoreBlob(blobId: string): Observable<void> {
    return this.http.post<void>(`${this.trashUrl}/blobs/${enc(blobId)}/restore`, {});
  }

  hardDeleteBlob(blobId: string): Observable<void> {
    return this.http.delete<void>(`${this.trashUrl}/blobs/${enc(blobId)}`);
  }

  restoreFolder(folderId: string): Observable<void> {
    return this.http.post<void>(`${this.trashUrl}/folders/${enc(folderId)}/restore`, {});
  }

  hardDeleteFolder(folderId: string): Observable<void> {
    return this.http.delete<void>(`${this.trashUrl}/folders/${enc(folderId)}`);
  }

  emptyTrash(): Observable<void> {
    return this.http.delete<void>(this.trashUrl);
  }

  // ─── Upload internals ─────────────────────────────────────────────────────

  private async multipartUpload(
    file:     File,
    kek:      CryptoKey,
    folderId: string | null,
    signal:   AbortSignal,
    emit:     ProgressEmitter,
  ): Promise<string> {
    const contentType  = file.type?.trim() || 'application/octet-stream';
    const chunkCount   = Math.ceil(file.size / CHUNK_SIZE) || 1;
    const totalEncSize = file.size + chunkCount * FRAME_OVERHEAD;

    const fileKey    = await this.crypto.generateFileKey();
    const wrappedKey = await this.crypto.wrapFileKey(fileKey, kek);
    const aad        = this.ownerAad();

    const { blob_id, part_urls } = await firstValueFrom(
      this.http.post<InitiateMultipartResponse>(`${this.baseUrl}/blobs/initiate-multipart`, {
        file_name:          file.name,
        content_type:       contentType,
        encrypted_file_key: wrappedKey,
        file_size:          totalEncSize,
        file_size_plain:    file.size,
        chunk_size:         CHUNK_SIZE,
        part_count:         chunkCount,
        ...(folderId ? { folder_id: folderId } : {}),
      } satisfies InitiateMultipartRequest),
    );

    emit({ phase: 'reading', pct: 0 });

    try {
      for (let i = 0; i < chunkCount; i += UPLOAD_CONCURRENCY) {
        if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');

        const batch = range(i, Math.min(i + UPLOAD_CONCURRENCY, chunkCount));

        emit({ phase: 'encrypting', pct: pct(i, chunkCount) });
        const frames = await Promise.all(batch.map(idx =>
          file.slice(idx * CHUNK_SIZE, (idx + 1) * CHUNK_SIZE)
              .arrayBuffer()
              .then(plain => this.crypto.encryptChunk(plain, fileKey, aad)),
        ));

        emit({ phase: 'uploading', pct: pct(i, chunkCount) });
        await Promise.all(batch.map((idx, j) => {
          const url   = part_urls[idx]?.url;
          const frame = frames[j];
          if (!url || !frame) throw new Error(`Missing URL or frame for part ${idx + 1}`);
          return this.uploadPartWithRetry(url, frame, idx + 1, signal);
        }));

        emit({ phase: 'uploading', pct: pct(i + batch.length, chunkCount) });
      }
    } catch (err) {
      if (!isAbortError(err)) {
        this.http.delete(this.blobUrl(blob_id, 'abort')).subscribe({ error: () => {} });
      }
      throw err;
    }

    await firstValueFrom(
      this.http.post<void>(`${this.baseUrl}/blobs/${enc(blob_id)}/complete-multipart`, {}),
    );

    return blob_id;
  }

  private async uploadPartWithRetry(
    url:        string,
    body:       ArrayBuffer,
    partNumber: number,
    signal:     AbortSignal,
    retries = UPLOAD_RETRIES,
  ): Promise<void> {
    for (let attempt = 0; attempt < retries; attempt++) {
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      const resp = await fetch(url, { method: 'PUT', body: body.slice(0), signal });
      if (resp.ok) return;
      if (attempt < retries - 1)
        await new Promise(r => setTimeout(r, 500 * 2 ** attempt));
    }
    throw new Error(`Part ${partNumber} upload failed after ${retries} attempts`);
  }

  // ─── URL builders ─────────────────────────────────────────────────────────

  private blobUrl(blobId: string, suffix?: string): string {
    const base = `${this.baseUrl}/blobs/${enc(blobId)}`;
    return suffix ? `${base}/${suffix}` : base;
  }

  private folderUrl(folderId: string, suffix?: string): string {
    const base = `${this.baseUrl}/folders/${enc(folderId)}`;
    return suffix ? `${base}/${suffix}` : base;
  }

  private ownerAad(userId?: string): Uint8Array {
    const id = userId ?? this.auth.userId();
    if (!id) throw new Error('User ID unavailable — cannot derive AAD for file encryption.');
    return new TextEncoder().encode(id);
  }
}

// ─── Module-level helpers ─────────────────────────────────────────────────────

function enc(id: string): string {
  return encodeURIComponent(id);
}

function pct(done: number, total: number): number {
  return Math.round((done / total) * 100);
}

function range(start: number, end: number): number[] {
  return Array.from({ length: end - start }, (_, i) => start + i);
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}
