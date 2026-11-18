import { Injectable, computed, signal } from '@angular/core';
import * as ref from './reference';
import { TODAY, nowIso } from './clock';
import { HUB_NAME, matchesTarget, twinSync } from './iot-rules';
import { scoped } from './scoped';
import {
  AdminUser, AppNotification, Consumer, Customer, CustomerStatus, Device, DeviceEvent, DeviceStatus, Group,
  HardwareOrder, NotificationPrefs, OrderStatus, PortalSettings, Voucher, Organization, DeletionAudit, Vehicle,
  CommandRecord, ConfigProfile, DeviceTwin, EnrollmentGroup, IotDeviceState, IotRegistration, TwinValue,
  ConnectionEvent, DeviceAction, DeviceType, DiagnosticParam, FeatureGroup, HubMetrics, PackageConfig, Sensor, UseCase,
} from './models';
import type { AuthUser, MeAccess } from '../auth/auth.models';
import { FEATURE_KEYS } from '../access/features';

/** Shown before /auth/me/ answers; owns nothing and can open nothing. */
const GUEST: AdminUser = {
  id: 0, orgId: 0, orgName: '', isSuperuser: false, name: '', email: '', phone: '', roles: [], manager: null,
  status: 'Inactive', lastLogin: null, invitedAt: null, createdAt: null,
};
const NO_ORG: Organization = {
  id: 0, name: '', legalName: '', kind: 'Partner', status: 'Active', countries: [], segments: [], features: {},
  limits: { maxCustomers: null, maxUsers: null }, contact: { name: '', email: '', phone: '' }, brandColour: '', createdAt: '',
};
const EMPTY_HUB: HubMetrics = {
  hubName: HUB_NAME, region: '', tier: '', units: 0, dailyQuota: 0, messagesPerHour: [], throttledToday: 0, routes: [],
};

/**
 * Client state for every screen. Lists start empty and are filled from the Django API, one module at
 * a time (docs/ROADMAP.md). Methods marked TODO(API) still only change local state; each becomes an
 * HTTP call with the same shape when its endpoint exists.
 */
@Injectable({ providedIn: 'root' })
export class Store {
  // Reference data shipped with the portal (core/data/reference.ts).
  readonly countries = ref.COUNTRIES;
  readonly industries = ref.INDUSTRIES;
  readonly featurePermissions = ref.FEATURE_PERMISSIONS;

  // Catalogue — TODO(API): GET /catalogue/packages/, /catalogue/device-types/, /catalogue/sensors/,
  // /catalogue/feature-groups/, /catalogue/use-cases/ (see docs/ROADMAP.md).
  readonly packages = signal<PackageConfig[]>([]);
  readonly deviceTypes = signal<DeviceType[]>([]);
  readonly sensors = signal<Sensor[]>([]);
  readonly featureGroups = signal<FeatureGroup[]>([]);
  readonly useCases = signal<UseCase[]>([]);

  // ── Session and tenant scope ──────────────────────────────
  /**
   * Organizations known to the client: GET /organizations/options/ at sign-in (the user's own, or all of
   * them for platform users), upgraded to full objects by the Organizations screen (`mergeOrganizations`).
   */
  readonly organizations = signal<Organization[]>([]);
  /** For platform users: the organization being viewed, or null for all organizations. */
  readonly activeOrgId = signal<number | null>(null);

  /** GET /auth/me/access/: the server's effective level per feature (Access reads it). */
  readonly access = signal<MeAccess | null>(null);

