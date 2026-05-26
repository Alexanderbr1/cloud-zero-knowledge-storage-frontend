import { TestBed } from '@angular/core/testing';
import { SrpService } from './srp.service';

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Returns true when s looks like a lowercase hex string of at least minLen chars. */
function isHex(s: string, minLen = 1): boolean {
  return s.length >= minLen && /^[0-9a-f]+$/.test(s);
}

// SRP-6a 2048-bit group prime N (hex). Used to verify verifier is in [1, N-1].
const N_HEX =
  'ffffffffffffffffc90fdaa22168c234c4c6628b80dc1cd1' +
  '29024e088a67cc74020bbea63b139b22514a08798e3404dd' +
  'ef9519b3cd3a431b302b0a6df25f14374fe1356d6d51c245' +
  'e485b576625e7ec6f44c42e9a637ed6b0bff5cb6f406b7ed' +
  'ee386bfb5a899fa5ae9f24117c4b1fe649286651ece45b3d' +
  'c2007cb8a163bf0598da48361c55d39a69163fa8fd24cf5f' +
  '83655d23dca3ad961c62f356208552bb9ed529077096966d' +
  '670c354e4abc9804f1746c08ca18217c32905e462e36ce3b' +
  'e39e772c180e86039b2783a2ec07a28fb5c55df06f4c52c9' +
  'de2bcbf6955817183995497cea956ae515d2261898fa0510' +
  '15728e5a8aacaa68ffffffffffffffff';
const N = BigInt('0x' + N_HEX);

// ─────────────────────────────────────────────────────────────────────────────

