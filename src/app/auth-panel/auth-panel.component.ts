import { Component, input, output } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';

@Component({
  selector: 'app-auth-panel',
  standalone: true,
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

  selectMode(next: 'login' | 'register'): void {
    this.modeChange.emit(next);
  }

  onSubmit(): void {
    this.submitted.emit();
  }
}