  /** The signed-in user, set by AuthService from GET /auth/me/. */
  private readonly sessionUser = signal<AdminUser | null>(null);
  readonly signedIn = computed(() => this.sessionUser() !== null);
  readonly currentUser = computed(() => this.sessionUser() ?? GUEST);
  readonly currentOrg = computed(
    () => this.organizations().find((o) => o.id === this.currentUser().orgId) ?? NO_ORG,
  );
  /** Platform staff (HyperNym) can look across tenants; partner users never leave their own. */
  readonly crossTenant = computed(() => this.currentOrg().kind === 'Platform' || this.currentUser().isSuperuser);
  /** The organization every list is filtered to, or null for "all organizations". */
  readonly scopeOrgId = computed(() => (this.crossTenant() ? this.activeOrgId() : this.currentUser().orgId));
  readonly scopeOrg = computed(() => this.organizations().find((o) => o.id === this.scopeOrgId()) ?? null);

  private readonly byOrg = computed(() => {
    const id = this.scopeOrgId();
    return id == null ? () => true : (r: { orgId: number | null }) => r.orgId === id;
  });
  /** Rows with orgId null are shared (templates, platform vouchers): visible in every scope. */
  private readonly byOrgOrShared = computed(() => {
    const id = this.scopeOrgId();
    return id == null ? () => true : (r: { orgId: number | null }) => r.orgId === id || r.orgId === null;
  });
  // Tenant data — every list starts empty and fills from its API (docs/ROADMAP.md).
  /** The rows the Users screen last loaded (GET /users/, one page). */
  private readonly _users = signal<AdminUser[]>([]);
  private readonly _customers = signal<Customer[]>([]); // TODO(API): GET /customers/
  private readonly _devices = signal<Device[]>([]); // TODO(API): GET /inventory/devices/
  private readonly deviceOrg = computed(() => new Map(this._devices().map((d) => [d.id, d.orgId])));
  private readonly customerOrg = computed(() => new Map(this._customers().map((c) => [c.id, c.orgId])));
  private readonly byDevice = computed(() => {
    const id = this.scopeOrgId();
    const m = this.deviceOrg();
    return id == null ? () => true : (r: { deviceId: string }) => m.get(r.deviceId) === id;
  });

  readonly customers = scoped(this._customers, this.byOrg);
  readonly consumers = scoped(signal<Consumer[]>([]), this.byOrg); // TODO(API): GET /consumers/
  readonly devices = scoped(this._devices, this.byOrg);
  readonly users = scoped(this._users, this.byOrg);
  /** GET /roles/?limit=100 (Roles screen, Users dialog). Templates have orgId null. */
  readonly groups = scoped(signal<Group[]>([]), this.byOrgOrShared);
  /** The audit page last loaded (GET /audit/deletions/). Organization deletions belong to the platform's trail. */
  readonly audit = scoped(signal<DeletionAudit[]>([]), computed(() => {
    const id = this.scopeOrgId();
    return id == null ? () => true : (r: DeletionAudit) => r.orgId === id;
  }));
  readonly orders = scoped(signal<HardwareOrder[]>([]), this.byOrg); // TODO(API): GET /orders/
  readonly vouchers = scoped(signal<Voucher[]>([]), this.byOrgOrShared); // TODO(API): GET /vouchers/
  readonly params = signal<DiagnosticParam[]>([]); // TODO(API): GET /diagnostics/parameters/
  readonly actions = signal<DeviceAction[]>([]); // TODO(API): GET /diagnostics/actions/
  readonly vehicles = scoped(signal<Vehicle[]>([]), computed(() => { // TODO(API): live positions stream
    const id = this.scopeOrgId();
    const m = this.customerOrg();
    return id == null ? () => true : (v: Vehicle) => m.get(v.customerId) === id;
  }));
  /** GET /settings/ at sign-in (page size, password rules, session); defaults until it answers. */
  readonly settings = signal<PortalSettings>(ref.DEFAULT_SETTINGS);
  readonly today = TODAY;
  /**
   * The bell: the signed-in user's latest notifications (GET /notifications/?limit=6) and their unread
   * total. Filled and kept fresh by NotificationCenter; the Notifications page pages the feed itself.
   */
  readonly notifications = signal<AppNotification[]>([]);
  readonly unread = signal(0);
  /** The signed-in user's own preferences (GET /notifications/preferences/, loaded by Profile). */
  readonly notificationPrefs = signal<NotificationPrefs>(ref.DEFAULT_NOTIFICATION_PREFS);

