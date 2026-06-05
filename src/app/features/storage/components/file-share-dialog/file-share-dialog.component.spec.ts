import { TestBed, ComponentFixture, fakeAsync, tick } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Subject, of, throwError } from 'rxjs';

import { FileShareDialogComponent } from './file-share-dialog.component';
import { SharingService, ShareItem } from '../../../../core/services/sharing.service';
import { AuthService } from '../../../../core/services/auth.service';
import { ToastService } from '../../../../core/services/toast.service';
import { FileItem } from '../../models/file-item.model';

// ─── test data ────────────────────────────────────────────────────────────────

const TEST_FILE: FileItem = {
  blob_id:            'blob-abc',
  folder_id:          null,
  file_name:          'report.pdf',
  content_type:       'application/pdf',
  file_size:          1024,
  file_size_plain:    1024,
  chunk_size:         1024,
  created_at:         '2025-01-01T00:00:00Z',
  encrypted_file_key: 'efk==',
};

const SHARE_A: ShareItem = {
  share_id:       'share-1',
  blob_id:        'blob-abc',
  owner_id:       'user-1',
  owner_email:    'alice@example.com',
  recipient_email: 'bob@example.com',
  file_name:      'report.pdf',
  content_type:   'application/pdf',
  ephemeral_pub:  'epk==',
  wrapped_file_key: 'wfk==',
  created_at:     '2025-01-01T00:00:00Z',
};

const SHARE_B: ShareItem = {
  ...SHARE_A,
  share_id:       'share-2',
  recipient_email: 'carol@example.com',
};

// ─── setup ────────────────────────────────────────────────────────────────────

