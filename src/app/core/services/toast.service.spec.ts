import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { ToastService } from './toast.service';

describe('ToastService', () => {
  let svc: ToastService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    svc = TestBed.inject(ToastService);
  });

  // ─── success / error ─────────────────────────────────────────────────────

  it('success() adds a toast with type "success"', () => {
    svc.success('Upload complete');
    const toasts = svc.toasts();
    expect(toasts.length).toBe(1);
    expect(toasts[0]!.type).toBe('success');
    expect(toasts[0]!.message).toBe('Upload complete');
    expect(toasts[0]!.leaving).toBeFalse();
  });

  it('error() adds a toast with type "error"', () => {
    svc.error('Something went wrong');
    const toasts = svc.toasts();
    expect(toasts.length).toBe(1);
    expect(toasts[0]!.type).toBe('error');
    expect(toasts[0]!.message).toBe('Something went wrong');
  });

  it('each toast gets a unique incrementing id', () => {
    svc.success('first');
    svc.error('second');
    const [t1, t2] = svc.toasts();
    expect(t1!.id).not.toBe(t2!.id);
    expect(t2!.id).toBeGreaterThan(t1!.id);
  });

  it('multiple toasts stack in order', () => {
    svc.success('a');
    svc.success('b');
    svc.error('c');
    const messages = svc.toasts().map(t => t.message);
    expect(messages).toEqual(['a', 'b', 'c']);
  });

  // ─── dismiss ──────────────────────────────────────────────────────────────

  it('dismiss() marks the toast as leaving immediately', () => {
    svc.success('msg');
    const id = svc.toasts()[0]!.id;
    svc.dismiss(id);
    const toast = svc.toasts().find(t => t.id === id);
    expect(toast).toBeTruthy();
    expect(toast!.leaving).toBeTrue();
  });

  it('dismiss() removes the toast after LEAVE_DURATION (280 ms)', fakeAsync(() => {
    svc.success('msg');
    const id = svc.toasts()[0]!.id;
    svc.dismiss(id);
    expect(svc.toasts().some(t => t.id === id)).toBeTrue(); // still visible
    tick(280);
    expect(svc.toasts().some(t => t.id === id)).toBeFalse(); // gone
  }));

  it('dismiss() on unknown id is a no-op', () => {
    svc.success('keep me');
    expect(() => svc.dismiss(9999)).not.toThrow();
    expect(svc.toasts().length).toBe(1);
  });

  // ─── auto-dismiss ─────────────────────────────────────────────────────────

  it('success toast auto-dismisses after 4 000 ms by default', fakeAsync(() => {
    svc.success('auto');
    const id = svc.toasts()[0]!.id;

    tick(3999);
    expect(svc.toasts().some(t => t.id === id)).toBeTrue();

    tick(1); // reaches 4 000 ms — dismiss fires, marks leaving
    expect(svc.toasts().find(t => t.id === id)?.leaving).toBeTrue();

    tick(280); // animation completes
    expect(svc.toasts().some(t => t.id === id)).toBeFalse();
  }));

  it('error toast auto-dismisses after 5 000 ms by default', fakeAsync(() => {
    svc.error('error-auto');
    const id = svc.toasts()[0]!.id;

    tick(4999);
    expect(svc.toasts().some(t => t.id === id)).toBeTrue();

    tick(1); // reaches 5 000 ms
    expect(svc.toasts().find(t => t.id === id)?.leaving).toBeTrue();

    tick(280);
    expect(svc.toasts().some(t => t.id === id)).toBeFalse();
  }));

  it('manual dismiss() cancels the auto-dismiss timer', fakeAsync(() => {
    svc.success('manual');
    const id = svc.toasts()[0]!.id;

    tick(1000); // well before auto-dismiss
    svc.dismiss(id);
    tick(280);
    expect(svc.toasts().some(t => t.id === id)).toBeFalse();

    // Advance past the original 4 000 ms — should not cause double-dismiss or errors.
    expect(() => tick(3000)).not.toThrow();
    expect(svc.toasts().length).toBe(0);
  }));

  // ─── custom duration ──────────────────────────────────────────────────────

  it('respects a custom duration', fakeAsync(() => {
    svc.success('quick', 500);
    const id = svc.toasts()[0]!.id;

    tick(499);
    expect(svc.toasts().some(t => t.id === id)).toBeTrue();

    tick(1);
    expect(svc.toasts().find(t => t.id === id)?.leaving).toBeTrue();

    tick(280);
    expect(svc.toasts().some(t => t.id === id)).toBeFalse();
  }));
});
