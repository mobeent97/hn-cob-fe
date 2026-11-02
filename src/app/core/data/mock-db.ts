// Deterministic sample data for the design phase. Nothing here is real customer data.
// Totals shown on screens are always computed from these rows, never typed separately.
import {
  AdminUser, Consumer, Country, Customer, CustomerType, DeletionAudit, Device, DeviceAction,
  DeviceStatus, DeviceType, DiagnosticParam, FeatureGroup, Group, HardwareOrder, OrderStatus,
  PackageConfig, PackageName, PortalSettings, Sensor, UseCase, Vehicle, Voucher,
  AppNotification, NotificationKind, NotificationPrefs, Organization, Permission,
} from './models';
import { FEATURES, FEATURE_KEYS } from '../access/features';

/** "Today" for the sample data, so every relative date stays stable. */
export const TODAY = new Date('2026-11-02T09:30:00+04:00');
/** The portal runs on UAE time (UTC+4); clock maths uses this, never the browser's zone. */
export const HUB_UTC_OFFSET = 4;
export const hubHours = (d: Date) => (d.getUTCHours() + HUB_UTC_OFFSET) % 24;
export const hubMinutes = (d: Date) => d.getUTCMinutes();
const LOADED_AT = Date.now();
/** "Now" in the sample world: TODAY plus the real time since the app loaded. Stamp new events with this. */
export const nowIso = () => new Date(TODAY.getTime() + (Date.now() - LOADED_AT)).toISOString();

// ── Seeded random ─────────────────────────────────────────────
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261102);
const int = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
const digits = (n: number) => Array.from({ length: n }, () => int(0, 9)).join('');
const daysAgo = (d: number, h = int(8, 18)) => {
  const x = new Date(TODAY);
  x.setDate(x.getDate() - d);
  x.setHours(h, int(0, 59), 0, 0);
  return x.toISOString();
};
const daysAhead = (d: number) => daysAgo(-d, 12).slice(0, 10);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

// ── Reference data ────────────────────────────────────────────
export const COUNTRIES: Country[] = [
  { code: 'AE', name: 'United Arab Emirates', dial: '+971', currency: 'AED', zones: ['Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman'] },
  { code: 'QA', name: 'Qatar', dial: '+974', currency: 'QAR', zones: ['Doha', 'Al Rayyan', 'Lusail', 'Al Wakrah'] },
  { code: 'PK', name: 'Pakistan', dial: '+92', currency: 'PKR', zones: ['Karachi', 'Lahore', 'Islamabad'] },
  { code: 'BH', name: 'Bahrain', dial: '+973', currency: 'BHD', zones: ['Manama', 'Muharraq'] },
  { code: 'NG', name: 'Nigeria', dial: '+234', currency: 'NGN', zones: ['Lagos', 'Abuja'] },
  { code: 'GB', name: 'United Kingdom', dial: '+44', currency: 'GBP', zones: ['London', 'Manchester'] },
  { code: 'LB', name: 'Lebanon', dial: '+961', currency: 'USD', zones: ['Beirut'] },
];
// ── Organizations (tenants) ───────────────────────────────────
const ent = (rw: string[], r: string[] = []): Record<string, Permission> =>
  Object.fromEntries(FEATURE_KEYS.map((k) => [k, rw.includes(k) ? 'RW' : r.includes(k) ? 'R' : null]));
export const ORGANIZATIONS: Organization[] = [
  {
    id: 1, name: 'HyperNym', legalName: 'HyperNym Technologies FZ-LLC', kind: 'Platform', status: 'Active',
    countries: ['AE', 'QA', 'PK', 'BH', 'NG', 'GB', 'LB'], segments: ['B2B', 'B2C'],
    features: Object.fromEntries(FEATURE_KEYS.map((k) => [k, 'RW'])), limits: { maxCustomers: null, maxUsers: null },
    contact: { name: 'Mobeen Tahir', email: 'mobeen.tahir@hypernymbiz.com', phone: '+971 4 555 0100' },
    brandColour: '#0a6f96', createdAt: '2024-01-15T08:00:00.000Z',
  },
  {
    id: 2, name: 'Vodafone Qatar', legalName: 'Vodafone Qatar P.Q.S.C.', kind: 'Partner', status: 'Active',
    countries: ['QA'], segments: ['B2B', 'B2C'],
    features: ent(
      ['Customers', 'Consumers', 'Inventory', 'Hardware orders', 'Users', 'Roles'],
      ['Dashboard', 'Live tracking', 'Reports', 'Device types', 'Packages', 'Vouchers', 'Audit', 'Diagnostics'],
    ),
    limits: { maxCustomers: 50, maxUsers: 15 },
    contact: { name: 'Khalid Al Kuwari', email: 'khalid.alkuwari@vodafone.qa', phone: '+974 4400 1234' },
    brandColour: '#a81c26', createdAt: '2025-03-02T08:00:00.000Z',
  },
  {
    id: 3, name: 'MTN Nigeria', legalName: 'MTN Nigeria Communications PLC', kind: 'Partner', status: 'Active',
    countries: ['NG'], segments: ['B2B'],
    features: ent(['Customers', 'Inventory', 'Hardware orders', 'Users', 'Roles'], ['Dashboard', 'Live tracking', 'Reports', 'Device types', 'Packages', 'Audit']),
    limits: { maxCustomers: 25, maxUsers: 8 },
    contact: { name: 'Adebayo Okafor', email: 'adebayo.okafor@mtn.ng', phone: '+234 803 555 0142' },
    brandColour: '#7a5b00', createdAt: '2025-08-19T08:00:00.000Z',
  },
  {
    id: 4, name: 'Zain Bahrain', legalName: 'Zain Bahrain B.S.C.', kind: 'Partner', status: 'Invited',
    countries: ['BH'], segments: ['B2B'],
    features: ent(['Customers', 'Inventory', 'Users', 'Roles'], ['Dashboard', 'Reports', 'Device types', 'Packages']),
    limits: { maxCustomers: 20, maxUsers: 5 },
    contact: { name: 'Fatima Al Hashimi', email: 'fatima.alhashimi@bh.zain.com', phone: '+973 3600 7788' },
    brandColour: '#2a6f3e', createdAt: '2026-10-28T08:00:00.000Z',
  },
];
/** Which tenant serves a country's business customers (others stay with HyperNym directly). */
const ORG_FOR_COUNTRY: Record<string, number> = { QA: 2, NG: 3 };

