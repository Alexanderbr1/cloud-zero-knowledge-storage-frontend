import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { environment } from '../../../environments/environment';
import { DeviceSession, ListSessionsResponse } from '../models/session.model';

@Injectable({ providedIn: 'root' })
export class SessionsService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiBaseUrl}/auth/sessions`;

  list(): Observable<DeviceSession[]> {
    return this.http.get<ListSessionsResponse>(this.base).pipe(map(r => r.sessions));
  }

  revoke(sessionId: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/${sessionId}`);
  }

  revokeOthers(): Observable<void> {
    return this.http.delete<void>(this.base);
  }
}
