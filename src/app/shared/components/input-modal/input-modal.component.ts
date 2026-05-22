import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, input, model, output, viewChild } from '@angular/core';

@Component({
  selector: 'app-input-modal',
  standalone: true,
  templateUrl: './input-modal.component.html',
  styleUrl: './input-modal.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InputModalComponent {
  title        = input.required<string>();
  subtitle     = input<string>();
  placeholder  = input<string>('');
  confirmLabel = input<string>('Подтвердить');
  value        = model.required<string>();
  error        = input<string>('');
  loading      = input<boolean>(false);

  confirmed = output<void>();
  cancelled = output<void>();

  private readonly inputEl = viewChild.required<ElementRef<HTMLInputElement>>('inputEl');

  constructor() {
    afterNextRender(() => this.inputEl().nativeElement.focus());
  }

  onConfirm(): void {
    if (this.loading() || !this.value().trim()) return;
    this.confirmed.emit();
  }
}
