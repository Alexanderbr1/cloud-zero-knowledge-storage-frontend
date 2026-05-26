import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';

import { FilesService } from './files.service';
import { AuthService } from '../../../core/services/auth.service';
import { CryptoService } from '../../../core/services/crypto.service';
import { FileItem } from '../models/file-item.model';
import { FolderItem } from '../models/folder.model';
import { TrashListResponse } from '../models/trash.model';
import { environment } from '../../../../environments/environment';

const STORAGE = `${environment.apiBaseUrl}/storage`;
const TRASH   = `${environment.apiBaseUrl}/trash`;

// ─── stubs ───────────────────────────────────────────────────────────────────

const mockAuth = {
  getFileKey: jasmine.createSpy('getFileKey').and.returnValue(null),
  userId:     jasmine.createSpy('userId').and.returnValue('user-1'),
};

const mockCrypto = {};

// ─── fixtures ─────────────────────────────────────────────────────────────────

const FILE: FileItem = {
  blob_id: 'blob-1',
  folder_id: null,
  file_name: 'doc.pdf',
  content_type: 'application/pdf',
  file_size: 2048,
  created_at: '2025-01-01T00:00:00Z',
  encrypted_file_key: 'key==',
  file_iv: 'iv==',
};

const FOLDER: FolderItem = {
  folder_id: 'folder-1',
  parent_id: null,
  name: 'Documents',
  created_at: '2025-01-01T00:00:00Z',
};

// ─────────────────────────────────────────────────────────────────────────────

