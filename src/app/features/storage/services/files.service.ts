import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import {
  Observable,
  firstValueFrom,
  from,
  map,
  switchMap,
  throwError,
} from 'rxjs';

import { environment } from '../../../../environments/environment';
import { FileItem } from '../models/file-item.model';
import { FolderItem } from '../models/folder.model';
import { TrashListResponse } from '../models/trash.model';
import {
  CryptoService,
  CHUNK_SIZE,
  FRAME_OVERHEAD,
} from '../../../core/services/crypto.service';
import { AuthService } from '../../../core/services/auth.service';
import { triggerBrowserDownload } from '../../../core/utils/browser.utils';

interface InitiateMultipartRequest {
  file_name: string;
  content_type: string;
  encrypted_file_key: string;
  file_size: number;
  file_size_plain: number;
  chunk_size: number;
  part_count: number;
  folder_id?: string;
}

interface PartURLItem {
  part_number: number;
  url: string;
}

interface InitiateMultipartResponse {
  blob_id: string;
  upload_id: string;
  part_urls: PartURLItem[];
}

interface PresignGetResponse {
  blob_id: string;
  download_url: string;
  expires_in: number;
  http_method: string;
  content_type: string;
  encrypted_file_key: string;
  file_size: number;
  file_size_plain: number;
  chunk_size: number;
}

interface ListBlobsResponse {
  items: FileItem[];
}

interface ListFoldersResponse {
  items: FolderItem[];
}

interface SearchResponse {
  blobs: FileItem[];
  folders: FolderItem[];
}

@Injectable({ providedIn: 'root' })
export class FilesService {
  private readonly http = inject(HttpClient);
  private readonly crypto = inject(CryptoService);
  private readonly auth = inject(AuthService);
  private readonly baseUrl = `${environment.apiBaseUrl}/storage`;

  // ─── Blobs ────────────────────────────────────────────────────────────────

  listFilesInFolder(folderId: string | null): Observable<FileItem[]> {
    const param = folderId === null ? 'root' : folderId;
    return this.http
      .get<ListBlobsResponse>(`${this.baseUrl}/blobs`, {
        params: { folder_id: param },
      })
      .pipe(map((r) => r.items));
  }

  moveBlob(blobId: string, folderId: string | null): Observable<void> {
    return this.http.patch<void>(
      `${this.baseUrl}/blobs/${encodeURIComponent(blobId)}/folder`,
      { folder_id: folderId },
    );
  }

  renameFile(blobId: string, name: string): Observable<void> {
    return this.http.patch<void>(
      `${this.baseUrl}/blobs/${encodeURIComponent(blobId)}`,
      { name },
    );
  }

  uploadFile(
    file: File,
    onProgress?: (
      phase: 'reading' | 'encrypting' | 'uploading',
      pct: number,
    ) => void,
    folderId?: string | null,
  ): Observable<{ blob_id: string }> {
    const kek = this.auth.getFileKey();
    if (!kek)
      return throwError(
        () => new Error('KEK not available. Please log in again.'),
      );
    return from(this.multipartUpload(file, kek, folderId ?? null, onProgress));
  }

  downloadFile(
    blobId: string,
    fileName: string,
    onProgress?: (pct: number) => void,
  ): Observable<void> {
    return this.http
      .post<PresignGetResponse>(
        `${this.baseUrl}/blobs/${encodeURIComponent(blobId)}/presign-get`,
        {},
      )
      .pipe(
        switchMap((resp) =>
          from(this.fetchAndDecrypt(resp, fileName, onProgress)),
        ),
      );
  }

  downloadFileToBuffer(blobId: string): Observable<ArrayBuffer> {
    return this.http
      .post<PresignGetResponse>(
        `${this.baseUrl}/blobs/${encodeURIComponent(blobId)}/presign-get`,
        {},
      )
      .pipe(switchMap((resp) => from(this.fetchAndDecryptToBuffer(resp))));
  }

  deleteFile(blobId: string): Observable<void> {
    return this.http.delete<void>(
      `${this.baseUrl}/blobs/${encodeURIComponent(blobId)}`,
    );
  }

