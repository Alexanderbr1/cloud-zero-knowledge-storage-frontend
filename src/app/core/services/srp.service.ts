import { Injectable } from '@angular/core';
import * as bcrypt from 'bcryptjs';

// SRP-6a (RFC 5054), 2048-bit group. bcrypt-hardened: x = SHA-256(srpSalt ‖ utf8(bcrypt(pw, bcryptSalt)))

@Injectable({ providedIn: 'root' })
export class SrpService {
  // RFC 5054 §A.1 — 2048-bit group prime N
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
  private readonly G       = 2n;
  private readonly N_BYTES = 256; // 2048 / 8

  // k и xorNG — групповые константы, вычисляются один раз в конструкторе
  private readonly kPromise:     Promise<bigint>;
  private readonly xorNGPromise: Promise<Uint8Array>;

  constructor() {
    this.N          = BigInt('0x' + this.N_HEX);
    this.kPromise   = this.computeK();
    this.xorNGPromise = this.computeXorNG();
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  async createVerifier(password: string): Promise<{ srpSalt: string; srpVerifier: string; bcryptSalt: string }> {
    const bcryptSalt    = await bcrypt.genSalt(12);
    const pwHash        = await bcrypt.hash(password, bcryptSalt);
    const srpSaltBytes  = globalThis.crypto.getRandomValues(new Uint8Array(32));
    const x             = await this.computeX(srpSaltBytes, pwHash);
    const v             = this.modpow(this.G, x, this.N);
    return {
      srpSalt:     this.bytesToHex(srpSaltBytes),
      srpVerifier: this.bytesToHex(this.bigIntToBytes(v)),
      bcryptSalt,
    };
  }

  createClientEphemeral(): { a: bigint; AHex: string } {
    const aBytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
    const a      = this.bytesToBigInt(aBytes);
    const A      = this.modpow(this.G, a, this.N);
    return { a, AHex: this.bytesToHex(this.pad(A)) };
  }

  async computeClientProof(params: {
    email:      string;
    password:   string;
    a:          bigint;
    AHex:       string;
    B:          string;
    srpSalt:    string;
    bcryptSalt: string;
  }): Promise<{ M1Hex: string; verifyM2: (m2Hex: string) => boolean }> {
    const { email, password, a, AHex, B: BHex, srpSalt: srpSaltHex, bcryptSalt } = params;

    const srpSaltBytes = this.hexToBytes(srpSaltHex);
    const pwHash       = await bcrypt.hash(password, bcryptSalt); // ~100 мс
    const x            = await this.computeX(srpSaltBytes, pwHash);

    const A    = this.bytesToBigInt(this.hexToBytes(AHex));
    const Bval = this.bytesToBigInt(this.hexToBytes(BHex));
    if (Bval % this.N === 0n) throw new Error('SRP: invalid server public key B');

    const k = await this.kPromise;

    // u = SHA-256(pad(A) ‖ pad(B))
    const u = this.bytesToBigInt(await this.sha256(this.pad(A), this.pad(Bval)));

    // S = (B − k·g^x)^(a + u·x) mod N
    const kgx   = (k * this.modpow(this.G, x, this.N)) % this.N;
    const BmKgx = ((Bval - kgx) % this.N + this.N) % this.N;
    const S     = this.modpow(BmKgx, a + u * x, this.N);

    // K = SHA-256(pad(S))
    const K = await this.sha256(this.pad(S));

    // M1 = SHA-256(H(N)⊕H(g) ‖ H(email) ‖ srpSalt ‖ pad(A) ‖ pad(B) ‖ K)
    const [xorNG, hEmail] = await Promise.all([
      this.xorNGPromise,
      this.sha256(new TextEncoder().encode(email)),
    ]);
    const M1    = await this.sha256(xorNG, hEmail, srpSaltBytes, this.pad(A), this.pad(Bval), K);
    const M1Hex = this.bytesToHex(M1);

    // M2 = SHA-256(pad(A) ‖ M1 ‖ K)
    const expectedM2Hex = this.bytesToHex(await this.sha256(this.pad(A), M1, K));
    const verifyM2      = (m2Hex: string) => m2Hex.toLowerCase() === expectedM2Hex;

    return { M1Hex, verifyM2 };
  }

  // ─── Приватные ───────────────────────────────────────────────────────────

  // left-zero-pads n до N_BYTES байт
  private pad(n: bigint): Uint8Array {
    const bytes = this.bigIntToBytes(n);
    if (bytes.length >= this.N_BYTES) return bytes;
    const out = new Uint8Array(this.N_BYTES);
    out.set(bytes, this.N_BYTES - bytes.length);
    return out;
  }

  private async sha256(...chunks: Uint8Array[]): Promise<Uint8Array> {
    let len = 0;
    for (const c of chunks) len += c.length;
    const buf = new Uint8Array(len);
    let off = 0;
    for (const c of chunks) { buf.set(c, off); off += c.length; }
    return new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', buf));
  }

  // xorNG = H(N) ⊕ H(g) — константный член в формуле M1
  private async computeXorNG(): Promise<Uint8Array> {
    const [hN, hG] = await Promise.all([
      this.sha256(this.hexToBytes(this.N_HEX)),
      this.sha256(this.pad(this.G)),
    ]);
    return hN.map((b, i) => b ^ (hG[i] ?? 0));
  }

  // k = SHA-256(pad(N) ‖ pad(g)) — мультипликатор SRP-6a
  private async computeK(): Promise<bigint> {
    const gPad = new Uint8Array(this.N_BYTES);
    gPad[this.N_BYTES - 1] = 2;
    return this.bytesToBigInt(await this.sha256(this.hexToBytes(this.N_HEX), gPad));
  }

  // x = SHA-256(srpSalt ‖ utf8(bcryptHash))
  private async computeX(srpSaltBytes: Uint8Array, pwHash: string): Promise<bigint> {
    return this.bytesToBigInt(await this.sha256(srpSaltBytes, new TextEncoder().encode(pwHash)));
  }

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

  private bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  }

  private hexToBytes(hex: string): Uint8Array {
    if (hex.length % 2) hex = '0' + hex;
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) out[i >>> 1] = parseInt(hex.slice(i, i + 2), 16);
    return out;
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
