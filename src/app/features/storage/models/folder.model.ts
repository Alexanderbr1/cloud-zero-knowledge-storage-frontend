export interface FolderItem {
  folder_id: string;
  parent_id: string | null;
  name: string;
  total_size: number;
  created_at: string;
}

export interface BreadcrumbItem {
  folder_id: string | null;
  name: string;
}
