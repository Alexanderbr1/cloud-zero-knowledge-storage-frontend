import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'files',
    pathMatch: 'full',
  },
  {
    path: 'auth/forgot-password',
    loadComponent: () =>
      import('./features/auth/pages/forgot-password/forgot-password.component').then(m => m.ForgotPasswordComponent),
  },
  {
    path: 'auth/reset-password',
    loadComponent: () =>
      import('./features/auth/pages/reset-password/reset-password.component').then(m => m.ResetPasswordComponent),
  },
  {
    path: '',
    loadComponent: () =>
      import('./layout/layout.component').then(m => m.LayoutComponent),
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
