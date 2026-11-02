import { Routes } from '@angular/router';
import { Shell } from './core/layout/shell';
import { featureGuard } from './core/access/access';

// Screen map mirrors the legacy portal (legacy-flows/00-live-capture.md), regrouped by job.
// Every screen is lazy-loaded; titles feed the browser tab via the TitleStrategy default.
const T = (t: string) => `${t} · HyperNym Onboarding`;

export const routes: Routes = [
  { path: 'login', title: T('Sign in'), loadComponent: () => import('./features/auth/login').then((m) => m.Login) },
  { path: 'forgot-password', title: T('Forgot password'), loadComponent: () => import('./features/auth/forgot-password').then((m) => m.ForgotPassword) },
  { path: 'reset-password', title: T('Set a new password'), loadComponent: () => import('./features/auth/reset-password').then((m) => m.ResetPassword) },
  {
    path: '',
    component: Shell,
    // Every child screen is checked against the user's feature access (core/access).
    canActivateChild: [featureGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      { path: 'dashboard', title: T('Overview'), loadComponent: () => import('./features/dashboard/dashboard').then((m) => m.Dashboard) },
      { path: 'reports', title: T('Reports'), loadComponent: () => import('./features/reports/reports-home').then((m) => m.ReportsHome) },
      { path: 'reports/:id', title: T('Report'), loadComponent: () => import('./features/reports/report-view').then((m) => m.ReportView) },
      { path: 'notifications', title: T('Notifications'), loadComponent: () => import('./features/notifications/notifications').then((m) => m.Notifications) },
      { path: 'tracking', title: T('Live tracking'), loadComponent: () => import('./features/tracking/tracking').then((m) => m.Tracking) },

      { path: 'customers', title: T('Customers'), loadComponent: () => import('./features/customers/customer-list').then((m) => m.CustomerList) },
      { path: 'customers/new', title: T('New customer'), loadComponent: () => import('./features/customers/customer-form').then((m) => m.CustomerForm) },
      { path: 'customers/:id/edit', title: T('Edit customer'), loadComponent: () => import('./features/customers/customer-form').then((m) => m.CustomerForm) },
      { path: 'customers/:id', title: T('Customer'), loadComponent: () => import('./features/customers/customer-detail').then((m) => m.CustomerDetail) },
      { path: 'consumers', title: T('Consumers'), loadComponent: () => import('./features/consumers/consumer-list').then((m) => m.ConsumerList) },

      { path: 'inventory', title: T('Inventory'), loadComponent: () => import('./features/inventory/inventory-list').then((m) => m.InventoryList) },
      { path: 'device-types', title: T('Device types'), loadComponent: () => import('./features/inventory/device-types').then((m) => m.DeviceTypes) },
      { path: 'sensors', title: T('Sensors'), loadComponent: () => import('./features/inventory/sensors').then((m) => m.Sensors) },
      { path: 'qr-codes', title: T('QR codes'), loadComponent: () => import('./features/inventory/qr-codes').then((m) => m.QrCodes) },
      { path: 'devices/:id', title: T('Device'), loadComponent: () => import('./features/devices/device-detail').then((m) => m.DeviceDetail) },
      { path: 'device-management', title: T('Fleet health'), loadComponent: () => import('./features/device-management/fleet-health').then((m) => m.FleetHealth) },
      { path: 'device-config', title: T('Configuration profiles'), loadComponent: () => import('./features/device-management/config-profiles').then((m) => m.ConfigProfiles) },
      { path: 'commands', title: T('Commands'), loadComponent: () => import('./features/device-management/commands').then((m) => m.Commands) },
      { path: 'provisioning', title: T('Provisioning'), loadComponent: () => import('./features/device-management/provisioning').then((m) => m.Provisioning) },
      { path: 'orders', title: T('Hardware orders'), loadComponent: () => import('./features/orders/orders').then((m) => m.Orders) },

      { path: 'packages', title: T('Packages'), loadComponent: () => import('./features/catalogue/packages').then((m) => m.Packages) },
      { path: 'use-cases', title: T('Use cases'), loadComponent: () => import('./features/catalogue/use-cases').then((m) => m.UseCases) },
      { path: 'vouchers', title: T('Vouchers'), loadComponent: () => import('./features/catalogue/vouchers').then((m) => m.Vouchers) },

      { path: 'diagnostics/parameters', title: T('Diagnostic parameters'), loadComponent: () => import('./features/diagnostics/parameters').then((m) => m.Parameters) },
      { path: 'diagnostics/actions', title: T('Device actions'), loadComponent: () => import('./features/diagnostics/actions').then((m) => m.DeviceActions) },

      { path: 'users', title: T('Users'), loadComponent: () => import('./features/admin/users').then((m) => m.Users) },
      { path: 'groups', title: T('Roles'), loadComponent: () => import('./features/admin/groups').then((m) => m.Groups) },
      { path: 'audit', title: T('Deletion audit'), loadComponent: () => import('./features/admin/audit').then((m) => m.Audit) },
      { path: 'settings', title: T('Settings'), loadComponent: () => import('./features/admin/settings').then((m) => m.Settings) },
      { path: 'profile', title: T('My profile'), loadComponent: () => import('./features/admin/profile').then((m) => m.Profile) },
      { path: 'organizations', title: T('Organizations'), loadComponent: () => import('./features/organizations/organizations').then((m) => m.Organizations) },
      { path: 'forbidden', title: T('No access'), loadComponent: () => import('./core/access/forbidden').then((m) => m.Forbidden) },
      { path: 'help', title: T('Help & FAQs'), loadComponent: () => import('./features/admin/help').then((m) => m.Help) },
    ],
  },
  { path: '**', redirectTo: 'dashboard' },
];
