import { Injectable, signal } from '@angular/core';

export interface Toast {
  id: number;
  type: 'success' | 'error';
  message: string;
  leaving: boolean;
}

const LEAVE_DURATION = 280;

@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly toasts = signal<Toast[]>([]);

  private nextId = 0;

  success(message: string, duration = 4000): void {
    this.show('success', message, duration);
  }

  error(message: string, duration = 5000): void {
    this.show('error', message, duration);
  }

  dismiss(id: number): void {
    this.toasts.update(list =>
      list.map(t => t.id === id ? { ...t, leaving: true } : t),
    );
    setTimeout(() => {
      this.toasts.update(list => list.filter(t => t.id !== id));
    }, LEAVE_DURATION);
  }

  private show(type: Toast['type'], message: string, duration: number): void {
    const id = this.nextId++;
    this.toasts.update(list => [...list, { id, type, message, leaving: false }]);
    setTimeout(() => this.dismiss(id), duration);
  }
}
