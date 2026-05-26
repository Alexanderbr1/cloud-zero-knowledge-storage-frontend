import { TestBed, ComponentFixture } from '@angular/core/testing';
import { UnlockPanelComponent } from './unlock-panel.component';

describe('UnlockPanelComponent', () => {
  let fixture: ComponentFixture<UnlockPanelComponent>;
  let comp:    UnlockPanelComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UnlockPanelComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(UnlockPanelComponent);
    comp    = fixture.componentInstance;

    fixture.componentRef.setInput('email', 'alice@example.com');
    fixture.componentRef.setInput('isSubmitting', false);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(comp).toBeTruthy();
  });

  it('errorText defaults to empty string', () => {
    expect(comp.errorText()).toBe('');
  });

  // ─── onSubmit guards ──────────────────────────────────────────────────────

  it('onSubmit() does NOT emit when password is empty (form invalid)', () => {
    spyOn(comp.submitted, 'emit');
    comp.form.controls.password.setValue('');

    comp.onSubmit();

    expect(comp.submitted.emit).not.toHaveBeenCalled();
  });

  it('onSubmit() does NOT emit when isSubmitting is true', () => {
    spyOn(comp.submitted, 'emit');
    comp.form.controls.password.setValue('my-password');
    fixture.componentRef.setInput('isSubmitting', true);
    fixture.detectChanges();

    comp.onSubmit();

    expect(comp.submitted.emit).not.toHaveBeenCalled();
  });

  // ─── onSubmit success ─────────────────────────────────────────────────────

  it('onSubmit() emits the password value when form is valid', () => {
    spyOn(comp.submitted, 'emit');
    comp.form.controls.password.setValue('correct-horse');

    comp.onSubmit();

    expect(comp.submitted.emit).toHaveBeenCalledWith('correct-horse');
  });

  it('onSubmit() emits the exact password string (no trimming)', () => {
    spyOn(comp.submitted, 'emit');
    comp.form.controls.password.setValue('  passw0rd  ');

    comp.onSubmit();

    expect(comp.submitted.emit).toHaveBeenCalledWith('  passw0rd  ');
  });

  // ─── onLogout ─────────────────────────────────────────────────────────────

  it('onLogout() emits logoutRequested', () => {
    spyOn(comp.logoutRequested, 'emit');
    comp.onLogout();
    expect(comp.logoutRequested.emit).toHaveBeenCalled();
  });
});
