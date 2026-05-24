export interface FolderItem {
  readonly folder_id: string;
  readonly parent_id: string | null;
  readonly name:      string;
  readonly created_at: string;
}

export interface BreadcrumbItem {
  readonly folder_id: string | null;
  readonly name:      string;
}
