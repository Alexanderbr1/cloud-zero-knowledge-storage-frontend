import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Observable, startWith, switchMap } from 'rxjs';

@Component({
    selector: 'app-auth-panel',
    imports: [ReactiveFormsModule, RouterLink],
    templateUrl: './auth-panel.component.html',
    styleUrl: './auth-panel.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuthPanelComponent {
  readonly credentialsForm = input.required<FormGroup>();
  readonly mode = input.required<'login' | 'register'>();
  readonly isSubmitting = input.required<boolean>();
  readonly errorText = input<string>('');

  readonly modeChange = output<'login' | 'register'>();
  readonly submitted = output<void>();

  readonly emailControl    = computed(() => this.credentialsForm().get('email')!);
  readonly passwordControl = computed(() => this.credentialsForm().get('password')!);

  readonly strengthSegs = [0, 1, 2, 3] as const;

  private readonly passwordValue = toSignal(
    toObservable(this.passwordControl).pipe(
      switchMap(ctrl => (ctrl.valueChanges as Observable<string>).pipe(startWith(ctrl.value as string ?? '')))
    ),
    { initialValue: '' },
  );

  private readonly strengthScore = computed((): number => {
    const v = this.passwordValue();
    let s = 0;
    if (v.length >= 8)           s++;
    if (/[A-Z]/.test(v))         s++;
    if (/[a-z]/.test(v))         s++;
    if (/[0-9]/.test(v))         s++;
    if (/[^A-Za-z0-9]/.test(v))  s++;
    return s;
  });

  readonly strengthLevel = computed((): 0 | 1 | 2 | 3 | 4 => {
    const v = this.passwordValue();
    if (!v) return 0;
    const s = this.strengthScore();
    if (s <= 2) return 1;
    if (s === 3) return 2;
    if (s === 4) return 3;
    return 4;
  });

  readonly strengthLabel = computed((): string => {
    const labels: Record<number, string> = { 1: 'Слабый', 2: 'Средний', 3: 'Хороший', 4: 'Надёжный' };
    return labels[this.strengthLevel()] ?? '';
  });

  readonly strengthReqs = computed((): { label: string; met: boolean }[] => {
    const v = this.passwordValue();
    return [
      { label: 'Минимум 8 символов',  met: v.length >= 8 },
      { label: 'Заглавная буква',      met: /[A-Z]/.test(v) },
      { label: 'Строчная буква',       met: /[a-z]/.test(v) },
      { label: 'Цифра (0–9)',          met: /[0-9]/.test(v) },
      { label: 'Спецсимвол (!@#…)',    met: /[^A-Za-z0-9]/.test(v) },
    ];
  });

  selectMode(next: 'login' | 'register'): void {
    this.modeChange.emit(next);
  }

  onSubmit(): void {
    this.credentialsForm().markAllAsTouched();
    this.submitted.emit();
  }
}
