import { Injectable, computed, signal } from '@angular/core';
import * as db from './mock-db';
import * as iot from './iot-mock';
import { nowIso } from './mock-db';
import { scoped } from './scoped';
import {
  AdminUser, AppNotification, Consumer, Customer, CustomerStatus, Device, DeviceEvent, DeviceStatus, Group,
  HardwareOrder, NotificationPrefs, OrderStatus, PortalSettings, Voucher, Organization, DeletionAudit, Vehicle,
  CommandRecord, ConfigProfile, DeviceTwin, EnrollmentGroup, IotDeviceState, IotRegistration, TwinValue,
} from './models';

/**
 * In-memory store for the design phase. Screens read signals and call these methods;
 * when the Django API exists, each method becomes an HTTP call with the same shape.
 */
@Injectable({ providedIn: 'root' })
export class Store {
  readonly countries = db.COUNTRIES;
  readonly industries = db.INDUSTRIES;
  readonly packages = signal(db.PACKAGES);
  readonly deviceTypes = signal(db.DEVICE_TYPES);
  readonly sensors = signal(db.SENSORS);
  readonly featureGroups = signal(db.FEATURE_GROUPS);
  readonly useCases = signal(db.USE_CASES);
  readonly featurePermissions = db.FEATURE_PERMISSIONS;

  // ── Session and tenant scope ──────────────────────────────
  readonly organizations = signal<Organization[]>(db.ORGANIZATIONS);
  /** Who is signed in (design phase: switchable with "Preview as"). */
  readonly sessionUserId = signal(db.CURRENT_USER.id);
  /** For platform users: the organization being viewed, or null for all organizations. */
  readonly activeOrgId = signal<number | null>(null);

  private readonly _users = signal<AdminUser[]>(db.USERS);
  readonly currentUser = computed(() => this._users().find((u) => u.id === this.sessionUserId()) ?? this._users()[0]);
  readonly currentOrg = computed(() => this.organizations().find((o) => o.id === this.currentUser().orgId)!);
  /** Platform staff (HyperNym) can look across tenants; partner users never leave their own. */
  readonly crossTenant = computed(() => this.currentOrg().kind === 'Platform');
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
  /** Rows with orgId null are platform-only: hidden from partners. */
  private readonly byOrgOrPlatform = computed(() => {
    const id = this.scopeOrgId();
    const platform = this.crossTenant();
    return id == null ? () => true : (r: { orgId: number | null }) => r.orgId === id || (platform && r.orgId === null);
  });

  private readonly _customers = signal<Customer[]>(db.CUSTOMERS);
  private readonly _devices = signal<Device[]>(db.DEVICES);
  private readonly deviceOrg = computed(() => new Map(this._devices().map((d) => [d.id, d.orgId])));
  private readonly customerOrg = computed(() => new Map(this._customers().map((c) => [c.id, c.orgId])));
  private readonly byDevice = computed(() => {
    const id = this.scopeOrgId();
    const m = this.deviceOrg();
    return id == null ? () => true : (r: { deviceId: string }) => m.get(r.deviceId) === id;
  });

  readonly customers = scoped(this._customers, this.byOrg);
  readonly consumers = scoped(signal<Consumer[]>(db.CONSUMERS), this.byOrg);
  readonly devices = scoped(this._devices, this.byOrg);
  readonly users = scoped(this._users, this.byOrg);
  readonly groups = scoped(signal<Group[]>(db.GROUPS), this.byOrgOrShared);
  readonly audit = scoped(signal<DeletionAudit[]>(db.DELETION_AUDIT), this.byOrg);
  readonly orders = scoped(signal<HardwareOrder[]>(db.ORDERS), this.byOrg);
  readonly vouchers = scoped(signal<Voucher[]>(db.VOUCHERS), this.byOrgOrShared);
  readonly params = signal(db.DIAGNOSTIC_PARAMS);
  readonly actions = signal(db.DEVICE_ACTIONS);
  readonly vehicles = scoped(signal<Vehicle[]>(db.VEHICLES), computed(() => {
    const id = this.scopeOrgId();
    const m = this.customerOrg();
    return id == null ? () => true : (v: Vehicle) => m.get(v.customerId) === id;
  }));
  readonly settings = signal<PortalSettings>(db.SETTINGS);
  readonly today = db.TODAY;
  readonly notifications = scoped(signal<AppNotification[]>(db.NOTIFICATIONS), this.byOrgOrPlatform);
  readonly notificationPrefs = signal<NotificationPrefs>(db.NOTIFICATION_PREFS);
  readonly unread = computed(() => this.notifications().filter((n) => !n.read).length);

