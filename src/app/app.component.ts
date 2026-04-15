import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize } from 'rxjs';

import { FileItem } from './core/models/file-item.model';
import { AuthService } from './core/services/auth.service';
import { FilesService } from './core/services/files.service';
import { AuthPanelComponent } from './auth-panel/auth-panel.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [DatePipe, ReactiveFormsModule, AuthPanelComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  private readonly filesService = inject(FilesService);
  private readonly auth = inject(AuthService);
  private readonly fb = inject(FormBuilder);
  private readonly registerPasswordMinLenValidator = Validators.minLength(8);

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
    const pass = this.loginForm.controls.password;
    if (mode === 'register') {
      pass.addValidators(this.registerPasswordMinLenValidator);
    } else {
      pass.removeValidators(this.registerPasswordMinLenValidator);
    }
    pass.updateValueAndValidity();
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
      error: (err: unknown) => {
        if (err instanceof HttpErrorResponse) {
          this.errorMessage.set(
            this.authMode() === 'register'
              ? 'Не удалось зарегистрироваться (возможно, пользователь уже существует).'
              : 'Не удалось войти (проверьте email/пароль).'
          );
          return;
        }
        if (err instanceof Error && err.message) {
          this.errorMessage.set(err.message);
          return;
        }
        this.errorMessage.set('Произошла ошибка. Попробуйте снова.');
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
        error: (err: unknown) => {
          if (this.isMasterKeyMissing(err)) {
            this.auth.clearAccess();
            this.errorMessage.set('Сессия истекла — войдите заново.');
            return;
          }
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

    this.filesService.downloadFile(file.blob_id, file.file_name).subscribe({
      next: () => {
        this.actionMessage.set(`Файл "${file.file_name}" скачан.`);
      },
      error: (err: unknown) => {
        if (this.isMasterKeyMissing(err)) {
          this.auth.clearAccess();
          this.errorMessage.set('Сессия истекла — войдите заново.');
          return;
        }
        this.errorMessage.set(`Не удалось скачать "${file.file_name}".`);
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
        this.actionMessage.set(`Файл "${file.file_name}" удален.`);
        this.refreshFiles();
      },
      error: () => {
        this.errorMessage.set(`Не удалось удалить "${file.file_name}".`);
      }
    });
  }

  private isMasterKeyMissing(err: unknown): boolean {
    return err instanceof Error && err.message.startsWith('Master key');
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
