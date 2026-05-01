import { Injectable } from '@angular/core';
import * as bcrypt from 'bcryptjs';

/**
 * SrpService — SRP-6a (RFC 5054) client implementation.
 *
 * Bcrypt hardening: x = SHA-256(srpSalt || utf8(bcrypt(password, bcryptSalt)))
 * This means an attacker who steals the verifier still must run bcrypt per guess.
 *
 * All heavy computation (bcrypt, modpow) runs in the same thread.
 * BigInt is native in all modern browsers and handles the 2048-bit arithmetic.
 */
@Injectable({ providedIn: 'root' })
export class SrpService {
  // RFC 5054 §A.1 — 2048-bit group prime N (hex, lowercase).
  private readonly N_HEX =
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

  private readonly N: bigint;
  private readonly G = 2n;
  private readonly N_BYTES = 256; // 2048 / 8

  // k = H(pad(N) || pad(g)) and xorNG = H(N) ⊕ H(g) — group constants, computed once.
  private readonly kPromise: Promise<bigint>;
  private readonly xorNGPromise: Promise<Uint8Array>;

  constructor() {
    this.N = BigInt('0x' + this.N_HEX);
    this.kPromise = this.computeK();
    this.xorNGPromise = this.computeXorNG();
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  /**
   * Computes the SRP verifier from the user's password.
   * Called once during registration.
   * Returns srpSalt (hex), srpVerifier (hex), bcryptSalt (bcrypt string).
   */
  async createVerifier(
    password: string
  ): Promise<{ srpSalt: string; srpVerifier: string; bcryptSalt: string }> {
    // bcrypt salt + hash — all computation stays in the browser
    const bcryptSalt = await bcrypt.genSalt(10);
    const pwHash = await bcrypt.hash(password, bcryptSalt);

    // SRP salt — 32 random bytes
    const srpSaltBytes = globalThis.crypto.getRandomValues(new Uint8Array(32));

    // x = SHA-256(srpSalt || utf8(pwHash))
    const x = await this.computeX(srpSaltBytes, pwHash);

    // v = g^x mod N
    const v = this.modpow(this.G, x, this.N);

    return {
      srpSalt: this.bytesToHex(srpSaltBytes),
      srpVerifier: this.bytesToHex(this.bigIntToBytes(v)),
      bcryptSalt,
    };
  }

  createClientEphemeral(): { a: bigint; AHex: string } {
    const aBytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
    const a = this.bytesToBigInt(aBytes);
    const A = this.modpow(this.G, a, this.N);
    return { a, AHex: this.bytesToHex(this.pad(A)) };
  }

  /**
   * Computes the client proof M1 after receiving the server's response.
   * Also returns a synchronous verifier for M2 (server proof).
   */
  async computeClientProof(params: {
    email: string;
    password: string;
    a: bigint;
    AHex: string;
    B: string;          // server public ephemeral (hex)
    srpSalt: string;    // hex-encoded SRP salt from server
    bcryptSalt: string; // bcrypt salt string from server
  }): Promise<{ M1Hex: string; verifyM2: (m2Hex: string) => boolean }> {
    const { email, password, a, AHex, B: BHex, srpSalt: srpSaltHex, bcryptSalt } = params;

    const srpSaltBytes = this.hexToBytes(srpSaltHex);

    // Reconstruct the same bcrypt hash using the stored salt
    const pwHash = await bcrypt.hash(password, bcryptSalt);

    // x = SHA-256(srpSalt || utf8(pwHash))
    const x = await this.computeX(srpSaltBytes, pwHash);

    const A = this.bytesToBigInt(this.hexToBytes(AHex));
    const Bval = this.bytesToBigInt(this.hexToBytes(BHex));

    if (Bval % this.N === 0n) {
      throw new Error('SRP: invalid server public key B');
    }

    const k = await this.kPromise;

    // u = SHA-256(pad(A) || pad(B))
    const uBytes = await this.sha256(this.pad(A), this.pad(Bval));
    const u = this.bytesToBigInt(uBytes);

    // S = (B − k·g^x)^(a + u·x) mod N
    const gx = this.modpow(this.G, x, this.N);
    const kgx = (k * gx) % this.N;
    const BmKgx = ((Bval - kgx) % this.N + this.N) % this.N;
    const S = this.modpow(BmKgx, a + u * x, this.N);

    // K = SHA-256(pad(S))
    const K = await this.sha256(this.pad(S));

    // M1 = SHA-256(H(N)⊕H(g) || H(email) || srpSalt || pad(A) || pad(B) || K)
    const [xorNG, hEmail] = await Promise.all([
      this.xorNGPromise,
      this.sha256(new TextEncoder().encode(email)),
    ]);

    const M1 = await this.sha256(
      xorNG,
      hEmail,
      srpSaltBytes,
      this.pad(A),
      this.pad(Bval),
      K
    );
    const M1Hex = this.bytesToHex(M1);

    // Precompute expected M2 = SHA-256(pad(A) || M1 || K)
    const expectedM2 = await this.sha256(this.pad(A), M1, K);
    const expectedM2Hex = this.bytesToHex(expectedM2);

    const verifyM2 = (m2Hex: string): boolean =>
      m2Hex.toLowerCase() === expectedM2Hex.toLowerCase();

    return { M1Hex, verifyM2 };
  }

  // ─── Utilities ───────────────────────────────────────────────────────────

  bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  hexToBytes(hex: string): Uint8Array {
    if (hex.length % 2) hex = '0' + hex;
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      out[i >>> 1] = parseInt(hex.slice(i, i + 2), 16);
    }
    return out;
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

  /** Left-zero-pads n to N_BYTES (256) bytes. */
  private pad(n: bigint): Uint8Array {
    const bytes = this.bigIntToBytes(n);
    if (bytes.length >= this.N_BYTES) return bytes;
    const out = new Uint8Array(this.N_BYTES);
    out.set(bytes, this.N_BYTES - bytes.length);
    return out;
  }

  /** SHA-256 over one or more byte arrays concatenated. */
  private async sha256(...chunks: Uint8Array[]): Promise<Uint8Array> {
    let len = 0;
    for (const c of chunks) len += c.length;
    const buf = new Uint8Array(len);
    let off = 0;
    for (const c of chunks) { buf.set(c, off); off += c.length; }
    return new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', buf));
  }

  /** xorNG = H(N) ⊕ H(g) — constant term in M1 formula. H(N) uses N as already 256-byte hex. */
  private async computeXorNG(): Promise<Uint8Array> {
    const [hN, hG] = await Promise.all([
      this.sha256(this.hexToBytes(this.N_HEX)),
      this.sha256(this.pad(this.G)),
    ]);
    return hN.map((b, i) => b ^ hG[i]);
  }

  /** k = SHA-256(pad(N) || pad(g))  — SRP-6a multiplier. */
  private async computeK(): Promise<bigint> {
    const gPad = new Uint8Array(this.N_BYTES);
    gPad[this.N_BYTES - 1] = 2;
    const hash = await this.sha256(this.hexToBytes(this.N_HEX), gPad);
    return this.bytesToBigInt(hash);
  }

  /** x = SHA-256(srpSaltBytes || utf8(bcryptHash)) */
  private async computeX(srpSaltBytes: Uint8Array, pwHash: string): Promise<bigint> {
    const xBytes = await this.sha256(srpSaltBytes, new TextEncoder().encode(pwHash));
    return this.bytesToBigInt(xBytes);
  }

  /** Constant-time-ish modular exponentiation using BigInt. */
  private modpow(base: bigint, exp: bigint, mod: bigint): bigint {
    let result = 1n;
    base = base % mod;
    while (exp > 0n) {
      if (exp & 1n) result = (result * base) % mod;
      exp >>= 1n;
      base = (base * base) % mod;
    }
    return result;
  }

  private bigIntToBytes(n: bigint): Uint8Array {
    let hex = n.toString(16);
    if (hex.length % 2) hex = '0' + hex;
    return this.hexToBytes(hex);
  }

  private bytesToBigInt(bytes: Uint8Array): bigint {
    return BigInt('0x' + this.bytesToHex(bytes));
  }
}
