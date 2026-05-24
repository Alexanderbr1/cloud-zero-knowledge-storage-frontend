import {
  ChangeDetectionStrategy, Component, DestroyRef,
  ElementRef, OnInit, afterNextRender, computed, inject, input, output, signal, viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { finalize, switchMap } from 'rxjs';

import { AuthService } from '../../../../core/services/auth.service';
import { ShareItem, SharingService } from '../../../../core/services/sharing.service';
import { ToastService } from '../../../../core/services/toast.service';
import { FileItem } from '../../models/file-item.model';

@Component({
  selector: 'app-file-share-dialog',
  imports: [DatePipe],
  templateUrl: './file-share-dialog.component.html',
  styleUrl: './file-share-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FileShareDialogComponent implements OnInit {
  private readonly sharingService = inject(SharingService);
  private readonly auth           = inject(AuthService);
  private readonly toast          = inject(ToastService);
  private readonly destroyRef     = inject(DestroyRef);

  private readonly emailInputRef = viewChild<ElementRef<HTMLInputElement>>('emailInput');

  constructor() {
    afterNextRender(() => this.emailInputRef()?.nativeElement.focus());
  }

  ngOnInit(): void { this.loadShares(); }

  readonly file   = input.required<FileItem>();
  readonly closed = output<void>();

  readonly shares          = signal<ShareItem[]>([]);
  readonly isLoadingShares = signal(false);
  readonly shareEmail      = signal('');
  readonly expiresAt       = signal('');
  readonly isSharing       = signal(false);
  readonly shareError      = signal('');
  readonly revokingId      = signal<string | null>(null);
  readonly hasShares       = computed(() => this.shares().length > 0);
  readonly minDate         = new Date().toISOString().slice(0, 10);

  private loadShares(): void {
    this.isLoadingShares.set(true);
    this.sharingService.listMyShares(this.file().blob_id).pipe(
      finalize(() => this.isLoadingShares.set(false)),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: resp => this.shares.set(resp.items ?? []),
      error: () => this.shareError.set('Не удалось загрузить список доступа.'),
    });
  }

  submit(): void {
    const file  = this.file();
    const email = this.shareEmail().trim().toLowerCase();
    if (!email) return;

    this.isSharing.set(true);
    this.shareError.set('');

    const expiresAt = this.expiresAt().trim();
    const expiresAtIso = expiresAt
      ? new Date(expiresAt + 'T23:59:59').toISOString()
      : undefined;

    this.sharingService.getRecipientPublicKey(email).pipe(
      switchMap(publicKey =>
        this.sharingService.shareFileWithUser(file.blob_id, file.encrypted_file_key, email, publicKey, expiresAtIso),
      ),
      finalize(() => this.isSharing.set(false)),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: () => {
        this.shareEmail.set('');
        this.loadShares();
      },
      error: (err: unknown) => {
        if (err instanceof Error && err.message.startsWith('KEK')) {
          this.auth.clearAccess();
          this.toast.error('Сессия истекла — войдите снова.');
          this.closed.emit();
          return;
        }
        if (err instanceof HttpErrorResponse) {
          if (err.status === 404)      this.shareError.set('Пользователь с таким email не найден.');
          else if (err.status === 429) this.shareError.set('Слишком много запросов. Подождите.');
          else if (err.status === 409) this.shareError.set('Вы уже открыли доступ этому пользователю.');
          else if (err.status === 400) this.shareError.set('Нельзя открыть доступ самому себе.');
          else                         this.shareError.set('Не удалось поделиться файлом.');
        } else {
          this.shareError.set('Не удалось поделиться файлом.');
        }
      },
    });
  }

  revoke(shareId: string): void {
    this.revokingId.set(shareId);
    this.sharingService.revokeShare(shareId).pipe(
      finalize(() => this.revokingId.set(null)),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: () => this.shares.update(list => list.filter(s => s.share_id !== shareId)),
      error: () => this.shareError.set('Не удалось отозвать доступ.'),
    });
  }

  onEmailInput(e: Event): void    { this.shareEmail.set((e.target as HTMLInputElement).value); }
  onExpiresAtInput(e: Event): void { this.expiresAt.set((e.target as HTMLInputElement).value); }
  clearExpiry(): void             { this.expiresAt.set(''); }
  close(): void                   { this.closed.emit(); }
}
