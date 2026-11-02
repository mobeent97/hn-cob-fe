// The portal is feature-based: every screen belongs to exactly one feature, and access is
// decided per feature at two levels:
//   1. the organization's entitlement (what HyperNym sold the tenant), and
//   2. the user's roles inside that organization (what this person may do).
// Effective access = the lower of the two. Superusers bypass both.
// The Django backend mirrors this list as the source of truth (one permission per feature).

export interface FeatureDef {
  key: string;
  label: string;
  area: 'Overview' | 'Onboarding' | 'Devices' | 'Device management' | 'Catalogue' | 'Administration';
  description: string;
  /** Never granted outside the platform organization (HyperNym). */
  platformOnly?: boolean;
}

export const FEATURES: FeatureDef[] = [
  { key: 'Dashboard', label: 'Overview', area: 'Overview', description: 'Key figures and what needs attention.' },
  { key: 'Live tracking', label: 'Live tracking', area: 'Overview', description: 'Vehicles on the map in real time.' },
  { key: 'Reports', label: 'Reports', area: 'Overview', description: 'Funnel, activations, revenue and renewals reports.' },
  { key: 'Customers', label: 'Customers', area: 'Onboarding', description: 'Business customers and the onboarding wizard.' },
  { key: 'Consumers', label: 'Consumers', area: 'Onboarding', description: 'Individual (B2C) subscribers.' },
  { key: 'Inventory', label: 'Inventory', area: 'Devices', description: 'Devices, stock, allocation and QR labels.' },
  { key: 'Device types', label: 'Device types & sensors', area: 'Devices', description: 'The hardware catalogue.' },
  { key: 'Hardware orders', label: 'Hardware orders', area: 'Devices', description: 'Orders, shipping and delivery.' },
  { key: 'Device management', label: 'Device management', area: 'Device management', description: 'IoT Hub health, configuration profiles, commands, provisioning.', platformOnly: true },
  { key: 'Diagnostics', label: 'Diagnostics', area: 'Device management', description: 'Diagnostic parameters and device actions.' },
  { key: 'Packages', label: 'Packages', area: 'Catalogue', description: 'Packages, prices and the feature matrix.' },
  { key: 'Use cases', label: 'Use cases', area: 'Catalogue', description: 'Use cases and their modules.', platformOnly: true },
  { key: 'Vouchers', label: 'Vouchers', area: 'Catalogue', description: 'Discount vouchers.' },
  { key: 'Users', label: 'Users', area: 'Administration', description: 'Portal users of this organization.' },
  { key: 'Roles', label: 'Roles', area: 'Administration', description: 'Roles and their permissions.' },
  { key: 'Audit', label: 'Deletion audit', area: 'Administration', description: 'Deletion requests and the audit trail.' },
  { key: 'Settings', label: 'Settings', area: 'Administration', description: 'Password, session and pagination policy.', platformOnly: true },
  { key: 'Organizations', label: 'Organizations', area: 'Administration', description: 'Partner tenants and their entitlements.', platformOnly: true },
];

export const FEATURE_KEYS = FEATURES.map((f) => f.key);

/** Route path (first segment) → feature. Screens not listed (profile, help, notifications) are open to everyone signed in. */
export const ROUTE_FEATURE: Record<string, string> = {
  dashboard: 'Dashboard',
  tracking: 'Live tracking',
  reports: 'Reports',
  customers: 'Customers',
  consumers: 'Consumers',
  inventory: 'Inventory',
  devices: 'Inventory',
  'qr-codes': 'Inventory',
  'device-types': 'Device types',
  sensors: 'Device types',
  orders: 'Hardware orders',
  'device-management': 'Device management',
  'device-config': 'Device management',
  commands: 'Device management',
  provisioning: 'Device management',
  diagnostics: 'Diagnostics',
  packages: 'Packages',
  'use-cases': 'Use cases',
  vouchers: 'Vouchers',
  users: 'Users',
  groups: 'Roles',
  audit: 'Audit',
  settings: 'Settings',
  organizations: 'Organizations',
};