describe('FilesService', () => {
  let svc: FilesService;
  let http: HttpTestingController;

  beforeEach(() => {
    mockAuth.getFileKey.and.returnValue(null);
    mockAuth.userId.and.returnValue('user-1');

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService,  useValue: mockAuth   },
        { provide: CryptoService, useValue: mockCrypto },
      ],
    });
    svc  = TestBed.inject(FilesService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  // ─── listFilesInFolder ────────────────────────────────────────────────────

  describe('listFilesInFolder()', () => {
    it('GETs /storage/blobs with folder_id=root for null', fakeAsync(() => {
      let result: FileItem[] | undefined;
      svc.listFilesInFolder(null).subscribe(r => (result = r));
      tick();

      const req = http.expectOne(r => r.url === `${STORAGE}/blobs`);
      expect(req.request.method).toBe('GET');
      expect(req.request.params.get('folder_id')).toBe('root');
      req.flush({ items: [FILE] });
      tick();

      expect(result).toEqual([FILE]);
    }));

    it('passes the folderId when provided', fakeAsync(() => {
      svc.listFilesInFolder('folder-99').subscribe();
      tick();

      const req = http.expectOne(r => r.url === `${STORAGE}/blobs`);
      expect(req.request.params.get('folder_id')).toBe('folder-99');
      req.flush({ items: [] });
    }));
  });

  // ─── listFolders ──────────────────────────────────────────────────────────

  describe('listFolders()', () => {
    it('GETs /storage/folders with no params for root (null)', fakeAsync(() => {
      let result: FolderItem[] | undefined;
      svc.listFolders(null).subscribe(r => (result = r));
      tick();

      const req = http.expectOne(r => r.url === `${STORAGE}/folders`);
      expect(req.request.method).toBe('GET');
      expect(req.request.params.has('parent_id')).toBeFalse();
      req.flush({ items: [FOLDER] });
      tick();

      expect(result).toEqual([FOLDER]);
    }));

    it('passes parent_id when provided', fakeAsync(() => {
      svc.listFolders('folder-1').subscribe();
      tick();

      const req = http.expectOne(r => r.url === `${STORAGE}/folders`);
      expect(req.request.params.get('parent_id')).toBe('folder-1');
      req.flush({ items: [] });
    }));
  });

  // ─── createFolder ─────────────────────────────────────────────────────────

  it('createFolder() POSTs to /storage/folders', fakeAsync(() => {
    let result: FolderItem | undefined;
    svc.createFolder('Reports', 'folder-1').subscribe(r => (result = r));
    tick();

    const req = http.expectOne(`${STORAGE}/folders`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ name: 'Reports', parent_id: 'folder-1' });
    req.flush({ ...FOLDER, name: 'Reports', parent_id: 'folder-1' });
    tick();

    expect(result!.name).toBe('Reports');
  }));

  it('createFolder() sends null parent_id for root', fakeAsync(() => {
    svc.createFolder('Root Folder', null).subscribe();
    tick();

    const req = http.expectOne(`${STORAGE}/folders`);
    expect(req.request.body).toEqual({ name: 'Root Folder', parent_id: null });
    req.flush(FOLDER);
  }));

  // ─── renameFolder ─────────────────────────────────────────────────────────

  it('renameFolder() PATCHes /storage/folders/:id', fakeAsync(() => {
    let result: FolderItem | undefined;
    svc.renameFolder('folder-1', 'New Name').subscribe(r => (result = r));
    tick();

    const req = http.expectOne(`${STORAGE}/folders/folder-1`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ name: 'New Name' });
    req.flush({ ...FOLDER, name: 'New Name' });
    tick();

    expect(result!.name).toBe('New Name');
  }));

  // ─── moveFolder ───────────────────────────────────────────────────────────

  it('moveFolder() PATCHes /storage/folders/:id/move', fakeAsync(() => {
    let done = false;
    svc.moveFolder('folder-1', 'folder-2').subscribe(() => (done = true));
    tick();

    const req = http.expectOne(`${STORAGE}/folders/folder-1/move`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ parent_id: 'folder-2' });
    req.flush(null, { status: 204, statusText: 'No Content' });
    tick();

    expect(done).toBeTrue();
  }));

  it('moveFolder() sends null parent_id to move to root', fakeAsync(() => {
    svc.moveFolder('folder-1', null).subscribe();
    tick();

    const req = http.expectOne(`${STORAGE}/folders/folder-1/move`);
    expect(req.request.body).toEqual({ parent_id: null });
    req.flush(null);
  }));

  // ─── deleteFolder ─────────────────────────────────────────────────────────

  it('deleteFolder() DELETEs /storage/folders/:id', fakeAsync(() => {
    let done = false;
    svc.deleteFolder('folder-1').subscribe(() => (done = true));
    tick();

    const req = http.expectOne(`${STORAGE}/folders/folder-1`);
    expect(req.request.method).toBe('DELETE');
    req.flush(null, { status: 204, statusText: 'No Content' });
    tick();

    expect(done).toBeTrue();
  }));

  // ─── renameFile ───────────────────────────────────────────────────────────

  it('renameFile() PATCHes /storage/blobs/:id', fakeAsync(() => {
    let done = false;
    svc.renameFile('blob-1', 'new-name.pdf').subscribe(() => (done = true));
    tick();

    const req = http.expectOne(`${STORAGE}/blobs/blob-1`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ name: 'new-name.pdf' });
    req.flush(null, { status: 204, statusText: 'No Content' });
    tick();

    expect(done).toBeTrue();
  }));

  // ─── moveBlob ─────────────────────────────────────────────────────────────

  it('moveBlob() PATCHes /storage/blobs/:id/folder', fakeAsync(() => {
    let done = false;
    svc.moveBlob('blob-1', 'folder-2').subscribe(() => (done = true));
    tick();

    const req = http.expectOne(`${STORAGE}/blobs/blob-1/folder`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ folder_id: 'folder-2' });
    req.flush(null, { status: 204, statusText: 'No Content' });
    tick();

    expect(done).toBeTrue();
  }));

  it('moveBlob() sends null folder_id to move to root', fakeAsync(() => {
    svc.moveBlob('blob-1', null).subscribe();
    tick();

    const req = http.expectOne(`${STORAGE}/blobs/blob-1/folder`);
    expect(req.request.body).toEqual({ folder_id: null });
    req.flush(null);
  }));

  // ─── deleteFile ───────────────────────────────────────────────────────────

  it('deleteFile() DELETEs /storage/blobs/:id', fakeAsync(() => {
    let done = false;
    svc.deleteFile('blob-1').subscribe(() => (done = true));
    tick();

    const req = http.expectOne(`${STORAGE}/blobs/blob-1`);
    expect(req.request.method).toBe('DELETE');
    req.flush(null, { status: 204, statusText: 'No Content' });
    tick();

    expect(done).toBeTrue();
  }));

  // ─── confirmUpload ────────────────────────────────────────────────────────

  it('confirmUpload() POSTs to /storage/blobs/:id/confirm-upload', fakeAsync(() => {
    let done = false;
    svc.confirmUpload('blob-new').subscribe(() => (done = true));
    tick();

    const req = http.expectOne(`${STORAGE}/blobs/blob-new/confirm-upload`);
    expect(req.request.method).toBe('POST');
    req.flush(null, { status: 204, statusText: 'No Content' });
    tick();

    expect(done).toBeTrue();
  }));

  // ─── search ───────────────────────────────────────────────────────────────

  it('search() GETs /storage/search with q param', fakeAsync(() => {
    let result: unknown;
    svc.search('annual report').subscribe(r => (result = r));
    tick();

    const req = http.expectOne(r => r.url === `${STORAGE}/search`);
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('q')).toBe('annual report');
    req.flush({ blobs: [FILE], folders: [] });
    tick();

    expect(result).toEqual({ blobs: [FILE], folders: [] });
  }));

  // ─── uploadFile / downloadFile — KEK missing ──────────────────────────────

  it('uploadFile() returns an error immediately when KEK is null', fakeAsync(() => {
    mockAuth.getFileKey.and.returnValue(null);

    let error: unknown;
    const file = new File(['hello'], 'test.txt', { type: 'text/plain' });
    svc.uploadFile(file).subscribe({ error: e => (error = e) });
    tick();

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('KEK');
    http.expectNone(`${STORAGE}/presign`);
  }));

  it('downloadFile() emits error when KEK is null after presign', fakeAsync(() => {
    mockAuth.getFileKey.and.returnValue(null);

    let error: unknown;
    svc.downloadFile('blob-1', 'file.txt').subscribe({
      error: (e: unknown) => (error = e),
    });
    tick();

    // The presign-get POST goes out; flush it so the async chain proceeds.
    http.expectOne(`${STORAGE}/blobs/blob-1/presign-get`).flush({
      blob_id: 'blob-1',
      download_url: 'https://s3.example.com/blob-1',
      expires_in: 300,
      http_method: 'GET',
      content_type: 'application/pdf',
      encrypted_file_key: 'key==',
      file_iv: 'iv==',
    });
    tick(); // runs the promise (fetchAndDecrypt), which throws immediately on missing KEK

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('KEK');
  }));

  // ─── Trash ────────────────────────────────────────────────────────────────

  describe('Trash', () => {
    const TRASH_RESP: TrashListResponse = {
      blobs:   [],
      folders: [],
    };

    it('listTrash() GETs /trash', fakeAsync(() => {
      let result: TrashListResponse | undefined;
      svc.listTrash().subscribe(r => (result = r));
      tick();

      const req = http.expectOne(TRASH);
      expect(req.request.method).toBe('GET');
      req.flush(TRASH_RESP);
      tick();

      expect(result).toEqual(TRASH_RESP);
    }));

    it('restoreBlob() POSTs to /trash/blobs/:id/restore', fakeAsync(() => {
      let done = false;
      svc.restoreBlob('blob-1').subscribe(() => (done = true));
      tick();

      const req = http.expectOne(`${TRASH}/blobs/blob-1/restore`);
      expect(req.request.method).toBe('POST');
      req.flush(null, { status: 204, statusText: 'No Content' });
      tick();

      expect(done).toBeTrue();
    }));

    it('hardDeleteBlob() DELETEs /trash/blobs/:id', fakeAsync(() => {
      let done = false;
      svc.hardDeleteBlob('blob-1').subscribe(() => (done = true));
      tick();

      const req = http.expectOne(`${TRASH}/blobs/blob-1`);
      expect(req.request.method).toBe('DELETE');
      req.flush(null, { status: 204, statusText: 'No Content' });
      tick();

      expect(done).toBeTrue();
    }));

    it('restoreFolder() POSTs to /trash/folders/:id/restore', fakeAsync(() => {
      let done = false;
      svc.restoreFolder('folder-1').subscribe(() => (done = true));
      tick();

      const req = http.expectOne(`${TRASH}/folders/folder-1/restore`);
      expect(req.request.method).toBe('POST');
      req.flush(null, { status: 204, statusText: 'No Content' });
      tick();

      expect(done).toBeTrue();
    }));

    it('hardDeleteFolder() DELETEs /trash/folders/:id', fakeAsync(() => {
      let done = false;
      svc.hardDeleteFolder('folder-1').subscribe(() => (done = true));
      tick();

      const req = http.expectOne(`${TRASH}/folders/folder-1`);
      expect(req.request.method).toBe('DELETE');
      req.flush(null, { status: 204, statusText: 'No Content' });
      tick();

      expect(done).toBeTrue();
    }));

    it('emptyTrash() DELETEs /trash', fakeAsync(() => {
      let done = false;
      svc.emptyTrash().subscribe(() => (done = true));
      tick();

      const req = http.expectOne(TRASH);
      expect(req.request.method).toBe('DELETE');
      req.flush(null, { status: 204, statusText: 'No Content' });
      tick();

      expect(done).toBeTrue();
    }));
  });

  // ─── URL encoding ─────────────────────────────────────────────────────────

  it('deleteFile() URL-encodes blob IDs containing special characters', fakeAsync(() => {
    svc.deleteFile('blob/with/slashes').subscribe();
    tick();
    const req = http.expectOne(`${STORAGE}/blobs/blob%2Fwith%2Fslashes`);
    expect(req.request.url).toContain('blob%2Fwith%2Fslashes');
    req.flush(null);
  }));

  it('deleteFolder() URL-encodes folder IDs', fakeAsync(() => {
    svc.deleteFolder('folder with spaces').subscribe();
    tick();
    const req = http.expectOne(`${STORAGE}/folders/folder%20with%20spaces`);
    expect(req.request.url).toContain('folder%20with%20spaces');
    req.flush(null);
  }));
});