describe('SrpService', () => {
  let svc: SrpService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    svc = TestBed.inject(SrpService);
  });

  // ─── createVerifier ─────────────────────────────────────────────────────

  describe('createVerifier()', () => {
    it('returns valid hex srpSalt (64 chars = 32 bytes)', async () => {
      const { srpSalt } = await svc.createVerifier('password123');
      expect(isHex(srpSalt, 64)).toBeTrue();
    });

    it('returns srpVerifier as non-empty hex string within [1, N-1]', async () => {
      const { srpVerifier } = await svc.createVerifier('password123');
      expect(isHex(srpVerifier, 2)).toBeTrue();
      const v = BigInt('0x' + srpVerifier);
      expect(v > 0n).toBeTrue();
      expect(v < N).toBeTrue();
    });

    it('returns a bcrypt salt string', async () => {
      const { bcryptSalt } = await svc.createVerifier('password123');
      // bcrypt salts start with $2a$, $2b$ or $2y$
      expect(bcryptSalt).toMatch(/^\$2[aby]\$/);
    });

    it('returns different srpSalt each call', async () => {
      const r1 = await svc.createVerifier('same-password');
      const r2 = await svc.createVerifier('same-password');
      expect(r1.srpSalt).not.toBe(r2.srpSalt);
    });

    it('different passwords produce different verifiers for same salt (indirectly)', async () => {
      const r1 = await svc.createVerifier('password-A');
      const r2 = await svc.createVerifier('password-B');
      // Salts differ, so verifiers will too — just ensure they are not equal.
      expect(r1.srpVerifier).not.toBe(r2.srpVerifier);
    });
  });

  // ─── createClientEphemeral ──────────────────────────────────────────────

  describe('createClientEphemeral()', () => {
    it('AHex is a non-empty hex string', () => {
      const { AHex } = svc.createClientEphemeral();
      expect(isHex(AHex, 2)).toBeTrue();
    });

    it('A is in [1, N-1] (never 0 mod N)', () => {
      const { AHex } = svc.createClientEphemeral();
      const A = BigInt('0x' + AHex);
      expect(A > 0n).toBeTrue();
      expect(A % N !== 0n).toBeTrue();
    });

    it('returns different ephemeral each call', () => {
      const r1 = svc.createClientEphemeral();
      const r2 = svc.createClientEphemeral();
      expect(r1.AHex).not.toBe(r2.AHex);
    });

    it('a is stored as bigint in the returned object', () => {
      const { a } = svc.createClientEphemeral();
      expect(typeof a).toBe('bigint');
      expect(a > 0n).toBeTrue();
    });
  });

  // ─── computeClientProof ─────────────────────────────────────────────────

  describe('computeClientProof()', () => {
    /**
     * We can't do a real end-to-end SRP handshake in a unit test without a
     * server, but we CAN verify the structural guarantees:
     * - M1 is a valid 64-char hex SHA-256 digest.
     * - verifyM2(expectedM2) returns true.
     * - verifyM2(wrongHex) returns false.
     *
     * To get a valid B we simulate the server side using the verifier produced
     * by createVerifier (same password), compute B manually, and then call
     * computeClientProof. This exercises the full client-side SRP-6a path.
     */

    async function runHandshake(password: string) {
      const { srpSalt, srpVerifier, bcryptSalt } = await svc.createVerifier(password);
      const { a, AHex } = svc.createClientEphemeral();

      // ── Simulate server: compute B = k·v + g^b mod N ──────────────────────
      // We need k = SHA-256(pad(N) ‖ pad(g)) and a random b.
      const N_BYTES = 256;
      function hexToBytes(hex: string): Uint8Array {
        if (hex.length % 2) hex = '0' + hex;
        const out = new Uint8Array(hex.length / 2);
        for (let i = 0; i < hex.length; i += 2) out[i >>> 1] = parseInt(hex.slice(i, i + 2), 16);
        return out;
      }
      function bigIntToBytes(n: bigint): Uint8Array {
        let h = n.toString(16);
        if (h.length % 2) h = '0' + h;
        return hexToBytes(h);
      }
      function pad(n: bigint): Uint8Array {
        const bytes = bigIntToBytes(n);
        if (bytes.length >= N_BYTES) return bytes;
        const out = new Uint8Array(N_BYTES);
        out.set(bytes, N_BYTES - bytes.length);
        return out;
      }
      function modpow(base: bigint, exp: bigint, mod: bigint): bigint {
        let result = 1n; base = base % mod;
        while (exp > 0n) {
          if (exp & 1n) result = (result * base) % mod;
          exp >>= 1n; base = (base * base) % mod;
        }
        return result;
      }
      async function sha256(...chunks: Uint8Array[]): Promise<Uint8Array> {
        let len = 0; for (const c of chunks) len += c.length;
        const buf = new Uint8Array(len); let off = 0;
        for (const c of chunks) { buf.set(c, off); off += c.length; }
        return new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
      }
      function bytesToBigInt(bytes: Uint8Array): bigint {
        return BigInt('0x' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join(''));
      }

      const G = 2n;
      const gPad = new Uint8Array(N_BYTES); gPad[N_BYTES - 1] = 2;
      const k = bytesToBigInt(await sha256(hexToBytes(N_HEX), gPad));
      const v = BigInt('0x' + srpVerifier);

      const bBytes = crypto.getRandomValues(new Uint8Array(32));
      const b      = bytesToBigInt(bBytes);
      const B      = ((k * v) % N + modpow(G, b, N)) % N;
      const BHex   = Array.from(bigIntToBytes(B), x => x.toString(16).padStart(2, '0')).join('');

      // ── Client computes proof ─────────────────────────────────────────────
      const { M1Hex, verifyM2 } = await svc.computeClientProof({
        email: 'alice@example.com',
        password,
        a, AHex,
        B: BHex,
        srpSalt,
        bcryptSalt,
      });

      // ── Server computes M2 ────────────────────────────────────────────────
      const Aval    = bytesToBigInt(hexToBytes(AHex));
      const srpSaltB = hexToBytes(srpSalt);
      const u       = bytesToBigInt(await sha256(pad(Aval), pad(B)));
      const S       = modpow(Aval * modpow(v, u, N) % N, b, N);
      const K       = await sha256(pad(S));
      const M1bytes = hexToBytes(M1Hex);
      const M2bytes = await sha256(pad(Aval), M1bytes, K);
      const M2Hex   = Array.from(M2bytes, x => x.toString(16).padStart(2, '0')).join('');

      void srpSaltB; // suppress unused warning
      return { M1Hex, verifyM2, M2Hex };
    }

    it('M1Hex is a 64-char lowercase hex string', async () => {
      const { M1Hex } = await runHandshake('hunter2');
      expect(M1Hex.length).toBe(64);
      expect(isHex(M1Hex, 64)).toBeTrue();
    }, 10000);

    it('verifyM2 returns true for the correct server M2', async () => {
      const { verifyM2, M2Hex } = await runHandshake('hunter2');
      expect(verifyM2(M2Hex)).toBeTrue();
    }, 10000);

    it('verifyM2 returns false for a wrong M2', async () => {
      const { verifyM2 } = await runHandshake('hunter2');
      const wrong = 'a'.repeat(64);
      expect(verifyM2(wrong)).toBeFalse();
    }, 10000);

    it('computeClientProof throws for B = 0 mod N', async () => {
      const { srpSalt, bcryptSalt } = await svc.createVerifier('pass');
      const { a, AHex } = svc.createClientEphemeral();

      // B = N means B mod N = 0 — server must be rejected.
      const BHex = N_HEX;
      await expectAsync(
        svc.computeClientProof({
          email: 'x@x.com', password: 'pass', a, AHex,
          B: BHex, srpSalt, bcryptSalt,
        })
      ).toBeRejectedWithError(/invalid server public key/i);
    }, 10000);
  });
});
