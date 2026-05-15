import { Component, input, model, output } from '@angular/core';

@Component({
  selector: 'app-input-modal',
  standalone: true,
  templateUrl: './input-modal.component.html',
  styleUrl: './input-modal.component.scss',
})
export class InputModalComponent {
  title       = input.required<string>();
  subtitle    = input<string>();
  placeholder = input<string>('');
  confirmLabel = input<string>('Подтвердить');
  value       = model.required<string>();
  error       = input<string>('');
  loading     = input<boolean>(false);

  confirmed = output<void>();
  cancelled = output<void>();

  onConfirm(): void {
    if (this.loading() || !this.value().trim()) return;
    this.confirmed.emit();
  }
}
