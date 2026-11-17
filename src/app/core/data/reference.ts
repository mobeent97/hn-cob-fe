// Reference data the portal ships with (not sample data). Each list moves to the API when its
// admin screen exists — see docs/ROADMAP.md.
import { Country, NotificationPrefs, PortalSettings } from './models';
import { FEATURE_KEYS } from '../access/features';

export const COUNTRIES: Country[] = [
  { code: 'AE', name: 'United Arab Emirates', dial: '+971', currency: 'AED', zones: ['Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman'] },
  { code: 'QA', name: 'Qatar', dial: '+974', currency: 'QAR', zones: ['Doha', 'Al Rayyan', 'Lusail', 'Al Wakrah'] },
  { code: 'PK', name: 'Pakistan', dial: '+92', currency: 'PKR', zones: ['Karachi', 'Lahore', 'Islamabad'] },
  { code: 'BH', name: 'Bahrain', dial: '+973', currency: 'BHD', zones: ['Manama', 'Muharraq'] },
  { code: 'NG', name: 'Nigeria', dial: '+234', currency: 'NGN', zones: ['Lagos', 'Abuja'] },
  { code: 'GB', name: 'United Kingdom', dial: '+44', currency: 'GBP', zones: ['London', 'Manchester'] },
  { code: 'LB', name: 'Lebanon', dial: '+961', currency: 'USD', zones: ['Beirut'] },
];

export const INDUSTRIES = [
  'Logistics', 'Cold chain', 'Construction', 'Waste management', 'Passenger transport',
  'Oil & gas services', 'Retail distribution', 'Rental & leasing', 'Government services', 'Utilities',
];

export const USE_CASE = 'Fleet Management System';

/** Every permission-carrying feature (core/access/features.ts). */
export const FEATURE_PERMISSIONS = FEATURE_KEYS;

/** Shown until GET /settings/ answers (SETTINGS_API defaults: 10+ chars, a number, a symbol). */
export const DEFAULT_SETTINGS: PortalSettings = {
  password: { minLength: 10, requireNumber: true, requireSymbol: true, expiryDays: 90, history: 5 },
  pagination: { pageSize: 10 },
  login: { sessionMinutes: 30, maxAttempts: 5, lockMinutes: 15 },
};

/** SETTINGS_API defaults, shown until GET /notifications/preferences/ answers. */
export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  channels: {
    order: { inApp: true, email: true },
    onboarding: { inApp: true, email: false },
    deletion: { inApp: true, email: true },
    device: { inApp: true, email: false },
    contract: { inApp: true, email: true },
    account: { inApp: true, email: false },
  },
  digest: 'daily',
  quiet: { from: '20:00', to: '07:00' },
  timezone: 'UTC',
};