export const INDUSTRIES = [
  'Logistics', 'Cold chain', 'Construction', 'Waste management', 'Passenger transport',
  'Oil & gas services', 'Retail distribution', 'Rental & leasing', 'Government services', 'Utilities',
];
export const USE_CASE = 'Fleet Management System';

export const PACKAGES: PackageConfig[] = [
  { id: 1, name: 'Basic', description: 'Live tracking, trips and core reports', monthlyPrice: 35 },
  { id: 2, name: 'Plug & Go', description: 'Self-installed OBD tracker, no technician visit', monthlyPrice: 29 },
  { id: 3, name: 'Advance', description: 'Adds dashcams, driver behaviour and maintenance', monthlyPrice: 65 },
  { id: 4, name: 'Enterprise', description: 'Advance plus API access, SSO and a dedicated manager', monthlyPrice: 95 },
];

export const SENSORS: Sensor[] = [
  { id: 1, key: 'has_obd_parameters', name: 'OBD parameters' },
  { id: 2, key: 'has_immobilizer', name: 'Immobilizer' },
  { id: 3, key: 'has_crash_detection', name: 'Crash detection' },
  { id: 4, key: 'has_tachograph', name: 'Tachograph' },
  { id: 5, key: 'has_temperature', name: 'Temperature probe' },
  { id: 6, key: 'has_fuel_level', name: 'Fuel level' },
];

export const DEVICE_TYPES: DeviceType[] = [
  { id: 1, name: 'FMC130', make: 'Teltonika', category: 'Gateway', packages: ['Basic', 'Advance', 'Enterprise'], warrantyYears: 2, sensors: ['has_obd_parameters', 'has_immobilizer', 'has_crash_detection', 'has_tachograph'], dataSheet: 'FMC130_datasheet.pdf', unitPrice: 420 },
  { id: 2, name: 'FMC003', make: 'Teltonika', category: 'Gateway', packages: ['Plug & Go'], warrantyYears: 1, sensors: ['has_obd_parameters'], dataSheet: 'FMC003_datasheet.pdf', unitPrice: 260 },
  { id: 3, name: 'FMB920', make: 'Teltonika', category: 'Gateway', packages: ['Basic'], warrantyYears: 2, sensors: ['has_immobilizer'], dataSheet: 'FMB920_datasheet.pdf', unitPrice: 210 },
  { id: 4, name: 'FMC650', make: 'Teltonika', category: 'Gateway', packages: ['Advance', 'Enterprise'], warrantyYears: 3, sensors: ['has_obd_parameters', 'has_tachograph', 'has_temperature', 'has_fuel_level'], dataSheet: 'FMC650_datasheet.pdf', unitPrice: 690 },
  { id: 5, name: 'JC400 dashcam', make: 'Concox', category: 'Dashcam', packages: ['Advance', 'Enterprise'], warrantyYears: 1, sensors: ['has_crash_detection'], dataSheet: null, unitPrice: 880 },
  { id: 6, name: 'EH3T dual-channel', make: 'BSJ', category: 'Dashcam', packages: ['Advance', 'Enterprise'], warrantyYears: 1, sensors: ['has_crash_detection'], dataSheet: 'BSJ_EH3T.pdf', unitPrice: 1150 },
  { id: 7, name: 'Howen Hero-ME41', make: 'Howen', category: 'Dashcam', packages: ['Enterprise'], warrantyYears: 2, sensors: ['has_crash_detection'], dataSheet: 'Howen_ME41.pdf', unitPrice: 1490 },
];

