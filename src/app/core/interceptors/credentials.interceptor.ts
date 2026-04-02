import { HttpInterceptorFn } from '@angular/common/http';

import { environment } from '../../../environments/environment';

/**
 * Запросы к API с относительным базовым путём — с куками (refresh в HttpOnly).
 * Прокси ng serve сохраняет Set-Cookie для того же origin, что и страница.
 */
export const credentialsInterceptor: HttpInterceptorFn = (req, next) => {
  const base = environment.apiBaseUrl;
  if (!base || base === '/') {
    return next(req.clone({ withCredentials: true }));
  }
  if (req.url === base || req.url.startsWith(`${base}/`)) {
    return next(req.clone({ withCredentials: true }));
  }
  return next(req);
};
