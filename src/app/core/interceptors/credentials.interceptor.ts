import { HttpInterceptorFn } from '@angular/common/http';

import { environment } from '../../../environments/environment';

try { localStorage.removeItem('device_id'); } catch { /* ignore */ }

export const credentialsInterceptor: HttpInterceptorFn = (req, next) => {
  const base = environment.apiBaseUrl;
  const isApiRequest = !base || base === '/' || req.url === base || req.url.startsWith(`${base}/`);

  if (!isApiRequest) {
    return next(req);
  }

  return next(req.clone({ withCredentials: true }));
};
