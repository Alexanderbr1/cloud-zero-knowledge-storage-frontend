export interface AuditEvent {
  readonly id: string;
  readonly event_type: string;
  readonly ip_address: string;
  readonly device_name: string;
  readonly resource_id?: string;
  readonly resource_name?: string;
  readonly created_at: string;
}

export interface ListAuditResponse {
  readonly events: readonly AuditEvent[];
}