  // ─── Folders ──────────────────────────────────────────────────────────────

  listFolders(parentId: string | null): Observable<FolderItem[]> {
    const params: Record<string, string> = parentId
      ? { parent_id: parentId }
      : {};
    return this.http
      .get<ListFoldersResponse>(`${this.baseUrl}/folders`, { params })
      .pipe(map((r) => r.items));
  }

  createFolder(name: string, parentId: string | null): Observable<FolderItem> {
    return this.http.post<FolderItem>(`${this.baseUrl}/folders`, {
      name,
      parent_id: parentId,
    });
  }

  renameFolder(folderId: string, name: string): Observable<FolderItem> {
    return this.http.patch<FolderItem>(
      `${this.baseUrl}/folders/${encodeURIComponent(folderId)}`,
      { name },
    );
  }

  moveFolder(folderId: string, newParentId: string | null): Observable<void> {
    return this.http.patch<void>(
      `${this.baseUrl}/folders/${encodeURIComponent(folderId)}/move`,
      { parent_id: newParentId },
    );
  }

  deleteFolder(folderId: string): Observable<void> {
    return this.http.delete<void>(
      `${this.baseUrl}/folders/${encodeURIComponent(folderId)}`,
    );
  }

  search(query: string): Observable<SearchResponse> {
    return this.http.get<SearchResponse>(`${this.baseUrl}/search`, {
      params: { q: query },
    });
  }

  // ─── Trash ────────────────────────────────────────────────────────────────

  private readonly trashUrl = `${environment.apiBaseUrl}/trash`;

  listTrash(): Observable<TrashListResponse> {
    return this.http.get<TrashListResponse>(this.trashUrl);
  }

  restoreBlob(blobId: string): Observable<void> {
    return this.http.post<void>(
      `${this.trashUrl}/blobs/${encodeURIComponent(blobId)}/restore`,
      {},
    );
  }

  hardDeleteBlob(blobId: string): Observable<void> {
    return this.http.delete<void>(
      `${this.trashUrl}/blobs/${encodeURIComponent(blobId)}`,
    );
  }

  restoreFolder(folderId: string): Observable<void> {
    return this.http.post<void>(
      `${this.trashUrl}/folders/${encodeURIComponent(folderId)}/restore`,
      {},
    );
  }

  hardDeleteFolder(folderId: string): Observable<void> {
    return this.http.delete<void>(
      `${this.trashUrl}/folders/${encodeURIComponent(folderId)}`,
    );
  }

  emptyTrash(): Observable<void> {
    return this.http.delete<void>(this.trashUrl);
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  // Encrypts and uploads one chunk at a time — peak RAM ≈ CHUNK_SIZE * 2 ≈ 16 MB.
  private async multipartUpload(
    file: File,
    kek: CryptoKey,
    folderId: string | null,
    onProgress?: (
      phase: 'reading' | 'encrypting' | 'uploading',
      pct: number,
    ) => void,
  ): Promise<{ blob_id: string }> {
    const contentType = file.type?.trim() || 'application/octet-stream';
    const chunkCount = Math.ceil(file.size / CHUNK_SIZE) || 1;
    const totalEncSize = file.size + chunkCount * FRAME_OVERHEAD;

    const fileKey = await this.crypto.generateFileKey();
    const wrappedKeyB64 = await this.crypto.wrapFileKey(fileKey, kek);
    const aad = this.ownerAad();

    // 1. Initiate multipart — get presigned part URLs.
    const initPayload: InitiateMultipartRequest = {
      file_name: file.name,
      content_type: contentType,
      encrypted_file_key: wrappedKeyB64,
      file_size: totalEncSize,
      file_size_plain: file.size,
      chunk_size: CHUNK_SIZE,
      part_count: chunkCount,
      ...(folderId ? { folder_id: folderId } : {}),
    };
    const { blob_id, part_urls } = await firstValueFrom(
      this.http.post<InitiateMultipartResponse>(
        `${this.baseUrl}/blobs/initiate-multipart`,
        initPayload,
      ),
    );

    // 2. Encrypt each chunk and PUT it directly to MinIO.
    // Each iteration = one full cycle: read → encrypt → upload.
    // Progress is reported as a single 'uploading' percentage across all parts.
    try {
      for (let i = 0; i < chunkCount; i++) {
        onProgress?.('uploading', Math.round((i / chunkCount) * 100));
        const plain = await file
          .slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE)
          .arrayBuffer();
        const frame = await this.crypto.encryptChunk(plain, fileKey, aad);

        const partUrl = part_urls[i]?.url;
        if (!partUrl)
          throw new Error(`Missing presigned URL for part ${i + 1}`);
        await this.uploadPartWithRetry(partUrl, frame, i + 1);
      }
      onProgress?.('uploading', 100);
    } catch (err) {
      // best-effort: tell backend to abort the multipart upload and free MinIO storage
      this.http
        .delete(`${this.baseUrl}/blobs/${encodeURIComponent(blob_id)}/abort`)
        .subscribe({ error: () => {} });
      throw err;
    }

    // 3. Tell backend to complete the multipart upload.
    await firstValueFrom(
      this.http.post<void>(
        `${this.baseUrl}/blobs/${encodeURIComponent(blob_id)}/complete-multipart`,
        {},
      ),
    );
    return { blob_id };
  }

