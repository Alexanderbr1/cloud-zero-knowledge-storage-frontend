import { TestBed, ComponentFixture, fakeAsync, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';

import { FavoritesComponent } from './favorites.component';
import { FavoritesService } from '../../services/favorites.service';
import { FilesService } from '../../../storage/services/files.service';
import { ToastService } from '../../../../core/services/toast.service';
import { FileItem } from '../../../storage/models/file-item.model';
import { FolderItem } from '../../../storage/models/folder.model';

const FILE: FileItem = {
  blob_id: 'blob-1', folder_id: null, file_name: 'photo.jpg',
  content_type: 'image/jpeg', file_size: 1024,
  created_at: '2025-01-01T00:00:00Z', encrypted_file_key: 'key==',
};

const FOLDER: FolderItem = {
  folder_id: 'folder-1', parent_id: null, name: 'Docs', created_at: '2025-01-01T00:00:00Z',
};

describe('FavoritesComponent', () => {
  let fixture:        ComponentFixture<FavoritesComponent>;
  let comp:           FavoritesComponent;
  let favStub:        jasmine.SpyObj<FavoritesService>;
  let filesStub:      jasmine.SpyObj<FilesService>;
  let toastStub:      jasmine.SpyObj<ToastService>;

  beforeEach(async () => {
    favStub   = jasmine.createSpyObj('FavoritesService', ['list', 'removeBlob', 'removeFolder']);
    filesStub = jasmine.createSpyObj('FilesService', ['downloadFile']);
    toastStub = jasmine.createSpyObj('ToastService', ['success', 'error']);

    favStub.list.and.returnValue(of({ blobs: [FILE], folders: [FOLDER] }));
    favStub.removeBlob.and.returnValue(of(undefined));
    favStub.removeFolder.and.returnValue(of(undefined));
    filesStub.downloadFile.and.returnValue(of(undefined));

    await TestBed.configureTestingModule({
      imports:   [FavoritesComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: FavoritesService, useValue: favStub   },
        { provide: FilesService,     useValue: filesStub },
        { provide: ToastService,     useValue: toastStub },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FavoritesComponent);
    comp    = fixture.componentInstance;
  });

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  // ─── ngOnInit ─────────────────────────────────────────────────────────────

  it('loads favorites on init and populates blobs/folders', fakeAsync(() => {
    fixture.detectChanges();
    tick();

    expect(favStub.list).toHaveBeenCalled();
    expect(comp.blobs()).toEqual([FILE]);
    expect(comp.folders()).toEqual([FOLDER]);
    expect(comp.loading()).toBeFalse();
    expect(comp.error()).toBeNull();
  }));

  it('sets error signal when list() fails', fakeAsync(() => {
    favStub.list.and.returnValue(throwError(() => new Error('server error')));
    fixture.detectChanges();
    tick();

    expect(comp.error()).toBeTruthy();
    expect(comp.loading()).toBeFalse();
  }));

  // ─── unstarBlob ───────────────────────────────────────────────────────────

  it('unstarBlob() calls removeBlob and removes the file from list', fakeAsync(() => {
    fixture.detectChanges();
    tick();

    comp.unstarBlob(FILE);
    tick();

    expect(favStub.removeBlob).toHaveBeenCalledWith('blob-1');
    expect(comp.blobs().find(b => b.blob_id === 'blob-1')).toBeUndefined();
    expect(toastStub.success).toHaveBeenCalled();
  }));

  it('unstarBlob() calls toast.error on failure', fakeAsync(() => {
    favStub.removeBlob.and.returnValue(throwError(() => new Error('fail')));
    fixture.detectChanges();
    tick();

    comp.unstarBlob(FILE);
    tick();

    expect(toastStub.error).toHaveBeenCalled();
    // File remains in list
    expect(comp.blobs().find(b => b.blob_id === 'blob-1')).toBeTruthy();
  }));

  // ─── unstarFolder ─────────────────────────────────────────────────────────

  it('unstarFolder() calls removeFolder and removes the folder from list', fakeAsync(() => {
    fixture.detectChanges();
    tick();

    comp.unstarFolder(FOLDER);
    tick();

    expect(favStub.removeFolder).toHaveBeenCalledWith('folder-1');
    expect(comp.folders().find(f => f.folder_id === 'folder-1')).toBeUndefined();
    expect(toastStub.success).toHaveBeenCalled();
  }));

  it('unstarFolder() calls toast.error on failure', fakeAsync(() => {
    favStub.removeFolder.and.returnValue(throwError(() => new Error('fail')));
    fixture.detectChanges();
    tick();

    comp.unstarFolder(FOLDER);
    tick();

    expect(toastStub.error).toHaveBeenCalled();
  }));

  // ─── download ─────────────────────────────────────────────────────────────

  it('download() calls filesService.downloadFile', fakeAsync(() => {
    fixture.detectChanges();
    tick();

    comp.download(FILE);
    tick();

    expect(filesStub.downloadFile).toHaveBeenCalledWith('blob-1', 'photo.jpg');
  }));

  it('download() shows toast error on failure', fakeAsync(() => {
    filesStub.downloadFile.and.returnValue(throwError(() => new Error('download failed')));
    fixture.detectChanges();
    tick();

    comp.download(FILE);
    tick();

    expect(toastStub.error).toHaveBeenCalled();
  }));
});
