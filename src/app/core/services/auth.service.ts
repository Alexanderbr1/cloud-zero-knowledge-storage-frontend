import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, finalize, from, map, take, tap, throwError } from 'rxjs';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../environments/environment';
import type {
  LoginInitRequestDto,
  LoginInitResponseDto,
  LoginFinalizeRequestDto,
  RegisterRequestDto,
  TokenResponseDto,
} from '../models/auth.model';
import { CryptoService } from './crypto.service';
import { SrpService } from './srp.service';

const LS_ACCESS = 'auth.access_token';
const LS_EMAIL  = 'auth.email';
/** Старый формат: refresh в localStorage; больше не используется. */
const LEGACY_LS_REFRESH = 'auth.refresh_token';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly crypto = inject(CryptoService);
  private readonly srp = inject(SrpService);
  private readonly baseUrl = `${environment.apiBaseUrl}/auth`;
  private readonly accessTokenSig = signal<string | null>(this.readAccessToken());
  private readonly emailSig = signal<string | null>(this.readEmail());

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
  readonly email = this.emailSig.asReadonly();

  accessToken(): string | null {
    return this.accessTokenSig();
  }

  getMasterKey(): CryptoKey | null {
    return this.masterKey;
  }

  /**
   * Регистрация (SRP-6a + bcrypt):
   * 1. Генерируем bcrypt-соль и srp-соль на клиенте
   * 2. Вычисляем верификатор v = g^x mod N, x = H(srpSalt || bcrypt(pw, bcryptSalt))
   * 3. Генерируем crypto_salt и деривируем masterKey (PBKDF2)
   * 4. Отправляем на сервер только производные значения — пароль не покидает браузер
   */
  register(email: string, password: string): Observable<void> {
    const blocked = this.crypto.webCryptoBlockedMessage();
    if (blocked) {
      return throwError(() => new Error(blocked));
    }
    return from(this._registerFlow(email, password));
  }

  /**
   * Вход (SRP-6a, два шага):
   * Шаг 1 — отправляем email + A (публичный эфемерный ключ клиента).
   * Шаг 2 — вычисляем M1 через bcrypt, отправляем; проверяем M2 от сервера.
   * Пароль в открытом виде никогда не покидает браузер.
   */
  login(email: string, password: string): Observable<void> {
    const blocked = this.crypto.webCryptoBlockedMessage();
    if (blocked) {
      return throwError(() => new Error(blocked));
    }
    return from(this._loginFlow(email, password));
  }

  /**
   * Новая пара токенов: refresh читается с сервера из HttpOnly-куки.
   * Мастер-ключ НЕ переинициализируется при refresh — он уже в памяти.
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
          try { localStorage.removeItem(LS_EMAIL); } catch { /* ignore */ }
          this.emailSig.set(null);
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

  private setEmail(email: string): void {
    try { localStorage.setItem(LS_EMAIL, email); } catch { /* ignore */ }
    this.emailSig.set(email);
  }

  private readEmail(): string | null {
    try { return localStorage.getItem(LS_EMAIL) || null; } catch { return null; }
  }

  // ─── Приватные методы ──────────────────────────────────────────────────

  private async _registerFlow(email: string, password: string): Promise<void> {
    // Все криптографические операции выполняются на клиенте
    const { srpSalt, srpVerifier, bcryptSalt } = await this.srp.createVerifier(password);

    const cryptoSalt = this.crypto.generateSalt();
    const masterKey = await this.crypto.deriveMasterKey(password, cryptoSalt);

    const payload: RegisterRequestDto = {
      email,
      srp_salt: srpSalt,
      srp_verifier: srpVerifier,
      bcrypt_salt: bcryptSalt,
      crypto_salt: this.crypto.toBase64(cryptoSalt),
    };

    const resp = await firstValueFrom(
      this.http.post<TokenResponseDto>(`${this.baseUrl}/register`, payload)
    );

    this.masterKey = masterKey;
    this.setEmail(email);
    this.setAccessToken(resp.access_token);
  }

  private async _loginFlow(email: string, password: string): Promise<void> {
    // Нормализуем email так же, как сервер: toLowerCase + trim.
    // Важно: сервер хранит нормализованный email в SRP-сессии и использует его в M1.
    const normalizedEmail = email.trim().toLowerCase();

    // Шаг 1: генерируем эфемерный ключ клиента и отправляем init
    const { a, AHex } = this.srp.createClientEphemeral();

    const initResp = await firstValueFrom(
      this.http.post<LoginInitResponseDto>(
        `${this.baseUrl}/login/init`,
        { email: normalizedEmail, A: AHex } as LoginInitRequestDto
      )
    );

    // Вычисляем M1 (включает bcrypt — ~100 мс)
    const { M1Hex, verifyM2 } = await this.srp.computeClientProof({
      email: normalizedEmail,
      password,
      a,
      AHex,
      B: initResp.B,
      srpSalt: initResp.srp_salt,
      bcryptSalt: initResp.bcrypt_salt,
    });

    const finalResp = await firstValueFrom(
      this.http.post<TokenResponseDto>(
        `${this.baseUrl}/login/finalize`,
        { session_id: initResp.session_id, M1: M1Hex } as LoginFinalizeRequestDto
      )
    );

    // Проверяем M2 — сервер доказывает, что знал верификатор (защита от MITM)
    if (!finalResp.M2 || !verifyM2(finalResp.M2)) {
      throw new Error('SRP: server proof (M2) verification failed — possible MITM attack');
    }

    // Деривируем masterKey из crypto_salt + пароля через PBKDF2
    const cryptoSaltBytes = new Uint8Array(this.crypto.fromBase64(initResp.crypto_salt));
    const masterKey = await this.crypto.deriveMasterKey(password, cryptoSaltBytes);

    this.masterKey = masterKey;
    this.setEmail(normalizedEmail);
    this.setAccessToken(finalResp.access_token);
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
