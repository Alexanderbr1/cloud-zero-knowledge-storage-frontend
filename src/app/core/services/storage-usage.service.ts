import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';

import { environment } from '../../../environments/environment';

export interface StorageUsage {
  used_bytes:  number;
  quota_bytes: number;
}

@Injectable({ providedIn: 'root' })
export class StorageUsageService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiBaseUrl}/storage`;

  private readonly _usage = signal<StorageUsage | null>(null);

  readonly usage = this._usage.asReadonly();

  readonly pct = computed(() => {
    const u = this._usage();
    if (!u || u.quota_bytes <= 0) return 0;
    return Math.min(100, (u.used_bytes / u.quota_bytes) * 100);
  });

  refresh(): void {
    this.http.get<StorageUsage>(`${this.base}/usage`).subscribe({
      next: data => this._usage.set(data),
      error: ()   => {},
    });
  }
}
