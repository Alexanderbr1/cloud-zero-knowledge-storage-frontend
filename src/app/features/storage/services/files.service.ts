import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, from, map, switchMap, throwError } from 'rxjs';

import { environment } from '../../../../environments/environment';
import { FileItem } from '../models/file-item.model';
import { FolderItem } from '../models/folder.model';
import { TrashListResponse } from '../models/trash.model';
import { CryptoService } from '../../../core/services/crypto.service';
import { AuthService } from '../../../core/services/auth.service';
import { triggerBrowserDownload } from '../../../core/utils/browser.utils';

interface PresignPutRequest {
  file_name: string;
  content_type: string;
  encrypted_file_key: string;
  file_iv: string;
  file_size: number;
  folder_id?: string;
}

interface PresignPutResponse {
  blob_id: string;
  upload_url: string;
  expires_in: number;
  http_method: string;
  content_type: string;
}

interface PresignGetResponse {
  blob_id: string;
  download_url: string;
  expires_in: number;
  http_method: string;
  content_type: string;
  encrypted_file_key: string;
  file_iv: string;
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
      .get<ListBlobsResponse>(`${this.baseUrl}/blobs`, { params: { folder_id: param } })
      .pipe(map(r => r.items));
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
    onProgress?: (phase: 'reading' | 'encrypting' | 'uploading', pct: number) => void,
    folderId?: string | null,
  ): Observable<PresignPutResponse> {
    const masterKey = this.auth.getMasterKey();
    if (!masterKey) {
      return throwError(() => new Error('Master key not available. Please log in again.'));
    }

    onProgress?.('reading', 0);

    return from(this.prepareEncryptedUpload(file, masterKey, onProgress)).pipe(
      switchMap(({ encryptedBuffer, wrappedKeyB64, ivB64 }) => {
        const contentType = file.type?.trim() || 'application/octet-stream';
        const payload: PresignPutRequest = {
          file_name: file.name,
          content_type: contentType,
          encrypted_file_key: wrappedKeyB64,
          file_iv: ivB64,
          file_size: encryptedBuffer.byteLength,
          ...(folderId ? { folder_id: folderId } : {}),
        };

        return this.http.post<PresignPutResponse>(`${this.baseUrl}/presign`, payload).pipe(
          switchMap(presign => {
            onProgress?.('uploading', 0);
            return this.xhrUploadPut(
              presign.upload_url,
              encryptedBuffer,
              presign.content_type,
              pct => onProgress?.('uploading', pct),
            ).pipe(
              switchMap(() => this.confirmUpload(presign.blob_id)),
              map(() => presign),
            );
          }),
        );
      }),
    );
  }

  downloadFile(blobId: string, fileName: string): Observable<void> {
    return this.http
      .post<PresignGetResponse>(
        `${this.baseUrl}/blobs/${encodeURIComponent(blobId)}/presign-get`,
        {},
      )
      .pipe(switchMap(resp => from(this.fetchAndDecrypt(resp, fileName))));
  }

  downloadFileToBuffer(blobId: string): Observable<ArrayBuffer> {
    return this.http
      .post<PresignGetResponse>(
        `${this.baseUrl}/blobs/${encodeURIComponent(blobId)}/presign-get`,
        {},
      )
      .pipe(switchMap(resp => from(this.fetchAndDecryptToBuffer(resp))));
  }

  deleteFile(blobId: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/blobs/${encodeURIComponent(blobId)}`);
  }

  confirmUpload(blobId: string): Observable<void> {
    return this.http.post<void>(`${this.baseUrl}/blobs/${encodeURIComponent(blobId)}/confirm-upload`, {});
  }

  // ─── Folders ──────────────────────────────────────────────────────────────

  listFolders(parentId: string | null): Observable<FolderItem[]> {
    const params: Record<string, string> = parentId ? { parent_id: parentId } : {};
    return this.http
      .get<ListFoldersResponse>(`${this.baseUrl}/folders`, { params })
      .pipe(map(r => r.items));
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
    return this.http.delete<void>(`${this.baseUrl}/folders/${encodeURIComponent(folderId)}`);
  }

  search(query: string): Observable<SearchResponse> {
    return this.http.get<SearchResponse>(`${this.baseUrl}/search`, { params: { q: query } });
  }

  // ─── Trash ────────────────────────────────────────────────────────────────

  private readonly trashUrl = `${environment.apiBaseUrl}/trash`;

  listTrash(): Observable<TrashListResponse> {
    return this.http.get<TrashListResponse>(this.trashUrl);
  }

  restoreBlob(blobId: string): Observable<void> {
    return this.http.post<void>(`${this.trashUrl}/blobs/${encodeURIComponent(blobId)}/restore`, {});
  }

  hardDeleteBlob(blobId: string): Observable<void> {
    return this.http.delete<void>(`${this.trashUrl}/blobs/${encodeURIComponent(blobId)}`);
  }

  restoreFolder(folderId: string): Observable<void> {
    return this.http.post<void>(`${this.trashUrl}/folders/${encodeURIComponent(folderId)}/restore`, {});
  }

  hardDeleteFolder(folderId: string): Observable<void> {
    return this.http.delete<void>(`${this.trashUrl}/folders/${encodeURIComponent(folderId)}`);
  }

  emptyTrash(): Observable<void> {
    return this.http.delete<void>(this.trashUrl);
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private xhrUploadPut(
    url: string,
    body: ArrayBuffer,
    contentType: string,
    onProgress?: (pct: number) => void,
  ): Observable<void> {
    return new Observable<void>(observer => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', url);
      xhr.setRequestHeader('Content-Type', contentType);

      xhr.upload.addEventListener('progress', event => {
        if (event.lengthComputable) {
          onProgress?.(Math.round((event.loaded / event.total) * 100));
        }
      });

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          observer.next();
          observer.complete();
        } else {
          observer.error(new Error(`Upload failed with status ${xhr.status}`));
        }
      });

      xhr.addEventListener('error', () => observer.error(new Error('Upload failed: network error')));
      xhr.addEventListener('abort', () => observer.error(new Error('Upload aborted')));

      xhr.send(body);
      return () => xhr.abort();
    });
  }

  private async prepareEncryptedUpload(
    file: File,
    masterKey: CryptoKey,
    onProgress?: (phase: 'reading' | 'encrypting' | 'uploading', pct: number) => void,
  ): Promise<{ encryptedBuffer: ArrayBuffer; wrappedKeyB64: string; ivB64: string }> {
    const plaintext = await this.readFileWithProgress(file, pct => onProgress?.('reading', pct));
    onProgress?.('encrypting', 0);
    const fileKey = await this.crypto.generateFileKey();
    const { ciphertext, ivB64 } = await this.crypto.encryptFile(plaintext, fileKey);
    const wrappedKeyB64 = await this.crypto.wrapFileKey(fileKey, masterKey);
    return { encryptedBuffer: ciphertext, wrappedKeyB64, ivB64 };
  }

  private readFileWithProgress(file: File, onProgress: (pct: number) => void): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onprogress = event => {
        if (event.lengthComputable) {
          onProgress(Math.round((event.loaded / event.total) * 100));
        }
      };
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(new Error('File read failed'));
      reader.readAsArrayBuffer(file);
    });
  }

  private async fetchAndDecryptToBuffer(resp: PresignGetResponse): Promise<ArrayBuffer> {
    const masterKey = this.auth.getMasterKey();
    if (!masterKey) throw new Error('Master key not available. Please log in again.');
    const fetchResp = await fetch(resp.download_url);
    if (!fetchResp.ok) throw new Error(`Download failed with status ${fetchResp.status}`);
    const encrypted = await fetchResp.arrayBuffer();
    const fileKey = await this.crypto.unwrapFileKey(resp.encrypted_file_key, masterKey);
    return this.crypto.decryptFile(encrypted, fileKey, resp.file_iv);
  }

  private async fetchAndDecrypt(resp: PresignGetResponse, fileName: string): Promise<void> {
    const masterKey = this.auth.getMasterKey();
    if (!masterKey) {
      throw new Error('Master key not available. Please log in again.');
    }

    const fetchResp = await fetch(resp.download_url);
    if (!fetchResp.ok) {
      throw new Error(`Download failed with status ${fetchResp.status}`);
    }
    const encryptedData = await fetchResp.arrayBuffer();

    const fileKey = await this.crypto.unwrapFileKey(resp.encrypted_file_key, masterKey);
    const plaintext = await this.crypto.decryptFile(encryptedData, fileKey, resp.file_iv);

    triggerBrowserDownload(plaintext, fileName, resp.content_type);
  }
}
