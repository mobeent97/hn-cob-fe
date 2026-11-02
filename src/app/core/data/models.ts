// Domain models, shaped after the legacy COB portal flows (see ../legacy-flows/*.md).

export type PackageName = 'Basic' | 'Advance' | 'Plug & Go' | 'Enterprise';
export type CustomerType = 'EBU' | 'SME' | 'Government';
export type CustomerStatus = 'Active' | 'Inactive';
export type DeletionStatus = 'None' | 'Requested';
export type DeviceStatus = 'Available' | 'Allocated' | 'Sold' | 'Deactivated' | 'Faulty';
export type Permission = 'R' | 'RW' | null;

export interface Country {
  code: string;
  name: string;
  dial: string;
  currency: string;
  zones: string[];
}

export interface Contact {
  firstName: string;
  lastName: string;
  qid: string;
  email: string;
  phone: string;
}

/** The onboarding wizard's nine sections, in order. */
export const ONBOARDING_STEPS = [
  'General details',
  'Documents',
  'Package',
  'Customer type',
  'Features',
  'Admins',
  'Hardware',
  'Shipment & installation',
  'Branding',
] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export interface Customer {
  id: number;
  /** Owning organization (tenant). */
  orgId: number;
  company: string;
  group: string;
  industry: string;
  website: string;
  email: string;
  phone: string;
  crNumber: string;
  countryCode: string;
  zone: string;
  contractExpiry: string; // ISO date
  contact: Contact;
  userGroups: string[];
  status: CustomerStatus;
  deletionStatus: DeletionStatus;
  useCase: string;
  package: PackageName;
  customerType: CustomerType;
  superAdminEmail: string;
  createdAt: string;
  /** Count of onboarding sections completed, 0-9. */
  stepsDone: number;
  documents: { name: string; kind: string; sizeKb: number; uploadedAt: string }[];
  admins: { name: string; email: string; phone: string }[];
  brandColour: string;
}

export interface Consumer {
  id: number;
  orgId: number;
  name: string;
  email: string;
  phone: string;
  qid: string;
  status: CustomerStatus;
  createdAt: string;
}

export interface Device {
  id: string; // e.g. DEV-10010
  /** Organization that owns or holds the device: the customer's, or the stock holder's. */
  orgId: number;
  imei: string;
  typeId: number;
  customerId: number | null;
  consumerId: number | null;
  status: DeviceStatus;
  simSn: string;
  msisdn: string;
  createdAt: string;
  lastSeen: string | null;
  plate: string | null;
}

export interface DeviceEvent {
  at: string;
  status: DeviceStatus;
  note: string;
  by: string;
}

export interface DeviceType {
  id: number;
  name: string;
  make: string;
  category: 'Gateway' | 'Dashcam';
  packages: PackageName[];
  warrantyYears: number;
  sensors: string[]; // sensor keys
  dataSheet: string | null;
  unitPrice: number; // AED
}

export interface Sensor {
  id: number;
  key: string;
  name: string;
}

export interface PackageConfig {
  id: number;
  name: PackageName;
  description: string;
  monthlyPrice: number; // AED per device
}

export interface FeatureGroup {
  id: number;
  name: string;
  features: { id: number; name: string; packages: PackageName[] }[];
}

export interface UseCase {
  id: number;
  name: string;
  packages: PackageName[];
  modules: string[];
}

export interface AdminUser {
  id: number;
  orgId: number;
  /** Django superuser (created with `manage.py createsuperuser`); bypasses every permission. */
  isSuperuser: boolean;
  name: string;
  username: string;
  email: string;
  groups: string[];
  manager: string | null;
  status: CustomerStatus;
  type: 'SA' | 'Admin';
  lastLogin: string | null;
}

export interface Group {
  id: number;
  /** null = a system template every organization can copy. */
  orgId: number | null;
  name: string;
  description: string;
  status: CustomerStatus;
  permissions: Record<string, Permission>;
}

export interface DeletionAudit {
  id: number;
  orgId: number;
  customer: string;
  email: string;
  deletedBy: string;
  approvedBy: string;
  createdAt: string;
  deletedAt: string;
  devices: string[];
}

export type OrderStatus = 'Placed' | 'Packed' | 'Shipped' | 'Delivered' | 'Cancelled';
export interface HardwareOrder {
  id: number;
  orgId: number;
  orderNo: string;
  status: OrderStatus;
  typeId: number;
  customerId: number;
  orderedBy: string;
  quantity: number;
  address: string;
  phone: string;
  orderedAt: string;
  eta: string | null;
  courier: string | null;
}

export interface Voucher {
  id: number;
  /** null = a platform-wide voucher. */
  orgId: number | null;
  code: string;
  createdAt: string;
  expiresAt: string;
  minSpend: number;
  maxSpend: number;
  discountPct: number;
  useCase: string;
  status: 'Active' | 'Expired' | 'Disabled';
  redemptions: number;
}

export interface DiagnosticParam {
  id: number;
  parameter: string;
  responseKey: string;
  typeIds: number[];
}

export interface DeviceAction {
  id: number;
  name: string;
  endpoint: string;
  parameter: string;
  responseKey: string;
}

