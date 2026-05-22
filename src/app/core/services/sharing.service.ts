import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, firstValueFrom, from, map, switchMap, throwError } from 'rxjs';

import { triggerBrowserDownload } from '../utils/browser.utils';

import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';
import { CryptoService } from './crypto.service';

export interface ShareItem {
  readonly share_id: string;
  readonly blob_id: string;
  readonly owner_id: string;
  readonly owner_email: string;
  readonly recipient_email?: string;
  readonly file_name: string;
  readonly content_type: string;
  readonly ephemeral_pub: string;
  readonly wrapped_file_key: string;
  readonly expires_at?: string;
  readonly created_at: string;
  readonly download_url?: string;
  readonly file_iv?: string;
}

@Injectable({ providedIn: 'root' })
export class SharingService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly crypto = inject(CryptoService);
  private readonly storageBase = `${environment.apiBaseUrl}/storage`;
  private readonly sharesBase  = `${environment.apiBaseUrl}/shares`;
  private readonly usersBase   = `${environment.apiBaseUrl}/users`;

  /** Fetch a recipient's SPKI public key by email. */
  getRecipientPublicKey(email: string): Observable<string> {
    return this.http
      .get<{ public_key: string }>(`${this.usersBase}/public-key`, { params: { email } })
      .pipe(map(r => r.public_key));
  }

  /**
   * Share a file with another user (owner side).
   * Unwraps the file key with masterKey, re-wraps it for the recipient via ECIES,
   * then sends the share to the server.
   */
  shareFileWithUser(
    blobId: string,
    encryptedFileKeyB64: string,
    recipientEmail: string,
    recipientPublicKeyB64: string,
  ): Observable<ShareItem> {
    const fileWrappingKey = this.auth.getFileKey();
    const rawMasterKey   = this.auth.getMasterKey();
    if (!fileWrappingKey || !rawMasterKey) {
      return throwError(() => new Error('Master key unavailable — please unlock your session.'));
    }

    const flow = async (): Promise<ShareItem> => {
      // Try KEK (new files) first; fall back to rawMasterKey for files uploaded before KEK was introduced.
      const fileKey = await this.crypto.unwrapFileKeyForSharing(encryptedFileKeyB64, fileWrappingKey)
        .catch(() => this.crypto.unwrapFileKeyForSharing(encryptedFileKeyB64, rawMasterKey));
      const { ephemeralPubB64, wrappedFileKeyB64 } = await this.crypto.encryptFileKeyForRecipient(fileKey, recipientPublicKeyB64);
      return firstValueFrom(
        this.http.post<ShareItem>(
          `${this.storageBase}/blobs/${blobId}/shares`,
          { recipient_email: recipientEmail, ephemeral_pub: ephemeralPubB64, wrapped_file_key: wrappedFileKeyB64 },
        ),
      );
    };

    return from(flow());
  }

  /** List files shared with the current user. */
  listSharedWithMe(): Observable<{ items: ShareItem[] }> {
    return this.http.get<{ items: ShareItem[] }>(`${this.sharesBase}/incoming`);
  }

  /** List shares the current user created for a specific blob. */
  listMyShares(blobId: string): Observable<{ items: ShareItem[] }> {
    return this.http.get<{ items: ShareItem[] }>(`${this.storageBase}/blobs/${blobId}/shares`);
  }

  /**
   * Get a shared file's download URL and decrypt the file key (recipient side).
   * Returns the download URL and decrypted file key for use with CryptoService.decryptFile.
   */
  getSharedFile(shareId: string): Observable<{ downloadUrl: string; fileKey: CryptoKey; fileIVb64: string; fileName: string; ownerUserId: string }> {
    const ecPrivateKey = this.auth.getECPrivateKey();
    if (!ecPrivateKey) {
      return throwError(() => new Error('EC private key unavailable — please log in again.'));
    }

    const flow = async () => {
      const share = await firstValueFrom(
        this.http.get<ShareItem>(`${this.sharesBase}/${shareId}`),
      );

      if (!share.download_url || !share.file_iv) {
        throw new Error('Server returned share without download data');
      }

      const fileKey = await this.crypto.decryptFileKeyFromShare(
        share.wrapped_file_key,
        share.ephemeral_pub,
        ecPrivateKey,
      );

      return {
        downloadUrl: share.download_url,
        fileKey,
        fileIVb64: share.file_iv,
        fileName: share.file_name,
        ownerUserId: share.owner_id,
      };
    };

    return from(flow());
  }

  /** Revoke a share (owner only). */
  revokeShare(shareId: string): Observable<void> {
    return this.http.delete<void>(`${this.sharesBase}/${shareId}`);
  }

  /** Download, decrypt and save a shared file (recipient side). */
  downloadSharedFile(shareId: string, contentType: string): Observable<void> {
    return this.getSharedFile(shareId).pipe(
      switchMap(result => from(this.fetchDecryptAndSave(result, contentType))),
    );
  }

  private async fetchDecryptAndSave(
    result: { downloadUrl: string; fileKey: CryptoKey; fileIVb64: string; fileName: string; ownerUserId: string },
    contentType: string,
  ): Promise<void> {
    const resp = await fetch(result.downloadUrl);
    if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);
    const encrypted = await resp.arrayBuffer();
    const aad = result.ownerUserId ? new TextEncoder().encode(result.ownerUserId) : undefined;
    const plaintext = await this.crypto.decryptFile(encrypted, result.fileKey, result.fileIVb64, aad);
    triggerBrowserDownload(plaintext, result.fileName, contentType);
  }
}