export const FEATURE_GROUPS: FeatureGroup[] = [
  { id: 1, name: 'Fleets', features: [
    { id: 1, name: 'Real-time tracking', packages: ['Basic', 'Plug & Go', 'Advance', 'Enterprise'] },
    { id: 2, name: 'Trip playback', packages: ['Basic', 'Plug & Go', 'Advance', 'Enterprise'] },
    { id: 3, name: 'Manage fleets', packages: ['Basic', 'Plug & Go', 'Advance', 'Enterprise'] },
    { id: 4, name: 'Geozones', packages: ['Basic', 'Advance', 'Enterprise'] },
    { id: 5, name: 'Points of interest', packages: ['Advance', 'Enterprise'] },
  ]},
  { id: 2, name: 'Dashcam', features: [
    { id: 6, name: 'Live video', packages: ['Advance', 'Enterprise'] },
    { id: 7, name: 'Event clips', packages: ['Advance', 'Enterprise'] },
  ]},
  { id: 3, name: 'Drivers', features: [
    { id: 8, name: 'Driver profiles', packages: ['Basic', 'Plug & Go', 'Advance', 'Enterprise'] },
    { id: 9, name: 'Driver scoring', packages: ['Advance', 'Enterprise'] },
    { id: 10, name: 'Fatigue alerts', packages: ['Enterprise'] },
  ]},
  { id: 4, name: 'Maintenance', features: [
    { id: 11, name: 'Service schedules', packages: ['Advance', 'Enterprise'] },
    { id: 12, name: 'Fuel monitoring', packages: ['Advance', 'Enterprise'] },
  ]},
  { id: 5, name: 'Route & dispatch', features: [
    { id: 13, name: 'Job dispatch', packages: ['Enterprise'] },
    { id: 14, name: 'Route optimisation', packages: ['Enterprise'] },
  ]},
  { id: 6, name: 'Reports', features: [
    { id: 15, name: 'Standard reports', packages: ['Basic', 'Plug & Go', 'Advance', 'Enterprise'] },
    { id: 16, name: 'Scheduled reports', packages: ['Advance', 'Enterprise'] },
    { id: 17, name: 'API access', packages: ['Enterprise'] },
  ]},
];

export const USE_CASES: UseCase[] = [
  { id: 1, name: USE_CASE, packages: ['Basic', 'Plug & Go', 'Advance', 'Enterprise'], modules: FEATURE_GROUPS.map((g) => g.name) },
  { id: 2, name: 'Cold Chain Monitoring', packages: ['Advance', 'Enterprise'], modules: ['Fleets', 'Reports'] },
];

// ── Customers ─────────────────────────────────────────────────
const COMPANIES: [string, string, string][] = [
  // company, country, industry
  ['Al Noor Logistics', 'AE', 'Logistics'], ['Gulf Crest Transport', 'AE', 'Passenger transport'],
  ['Marina Limousine', 'AE', 'Passenger transport'], ['Emirates Waste Solutions', 'AE', 'Waste management'],
  ['Desert Rose Contracting', 'AE', 'Construction'], ['Sharjah Fresh Distribution', 'AE', 'Cold chain'],
  ['Falcon Rent a Car', 'AE', 'Rental & leasing'], ['Dubai Municipality Fleet', 'AE', 'Government services'],
  ['Doha Cold Chain', 'QA', 'Cold chain'], ['Pearl Coast Haulage', 'QA', 'Logistics'],
  ['Lusail Build Co.', 'QA', 'Construction'], ['Qatar Pipeline Services', 'QA', 'Oil & gas services'],
  ['Al Rayyan School Buses', 'QA', 'Passenger transport'], ['Karachi Freight Lines', 'PK', 'Logistics'],
  ['Indus Dairy Express', 'PK', 'Cold chain'], ['Margalla Utilities', 'PK', 'Utilities'],
  ['Ravi Rentals', 'PK', 'Rental & leasing'], ['Manama Marine Supply', 'BH', 'Retail distribution'],
  ['Muharraq Couriers', 'BH', 'Logistics'], ['Lagos Metro Haulage', 'NG', 'Logistics'],
  ['Abuja Water Board', 'NG', 'Utilities'], ['Thames Valley Plant Hire', 'GB', 'Construction'],
  ['Northern Grocers Fleet', 'GB', 'Retail distribution'], ['Cedar Beverages', 'LB', 'Retail distribution'],
  ['Arabian Shield Security', 'AE', 'Government services'], ['Ajman Ready Mix', 'AE', 'Construction'],
  ['Sidra Medical Logistics', 'QA', 'Cold chain'], ['Hilal Oilfield Transport', 'AE', 'Oil & gas services'],
];
const FIRST = ['Omar', 'Fatima', 'Bilal', 'Aisha', 'Khalid', 'Mariam', 'Imran', 'Noura', 'Hamza', 'Sara', 'Yusuf', 'Layla', 'Tariq', 'Hina', 'Adebayo', 'Chloe', 'Rami', 'Zainab', 'Faisal', 'Amina', 'James', 'Priya', 'Saeed', 'Rania'];
const LAST = ['Al Mansouri', 'Qureshi', 'Haddad', 'Al Kuwari', 'Siddiqui', 'Okafor', 'Rahman', 'Al Hashimi', 'Butt', 'Nasser', 'Khan', 'Mitchell', 'Chaudhry', 'Al Suwaidi', 'Farouk', 'Patel', 'Al Thani', 'Malik'];

