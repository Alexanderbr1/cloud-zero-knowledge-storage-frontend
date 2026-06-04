import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { of } from 'rxjs';

import { SharingService, ShareItem } from './sharing.service';
import { AuthService } from './auth.service';
import { CryptoService } from './crypto.service';
import { environment } from '../../../environments/environment';

const STORAGE = `${environment.apiBaseUrl}/storage`;
const SHARES  = `${environment.apiBaseUrl}/shares`;
const USERS   = `${environment.apiBaseUrl}/users`;

// ─── fakes ───────────────────────────────────────────────────────────────────

const fakeKey = {} as CryptoKey;

const mockAuth = {
  getFileKey:     jasmine.createSpy('getFileKey').and.returnValue(null),
  getECPrivateKey: jasmine.createSpy('getECPrivateKey').and.returnValue(null),
};

const mockCrypto = {
  unwrapFileKeyForSharing:     jasmine.createSpy('unwrapFileKeyForSharing').and.returnValue(Promise.resolve(fakeKey)),
  encryptFileKeyForRecipient:  jasmine.createSpy('encryptFileKeyForRecipient').and.returnValue(
    Promise.resolve({ ephemeralPubB64: 'pub==', wrappedFileKeyB64: 'wrapped==' }),
  ),
  decryptFileKeyFromShare:     jasmine.createSpy('decryptFileKeyFromShare').and.returnValue(Promise.resolve(fakeKey)),
};

const SHARE_ITEM: ShareItem = {
  share_id:        'share-1',
  blob_id:         'blob-1',
  owner_id:        'user-1',
  owner_email:     'alice@example.com',
  recipient_email: 'bob@example.com',
  file_name:       'report.pdf',
  content_type:    'application/pdf',
  ephemeral_pub:   'pub==',
  wrapped_file_key: 'wrapped==',
  created_at:      '2025-01-01T00:00:00Z',
};

// ─────────────────────────────────────────────────────────────────────────────

