import { Component, HostListener, computed, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { AuthService } from '../core/services/auth.service';

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './layout.component.html',
  styleUrl: './layout.component.scss',
})
export class LayoutComponent {
  private readonly auth   = inject(AuthService);
  private readonly router = inject(Router);

  readonly userInitial = computed(() => {
    const email = this.auth.email();
    return email ? email[0].toUpperCase() : '?';
  });

  readonly userEmail = computed(() => this.auth.email() ?? '');

  readonly isMenuOpen = signal(false);

  toggleMenu(): void { this.isMenuOpen.update(v => !v); }
  closeMenu(): void  { this.isMenuOpen.set(false); }

  @HostListener('document:keydown.escape')
  onEscape(): void { this.closeMenu(); }

  logout(): void {
    this.auth.logout();
    this.router.navigate(['/']);
  }
}
