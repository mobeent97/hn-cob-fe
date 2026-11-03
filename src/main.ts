import { bootstrapApplication } from '@angular/platform-browser';
import { NavigationCancel, NavigationEnd, NavigationError, Router } from '@angular/router';
import { appConfig } from './app/app.config';
import { App } from './app/app';

/** Fades the boot screen in index.html out once the first page has rendered (IoTility's bootstrap.ts). */
function removeBootstrapLoader(): void {
  // Wait for the activated route to be rendered before revealing the page.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const loader = document.getElementById('bootstrap-loading');
      if (!loader) return;
      loader.classList.add('is-leaving');
      loader.addEventListener('transitionend', () => loader.remove(), { once: true });
      setTimeout(() => loader.remove(), 400);
    });
  });
}

bootstrapApplication(App, appConfig)
  .then((application) => {
    const router = application.injector.get(Router);
    if (router.navigated) {
      removeBootstrapLoader();
      return;
    }
    const subscription = router.events.subscribe((event) => {
      if (event instanceof NavigationEnd || event instanceof NavigationError || event instanceof NavigationCancel) {
        subscription.unsubscribe();
        removeBootstrapLoader();
      }
    });
  })
  .catch((err) => console.error(err));