describe('SharingService', () => {
  let svc: SharingService;
  let http: HttpTestingController;

  beforeEach(() => {
    mockAuth.getFileKey.and.returnValue(null);
    mockAuth.getECPrivateKey.and.returnValue(null);
    mockCrypto.unwrapFileKeyForSharing.and.returnValue(Promise.resolve(fakeKey));
    mockCrypto.encryptFileKeyForRecipient.and.returnValue(
      Promise.resolve({ ephemeralPubB64: 'pub==', wrappedFileKeyB64: 'wrapped==' }),
    );
    mockCrypto.decryptFileKeyFromShare.and.returnValue(Promise.resolve(fakeKey));

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService,   useValue: mockAuth   },
        { provide: CryptoService, useValue: mockCrypto },
      ],
    });
    svc  = TestBed.inject(SharingService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  // ─── getRecipientPublicKey ────────────────────────────────────────────────

  it('getRecipientPublicKey() GETs /users/public-key?email=...', fakeAsync(() => {
    let result: string | undefined;
    svc.getRecipientPublicKey('bob@example.com').subscribe(k => (result = k));
    tick();

    const req = http.expectOne(r => r.url === `${USERS}/public-key`);
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('email')).toBe('bob@example.com');
    req.flush({ public_key: 'EC_PUBLIC_KEY==' });
    tick();

    expect(result).toBe('EC_PUBLIC_KEY==');
  }));

  // ─── listSharedWithMe ─────────────────────────────────────────────────────

  it('listSharedWithMe() GETs /shares/incoming', fakeAsync(() => {
    let result: { items: ShareItem[] } | undefined;
    svc.listSharedWithMe().subscribe(r => (result = r as { items: ShareItem[] }));
    tick();

    const req = http.expectOne(`${SHARES}/incoming`);
    expect(req.request.method).toBe('GET');
    req.flush({ items: [SHARE_ITEM] });
    tick();

    expect(result?.items).toEqual([SHARE_ITEM]);
  }));

  // ─── listMyShares ─────────────────────────────────────────────────────────

  it('listMyShares() GETs /storage/blobs/:id/shares', fakeAsync(() => {
    let result: { items: ShareItem[] } | undefined;
    svc.listMyShares('blob-1').subscribe(r => (result = r as { items: ShareItem[] }));
    tick();

    const req = http.expectOne(`${STORAGE}/blobs/blob-1/shares`);
    expect(req.request.method).toBe('GET');
    req.flush({ items: [SHARE_ITEM] });
    tick();

    expect(result?.items).toEqual([SHARE_ITEM]);
  }));

  // ─── revokeShare ─────────────────────────────────────────────────────────

  it('revokeShare() DELETEs /shares/:id', fakeAsync(() => {
    let done = false;
    svc.revokeShare('share-1').subscribe(() => (done = true));
    tick();

    const req = http.expectOne(`${SHARES}/share-1`);
    expect(req.request.method).toBe('DELETE');
    req.flush(null, { status: 204, statusText: 'No Content' });
    tick();

    expect(done).toBeTrue();
  }));

  // ─── shareFileWithUser — KEK missing ─────────────────────────────────────

  it('shareFileWithUser() errors immediately when KEK is unavailable', fakeAsync(() => {
    mockAuth.getFileKey.and.returnValue(null);

    let error: unknown;
    svc.shareFileWithUser('blob-1', 'key==', 'bob@example.com', 'pub==').subscribe({
      error: e => (error = e),
    });
    tick();

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('KEK');
    http.expectNone(`${STORAGE}/blobs/blob-1/shares`);
  }));

  // ─── shareFileWithUser — success ─────────────────────────────────────────

  it('shareFileWithUser() unwraps key, re-encrypts, and POSTs to /storage/blobs/:id/shares', fakeAsync(() => {
    mockAuth.getFileKey.and.returnValue(fakeKey);

    let result: ShareItem | undefined;
    svc.shareFileWithUser('blob-1', 'encKey==', 'bob@example.com', 'recipPub==').subscribe(
      r => (result = r),
    );
    tick(); // runs the async chain

    const req = http.expectOne(`${STORAGE}/blobs/blob-1/shares`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body.recipient_email).toBe('bob@example.com');
    expect(req.request.body.ephemeral_pub).toBe('pub==');
    expect(req.request.body.wrapped_file_key).toBe('wrapped==');
    req.flush(SHARE_ITEM);
    tick();

    expect(result).toEqual(SHARE_ITEM);
    expect(mockCrypto.unwrapFileKeyForSharing).toHaveBeenCalledWith('encKey==', fakeKey);
    expect(mockCrypto.encryptFileKeyForRecipient).toHaveBeenCalledWith(fakeKey, 'recipPub==');
  }));

  it('shareFileWithUser() includes expires_at when provided', fakeAsync(() => {
    mockAuth.getFileKey.and.returnValue(fakeKey);

    svc.shareFileWithUser('blob-1', 'key==', 'bob@example.com', 'pub==', '2025-12-31T23:59:59.000Z').subscribe();
    tick();

    const req = http.expectOne(`${STORAGE}/blobs/blob-1/shares`);
    expect(req.request.body.expires_at).toBe('2025-12-31T23:59:59.000Z');
    req.flush(SHARE_ITEM);
    tick();
  }));

  it('shareFileWithUser() omits expires_at when not provided', fakeAsync(() => {
    mockAuth.getFileKey.and.returnValue(fakeKey);

    svc.shareFileWithUser('blob-1', 'key==', 'bob@example.com', 'pub==').subscribe();
    tick();

    const req = http.expectOne(`${STORAGE}/blobs/blob-1/shares`);
    expect(req.request.body['expires_at']).toBeUndefined();
    req.flush(SHARE_ITEM);
    tick();
  }));

  // ─── getSharedFile — EC key missing ──────────────────────────────────────

  it('getSharedFile() errors immediately when EC private key is unavailable', fakeAsync(() => {
    mockAuth.getECPrivateKey.and.returnValue(null);

    let error: unknown;
    svc.getSharedFile('share-1').subscribe({ error: e => (error = e) });
    tick();

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('EC private key');
    http.expectNone(`${SHARES}/share-1`);
  }));

  // ─── getSharedFile — success ─────────────────────────────────────────────

  it('getSharedFile() GETs share and decrypts file key', fakeAsync(() => {
    mockAuth.getECPrivateKey.and.returnValue(fakeKey);

    let result: unknown;
    svc.getSharedFile('share-1').subscribe(r => (result = r));
    tick();

    const req = http.expectOne(`${SHARES}/share-1`);
    expect(req.request.method).toBe('GET');
    req.flush({
      ...SHARE_ITEM,
      download_url: 'https://s3.example.com/blob-1',
      chunk_size: 8388608,
      file_size: 8388636,
    });
    tick();

    expect(mockCrypto.decryptFileKeyFromShare).toHaveBeenCalledWith(
      SHARE_ITEM.wrapped_file_key,
      SHARE_ITEM.ephemeral_pub,
      fakeKey,
    );
    expect(result).toBeTruthy();
  }));

  it('getSharedFile() errors when share has no download_url', fakeAsync(() => {
    mockAuth.getECPrivateKey.and.returnValue(fakeKey);

    let error: unknown;
    svc.getSharedFile('share-1').subscribe({ error: e => (error = e) });
    tick();

    http.expectOne(`${SHARES}/share-1`).flush({
      ...SHARE_ITEM,
      download_url: undefined,
      file_iv: undefined,
    });
    tick();

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('download data');
  }));
});
