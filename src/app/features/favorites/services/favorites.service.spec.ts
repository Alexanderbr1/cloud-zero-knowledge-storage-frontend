import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';

import { FavoritesService } from './favorites.service';
import { environment } from '../../../../environments/environment';

const BASE = `${environment.apiBaseUrl}/favorites`;

const BLOB: import('../../storage/models/file-item.model').FileItem = {
  blob_id: 'blob-1',
  folder_id: null,
  file_name: 'photo.jpg',
  content_type: 'image/jpeg',
  file_size: 1024,
  file_size_plain: 1024,
  chunk_size: 1024,
  created_at: '2025-01-01T00:00:00Z',
  encrypted_file_key: 'key==',
};

const FOLDER: import('../../storage/models/folder.model').FolderItem = {
  folder_id: 'folder-1',
  parent_id: null,
  name: 'Docs',
  created_at: '2025-01-01T00:00:00Z',
};

describe('FavoritesService', () => {
  let svc: FavoritesService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    svc  = TestBed.inject(FavoritesService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  // ─── list ─────────────────────────────────────────────────────────────────

  it('list() GETs /favorites', fakeAsync(() => {
    let result: unknown;
    svc.list().subscribe(r => (result = r));
    tick();

    const req = http.expectOne(BASE);
    expect(req.request.method).toBe('GET');
    req.flush({ blobs: [BLOB], folders: [FOLDER] });
    tick();

    expect(result).toEqual({ blobs: [BLOB], folders: [FOLDER] });
  }));

  it('list() returns empty arrays when response has no items', fakeAsync(() => {
    let result: unknown;
    svc.list().subscribe(r => (result = r));
    tick();
    http.expectOne(BASE).flush({ blobs: [], folders: [] });
    tick();

    expect(result).toEqual({ blobs: [], folders: [] });
  }));

  // ─── addBlob ──────────────────────────────────────────────────────────────

  it('addBlob() POSTs to /favorites/blobs/:id', fakeAsync(() => {
    let done = false;
    svc.addBlob('blob-abc').subscribe(() => (done = true));
    tick();

    const req = http.expectOne(`${BASE}/blobs/blob-abc`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({});
    req.flush(null, { status: 204, statusText: 'No Content' });
    tick();

    expect(done).toBeTrue();
  }));

  it('addBlob() URL-encodes the blobId', fakeAsync(() => {
    svc.addBlob('blob with spaces').subscribe();
    tick();
    const req = http.expectOne(`${BASE}/blobs/blob%20with%20spaces`);
    expect(req.request.url).toContain('blob%20with%20spaces');
    req.flush(null);
  }));

  // ─── removeBlob ───────────────────────────────────────────────────────────

  it('removeBlob() DELETEs /favorites/blobs/:id', fakeAsync(() => {
    let done = false;
    svc.removeBlob('blob-xyz').subscribe(() => (done = true));
    tick();

    const req = http.expectOne(`${BASE}/blobs/blob-xyz`);
    expect(req.request.method).toBe('DELETE');
    req.flush(null, { status: 204, statusText: 'No Content' });
    tick();

    expect(done).toBeTrue();
  }));

  // ─── addFolder ────────────────────────────────────────────────────────────

  it('addFolder() POSTs to /favorites/folders/:id', fakeAsync(() => {
    let done = false;
    svc.addFolder('folder-1').subscribe(() => (done = true));
    tick();

    const req = http.expectOne(`${BASE}/folders/folder-1`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({});
    req.flush(null, { status: 204, statusText: 'No Content' });
    tick();

    expect(done).toBeTrue();
  }));

  it('addFolder() URL-encodes the folderId', fakeAsync(() => {
    svc.addFolder('folder/with/slashes').subscribe();
    tick();
    const req = http.expectOne(`${BASE}/folders/folder%2Fwith%2Fslashes`);
    expect(req.request.url).toContain('folder%2Fwith%2Fslashes');
    req.flush(null);
  }));

  // ─── removeFolder ─────────────────────────────────────────────────────────

  it('removeFolder() DELETEs /favorites/folders/:id', fakeAsync(() => {
    let done = false;
    svc.removeFolder('folder-99').subscribe(() => (done = true));
    tick();

    const req = http.expectOne(`${BASE}/folders/folder-99`);
    expect(req.request.method).toBe('DELETE');
    req.flush(null, { status: 204, statusText: 'No Content' });
    tick();

    expect(done).toBeTrue();
  }));
});
