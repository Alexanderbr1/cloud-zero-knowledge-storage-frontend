import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { finalize, map, Observable, take, tap } from 'rxjs';

import { environment } from '../../../environments/environment';
import type { LoginRequestDto, RegisterRequestDto, TokenResponseDto } from '../models/auth.model';

const LS_ACCESS = 'auth.access_token';
/** Старый формат: refresh в localStorage; больше не используется. */
const LEGACY_LS_REFRESH = 'auth.refresh_token';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}/auth`;
  private readonly accessTokenSig = signal<string | null>(this.readAccessToken());

  constructor() {
    try {
      localStorage.removeItem(LEGACY_LS_REFRESH);
    } catch {
      /* ignore */
    }
  }

  readonly isAuthenticated = computed(() => !!this.accessTokenSig());

  accessToken(): string | null {
    return this.accessTokenSig();
  }

  login(email: string, password: string): Observable<void> {
    const payload: LoginRequestDto = { email, password };
    return this.http.post<TokenResponseDto>(`${this.baseUrl}/login`, payload).pipe(
      tap((t) => this.setAccessToken(t.access_token)),
      map(() => void 0)
    );
  }

  register(email: string, password: string): Observable<void> {
    const payload: RegisterRequestDto = { email, password };
    return this.http.post<TokenResponseDto>(`${this.baseUrl}/register`, payload).pipe(
      tap((t) => this.setAccessToken(t.access_token)),
      map(() => void 0)
    );
  }

  /**
   * Новая пара токенов: refresh читается с сервера из HttpOnly-куки (тело не нужно).
   */
  refreshSession(): Observable<void> {
    return this.http.post<TokenResponseDto>(`${this.baseUrl}/refresh`, {}).pipe(
      tap((t) => this.setAccessToken(t.access_token)),
      map(() => void 0)
    );
  }

  /**
   * Отзыв refresh на сервере + очистка HttpOnly-куки; локально убираем access.
   */
  logout(): void {
    this.http
      .post<void>(`${this.baseUrl}/logout`, {})
      .pipe(
        take(1),
        finalize(() => this.clearAccess())
      )
      .subscribe();
  }

  /** Только стереть access (например после неуспешного refresh). */
  clearAccess(): void {
    try {
      localStorage.removeItem(LS_ACCESS);
    } catch {
      /* ignore */
    }
    this.accessTokenSig.set(null);
  }

  private setAccessToken(accessToken: string): void {
    const t = accessToken.trim();
    if (!t) {
      this.clearAccess();
      return;
    }
    try {
      localStorage.setItem(LS_ACCESS, t);
    } catch {
      /* ignore */
    }
    this.accessTokenSig.set(t);
  }

  private readAccessToken(): string | null {
    try {
      const v = localStorage.getItem(LS_ACCESS);
      const trimmed = v?.trim();
      return trimmed ? trimmed : null;
    } catch {
      return null;
    }
  }
}
