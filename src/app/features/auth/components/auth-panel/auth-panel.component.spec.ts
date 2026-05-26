import { TestBed, ComponentFixture } from '@angular/core/testing';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { provideRouter } from '@angular/router';

import { AuthPanelComponent } from './auth-panel.component';

function makeForm(passwordValue = ''): FormGroup {
  return new FormGroup({
    email:    new FormControl('', [Validators.required, Validators.email]),
    password: new FormControl(passwordValue, [Validators.required]),
  });
}

describe('AuthPanelComponent', () => {
  let fixture: ComponentFixture<AuthPanelComponent>;
  let comp:    AuthPanelComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports:   [AuthPanelComponent],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(AuthPanelComponent);
    comp    = fixture.componentInstance;

    fixture.componentRef.setInput('credentialsForm', makeForm());
    fixture.componentRef.setInput('mode', 'login');
    fixture.componentRef.setInput('isSubmitting', false);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(comp).toBeTruthy();
  });

  // ─── computed controls ────────────────────────────────────────────────────

  it('emailControl returns the form email control', () => {
    const form = makeForm();
    fixture.componentRef.setInput('credentialsForm', form);
    fixture.detectChanges();
    expect(comp.emailControl()).toBe(form.get('email')!);
  });

  it('passwordControl returns the form password control', () => {
    const form = makeForm();
    fixture.componentRef.setInput('credentialsForm', form);
    fixture.detectChanges();
    expect(comp.passwordControl()).toBe(form.get('password')!);
  });

  // ─── strengthLevel ────────────────────────────────────────────────────────

  it('strengthLevel is 0 for empty password', () => {
    fixture.componentRef.setInput('credentialsForm', makeForm(''));
    fixture.detectChanges();
    expect(comp.strengthLevel()).toBe(0);
  });

  it('strengthLevel is 4 for a very strong password', () => {
    fixture.componentRef.setInput('credentialsForm', makeForm('C0rrect!Horse#Battery$Staple99'));
    fixture.detectChanges();
    expect(comp.strengthLevel()).toBe(4);
  });

  it('strengthLevel is 1 for a very weak password', () => {
    fixture.componentRef.setInput('credentialsForm', makeForm('abc'));
    fixture.detectChanges();
    expect(comp.strengthLevel()).toBe(1);
  });

  // ─── strengthLabel ────────────────────────────────────────────────────────

  it('strengthLabel is empty for empty password', () => {
    fixture.componentRef.setInput('credentialsForm', makeForm(''));
    fixture.detectChanges();
    expect(comp.strengthLabel()).toBe('');
  });

  it('strengthLabel is non-empty for a non-empty password', () => {
    fixture.componentRef.setInput('credentialsForm', makeForm('abc'));
    fixture.detectChanges();
    expect(comp.strengthLabel().length).toBeGreaterThan(0);
  });

  // ─── selectMode ───────────────────────────────────────────────────────────

  it('selectMode() emits modeChange with the new mode', () => {
    spyOn(comp.modeChange, 'emit');
    comp.selectMode('register');
    expect(comp.modeChange.emit).toHaveBeenCalledWith('register');
  });

  it('selectMode() can switch back to login', () => {
    spyOn(comp.modeChange, 'emit');
    comp.selectMode('login');
    expect(comp.modeChange.emit).toHaveBeenCalledWith('login');
  });

  // ─── onSubmit ─────────────────────────────────────────────────────────────

  it('onSubmit() marks all controls as touched', () => {
    const form = makeForm();
    fixture.componentRef.setInput('credentialsForm', form);
    fixture.detectChanges();

    comp.onSubmit();

    expect(form.get('email')!.touched).toBeTrue();
    expect(form.get('password')!.touched).toBeTrue();
  });

  it('onSubmit() emits submitted event', () => {
    spyOn(comp.submitted, 'emit');
    comp.onSubmit();
    expect(comp.submitted.emit).toHaveBeenCalled();
  });

  // ─── errorText ────────────────────────────────────────────────────────────

  it('errorText defaults to empty string', () => {
    expect(comp.errorText()).toBe('');
  });

  it('errorText reflects the input value', () => {
    fixture.componentRef.setInput('errorText', 'Invalid credentials');
    fixture.detectChanges();
    expect(comp.errorText()).toBe('Invalid credentials');
  });
});
