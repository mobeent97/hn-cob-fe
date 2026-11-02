import { Routes } from '@angular/router';

export const NOTIFICATIONS_ROUTES: Routes = [
  { path: '', loadComponent: () => import('./notifications-page').then((m) => m.NotificationsPage) },
];
