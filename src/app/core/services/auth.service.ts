import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, finalize, firstValueFrom, from, map, of, share, switchMap, take, tap, throwError } from 'rxjs';

import { environment } from '../../../environments/environment';
import type {
  LoginInitRequest,
  LoginInitResponse,
  LoginFinalizeRequest,
  RegisterRequest,
  RegisterResponse,
  LoginFinalizeResponse,
  RefreshResponse,
} from '../../features/auth/models/auth.model';
import { CryptoService } from './crypto.service';
import { SrpService } from './srp.service';
import { fromBase64, toBase64 } from '../utils/encoding.utils';

// ─── localStorage keys ───────────────────────────────────────────────────────

const LS_EMAIL           = 'auth.email';
const LS_CK_BLOB         = 'auth.ck_blob';         // AES-GCM(clientKey, password) — персистентность ключей между загрузками
const LS_SESSION_EXISTED = 'auth.session_existed';  // сессия когда-либо существовала → refresh-кука может быть жива

// ─────────────────────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http   = inject(HttpClient);
  private readonly crypto = inject(CryptoService);
  private readonly srp    = inject(SrpService);

  private readonly baseUrl = `${environment.apiBaseUrl}/auth`;

  private readonly accessTokenSig  = signal<string | null>(null);
  private readonly emailSig        = signal<string | null>(this.lsRead(LS_EMAIL));
  private readonly masterKeySig    = signal<CryptoKey | null>(null);
  private readonly kekSig          = signal<CryptoKey | null>(null);
  private readonly ecPrivateKeySig = signal<CryptoKey | null>(null);
  private readonly userIdSig       = signal<string | null>(null);

  private refreshInFlight$: Observable<void> | null = null;

  private readonly _recoveryPhrase = signal<string | null>(null);
  readonly recoveryPhrase = this._recoveryPhrase.asReadonly();

  // ─── Публичное состояние ─────────────────────────────────────────────────

  readonly isAuthenticated = computed(() => !!this.accessTokenSig());
  readonly isUnlocked      = computed(() => !!this.kekSig());
  readonly email           = this.emailSig.asReadonly();

  readonly authStatus = computed<'unauthenticated' | 'locked' | 'unlocked'>(() => {
    if (!this.accessTokenSig()) return 'unauthenticated';
    return this.kekSig() ? 'unlocked' : 'locked';
  });

  // ─── Геттеры ─────────────────────────────────────────────────────────────

  accessToken():     string | null    { return this.accessTokenSig(); }
  userId():          string | null    { return this.userIdSig(); }
  getFileKey():      CryptoKey | null { return this.kekSig(); }
  getECPrivateKey(): CryptoKey | null { return this.ecPrivateKeySig(); }

  // ─── Сессия ──────────────────────────────────────────────────────────────

  tryRestoreSession(): Observable<boolean> {
    return this.http.post<RefreshResponse>(`${this.baseUrl}/refresh`, {}).pipe(
      tap(t => this.setAccessToken(t.access_token)),
      switchMap(t => from(this.tryRestoreKeysFromClientKey(t))),
      map(() => true),
      catchError(() => of(false)),
    );
  }

  async unlockSession(password: string): Promise<void> {
    const resp = await firstValueFrom(this.http.post<RefreshResponse>(`${this.baseUrl}/refresh`, {}));
    const masterKey = await this.crypto.deriveMasterKey(password, new Uint8Array(fromBase64(resp.crypto_salt)));
    let kek: CryptoKey;
    try {
      kek = await this.crypto.unwrapKEK(resp.kek_encrypted_master, masterKey);
    } catch {
      throw new Error('Неверный пароль.');
    }
    this.masterKeySig.set(masterKey);
    this.kekSig.set(kek);
    await this.loadECPrivateKey(resp.encrypted_private_key);
    this.setAccessToken(resp.access_token);
    await this.savePasswordBlob(password, resp.client_key);
  }

  // SRP-6a + Argon2id. Пароль браузер не покидает.
  register(email: string, password: string): Observable<void> {
    const blocked = this.crypto.webCryptoBlockedMessage();
    if (blocked) return throwError(() => new Error(blocked));
    return from(this.registerFlow(email, password));
  }

  // SRP-6a, два шага. M2 от сервера верифицируется — защита от MITM.
  login(email: string, password: string): Observable<void> {
    const blocked = this.crypto.webCryptoBlockedMessage();
    if (blocked) return throwError(() => new Error(blocked));
    return from(this.loginFlow(email, password));
  }

  refreshSession(): Observable<void> {
    return this.http.post<RefreshResponse>(`${this.baseUrl}/refresh`, {}).pipe(
      tap(t => this.setAccessToken(t.access_token)),
      map(() => void 0),
    );
  }

  startOrJoinRefresh(): Observable<void> {
    if (!this.refreshInFlight$) {
      this.refreshInFlight$ = this.refreshSession().pipe(
        share({ resetOnError: true, resetOnComplete: true }),
        finalize(() => { this.refreshInFlight$ = null; }),
      );
    }
    return this.refreshInFlight$;
  }

  logout(): void {
    // Clear state synchronously so guards see 'unauthenticated' on the next navigation.
    this.clearAccess();
    this.lsRemove(LS_EMAIL, LS_CK_BLOB, LS_SESSION_EXISTED);
    this.emailSig.set(null);
    // Fire HTTP logout best-effort — the refresh cookie is cleared server-side.
    this.http.post<void>(`${this.baseUrl}/logout`, {}).pipe(take(1)).subscribe({ error: () => {} });
  }

  clearAccess(): void {
    this.accessTokenSig.set(null);
    this.masterKeySig.set(null);
    this.kekSig.set(null);
    this.ecPrivateKeySig.set(null);
    this.userIdSig.set(null);
  }

  hadSession(): boolean {
    return !!this.lsRead(LS_SESSION_EXISTED);
  }

  clearRecoveryPhrase(): void {
    this._recoveryPhrase.set(null);
  }

  requestPasswordReset(email: string): Observable<void> {
    return this.http.post<void>(`${this.baseUrl}/reset-password/request`, { email }).pipe(map(() => void 0));
  }

  resetPassword(token: string, recoveryPhrase: string, newPassword: string): Observable<void> {
    return from(this.resetPasswordFlow(token, recoveryPhrase, newPassword));
  }

  // ─── Приватные: localStorage ─────────────────────────────────────────────

  private lsRead(key: string): string | null {
    try { return localStorage.getItem(key) || null; } catch { return null; }
  }

  private lsWrite(key: string, value: string): void {
    try { localStorage.setItem(key, value); } catch {}
  }

  private lsRemove(...keys: string[]): void {
    for (const key of keys) {
      try { localStorage.removeItem(key); } catch {}
    }
  }

  // ─── Приватные: ключи ────────────────────────────────────────────────────

  private setEmail(email: string): void {
    this.lsWrite(LS_EMAIL, email);
    this.emailSig.set(email);
  }

  private async loadECPrivateKey(encB64: string): Promise<void> {
    const kek = this.kekSig();
    if (!kek) return;
    try {
      this.ecPrivateKeySig.set(await this.crypto.unwrapECPrivateKey(encB64, kek));
    } catch {}
  }

  private async loadKEK(kekEncryptedMasterB64: string, masterKey: CryptoKey): Promise<void> {
    this.kekSig.set(await this.crypto.unwrapKEK(kekEncryptedMasterB64, masterKey));
  }

  private async savePasswordBlob(password: string, clientKeyB64: string): Promise<void> {
    try {
      this.lsWrite(LS_CK_BLOB, await this.crypto.encryptWithClientKey(password, clientKeyB64));
    } catch {}
  }

  private async tryRestoreKeysFromClientKey(tokenResp: RefreshResponse): Promise<void> {
    const blob = this.lsRead(LS_CK_BLOB);
    if (!blob) return;
    try {
      const password  = await this.crypto.decryptWithClientKey(blob, tokenResp.client_key);
      const masterKey = await this.crypto.deriveMasterKey(
        password,
        new Uint8Array(fromBase64(tokenResp.crypto_salt)),
      );
      let kek: CryptoKey;
      try {
        kek = await this.crypto.unwrapKEK(tokenResp.kek_encrypted_master, masterKey);
      } catch {
        // Пароль сменился — blob устарел.
        this.lsRemove(LS_CK_BLOB);
        return;
      }
      this.masterKeySig.set(masterKey);
      this.kekSig.set(kek);
      await this.loadECPrivateKey(tokenResp.encrypted_private_key);
      await this.savePasswordBlob(password, tokenResp.client_key);
    } catch {}
  }

  private setAccessToken(accessToken: string): void {
    const t = accessToken.trim();
    if (!t) { this.clearAccess(); return; }
    this.lsWrite(LS_SESSION_EXISTED, '1');
    this.accessTokenSig.set(t);
    try {
      const part = t.split('.').at(1);
      if (!part) throw new Error();
      // URL-safe base64 → standard base64
      const payload = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
      this.userIdSig.set(typeof payload.sub === 'string' ? payload.sub : null);
    } catch {
      this.userIdSig.set(null);
    }
  }

  // ─── Приватные: флоу ─────────────────────────────────────────────────────

  private async registerFlow(email: string, password: string): Promise<void> {
    const { srpSalt, srpVerifier, bcryptSalt } = await this.srp.createVerifier(password);

    const cryptoSalt     = this.crypto.generateSalt();
    const masterKey      = await this.crypto.deriveMasterKey(password, cryptoSalt);
    const recoveryPhrase = this.crypto.generateRecoveryPhrase();
    const recoverySalt   = this.crypto.generateSalt();
    const recoveryKey    = await this.crypto.deriveRecoveryKey(recoveryPhrase, recoverySalt);
    const kek            = await this.crypto.generateKEK();

    const kekEncryptedMaster   = await this.crypto.wrapKEK(kek, masterKey);
    const kekEncryptedRecovery = await this.crypto.wrapKEK(kek, recoveryKey);

    // EC private key оборачивается KEK-ом, а не masterKey — переживает смену пароля.
    const { publicKeyB64, encryptedPrivateKeyB64 } = await this.crypto.generateECKeyPair(kek);

    const payload: RegisterRequest = {
      email,
      srp_salt:               srpSalt,
      srp_verifier:           srpVerifier,
      bcrypt_salt:            bcryptSalt,
      crypto_salt:            toBase64(cryptoSalt),
      public_key:             publicKeyB64,
      encrypted_private_key:  encryptedPrivateKeyB64,
      kek_encrypted_master:   kekEncryptedMaster,
      kek_encrypted_recovery: kekEncryptedRecovery,
      recovery_salt:          toBase64(recoverySalt),
    };

    const resp = await firstValueFrom(this.http.post<RegisterResponse>(`${this.baseUrl}/register`, payload));

    this.masterKeySig.set(masterKey);
    this.kekSig.set(kek);
    this._recoveryPhrase.set(recoveryPhrase);
    try {
      this.ecPrivateKeySig.set(await this.crypto.unwrapECPrivateKey(encryptedPrivateKeyB64, kek));
    } catch {}
    this.setEmail(email.trim().toLowerCase());
    this.setAccessToken(resp.access_token);
    await this.savePasswordBlob(password, resp.client_key);
  }

  private async loginFlow(email: string, password: string): Promise<void> {
    const normalizedEmail = email.trim().toLowerCase();
    const { a, AHex }     = this.srp.createClientEphemeral();

    const initResp = await firstValueFrom(
      this.http.post<LoginInitResponse>(
        `${this.baseUrl}/login/init`,
        { email: normalizedEmail, A: AHex } as LoginInitRequest,
      )
    );

    // bcrypt внутри — занимает ~100 мс.
    const { M1Hex, verifyM2 } = await this.srp.computeClientProof({
      email: normalizedEmail,
      password,
      a,
      AHex,
      B:          initResp.B,
      srpSalt:    initResp.srp_salt,
      bcryptSalt: initResp.bcrypt_salt,
    });

    const finalResp = await firstValueFrom(
      this.http.post<LoginFinalizeResponse>(
        `${this.baseUrl}/login/finalize`,
        { session_id: initResp.session_id, M1: M1Hex } as LoginFinalizeRequest,
      )
    );

    if (!finalResp.M2 || !verifyM2(finalResp.M2)) {
      throw new Error('SRP: server proof (M2) verification failed — possible MITM attack');
    }


    const masterKey = await this.crypto.deriveMasterKey(
      password,
      new Uint8Array(fromBase64(initResp.crypto_salt)),
    );

    this.masterKeySig.set(masterKey);
    await this.loadKEK(finalResp.kek_encrypted_master, masterKey);
    await this.loadECPrivateKey(finalResp.encrypted_private_key);
    this.setEmail(normalizedEmail);
    this.setAccessToken(finalResp.access_token);
    await this.savePasswordBlob(password, finalResp.client_key);
  }

  private async resetPasswordFlow(token: string, recoveryPhrase: string, newPassword: string): Promise<void> {
    // Токен в теле POST — не попадает в URL и логи сервера.
    const recoveryData = await firstValueFrom(
      this.http.post<{ kek_encrypted_recovery: string; recovery_salt: string }>(
        `${this.baseUrl}/reset-password/recovery-data`, { token }
      )
    );

    const recoveryKey = await this.crypto.deriveRecoveryKey(
      recoveryPhrase,
      new Uint8Array(fromBase64(recoveryData.recovery_salt)),
    );
    const kek = await this.crypto.unwrapKEK(recoveryData.kek_encrypted_recovery, recoveryKey);

    const { srpSalt, srpVerifier, bcryptSalt } = await this.srp.createVerifier(newPassword);
    const newCryptoSalt = this.crypto.generateSalt();
    const newMasterKey  = await this.crypto.deriveMasterKey(newPassword, newCryptoSalt);

    // Rotate recovery phrase — old phrase becomes invalid after this (Dashlane single-use model).
    const newRecoveryPhrase = this.crypto.generateRecoveryPhrase();
    const newRecoverySalt   = this.crypto.generateSalt();
    const newRecoveryKey    = await this.crypto.deriveRecoveryKey(newRecoveryPhrase, newRecoverySalt);

    await firstValueFrom(
      this.http.post<void>(`${this.baseUrl}/reset-password/confirm`, {
        token,
        srp_salt:               srpSalt,
        srp_verifier:           srpVerifier,
        bcrypt_salt:            bcryptSalt,
        crypto_salt:            toBase64(newCryptoSalt),
        kek_encrypted_master:   await this.crypto.wrapKEK(kek, newMasterKey),
        kek_encrypted_recovery: await this.crypto.wrapKEK(kek, newRecoveryKey),
        recovery_salt:          toBase64(newRecoverySalt),
      })
    );

    // Store new phrase for one-time display — consumed by the component immediately after navigation.
    this._recoveryPhrase.set(newRecoveryPhrase);
  }
}
