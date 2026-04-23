import { Component, computed, inject } from '@angular/core';
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
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly userInitial = computed(() => {
    const email = this.auth.email();
    return email ? email[0].toUpperCase() : '?';
  });

  readonly userEmail = computed(() => this.auth.email() ?? '');

  logout(): void {
    this.auth.logout();
    this.router.navigate(['/']);
  }
}
