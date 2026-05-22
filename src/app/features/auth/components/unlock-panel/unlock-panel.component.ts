import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';

@Component({
    selector: 'app-unlock-panel',
    imports: [ReactiveFormsModule],
    templateUrl: './unlock-panel.component.html',
    styleUrl: './unlock-panel.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UnlockPanelComponent {
  readonly email = input.required<string>();
  readonly isSubmitting = input.required<boolean>();
  readonly errorText = input<string>('');

  readonly submitted = output<string>();
  readonly logoutRequested = output<void>();

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
