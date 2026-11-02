import { IconName } from '../../shared/ui/icon';

export interface NavItem {
  label: string;
  path: string;
  icon: IconName;
  /** Optional key for a live count of work that needs action. */
  badge?: 'ordersToShip';
}
export interface NavGroup {
  label: string | null;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    label: null,
    items: [
      { label: 'Overview', path: '/dashboard', icon: 'dashboard' },
      { label: 'Live tracking', path: '/tracking', icon: 'navigation' },
      { label: 'Reports', path: '/reports', icon: 'chart' },
    ],
  },
  {
    label: 'Onboarding',
    items: [
      { label: 'Customers', path: '/customers', icon: 'building-2' },
      { label: 'Consumers', path: '/consumers', icon: 'user' },
    ],
  },
  {
    label: 'Devices',
    items: [
      { label: 'Inventory', path: '/inventory', icon: 'boxes' },
      { label: 'Device types', path: '/device-types', icon: 'cpu' },
      { label: 'Sensors', path: '/sensors', icon: 'radar' },
      { label: 'QR codes', path: '/qr-codes', icon: 'qr' },
      { label: 'Hardware orders', path: '/orders', icon: 'truck', badge: 'ordersToShip' },
    ],
  },
  {
    label: 'Device management',
    items: [
      { label: 'Fleet health', path: '/device-management', icon: 'activity' },
      { label: 'Configuration', path: '/device-config', icon: 'sliders' },
      { label: 'Commands', path: '/commands', icon: 'send' },
      { label: 'Provisioning', path: '/provisioning', icon: 'key' },
    ],
  },
  {
    label: 'Catalogue',
    items: [
      { label: 'Packages', path: '/packages', icon: 'package' },
      { label: 'Use cases', path: '/use-cases', icon: 'layers' },
      { label: 'Vouchers', path: '/vouchers', icon: 'ticket' },
    ],
  },
  {
    label: 'Diagnostics',
    items: [
      { label: 'Parameters', path: '/diagnostics/parameters', icon: 'sliders' },
      { label: 'Device actions', path: '/diagnostics/actions', icon: 'zap' },
    ],
  },
  {
    label: 'Administration',
    items: [
      { label: 'Users', path: '/users', icon: 'users' },
      { label: 'Roles', path: '/groups', icon: 'shield' },
      { label: 'Organizations', path: '/organizations', icon: 'building' },
      { label: 'Deletion audit', path: '/audit', icon: 'scroll' },
    ],
  },
];

export const NAV_FOOTER: NavItem[] = [
  { label: 'Settings', path: '/settings', icon: 'settings' },
  { label: 'Help & FAQs', path: '/help', icon: 'help' },
];