  // ── Azure IoT Hub (device management) — TODO(API): /iot/* (docs/ROADMAP.md) ──
  readonly hub = signal<HubMetrics>(EMPTY_HUB);
  readonly iotStates = scoped(signal<IotDeviceState[]>([]), this.byDevice);
  readonly twins = scoped(signal<DeviceTwin[]>([]), this.byDevice);
  readonly commands = scoped(signal<CommandRecord[]>([]), this.byDevice);
  readonly profiles = signal<ConfigProfile[]>([]);
  readonly enrollments = signal<EnrollmentGroup[]>([]);
  readonly connectionEvents = scoped(signal<ConnectionEvent[]>([]), this.byDevice);
  readonly iotById = computed(() => new Map(this.iotStates().map((s) => [s.deviceId, s])));
  readonly twinById = computed(() => new Map(this.twins().map((t) => [t.deviceId, t])));
  readonly matchesTarget = matchesTarget;
  readonly twinSync = twinSync;

  /** Devices per customer, computed once per change of the device list. */
  readonly devicesByCustomer = computed(() => {
    const m = new Map<number, Device[]>();
    for (const d of this.devices()) {
      if (d.customerId == null) continue;
      (m.get(d.customerId) ?? m.set(d.customerId, []).get(d.customerId)!).push(d);
    }
    return m;
  });

  readonly devicesByConsumer = computed(() => {
    const m = new Map<number, Device[]>();
    for (const d of this.devices()) {
      if (d.consumerId == null) continue;
      (m.get(d.consumerId) ?? m.set(d.consumerId, []).get(d.consumerId)!).push(d);
    }
    return m;
  });

  customer(id: number) {
    return this.customers().find((c) => c.id === id);
  }
  deviceType(id: number) {
    return this.deviceTypes().find((t) => t.id === id)!;
  }
  country(code: string) {
    return this.countries.find((c) => c.code === code)!;
  }

  // ── Customers ──────────────────────────────────────────────
  saveCustomer(c: Customer) {
    this.customers.update((xs) => (xs.some((x) => x.id === c.id) ? xs.map((x) => (x.id === c.id ? c : x)) : [c, ...xs]));
    return c;
  }
  nextCustomerId() {
    return Math.max(0, ...this._customers().map((c) => c.id)) + 1;
  }
  setCustomerStatus(id: number, status: CustomerStatus) {
    this.customers.update((xs) => xs.map((x) => (x.id === id ? { ...x, status } : x)));
  }
  requestDeletion(id: number) {
    this.customers.update((xs) => xs.map((x) => (x.id === id ? { ...x, deletionStatus: 'Requested' } : x)));
  }
  cancelDeletion(id: number) {
    this.customers.update((xs) => xs.map((x) => (x.id === id ? { ...x, deletionStatus: 'None' } : x)));
  }

  // ── Devices ────────────────────────────────────────────────
  setDeviceStatus(ids: string[], status: DeviceStatus) {
    const set = new Set(ids);
    this.devices.update((xs) =>
      xs.map((d) =>
        set.has(d.id)
          ? { ...d, status, ...(status === 'Available' ? { customerId: null, consumerId: null, plate: null } : {}) }
          : d,
      ),
    );
  }
  allocate(ids: string[], customerId: number) {
    const set = new Set(ids);
    const orgId = this.customerOrg().get(customerId) ?? this.currentUser().orgId;
    this.devices.update((xs) => xs.map((d) => (set.has(d.id) ? { ...d, customerId, orgId, status: 'Allocated' } : d)));
  }
  addDevices(devs: Device[]) {
    this.devices.update((xs) => [...devs, ...xs]);
  }

  /** Lifecycle events for a device. TODO(API): GET /inventory/devices/{id}/history/. */
  deviceHistory(_d: Device): DeviceEvent[] {
    return [];
  }

