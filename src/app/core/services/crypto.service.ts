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
  private readonly subtle = window.crypto.subtle;

  // ─── Утилиты base64 ──────────────────────────────────────────────────────

  toBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
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

  /** Генерирует случайные 16 байт соли для PBKDF2. */
  generateSalt(): Uint8Array {
    return window.crypto.getRandomValues(new Uint8Array(16));
  }

  // ─── Деривация мастер-ключа ──────────────────────────────────────────────

  /**
   * PBKDF2-SHA256, 310 000 итераций.
   * Результат — non-extractable AES-KW ключ (только для wrap/unwrap файловых ключей).
   */
  async deriveMasterKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
    const enc = new TextEncoder();

    const passwordKey = await this.subtle.importKey(
      'raw',
      enc.encode(password),
      'PBKDF2',
      false,
      ['deriveKey']
    );

    return this.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt,
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
    return this.subtle.generateKey(
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
    const wrapped = await this.subtle.wrapKey('raw', fileKey, masterKey, 'AES-KW');
    return this.toBase64(wrapped);
  }

  /**
   * Разворачивает файловый ключ из base64 мастер-ключом.
   * Результат — non-extractable AES-GCM ключ.
   */
  async unwrapFileKey(wrappedKeyB64: string, masterKey: CryptoKey): Promise<CryptoKey> {
    const wrappedKey = this.fromBase64(wrappedKeyB64);
    return this.subtle.unwrapKey(
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
    const iv = window.crypto.getRandomValues(new Uint8Array(12)); // 96 бит (NIST SP 800-38D)

    const ciphertext = await this.subtle.encrypt(
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
    const iv = this.fromBase64(ivB64);

    return this.subtle.decrypt(
      { name: 'AES-GCM', iv },
      fileKey,
      ciphertext
    );
  }
}