const PKG_WEIGHT: PackageName[] = ['Advance', 'Advance', 'Advance', 'Basic', 'Basic', 'Enterprise', 'Plug & Go'];
const TYPES: CustomerType[] = ['EBU', 'EBU', 'SME', 'SME', 'EBU'];

export const CUSTOMERS: Customer[] = COMPANIES.map(([company, cc, industry], i) => {
  const country = COUNTRIES.find((c) => c.code === cc)!;
  const first = pick(FIRST);
  const last = pick(LAST);
  const domain = `${slug(company).slice(0, 14)}.${cc === 'GB' ? 'co.uk' : 'com'}`;
  const createdDaysAgo = i < 3 ? int(2, 12) : int(20, 640);
  const stepsDone = i < 3 ? int(2, 7) : i === 3 ? 8 : 9;
  const government = industry === 'Government services';
  return {
    id: 101 + i,
    orgId: ORG_FOR_COUNTRY[cc] ?? 1,
    company,
    group: slug(company).slice(0, 10),
    industry,
    website: `https://${domain}`,
    email: `fleet@${domain}`,
    phone: `${country.dial} ${digits(2)} ${digits(3)} ${digits(4)}`,
    crNumber: `${cc}-${digits(7)}`,
    countryCode: cc,
    zone: pick(country.zones),
    contractExpiry: daysAhead(i % 9 === 4 ? int(8, 55) : int(90, 720)),
    contact: {
      firstName: first,
      lastName: last,
      qid: `${digits(3)}-${digits(4)}-${digits(7)}`,
      email: `${first.toLowerCase()}.${slug(last)}@${domain}`,
      phone: `${country.dial} ${digits(2)} ${digits(3)} ${digits(4)}`,
    },
    userGroups: ['Customer admin'],
    status: i === 17 || i === 22 ? 'Inactive' : 'Active',
    deletionStatus: i === 22 ? 'Requested' : 'None',
    useCase: i === 5 || i === 8 || i === 26 ? 'Cold Chain Monitoring' : USE_CASE,
    package: government ? 'Enterprise' : pick(PKG_WEIGHT),
    customerType: government ? 'Government' : pick(TYPES),
    superAdminEmail: `${first.toLowerCase()}.${slug(last)}@${domain}`,
    createdAt: daysAgo(createdDaysAgo),
    stepsDone,
    documents:
      stepsDone >= 2
        ? [
            { name: 'Trade licence.pdf', kind: 'Trade licence', sizeKb: int(180, 900), uploadedAt: daysAgo(createdDaysAgo - 1) },
            { name: 'Signed contract.pdf', kind: 'Contract', sizeKb: int(300, 1600), uploadedAt: daysAgo(createdDaysAgo - 1) },
            ...(rand() > 0.5 ? [{ name: 'Authorised signatory ID.jpg', kind: 'ID copy', sizeKb: int(90, 400), uploadedAt: daysAgo(createdDaysAgo - 2) }] : []),
          ]
        : [],
    admins:
      stepsDone >= 6
        ? [
            { name: `${first} ${last}`, email: `${first.toLowerCase()}.${slug(last)}@${domain}`, phone: `${country.dial} ${digits(2)} ${digits(3)} ${digits(4)}` },
            ...(rand() > 0.4 ? [(() => { const f = pick(FIRST), l = pick(LAST); return { name: `${f} ${l}`, email: `${f.toLowerCase()}.${slug(l)}@${domain}`, phone: `${country.dial} ${digits(2)} ${digits(3)} ${digits(4)}` }; })()] : []),
          ]
        : [],
    brandColour: pick(['#0a6f96', '#1e7b4f', '#a86f0c', '#7a1f2b', '#22313f', '#00695c']),
  };
});

export const CONSUMERS: Consumer[] = Array.from({ length: 14 }, (_, i) => {
  const f = pick(FIRST);
  const l = pick(LAST);
  return {
    id: 501 + i,
    orgId: 2, // B2C subscribers here are Vodafone Qatar's
    name: `${f} ${l}`,
    email: `${f.toLowerCase()}.${slug(l)}${int(1, 99)}@mail.com`,
    phone: `+974 ${digits(4)} ${digits(4)}`,
    qid: `${digits(3)}-${digits(4)}-${digits(7)}`,
    status: i === 6 ? 'Inactive' : 'Active',
    createdAt: daysAgo(int(4, 300)),
  };
});

