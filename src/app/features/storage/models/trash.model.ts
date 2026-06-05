export interface TrashFileItem {
  readonly blob_id:            string;
  readonly folder_id:          string | null;
  readonly file_name:          string;
  readonly content_type:       string;
  readonly file_size:          number;
  readonly file_size_plain:    number;
  readonly chunk_size:         number;
  readonly created_at:         string;
  readonly encrypted_file_key: string;
}

export interface TrashFolderItem {
  readonly folder_id: string;
  readonly parent_id: string | null;
  readonly name:      string;
  readonly created_at: string;
}

export interface TrashListResponse {
  readonly blobs:   readonly TrashFileItem[];
  readonly folders: readonly TrashFolderItem[];
}
