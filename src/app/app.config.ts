import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { Store } from './core/data/store';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';
import { routes } from './app.routes';
import { authInterceptor } from './core/auth/auth.interceptor';
import { AuthService } from './core/auth/auth.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withInMemoryScrolling({ scrollPositionRestoration: 'top' }),
      // No router view transitions: the incoming page fades in through IoTility's route-page-in (theme.css).
    ),
    provideHttpClient(withInterceptors([authInterceptor])),
    // Restore the session from stored tokens (GET /auth/me) before the first route check; failure clears them.
    provideAppInitializer(() => inject(AuthService).restoreSession()),
    // Design preview: any URL with ?as=<userId> signs in as that sample user before the first route check.
    // Applied after the session is restored, so it wins over the real user's default mock session.
    provideAppInitializer(async () => {
      const store = inject(Store);
      await inject(AuthService).restoreSession();
      const as = Number(new URLSearchParams(location.search).get('as'));
      if (as && store.allUsers().some((u) => u.id === as)) store.signInAs(as);
    }),
  ],
};
