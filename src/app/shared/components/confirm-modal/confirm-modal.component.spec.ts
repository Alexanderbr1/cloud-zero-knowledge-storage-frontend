import { TestBed, ComponentFixture } from '@angular/core/testing';
import { ConfirmModalComponent } from './confirm-modal.component';

describe('ConfirmModalComponent', () => {
  let fixture: ComponentFixture<ConfirmModalComponent>;
  let comp:    ConfirmModalComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ConfirmModalComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(ConfirmModalComponent);
    comp    = fixture.componentInstance;

    fixture.componentRef.setInput('title', 'Удалить файл?');
    fixture.detectChanges();
  });

  // ─── inputs ───────────────────────────────────────────────────────────────

  it('should create', () => {
    expect(comp).toBeTruthy();
  });

  it('confirmLabel defaults to "Удалить"', () => {
    expect(comp.confirmLabel()).toBe('Удалить');
  });

  it('loading defaults to false', () => {
    expect(comp.loading()).toBeFalse();
  });

  // ─── outputs ──────────────────────────────────────────────────────────────

  it('emits confirmed when confirmed output is triggered', () => {
    spyOn(comp.confirmed, 'emit');
    comp.confirmed.emit();
    expect(comp.confirmed.emit).toHaveBeenCalled();
  });

  it('emits cancelled when cancelled output is triggered', () => {
    spyOn(comp.cancelled, 'emit');
    comp.cancelled.emit();
    expect(comp.cancelled.emit).toHaveBeenCalled();
  });

  // ─── Escape key ───────────────────────────────────────────────────────────

  it('onEscape() emits cancelled when not loading', () => {
    spyOn(comp.cancelled, 'emit');
    fixture.componentRef.setInput('loading', false);
    fixture.detectChanges();

    comp.onEscape();

    expect(comp.cancelled.emit).toHaveBeenCalled();
  });

  it('onEscape() does NOT emit cancelled when loading', () => {
    spyOn(comp.cancelled, 'emit');
    fixture.componentRef.setInput('loading', true);
    fixture.detectChanges();

    comp.onEscape();

    expect(comp.cancelled.emit).not.toHaveBeenCalled();
  });

  it('pressing Escape dispatches onEscape via HostListener', () => {
    spyOn(comp, 'onEscape');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(comp.onEscape).toHaveBeenCalled();
  });
});
