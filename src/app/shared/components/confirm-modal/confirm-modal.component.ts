import { Component, HostListener, input, output } from '@angular/core';

@Component({
  selector: 'app-confirm-modal',
  standalone: true,
  templateUrl: './confirm-modal.component.html',
  styleUrl: './confirm-modal.component.scss',
})
export class ConfirmModalComponent {
  title        = input.required<string>();
  body         = input<string>();
  confirmLabel = input<string>('Удалить');
  loading      = input<boolean>(false);

  confirmed = output<void>();
  cancelled = output<void>();

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (!this.loading()) this.cancelled.emit();
  }
}
