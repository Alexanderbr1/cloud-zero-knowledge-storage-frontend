import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, finalize, firstValueFrom, from, map, of, take, tap, throwError } from 'rxjs';

import { environment } from '../../../environments/environment';
import type {
  LoginInitRequestDto,
  LoginInitResponseDto,
  LoginFinalizeRequestDto,
  RegisterRequestDto,
  TokenResponseDto,
} from '../../features/auth/models/auth.model';
import { CryptoService } from './crypto.service';
import { SrpService } from './srp.service';

const LS_EMAIL           = 'auth.email';
const LS_CRYPTO_SALT     = 'auth.crypto_salt';
const LS_UNLOCK_CHECK    = 'auth.unlock_check';
const LS_EC_PRIVATE_KEY  = 'auth.ec_private_key'; // two-level wrapped EC private key blob
/** Флаг: сессия когда-либо существовала → refresh-кука может быть жива. */
const LS_SESSION_EXISTED = 'auth.session_existed';
/** Ключи, которые больше не используются — чистим при старте. */
const LEGACY_KEYS = ['auth.refresh_token', 'auth.access_token'];

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly crypto = inject(CryptoService);
  private readonly srp = inject(SrpService);
  private readonly baseUrl = `${environment.apiBaseUrl}/auth`;
  private readonly accessTokenSig = signal<string | null>(null);
  private readonly emailSig = signal<string | null>(this.readEmail());

  /**
   * Мастер-ключ живёт только в памяти — никогда в localStorage/sessionStorage.
   * Производится из пароля через PBKDF2. Обнуляется при logout.
   */
  private readonly masterKeySig = signal<CryptoKey | null>(null);

  /**
   * EC private key (P-256) — lives only in memory.
   * Derived by unwrapping the encrypted blob from localStorage with the master key.
   * Used for ECIES file sharing. Null for legacy accounts without EC keys.
   */
  private readonly ecPrivateKeySig = signal<CryptoKey | null>(null);

  constructor() {
    try {
      for (const key of LEGACY_KEYS) localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }

  readonly isAuthenticated = computed(() => !!this.accessTokenSig());
  readonly isUnlocked = computed(() => !!this.masterKeySig());
  readonly email = this.emailSig.asReadonly();

  accessToken(): string | null {
    return this.accessTokenSig();
  }

  getMasterKey(): CryptoKey | null {
    return this.masterKeySig();
  }

  getECPrivateKey(): CryptoKey | null {
    return this.ecPrivateKeySig();
  }

  /**
   * Пытается восстановить сессию через HttpOnly refresh-куку.
   * Возвращает true при успехе, false при любой ошибке (кука истекла / не существует).
   */
  tryRestoreSession(): Observable<boolean> {
    return this.http.post<TokenResponseDto>(`${this.baseUrl}/refresh`, {}).pipe(
      tap((t) => this.setAccessToken(t.access_token)),
      map(() => true),
      catchError(() => of(false)),
    );
  }

  /**
   * Разблокировка мастер-ключа после перезагрузки страницы.
   * Читает crypto_salt из localStorage, деривирует ключ через PBKDF2.
   * Бросает ошибку, если crypto_salt не найден (нужен полный логин).
   */
  async unlockSession(password: string): Promise<void> {
    const saltB64 = this.readCryptoSalt();
    console.log('[unlockSession] saltB64 present:', !!saltB64);
    if (!saltB64) {
      throw new Error('Сессия устарела. Войдите снова.');
    }
    const saltBytes = new Uint8Array(this.crypto.fromBase64(saltB64));
    console.log('[unlockSession] deriving masterKey...');
    const key = await this.crypto.deriveMasterKey(password, saltBytes);
    console.log('[unlockSession] masterKey derived');
    const unlockCheck = this.readUnlockCheck();
    console.log('[unlockSession] unlockCheck present:', !!unlockCheck);
    if (unlockCheck) {
      const valid = await this.crypto.verifyUnlockCheck(unlockCheck, key);
      console.log('[unlockSession] verifyUnlockCheck:', valid);
      if (!valid) {
        throw new Error('Неверный пароль.');
      }
    }
    console.log('[unlockSession] setting masterKeySig...');
    this.masterKeySig.set(key);

    // Restore EC private key from localStorage if present.
    await this.loadECPrivateKey(key);

    console.log('[unlockSession] done | isUnlocked:', this.isUnlocked());
  }

  /**
   * Регистрация (SRP-6a + bcrypt):
   * 1. Генерируем bcrypt-соль и srp-соль на клиенте
   * 2. Вычисляем верификатор v = g^x mod N, x = H(srpSalt || bcrypt(pw, bcryptSalt))
   * 3. Генерируем crypto_salt и деривируем masterKey (PBKDF2)
   * 4. Генерируем EC ключевую пару для шаринга файлов
   * 5. Отправляем на сервер только производные значения — пароль не покидает браузер
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
          this.masterKeySig.set(null);
          this.ecPrivateKeySig.set(null);
          this.clearAccess();
          try { localStorage.removeItem(LS_EMAIL); } catch { /* ignore */ }
          try { localStorage.removeItem(LS_CRYPTO_SALT); } catch { /* ignore */ }
          try { localStorage.removeItem(LS_UNLOCK_CHECK); } catch { /* ignore */ }
          try { localStorage.removeItem(LS_EC_PRIVATE_KEY); } catch { /* ignore */ }
          try { localStorage.removeItem(LS_SESSION_EXISTED); } catch { /* ignore */ }
          this.emailSig.set(null);
        })
      )
      .subscribe();
  }

  /** Только стереть access (например после неуспешного refresh). */
  clearAccess(): void {
    this.accessTokenSig.set(null);
    this.masterKeySig.set(null);
    this.ecPrivateKeySig.set(null);
  }

  private setEmail(email: string): void {
    try { localStorage.setItem(LS_EMAIL, email); } catch { /* ignore */ }
    this.emailSig.set(email);
  }

  private readEmail(): string | null {
    try { return localStorage.getItem(LS_EMAIL) || null; } catch { return null; }
  }

  private readCryptoSalt(): string | null {
    try { return localStorage.getItem(LS_CRYPTO_SALT) || null; } catch { return null; }
  }

  private readUnlockCheck(): string | null {
    try { return localStorage.getItem(LS_UNLOCK_CHECK) || null; } catch { return null; }
  }

  private readEncryptedECPrivateKey(): string | null {
    try { return localStorage.getItem(LS_EC_PRIVATE_KEY) || null; } catch { return null; }
  }

  /** Loads and unwraps the EC private key from localStorage. Silent on failure (legacy accounts). */
  private async loadECPrivateKey(masterKey: CryptoKey): Promise<void> {
    const encB64 = this.readEncryptedECPrivateKey();
    if (!encB64) return;
    try {
      const privateKey = await this.crypto.unwrapECPrivateKey(encB64, masterKey);
      this.ecPrivateKeySig.set(privateKey);
    } catch {
      // Stale or corrupted blob — silently ignore; sharing will be unavailable.
    }
  }

  // ─── Приватные методы ──────────────────────────────────────────────────

  private async _registerFlow(email: string, password: string): Promise<void> {
    const { srpSalt, srpVerifier, bcryptSalt } = await this.srp.createVerifier(password);

    const cryptoSalt = this.crypto.generateSalt();
    const masterKey = await this.crypto.deriveMasterKey(password, cryptoSalt);

    const { publicKeyB64, encryptedPrivateKeyB64 } = await this.crypto.generateECKeyPair(masterKey);

    const payload: RegisterRequestDto = {
      email,
      srp_salt: srpSalt,
      srp_verifier: srpVerifier,
      bcrypt_salt: bcryptSalt,
      crypto_salt: this.crypto.toBase64(cryptoSalt),
      public_key: publicKeyB64,
      encrypted_private_key: encryptedPrivateKeyB64,
    };

    const resp = await firstValueFrom(
      this.http.post<TokenResponseDto>(`${this.baseUrl}/register`, payload)
    );

    const unlockCheck = await this.crypto.createUnlockCheck(masterKey);
    try { localStorage.setItem(LS_CRYPTO_SALT, this.crypto.toBase64(cryptoSalt)); } catch { /* ignore */ }
    try { localStorage.setItem(LS_UNLOCK_CHECK, unlockCheck); } catch { /* ignore */ }
    try { localStorage.setItem(LS_EC_PRIVATE_KEY, encryptedPrivateKeyB64); } catch { /* ignore */ }
    this.masterKeySig.set(masterKey);
    try {
      const ecPrivKey = await this.crypto.unwrapECPrivateKey(encryptedPrivateKeyB64, masterKey);
      this.ecPrivateKeySig.set(ecPrivKey);
    } catch { /* sharing unavailable */ }
    this.setEmail(email);
    this.setAccessToken(resp.access_token);
  }

  private async _loginFlow(email: string, password: string): Promise<void> {
    // Нормализуем email так же, как сервер: toLowerCase + trim.
    const normalizedEmail = email.trim().toLowerCase();

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

    const unlockCheck = await this.crypto.createUnlockCheck(masterKey);
    try { localStorage.setItem(LS_CRYPTO_SALT, initResp.crypto_salt); } catch { /* ignore */ }
    try { localStorage.setItem(LS_UNLOCK_CHECK, unlockCheck); } catch { /* ignore */ }

    // Store EC private key from server response (absent for legacy accounts).
    if (finalResp.encrypted_private_key) {
      try { localStorage.setItem(LS_EC_PRIVATE_KEY, finalResp.encrypted_private_key); } catch { /* ignore */ }
    }

    this.masterKeySig.set(masterKey);
    await this.loadECPrivateKey(masterKey);
    this.setEmail(normalizedEmail);
    this.setAccessToken(finalResp.access_token);
  }

  /** Возвращает true если сессия когда-либо существовала — refresh-кука может быть жива. */
  hadSession(): boolean {
    try { return !!localStorage.getItem(LS_SESSION_EXISTED); } catch { return false; }
  }

  private setAccessToken(accessToken: string): void {
    const t = accessToken.trim();
    if (!t) {
      this.clearAccess();
      return;
    }
    try { localStorage.setItem(LS_SESSION_EXISTED, '1'); } catch { /* ignore */ }
    this.accessTokenSig.set(t);
  }
}
