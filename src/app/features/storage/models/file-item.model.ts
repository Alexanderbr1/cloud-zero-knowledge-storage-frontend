export interface FileItem {
  blob_id: string;
  folder_id: string | null;
  folder_name?: string;
  file_name: string;
  object_key?: string;
  content_type: string;
  file_size: number;
  created_at: string;
  encrypted_file_key: string;
  file_iv: string;
}
