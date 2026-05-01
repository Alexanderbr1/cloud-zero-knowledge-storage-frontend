import { Injectable } from '@angular/core';

/**
 * CryptoService — всё шифрование на стороне клиента.
 *
 * Алгоритмы:
 *  - Деривация ключа : PBKDF2-SHA256, 310 000 итераций (OWASP 2025)
 *  - Шифрование файла: AES-256-GCM, случайный 96-bit IV на каждый файл
 *  - Обёртка ключа   : AES-KW (RFC 3394) — нет уязвимости ECB как у MEGA
 *
 * Мастер-ключ НИКОГДА не покидает память браузера.
 */
@Injectable({ providedIn: 'root' })
export class CryptoService {
  /**
   * Web Crypto `subtle` есть только в «безопасном контексте» (HTTPS или http://localhost).
   * На http://192.168.x.x и аналогах регистрация/шифрование не работают — до запроса на сервер.
   */
  webCryptoBlockedMessage(): string | null {
    if (typeof globalThis === 'undefined' || !globalThis.crypto) {
      return 'В этом окружении нет Web Crypto API. Откройте приложение в современном браузере.';
    }
    if (!globalThis.crypto.subtle) {
      return (
        'Шифрование недоступно: нужен безопасный контекст (HTTPS или http://localhost). ' +
        'Не открывайте приложение по IP в локальной сети по HTTP — используйте localhost, ng serve --host localhost или HTTPS.'
      );
    }
    return null;
  }

  private requireSubtle(): SubtleCrypto {
    const msg = this.webCryptoBlockedMessage();
    if (msg) {
      throw new Error(msg);
    }
    return globalThis.crypto.subtle;
  }

  // ─── Утилиты base64 ──────────────────────────────────────────────────────