  // ── IoT Hub operations — TODO(API): POST /iot/devices/{id}/commands/, PATCH /iot/devices/{id}/twin/ ──
  /** Records a command as Pending. The API will invoke the direct method / C2D message and report the outcome. */
  sendCommand(deviceId: string, method: string, kind: CommandRecord['kind'], payload: Record<string, TwinValue>, _ok = 'OK'): CommandRecord {
    const id = Math.max(0, ...this.commands.all().map((c) => c.id)) + 1;
    const rec: CommandRecord = {
      id, deviceId, method, kind, payload, status: 'Pending', responseCode: null, response: null, latencyMs: null,
      sentAt: nowIso(), sentBy: this.currentUser().name,
    };
    this.commands.update((xs) => [rec, ...xs]);
    return rec;
  }

  /** Patch desired properties locally. The device's reported state only changes when the API reports it. */
  setDesired(deviceId: string, patch: Record<string, TwinValue>) {
    const now = nowIso();
    this.twins.update((xs) => xs.map((t) => (t.deviceId === deviceId
      ? { ...t, desired: { version: t.desired.version + 1, props: { ...t.desired.props, ...patch }, updatedAt: now } }
      : t)));
  }

  setRegistration(deviceIds: string[], registration: IotRegistration) {
    const set = new Set(deviceIds);
    this.iotStates.update((xs) => xs.map((s) => (set.has(s.deviceId)
      ? { ...s, registration, ...(registration === 'Disabled' ? { connection: 'Disconnected' as const, connectedSince: null } : {}) }
      : s)));
  }

  /** Register identities for devices that don't have one yet (bulk import / DPS individual enrolment). */
  registerDevices(deviceIds: string[]) {
    const have = this.iotById();
    const fresh = deviceIds.filter((id) => !have.has(id)).map<IotDeviceState>((id) => {
      const dev = this.devices().find((d) => d.id === id);
      const group = dev ? this.enrollments().find((g) => g.deviceTypeId === dev.typeId) : undefined;
      const dashcam = dev ? this.deviceType(dev.typeId).category === 'Dashcam' : false;
      return {
        deviceId: id, hubName: HUB_NAME, registration: 'Awaiting first connection', connection: 'Disconnected',
        lastActivity: null, connectedSince: null, transport: dashcam ? 'Gateway · JT/T 808' : 'Gateway · Codec 8E',
        auth: group?.attestation ?? 'Symmetric key', enrollmentGroup: group?.id ?? 'individual', messagesToday: 0, c2dQueued: 0,
      };
    });
    this.iotStates.update((xs) => [...fresh, ...xs]);
  }

  saveProfile(p: ConfigProfile) {
    this.profiles.update((xs) => (xs.some((x) => x.id === p.id) ? xs.map((x) => (x.id === p.id ? p : x)) : [p, ...xs]));
  }
  deleteProfile(id: string) {
    this.profiles.update((xs) => xs.filter((x) => x.id !== id));
  }
  saveEnrollment(g: EnrollmentGroup) {
    this.enrollments.update((xs) => (xs.some((x) => x.id === g.id) ? xs.map((x) => (x.id === g.id ? g : x)) : [...xs, g]));
  }

  /** Where new records go: the organization being viewed, else the signed-in user's own. */
  writeOrgId() {
    return this.scopeOrgId() ?? this.currentUser().orgId;
  }

