import { Component, inject } from '@angular/core';

import { Toast, ToastService } from '../../services/toast.service';

@Component({
  selector: 'app-toast',
  standalone: true,
  templateUrl: './toast.component.html',
  styleUrl: './toast.component.scss',
})
export class ToastComponent {
  readonly toastService = inject(ToastService);

  trackById(_: number, toast: Toast): number {
    return toast.id;
  }
}
