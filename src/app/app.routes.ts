import { Routes } from '@angular/router';

import { authGuard, lockedGuard, unauthenticatedGuard } from './core/guards/auth.guard';

export const routes: Routes = [
  { path: '', redirectTo: 'files', pathMatch: 'full' },

  // ─── Auth routes ────────────────────────────────────────────────────────────
  {
    path: 'auth',
    children: [
      {
        path: 'login',
        loadComponent: () =>
          import('./features/auth/pages/login/login.component').then(m => m.LoginPageComponent),
        canActivate: [unauthenticatedGuard],
      },
      {
        path: 'unlock',
        loadComponent: () =>
          import('./features/auth/pages/unlock/unlock.component').then(m => m.UnlockPageComponent),
        canActivate: [lockedGuard],
      },
      {
        path: 'forgot-password',
        loadComponent: () =>
          import('./features/auth/pages/forgot-password/forgot-password.component').then(m => m.ForgotPasswordComponent),
      },
      {
        path: 'reset-password',
        loadComponent: () =>
          import('./features/auth/pages/reset-password/reset-password.component').then(m => m.ResetPasswordComponent),
      },
    ],
  },

  // ─── App routes (protected) ──────────────────────────────────────────────────
  {
    path: '',
    loadComponent: () =>
      import('./layout/layout.component').then(m => m.LayoutComponent),
    canActivate: [authGuard],
    children: [
      {
        path: 'files',
        loadComponent: () =>
          import('./features/storage/pages/files/files.component').then(m => m.FilesComponent),
      },
      {
        path: 'shared',
        loadComponent: () =>
          import('./features/storage/pages/shared/shared-with-me.component').then(m => m.SharedWithMeComponent),
      },
      {
        path: 'trash',
        loadComponent: () =>
          import('./features/storage/pages/trash/trash.component').then(m => m.TrashComponent),
      },
      {
        path: 'profile',
        loadComponent: () =>
          import('./features/profile/pages/profile/profile.component').then(m => m.ProfileComponent),
      },
      {
        path: 'activity',
        loadComponent: () =>
          import('./features/audit/pages/activity/activity.component').then(m => m.ActivityComponent),
      },
      {
        path: 'favorites',
        loadComponent: () =>
          import('./features/favorites/pages/favorites/favorites.component').then(m => m.FavoritesComponent),
      },
    ],
  },
];