// ── Devices ───────────────────────────────────────────────────
const PLATE_PREFIX: Record<string, string> = { AE: 'DXB', QA: 'QA', PK: 'LEA', BH: 'BH', NG: 'LAG', GB: 'GB', LB: 'LB' };
export const DEVICES: Device[] = [];
let serial = 10001;
const mkDevice = (status: DeviceStatus, customer: Customer | null, consumerId: number | null, typeId: number): Device => {
  const created = int(3, 600);
  const sold = status === 'Sold' || status === 'Deactivated';
  return {
    id: `${DEVICE_TYPES[typeId - 1].category === 'Dashcam' ? 'DC' : 'DEV'}-${serial++}`,
    orgId: customer?.orgId ?? (consumerId ? 2 : 1),
    imei: `35${digits(13)}`,
    typeId,
    customerId: customer?.id ?? null,
    consumerId,
    status,
    simSn: `8997101${digits(12)}`,
    msisdn: `97150${digits(7)}`,
    createdAt: daysAgo(created),
    lastSeen: sold ? daysAgo(rand() > 0.85 ? int(2, 20) : 0, rand() > 0.5 ? 9 : 8) : null,
    plate: sold && customer ? `${PLATE_PREFIX[customer.countryCode]} ${pick(['A', 'B', 'C', 'K', 'M'])} ${int(10000, 99999)}` : null,
  };
};
for (const c of CUSTOMERS) {
  if (c.stepsDone < 7) continue; // hardware not assigned yet
  const fleet = c.customerType === 'Government' ? int(40, 90) : c.customerType === 'EBU' ? int(12, 45) : int(3, 14);
  const allowed = DEVICE_TYPES.filter((t) => t.packages.includes(c.package));
  for (let k = 0; k < fleet; k++) {
    const r = rand();
    const status: DeviceStatus =
      c.status === 'Inactive' ? 'Deactivated' : c.stepsDone < 9 ? 'Allocated' : r < 0.88 ? 'Sold' : r < 0.985 ? 'Allocated' : 'Faulty';
    DEVICES.push(mkDevice(status, c, null, pick(allowed).id));
  }
}
for (const con of CONSUMERS) {
  if (con.id % 3 === 0) continue;
  DEVICES.push(mkDevice(con.status === 'Inactive' ? 'Deactivated' : 'Sold', null, con.id, 2));
}
for (let k = 0; k < 46; k++) {
  const d = mkDevice(rand() < 0.93 ? 'Available' : 'Faulty', null, null, pick(DEVICE_TYPES).id);
  // Consignment stock held by partners: 8 at Vodafone Qatar, 5 at MTN Nigeria.
  d.orgId = k < 8 ? 2 : k < 13 ? 3 : 1;
  DEVICES.push(d);
}
DEVICES.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

// ── People, groups, settings ──────────────────────────────────
export const FEATURE_PERMISSIONS = FEATURE_KEYS;
const all = (p: 'R' | 'RW') => Object.fromEntries(FEATURE_PERMISSIONS.map((f) => [f, p])) as Record<string, Permission>;
const none = () => Object.fromEntries(FEATURE_PERMISSIONS.map((f) => [f, null])) as Record<string, Permission>;
export const GROUPS: Group[] = [
  { id: 1, orgId: 1, name: 'Super admin', description: 'Full access, including users and settings', status: 'Active', permissions: all('RW') },
  { id: 2, orgId: 1, name: 'Onboarding team', description: 'Creates customers and assigns hardware', status: 'Active', permissions: { ...all('R'), Customers: 'RW', Consumers: 'RW', Inventory: 'RW', 'Hardware orders': 'RW', Users: null, Roles: null, Settings: null } },
  { id: 3, orgId: 1, name: 'Inventory', description: 'Receives stock and manages device lifecycle', status: 'Active', permissions: { ...all('R'), Inventory: 'RW', 'Device types': 'RW', 'Hardware orders': 'RW', Diagnostics: 'RW', Users: null, Roles: null, Settings: null, Audit: null } },
  { id: 4, orgId: 1, name: 'Support', description: 'Read-only access to customers and devices', status: 'Active', permissions: { ...all('R'), Diagnostics: 'RW', Users: null, Roles: null, Settings: null, Vouchers: null } },
  { id: 5, orgId: 1, name: 'Finance', description: 'Vouchers and order billing', status: 'Inactive', permissions: { ...none(), Dashboard: 'R', Customers: 'R', 'Hardware orders': 'R', Vouchers: 'RW' } },
  // System templates: copied into a new partner organization (capped by its entitlements).
  { id: 10, orgId: null, name: 'Organization admin', description: 'Template · everything the organization is entitled to', status: 'Active', permissions: all('RW') },
  { id: 11, orgId: null, name: 'Onboarding agent', description: 'Template · onboards customers and allocates devices', status: 'Active', permissions: { ...none(), Dashboard: 'R', Customers: 'RW', Consumers: 'RW', Inventory: 'RW', 'Hardware orders': 'RW', 'Live tracking': 'R', 'Device types': 'R', Packages: 'R' } },
  { id: 12, orgId: null, name: 'Viewer', description: 'Template · read-only access', status: 'Active', permissions: { ...all('R'), Users: null, Roles: null, Audit: null } },
  // Partner roles
  { id: 20, orgId: 2, name: 'Organization admin', description: 'Vodafone Qatar administrators', status: 'Active', permissions: all('RW') },
  { id: 21, orgId: 2, name: 'Onboarding agent', description: 'Business sales and B2C activation desk', status: 'Active', permissions: { ...none(), Dashboard: 'R', Customers: 'RW', Consumers: 'RW', Inventory: 'RW', 'Hardware orders': 'RW', 'Live tracking': 'R', 'Device types': 'R', Packages: 'R' } },
  { id: 22, orgId: 2, name: 'Support viewer', description: 'Customer care, read-only', status: 'Active', permissions: { ...all('R'), Users: null, Roles: null, Audit: null } },
  { id: 30, orgId: 3, name: 'Organization admin', description: 'MTN Nigeria administrators', status: 'Active', permissions: all('RW') },
  { id: 31, orgId: 3, name: 'Onboarding agent', description: 'Enterprise sales team', status: 'Active', permissions: { ...none(), Dashboard: 'R', Customers: 'RW', Inventory: 'RW', 'Hardware orders': 'RW', 'Live tracking': 'R', 'Device types': 'R', Packages: 'R' } },
];

