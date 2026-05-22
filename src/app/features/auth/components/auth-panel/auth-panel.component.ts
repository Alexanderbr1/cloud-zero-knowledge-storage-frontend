import { Component, computed, input, output } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

@Component({
    selector: 'app-auth-panel',
    imports: [ReactiveFormsModule, RouterLink],
    templateUrl: './auth-panel.component.html',
    styleUrl: './auth-panel.component.scss'
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

  selectMode(next: 'login' | 'register'): void {
    this.modeChange.emit(next);
  }

  onSubmit(): void {
    this.credentialsForm().markAllAsTouched();
    this.submitted.emit();
  }

  // ─── Password strength ────────────────────────────────────────────────────

  /** 0–5: one point per satisfied criterion. */
  passwordStrength(): number {
    const v = (this.passwordControl().value as string) ?? '';
    let s = 0;
    if (v.length >= 8)           s++;
    if (/[A-Z]/.test(v))         s++;
    if (/[a-z]/.test(v))         s++;
    if (/[0-9]/.test(v))         s++;
    if (/[^A-Za-z0-9]/.test(v))  s++;
    return s;
  }

  /** Maps score to 0–4 display levels: 0 = empty, 1–4 = weak…strong. */
  strengthLevel(): 0 | 1 | 2 | 3 | 4 {
    const v = (this.passwordControl().value as string) ?? '';
    if (!v) return 0;
    const s = this.passwordStrength();
    if (s <= 2) return 1;
    if (s === 3) return 2;
    if (s === 4) return 3;
    return 4;
  }

  strengthLabel(): string {
    const labels: Record<number, string> = { 1: 'Слабый', 2: 'Средний', 3: 'Хороший', 4: 'Надёжный' };
    return labels[this.strengthLevel()] ?? '';
  }

  strengthReqs(): { label: string; met: boolean }[] {
    const v = (this.passwordControl().value as string) ?? '';
    return [
      { label: 'Минимум 8 символов',  met: v.length >= 8 },
      { label: 'Заглавная буква',      met: /[A-Z]/.test(v) },
      { label: 'Строчная буква',       met: /[a-z]/.test(v) },
      { label: 'Цифра (0–9)',          met: /[0-9]/.test(v) },
      { label: 'Спецсимвол (!@#…)',    met: /[^A-Za-z0-9]/.test(v) },
    ];
  }
}