describe('FileShareDialogComponent', () => {
  let fixture:    ComponentFixture<FileShareDialogComponent>;
  let comp:       FileShareDialogComponent;
  let sharingSpy: jasmine.SpyObj<SharingService>;
  let authSpy:    jasmine.SpyObj<AuthService>;
  let toastSpy:   jasmine.SpyObj<ToastService>;

  async function setup(listResult: ShareItem[] = [SHARE_A, SHARE_B]) {
    sharingSpy = jasmine.createSpyObj('SharingService', [
      'listMyShares', 'getRecipientPublicKey', 'shareFileWithUser', 'revokeShare',
    ]);
    authSpy  = jasmine.createSpyObj('AuthService', ['clearAccess']);
    toastSpy = jasmine.createSpyObj('ToastService', ['error', 'success']);

    sharingSpy.listMyShares.and.returnValue(of({ items: listResult }));

    await TestBed.configureTestingModule({
      imports: [FileShareDialogComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: SharingService, useValue: sharingSpy },
        { provide: AuthService,    useValue: authSpy    },
        { provide: ToastService,   useValue: toastSpy   },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FileShareDialogComponent);
    comp    = fixture.componentInstance;
    fixture.componentRef.setInput('file', TEST_FILE);
    fixture.detectChanges();
  }

  // ─── loadShares on init ────────────────────────────────────────────────────

  it('loads shares on init and populates shares signal', fakeAsync(async () => {
    await setup([SHARE_A, SHARE_B]);
    tick();

    expect(sharingSpy.listMyShares).toHaveBeenCalledWith('blob-abc');
    expect(comp.shares()).toEqual([SHARE_A, SHARE_B]);
    expect(comp.isLoadingShares()).toBeFalse();
  }));

  it('sets shareError when listMyShares fails', fakeAsync(async () => {
    await setup();
    sharingSpy.listMyShares.and.returnValue(throwError(() => new Error('network')));
    comp['loadShares']();
    tick();

    expect(comp.shareError().length).toBeGreaterThan(0);
    expect(comp.isLoadingShares()).toBeFalse();
  }));

  it('hasShares is true when shares list is non-empty', fakeAsync(async () => {
    await setup([SHARE_A]);
    tick();
    expect(comp.hasShares()).toBeTrue();
  }));

  it('hasShares is false when shares list is empty', fakeAsync(async () => {
    await setup([]);
    tick();
    expect(comp.hasShares()).toBeFalse();
  }));

  // ─── submit — guard: empty email ──────────────────────────────────────────

  it('submit() does nothing when email is empty', fakeAsync(async () => {
    await setup();
    tick();

    comp.shareEmail.set('');
    comp.submit();
    tick();

    expect(sharingSpy.getRecipientPublicKey).not.toHaveBeenCalled();
  }));

  it('submit() does nothing when email is whitespace only', fakeAsync(async () => {
    await setup();
    tick();

    comp.shareEmail.set('   ');
    comp.submit();
    tick();

    expect(sharingSpy.getRecipientPublicKey).not.toHaveBeenCalled();
  }));

  // ─── submit — 404 → user not found ───────────────────────────────────────

  it('submit() sets "not found" error on 404', fakeAsync(async () => {
    await setup();
    tick();

    sharingSpy.getRecipientPublicKey.and.returnValue(
      throwError(() => new HttpErrorResponse({ status: 404 })),
    );

    comp.shareEmail.set('unknown@example.com');
    comp.submit();
    tick();

    expect(comp.shareError()).toContain('не найден');
    expect(comp.isSharing()).toBeFalse();
  }));

  // ─── submit — 409 → already shared ───────────────────────────────────────

  it('submit() sets "already shared" error on 409', fakeAsync(async () => {
    await setup();
    tick();

    sharingSpy.getRecipientPublicKey.and.returnValue(
      throwError(() => new HttpErrorResponse({ status: 409 })),
    );

    comp.shareEmail.set('bob@example.com');
    comp.submit();
    tick();

    expect(comp.shareError()).toContain('уже открыли');
    expect(comp.isSharing()).toBeFalse();
  }));

  // ─── submit — 400 → sharing with self ────────────────────────────────────

  it('submit() sets "self-share" error on 400', fakeAsync(async () => {
    await setup();
    tick();

    sharingSpy.getRecipientPublicKey.and.returnValue(
      throwError(() => new HttpErrorResponse({ status: 400 })),
    );

    comp.shareEmail.set('alice@example.com');
    comp.submit();
    tick();

    expect(comp.shareError()).toContain('самому себе');
    expect(comp.isSharing()).toBeFalse();
  }));

  // ─── submit — 429 → rate limited ─────────────────────────────────────────

  it('submit() sets rate-limit error on 429', fakeAsync(async () => {
    await setup();
    tick();

    sharingSpy.getRecipientPublicKey.and.returnValue(
      throwError(() => new HttpErrorResponse({ status: 429 })),
    );

    comp.shareEmail.set('bob@example.com');
    comp.submit();
    tick();

    expect(comp.shareError()).toContain('Слишком много');
    expect(comp.isSharing()).toBeFalse();
  }));

  // ─── submit — KEK error → clearAccess + toast + close ────────────────────

  it('submit() clears access, shows toast, and closes dialog on KEK error', fakeAsync(async () => {
    await setup();
    tick();

    spyOn(comp.closed, 'emit');
    sharingSpy.getRecipientPublicKey.and.returnValue(
      throwError(() => new Error('KEK not available')),
    );

    comp.shareEmail.set('eve@example.com');
    comp.submit();
    tick();

    expect(authSpy.clearAccess).toHaveBeenCalled();
    expect(toastSpy.error).toHaveBeenCalled();
    expect(comp.closed.emit).toHaveBeenCalled();
  }));

  // ─── submit — success ─────────────────────────────────────────────────────

  it('submit() calls shareFileWithUser and reloads shares on success', fakeAsync(async () => {
    await setup([]);
    tick();

    sharingSpy.getRecipientPublicKey.and.returnValue(of('recipient-pub-key'));
    sharingSpy.shareFileWithUser.and.returnValue(of(SHARE_A));
    // After successful share, listMyShares is called again
    sharingSpy.listMyShares.and.returnValue(of({ items: [SHARE_A] }));

    comp.shareEmail.set('bob@example.com');
    comp.submit();
    tick();

    expect(sharingSpy.shareFileWithUser).toHaveBeenCalledWith(
      'blob-abc', 'efk==', 'bob@example.com', 'recipient-pub-key', undefined,
    );
    // Email field is cleared after success
    expect(comp.shareEmail()).toBe('');
    expect(comp.isSharing()).toBeFalse();
    // listMyShares was called twice: once in ngOnInit, once after success
    expect(sharingSpy.listMyShares).toHaveBeenCalledTimes(2);
  }));

  // ─── submit — non-HTTP, non-KEK error ────────────────────────────────────

  it('submit() sets generic error for unknown error type', fakeAsync(async () => {
    await setup();
    tick();

    sharingSpy.getRecipientPublicKey.and.returnValue(
      throwError(() => new Error('unknown error')),
    );

    comp.shareEmail.set('bob@example.com');
    comp.submit();
    tick();

    // Non-KEK errors without 'KEK' prefix → generic message
    expect(comp.shareError().length).toBeGreaterThan(0);
    expect(comp.isSharing()).toBeFalse();
  }));

  // ─── revoke — success ─────────────────────────────────────────────────────

  it('revoke() removes the share from the list on success', fakeAsync(async () => {
    await setup([SHARE_A, SHARE_B]);
    tick();

    sharingSpy.revokeShare.and.returnValue(of(undefined));

    comp.revoke('share-2');
    tick();

    expect(sharingSpy.revokeShare).toHaveBeenCalledWith('share-2');
    expect(comp.shares().find(s => s.share_id === 'share-2')).toBeUndefined();
    expect(comp.shares().length).toBe(1);
    expect(comp.revokingId()).toBeNull();
  }));

  // ─── revoke — error ───────────────────────────────────────────────────────

  it('revoke() sets shareError on failure', fakeAsync(async () => {
    await setup([SHARE_A]);
    tick();

    sharingSpy.revokeShare.and.returnValue(throwError(() => new Error('network')));

    comp.revoke('share-1');
    tick();

    expect(comp.shareError()).toContain('отозвать');
    expect(comp.revokingId()).toBeNull();
  }));

  // ─── revokingId while in flight ───────────────────────────────────────────

  it('revokingId is set to the share id while revocation is in flight', fakeAsync(async () => {
    await setup([SHARE_A]);  // setup itself is async
    tick();

    const subject = new Subject<void>();
    sharingSpy.revokeShare.and.returnValue(subject.asObservable());

    comp.revoke('share-1');
    // Before observable completes, revokingId should be set
    expect(comp.revokingId()).toBe('share-1');

    subject.next();
    subject.complete();
    tick();

    expect(comp.revokingId()).toBeNull();
  }));

  // ─── utility methods ──────────────────────────────────────────────────────

  it('close() emits closed event', fakeAsync(async () => {
    await setup();
    tick();

    spyOn(comp.closed, 'emit');
    comp.close();
    expect(comp.closed.emit).toHaveBeenCalled();
  }));

  it('clearExpiry() resets the expiresAt signal', fakeAsync(async () => {
    await setup();
    tick();

    comp.expiresAt.set('2025-12-31');
    comp.clearExpiry();
    expect(comp.expiresAt()).toBe('');
  }));
});
