import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, finalize, firstValueFrom, from, map, of, switchMap, take, tap, throwError } from 'rxjs';

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
const LS_UNLOCK_CHECK    = 'auth.unlock_check';
const LS_EC_PRIVATE_KEY  = 'auth.ec_private_key'; // two-level wrapped EC private key blob
const LS_CK_BLOB         = 'auth.ck_blob';         // AES-GCM(clientKey, password) — for key persistence across page loads
/** Флаг: сессия когда-либо существовала → refresh-кука может быть жива. */
const LS_SESSION_EXISTED = 'auth.session_existed';

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
  private readonly kekSig = signal<CryptoKey | null>(null);
  private readonly userIdSig = signal<string | null>(null);

  /**
   * EC private key (P-256) — lives only in memory.
   * Derived by unwrapping the encrypted blob from localStorage with the master key.
   * Used for ECIES file sharing. Null for legacy accounts without EC keys.
   */
  private readonly ecPrivateKeySig = signal<CryptoKey | null>(null);

  readonly isAuthenticated = computed(() => !!this.accessTokenSig());
  readonly isUnlocked = computed(() => !!this.masterKeySig());
  readonly email = this.emailSig.asReadonly();

  accessToken(): string | null {
    return this.accessTokenSig();
  }

  userId(): string | null {
    return this.userIdSig();
  }

  getMasterKey(): CryptoKey | null {
    return this.masterKeySig();
  }

  getKEK(): CryptoKey | null {
    return this.kekSig();
  }

  getFileKey(): CryptoKey | null {
    return this.kekSig() ?? this.masterKeySig();
  }

  getECPrivateKey(): CryptoKey | null {
    return this.ecPrivateKeySig();
  }

  tryRestoreSession(): Observable<boolean> {
    return this.http.post<TokenResponseDto>(`${this.baseUrl}/refresh`, {}).pipe(
      tap((t) => this.setAccessToken(t.access_token)),
      switchMap((t) => from(this.tryRestoreKeysFromClientKey(t))),
      map(() => true),
      catchError(() => of(false)),
    );
  }

  async unlockSession(password: string): Promise<void> {
    const resp = await firstValueFrom(
      this.http.get<{ crypto_salt: string; kek_encrypted_master?: string }>(`${this.baseUrl}/crypto-salt`)
    );
    const saltBytes = new Uint8Array(this.crypto.fromBase64(resp.crypto_salt));
    const key = await this.crypto.deriveMasterKey(password, saltBytes);
    const unlockCheck = this.lsRead(LS_UNLOCK_CHECK);
    if (!unlockCheck) {
      throw new Error('Данные сессии повреждены. Войдите снова.');
    }
    const valid = await this.crypto.verifyUnlockCheck(unlockCheck, key);
    if (!valid) {
      throw new Error('Неверный пароль.');
    }
    this.masterKeySig.set(key);
    if (resp.kek_encrypted_master) {
      await this.loadKEK(resp.kek_encrypted_master, key);
    }
    await this.loadECPrivateKey();
    // Refresh to obtain a fresh ClientKey and persist the password blob so the
    // unlock screen is skipped on the next page load.
    try {
      const tokenResp = await firstValueFrom(
        this.http.post<TokenResponseDto>(`${this.baseUrl}/refresh`, {})
      );
      this.setAccessToken(tokenResp.access_token);
      if (tokenResp.client_key) {
        await this.savePasswordBlob(password, tokenResp.client_key);
      }
    } catch { /* non-critical — keys are already in memory */ }
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
          this.lsRemove(LS_EMAIL, LS_UNLOCK_CHECK, LS_EC_PRIVATE_KEY, LS_CK_BLOB, LS_SESSION_EXISTED);
          this.emailSig.set(null);
        })
      )
      .subscribe();
  }

  clearAccess(): void {
    this.accessTokenSig.set(null);
    this.masterKeySig.set(null);
    this.kekSig.set(null);
    this.ecPrivateKeySig.set(null);
    this.userIdSig.set(null);
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

  /** Loads and unwraps the EC private key from localStorage using KEK. Silent on failure. */
  private async loadECPrivateKey(): Promise<void> {
    const encB64 = this.lsRead(LS_EC_PRIVATE_KEY);
    if (!encB64) return;
    const kek = this.kekSig();
    if (!kek) return;
    try {
      const privateKey = await this.crypto.unwrapECPrivateKey(encB64, kek);
      this.ecPrivateKeySig.set(privateKey);
    } catch { /* stale or corrupted blob — sharing unavailable */ }
  }

  // ─── Приватные методы ──────────────────────────────────────────────────

  private _pendingRecoveryPhrase: string | null = null;

  /** One-time access to the recovery phrase generated during registration. Cleared after first read. */
  consumeRecoveryPhrase(): string | null {
    const phrase = this._pendingRecoveryPhrase;
    this._pendingRecoveryPhrase = null;
    return phrase;
  }

  private async _registerFlow(email: string, password: string): Promise<void> {
    const { srpSalt, srpVerifier, bcryptSalt } = await this.srp.createVerifier(password);

    const cryptoSalt = this.crypto.generateSalt();
    const masterKey = await this.crypto.deriveMasterKey(password, cryptoSalt);

    const recoveryPhrase = this.crypto.generateRecoveryPhrase();
    const recoverySalt = this.crypto.generateSalt();
    const recoveryKey = await this.crypto.deriveRecoveryKey(recoveryPhrase, recoverySalt);
    const kek = await this.crypto.generateKEK();
    const kekEncryptedMaster = await this.crypto.wrapKEK(kek, masterKey);
    const kekEncryptedRecovery = await this.crypto.wrapKEK(kek, recoveryKey);

    // EC private key is wrapped by KEK (not masterKey) so it survives password resets.
    const { publicKeyB64, encryptedPrivateKeyB64 } = await this.crypto.generateECKeyPair(kek);

    const payload: RegisterRequestDto = {
      email,
      srp_salt: srpSalt,
      srp_verifier: srpVerifier,
      bcrypt_salt: bcryptSalt,
      crypto_salt: this.crypto.toBase64(cryptoSalt),
      public_key: publicKeyB64,
      encrypted_private_key: encryptedPrivateKeyB64,
      kek_encrypted_master: kekEncryptedMaster,
      kek_encrypted_recovery: kekEncryptedRecovery,
      recovery_salt: this.crypto.toBase64(recoverySalt),
    };

    const resp = await firstValueFrom(
      this.http.post<TokenResponseDto>(`${this.baseUrl}/register`, payload)
    );

    const unlockCheck = await this.crypto.createUnlockCheck(masterKey);
    this.lsWrite(LS_UNLOCK_CHECK, unlockCheck);
    this.lsWrite(LS_EC_PRIVATE_KEY, encryptedPrivateKeyB64);
    this.masterKeySig.set(masterKey);
    this.kekSig.set(kek);
    this._pendingRecoveryPhrase = recoveryPhrase;
    try {
      const ecPrivKey = await this.crypto.unwrapECPrivateKey(encryptedPrivateKeyB64, kek);
      this.ecPrivateKeySig.set(ecPrivKey);
    } catch { /* sharing unavailable */ }
    this.setEmail(email);
    this.setAccessToken(resp.access_token);
    if (resp.client_key) {
      await this.savePasswordBlob(password, resp.client_key);
    }
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
    this.lsWrite(LS_UNLOCK_CHECK, unlockCheck);
    if (finalResp.encrypted_private_key) {
      this.lsWrite(LS_EC_PRIVATE_KEY, finalResp.encrypted_private_key);
    }

    this.masterKeySig.set(masterKey);
    if (finalResp.kek_encrypted_master) {
      await this.loadKEK(finalResp.kek_encrypted_master, masterKey);
    }
    await this.loadECPrivateKey();
    this.setEmail(normalizedEmail);
    this.setAccessToken(finalResp.access_token);
    if (finalResp.client_key) {
      await this.savePasswordBlob(password, finalResp.client_key);
    }
  }

  requestPasswordReset(email: string): Observable<void> {
    return this.http.post<void>(`${this.baseUrl}/reset-password/request`, { email }).pipe(map(() => void 0));
  }

  resetPassword(token: string, recoveryPhrase: string, newPassword: string): Observable<void> {
    return from(this._resetPasswordFlow(token, recoveryPhrase, newPassword));
  }

  private async _resetPasswordFlow(token: string, recoveryPhrase: string, newPassword: string): Promise<void> {
    // Token is in the POST body — never exposed in URL query params or server access logs.
    const recoveryData = await firstValueFrom(
      this.http.post<{ kek_encrypted_recovery: string; recovery_salt: string }>(
        `${this.baseUrl}/reset-password/recovery-data`, { token }
      )
    );

    const recoverySaltBytes = new Uint8Array(this.crypto.fromBase64(recoveryData.recovery_salt));
    const recoveryKey = await this.crypto.deriveRecoveryKey(recoveryPhrase, recoverySaltBytes);
    const kek = await this.crypto.unwrapKEK(recoveryData.kek_encrypted_recovery, recoveryKey);

    const { srpSalt, srpVerifier, bcryptSalt } = await this.srp.createVerifier(newPassword);
    const newCryptoSalt = this.crypto.generateSalt();
    const newMasterKey = await this.crypto.deriveMasterKey(newPassword, newCryptoSalt);
    const newKEKEncryptedMaster = await this.crypto.wrapKEK(kek, newMasterKey);

    await firstValueFrom(
      this.http.post<void>(`${this.baseUrl}/reset-password/confirm`, {
        token,
        srp_salt: srpSalt,
        srp_verifier: srpVerifier,
        bcrypt_salt: bcryptSalt,
        crypto_salt: this.crypto.toBase64(newCryptoSalt),
        kek_encrypted_master: newKEKEncryptedMaster,
      })
    );
  }

  private async savePasswordBlob(password: string, clientKeyB64: string): Promise<void> {
    try {
      const blob = await this.crypto.encryptWithClientKey(password, clientKeyB64);
      this.lsWrite(LS_CK_BLOB, blob);
    } catch { /* non-critical */ }
  }

  private async tryRestoreKeysFromClientKey(tokenResp: TokenResponseDto): Promise<void> {
    if (!tokenResp.client_key) return;
    const blob = this.lsRead(LS_CK_BLOB);
    if (!blob) return;
    try {
      const password = await this.crypto.decryptWithClientKey(blob, tokenResp.client_key);
      const cryptoResp = await firstValueFrom(
        this.http.get<{ crypto_salt: string; kek_encrypted_master?: string }>(`${this.baseUrl}/crypto-salt`)
      );
      const saltBytes = new Uint8Array(this.crypto.fromBase64(cryptoResp.crypto_salt));
      const masterKey = await this.crypto.deriveMasterKey(password, saltBytes);
      const unlockCheck = this.lsRead(LS_UNLOCK_CHECK);
      if (unlockCheck && !(await this.crypto.verifyUnlockCheck(unlockCheck, masterKey))) {
        // Blob is stale (password was changed) — clear it so unlock screen shows.
        this.lsRemove(LS_CK_BLOB);
        return;
      }
      this.masterKeySig.set(masterKey);
      if (cryptoResp.kek_encrypted_master) {
        await this.loadKEK(cryptoResp.kek_encrypted_master, masterKey);
      }
      await this.loadECPrivateKey();
      // Rotate blob with the fresh ClientKey received in this response.
      await this.savePasswordBlob(password, tokenResp.client_key);
    } catch {
      // Silent — unlock screen will appear, user enters password manually.
    }
  }

  private async loadKEK(kekEncryptedMasterB64: string, masterKey: CryptoKey): Promise<void> {
    try {
      const kek = await this.crypto.unwrapKEK(kekEncryptedMasterB64, masterKey);
      this.kekSig.set(kek);
    } catch {
      // KEK unwrap failed — file operations fall back to master key.
    }
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
    try {
      const part = t.split('.').at(1);
      if (!part) throw new Error('malformed token');
      const payload = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
      this.userIdSig.set(payload.sub ?? null);
    } catch {
      this.userIdSig.set(null);
    }
  }
}
