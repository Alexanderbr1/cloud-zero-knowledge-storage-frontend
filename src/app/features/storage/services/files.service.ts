import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, from, map, switchMap, throwError } from 'rxjs';

import { environment } from '../../../../environments/environment';
import { FileItem } from '../models/file-item.model';
import { CryptoService } from '../../../core/services/crypto.service';
import { AuthService } from '../../../core/services/auth.service';
import { triggerBrowserDownload } from '../../../core/utils/browser.utils';

interface PresignPutRequest {
  file_name: string;
  content_type: string;
  encrypted_file_key: string;
  file_iv: string;
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

@Injectable({ providedIn: 'root' })
export class FilesService {
  private readonly http = inject(HttpClient);
  private readonly crypto = inject(CryptoService);
  private readonly auth = inject(AuthService);
  private readonly baseUrl = `${environment.apiBaseUrl}/storage`;

  listFiles(): Observable<FileItem[]> {
    return this.http
      .get<ListBlobsResponse>(`${this.baseUrl}/blobs`)
      .pipe(map((response) => response.items));
  }

  uploadFile(
    file: File,
    onProgress?: (phase: 'reading' | 'encrypting' | 'uploading', pct: number) => void
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
          file_iv: ivB64
        };

        return this.http.post<PresignPutResponse>(`${this.baseUrl}/presign`, payload).pipe(
          switchMap((presign) => {
            onProgress?.('uploading', 0);
            return this.xhrUpload(
              presign.upload_url,
              presign.http_method || 'PUT',
              presign.content_type || contentType,
              encryptedBuffer,
              (pct) => onProgress?.('uploading', pct)
            ).pipe(map(() => presign));
          })
        );
      })
    );
  }

  /**
   * Скачивание файла с клиентским дешифрованием:
   * 1. Получаем presigned GET URL + wrapped key + IV с сервера
   * 2. Скачиваем зашифрованный blob из MinIO
   * 3. Разворачиваем файловый ключ мастер-ключом
   * 4. Дешифруем — GCM автоматически проверяет целостность
   * 5. Создаём blob URL и тригерим браузерное скачивание
   *
   * Если файл был загружен до внедрения шифрования (нет crypto-полей) —
   * скачиваем как обычно без дешифрования (обратная совместимость).
   */
  downloadFile(blobId: string, fileName: string): Observable<void> {
    return this.http
      .post<PresignGetResponse>(
        `${this.baseUrl}/blobs/${encodeURIComponent(blobId)}/presign-get`,
        {}
      )
      .pipe(
        switchMap((resp) => from(this.fetchAndDecrypt(resp, fileName)))
      );
  }

  deleteFile(blobId: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/blobs/${encodeURIComponent(blobId)}`);
  }

  // ─── Приватные методы ──────────────────────────────────────────────────

  private xhrUpload(
    url: string,
    method: string,
    contentType: string,
    body: ArrayBuffer,
    onProgress?: (pct: number) => void
  ): Observable<void> {
    return new Observable<void>(observer => {
      const xhr = new XMLHttpRequest();
      xhr.open(method, url);
      xhr.setRequestHeader('Content-Type', contentType);

      xhr.upload.addEventListener('progress', (event) => {
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
    onProgress?: (phase: 'reading' | 'encrypting' | 'uploading', pct: number) => void
  ): Promise<{ encryptedBuffer: ArrayBuffer; wrappedKeyB64: string; ivB64: string }> {
    const plaintext = await this.readFileWithProgress(file, (pct) => onProgress?.('reading', pct));
    onProgress?.('encrypting', 0);
    const fileKey = await this.crypto.generateFileKey();
    const { ciphertext, ivB64 } = await this.crypto.encryptFile(plaintext, fileKey);
    const wrappedKeyB64 = await this.crypto.wrapFileKey(fileKey, masterKey);
    return { encryptedBuffer: ciphertext, wrappedKeyB64, ivB64 };
  }

  private readFileWithProgress(file: File, onProgress: (pct: number) => void): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onprogress = (event) => {
        if (event.lengthComputable) {
          onProgress(Math.round((event.loaded / event.total) * 100));
        }
      };
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(new Error('File read failed'));
      reader.readAsArrayBuffer(file);
    });
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