const STAFF: [string, string, string[], 'SA' | 'Admin'][] = [
  ['Mobeen Tahir', 'mobeen.tahir', ['Super admin'], 'SA'],
  ['Hira Qureshi', 'hira.qureshi', ['Onboarding team'], 'Admin'],
  ['Ahmed Al Hashimi', 'ahmed.hashimi', ['Onboarding team'], 'Admin'],
  ['Usman Siddiqui', 'usman.siddiqui', ['Inventory'], 'Admin'],
  ['Grace Okafor', 'grace.okafor', ['Support'], 'Admin'],
  ['Nadia Farouk', 'nadia.farouk', ['Support', 'Finance'], 'Admin'],
  ['Ali Raza', 'ali.raza', ['Inventory'], 'Admin'],
  ['Sophie Mitchell', 'sophie.mitchell', ['Finance'], 'Admin'],
];
export const USERS: AdminUser[] = STAFF.map(([name, username, groups, type], i) => ({
  id: i + 1,
  orgId: 1,
  isSuperuser: i === 0, // created with `manage.py createsuperuser`
  name,
  username,
  email: `${username}@hypernymbiz.com`,
  groups,
  manager: i === 0 ? null : i < 3 ? 'Mobeen Tahir' : i < 5 ? 'Hira Qureshi' : 'Mobeen Tahir',
  status: i === 7 ? 'Inactive' : 'Active',
  type,
  lastLogin: i === 7 ? null : daysAgo(i === 0 ? 0 : int(0, 12)),
}));
// Partner staff (fixed dates: no random calls, so the rest of the sample data stays put).
const PARTNER_STAFF: [number, string, string, string, string[], string | null, string | null][] = [
  [2, 'Khalid Al Kuwari', 'khalid.alkuwari', 'vodafone.qa', ['Organization admin'], null, '2026-11-02T05:10:00.000Z'],
  [2, 'Mariam Haddad', 'mariam.haddad', 'vodafone.qa', ['Onboarding agent'], 'Khalid Al Kuwari', '2026-11-01T13:42:00.000Z'],
  [2, 'Rami Nasser', 'rami.nasser', 'vodafone.qa', ['Support viewer'], 'Khalid Al Kuwari', '2026-10-30T07:05:00.000Z'],
  [3, 'Adebayo Okafor', 'adebayo.okafor', 'mtn.ng', ['Organization admin'], null, '2026-11-01T16:20:00.000Z'],
  [3, 'Chiamaka Eze', 'chiamaka.eze', 'mtn.ng', ['Onboarding agent'], 'Adebayo Okafor', null],
];
USERS.push(...PARTNER_STAFF.map(([orgId, name, username, domain, groups, manager, lastLogin], i) => ({
  id: 101 + i, orgId, isSuperuser: false, name, username, email: `${username}@${domain}`, groups, manager,
  status: 'Active' as const, type: 'Admin' as const, lastLogin,
})));
export const CURRENT_USER = USERS[0];

export const SETTINGS: PortalSettings = {
  password: { minLength: 10, requireNumber: true, requireSymbol: true, expiryDays: 90, history: 5 },
  pagination: { pageSize: 10 },
  login: { sessionMinutes: 30, maxAttempts: 5, lockMinutes: 15, otpOnReset: true },
};

// ── Audit, orders, vouchers, diagnostics ─────────────────────
export const DELETION_AUDIT: DeletionAudit[] = [
  { id: 1, orgId: 1, customer: 'Blue Lagoon Tours', email: 'fleet@bluelagoontours.com', deletedBy: 'Hira Qureshi', approvedBy: 'Mobeen Tahir', createdAt: daysAgo(410), deletedAt: daysAgo(64), devices: ['DEV-09412', 'DEV-09413', 'DEV-09418'] },
  { id: 2, orgId: 1, customer: 'Oasis Water Trucks', email: 'ops@oasiswater.com', deletedBy: 'Ahmed Al Hashimi', approvedBy: 'Mobeen Tahir', createdAt: daysAgo(520), deletedAt: daysAgo(131), devices: ['DEV-08801', 'DEV-08802', 'DEV-08803', 'DEV-08807', 'DC-08810'] },
  { id: 3, orgId: 1, customer: 'Rapid Courier PK', email: 'admin@rapidcourier.pk', deletedBy: 'Hira Qureshi', approvedBy: 'Mobeen Tahir', createdAt: daysAgo(300), deletedAt: daysAgo(18), devices: ['DEV-09920'] },
];

