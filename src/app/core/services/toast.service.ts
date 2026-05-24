import { Injectable, signal } from '@angular/core';

export interface Toast {
  readonly id:      number;
  readonly type:    'success' | 'error';
  readonly message: string;
  readonly leaving: boolean;
}

const LEAVE_DURATION = 280;

@Injectable({ providedIn: 'root' })
export class ToastService {
  private readonly toastsSig = signal<Toast[]>([]);
  readonly toasts = this.toastsSig.asReadonly();

  private nextId = 0;
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();

  success(message: string, duration = 4000): void { this.show('success', message, duration); }
  error(message: string, duration = 5000): void   { this.show('error',   message, duration); }

  dismiss(id: number): void {
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    this.toastsSig.update(list => list.map(t => t.id === id ? { ...t, leaving: true } : t));
    setTimeout(() => this.toastsSig.update(list => list.filter(t => t.id !== id)), LEAVE_DURATION);
  }

  private show(type: Toast['type'], message: string, duration: number): void {
    const id = this.nextId++;
    this.toastsSig.update(list => [...list, { id, type, message, leaving: false }]);
    this.timers.set(id, setTimeout(() => this.dismiss(id), duration));
  }
}