  toBase64(source: ArrayBuffer | Uint8Array): string {
    const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  fromBase64(b64: string): ArrayBuffer {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  // ─── Генерация соли ──────────────────────────────────────────────────────

  generateSalt(): Uint8Array {
    if (!globalThis.crypto?.getRandomValues) {
      throw new Error(this.webCryptoBlockedMessage() ?? 'Web Crypto недоступен.');
    }
    return globalThis.crypto.getRandomValues(new Uint8Array(32));
  }

  // ─── Деривация мастер-ключа ──────────────────────────────────────────────

  /**
   * PBKDF2-SHA256, 310 000 итераций.
   * Результат — non-extractable AES-KW ключ (только для wrap/unwrap файловых ключей).
   */
  async deriveMasterKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
    const subtle = this.requireSubtle();
    const enc = new TextEncoder();

    const passwordKey = await subtle.importKey(
      'raw',
      enc.encode(password),
      'PBKDF2',
      false,
      ['deriveKey']
    );

    // Копируем байты в явный ArrayBuffer — гарантирует совместимость с Web Crypto API
    // в любой версии TypeScript (начиная с 5.4) без SharedArrayBuffer-неоднозначности.
    const saltBuf = new ArrayBuffer(salt.byteLength);
    new Uint8Array(saltBuf).set(salt);

    return subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: saltBuf,
        iterations: 310_000,
        hash: 'SHA-256'
      },
      passwordKey,
      { name: 'AES-KW', length: 256 },
      false, // non-extractable — ключ не покидает память
      ['wrapKey', 'unwrapKey']
    );
  }

  // ─── Файловые ключи ──────────────────────────────────────────────────────

  async generateFileKey(): Promise<CryptoKey> {
    const subtle = this.requireSubtle();
    return subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true, // extractable — нужен для wrapKey
      ['encrypt', 'decrypt']
    );
  }

  async wrapFileKey(fileKey: CryptoKey, masterKey: CryptoKey): Promise<string> {
    const subtle = this.requireSubtle();
    const wrapped = await subtle.wrapKey('raw', fileKey, masterKey, 'AES-KW');
    return this.toBase64(wrapped);
  }

  async unwrapFileKey(wrappedKeyB64: string, masterKey: CryptoKey): Promise<CryptoKey> {
    const subtle = this.requireSubtle();
    const wrappedKey = this.fromBase64(wrappedKeyB64);
    return subtle.unwrapKey(
      'raw',
      wrappedKey,
      masterKey,
      'AES-KW',
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    );
  }

  // ─── Unlock check ────────────────────────────────────────────────────────

  /**
   * Создаёт unlock-check: оборачивает случайный AES-GCM ключ мастер-ключом (AES-KW).
   * Результат хранится в localStorage и используется для верификации пароля при разблокировке.
   * AES-KW имеет встроенную проверку целостности (RFC 3394) — unwrap с неверным ключом бросит ошибку.
   */
  async createUnlockCheck(masterKey: CryptoKey): Promise<string> {
    const sentinelKey = await this.generateFileKey();
    return this.wrapFileKey(sentinelKey, masterKey);
  }

  async verifyUnlockCheck(wrappedB64: string, masterKey: CryptoKey): Promise<boolean> {
    try {
      await this.unwrapFileKey(wrappedB64, masterKey);
      return true;
    } catch {
      return false;
    }
  }

  // ─── EC ключи (P-256 ECDH) ───────────────────────────────────────────────

  /**
   * Generates a P-256 key pair for ECIES file sharing.
   * Returns the public key as SPKI base64 and an opaque encrypted blob for the private key.
   *
   * Private key storage format (concatenated bytes, then base64):
   *   [40 bytes] AES-KW(masterKey, aesKwk)   — wraps the intermediate AES-256 key
   *   [12 bytes] IV for AES-GCM
   *   [N  bytes] AES-GCM(aesKwk, PKCS8(privateKey)) + 16-byte GCM tag
   */
  async generateECKeyPair(masterKey: CryptoKey): Promise<{ publicKeyB64: string; encryptedPrivateKeyB64: string }> {
    const subtle = this.requireSubtle();

    const keyPair = await subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveKey', 'deriveBits'],
    );

    const spki = await subtle.exportKey('spki', keyPair.publicKey);
    const pkcs8 = await subtle.exportKey('pkcs8', keyPair.privateKey);

    const encryptedPrivateKeyB64 = await this.wrapECPrivateKey(new Uint8Array(pkcs8), masterKey);
    return {
      publicKeyB64: this.toBase64(spki),
      encryptedPrivateKeyB64,
    };
  }

  /** Wraps raw PKCS8 bytes using a two-level scheme: AES-GCM(aesKwk) + AES-KW(masterKey). */
  async wrapECPrivateKey(pkcs8: Uint8Array, masterKey: CryptoKey): Promise<string> {
    const subtle = this.requireSubtle();

    // Intermediate AES-256 key (KWK) — encrypts the PKCS8 blob via AES-GCM.
    const kwk = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await subtle.encrypt({ name: 'AES-GCM', iv }, kwk, pkcs8);

    // Wrap the KWK with the master key via AES-KW (40 bytes for AES-256).
    const wrappedKwk = await subtle.wrapKey('raw', kwk, masterKey, 'AES-KW');

    // Concatenate: wrappedKwk (40) | iv (12) | ciphertext+tag
    const out = new Uint8Array(wrappedKwk.byteLength + 12 + ciphertext.byteLength);
    out.set(new Uint8Array(wrappedKwk), 0);
    out.set(iv, wrappedKwk.byteLength);
    out.set(new Uint8Array(ciphertext), wrappedKwk.byteLength + 12);
    return this.toBase64(out);
  }

  async unwrapECPrivateKey(encryptedB64: string, masterKey: CryptoKey): Promise<CryptoKey> {
    const subtle = this.requireSubtle();
    const buf = new Uint8Array(this.fromBase64(encryptedB64));

    // 40 (wrapped KWK) + 12 (IV) + 1 (min plaintext) + 16 (GCM tag) = 69 bytes minimum.
    if (buf.length < 69) {
      throw new Error('Invalid encrypted private key format');
    }

    const wrappedKwk = buf.slice(0, 40);
    const iv = buf.slice(40, 52);
    const ciphertext = buf.slice(52);

    // Unwrap the intermediate AES-KW key.
    const kwk = await subtle.unwrapKey(
      'raw', wrappedKwk, masterKey, 'AES-KW',
      { name: 'AES-GCM', length: 256 }, true, ['decrypt'],
    );

    // Decrypt PKCS8 bytes.
    const pkcs8 = await subtle.decrypt({ name: 'AES-GCM', iv }, kwk, ciphertext);

    return subtle.importKey(
      'pkcs8', pkcs8,
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      ['deriveKey', 'deriveBits'],
    );
  }

  /**
   * Derives a KEK from an ECDH shared secret using HKDF-SHA256.
   * The derived key is AES-KW 256-bit, used to wrap/unwrap a file key.
   */
  private async deriveShareKEK(ecdhSharedSecret: ArrayBuffer): Promise<CryptoKey> {
    const subtle = this.requireSubtle();
    const keyMaterial = await subtle.importKey('raw', ecdhSharedSecret, { name: 'HKDF' }, false, ['deriveKey']);
    return subtle.deriveKey(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: new Uint8Array(32),
        info: new TextEncoder().encode('cloud-file-share'),
      },
      keyMaterial,
      { name: 'AES-KW', length: 256 },
      false,
      ['wrapKey', 'unwrapKey'],
    );
  }

  /**
   * Wraps the file key for a recipient using ECIES:
   *   ephemeral P-256 keygen → ECDH(ephemeral_priv, recipient_pub) → HKDF → AES-KW(kek, fileKey)
   *
   * Returns base64-encoded ephemeral public key (SPKI) and wrapped file key.
   * The caller must send both to the server when creating a share.
   */
  async encryptFileKeyForRecipient(
    fileKey: CryptoKey,
    recipientPublicKeyB64: string,
  ): Promise<{ ephemeralPubB64: string; wrappedFileKeyB64: string }> {
    const subtle = this.requireSubtle();

    const recipientPub = await subtle.importKey(
      'spki', this.fromBase64(recipientPublicKeyB64),
      { name: 'ECDH', namedCurve: 'P-256' }, false, [],
    );

    const ephemeral = await subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'],
    );

    const sharedSecret = await subtle.deriveBits(
      { name: 'ECDH', public: recipientPub },
      ephemeral.privateKey,
      256,
    );

    const kek = await this.deriveShareKEK(sharedSecret);
    const wrappedFileKey = await subtle.wrapKey('raw', fileKey, kek, 'AES-KW');
    const ephemeralPub = await subtle.exportKey('spki', ephemeral.publicKey);

    return {
      ephemeralPubB64: this.toBase64(ephemeralPub),
      wrappedFileKeyB64: this.toBase64(wrappedFileKey),
    };
  }

  /**
   * Unwraps a shared file key using the recipient's EC private key and the sender's ephemeral public key.
   * Returns a non-extractable AES-GCM CryptoKey ready for decryption.
   */
  async decryptFileKeyFromShare(
    wrappedFileKeyB64: string,
    ephemeralPubB64: string,
    recipientPrivateKey: CryptoKey,
  ): Promise<CryptoKey> {
    const subtle = this.requireSubtle();

    const ephemeralPub = await subtle.importKey(
      'spki', this.fromBase64(ephemeralPubB64),
      { name: 'ECDH', namedCurve: 'P-256' }, false, [],
    );

    const sharedSecret = await subtle.deriveBits(
      { name: 'ECDH', public: ephemeralPub },
      recipientPrivateKey,
      256,
    );

    const kek = await this.deriveShareKEK(sharedSecret);
    return subtle.unwrapKey(
      'raw', this.fromBase64(wrappedFileKeyB64), kek, 'AES-KW',
      { name: 'AES-GCM', length: 256 }, false, ['decrypt'],
    );
  }

  /**
   * Unwraps a file key with extractable=true so it can be re-wrapped for sharing.
   * Only call this in the context of creating a share — the key never leaves the browser.
   */
  async unwrapFileKeyForSharing(wrappedKeyB64: string, masterKey: CryptoKey): Promise<CryptoKey> {
    const subtle = this.requireSubtle();
    return subtle.unwrapKey(
      'raw', this.fromBase64(wrappedKeyB64), masterKey, 'AES-KW',
      { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'],
    );
  }

  // ─── Шифрование / дешифрование файлов ───────────────────────────────────

  /**
   * Шифрует ArrayBuffer файлом ключом (AES-256-GCM).
   * Генерирует случайный 96-bit IV.
   * Возвращает зашифрованный контент и IV (оба в base64).
   */
  async encryptFile(
    data: ArrayBuffer,
    fileKey: CryptoKey
  ): Promise<{ ciphertext: ArrayBuffer; ivB64: string }> {
    const subtle = this.requireSubtle();
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12)); // 96 бит (NIST SP 800-38D)

    const ciphertext = await subtle.encrypt(
      { name: 'AES-GCM', iv },
      fileKey,
      data
    );

    return { ciphertext, ivB64: this.toBase64(iv) };
  }

  async decryptFile(
    ciphertext: ArrayBuffer,
    fileKey: CryptoKey,
    ivB64: string
  ): Promise<ArrayBuffer> {
    const subtle = this.requireSubtle();
    const iv = this.fromBase64(ivB64);

    return subtle.decrypt(
      { name: 'AES-GCM', iv },
      fileKey,
      ciphertext
    );
  }
}
