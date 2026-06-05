import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, firstValueFrom, from, map, switchMap, throwError } from 'rxjs';

import { environment } from '../../../environments/environment';
import { triggerBrowserDownload } from '../utils/browser.utils';
import { AuthService } from './auth.service';
import { CryptoService } from './crypto.service';

export interface ShareItem {
  readonly share_id:         string;
  readonly blob_id:          string;
  readonly owner_id:         string;
  readonly owner_email:      string;
  readonly recipient_email:  string;
  readonly file_name:        string;
  readonly content_type:     string;
  readonly ephemeral_pub:    string;
  readonly wrapped_file_key: string;
  readonly expires_at?:      string;
  readonly created_at:       string;
}

interface SharedFileItem extends ShareItem {
  readonly download_url:    string;
  readonly file_size:       number;
  readonly file_size_plain: number;
  readonly chunk_size:      number;
}

interface SharedFileResult {
  downloadUrl:   string;
  fileKey:       CryptoKey;
  chunkSize:     number;
  fileSize:      number;
  fileName:      string;
  ownerUserId:   string;
}

@Injectable({ providedIn: 'root' })
export class SharingService {
  private readonly http   = inject(HttpClient);
  private readonly auth   = inject(AuthService);
  private readonly crypto = inject(CryptoService);

  private readonly storageBase = `${environment.apiBaseUrl}/storage`;
  private readonly sharesBase  = `${environment.apiBaseUrl}/shares`;
  private readonly usersBase   = `${environment.apiBaseUrl}/users`;

  getRecipientPublicKey(email: string): Observable<string> {
    return this.http
      .get<{ public_key: string }>(`${this.usersBase}/public-key`, { params: { email } })
      .pipe(map(r => r.public_key));
  }

  shareFileWithUser(
    blobId: string,
    encryptedFileKeyB64: string,
    recipientEmail: string,
    recipientPublicKeyB64: string,
    expiresAt?: string,
  ): Observable<ShareItem> {
    const kek = this.auth.getFileKey();
    if (!kek) return throwError(() => new Error('KEK unavailable — please unlock your session.'));

    return from((async (): Promise<ShareItem> => {
      const fileKey = await this.crypto.unwrapFileKeyForSharing(encryptedFileKeyB64, kek);
      const { ephemeralPubB64, wrappedFileKeyB64 } = await this.crypto.encryptFileKeyForRecipient(fileKey, recipientPublicKeyB64);
      return firstValueFrom(
        this.http.post<ShareItem>(
          `${this.storageBase}/blobs/${blobId}/shares`,
          {
            recipient_email:  recipientEmail,
            ephemeral_pub:    ephemeralPubB64,
            wrapped_file_key: wrappedFileKeyB64,
            ...(expiresAt ? { expires_at: expiresAt } : {}),
          },
        ),
      );
    })());
  }

  listSharedWithMe(): Observable<{ items: ShareItem[] }> {
    return this.http.get<{ items: ShareItem[] }>(`${this.sharesBase}/incoming`);
  }

  listMyShares(blobId: string): Observable<{ items: ShareItem[] }> {
    return this.http.get<{ items: ShareItem[] }>(`${this.storageBase}/blobs/${blobId}/shares`);
  }

  getSharedFile(shareId: string): Observable<SharedFileResult> {
    const ecPrivateKey = this.auth.getECPrivateKey();
    if (!ecPrivateKey) return throwError(() => new Error('EC private key unavailable — please log in again.'));

    return from((async (): Promise<SharedFileResult> => {
      const share = await firstValueFrom(this.http.get<SharedFileItem>(`${this.sharesBase}/${shareId}`));
      return {
        downloadUrl:  share.download_url,
        fileKey:      await this.crypto.decryptFileKeyFromShare(share.wrapped_file_key, share.ephemeral_pub, ecPrivateKey),
        chunkSize:    share.chunk_size,
        fileSize:     share.file_size,
        fileName:     share.file_name,
        ownerUserId:  share.owner_id,
      };
    })());
  }

  revokeShare(shareId: string): Observable<void> {
    return this.http.delete<void>(`${this.sharesBase}/${shareId}`);
  }

  downloadSharedFile(shareId: string, contentType: string): Observable<void> {
    return this.getSharedFile(shareId).pipe(
      switchMap(result => from(this.fetchDecryptAndSave(result, contentType))),
    );
  }

  private async fetchDecryptAndSave(result: SharedFileResult, contentType: string): Promise<void> {
    const resp = await fetch(result.downloadUrl);
    if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);
    const aad       = result.ownerUserId ? new TextEncoder().encode(result.ownerUserId) : undefined;
    const plaintext = await this.crypto.decryptFileChunked(await resp.arrayBuffer(), result.fileKey, result.chunkSize, aad);
    triggerBrowserDownload(plaintext, result.fileName, contentType);
  }
}
