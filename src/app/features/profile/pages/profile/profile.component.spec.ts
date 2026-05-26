import { TestBed, ComponentFixture, fakeAsync, tick } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { of, throwError } from 'rxjs';

import { ProfileComponent } from './profile.component';
import { AuthService } from '../../../../core/services/auth.service';
import { SessionsService } from '../../services/sessions.service';
import { DeviceSession } from '../../models/session.model';

const SESSION_A: DeviceSession = {
  id: 'sess-1', device_name: 'Chrome',  ip_address: '127.0.0.1',
  user_agent: 'Mozilla/5.0', created_at: '', last_active_at: '', is_current: true,
};
const SESSION_B: DeviceSession = {
  id: 'sess-2', device_name: 'Firefox', ip_address: '10.0.0.1',
  user_agent: 'Mozilla/5.0', created_at: '', last_active_at: '', is_current: false,
};

describe('ProfileComponent', () => {
  let fixture:      ComponentFixture<ProfileComponent>;
  let comp:         ProfileComponent;
  let authStub:     { email: () => string | null };
  let sessionsStub: jasmine.SpyObj<SessionsService>;

  async function setup(email: string | null = 'alice@example.com') {
    authStub     = { email: () => email };
    sessionsStub = jasmine.createSpyObj('SessionsService', ['list', 'revoke', 'revokeOthers']);
    sessionsStub.list.and.returnValue(of([SESSION_A, SESSION_B]));
    sessionsStub.revoke.and.returnValue(of(undefined));
    sessionsStub.revokeOthers.and.returnValue(of(undefined));

    await TestBed.configureTestingModule({
      imports:   [ProfileComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService,     useValue: authStub     },
        { provide: SessionsService, useValue: sessionsStub },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ProfileComponent);
    comp    = fixture.componentInstance;
  }

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  // ─── computed ─────────────────────────────────────────────────────────────

  it('email computed returns auth email', fakeAsync(async () => {
    await setup('bob@example.com');
    fixture.detectChanges();
    tick();
    expect(comp.email()).toBe('bob@example.com');
  }));

  it('email computed returns "—" when auth email is null', fakeAsync(async () => {
    await setup(null);
    fixture.detectChanges();
    tick();
    expect(comp.email()).toBe('—');
  }));

  it('userInitial is first letter of email uppercased', fakeAsync(async () => {
    await setup('carol@example.com');
    fixture.detectChanges();
    tick();
    expect(comp.userInitial()).toBe('C');
  }));

  it('userInitial is "?" when email is null', fakeAsync(async () => {
    await setup(null);
    fixture.detectChanges();
    tick();
    expect(comp.userInitial()).toBe('?');
  }));

  // ─── ngOnInit — loadSessions ──────────────────────────────────────────────

  it('loads sessions on init', fakeAsync(async () => {
    await setup();
    fixture.detectChanges();
    tick();

    expect(sessionsStub.list).toHaveBeenCalled();
    expect(comp.sessions()).toEqual([SESSION_A, SESSION_B]);
    expect(comp.isLoading()).toBeFalse();
  }));

  it('sets errorMessage when list() fails', fakeAsync(async () => {
    await setup();
    sessionsStub.list.and.returnValue(throwError(() => new Error('fail')));
    fixture.detectChanges();
    tick();

    expect(comp.errorMessage().length).toBeGreaterThan(0);
    expect(comp.isLoading()).toBeFalse();
  }));

  // ─── onRevokeSession ──────────────────────────────────────────────────────

  it('onRevokeSession() removes the session from the list on success', fakeAsync(async () => {
    await setup();
    fixture.detectChanges();
    tick();

    comp.onRevokeSession(SESSION_B);
    tick();

    expect(sessionsStub.revoke).toHaveBeenCalledWith('sess-2');
    expect(comp.sessions().find(s => s.id === 'sess-2')).toBeUndefined();
    expect(comp.revoking()).toBeNull();
  }));

  it('onRevokeSession() sets errorMessage on failure', fakeAsync(async () => {
    await setup();
    sessionsStub.revoke.and.returnValue(throwError(() => new Error('fail')));
    fixture.detectChanges();
    tick();

    comp.onRevokeSession(SESSION_A);
    tick();

    expect(comp.errorMessage().length).toBeGreaterThan(0);
    expect(comp.revoking()).toBeNull();
  }));

  // ─── onRevokeOthers ───────────────────────────────────────────────────────

  it('onRevokeOthers() calls revokeOthers and keeps only is_current sessions', fakeAsync(async () => {
    await setup();
    fixture.detectChanges();
    tick();
    // Initially: SESSION_A (is_current=true) + SESSION_B (is_current=false)
    expect(comp.sessions().length).toBe(2);

    comp.onRevokeOthers();
    tick();

    expect(sessionsStub.revokeOthers).toHaveBeenCalled();
    // Only the current session should remain
    expect(comp.sessions()).toEqual([SESSION_A]);
    expect(comp.revoking()).toBeNull();
  }));
});
