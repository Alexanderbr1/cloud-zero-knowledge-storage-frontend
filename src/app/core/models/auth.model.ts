/** DTO ответа POST /auth/login|register|refresh — refresh только в HttpOnly-куке. */
export interface TokenResponseDto {
  access_token: string;
  expires_in: number;
  refresh_expires_in: number;
  token_type: string;
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

/** GET /auth/crypto-params?email=... */
export interface CryptoParamsResponseDto {
  crypto_salt: string; // base64-encoded 16 байт
}
