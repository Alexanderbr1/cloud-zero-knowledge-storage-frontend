import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { AuthService } from '../services/auth.service';

/** Protects all app routes — redirects to /auth/unlock or /auth/login with returnUrl. */
export const authGuard: CanActivateFn = (_, state) => {
  const auth   = inject(AuthService);
  const router = inject(Router);
  const status = auth.authStatus();

  if (status === 'unlocked') return true;

  const target = status === 'locked' ? '/auth/unlock' : '/auth/login';
  return router.createUrlTree([target], { queryParams: { returnUrl: state.url } });
};

/** Guards /auth/login — redirects away when user is already authenticated. */
export const unauthenticatedGuard: CanActivateFn = () => {
  const auth   = inject(AuthService);
  const router = inject(Router);
  const status = auth.authStatus();

  if (status === 'unauthenticated') return true;
  return router.createUrlTree([status === 'locked' ? '/auth/unlock' : '/files']);
};

/** Guards /auth/unlock — only accessible when authenticated but locked. */
export const lockedGuard: CanActivateFn = () => {
  const auth   = inject(AuthService);
  const router = inject(Router);
  const status = auth.authStatus();

  if (status === 'locked') return true;
  return router.createUrlTree([status === 'unlocked' ? '/files' : '/auth/login']);
};
