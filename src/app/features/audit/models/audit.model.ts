export interface AuditEvent {
  id: string;
  event_type: string;
  ip_address: string;
  device_name: string;
  resource_id?: string;
  resource_name?: string;
  created_at: string;
}

export interface ListAuditResponse {
  events: AuditEvent[];
}
