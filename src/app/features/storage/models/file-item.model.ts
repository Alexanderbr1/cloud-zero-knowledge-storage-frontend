export interface FileItem {
  blob_id: string;
  folder_id: string | null;
  file_name: string;
  object_key?: string;
  content_type: string;
  created_at: string;
  encrypted_file_key: string;
  file_iv: string;
}
