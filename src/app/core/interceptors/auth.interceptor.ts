import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, finalize, Observable, shareReplay, switchMap, throwError } from 'rxjs';

import { AuthService } from '../services/auth.service';

let refreshInFlight$: Observable<void> | null = null;

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);

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

      const refreshToken = auth.refreshToken();
      if (!refreshToken) {
        auth.logout();
        return throwError(() => err);
      }

      if (!refreshInFlight$) {
        refreshInFlight$ = auth.refresh().pipe(
          shareReplay({ bufferSize: 1, refCount: false }),
          finalize(() => {
            refreshInFlight$ = null;
          })
        );
      }

      return refreshInFlight$.pipe(
        switchMap(() => {
          const newToken = auth.accessToken();
          if (!newToken) {
            auth.logout();
            return throwError(() => err);
          }
          return next(req.clone({ setHeaders: { Authorization: `Bearer ${newToken}` } }));
        }),
        catchError((e) => {
          auth.logout();
          return throwError(() => e);
        })
      );
    })
  );
};