const ORDER_STATUSES: OrderStatus[] = ['Delivered', 'Delivered', 'Delivered', 'Shipped', 'Packed', 'Placed', 'Cancelled'];
export const ORDERS: HardwareOrder[] = Array.from({ length: 18 }, (_, i) => {
  const c = CUSTOMERS[int(0, CUSTOMERS.length - 1)];
  const status = i < 3 ? (['Placed', 'Packed', 'Shipped'] as OrderStatus[])[i] : pick(ORDER_STATUSES);
  const at = i < 3 ? int(0, 4) : int(6, 200);
  const t = pick(DEVICE_TYPES.filter((d) => d.packages.includes(c.package)));
  return {
    id: i + 1,
    orgId: c.orgId,
    orderNo: `HW-${2026}${String(4810 - i * 7).padStart(5, '0')}`,
    status,
    typeId: t.id,
    customerId: c.id,
    orderedBy: c.contact.email,
    quantity: int(2, 25),
    address: `${c.zone}, ${COUNTRIES.find((x) => x.code === c.countryCode)!.name}`,
    phone: c.contact.phone,
    orderedAt: daysAgo(at),
    eta: status === 'Delivered' || status === 'Cancelled' ? null : daysAhead(int(1, 9)),
    courier: status === 'Shipped' || status === 'Delivered' ? pick(['Aramex', 'DHL Express', 'Q-Post']) : null,
  };
});

export const VOUCHERS: Voucher[] = [
  { id: 1, orgId: null, code: 'FLEET25', createdAt: daysAgo(40), expiresAt: daysAhead(50), minSpend: 2000, maxSpend: 20000, discountPct: 25, useCase: USE_CASE, status: 'Active', redemptions: 6 },
  { id: 2, orgId: null, code: 'COLDSTART10', createdAt: daysAgo(90), expiresAt: daysAhead(12), minSpend: 1000, maxSpend: 8000, discountPct: 10, useCase: 'Cold Chain Monitoring', status: 'Active', redemptions: 2 },
  { id: 3, orgId: null, code: 'RAMADAN15', createdAt: daysAgo(240), expiresAt: daysAhead(-180), minSpend: 1500, maxSpend: 10000, discountPct: 15, useCase: USE_CASE, status: 'Expired', redemptions: 11 },
  { id: 4, orgId: null, code: 'GOVFLEET', createdAt: daysAgo(15), expiresAt: daysAhead(350), minSpend: 50000, maxSpend: 250000, discountPct: 8, useCase: USE_CASE, status: 'Active', redemptions: 0 },
  { id: 5, orgId: 2, code: 'PLUGGO5', createdAt: daysAgo(120), expiresAt: daysAhead(30), minSpend: 300, maxSpend: 3000, discountPct: 5, useCase: USE_CASE, status: 'Disabled', redemptions: 3 },
];

export const DIAGNOSTIC_PARAMS: DiagnosticParam[] = [
  { id: 1, parameter: 'Ignition', responseKey: 'io_239', typeIds: [1, 2, 3, 4] },
  { id: 2, parameter: 'Movement', responseKey: 'io_240', typeIds: [1, 2, 3, 4] },
  { id: 3, parameter: 'GSM signal', responseKey: 'io_21', typeIds: [1, 2, 3, 4] },
  { id: 4, parameter: 'External voltage', responseKey: 'io_66', typeIds: [1, 2, 3, 4] },
  { id: 5, parameter: 'Battery voltage', responseKey: 'io_67', typeIds: [1, 2, 3, 4] },
  { id: 6, parameter: 'Odometer', responseKey: 'io_16', typeIds: [1, 2, 4] },
  { id: 7, parameter: 'Engine RPM', responseKey: 'io_36', typeIds: [1, 4] },
  { id: 8, parameter: 'Fuel level', responseKey: 'io_89', typeIds: [4] },
  { id: 9, parameter: 'Storage status', responseKey: 'sd_state', typeIds: [5, 6, 7] },
];

export const DEVICE_ACTIONS: DeviceAction[] = [
  { id: 1, name: 'Beep', endpoint: '/actions/beep', parameter: 'is_beep', responseKey: 'is_beep' },
  { id: 2, name: 'Immobilise engine', endpoint: '/actions/immobilise', parameter: 'dout_1', responseKey: 'dout_1_state' },
  { id: 3, name: 'Request position', endpoint: '/actions/getgps', parameter: 'getgps', responseKey: 'gps' },
  { id: 4, name: 'Reboot', endpoint: '/actions/reset', parameter: 'cpureset', responseKey: 'reset' },
];