export interface Vehicle {
  deviceId: string;
  plate: string;
  customerId: number;
  driver: string;
  state: 'Moving' | 'Idle' | 'Offline';
  speedKmh: number;
  lat: number;
  lng: number;
  updatedAt: string;
  ignition: boolean;
}

export interface PortalSettings {
  password: { minLength: number; requireNumber: boolean; requireSymbol: boolean; expiryDays: number; history: number };
  pagination: { pageSize: number };
  login: { sessionMinutes: number; maxAttempts: number; lockMinutes: number; otpOnReset: boolean };
}

export type NotificationKind = 'order' | 'onboarding' | 'deletion' | 'device' | 'contract' | 'account';
export interface AppNotification {
  id: number;
  /** null = platform-level (only platform staff see it). */
  orgId: number | null;
  at: string;
  kind: NotificationKind;
  title: string;
  body: string;
  /** Router link the notification opens. */
  link: string[];
  read: boolean;
}
export interface NotificationPrefs {
  /** Per kind: shown in the portal, and/or sent by email. */
  channels: Record<NotificationKind, { inApp: boolean; email: boolean }>;
  /** Email digest instead of one email per event. */
  digest: 'off' | 'daily' | 'weekly';
  /** Quiet hours, 24h "HH:MM"; null when off. */
  quiet: { from: string; to: string } | null;
}

// ── Azure IoT Hub (device management) ─────────────────────────
/** How the device reaches IoT Hub: natively over MQTT, or through our protocol gateway. */
export type IotTransport = 'MQTT (direct)' | 'Gateway · Codec 8E' | 'Gateway · JT/T 808';
export type IotRegistration = 'Registered' | 'Awaiting first connection' | 'Disabled' | 'Attestation failed';
export type TwinValue = string | number | boolean;

export interface DeviceTwin {
  deviceId: string;
  etag: string;
  /** Twin tags set by the portal: who owns it and what it is. */
  tags: { customerId: number | null; package: string | null; deviceType: string; country: string | null; useCase: string | null };
  desired: { version: number; props: Record<string, TwinValue>; updatedAt: string };
  reported: { version: number; props: Record<string, TwinValue>; updatedAt: string | null };
}

export interface IotDeviceState {
  deviceId: string;
  hubName: string;
  registration: IotRegistration;
  connection: 'Connected' | 'Disconnected';
  lastActivity: string | null;
  connectedSince: string | null;
  transport: IotTransport;
  auth: 'Symmetric key' | 'X.509 CA';
  enrollmentGroup: string;
  messagesToday: number;
  /** Cloud-to-device messages waiting for the device to come online. */
  c2dQueued: number;
}

export type CommandStatus = 'Succeeded' | 'Failed' | 'Timed out' | 'Queued' | 'Pending';
export interface CommandRecord {
  id: number;
  deviceId: string;
  /** Direct method name or C2D message type. */
  method: string;
  kind: 'Direct method' | 'C2D message' | 'Twin update';
  payload: Record<string, TwinValue>;
  status: CommandStatus;
  responseCode: number | null;
  response: string | null;
  latencyMs: number | null;
  sentAt: string;
  sentBy: string;
}

export interface ConfigProfile {
  id: string; // IoT Hub configuration id, kebab-case
  name: string;
  description: string;
  /** IoT Hub target condition, e.g. tags.package='Advance' AND tags.deviceType='FMC130'. */
  targetCondition: string;
  priority: number;
  desired: Record<string, TwinValue>;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  status: 'Active' | 'Paused' | 'Draft';
}

export interface EnrollmentGroup {
  id: string;
  deviceTypeId: number;
  attestation: 'Symmetric key' | 'X.509 CA';
  allocation: string; // allocation policy / target hub
  initialTwinTags: Record<string, string>;
  enabled: boolean;
  createdAt: string;
}

export interface HubMetrics {
  hubName: string;
  region: string;
  tier: string; // e.g. "S1"
  units: number;
  dailyQuota: number;
  /** Device-to-cloud messages per hour for the last 24 hours, oldest first. */
  messagesPerHour: number[];
  throttledToday: number;
  routes: { name: string; endpoint: string; source: string; condition: string; healthy: boolean }[];
}

export interface ConnectionEvent {
  at: string;
  deviceId: string;
  type: 'Connected' | 'Disconnected' | 'Created' | 'Disabled' | 'Twin changed';
  detail: string;
}

// ── Organizations (tenants) and access ────────────────────────
/** Platform = HyperNym, sees every tenant. Partner = a B2B reseller (e.g. a telco) that onboards its own customers. */
export type OrgKind = 'Platform' | 'Partner';
export interface Organization {
  id: number;
  name: string;
  legalName: string;
  kind: OrgKind;
  status: 'Active' | 'Invited' | 'Suspended';
  countries: string[];
  /** Which customer segments the tenant may onboard. */
  segments: ('B2B' | 'B2C')[];
  /** Feature entitlements: the most a role inside this tenant can be granted per feature. */
  features: Record<string, Permission>;
  limits: { maxCustomers: number | null; maxUsers: number | null };
  contact: { name: string; email: string; phone: string };
  brandColour: string;
  createdAt: string;
}
