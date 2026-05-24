export interface DeviceSession {
  readonly id: string;
  readonly device_name: string;
  readonly ip_address: string;
  readonly user_agent: string;
  readonly created_at: string;
  readonly last_active_at: string;
  readonly is_current: boolean;
}

export interface ListSessionsResponse {
  readonly sessions: readonly DeviceSession[];
}
