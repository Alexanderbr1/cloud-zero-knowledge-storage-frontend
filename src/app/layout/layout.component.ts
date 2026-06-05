import { ChangeDetectionStrategy, Component, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { AuthService } from '../core/services/auth.service';
import { StorageUsageService } from '../core/services/storage-usage.service';

@Component({
  selector: 'app-layout',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, DecimalPipe],
  templateUrl: './layout.component.html',
  styleUrl: './layout.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LayoutComponent implements OnInit {
  protected readonly auth   = inject(AuthService);
  private readonly router   = inject(Router);
  private readonly usageSvc = inject(StorageUsageService);

  readonly storageUsage = this.usageSvc.usage;
  readonly storagePct   = this.usageSvc.pct;

  readonly userInitial    = computed(() => this.auth.email()?.charAt(0).toUpperCase() ?? '?');
  readonly userEmail      = computed(() => this.auth.email() ?? '');
  readonly isMenuOpen     = signal(false);
  readonly isUserMenuOpen = signal(false);

  ngOnInit(): void { this.usageSvc.refresh(); }

  toggleMenu(): void { this.isMenuOpen.update(v => !v); }
  closeMenu(): void  { this.isMenuOpen.set(false); }

  toggleUserMenu(e: MouseEvent): void {
    e.stopPropagation();
    this.isUserMenuOpen.update(v => !v);
  }

  logout(): void {
    this.auth.logout();
    this.router.navigate(['/auth/login']);
  }

  @HostListener('document:click')
  onDocClick(): void { this.isUserMenuOpen.set(false); }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.closeMenu();
    this.isUserMenuOpen.set(false);
  }

  closeRecovery(): void {
    this.auth.clearRecoveryPhrase();
  }

  protected formatBytes(bytes: number): string {
    if (bytes < 1024)      return `${bytes} Б`;
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} КБ`;
    if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(2)} МБ`;
    return `${(bytes / 1024 ** 3).toFixed(2)} ГБ`;
  }
}
