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

  /** Генерирует случайные 32 байта соли для PBKDF2. */
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

  /** Генерирует уникальный AES-256-GCM ключ для каждого файла. */
  async generateFileKey(): Promise<CryptoKey> {
    const subtle = this.requireSubtle();
    return subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true, // extractable — нужен для wrapKey
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Оборачивает файловый ключ мастер-ключом (AES-KW, RFC 3394).
   * Возвращает base64-строку для хранения на сервере.
   */
  async wrapFileKey(fileKey: CryptoKey, masterKey: CryptoKey): Promise<string> {
    const subtle = this.requireSubtle();
    const wrapped = await subtle.wrapKey('raw', fileKey, masterKey, 'AES-KW');
    return this.toBase64(wrapped);
  }

  /**
   * Разворачивает файловый ключ из base64 мастер-ключом.
   * Результат — non-extractable AES-GCM ключ.
   */
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

  /**
   * Дешифрует ArrayBuffer файловым ключом.
   * AES-GCM встроенно проверяет аутентификационный тег — если данные подделаны, выбросит ошибку.
   */
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
