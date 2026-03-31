import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize } from 'rxjs';

import { FileItem } from './core/models/file-item.model';
import { AuthService } from './core/services/auth.service';
import { FilesService } from './core/services/files.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  private readonly filesService = inject(FilesService);
  private readonly auth = inject(AuthService);
  private readonly fb = inject(FormBuilder);

  readonly files = signal<FileItem[]>([]);
  readonly selectedFile = signal<File | null>(null);
  readonly isLoading = signal(false);
  readonly isUploading = signal(false);
  readonly isLoggingIn = signal(false);
  readonly actionMessage = signal('');
  readonly errorMessage = signal('');

  readonly isAuthed = computed(() => this.auth.isAuthenticated());
  readonly authMode = signal<'login' | 'register'>('login');

  loginForm = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]]
  });

  constructor() {
    if (this.isAuthed()) {
      this.refreshFiles();
    }
  }

  setAuthMode(mode: 'login' | 'register'): void {
    this.authMode.set(mode);
    this.actionMessage.set('');
    this.errorMessage.set('');
  }

  submitAuth(): void {
    this.actionMessage.set('');
    this.errorMessage.set('');

    if (this.loginForm.invalid) {
      this.errorMessage.set('Введите корректные email и пароль.');
      return;
    }

    const { email, password } = this.loginForm.getRawValue();
    this.isLoggingIn.set(true);
    const req$ =
      this.authMode() === 'register'
        ? this.auth.register(email, password)
        : this.auth.login(email, password);

    req$.pipe(finalize(() => this.isLoggingIn.set(false))).subscribe({
      next: () => {
        this.actionMessage.set(this.authMode() === 'register' ? 'Аккаунт создан. Вы вошли в систему.' : 'Вы вошли в систему.');
        this.loginForm.controls.password.setValue('');
        this.refreshFiles();
      },
      error: () => {
        this.errorMessage.set(
          this.authMode() === 'register'
            ? 'Не удалось зарегистрироваться (возможно, пользователь уже существует).'
            : 'Не удалось войти (проверьте email/пароль).'
        );
      }
    });
  }

  logout(): void {
    this.auth.logout();
    this.actionMessage.set('Вы вышли из системы.');
    this.errorMessage.set('');
    this.files.set([]);
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.selectedFile.set(input.files?.item(0) ?? null);
  }

  uploadSelectedFile(): void {
    if (!this.isAuthed()) {
      this.errorMessage.set('Сначала войдите в систему.');
      return;
    }
    const file = this.selectedFile();
    if (!file) {
      this.errorMessage.set('Выберите файл перед загрузкой.');
      return;
    }

    this.actionMessage.set('');
    this.errorMessage.set('');
    this.isUploading.set(true);

    this.filesService
      .uploadFile(file)
      .pipe(finalize(() => this.isUploading.set(false)))
      .subscribe({
        next: () => {
          this.actionMessage.set(`Файл "${file.name}" успешно загружен.`);
          this.selectedFile.set(null);
          this.refreshFiles();
        },
        error: () => {
          this.errorMessage.set('Не удалось загрузить файл.');
        }
      });
  }

  downloadFile(file: FileItem): void {
    if (!this.isAuthed()) {
      this.errorMessage.set('Сначала войдите в систему.');
      return;
    }
    this.errorMessage.set('');
    this.actionMessage.set('');

    this.filesService.getDownloadUrl(file.blob_id).subscribe({
      next: (downloadUrl) => {
        window.open(downloadUrl, '_blank', 'noopener,noreferrer');
      },
      error: () => {
        this.errorMessage.set(`Не удалось получить ссылку для "${file.object_key}".`);
      }
    });
  }

  deleteFile(file: FileItem): void {
    if (!this.isAuthed()) {
      this.errorMessage.set('Сначала войдите в систему.');
      return;
    }
    this.errorMessage.set('');
    this.actionMessage.set('');

    this.filesService.deleteFile(file.blob_id).subscribe({
      next: () => {
        this.actionMessage.set(`Файл "${file.object_key}" удален.`);
        this.refreshFiles();
      },
      error: () => {
        this.errorMessage.set(`Не удалось удалить "${file.object_key}".`);
      }
    });
  }

  trackByFileName(_: number, item: FileItem): string {
    return item.blob_id;
  }

  refreshFiles(): void {
    if (!this.isAuthed()) {
      this.files.set([]);
      return;
    }
    this.isLoading.set(true);
    this.filesService
      .listFiles()
      .pipe(finalize(() => this.isLoading.set(false)))
      .subscribe({
        next: (files) => {
          this.files.set(files);
        },
        error: () => {
          this.errorMessage.set('Не удалось получить список файлов (возможно, нужна авторизация).');
        }
      });
  }
}
