import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

import { environment } from '../../../environments/environment';

export interface StorageUsage {
  used_bytes:  number;
  quota_bytes: number;
}

@Injectable({ providedIn: 'root' })
export class StorageUsageService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiBaseUrl}/storage`;

  getUsage(): Observable<StorageUsage> {
    return this.http.get<StorageUsage>(`${this.base}/usage`);
  }
}
