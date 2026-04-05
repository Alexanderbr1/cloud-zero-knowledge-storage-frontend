import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { from, map, Observable, switchMap } from 'rxjs';

import { environment } from '../../../environments/environment';
import { FileItem } from '../models/file-item.model';
import { CryptoService } from './crypto.service';
import { AuthService } from './auth.service';

interface PresignPutRequest {
  file_name: string;
  encrypted_file_key: string;
  file_iv: string;
}

interface PresignPutResponse {
  blob_id: string;
  upload_url: string;
  expires_in: number;
  http_method: string;
  instructions: string;
}

interface PresignGetResponse {
  blob_id: string;
  download_url: string;
  expires_in: number;
  http_method: string;
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

  /**
   * Загрузка файла с клиентским шифрованием:
   * 1. Читаем файл как ArrayBuffer
   * 2. Генерируем уникальный файловый ключ (AES-256-GCM)
   * 3. Шифруем содержимое — сервер никогда не видит plaintext
   * 4. Оборачиваем файловый ключ мастер-ключом (AES-KW)
   * 5. Отправляем wrapped key + IV на сервер вместе с presign-запросом
   * 6. Загружаем зашифрованный blob по presigned URL
   */
  uploadFile(file: File): Observable<PresignPutResponse> {
    const masterKey = this.auth.getMasterKey();
    if (!masterKey) {
      throw new Error('Master key not available. Please log in again.');
    }

    return from(this.prepareEncryptedUpload(file, masterKey)).pipe(
      switchMap(({ encryptedBuffer, wrappedKeyB64, ivB64 }) => {
        const payload: PresignPutRequest = {
          file_name: file.name,
          encrypted_file_key: wrappedKeyB64,
          file_iv: ivB64
        };

        return this.http.post<PresignPutResponse>(`${this.baseUrl}/presign`, payload).pipe(
          switchMap((presign) =>
            from(
              fetch(presign.upload_url, {
                method: presign.http_method || 'PUT',
                headers: { 'Content-Type': 'application/octet-stream' },
                body: encryptedBuffer
              })
            ).pipe(
              map((response) => {
                if (!response.ok) {
                  throw new Error(`Upload failed with status ${response.status}`);
                }
                return presign;
              })
            )
          )
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

  private async prepareEncryptedUpload(
    file: File,
    masterKey: CryptoKey
  ): Promise<{ encryptedBuffer: ArrayBuffer; wrappedKeyB64: string; ivB64: string }> {
    const plaintext = await file.arrayBuffer();
    const fileKey = await this.crypto.generateFileKey();
    const { ciphertext, ivB64 } = await this.crypto.encryptFile(plaintext, fileKey);
    const wrappedKeyB64 = await this.crypto.wrapFileKey(fileKey, masterKey);
    return { encryptedBuffer: ciphertext, wrappedKeyB64, ivB64 };
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

    this.triggerBrowserDownload(plaintext, fileName);
  }

  private triggerBrowserDownload(data: ArrayBuffer, fileName: string): void {
    const blob = new Blob([data]);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Освобождаем URL через 60 секунд
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