// ── Live tracking ─────────────────────────────────────────────
const CITY: Record<string, [number, number]> = {
  Dubai: [25.2, 55.27], 'Abu Dhabi': [24.45, 54.38], Sharjah: [25.34, 55.42], Ajman: [25.4, 55.48],
  Doha: [25.29, 51.53], 'Al Rayyan': [25.29, 51.42], Lusail: [25.42, 51.49], 'Al Wakrah': [25.17, 51.6],
};
export const VEHICLES: Vehicle[] = DEVICES.filter((d) => d.status === 'Sold' && d.plate && d.customerId)
  .filter((d) => {
    const c = CUSTOMERS.find((x) => x.id === d.customerId)!;
    return CITY[c.zone] !== undefined;
  })
  .slice(0, 160)
  .map((d) => {
    const c = CUSTOMERS.find((x) => x.id === d.customerId)!;
    const [lat, lng] = CITY[c.zone];
    const r = rand();
    const state = r < 0.55 ? 'Moving' : r < 0.85 ? 'Idle' : 'Offline';
    return {
      deviceId: d.id,
      plate: d.plate!,
      customerId: c.id,
      driver: `${pick(FIRST)} ${pick(LAST)}`,
      state,
      speedKmh: state === 'Moving' ? int(18, 112) : 0,
      lat: lat + (rand() - 0.5) * 0.22,
      lng: lng + (rand() - 0.5) * 0.3,
      updatedAt: state === 'Offline' ? daysAgo(int(1, 4)) : daysAgo(0, 9),
      ignition: state !== 'Offline' && state === 'Moving' ? true : rand() > 0.5,
    };
  });

// ── Notifications (built from the rows above so every one points at real data) ──
const minsAgo = (m: number) => new Date(TODAY.getTime() - m * 60000).toISOString();
const placed = ORDERS.filter((o) => o.status === 'Placed');
const onboardingNow = CUSTOMERS.filter((c) => c.stepsDone < 9);
const deletion = CUSTOMERS.find((c) => c.deletionStatus === 'Requested');
const faulty = DEVICES.filter((d) => d.status === 'Faulty').slice(0, 2);
const ending = CUSTOMERS.filter((c) => {
  const d = (new Date(c.contractExpiry).getTime() - TODAY.getTime()) / 86400000;
  return d >= 0 && d <= 60;
});
const nameOf = (id: number) => CUSTOMERS.find((c) => c.id === id)?.company ?? 'A customer';
const raw: Omit<AppNotification, 'id'>[] = [
  ...placed.map((o, i) => ({
    orgId: o.orgId as number | null,
    at: minsAgo(18 + i * 140), kind: 'order' as NotificationKind, read: i > 0,
    title: `New hardware order ${o.orderNo}`,
    body: `${nameOf(o.customerId)} ordered ${o.quantity} devices. Pack and ship it from Hardware orders.`,
    link: ['/orders'],
  })),
  ...(deletion ? [{
    orgId: deletion.orgId as number | null,
    at: minsAgo(95), kind: 'deletion' as NotificationKind, read: false,
    title: `Deletion requested for ${deletion.company}`,
    body: 'Hira Qureshi asked to delete this account. A super admin has to approve or cancel it.',
    link: ['/audit'],
  }] : []),
  ...onboardingNow.slice(0, 3).map((c, i) => ({
    orgId: c.orgId as number | null,
    at: minsAgo(260 + i * 380), kind: 'onboarding' as NotificationKind, read: i > 0,
    title: `${c.company} reached section ${c.stepsDone + 1} of 9`,
    body: `General details and ${c.stepsDone - 1} more sections are done. Next: ${['Documents', 'Package', 'Customer type', 'Features', 'Admins', 'Hardware', 'Shipment & installation', 'Branding'][Math.min(c.stepsDone - 1, 7)]}.`,
    link: ['/customers', String(c.id)],
  })),
  ...faulty.map((d, i) => ({
    orgId: d.orgId as number | null,
    at: minsAgo(720 + i * 900), kind: 'device' as NotificationKind, read: true,
    title: `${d.id} marked faulty`,
    body: 'No GPS fix after installation. It is held for RMA and removed from the customer\'s fleet count.',
    link: ['/inventory'],
  })),
  ...ending.map((c, i) => ({
    orgId: c.orgId as number | null,
    at: minsAgo(1500 + i * 600), kind: 'contract' as NotificationKind, read: true,
    title: `${c.company}'s contract ends ${c.contractExpiry.slice(8, 10)}/${c.contractExpiry.slice(5, 7)}`,
    body: 'Renew it before the end date or their devices stop reporting.',
    link: ['/customers', String(c.id)],
  })),
  {
    orgId: null,
    at: minsAgo(2900), kind: 'account', read: true,
    title: 'Password policy updated',
    body: 'New passwords need at least 10 characters, a number and a symbol.',
    link: ['/settings'],
  },
];
export const NOTIFICATIONS: AppNotification[] = raw
  .sort((a, b) => b.at.localeCompare(a.at))
  .map((n, i) => ({ ...n, id: i + 1 }));

export const NOTIFICATION_PREFS: NotificationPrefs = {
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
};

// ── Assertions: figures that must agree ──────────────────────
const statusTotal = (['Available', 'Allocated', 'Sold', 'Deactivated', 'Faulty'] as DeviceStatus[])
  .map((s) => DEVICES.filter((d) => d.status === s).length)
  .reduce((a, b) => a + b, 0);
console.assert(statusTotal === DEVICES.length, 'device status counts must sum to the device total');
console.assert(
  PACKAGES.map((p) => CUSTOMERS.filter((c) => c.package === p.name).length).reduce((a, b) => a + b, 0) === CUSTOMERS.length,
  'package counts must sum to the customer total',
);
