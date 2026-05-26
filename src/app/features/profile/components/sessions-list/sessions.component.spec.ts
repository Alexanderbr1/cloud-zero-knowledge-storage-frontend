import { TestBed, ComponentFixture } from '@angular/core/testing';
import { SessionsComponent } from './sessions.component';
import { DeviceSession } from '../../models/session.model';

const SESSION: DeviceSession = {
  id:             'sess-1',
  device_name:    'Chrome on Mac',
  ip_address:     '127.0.0.1',
  user_agent:     'Mozilla/5.0',
  created_at:     '2025-01-01T00:00:00Z',
  last_active_at: '2025-01-01T00:00:00Z',
  is_current:     true,
};

describe('SessionsComponent', () => {
  let fixture: ComponentFixture<SessionsComponent>;
  let comp:    SessionsComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SessionsComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(SessionsComponent);
    comp    = fixture.componentInstance;

    fixture.componentRef.setInput('sessions', [SESSION]);
    fixture.componentRef.setInput('isLoading', false);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(comp).toBeTruthy();
  });

  // ─── outputs ──────────────────────────────────────────────────────────────

  it('revokeSession() emits sessionRevoked with the session', () => {
    spyOn(comp.sessionRevoked, 'emit');
    comp.revokeSession(SESSION);
    expect(comp.sessionRevoked.emit).toHaveBeenCalledWith(SESSION);
  });

  it('revokeOthers() emits othersRevoked', () => {
    spyOn(comp.othersRevoked, 'emit');
    comp.revokeOthers();
    expect(comp.othersRevoked.emit).toHaveBeenCalled();
  });

  // ─── pluralSessions ───────────────────────────────────────────────────────

  it('pluralSessions(1) → "сессия"', () => {
    expect(comp.pluralSessions(1)).toBe('сессия');
  });

  it('pluralSessions(21) → "сессия" (ends in 1, not 11)', () => {
    expect(comp.pluralSessions(21)).toBe('сессия');
  });

  it('pluralSessions(2) → "сессии"', () => {
    expect(comp.pluralSessions(2)).toBe('сессии');
  });

  it('pluralSessions(3) → "сессии"', () => {
    expect(comp.pluralSessions(3)).toBe('сессии');
  });

  it('pluralSessions(4) → "сессии"', () => {
    expect(comp.pluralSessions(4)).toBe('сессии');
  });

  it('pluralSessions(5) → "сессий"', () => {
    expect(comp.pluralSessions(5)).toBe('сессий');
  });

  it('pluralSessions(11) → "сессий" (exception: 11)', () => {
    expect(comp.pluralSessions(11)).toBe('сессий');
  });

  it('pluralSessions(12) → "сессий" (exception: 12)', () => {
    expect(comp.pluralSessions(12)).toBe('сессий');
  });

  it('pluralSessions(0) → "сессий"', () => {
    expect(comp.pluralSessions(0)).toBe('сессий');
  });

  it('pluralSessions(100) → "сессий"', () => {
    expect(comp.pluralSessions(100)).toBe('сессий');
  });

  // ─── formatRelative ───────────────────────────────────────────────────────

  it('formatRelative: returns "только что" for <2 min ago', () => {
    const iso = new Date(Date.now() - 60_000).toISOString(); // 1 minute ago
    expect(comp.formatRelative(iso)).toBe('только что');
  });

  it('formatRelative: returns "N мин. назад" for 2-59 min ago', () => {
    const iso = new Date(Date.now() - 10 * 60_000).toISOString(); // 10 min ago
    expect(comp.formatRelative(iso)).toBe('10 мин. назад');
  });

  it('formatRelative: returns "N ч. назад" for 1-23 hrs ago', () => {
    const iso = new Date(Date.now() - 3 * 3_600_000).toISOString(); // 3 hours ago
    expect(comp.formatRelative(iso)).toBe('3 ч. назад');
  });

  it('formatRelative: returns "вчера" for exactly 1 day ago', () => {
    const iso = new Date(Date.now() - 25 * 3_600_000).toISOString(); // 25 hours ago
    expect(comp.formatRelative(iso)).toBe('вчера');
  });

  it('formatRelative: returns "N дн. назад" for 2-29 days ago', () => {
    const iso = new Date(Date.now() - 5 * 86_400_000).toISOString(); // 5 days ago
    expect(comp.formatRelative(iso)).toBe('5 дн. назад');
  });

  it('formatRelative: returns a short date for ≥30 days ago', () => {
    const old = new Date('2020-01-15T00:00:00Z');
    const result = comp.formatRelative(old.toISOString());
    // Should be a localized date string, not a relative label
    expect(result).not.toContain('назад');
    expect(result).not.toContain('вчера');
    expect(result.length).toBeGreaterThan(0);
  });
});