  // ── Azure IoT Hub (device management) ─────────────────────
  readonly hub = signal(iot.HUB_METRICS);
  readonly iotStates = scoped(signal<IotDeviceState[]>(iot.IOT_STATES), this.byDevice);
  readonly twins = scoped(signal<DeviceTwin[]>(iot.TWINS), this.byDevice);
  readonly commands = scoped(signal<CommandRecord[]>(iot.COMMANDS), this.byDevice);
  readonly profiles = signal<ConfigProfile[]>(iot.CONFIG_PROFILES);
  readonly enrollments = signal<EnrollmentGroup[]>(iot.ENROLLMENT_GROUPS);
  readonly connectionEvents = scoped(signal(iot.CONNECTION_EVENTS), this.byDevice);
  readonly iotById = computed(() => new Map(this.iotStates().map((s) => [s.deviceId, s])));
  readonly twinById = computed(() => new Map(this.twins().map((t) => [t.deviceId, t])));
  readonly matchesTarget = iot.matchesTarget;
  readonly twinSync = iot.twinSync;

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
    return Math.max(...this._customers().map((c) => c.id)) + 1;
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
    const orgId = this.customerOrg().get(customerId) ?? 1;
    this.devices.update((xs) => xs.map((d) => (set.has(d.id) ? { ...d, customerId, orgId, status: 'Allocated' } : d)));
  }
  addDevices(devs: Device[]) {
    this.devices.update((xs) => [...devs, ...xs]);
  }

  /** A believable lifecycle for a device, derived from its current state. */
  deviceHistory(d: Device): DeviceEvent[] {
    const out: DeviceEvent[] = [{ at: d.createdAt, status: 'Available', note: 'Received into stock', by: 'Usman Siddiqui' }];
    const step = (days: number) => new Date(new Date(d.createdAt).getTime() + days * 86400000).toISOString();
    const owner = d.customerId ? this.customer(d.customerId)?.company : d.consumerId ? 'Consumer account' : null;
    if (d.status !== 'Available' && owner) {
      out.push({ at: step(2), status: 'Allocated', note: `Allocated to ${owner}`, by: 'Hira Qureshi' });
    }
    if ((d.status === 'Sold' || d.status === 'Deactivated') && owner) {
      out.push({ at: step(6), status: 'Sold', note: d.plate ? `Installed on ${d.plate}` : 'Activated', by: 'Ahmed Al Hashimi' });
    }
    if (d.status === 'Deactivated') out.push({ at: step(40), status: 'Deactivated', note: 'Customer account deactivated', by: 'Mobeen Tahir' });
    if (d.status === 'Faulty') out.push({ at: step(9), status: 'Faulty', note: 'No GPS fix after installation, returned for RMA', by: 'Grace Okafor' });
    return out.reverse();
  }

  // ── Notifications ──────────────────────────────────────────
  markRead(ids: number[], read = true) {
    const set = new Set(ids);
    this.notifications.update((xs) => xs.map((n) => (set.has(n.id) ? { ...n, read } : n)));
  }
  markAllRead() {
    this.notifications.update((xs) => xs.map((n) => ({ ...n, read: true })));
  }
  removeNotifications(ids: number[]) {
    const set = new Set(ids);
    this.notifications.update((xs) => xs.filter((n) => !set.has(n.id)));
  }
  pushNotification(n: Omit<AppNotification, 'id' | 'read' | 'at'>) {
    const full: AppNotification = { ...n, id: Math.max(0, ...this.notifications.all().map((x) => x.id)) + 1, read: false, at: nowIso() };
    this.notifications.update((xs) => [full, ...xs]);
    return full;
  }

  // ── IoT Hub operations (design-phase simulation of the service SDK) ──
  /**
   * Invoke a direct method / send a C2D message. Resolves like IoT Hub would: a connected device
   * answers in about a second; a disconnected one times out (direct method) or queues (C2D).
   */
  sendCommand(deviceId: string, method: string, kind: CommandRecord['kind'], payload: Record<string, TwinValue>, ok = 'OK'): CommandRecord {
    const id = Math.max(0, ...this.commands.all().map((c) => c.id)) + 1;
    const connected = this.iotById().get(deviceId)?.connection === 'Connected';
    const rec: CommandRecord = {
      id, deviceId, method, kind, payload, status: 'Pending', responseCode: null, response: null, latencyMs: null,
      sentAt: nowIso(), sentBy: this.currentUser().name,
    };
    this.commands.update((xs) => [rec, ...xs]);
    const settle = (patch: Partial<CommandRecord>) => this.commands.update((xs) => xs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    if (kind === 'C2D message' && !connected) {
      setTimeout(() => settle({ status: 'Queued', response: 'Queued until the device reconnects (expires in 48 h)' }), 400);
      this.iotStates.update((xs) => xs.map((s) => (s.deviceId === deviceId ? { ...s, c2dQueued: s.c2dQueued + 1 } : s)));
    } else if (!connected) {
      setTimeout(() => settle({ status: 'Timed out', responseCode: 504, response: 'Device did not respond within 30 s', latencyMs: 30000 }), 2200);
    } else {
      const ms = 500 + Math.round(Math.random() * 900);
      setTimeout(() => settle({ status: 'Succeeded', responseCode: 200, response: ok, latencyMs: ms }), ms);
    }
    return rec;
  }

  /** Patch desired properties; a connected device reports them back a moment later. */
  setDesired(deviceId: string, patch: Record<string, TwinValue>) {
    const now = nowIso();
    this.twins.update((xs) => xs.map((t) => (t.deviceId === deviceId
      ? { ...t, desired: { version: t.desired.version + 1, props: { ...t.desired.props, ...patch }, updatedAt: now } }
      : t)));
    if (this.iotById().get(deviceId)?.connection === 'Connected') {
      setTimeout(() => this.twins.update((xs) => xs.map((t) => {
        if (t.deviceId !== deviceId) return t;
        const props = { ...t.reported.props, ...patch };
        delete props['$configError'];
        return { ...t, reported: { version: t.reported.version + 1, props, updatedAt: nowIso() } };
      })), 1600);
    }
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
        deviceId: id, hubName: iot.HUB_NAME, registration: 'Awaiting first connection', connection: 'Disconnected',
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
    this.organizations.update((xs) => (xs.some((x) => x.id === o.id) ? xs.map((x) => (x.id === o.id ? o : x)) : [...xs, o]));
  }
  /** Design-phase "Preview as": sign in as another sample user. */
  signInAs(userId: number) {
    this.sessionUserId.set(userId);
    this.activeOrgId.set(null);
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
