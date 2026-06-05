export interface FileItem {
  readonly blob_id:            string;
  readonly folder_id:          string | null;
  readonly folder_name?:       string;
  readonly file_name:          string;
  readonly content_type:       string;
  readonly file_size:          number;
  readonly file_size_plain:    number;
  readonly chunk_size:         number;
  readonly created_at:         string;
  readonly encrypted_file_key: string;
}
