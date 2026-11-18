import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';
import { routes } from './app.routes';
import { authInterceptor } from './core/auth/auth.interceptor';
import { AuthService } from './core/auth/auth.service';
import { SessionLoader } from './core/auth/session-loader';
import { BrandTheme } from './core/theme/brand';
import { NotificationCenter } from './core/notifications/notification-center';
import { PushService } from './core/notifications/push.service';

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
    // Restore the session from stored tokens (GET /auth/me/) and load its access, settings and organizations
    // before the first route check; a failed restore clears the tokens.
    provideAppInitializer(() => {
      const auth = inject(AuthService);
      const session = inject(SessionLoader);
      // Starts the organization brand theme (BRANDING_MEDIA_EMAIL.md 1.4); it follows the session from here.
      inject(BrandTheme);
      // The bell's feed (refresh on sign-in, focus, a 60 s unread poll) and browser push (PUSH_NOTIFICATIONS.md 6).
      inject(NotificationCenter);
      inject(PushService);
      return auth.restoreSession().then(() => session.load());
    }),
  ],
};