  private async uploadPartWithRetry(
    url: string,
    body: ArrayBuffer,
    partNumber: number,
    retries = 3,
  ): Promise<void> {
    for (let attempt = 0; attempt < retries; attempt++) {
      const resp = await fetch(url, { method: 'PUT', body: body.slice(0) });
      if (resp.ok) return;
      if (attempt < retries - 1)
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
    throw new Error(
      `Part ${partNumber} upload failed after ${retries} attempts`,
    );
  }

  private ownerAad(ownerUserId?: string): Uint8Array {
    const id = ownerUserId ?? this.auth.userId();
    if (!id)
      throw new Error(
        'User ID unavailable — cannot derive AAD for file encryption.',
      );
    return new TextEncoder().encode(id);
  }

  private async fetchAndDecryptToBuffer(
    resp: PresignGetResponse,
  ): Promise<ArrayBuffer> {
    const kek = this.auth.getFileKey();
    if (!kek) throw new Error('KEK not available. Please log in again.');
    const fetchResp = await fetch(resp.download_url);
    if (!fetchResp.ok)
      throw new Error(`Download failed with status ${fetchResp.status}`);
    const encrypted = await fetchResp.arrayBuffer();
    const fileKey = await this.crypto.unwrapFileKey(
      resp.encrypted_file_key,
      kek,
    );
    return this.crypto.decryptFileChunked(
      encrypted,
      fileKey,
      resp.chunk_size,
      this.ownerAad(),
    );
  }

  private async fetchAndDecrypt(
    resp: PresignGetResponse,
    fileName: string,
    onProgress?: (pct: number) => void,
  ): Promise<void> {
    const kek = this.auth.getFileKey();
    if (!kek) {
      throw new Error('KEK not available. Please log in again.');
    }

    const fetchResp = await fetch(resp.download_url);
    if (!fetchResp.ok) {
      throw new Error(`Download failed with status ${fetchResp.status}`);
    }

    let encryptedData: ArrayBuffer;

    if (onProgress && fetchResp.body) {
      const total = parseInt(
        fetchResp.headers.get('Content-Length') ?? '0',
        10,
      );
      const reader = fetchResp.body.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        if (total > 0) onProgress(Math.round((received / total) * 100));
      }

      const merged = new Uint8Array(received);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }
      encryptedData = merged.buffer;
    } else {
      encryptedData = await fetchResp.arrayBuffer();
    }

    const fileKey = await this.crypto.unwrapFileKey(
      resp.encrypted_file_key,
      kek,
    );
    const plaintext = await this.crypto.decryptFileChunked(
      encryptedData,
      fileKey,
      resp.chunk_size,
      this.ownerAad(),
    );

    triggerBrowserDownload(plaintext, fileName, resp.content_type);
  }
}
