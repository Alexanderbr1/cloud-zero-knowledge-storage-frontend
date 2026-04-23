import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'files',
    pathMatch: 'full',
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
        path: 'profile',
        loadComponent: () =>
          import('./features/sessions/pages/profile/profile.component').then(m => m.ProfileComponent),
      },
    ],
  },
];
