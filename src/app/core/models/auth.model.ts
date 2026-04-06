/** DTO ответа POST /auth/login|register|refresh — refresh только в HttpOnly-куке. */
export interface TokenResponseDto {
  access_token: string;
  expires_in: number;
  refresh_expires_in: number;
  token_type: string;
  /** Только login/register: base64 соли для PBKDF2 на клиенте. После refresh отсутствует. */
  crypto_salt?: string;
}

export interface LoginRequestDto {
  email: string;
  password: string;
}

export interface RegisterRequestDto {
  email: string;
  password: string;
  crypto_salt: string; // base64-encoded 16 байт, сгенерированных на клиенте
}

