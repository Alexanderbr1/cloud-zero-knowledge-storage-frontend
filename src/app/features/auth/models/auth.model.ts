export interface RegisterRequest {
  readonly email:                  string;
  readonly srp_salt:               string;
  readonly srp_verifier:           string;
  readonly bcrypt_salt:            string;
  readonly crypto_salt:            string;
  readonly public_key:             string;
  readonly encrypted_private_key:  string;
  readonly kek_encrypted_master:   string;
  readonly kek_encrypted_recovery: string;
  readonly recovery_salt:          string;
}

export interface LoginInitRequest {
  readonly email: string;
  readonly A:     string;
}

export interface LoginInitResponse {
  readonly session_id:  string;
  readonly srp_salt:    string;
  readonly bcrypt_salt: string;
  readonly B:           string;
  readonly crypto_salt: string;
}

export interface LoginFinalizeRequest {
  readonly session_id: string;
  readonly M1:         string;
}

interface BaseTokenResponse {
  readonly access_token:       string;
  readonly expires_in:         number;
  readonly refresh_expires_in: number;
  readonly token_type:         string;
  readonly client_key:         string;
}

export interface RegisterResponse extends BaseTokenResponse {}

export interface LoginFinalizeResponse extends BaseTokenResponse {
  readonly M2:                    string;
  readonly crypto_salt:           string;
  readonly kek_encrypted_master:  string;
  readonly encrypted_private_key: string;
}

export interface RefreshResponse extends BaseTokenResponse {
  readonly crypto_salt:           string;
  readonly kek_encrypted_master:  string;
  readonly encrypted_private_key: string;
}
