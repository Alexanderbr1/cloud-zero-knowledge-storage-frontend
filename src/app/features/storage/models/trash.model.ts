export interface TrashFileItem {
  blob_id: string;
  folder_id: string | null;
  file_name: string;
  content_type: string;
  file_size: number;
  created_at: string;
  encrypted_file_key: string;
  file_iv: string;
}

export interface TrashFolderItem {
  folder_id: string;
  parent_id: string | null;
  name: string;
  created_at: string;
}

export interface TrashListResponse {
  blobs: TrashFileItem[];
  folders: TrashFolderItem[];
}
