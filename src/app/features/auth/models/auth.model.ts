/** POST /auth/register */
export interface RegisterRequestDto {
  email: string;
  srp_salt: string;              // hex-encoded SRP salt
  srp_verifier: string;          // hex-encoded verifier v = g^x mod N
  bcrypt_salt: string;           // bcrypt salt string ($2b$10$...)
  crypto_salt: string;           // base64-encoded PBKDF2 salt for file encryption
  public_key: string;            // base64-encoded SPKI P-256 public key
  encrypted_private_key: string; // base64-encoded two-level wrapped EC private key
}

/** POST /auth/login/init */
export interface LoginInitRequestDto {
  email: string;
  A: string; // client public ephemeral (hex)
}

/** Response to POST /auth/login/init */
export interface LoginInitResponseDto {
  session_id: string;
  srp_salt: string;    // hex-encoded SRP salt
  bcrypt_salt: string; // bcrypt salt string ($2b$10$...)
  B: string;           // server public ephemeral (hex)
  crypto_salt: string; // base64-encoded PBKDF2 salt
}

/** POST /auth/login/finalize */
export interface LoginFinalizeRequestDto {
  session_id: string;
  M1: string; // client proof (hex)
}

/** Response to POST /auth/login/finalize, /auth/register, /auth/refresh */
export interface TokenResponseDto {
  access_token: string;
  expires_in: number;
  refresh_expires_in: number;
  token_type: string;
  /** Present only in login/finalize — client must verify this. */
  M2?: string;
  /** Present in login/finalize for accounts with EC keys; absent for legacy accounts. */
  encrypted_private_key?: string;
}
