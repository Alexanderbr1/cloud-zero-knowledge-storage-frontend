import { Component, computed, input, output } from '@angular/core';
import { AbstractControl, FormGroup, ReactiveFormsModule } from '@angular/forms';

@Component({
    selector: 'app-auth-panel',
    imports: [ReactiveFormsModule],
    templateUrl: './auth-panel.component.html',
    styleUrl: './auth-panel.component.scss'
})
export class AuthPanelComponent {
  credentialsForm = input.required<FormGroup>();
  mode = input.required<'login' | 'register'>();
  isSubmitting = input.required<boolean>();
  errorText = input<string>('');

  modeChange = output<'login' | 'register'>();
  submitted = output<void>();

  readonly emailControl = computed<AbstractControl>(() => this.credentialsForm().controls['email']);
  readonly passwordControl = computed<AbstractControl>(() => this.credentialsForm().controls['password']);

  selectMode(next: 'login' | 'register'): void {
    this.modeChange.emit(next);
  }

  onSubmit(): void {
    this.credentialsForm().markAllAsTouched();
    this.submitted.emit();
  }
}
