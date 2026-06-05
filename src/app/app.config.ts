import { ApplicationConfig, APP_INITIALIZER } from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { Router, provideRouter, withDisabledInitialNavigation } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { routes } from './app.routes';
import { authInterceptor } from './core/interceptors/auth.interceptor';
import { credentialsInterceptor } from './core/interceptors/credentials.interceptor';
import { AuthService } from './core/services/auth.service';
import { DownloadService } from './core/services/download.service';

export const appConfig: ApplicationConfig = {
  providers: [
    // withDisabledInitialNavigation + manual router.initialNavigation() after session restore.
    // withEnabledBlockingInitialNavigation starts navigation CONCURRENTLY with APP_INITIALIZER,
    // so guards would see authStatus='unauthenticated' while the refresh HTTP call is in-flight.
    provideRouter(routes, withDisabledInitialNavigation()),
    provideHttpClient(withInterceptors([credentialsInterceptor, authInterceptor])),
    {
      provide: APP_INITIALIZER,
      useFactory: (auth: AuthService, router: Router) => async () => {
        if (auth.hadSession()) {
          await firstValueFrom(auth.tryRestoreSession());
        }
        // Navigation starts here — guards now see the correct auth state.
        router.initialNavigation();
      },
      deps: [AuthService, Router],
      multi: true,
    },
    {
      provide: APP_INITIALIZER,
      useFactory: (dl: DownloadService) => () => dl.init(),
      deps: [DownloadService],
      multi: true,
    },
  ],
};
