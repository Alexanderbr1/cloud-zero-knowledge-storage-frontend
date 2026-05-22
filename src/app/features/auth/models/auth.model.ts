export interface RegisterRequestDto {
  readonly email: string;
  readonly srp_salt: string;
  readonly srp_verifier: string;
  readonly bcrypt_salt: string;
  readonly crypto_salt: string;
  readonly public_key: string;
  readonly encrypted_private_key: string;
  readonly kek_encrypted_master: string;
  readonly kek_encrypted_recovery: string;
  readonly recovery_salt: string;
}

export interface LoginInitRequestDto {
  readonly email: string;
  readonly A: string;
}

export interface LoginInitResponseDto {
  readonly session_id: string;
  readonly srp_salt: string;
  readonly bcrypt_salt: string;
  readonly B: string;
  readonly crypto_salt: string;
}

export interface LoginFinalizeRequestDto {
  readonly session_id: string;
  readonly M1: string;
}

export interface TokenResponseDto {
  readonly access_token: string;
  readonly expires_in: number;
  readonly refresh_expires_in: number;
  readonly token_type: string;
  readonly M2?: string;
  readonly encrypted_private_key?: string;
  readonly kek_encrypted_master?: string;
  readonly client_key?: string;
}