  // ── Organizations & session ────────────────────────────────
  saveOrganization(o: Organization) {
    this.organizations.update((xs) => (xs.some((x) => x.id === o.id) ? xs.map((x) => (x.id === o.id ? { ...x, ...o } : x)) : [...xs, o]));
  }
  /**
   * Replaces the known organizations with `rows` (options or the full list), keeping profile fields a
   * fuller copy already had (an options row has no legal name, countries or contact).
   */
  mergeOrganizations(rows: Organization[]) {
    const old = new Map(this.organizations().map((o) => [o.id, o]));
    this.organizations.set(
      rows.map((o) => {
        const prev = old.get(o.id);
        if (!prev || o.legalName) return o;
        return { ...prev, ...o, legalName: prev.legalName, countries: prev.countries, contact: prev.contact, createdAt: prev.createdAt || o.createdAt };
      }),
    );
  }
  /**
   * Called by AuthService with the user from /auth/login/ or /auth/me/ (null on sign-out).
   * Seeds the user's own organization so the shell can draw at once; GET /organizations/options/
   * then replaces it (SessionLoader). The platform organization is entitled to every feature.
   */
  setSession(user: AuthUser | null) {
    if (!user) {
      this.activeOrgId.set(null);
      this.sessionUser.set(null);
      this.organizations.set([]);
      this.access.set(null);
      this._users.set([]);
      this.groups.all.set([]);
      this.audit.all.set([]);
      this.settings.set(ref.DEFAULT_SETTINGS);
      this.notificationPrefs.set(ref.DEFAULT_NOTIFICATION_PREFS);
      this.notifications.set([]);
      this.unread.set(0);
      return;
    }
    const prevId = this.sessionUser()?.id;
    if (prevId !== user.id) this.activeOrgId.set(null);
    const org = user.organization;
    const platform = org?.kind === 'Platform';
    if (org && !this.organizations().some((o) => o.id === org.id)) {
      this.organizations.update((xs) => [...xs, {
        ...NO_ORG,
        id: org.id,
        name: org.name,
        kind: platform ? 'Platform' : 'Partner',
        status: org.status as Organization['status'],
        features: platform ? Object.fromEntries(FEATURE_KEYS.map((k) => [k, 'RW' as const])) : {},
        brandColour: org.brand_colour ?? '',
        logoUrl: org.logo_url ?? null,
      }]);
    } else if (org && org.logo_url !== undefined) {
      // A fresh /auth/me/ carries a newer SAS URL (and brand) for the user's own organization.
      this.organizations.update((xs) =>
        xs.map((o) => (o.id === org.id ? { ...o, brandColour: org.brand_colour ?? '', logoUrl: org.logo_url ?? null } : o)),
      );
    }
    this.sessionUser.set({
      id: user.id,
      orgId: org?.id ?? 0,
      orgName: org?.name ?? '',
      isSuperuser: user.is_superuser,
      name: user.full_name,
      email: user.email,
      phone: user.phone ?? '',
      roles: (user.roles ?? []).map((r) => ({ id: r.id, name: r.name, isAdmin: r.is_admin })),
      manager: user.manager ? { id: user.manager.id, name: user.manager.full_name, email: user.manager.email } : null,
      status: user.status === 'Active' ? 'Active' : user.status === 'Invited' ? 'Invited' : 'Inactive',
      lastLogin: user.last_login,
      invitedAt: null,
      createdAt: null,
    });
  }

  /** Every user across tenants (platform screens only). */
  readonly allUsers = this._users.asReadonly();

  // ── Admin ──────────────────────────────────────────────────
  saveUser(u: AdminUser) {
    this.users.update((xs) => (xs.some((x) => x.id === u.id) ? xs.map((x) => (x.id === u.id ? u : x)) : [u, ...xs]));
  }
  saveGroup(g: Group) {
    this.groups.update((xs) => (xs.some((x) => x.id === g.id) ? xs.map((x) => (x.id === g.id ? g : x)) : [...xs, g]));
  }
  setOrderStatus(id: number, status: OrderStatus) {
    this.orders.update((xs) => xs.map((o) => (o.id === id ? { ...o, status } : o)));
  }
  saveVoucher(v: Voucher) {
    this.vouchers.update((xs) => (xs.some((x) => x.id === v.id) ? xs.map((x) => (x.id === v.id ? v : x)) : [v, ...xs]));
  }
}
