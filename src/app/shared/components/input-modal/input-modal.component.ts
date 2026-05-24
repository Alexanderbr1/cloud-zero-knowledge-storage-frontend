import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, input, model, output, viewChild } from '@angular/core';

@Component({
  selector: 'app-input-modal',
  templateUrl: './input-modal.component.html',
  styleUrl: './input-modal.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InputModalComponent {
  readonly title        = input.required<string>();
  readonly subtitle     = input<string>();
  readonly placeholder  = input('');
  readonly confirmLabel = input('Подтвердить');
  readonly value        = model.required<string>();
  readonly error        = input('');
  readonly loading      = input(false);

  readonly confirmed = output<void>();
  readonly cancelled = output<void>();

  private readonly inputEl = viewChild.required<ElementRef<HTMLInputElement>>('inputEl');

  constructor() {
    afterNextRender(() => this.inputEl().nativeElement.focus());
  }

  onInput(e: Event): void { this.value.set((e.target as HTMLInputElement).value); }

  onConfirm(): void {
    if (this.loading() || !this.value().trim()) return;
    this.confirmed.emit();
  }
}
