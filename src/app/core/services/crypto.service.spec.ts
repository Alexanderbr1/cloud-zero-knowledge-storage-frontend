import { TestBed } from '@angular/core/testing';
import { CryptoService } from './crypto.service';
import { toBase64, fromBase64 } from '../utils/encoding.utils';

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Генерирует случайный AES-KW ключ для тестов оборачивания. */
async function makeKEK(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-KW', length: 256 }, true, ['wrapKey', 'unwrapKey']);
}

/** Сравнивает два ArrayBuffer побайтово. */
function bufEqual(a: ArrayBuffer, b: ArrayBuffer): boolean {
  if (a.byteLength !== b.byteLength) return false;
  const va = new Uint8Array(a);
  const vb = new Uint8Array(b);
  for (let i = 0; i < va.length; i++) if (va[i] !== vb[i]) return false;
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────

describe('CryptoService', () => {
  let svc: CryptoService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    svc = TestBed.inject(CryptoService);
  });

  // ─── Web Crypto guard ───────────────────────────────────────────────────

  it('webCryptoBlockedMessage() returns null in browser', () => {
    expect(svc.webCryptoBlockedMessage()).toBeNull();
  });

  // ─── generateSalt ───────────────────────────────────────────────────────

  it('generateSalt() returns 32 bytes', () => {
    const salt = svc.generateSalt();
    expect(salt).toBeInstanceOf(Uint8Array);
    expect(salt.length).toBe(32);
  });

  it('generateSalt() returns different values each call', () => {
    const a = svc.generateSalt();
    const b = svc.generateSalt();
    expect(toBase64(a)).not.toBe(toBase64(b));
  });

  // ─── deriveMasterKey + KEK wrap/unwrap ───────────────────────────────────

  it('wrapKEK / unwrapKEK round-trip restores the same key material', async () => {
    const salt      = svc.generateSalt();
    const masterKey = await svc.deriveMasterKey('correct-horse-battery', salt);
    const kek       = await svc.generateKEK();

    const wrapped   = await svc.wrapKEK(kek, masterKey);
    const restored  = await svc.unwrapKEK(wrapped, masterKey);

    // Wrap the original and restored KEKs with a test key; if material matches, the results match.
    const probe     = await makeKEK();
    const wOrig     = await crypto.subtle.wrapKey('raw', kek,      probe, 'AES-KW');
    const wRestored = await crypto.subtle.wrapKey('raw', restored, probe, 'AES-KW');

    expect(bufEqual(wOrig, wRestored)).toBeTrue();
  });

  it('unwrapKEK throws for wrong password', async () => {
    const salt      = svc.generateSalt();
    const masterKey = await svc.deriveMasterKey('correct-password', salt);
    const kek       = await svc.generateKEK();
    const wrapped   = await svc.wrapKEK(kek, masterKey);

    const wrongKey  = await svc.deriveMasterKey('wrong-password', salt);
    await expectAsync(svc.unwrapKEK(wrapped, wrongKey)).toBeRejected();
  });

  // ─── generateRecoveryPhrase ─────────────────────────────────────────────

  it('generateRecoveryPhrase() returns 12 space-separated words', () => {
    const phrase = svc.generateRecoveryPhrase();
    const words  = phrase.trim().split(' ');
    expect(words.length).toBe(12);
    for (const w of words) expect(w.length).toBeGreaterThan(0);
  });

  it('generateRecoveryPhrase() is different each call', () => {
    expect(svc.generateRecoveryPhrase()).not.toBe(svc.generateRecoveryPhrase());
  });

  // ─── File key wrap/unwrap ────────────────────────────────────────────────

  it('wrapFileKey / unwrapFileKey round-trip', async () => {
    const kek      = await svc.generateKEK();
    const fileKey  = await svc.generateFileKey();
    const wrapped  = await svc.wrapFileKey(fileKey, kek);
    const restored = await svc.unwrapFileKey(wrapped, kek);

    // Encrypt something with original and restored key — ciphertext won't match (different IVs)
    // but both should decrypt correctly.
    const plain  = new TextEncoder().encode('test-payload');
    const iv     = crypto.getRandomValues(new Uint8Array(12));
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, fileKey, plain);
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, restored, cipher);
    expect(new TextDecoder().decode(decrypted)).toBe('test-payload');
  });

  it('unwrapFileKeyForSharing returns extractable key', async () => {
    const kek      = await svc.generateKEK();
    const fileKey  = await svc.generateFileKey();
    const wrapped  = await svc.wrapFileKey(fileKey, kek);
    const forShare = await svc.unwrapFileKeyForSharing(wrapped, kek);

    // An extractable key can be exported; if not extractable, exportKey throws.
    const exported = await crypto.subtle.exportKey('raw', forShare);
    expect(exported.byteLength).toBe(32);
  });

  // ─── encryptFile / decryptFile ───────────────────────────────────────────

  it('encryptFile / decryptFile round-trip preserves plaintext', async () => {
    const kek     = await svc.generateKEK();
    const fileKey = await svc.generateFileKey();
    const orig    = new TextEncoder().encode('Hello, encrypted world! 🔐').buffer;

    const { ciphertext, ivB64 } = await svc.encryptFile(orig, fileKey);
    expect(ciphertext.byteLength).toBeGreaterThan(orig.byteLength); // AES-GCM adds 16-byte tag

    const decrypted = await svc.decryptFile(ciphertext, fileKey, ivB64);
    expect(new TextDecoder().decode(decrypted)).toBe('Hello, encrypted world! 🔐');
    void kek; // suppress unused warning
  });

  it('encryptFile produces different ciphertext each call (random IV)', async () => {
    const fileKey = await svc.generateFileKey();
    const data    = new TextEncoder().encode('same data').buffer;

    const r1 = await svc.encryptFile(data, fileKey);
    const r2 = await svc.encryptFile(data, fileKey);
    expect(r1.ivB64).not.toBe(r2.ivB64);
  });

  it('decryptFile throws for wrong key', async () => {
    const key1   = await svc.generateFileKey();
    const key2   = await svc.generateFileKey();
    const data   = new TextEncoder().encode('secret').buffer;
    const { ciphertext, ivB64 } = await svc.encryptFile(data, key1);
    await expectAsync(svc.decryptFile(ciphertext, key2, ivB64)).toBeRejected();
  });

  it('decryptFile throws for tampered ciphertext', async () => {
    const fileKey = await svc.generateFileKey();
    const data    = new TextEncoder().encode('secret').buffer;
    const { ciphertext, ivB64 } = await svc.encryptFile(data, fileKey);

    // Flip one byte in the tag area.
    const tampered = ciphertext.slice(0);
    const tamperedView = new Uint8Array(tampered);
    tamperedView[0] = tamperedView[0]! ^ 0xff;
    await expectAsync(svc.decryptFile(tampered, fileKey, ivB64)).toBeRejected();
  });

  // ─── EC key pair + unwrap ───────────────────────────────────────────────

  it('generateECKeyPair / unwrapECPrivateKey round-trip', async () => {
    const kek  = await svc.generateKEK();
    const { publicKeyB64, encryptedPrivateKeyB64 } = await svc.generateECKeyPair(kek);

    // public key must be a valid 91-byte SPKI P-256 key
    const spki      = new Uint8Array(fromBase64(publicKeyB64));
    expect(spki.byteLength).toBe(91);

    // private key must be unwrappable and usable for ECDH
    const privKey = await svc.unwrapECPrivateKey(encryptedPrivateKeyB64, kek);
    expect(privKey).toBeTruthy();

    // Verify it's actually an ECDH key by deriving bits with itself (ephemeral + restored)
    const pubKey = await crypto.subtle.importKey('spki', fromBase64(publicKeyB64), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const bits   = await crypto.subtle.deriveBits({ name: 'ECDH', public: pubKey }, privKey, 256);
    expect(bits.byteLength).toBe(32);
  });

  it('unwrapECPrivateKey throws for wrong wrapping key', async () => {
    const kek1 = await svc.generateKEK();
    const kek2 = await svc.generateKEK();
    const { encryptedPrivateKeyB64 } = await svc.generateECKeyPair(kek1);
    await expectAsync(svc.unwrapECPrivateKey(encryptedPrivateKeyB64, kek2)).toBeRejected();
  });

  it('unwrapECPrivateKey throws for truncated blob', async () => {
    const kek = await svc.generateKEK();
    // A blob shorter than 69 bytes must be rejected immediately.
    const shortBlob = toBase64(new Uint8Array(40));
    await expectAsync(svc.unwrapECPrivateKey(shortBlob, kek)).toBeRejected();
  });

  // ─── ECIES sharing round-trip ───────────────────────────────────────────

  it('encryptFileKeyForRecipient / decryptFileKeyFromShare round-trip', async () => {
    // Set up recipient key pair.
    const recipientKEK = await svc.generateKEK();
    const { publicKeyB64, encryptedPrivateKeyB64 } = await svc.generateECKeyPair(recipientKEK);
    const recipientPrivKey = await svc.unwrapECPrivateKey(encryptedPrivateKeyB64, recipientKEK);

    // Owner creates a file key and shares it.
    const ownerKEK   = await svc.generateKEK();
    const fileKey    = await svc.generateFileKey();
    const wrappedFKB64 = await svc.wrapFileKey(fileKey, ownerKEK);
    const shareableFileKey = await svc.unwrapFileKeyForSharing(wrappedFKB64, ownerKEK);

    const { ephemeralPubB64, wrappedFileKeyB64 } =
      await svc.encryptFileKeyForRecipient(shareableFileKey, publicKeyB64);

    // Recipient decrypts the file key.
    const recipientFileKey = await svc.decryptFileKeyFromShare(
      wrappedFileKeyB64, ephemeralPubB64, recipientPrivKey,
    );

    // Both keys should decrypt the same ciphertext.
    const plain     = new TextEncoder().encode('shared file content').buffer;
    const iv        = crypto.getRandomValues(new Uint8Array(12));
    const cipher    = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, fileKey, plain);
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, recipientFileKey, cipher);
    expect(new TextDecoder().decode(decrypted)).toBe('shared file content');
  });

  it('ephemeralPubB64 is a valid 91-byte SPKI key', async () => {
    const kek     = await svc.generateKEK();
    const { publicKeyB64 } = await svc.generateECKeyPair(kek);
    const fileKey = await svc.generateFileKey();
    const { ephemeralPubB64 } = await svc.encryptFileKeyForRecipient(fileKey, publicKeyB64);
    const spki = new Uint8Array(fromBase64(ephemeralPubB64));
    expect(spki.byteLength).toBe(91);
  });

  it('wrappedFileKeyB64 is exactly 40 bytes (AES-KW output)', async () => {
    const kek     = await svc.generateKEK();
    const { publicKeyB64 } = await svc.generateECKeyPair(kek);
    const fileKey = await svc.generateFileKey();
    const { wrappedFileKeyB64 } = await svc.encryptFileKeyForRecipient(fileKey, publicKeyB64);
    const wrapped = new Uint8Array(fromBase64(wrappedFileKeyB64));
    expect(wrapped.byteLength).toBe(40);
  });

  // ─── ClientKey blob ─────────────────────────────────────────────────────

  it('encryptWithClientKey / decryptWithClientKey round-trip', async () => {
    const rawKey    = crypto.getRandomValues(new Uint8Array(32));
    const clientKey = toBase64(rawKey);
    const payload   = JSON.stringify({ kek: 'some-wrapped-key' });

    const blob      = await svc.encryptWithClientKey(payload, clientKey);
    const recovered = await svc.decryptWithClientKey(blob, clientKey);
    expect(recovered).toBe(payload);
  });

  it('encryptWithClientKey produces different blobs each call (random IV)', async () => {
    const key  = toBase64(crypto.getRandomValues(new Uint8Array(32)));
    const blob1 = await svc.encryptWithClientKey('same', key);
    const blob2 = await svc.encryptWithClientKey('same', key);
    expect(blob1).not.toBe(blob2);
  });

  it('decryptWithClientKey throws for tampered blob', async () => {
    const key  = toBase64(crypto.getRandomValues(new Uint8Array(32)));
    const blob = await svc.encryptWithClientKey('payload', key);
    // Corrupt a byte in the ciphertext portion.
    const bytes = new Uint8Array(fromBase64(blob));
    bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 0xff;
    const corrupted = toBase64(bytes);
    await expectAsync(svc.decryptWithClientKey(corrupted, key)).toBeRejected();
  });

  it('decryptWithClientKey throws for blob shorter than 29 bytes', async () => {
    const key   = toBase64(crypto.getRandomValues(new Uint8Array(32)));
    const short = toBase64(new Uint8Array(20)); // 20 < 29
    await expectAsync(svc.decryptWithClientKey(short, key)).toBeRejectedWithError('Invalid client key blob');
  });
});
