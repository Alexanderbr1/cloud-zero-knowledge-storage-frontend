import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Observable, startWith, switchMap } from 'rxjs';

import { passwordScore, passwordReqs } from '../../../../core/utils/browser.utils';

const STRENGTH_LABELS: Record<number, string> = { 1: 'Слабый', 2: 'Средний', 3: 'Хороший', 4: 'Надёжный' };

@Component({
  selector: 'app-auth-panel',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './auth-panel.component.html',
  styleUrl: './auth-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuthPanelComponent {
  readonly credentialsForm = input.required<FormGroup>();
  readonly mode            = input.required<'login' | 'register'>();
  readonly isSubmitting    = input.required<boolean>();
  readonly errorText       = input<string>('');

  readonly modeChange = output<'login' | 'register'>();
  readonly submitted  = output<void>();

  readonly emailControl    = computed(() => this.credentialsForm().get('email')!);
  readonly passwordControl = computed(() => this.credentialsForm().get('password')!);

  readonly strengthSegs = [0, 1, 2, 3] as const;

  private readonly passwordValue = toSignal(
    toObservable(this.passwordControl).pipe(
      switchMap(ctrl => (ctrl.valueChanges as Observable<string>).pipe(startWith(ctrl.value as string ?? '')))
    ),
    { initialValue: '' },
  );

  private readonly strengthScore = computed(() => passwordScore(this.passwordValue()));

  readonly strengthLevel = computed((): 0 | 1 | 2 | 3 | 4 => {
    const v = this.passwordValue();
    if (!v) return 0;
    const s = this.strengthScore();
    if (s <= 2) return 1;
    if (s === 3) return 2;
    if (s === 4) return 3;
    return 4;
  });

  readonly strengthLabel = computed(() => STRENGTH_LABELS[this.strengthLevel()] ?? '');
  readonly strengthReqs  = computed(() => passwordReqs(this.passwordValue()));

  selectMode(next: 'login' | 'register'): void { this.modeChange.emit(next); }

  onSubmit(): void {
    this.credentialsForm().markAllAsTouched();
    this.submitted.emit();
  }
}
