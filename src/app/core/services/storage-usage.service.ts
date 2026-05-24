import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';

import { environment } from '../../../environments/environment';

export interface StorageUsage {
  readonly used_bytes:  number;
  readonly quota_bytes: number;
}

@Injectable({ providedIn: 'root' })
export class StorageUsageService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiBaseUrl}/storage`;

  private readonly usageSig = signal<StorageUsage | null>(null);

  readonly usage = this.usageSig.asReadonly();
  readonly pct   = computed(() => {
    const u = this.usageSig();
    if (!u || u.quota_bytes <= 0) return 0;
    return Math.min(100, (u.used_bytes / u.quota_bytes) * 100);
  });

  refresh(): void {
    this.http.get<StorageUsage>(`${this.base}/usage`).subscribe({
      next: data => this.usageSig.set(data),
      error: () => {},
    });
  }
}
