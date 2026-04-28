import { Component, input, output } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';

@Component({
  selector: 'app-unlock-panel',
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: './unlock-panel.component.html',
  styleUrl: './unlock-panel.component.scss',
})
export class UnlockPanelComponent {
  email = input.required<string>();
  isSubmitting = input.required<boolean>();
  errorText = input<string>('');

  submitted = output<string>();
  logoutRequested = output<void>();

  readonly form = new FormGroup({
    password: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });

  onSubmit(): void {
    if (this.form.invalid || this.isSubmitting()) return;
    this.submitted.emit(this.form.controls.password.value);
  }

  onLogout(): void {
    this.logoutRequested.emit();
  }
}
