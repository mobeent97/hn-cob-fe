import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { Store } from './core/data/store';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling, withViewTransitions } from '@angular/router';
import { routes } from './app.routes';
import { authInterceptor } from './core/auth/auth.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withInMemoryScrolling({ scrollPositionRestoration: 'top' }),
      // Route changes cross-fade the sheet only (see styles/_base.scss ::view-transition rules).
      withViewTransitions({ skipInitialTransition: true }),
    ),
    provideHttpClient(withInterceptors([authInterceptor])),
    // Design preview: any URL with ?as=<userId> signs in as that sample user before the first route check.
    provideAppInitializer(() => {
      const store = inject(Store);
      const as = Number(new URLSearchParams(location.search).get('as'));
      if (as && store.allUsers().some((u) => u.id === as)) store.signInAs(as);
    }),
  ],
};
