import { toBase64, fromBase64 } from './encoding.utils';

describe('encoding utils', () => {

  // ─── toBase64 ─────────────────────────────────────────────────────────────

  describe('toBase64()', () => {
    it('encodes known bytes to the correct base64 string', () => {
      // [72, 101, 108, 108, 111] = "Hello"
      const bytes = new Uint8Array([72, 101, 108, 108, 111]);
      expect(toBase64(bytes)).toBe('SGVsbG8=');
    });

    it('accepts ArrayBuffer as input', () => {
      const buf = new Uint8Array([1, 2, 3]).buffer;
      expect(toBase64(buf)).toBe('AQID');
    });

    it('encodes empty bytes to empty string', () => {
      expect(toBase64(new Uint8Array(0))).toBe('');
    });

    it('encodes all-zero bytes correctly', () => {
      expect(toBase64(new Uint8Array(3))).toBe('AAAA');
    });

    it('encodes all 0xFF bytes correctly', () => {
      expect(toBase64(new Uint8Array([255, 255, 255]))).toBe('////');
    });
  });

  // ─── fromBase64 ───────────────────────────────────────────────────────────

  describe('fromBase64()', () => {
    it('decodes known base64 to the correct bytes', () => {
      const buf   = fromBase64('SGVsbG8=');
      const bytes = new Uint8Array(buf);
      expect(Array.from(bytes)).toEqual([72, 101, 108, 108, 111]);
    });

    it('returns an ArrayBuffer', () => {
      const result = fromBase64('AQID');
      expect(result).toBeInstanceOf(ArrayBuffer);
    });

    it('decodes empty string to zero-length buffer', () => {
      const buf = fromBase64('');
      expect(buf.byteLength).toBe(0);
    });

    it('decodes all-zero bytes', () => {
      const buf   = fromBase64('AAAA');
      const bytes = new Uint8Array(buf);
      expect(Array.from(bytes)).toEqual([0, 0, 0]);
    });
  });

  // ─── round-trip ───────────────────────────────────────────────────────────

  describe('round-trip', () => {
    it('toBase64(fromBase64(s)) === s for arbitrary strings', () => {
      const cases = ['SGVsbG8=', 'AQID', '////'];
      for (const s of cases) {
        expect(toBase64(fromBase64(s))).toBe(s);
      }
    });

    it('fromBase64(toBase64(bytes)) restores original bytes', () => {
      const original = crypto.getRandomValues(new Uint8Array(64));
      const restored = new Uint8Array(fromBase64(toBase64(original)));
      expect(Array.from(restored)).toEqual(Array.from(original));
    });

    it('round-trip preserves 32-byte crypto salt', () => {
      const salt      = crypto.getRandomValues(new Uint8Array(32));
      const b64       = toBase64(salt);
      const recovered = new Uint8Array(fromBase64(b64));
      expect(Array.from(recovered)).toEqual(Array.from(salt));
    });

    it('round-trip preserves 91-byte SPKI key', () => {
      // Fake 91 bytes that represent a key-like blob.
      const spki = crypto.getRandomValues(new Uint8Array(91));
      const b64  = toBase64(spki);
      expect(new Uint8Array(fromBase64(b64)).length).toBe(91);
    });
  });
});
