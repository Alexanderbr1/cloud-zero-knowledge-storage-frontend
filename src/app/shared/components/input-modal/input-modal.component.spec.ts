import { TestBed, ComponentFixture } from '@angular/core/testing';
import { InputModalComponent } from './input-modal.component';

describe('InputModalComponent', () => {
  let fixture: ComponentFixture<InputModalComponent>;
  let comp:    InputModalComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InputModalComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(InputModalComponent);
    comp    = fixture.componentInstance;

    fixture.componentRef.setInput('title', 'Введите имя');
    fixture.componentRef.setInput('value', '');
    fixture.detectChanges();
  });

  // ─── defaults ─────────────────────────────────────────────────────────────

  it('should create', () => {
    expect(comp).toBeTruthy();
  });

  it('confirmLabel defaults to "Подтвердить"', () => {
    expect(comp.confirmLabel()).toBe('Подтвердить');
  });

  it('placeholder defaults to empty string', () => {
    expect(comp.placeholder()).toBe('');
  });

  it('loading defaults to false', () => {
    expect(comp.loading()).toBeFalse();
  });

  it('error defaults to empty string', () => {
    expect(comp.error()).toBe('');
  });

  // ─── onInput ──────────────────────────────────────────────────────────────

  it('onInput() updates the value model signal', () => {
    const event = { target: { value: 'new folder' } } as unknown as Event;
    comp.onInput(event);
    expect(comp.value()).toBe('new folder');
  });

  // ─── onConfirm ────────────────────────────────────────────────────────────

  it('onConfirm() emits confirmed when value is non-empty and not loading', () => {
    spyOn(comp.confirmed, 'emit');
    fixture.componentRef.setInput('value', 'some name');
    fixture.componentRef.setInput('loading', false);
    fixture.detectChanges();

    comp.onConfirm();

    expect(comp.confirmed.emit).toHaveBeenCalled();
  });

  it('onConfirm() does NOT emit when value is blank (whitespace only)', () => {
    spyOn(comp.confirmed, 'emit');
    fixture.componentRef.setInput('value', '   ');
    fixture.detectChanges();

    comp.onConfirm();

    expect(comp.confirmed.emit).not.toHaveBeenCalled();
  });

  it('onConfirm() does NOT emit when value is empty string', () => {
    spyOn(comp.confirmed, 'emit');
    fixture.componentRef.setInput('value', '');
    fixture.detectChanges();

    comp.onConfirm();

    expect(comp.confirmed.emit).not.toHaveBeenCalled();
  });

  it('onConfirm() does NOT emit when loading is true', () => {
    spyOn(comp.confirmed, 'emit');
    fixture.componentRef.setInput('value', 'valid name');
    fixture.componentRef.setInput('loading', true);
    fixture.detectChanges();

    comp.onConfirm();

    expect(comp.confirmed.emit).not.toHaveBeenCalled();
  });

  // ─── cancelled output ─────────────────────────────────────────────────────

  it('cancelled output is emittable', () => {
    spyOn(comp.cancelled, 'emit');
    comp.cancelled.emit();
    expect(comp.cancelled.emit).toHaveBeenCalled();
  });
});
