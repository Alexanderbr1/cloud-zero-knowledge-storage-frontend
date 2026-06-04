import { Injectable } from '@angular/core';
import { argon2id } from 'hash-wasm';
import { BIP39_WORDLIST } from './bip39-wordlist';
import { fromBase64, toBase64 } from '../utils/encoding.utils';

// Алгоритмы: Argon2id (m=65536, t=3, p=4) · AES-256-GCM · AES-KW · P-256 ECDH + HKDF-SHA256

// Each chunked frame = [12 bytes IV][ciphertext + 16 bytes GCM tag].
// 8 MiB keeps each S3 multipart part well above the 5 MiB minimum.
export const CHUNK_SIZE = 8 * 1024 * 1024; // 8 MiB
export const FRAME_OVERHEAD = 12 + 16; // IV + GCM tag

const ARGON2_PARAMS = {
  memorySize: 65536,
  iterations: 3,
  parallelism: 4,
  hashLength: 32,
  outputType: 'binary',
} as const;

const SHARE_INFO = new TextEncoder().encode('cloud-file-share');

@Injectable({ providedIn: 'root' })
export class CryptoService {
  // ─── Web Crypto guard ────────────────────────────────────────────────────

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
    if (msg) throw new Error(msg);
    return globalThis.crypto.subtle;
  }

  // ─── Соль ────────────────────────────────────────────────────────────────

  generateSalt(): Uint8Array {
    if (!globalThis.crypto?.getRandomValues) {
      throw new Error(
        this.webCryptoBlockedMessage() ?? 'Web Crypto недоступен.',
      );
    }
    return globalThis.crypto.getRandomValues(new Uint8Array(32));
  }

  // ─── Деривация ключей ────────────────────────────────────────────────────

  async deriveMasterKey(
    password: string,
    salt: Uint8Array,
  ): Promise<CryptoKey> {
    return this.argon2idKey(password, salt);
  }

  async deriveRecoveryKey(
    phrase: string,
    salt: Uint8Array,
  ): Promise<CryptoKey> {
    return this.argon2idKey(phrase.trim().split(/\s+/).join(' '), salt);
  }

  // ─── KEK ─────────────────────────────────────────────────────────────────

  async generateKEK(): Promise<CryptoKey> {
    return this.requireSubtle().generateKey(
      { name: 'AES-KW', length: 256 },
      true,
      ['wrapKey', 'unwrapKey'],
    );
  }

  async wrapKEK(kek: CryptoKey, wrappingKey: CryptoKey): Promise<string> {
    return toBase64(
      await this.requireSubtle().wrapKey('raw', kek, wrappingKey, 'AES-KW'),
    );
  }

  async unwrapKEK(
    wrappedB64: string,
    wrappingKey: CryptoKey,
  ): Promise<CryptoKey> {
    return this.requireSubtle().unwrapKey(
      'raw',
      fromBase64(wrappedB64),
      wrappingKey,
      'AES-KW',
      { name: 'AES-KW', length: 256 },
      true,
      ['wrapKey', 'unwrapKey'],
    );
  }

  // ─── Recovery phrase ─────────────────────────────────────────────────────

  generateRecoveryPhrase(): string {
    const indices = new Uint16Array(12);
    globalThis.crypto.getRandomValues(indices);
    return Array.from(indices, (n) => BIP39_WORDLIST[n % 2048]).join(' ');
  }

  // ─── ClientKey blob ──────────────────────────────────────────────────────

  // Формат blob: base64(iv[12] | ciphertext+tag)
  async encryptWithClientKey(
    plaintext: string,
    clientKeyB64: string,
  ): Promise<string> {
    const subtle = this.requireSubtle();
    const key = await subtle.importKey(
      'raw',
      fromBase64(clientKeyB64),
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt'],
    );
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const cipher = await subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      new TextEncoder().encode(plaintext),
    );
    const out = new Uint8Array(12 + cipher.byteLength);
    out.set(iv, 0);
    out.set(new Uint8Array(cipher), 12);
    return toBase64(out);
  }

  async decryptWithClientKey(
    blobB64: string,
    clientKeyB64: string,
  ): Promise<string> {
    const subtle = this.requireSubtle();
    const key = await subtle.importKey(
      'raw',
      fromBase64(clientKeyB64),
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt'],
    );
    const buf = new Uint8Array(fromBase64(blobB64));
    if (buf.length < 29) throw new Error('Invalid client key blob');
    const plain = await subtle.decrypt(
      { name: 'AES-GCM', iv: buf.slice(0, 12) },
      key,
      buf.slice(12),
    );
    return new TextDecoder().decode(plain);
  }

  // ─── Файловые ключи ──────────────────────────────────────────────────────

  async generateFileKey(): Promise<CryptoKey> {
    // extractable: true — нужен для wrapKey при загрузке и шаринге
    return this.requireSubtle().generateKey(
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt'],
    );
  }

  async wrapFileKey(fileKey: CryptoKey, kek: CryptoKey): Promise<string> {
    return toBase64(
      await this.requireSubtle().wrapKey('raw', fileKey, kek, 'AES-KW'),
    );
  }

  async unwrapFileKey(
    wrappedKeyB64: string,
    kek: CryptoKey,
  ): Promise<CryptoKey> {
    return this.requireSubtle().unwrapKey(
      'raw',
      fromBase64(wrappedKeyB64),
      kek,
      'AES-KW',
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt'],
    );
  }

  // Unwraps the file key and exports raw bytes — needed by the Service Worker
  // which cannot receive CryptoKey objects across the message channel.
  async unwrapFileKeyRaw(
    wrappedKeyB64: string,
    kek: CryptoKey,
  ): Promise<ArrayBuffer> {
    const key = await this.requireSubtle().unwrapKey(
      'raw',
      fromBase64(wrappedKeyB64),
      kek,
      'AES-KW',
      { name: 'AES-GCM', length: 256 },
      true,
      ['decrypt'],
    );
    return this.requireSubtle().exportKey('raw', key);
  }

  // extractable: true — требуется для re-wrap при создании шары
  async unwrapFileKeyForSharing(
    wrappedKeyB64: string,
    kek: CryptoKey,
  ): Promise<CryptoKey> {
    return this.requireSubtle().unwrapKey(
      'raw',
      fromBase64(wrappedKeyB64),
      kek,
      'AES-KW',
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt'],
    );
  }

  // ─── EC ключи (P-256 ECDH) ───────────────────────────────────────────────

  async generateECKeyPair(
    wrappingKey: CryptoKey,
  ): Promise<{ publicKeyB64: string; encryptedPrivateKeyB64: string }> {
    const subtle = this.requireSubtle();
    const keyPair = await subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveKey', 'deriveBits'],
    );
    const spki = await subtle.exportKey('spki', keyPair.publicKey);
    const pkcs8 = await subtle.exportKey('pkcs8', keyPair.privateKey);
    return {
      publicKeyB64: toBase64(spki),
      encryptedPrivateKeyB64: await this.wrapECPrivateKey(
        new Uint8Array(pkcs8),
        wrappingKey,
      ),
    };
  }

  async unwrapECPrivateKey(
    encryptedB64: string,
    wrappingKey: CryptoKey,
  ): Promise<CryptoKey> {
    const subtle = this.requireSubtle();
    const buf = new Uint8Array(fromBase64(encryptedB64));
    // 40 (wrappedKwk) + 12 (iv) + 1 (min data) + 16 (GCM tag) = 69
    if (buf.length < 69)
      throw new Error('Invalid encrypted private key format');

    const kwk = await subtle.unwrapKey(
      'raw',
      buf.slice(0, 40),
      wrappingKey,
      'AES-KW',
      { name: 'AES-GCM', length: 256 },
      true,
      ['decrypt'],
    );
    const pkcs8 = await subtle.decrypt(
      { name: 'AES-GCM', iv: buf.slice(40, 52) },
      kwk,
      buf.slice(52),
    );
    return subtle.importKey(
      'pkcs8',
      pkcs8,
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      ['deriveKey', 'deriveBits'],
    );
  }

  // ─── ECIES (шаринг файлов) ───────────────────────────────────────────────

  async encryptFileKeyForRecipient(
    fileKey: CryptoKey,
    recipientPublicKeyB64: string,
  ): Promise<{ ephemeralPubB64: string; wrappedFileKeyB64: string }> {
    const subtle = this.requireSubtle();
    const recipientPub = await subtle.importKey(
      'spki',
      fromBase64(recipientPublicKeyB64),
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      [],
    );
    const ephemeral = await subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveBits'],
    );
    const sharedSecret = await subtle.deriveBits(
      { name: 'ECDH', public: recipientPub },
      ephemeral.privateKey,
      256,
    );
    const ephemeralPub = await subtle.exportKey('spki', ephemeral.publicKey);
    const kek = await this.deriveShareKEK(sharedSecret, ephemeralPub);
    return {
      ephemeralPubB64: toBase64(ephemeralPub),
      wrappedFileKeyB64: toBase64(
        await subtle.wrapKey('raw', fileKey, kek, 'AES-KW'),
      ),
    };
  }

  async decryptFileKeyFromShare(
    wrappedFileKeyB64: string,
    ephemeralPubB64: string,
    recipientPrivateKey: CryptoKey,
  ): Promise<CryptoKey> {
    const subtle = this.requireSubtle();
    const ephemeralPubBytes = fromBase64(ephemeralPubB64);
    const ephemeralPub = await subtle.importKey(
      'spki',
      ephemeralPubBytes,
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      [],
    );
    const sharedSecret = await subtle.deriveBits(
      { name: 'ECDH', public: ephemeralPub },
      recipientPrivateKey,
      256,
    );
    const kek = await this.deriveShareKEK(sharedSecret, ephemeralPubBytes);
    return subtle.unwrapKey(
      'raw',
      fromBase64(wrappedFileKeyB64),
      kek,
      'AES-KW',
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt'],
    );
  }

  // ─── Шифрование файлов ───────────────────────────────────────────────────

  async encryptFile(
    data: ArrayBuffer,
    fileKey: CryptoKey,
    aad?: Uint8Array,
  ): Promise<{ ciphertext: ArrayBuffer; ivB64: string }> {
    const subtle = this.requireSubtle();
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const cipher = await subtle.encrypt(
      { name: 'AES-GCM', iv, ...(aad ? { additionalData: aad } : {}) },
      fileKey,
      data,
    );
    return { ciphertext: cipher, ivB64: toBase64(iv) };
  }

  async decryptFile(
    ciphertext: ArrayBuffer,
    fileKey: CryptoKey,
    ivB64: string,
    aad?: Uint8Array,
  ): Promise<ArrayBuffer> {
    return this.requireSubtle().decrypt(
      {
        name: 'AES-GCM',
        iv: fromBase64(ivB64),
        ...(aad ? { additionalData: aad } : {}),
      },
      fileKey,
      ciphertext,
    );
  }

  // ─── Chunked encryption ──────────────────────────────────────────────────

  // Encrypts a single plaintext chunk and returns one frame [12 IV][ct+tag].
  // Used by the multipart upload path — caller reads one File.slice at a time.
  async encryptChunk(
    chunk: ArrayBuffer,
    fileKey: CryptoKey,
    aad?: Uint8Array,
  ): Promise<ArrayBuffer> {
    const subtle = this.requireSubtle();
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const cipher = await subtle.encrypt(
      { name: 'AES-GCM', iv, ...(aad ? { additionalData: aad } : {}) },
      fileKey,
      chunk,
    );
    const frame = new Uint8Array(12 + cipher.byteLength);
    frame.set(iv, 0);
    frame.set(new Uint8Array(cipher), 12);
    return frame.buffer;
  }

  // Encrypts `data` as a sequence of frames concatenated into one ArrayBuffer.
  // Used by the benchmark and tests; production upload uses encryptChunk per part.
  async encryptFileChunked(
    data: ArrayBuffer,
    fileKey: CryptoKey,
    aad?: Uint8Array,
  ): Promise<ArrayBuffer> {
    const src = new Uint8Array(data);
    const chunkCount = Math.ceil(src.byteLength / CHUNK_SIZE) || 1;
    const frames: ArrayBuffer[] = [];
    for (let i = 0; i < chunkCount; i++) {
      frames.push(
        await this.encryptChunk(
          src.subarray(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE).buffer,
          fileKey,
          aad,
        ),
      );
    }
    const total = frames.reduce((s, f) => s + f.byteLength, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const f of frames) {
      out.set(new Uint8Array(f), off);
      off += f.byteLength;
    }
    return out.buffer;
  }

  // Decrypts a single frame [12 IV][ct+tag] and returns plaintext.
  async decryptFrame(
    frame: ArrayBuffer,
    fileKey: CryptoKey,
    aad?: Uint8Array,
  ): Promise<ArrayBuffer> {
    const buf = new Uint8Array(frame);
    const iv = buf.slice(0, 12);
    const ct = buf.slice(12);
    return this.requireSubtle().decrypt(
      { name: 'AES-GCM', iv, ...(aad ? { additionalData: aad } : {}) },
      fileKey,
      ct,
    );
  }

  // Decrypts a concatenated chunked blob and returns the full plaintext.
  async decryptFileChunked(
    data: ArrayBuffer,
    fileKey: CryptoKey,
    chunkSize: number,
    aad?: Uint8Array,
  ): Promise<ArrayBuffer> {
    const frameSize = chunkSize + FRAME_OVERHEAD;
    const totalBytes = data.byteLength;
    const chunkCount = Math.ceil(totalBytes / frameSize);
    const parts: ArrayBuffer[] = [];

    for (let i = 0; i < chunkCount; i++) {
      const start = i * frameSize;
      const end = Math.min(start + frameSize, totalBytes);
      const frameBuf = data.slice(start, end);
      parts.push(await this.decryptFrame(frameBuf, fileKey, aad));
    }

    const totalPlain = parts.reduce((s, p) => s + p.byteLength, 0);
    const result = new Uint8Array(totalPlain);
    let offset = 0;
    for (const p of parts) {
      result.set(new Uint8Array(p), offset);
      offset += p.byteLength;
    }
    return result.buffer;
  }

  // ─── Приватные ───────────────────────────────────────────────────────────

  // hash-wasm возвращает view на WASM-память — копируем в изолированный буфер перед передачей в Web Crypto
  private async argon2idKey(
    input: string,
    salt: Uint8Array,
  ): Promise<CryptoKey> {
    const hash = await argon2id({ password: input, salt, ...ARGON2_PARAMS });
    const buf = new ArrayBuffer(hash.byteLength);
    new Uint8Array(buf).set(hash);
    return this.requireSubtle().importKey(
      'raw',
      buf,
      { name: 'AES-KW', length: 256 },
      false,
      ['wrapKey', 'unwrapKey'],
    );
  }

  // salt = SPKI эфемерного ключа — уникален для каждой шары
  private async deriveShareKEK(
    sharedSecret: ArrayBuffer,
    salt: ArrayBuffer,
  ): Promise<CryptoKey> {
    const subtle = this.requireSubtle();
    const keyMaterial = await subtle.importKey(
      'raw',
      sharedSecret,
      { name: 'HKDF' },
      false,
      ['deriveKey'],
    );
    return subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt, info: SHARE_INFO },
      keyMaterial,
      { name: 'AES-KW', length: 256 },
      false,
      ['wrapKey', 'unwrapKey'],
    );
  }

  // Формат: wrappedKwk[40] | iv[12] | AES-GCM(kwk, pkcs8)+tag
  private async wrapECPrivateKey(
    pkcs8: Uint8Array<ArrayBuffer>,
    wrappingKey: CryptoKey,
  ): Promise<string> {
    const subtle = this.requireSubtle();
    const kwk = await subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt'],
    );
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const cipher = await subtle.encrypt({ name: 'AES-GCM', iv }, kwk, pkcs8);
    const wrappedKwk = await subtle.wrapKey('raw', kwk, wrappingKey, 'AES-KW');
    const out = new Uint8Array(wrappedKwk.byteLength + 12 + cipher.byteLength);
    out.set(new Uint8Array(wrappedKwk), 0);
    out.set(iv, wrappedKwk.byteLength);
    out.set(new Uint8Array(cipher), wrappedKwk.byteLength + 12);
    return toBase64(out);
  }
}
