import { Injectable, computed, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map, Observable, tap, throwError } from 'rxjs';

import { environment } from '../../../environments/environment';

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  refresh_expires_in: number;
  token_type: string;
}

interface LoginRequest {
  email: string;
  password: string;
}

interface RegisterRequest {
  email: string;
  password: string;
}

interface RefreshRequest {
  refresh_token: string;
}

interface LogoutRequest {
  refresh_token?: string;
}

const LS_ACCESS = 'auth.access_token';
const LS_REFRESH = 'auth.refresh_token';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly baseUrl = `${environment.apiBaseUrl}/auth`;
  private readonly accessTokenSig = signal<string | null>(this.readToken(LS_ACCESS));
  private readonly refreshTokenSig = signal<string | null>(this.readToken(LS_REFRESH));

  constructor(private readonly http: HttpClient) {}

  readonly isAuthenticated = computed(() => !!this.accessTokenSig());

  accessToken(): string | null {
    return this.accessTokenSig();
  }

  refreshToken(): string | null {
    return this.refreshTokenSig();
  }

  login(email: string, password: string): Observable<void> {
    const payload: LoginRequest = { email, password };
    return this.http.post<TokenResponse>(`${this.baseUrl}/login`, payload).pipe(
      tap((t) => this.setTokens(t.access_token, t.refresh_token)),
      map(() => void 0)
    );
  }

  register(email: string, password: string): Observable<void> {
    const payload: RegisterRequest = { email, password };
    return this.http.post<TokenResponse>(`${this.baseUrl}/register`, payload).pipe(
      tap((t) => this.setTokens(t.access_token, t.refresh_token)),
      map(() => void 0)
    );
  }

  refresh(): Observable<void> {
    const refreshToken = this.refreshToken();
    if (!refreshToken) {
      this.clearTokens();
      return throwError(() => new Error('No refresh token'));
    }
    const payload: RefreshRequest = { refresh_token: refreshToken };
    return this.http.post<TokenResponse>(`${this.baseUrl}/refresh`, payload).pipe(
      tap((t) => this.setTokens(t.access_token, t.refresh_token)),
      map(() => void 0)
    );
  }

  logout(): void {
    void this.logoutRemote().subscribe({
      next: () => {
        // no-op
      },
      error: () => {
        // Если logout не дошёл — всё равно локально выходим.
      }
    });
    this.clearTokens();
  }

  logoutRemote(): Observable<void> {
    const payload: LogoutRequest = {};
    const rt = this.refreshToken();
    if (rt) {
      payload.refresh_token = rt;
    }
    return this.http.post<void>(`${this.baseUrl}/logout`, payload);
  }

  private setTokens(accessToken: string, refreshToken: string): void {
    localStorage.setItem(LS_ACCESS, accessToken);
    localStorage.setItem(LS_REFRESH, refreshToken);
    this.accessTokenSig.set(accessToken);
    this.refreshTokenSig.set(refreshToken);
  }

  private clearTokens(): void {
    localStorage.removeItem(LS_ACCESS);
    localStorage.removeItem(LS_REFRESH);
    this.accessTokenSig.set(null);
    this.refreshTokenSig.set(null);
  }

  private readToken(key: string): string | null {
    const v = localStorage.getItem(key);
    const trimmed = v?.trim();
    return trimmed ? trimmed : null;
  }
}

