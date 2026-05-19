import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

import { environment } from '../../../../environments/environment';
import { FileItem } from '../../storage/models/file-item.model';
import { FolderItem } from '../../storage/models/folder.model';

export interface FavoritesResponse {
  blobs:   FileItem[];
  folders: FolderItem[];
}

@Injectable({ providedIn: 'root' })
export class FavoritesService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiBaseUrl}/favorites`;

  list(): Observable<FavoritesResponse> {
    return this.http.get<FavoritesResponse>(this.base);
  }

  addBlob(blobId: string): Observable<void> {
    return this.http.post<void>(`${this.base}/blobs/${encodeURIComponent(blobId)}`, {});
  }

  removeBlob(blobId: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/blobs/${encodeURIComponent(blobId)}`);
  }

  addFolder(folderId: string): Observable<void> {
    return this.http.post<void>(`${this.base}/folders/${encodeURIComponent(folderId)}`, {});
  }

  removeFolder(folderId: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/folders/${encodeURIComponent(folderId)}`);
  }
}
