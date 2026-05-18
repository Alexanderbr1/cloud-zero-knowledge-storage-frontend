import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';

import { environment } from '../../../../environments/environment';
import { AuditEvent, ListAuditResponse } from '../models/audit.model';

@Injectable({ providedIn: 'root' })
export class AuditService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiBaseUrl}/audit`;

  list(limit = 50, before?: string): Observable<AuditEvent[]> {
    let params = new HttpParams().set('limit', limit.toString());
    if (before) {
      params = params.set('before', before);
    }
    return this.http.get<ListAuditResponse>(this.base, { params }).pipe(
      map(r => r.events ?? [])
    );
  }
}
