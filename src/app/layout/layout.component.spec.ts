import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';

import { LayoutComponent } from './layout.component';
import { AuthService } from '../core/services/auth.service';
import { StorageUsageService } from '../core/services/storage-usage.service';

// ─── stubs ───────────────────────────────────────────────────────────────────

function makeAuthStub(email: string | null = 'alice@example.com') {
  const emailSig = () => email;
  return {
    email:          emailSig,
    logout:         jasmine.createSpy('logout'),
    recoveryPhrase: () => null,
  };
}

function makeUsageStub() {
  return {
    usage:   () => null,
    pct:     () => 0,
    refresh: jasmine.createSpy('refresh'),
  };
}

// ─────────────────────────────────────────────────────────────────────────────

describe('LayoutComponent', () => {
  let fixture: ComponentFixture<LayoutComponent>;
  let comp:    LayoutComponent;
  let authStub: ReturnType<typeof makeAuthStub>;
  let usageStub: ReturnType<typeof makeUsageStub>;

  async function setup(email: string | null = 'alice@example.com') {
    authStub  = makeAuthStub(email);
    usageStub = makeUsageStub();

    await TestBed.configureTestingModule({
      imports: [LayoutComponent],
      providers: [
        provideRouter([{ path: '**', redirectTo: '' }]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService,         useValue: authStub  },
        { provide: StorageUsageService, useValue: usageStub },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LayoutComponent);
    comp    = fixture.componentInstance;
    fixture.detectChanges();
  }

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  // ─── userInitial / userEmail ───────────────────────────────────────────────

  it('userInitial() is the first letter of email, uppercased', async () => {
    await setup('alice@example.com');
    expect(comp.userInitial()).toBe('A');
  });

  it('userInitial() is "?" when email is null', async () => {
    await setup(null);
    expect(comp.userInitial()).toBe('?');
  });

  it('userEmail() returns the email string', async () => {
    await setup('bob@example.com');
    expect(comp.userEmail()).toBe('bob@example.com');
  });

  it('userEmail() returns empty string when email is null', async () => {
    await setup(null);
    expect(comp.userEmail()).toBe('');
  });

  // ─── ngOnInit ─────────────────────────────────────────────────────────────

  it('ngOnInit() calls usageSvc.refresh()', async () => {
    await setup();
    expect(usageStub.refresh).toHaveBeenCalled();
  });

  // ─── toggleMenu / closeMenu ───────────────────────────────────────────────

  it('isMenuOpen is false initially', async () => {
    await setup();
    expect(comp.isMenuOpen()).toBeFalse();
  });

  it('toggleMenu() opens the menu', async () => {
    await setup();
    comp.toggleMenu();
    expect(comp.isMenuOpen()).toBeTrue();
  });

  it('toggleMenu() toggles menu closed when already open', async () => {
    await setup();
    comp.toggleMenu();
    comp.toggleMenu();
    expect(comp.isMenuOpen()).toBeFalse();
  });

  it('closeMenu() closes the menu', async () => {
    await setup();
    comp.toggleMenu(); // open it
    comp.closeMenu();
    expect(comp.isMenuOpen()).toBeFalse();
  });

  // ─── toggleUserMenu ───────────────────────────────────────────────────────

  it('isUserMenuOpen is false initially', async () => {
    await setup();
    expect(comp.isUserMenuOpen()).toBeFalse();
  });

  it('toggleUserMenu() opens the user menu', async () => {
    await setup();
    const event = new MouseEvent('click');
    spyOn(event, 'stopPropagation');
    comp.toggleUserMenu(event);
    expect(comp.isUserMenuOpen()).toBeTrue();
    expect(event.stopPropagation).toHaveBeenCalled();
  });

  // ─── Escape ───────────────────────────────────────────────────────────────

  it('Escape key closes menu and user-menu', async () => {
    await setup();
    comp.toggleMenu();
    const event = new MouseEvent('click');
    comp.toggleUserMenu(event);

    comp.onEscape();

    expect(comp.isMenuOpen()).toBeFalse();
    expect(comp.isUserMenuOpen()).toBeFalse();
  });

  // ─── document click closes user menu ─────────────────────────────────────

  it('document:click closes isUserMenuOpen', async () => {
    await setup();
    const event = new MouseEvent('click');
    comp.toggleUserMenu(event);
    expect(comp.isUserMenuOpen()).toBeTrue();

    comp.onDocClick();
    expect(comp.isUserMenuOpen()).toBeFalse();
  });

  // ─── logout ───────────────────────────────────────────────────────────────

  it('logout() calls auth.logout()', async () => {
    await setup();
    comp.logout();
    expect(authStub.logout).toHaveBeenCalled();
  });
});
