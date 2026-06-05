import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, switchMap, throwError } from 'rxjs';

import { AuthService } from '../services/auth.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth   = inject(AuthService);
  const router = inject(Router);

  const accessToken = auth.accessToken();
  const isAuthRequest =
    req.url.includes('/auth/login') ||
    req.url.includes('/auth/register') ||
    req.url.includes('/auth/refresh') ||
    req.url.includes('/auth/logout');

  const authedReq =
    accessToken && !isAuthRequest
      ? req.clone({ setHeaders: { Authorization: `Bearer ${accessToken}` } })
      : req;

  return next(authedReq).pipe(
    catchError((err: unknown) => {
      if (!(err instanceof HttpErrorResponse) || err.status !== 401 || isAuthRequest) {
        return throwError(() => err);
      }

      return auth.startOrJoinRefresh().pipe(
        switchMap(() => {
          const newToken = auth.accessToken();
          if (!newToken) {
            auth.logout();
            router.navigate(['/auth/login']);
            return throwError(() => err);
          }
          return next(
            req.clone({
              setHeaders: { Authorization: `Bearer ${newToken}` },
            })
          );
        }),
        catchError((e) => {
          auth.logout();
          router.navigate(['/auth/login']);
          return throwError(() => e);
        })
      );
    })
  );
};
