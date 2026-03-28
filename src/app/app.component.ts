import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { finalize } from 'rxjs';

import { FileItem } from './core/models/file-item.model';
import { FilesService } from './core/services/files.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent implements OnInit {
  files: FileItem[] = [];
  selectedFile: File | null = null;
  isLoading = false;
  isUploading = false;
  actionMessage = '';
  errorMessage = '';

  constructor(private readonly filesService: FilesService) {}

  ngOnInit(): void {
    this.refreshFiles();
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.selectedFile = input.files?.item(0) ?? null;
  }

  uploadSelectedFile(): void {
    if (!this.selectedFile) {
      this.errorMessage = 'Выберите файл перед загрузкой.';
      return;
    }

    this.actionMessage = '';
    this.errorMessage = '';
    this.isUploading = true;

    this.filesService
      .uploadFile(this.selectedFile)
      .pipe(finalize(() => (this.isUploading = false)))
      .subscribe({
        next: () => {
          this.actionMessage = `Файл "${this.selectedFile?.name}" успешно загружен.`;
          this.selectedFile = null;
          this.refreshFiles();
        },
        error: () => {
          this.errorMessage = 'Не удалось загрузить файл.';
        }
      });
  }

  downloadFile(file: FileItem): void {
    this.errorMessage = '';
    this.actionMessage = '';

    this.filesService.getDownloadUrl(file.blob_id).subscribe({
      next: (downloadUrl) => {
        window.open(downloadUrl, '_blank', 'noopener,noreferrer');
      },
      error: () => {
        this.errorMessage = `Не удалось получить ссылку для "${file.object_key}".`;
      }
    });
  }

  deleteFile(file: FileItem): void {
    this.errorMessage = '';
    this.actionMessage = '';

    this.filesService.deleteFile(file.blob_id).subscribe({
      next: () => {
        this.actionMessage = `Файл "${file.object_key}" удален.`;
        this.refreshFiles();
      },
      error: () => {
        this.errorMessage = `Не удалось удалить "${file.object_key}".`;
      }
    });
  }

  trackByFileName(_: number, item: FileItem): string {
    return item.blob_id;
  }

  refreshFiles(): void {
    this.isLoading = true;
    this.filesService
      .listFiles()
      .pipe(finalize(() => (this.isLoading = false)))
      .subscribe({
        next: (files) => {
          this.files = files;
        },
        error: () => {
          this.errorMessage = 'Не удалось получить список файлов.';
        }
      });
  }
}
