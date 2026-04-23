export interface DeviceSession {
  id: string;
  device_name: string;
  ip_address: string;
  user_agent: string;
  created_at: string;
  last_active_at: string;
  is_current: boolean;
}

export interface ListSessionsResponse {
  sessions: DeviceSession[];
}
