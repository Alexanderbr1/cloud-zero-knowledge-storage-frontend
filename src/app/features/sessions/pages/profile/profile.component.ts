import { Component, computed, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { AuthService } from '../../../../core/services/auth.service';
import { SessionsComponent } from '../../components/sessions-list/sessions.component';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [RouterLink, SessionsComponent],
  templateUrl: './profile.component.html',
  styleUrl: './profile.component.scss',
})
export class ProfileComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly email = computed(() => this.auth.email() ?? '—');
  readonly userInitial = computed(() => {
    const e = this.auth.email();
    return e ? e[0].toUpperCase() : '?';
  });

  logout(): void {
    this.auth.logout();
    this.router.navigate(['/']);
  }
}
