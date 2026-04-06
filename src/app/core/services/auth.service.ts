import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { finalize, from, map, Observable, switchMap, take, tap, throwError } from 'rxjs';

import { environment } from '../../../environments/environment';
import type { LoginRequestDto, RegisterRequestDto, TokenResponseDto } from '../models/auth.model';
import { CryptoService } from './crypto.service';

const LS_ACCESS = 'auth.access_token';
/** Старый формат: refresh в localStorage; больше не используется. */
const LEGACY_LS_REFRESH = 'auth.refresh_token';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly crypto = inject(CryptoService);
  private readonly baseUrl = `${environment.apiBaseUrl}/auth`;
  private readonly accessTokenSig = signal<string | null>(this.readAccessToken());

  /**
   * Мастер-ключ живёт только в памяти — никогда в localStorage/sessionStorage.
   * Производится из пароля через PBKDF2. Обнуляется при logout.
   */
  private masterKey: CryptoKey | null = null;

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

  getMasterKey(): CryptoKey | null {
    return this.masterKey;
  }

  /**
   * Регистрация:
   * 1. Генерируем crypto_salt на клиенте
   * 2. Деривируем мастер-ключ локально (PBKDF2)
   * 3. Отправляем email + password + crypto_salt на сервер
   */
  register(email: string, password: string): Observable<void> {
    const blocked = this.crypto.webCryptoBlockedMessage();
    if (blocked) {
      return throwError(() => new Error(blocked));
    }
    const salt = this.crypto.generateSalt();
    const saltB64 = this.crypto.toBase64(salt);

    return from(this.crypto.deriveMasterKey(password, salt)).pipe(
      switchMap((masterKey) => {
        this.masterKey = masterKey;
        const payload: RegisterRequestDto = { email, password, crypto_salt: saltB64 };
        return this.http.post<TokenResponseDto>(`${this.baseUrl}/register`, payload);
      }),
      tap((t) => this.setAccessToken(t.access_token)),
      map(() => void 0)
    );
  }

  /**
   * Логин:
   * 1. POST email + password — после успеха в ответе приходит crypto_salt
   * 2. Деривируем мастер-ключ локально (PBKDF2) и сохраняем access
   */
  login(email: string, password: string): Observable<void> {
    const blocked = this.crypto.webCryptoBlockedMessage();
    if (blocked) {
      return throwError(() => new Error(blocked));
    }
    const payload: LoginRequestDto = { email, password };
    return this.http.post<TokenResponseDto>(`${this.baseUrl}/login`, payload).pipe(
      switchMap((t) => {
        const saltB64 = t.crypto_salt?.trim();
        if (!saltB64) {
          return throwError(() => new Error('login response missing crypto_salt'));
        }
        const salt = new Uint8Array(this.crypto.fromBase64(saltB64));
        return from(this.crypto.deriveMasterKey(password, salt)).pipe(
          map((masterKey) => ({ t, masterKey }))
        );
      }),
      tap(({ t, masterKey }) => {
        this.masterKey = masterKey;
        this.setAccessToken(t.access_token);
      }),
      map(() => void 0)
    );
  }

  /**
   * Новая пара токенов: refresh читается с сервера из HttpOnly-куки (тело не нужно).
   * Мастер-ключ НЕ переинициализируется при refresh — он уже в памяти из login/register.
   */
  refreshSession(): Observable<void> {
    return this.http.post<TokenResponseDto>(`${this.baseUrl}/refresh`, {}).pipe(
      tap((t) => this.setAccessToken(t.access_token)),
      map(() => void 0)
    );
  }

  /**
   * Отзыв refresh на сервере + очистка HttpOnly-куки; локально убираем access и мастер-ключ.
   */
  logout(): void {
    this.http
      .post<void>(`${this.baseUrl}/logout`, {})
      .pipe(
        take(1),
        finalize(() => {
          this.masterKey = null;
          this.clearAccess();
        })
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
