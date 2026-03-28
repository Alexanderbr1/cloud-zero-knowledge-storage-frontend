import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { from, map, Observable, switchMap } from 'rxjs';

import { environment } from '../../../environments/environment';
import { FileItem } from '../models/file-item.model';

interface PresignPutRequest {
  content_type: string;
  file_name: string;
}

interface PresignPutResponse {
  blob_id: string;
  object_key: string;
  upload_url: string;
  expires_in: number;
  http_method: string;
  content_type: string;
  instructions: string;
}

interface PresignGetResponse {
  blob_id: string;
  object_key: string;
  download_url: string;
  expires_in: number;
  http_method: string;
  content_type: string;
  instructions: string;
}

interface ListBlobsResponse {
  items: FileItem[];
}

@Injectable({
  providedIn: 'root'
})
export class FilesService {
  private readonly baseUrl = `${environment.apiBaseUrl}/storage`;

  constructor(private readonly http: HttpClient) {}

  listFiles(): Observable<FileItem[]> {
    return this.http
      .get<ListBlobsResponse>(`${this.baseUrl}/blobs`)
      .pipe(map((response) => response.items));
  }

  uploadFile(file: File): Observable<PresignPutResponse> {
    const contentType = file.type || 'application/octet-stream';
    const payload: PresignPutRequest = {
      content_type: contentType,
      file_name: file.name
    };

    return this.http.post<PresignPutResponse>(`${this.baseUrl}/presign`, payload).pipe(
      switchMap((presign) =>
        from(
          fetch(presign.upload_url, {
            method: presign.http_method || 'PUT',
            headers: {
              'Content-Type': presign.content_type
            },
            body: file
          })
        ).pipe(
          map((response) => {
            if (!response.ok) {
              throw new Error(`Upload failed with status ${response.status}`);
            }
            return presign;
          })
        )
      )
    );
  }

  getDownloadUrl(blobId: string): Observable<string> {
    return this.http
      .post<PresignGetResponse>(`${this.baseUrl}/blobs/${encodeURIComponent(blobId)}/presign-get`, {})
      .pipe(map((response) => response.download_url));
  }

  deleteFile(blobId: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/blobs/${encodeURIComponent(blobId)}`);
  }
}
