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
  private readonly emailSig = signal<string | null>(this.lsRead(LS_EMAIL));

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
    this.lsRemove(...LEGACY_KEYS);
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

  tryRestoreSession(): Observable<boolean> {
    return this.http.post<TokenResponseDto>(`${this.baseUrl}/refresh`, {}).pipe(
      tap((t) => this.setAccessToken(t.access_token)),
      map(() => true),
      catchError(() => of(false)),
    );
  }

  async unlockSession(password: string): Promise<void> {
    const saltB64 = this.lsRead(LS_CRYPTO_SALT);
    if (!saltB64) {
      throw new Error('Сессия устарела. Войдите снова.');
    }
    const saltBytes = new Uint8Array(this.crypto.fromBase64(saltB64));
    const key = await this.crypto.deriveMasterKey(password, saltBytes);
    const unlockCheck = this.lsRead(LS_UNLOCK_CHECK);
    if (unlockCheck) {
      const valid = await this.crypto.verifyUnlockCheck(unlockCheck, key);
      if (!valid) {
        throw new Error('Неверный пароль.');
      }
    }
    this.masterKeySig.set(key);
    await this.loadECPrivateKey(key);
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

  refreshSession(): Observable<void> {
    return this.http.post<TokenResponseDto>(`${this.baseUrl}/refresh`, {}).pipe(
      tap((t) => this.setAccessToken(t.access_token)),
      map(() => void 0)
    );
  }

  logout(): void {
    this.http
      .post<void>(`${this.baseUrl}/logout`, {})
      .pipe(
        take(1),
        finalize(() => {
          this.clearAccess();
          this.lsRemove(LS_EMAIL, LS_CRYPTO_SALT, LS_UNLOCK_CHECK, LS_EC_PRIVATE_KEY, LS_SESSION_EXISTED);
          this.emailSig.set(null);
        })
      )
      .subscribe();
  }

  clearAccess(): void {
    this.accessTokenSig.set(null);
    this.masterKeySig.set(null);
    this.ecPrivateKeySig.set(null);
  }

  private lsRead(key: string): string | null {
    try { return localStorage.getItem(key) || null; } catch { return null; }
  }

  private lsWrite(key: string, value: string): void {
    try { localStorage.setItem(key, value); } catch { /* ignore */ }
  }

  private lsRemove(...keys: string[]): void {
    for (const key of keys) {
      try { localStorage.removeItem(key); } catch { /* ignore */ }
    }
  }

  private setEmail(email: string): void {
    this.lsWrite(LS_EMAIL, email);
    this.emailSig.set(email);
  }

  /** Loads and unwraps the EC private key from localStorage. Silent on failure (legacy accounts). */
  private async loadECPrivateKey(masterKey: CryptoKey): Promise<void> {
    const encB64 = this.lsRead(LS_EC_PRIVATE_KEY);
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
    this.lsWrite(LS_CRYPTO_SALT, this.crypto.toBase64(cryptoSalt));
    this.lsWrite(LS_UNLOCK_CHECK, unlockCheck);
    this.lsWrite(LS_EC_PRIVATE_KEY, encryptedPrivateKeyB64);
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
    this.lsWrite(LS_CRYPTO_SALT, initResp.crypto_salt);
    this.lsWrite(LS_UNLOCK_CHECK, unlockCheck);
    if (finalResp.encrypted_private_key) {
      this.lsWrite(LS_EC_PRIVATE_KEY, finalResp.encrypted_private_key);
    }

    this.masterKeySig.set(masterKey);
    await this.loadECPrivateKey(masterKey);
    this.setEmail(normalizedEmail);
    this.setAccessToken(finalResp.access_token);
  }

  hadSession(): boolean {
    return !!this.lsRead(LS_SESSION_EXISTED);
  }

  private setAccessToken(accessToken: string): void {
    const t = accessToken.trim();
    if (!t) {
      this.clearAccess();
      return;
    }
    this.lsWrite(LS_SESSION_EXISTED, '1');
    this.accessTokenSig.set(t);
  }
}
