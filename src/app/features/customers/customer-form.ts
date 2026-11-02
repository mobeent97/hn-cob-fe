import {
  ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked,
} from '@angular/core';
import { Location } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators, AbstractControl } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Store } from '../../core/data/store';
import { DatePipe, fmtMoney } from '../../core/data/format';
import {
  Customer, CustomerType, Device, HardwareOrder, ONBOARDING_STEPS, PackageName,
} from '../../core/data/models';
import { Icon } from '../../shared/ui/icon';
import { Toaster } from '../../shared/ui/toast';
import { simulateLoad } from '../../shared/ui/loading';
import { OrgTag } from '../tenancy';
import {
  BRAND_SWATCHES, DOC_KINDS, EMAIL_RE, HEX_RE, PHONE_RE, URL_RE, USER_GROUP_OPTIONS, QID_RE,
  fmtSize, isoDay, messageFor, notBlank, notPast, splitPhone,
} from './onboarding';
import { Select, SelectOption } from '../../shared/ui/select';

type DocKind = (typeof DOC_KINDS)[number];
interface DocRow { id: number; name: string; kind: string; sizeKb: number; uploadedAt: string; file?: File }
type Admin = Customer['admins'][number];
type Billing = 'Billable' | 'POC';
type Cycle = 'Monthly' | 'Quarterly' | 'Annual';

const MAX_DOC_KB = 5 * 1024;
const DOC_TYPES = /\.(pdf|jpe?g|png)$/i;

/**
 * Customer onboarding wizard — "What's left before this customer can go live?"
 * Nine sections in order; each Save writes the customer to the store and advances stepsDone,
 * so leaving half-way keeps the work. Completed sections stay reachable from the rail.
 */
@Component({
  selector: 'app-customer-form',
  imports: [Select, SelectOption, RouterLink, ReactiveFormsModule, Icon, DatePipe, OrgTag],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './customer-form.html',
  styleUrl: './customer-form.scss',
})
export class CustomerForm {
  protected readonly store = inject(Store);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly toast = inject(Toaster);
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly destroyRef = inject(DestroyRef);

  /** Route param for /customers/:id/edit; undefined on /customers/new. */
  readonly id = input<string>();
  /** Optional ?section=n (1-9) to open a completed section directly, e.g. from the detail screen. */
  readonly section = input<string>();

  protected readonly steps = ONBOARDING_STEPS;
  protected readonly docKinds = DOC_KINDS;
  protected readonly userGroupOptions = USER_GROUP_OPTIONS;
  protected readonly swatches = BRAND_SWATCHES;
  protected readonly customerTypes: { id: CustomerType; title: string; body: string }[] = [
    { id: 'EBU', title: 'Enterprise (EBU)', body: 'Large fleets on a negotiated contract, billed per device.' },
    { id: 'SME', title: 'Small & medium (SME)', body: 'Up to around 50 vehicles on standard pricing.' },
    { id: 'Government', title: 'Government', body: 'Public-sector entities with tender terms and Enterprise features.' },
  ];
  protected readonly fmtSize = fmtSize;
  protected readonly fmtMoney = fmtMoney;
  protected readonly today = isoDay();

  protected readonly loading = simulateLoad('customer-form', 400);

  // ── Wizard state ──────────────────────────────────────────
  protected readonly step = signal(0);
  /** Sections completed, 0-9 (what the store calls stepsDone). */
  protected readonly done = signal(0);
  protected readonly dir = signal<1 | -1>(1);
  /** Sections only slide once the person moves; the first paint doesn't perform an entrance. */
  protected readonly moved = signal(false);
  protected readonly submitted = signal(false);
  protected readonly shake = signal(false);
  protected readonly stepError = signal<string | null>(null);
  protected readonly customerId = signal<number | null>(null);
  private loadedFor: string | undefined | null = null;

  protected readonly existing = computed(() => {
    const id = this.id();
    return id ? this.store.customer(Number(id)) : undefined;
  });
  protected readonly notFound = computed(() => !!this.id() && !this.existing());
  protected readonly isEdit = computed(() => !!this.id() || this.customerId() !== null);

  // ── 1. General details ────────────────────────────────────
  protected readonly general = this.fb.group({
    company: ['', [Validators.required, Validators.maxLength(60), notBlank]],
    group: ['', [Validators.required, Validators.maxLength(60), notBlank]],
    industry: ['', Validators.required],
    website: ['', [Validators.required, Validators.pattern(URL_RE)]],
    email: ['', [Validators.required, Validators.pattern(EMAIL_RE)]],
    phoneDial: ['+971'],
    phone: ['', [Validators.required, Validators.pattern(PHONE_RE)]],
    crNumber: ['', [Validators.required, Validators.maxLength(60), notBlank]],
    countryCode: ['', Validators.required],
    zone: ['', Validators.required],
    contractExpiry: ['', [Validators.required, notPast]],
    firstName: ['', [Validators.required, Validators.maxLength(60), notBlank]],
    lastName: ['', [Validators.required, Validators.maxLength(60), notBlank]],
    qid: ['', [Validators.required, Validators.pattern(QID_RE)]],
    contactEmail: ['', [Validators.required, Validators.pattern(EMAIL_RE)]],
    contactDial: ['+971'],
    contactPhone: ['', [Validators.required, Validators.pattern(PHONE_RE)]],
    userGroups: [['Customer admin'] as string[]],
  });
  protected readonly countryCode = signal('');
  protected readonly country = computed(() => this.store.countries.find((c) => c.code === this.countryCode()));
  protected readonly currency = computed(() => this.country()?.currency ?? '');

  // ── Organization (tenant) ─────────────────────────────────
  /** A platform user creating a customer in All organizations picks the tenant that serves it. */
  protected readonly pickOrg = computed(
    () => this.store.crossTenant() && this.store.scopeOrgId() == null && !this.existing() && this.customerId() === null,
  );
  protected readonly orgChoice = signal<number | null>(this.store.currentOrg().id);
  /** Organizations that serve business customers in the chosen country. */
  protected readonly orgOptions = computed(() => {
    const cc = this.countryCode();
    return this.store
      .organizations()
      .filter((o) => o.status !== 'Suspended' && o.segments.includes('B2B') && (!cc || o.countries.includes(cc)));
  });
  /** The organization the customer belongs to (chosen, existing, or the scope). */
  protected readonly targetOrg = computed(() => {
    const prev = this.existing() ?? (this.customerId() ? this.store.customer(this.customerId()!) : undefined);
    const id = prev?.orgId ?? (this.pickOrg() ? this.orgChoice() : this.store.writeOrgId());
    return this.store.organizations().find((o) => o.id === id) ?? null;
  });
  /** Customers already counted against the target organization's limit. */
  protected readonly orgUsage = computed(() => {
    const o = this.targetOrg();
    if (!o) return null;
    const used = this.store.customers.all().filter((c) => c.orgId === o.id).length;
    return { used, max: o.limits.maxCustomers, full: o.limits.maxCustomers != null && used >= o.limits.maxCustomers };
  });
  /** Partners only onboard customers in their own countries. */
  protected readonly countryOptions = computed(() => {
    const o = this.pickOrg() ? null : this.targetOrg();
    return o && o.kind === 'Partner' ? this.store.countries.filter((c) => o.countries.includes(c.code)) : this.store.countries;
  });

  // ── 2. Documents ──────────────────────────────────────────
  protected readonly docs = signal<DocRow[]>([]);
  protected readonly rejected = signal<string[]>([]);
  protected readonly dragging = signal(false);
  private docSeq = 1;

  // ── 3–5. Package, customer type, features ─────────────────
  protected readonly pkg = signal<PackageName | null>(null);
  protected readonly customerType = signal<CustomerType | null>(null);
  protected readonly billing = signal<Billing>('Billable');
  protected readonly cycle = signal<Cycle>('Monthly');
  protected readonly features = signal<Set<number>>(new Set());

  // ── 6. Admins ─────────────────────────────────────────────
  protected readonly admins = signal<Admin[]>([]);
  protected readonly adminSubmitted = signal(false);
  protected readonly adminForm = this.fb.group({
    name: ['', [Validators.required, Validators.maxLength(60), notBlank]],
    email: ['', [Validators.required, Validators.pattern(EMAIL_RE)]],
    dial: ['+971'],
    phone: ['', [Validators.required, Validators.pattern(PHONE_RE)]],
  });

  // ── 7. Hardware ───────────────────────────────────────────
  protected readonly qty = signal<Record<number, number>>({});
  protected readonly picked = signal<Set<string>>(new Set());

  // ── 8. Shipment ───────────────────────────────────────────
  protected readonly shipment = this.fb.group({
    installation: [true],
    address: ['', [Validators.required, Validators.maxLength(600), notBlank]],
    preferredDate: ['', [Validators.required, notPast]],
    contactName: ['', [Validators.required, Validators.maxLength(60), notBlank]],
    contactDial: ['+971'],
    contactPhone: ['', [Validators.required, Validators.pattern(PHONE_RE)]],
    courierNote: ['', Validators.maxLength(300)],
  });
  protected readonly installation = signal(true);

  // ── 9. Branding ───────────────────────────────────────────
  protected readonly colour = signal('#0a6f96');
  protected readonly colourText = signal('#0a6f96');
  protected readonly logo = signal<{ name: string; url: string } | null>(null);
  protected readonly logoError = signal<string | null>(null);
  protected readonly pageTitle = signal('');

  constructor() {
    // Country drives zones, currency and the default dial codes (legacy: the phone code drove the currency).
    this.general.controls.countryCode.valueChanges.pipe(takeUntilDestroyed()).subscribe((code) => {
      this.countryCode.set(code);
      if (this.pickOrg()) {
        const ok = this.orgOptions();
        const home = this.store.currentOrg().id;
        if (!ok.some((o) => o.id === this.orgChoice())) this.orgChoice.set(ok.some((o) => o.id === home) ? home : ok[0]?.id ?? null);
      }
      const c = this.store.countries.find((x) => x.code === code);
      if (!c) return;
      const zone = this.general.controls.zone;
      if (!c.zones.includes(zone.value)) zone.setValue(c.zones.length === 1 ? c.zones[0] : '');
      if (!this.general.controls.phone.value) this.general.controls.phoneDial.setValue(c.dial);
      if (!this.general.controls.contactPhone.value) this.general.controls.contactDial.setValue(c.dial);
    });
    this.shipment.controls.installation.valueChanges.pipe(takeUntilDestroyed()).subscribe((on) => {
      this.installation.set(on);
      for (const k of ['contactName', 'contactDial', 'contactPhone'] as const) {
        const ctl = this.shipment.controls[k];
        on ? ctl.enable({ emitEvent: false }) : ctl.disable({ emitEvent: false });
      }
    });

    // Prefill once per route id (edit) — and start at the first incomplete section.
    effect(() => {
      const id = this.id();
      const c = this.existing();
      untracked(() => {
        if (this.loadedFor === (id ?? '')) return;
        this.loadedFor = id ?? '';
        if (c) this.prefill(c);
      });
    });
    this.destroyRef.onDestroy(() => {
      const l = this.logo();
      if (l?.url.startsWith('blob:')) URL.revokeObjectURL(l.url);
    });
  }

  private prefill(c: Customer) {
    const phone = splitPhone(c.phone, this.store.country(c.countryCode).dial);
    const cphone = splitPhone(c.contact.phone, phone.dial);
    this.general.setValue({
      company: c.company, group: c.group, industry: c.industry, website: c.website, email: c.email,
      phoneDial: phone.dial, phone: phone.number, crNumber: c.crNumber, countryCode: c.countryCode,
      zone: c.zone, contractExpiry: c.contractExpiry.slice(0, 10), firstName: c.contact.firstName,
      lastName: c.contact.lastName, qid: c.contact.qid, contactEmail: c.contact.email,
      contactDial: cphone.dial, contactPhone: cphone.number, userGroups: [...c.userGroups],
    });
    this.countryCode.set(c.countryCode);
    this.customerId.set(c.id);
    this.docs.set(c.documents.map((d) => ({ ...d, id: this.docSeq++ })));
    const done = Math.min(9, c.stepsDone);
    this.done.set(done);
    this.pkg.set(done >= 3 ? c.package : null);
    this.customerType.set(done >= 4 ? c.customerType : null);
    this.features.set(this.defaultFeatures(this.pkg()));
    this.admins.set([...c.admins]);
    if (done >= 8) {
      this.shipment.patchValue({
        address: `${c.zone}, ${this.store.country(c.countryCode).name}`,
        preferredDate: isoDay(7),
        contactName: `${c.contact.firstName} ${c.contact.lastName}`,
        contactDial: cphone.dial,
        contactPhone: cphone.number,
      });
    }
    this.colour.set(c.brandColour);
    this.colourText.set(c.brandColour);
    this.pageTitle.set(c.company);
    const want = Number(this.section()) - 1;
    this.step.set(Number.isInteger(want) && want >= 0 && want <= Math.min(done, 8) ? want : done >= 9 ? 0 : done);
  }

  // ── Derived data ──────────────────────────────────────────
  protected readonly companyName = computed(() => this.existing()?.company ?? 'New customer');
  protected readonly packageCards = computed(() => {
    const groups = this.store.featureGroups();
    return this.store.packages().map((p) => {
      const feats = groups.flatMap((g) => g.features.filter((f) => f.packages.includes(p.name)).map((f) => f.name));
      return { ...p, feats, devices: this.store.deviceTypes().filter((t) => t.packages.includes(p.name)).length };
    });
  });
  protected readonly featureGroups = computed(() => {
    const p = this.pkg();
    return this.store
      .featureGroups()
      .map((g) => ({ ...g, features: g.features.filter((f) => p && f.packages.includes(p)) }))
      .filter((g) => g.features.length);
  });
  protected readonly featureTotal = computed(() => this.featureGroups().reduce((a, g) => a + g.features.length, 0));

  protected readonly allowedTypes = computed(() => {
    const p = this.pkg();
    return this.store.deviceTypes().filter((t) => p && t.packages.includes(p));
  });
  protected readonly stock = computed(() => {
    const allowed = new Set(this.allowedTypes().map((t) => t.id));
    return this.store.devices().filter((d) => d.status === 'Available' && allowed.has(d.typeId));
  });
  protected readonly stockByType = computed(() => {
    const m = new Map<number, number>();
    for (const d of this.stock()) m.set(d.typeId, (m.get(d.typeId) ?? 0) + 1);
    return m;
  });
  protected readonly assigned = computed<Device[]>(() => {
    const id = this.customerId();
    return id ? this.store.devicesByCustomer().get(id) ?? [] : [];
  });
  protected readonly onOrder = computed<HardwareOrder[]>(() => {
    const id = this.customerId();
    return id ? this.store.orders().filter((o) => o.customerId === id && (o.status === 'Placed' || o.status === 'Packed')) : [];
  });
  protected readonly orderUnits = computed(() => Object.values(this.qty()).reduce((a, b) => a + b, 0));
  protected readonly orderTotal = computed(() =>
    this.allowedTypes().reduce((a, t) => a + (this.qty()[t.id] ?? 0) * t.unitPrice, 0),
  );
  protected readonly onOrderUnits = computed(() => this.onOrder().reduce((a, o) => a + o.quantity, 0));

  protected readonly nextLabel = computed(() =>
    this.step() < 8 ? 'Save and continue' : this.done() === 9 ? 'Save changes' : 'Finish onboarding',
  );

  // ── Field helpers ─────────────────────────────────────────
  protected err(ctl: AbstractControl, label: string, hint?: string) {
    return ctl.invalid && (ctl.touched || this.submitted()) ? messageFor(ctl, label, hint) : null;
  }
  protected bad(ctl: AbstractControl) {
    return ctl.invalid && (ctl.touched || this.submitted());
  }
  protected toggleGroup(name: string, on: boolean) {
    const ctl = this.general.controls.userGroups;
    ctl.setValue(on ? [...ctl.value, name] : ctl.value.filter((g) => g !== name));
  }
  protected zonesFor() {
    return this.country()?.zones ?? [];
  }

  // ── Navigation ────────────────────────────────────────────
  protected stepState(i: number) {
    return i === this.step() ? 'current' : i < this.done() ? 'done' : i === this.done() ? 'next' : 'locked';
  }
  protected go(i: number) {
    if (i === this.step() || i > this.done()) return;
    this.dir.set(i > this.step() ? 1 : -1);
    this.moved.set(true);
    this.resetStepUi();
    this.step.set(i);
  }
  protected back() {
    if (this.step() > 0) this.go(this.step() - 1);
  }
  private resetStepUi() {
    this.submitted.set(false);
    this.stepError.set(null);
    this.adminSubmitted.set(false);
  }

  protected saveAndContinue() {
    this.submitted.set(true);
    const problem = this.validate(this.step());
    if (problem) {
      this.stepError.set(problem === true ? null : problem);
      this.shake.set(false);
      requestAnimationFrame(() => this.shake.set(true));
      setTimeout(() => this.shake.set(false), 400);
      // Put focus on the first invalid field so keyboard users land where the problem is.
      setTimeout(() => (document.querySelector('.panel .invalid') as HTMLElement | null)?.focus());
      return;
    }
    const i = this.step();
    const wasDone = this.done() === 9;
    this.applySideEffects(i);
    const stepsDone = Math.max(this.done(), i + 1);
    const saved = this.store.saveCustomer(this.build(stepsDone));
    this.done.set(stepsDone);
    if (this.customerId() === null) {
      this.customerId.set(saved.id);
      // Fixes the legacy wizard staying on /add after the first save.
      this.location.replaceState(`/customers/${saved.id}/edit`);
    }
    if (i === 8) {
      if (wasDone) this.toast.show(`${saved.company} updated`);
      else this.toast.show(`${saved.company} is onboarded`, { body: 'All nine sections are complete. Their admins can now sign in.' });
      this.router.navigate(['/customers', saved.id]);
      return;
    }
    this.toast.show(`${ONBOARDING_STEPS[i]} saved`, { tone: 'info', body: `${stepsDone} of 9 sections complete.` });
    this.dir.set(1);
    this.moved.set(true);
    this.resetStepUi();
    this.step.set(i + 1);
  }

  /** null when valid; true when inline field errors explain it; a string for a section-level error. */
  private validate(i: number): string | true | null {
    switch (i) {
      case 0: {
        this.general.markAllAsTouched();
        if (this.uniqueCompany() || this.general.invalid) return true;
        if (this.pickOrg() && !this.orgOptions().some((o) => o.id === this.orgChoice()))
          return 'Choose the organization that serves this customer.';
        const usage = this.orgUsage();
        if (this.customerId() === null && !this.existing() && usage?.full) {
          const o = this.targetOrg()!;
          return this.store.crossTenant()
            ? `${o.name} has reached its limit of ${usage.max} customers. Raise the limit in Organizations, or choose another organization.`
            : `${o.name} has reached its limit of ${usage.max} customers. Ask HyperNym to raise the limit before onboarding another.`;
        }
        return null;
      }
      case 1:
        return this.docs().length ? null : 'Upload at least one document, such as the trade licence or the signed contract.';
      case 2:
        return this.pkg() ? null : 'Choose a package.';
      case 3:
        return this.customerType() ? null : 'Choose a customer type.';
      case 4:
        return this.features().size ? null : 'Turn on at least one feature.';
      case 5:
        return this.admins().length ? null : 'Add at least one admin: they receive the sign-in invitation.';
      case 6:
        return this.assigned().length + this.picked().size + this.orderUnits() + this.onOrderUnits() > 0
          ? null
          : 'Order devices or allocate some from stock.';
      case 7:
        this.shipment.markAllAsTouched();
        return this.shipment.invalid ? true : null;
      case 8:
        if (!HEX_RE.test(this.colour())) return 'Enter the brand colour as a hex value, like #0a6f96.';
        return this.logoError() ? this.logoError() : null;
    }
    return null;
  }

  private uniqueCompany(): true | null {
    const name = this.general.controls.company.value.trim().toLowerCase();
    const clash = this.store.customers().find((c) => c.company.toLowerCase() === name && c.id !== this.customerId());
    if (clash) {
      this.general.controls.company.setErrors({ taken: `${clash.company} already exists.` });
      return true;
    }
    return null;
  }

  /** Writes that belong to other records: device allocation and hardware orders. */
  private applySideEffects(i: number) {
    const id = this.customerId() ?? this.store.nextCustomerId();
    if (i === 6) {
      if (this.picked().size) this.store.allocate([...this.picked()], id);
      this.picked.set(new Set());
      const lines = this.allowedTypes().filter((t) => (this.qty()[t.id] ?? 0) > 0);
      if (lines.length) {
        const g = this.general.getRawValue();
        let next = Math.max(0, ...this.store.orders.all().map((o) => o.id)) + 1;
        const orgId = this.store.customer(this.customerId()!)?.orgId ?? this.store.writeOrgId();
        const orders: HardwareOrder[] = lines.map((t) => ({
          orgId,
          id: next,
          orderNo: `HW-2026${String(4900 + next++).padStart(5, '0')}`,
          status: 'Placed',
          typeId: t.id,
          customerId: id,
          orderedBy: this.store.currentUser().email,
          quantity: this.qty()[t.id],
          address: `${g.zone}, ${this.country()?.name ?? ''}`,
          phone: `${g.contactDial} ${g.contactPhone}`,
          orderedAt: this.store.today.toISOString(),
          eta: null,
          courier: null,
        }));
        this.store.orders.update((xs) => [...orders, ...xs]);
        this.qty.set({});
      }
    }
    if (i === 7) {
      // Open orders ship to the address entered here.
      const s = this.shipment.getRawValue();
      this.store.orders.update((xs) =>
        xs.map((o) =>
          o.customerId === id && (o.status === 'Placed' || o.status === 'Packed')
            ? { ...o, address: s.address.trim(), eta: s.preferredDate, phone: s.installation ? `${s.contactDial} ${s.contactPhone}` : o.phone }
            : o,
        ),
      );
    }
  }

  private build(stepsDone: number): Customer {
    const g = this.general.getRawValue();
    const prev = this.existing() ?? (this.customerId() ? this.store.customer(this.customerId()!) : undefined);
    const admins = this.admins();
    return {
      orgId: prev?.orgId ?? this.targetOrg()?.id ?? this.store.writeOrgId(),
      id: this.customerId() ?? this.store.nextCustomerId(),
      company: g.company.trim(),
      group: g.group.trim(),
      industry: g.industry,
      website: g.website.trim(),
      email: g.email.trim(),
      phone: `${g.phoneDial} ${g.phone.trim()}`,
      crNumber: g.crNumber.trim(),
      countryCode: g.countryCode,
      zone: g.zone,
      contractExpiry: g.contractExpiry,
      contact: {
        firstName: g.firstName.trim(), lastName: g.lastName.trim(), qid: g.qid.trim(),
        email: g.contactEmail.trim(), phone: `${g.contactDial} ${g.contactPhone.trim()}`,
      },
      userGroups: g.userGroups,
      status: prev?.status ?? 'Active',
      deletionStatus: prev?.deletionStatus ?? 'None',
      useCase: prev?.useCase ?? 'Fleet Management System',
      package: this.pkg() ?? prev?.package ?? 'Basic',
      customerType: this.customerType() ?? prev?.customerType ?? 'SME',
      superAdminEmail: admins[0]?.email ?? g.contactEmail.trim(),
      createdAt: prev?.createdAt ?? this.store.today.toISOString(),
      stepsDone,
      documents: this.docs().map(({ name, kind, sizeKb, uploadedAt }) => ({ name, kind, sizeKb, uploadedAt })),
      admins,
      brandColour: HEX_RE.test(this.colour()) ? this.colour() : prev?.brandColour ?? '#0a6f96',
    };
  }

  // ── Documents ─────────────────────────────────────────────
  protected onDrop(e: DragEvent) {
    e.preventDefault();
    this.dragging.set(false);
    this.addFiles(e.dataTransfer?.files ?? null);
  }
  protected onPick(e: Event) {
    const input = e.target as HTMLInputElement;
    this.addFiles(input.files);
    input.value = '';
  }
  private addFiles(list: FileList | null) {
    if (!list) return;
    const bad: string[] = [];
    const ok: DocRow[] = [];
    for (const f of Array.from(list)) {
      if (!DOC_TYPES.test(f.name)) bad.push(`${f.name} isn't a PDF, JPG or PNG.`);
      else if (f.size / 1024 > MAX_DOC_KB) bad.push(`${f.name} is ${fmtSize(f.size / 1024)}; the limit is 5 MB.`);
      else ok.push({ id: this.docSeq++, name: f.name, kind: this.guessKind(f.name), sizeKb: Math.max(1, Math.round(f.size / 1024)), uploadedAt: this.store.today.toISOString(), file: f });
    }
    this.rejected.set(bad);
    if (ok.length) {
      this.docs.update((xs) => [...xs, ...ok]);
      this.stepError.set(null);
    }
  }
  private guessKind(name: string): DocKind {
    const n = name.toLowerCase();
    if (n.includes('licen')) return 'Trade licence';
    if (n.includes('contract') || n.includes('agreement')) return 'Contract';
    if (n.includes('passport')) return 'Passport';
    if (n.includes('id')) return 'ID copy';
    return 'Other';
  }
  protected setKind(id: number, kind: string) {
    this.docs.update((xs) => xs.map((d) => (d.id === id ? { ...d, kind } : d)));
  }
  protected removeDoc(d: DocRow) {
    const before = this.docs();
    this.docs.update((xs) => xs.filter((x) => x.id !== d.id));
    this.toast.show(`${d.name} removed`, { tone: 'info', action: { label: 'Undo', run: () => this.docs.set(before) } });
  }

  // ── Package, type, features ───────────────────────────────
  protected choosePackage(p: PackageName) {
    if (this.pkg() === p) return;
    this.pkg.set(p);
    this.features.set(this.defaultFeatures(p));
    const allowed = new Set(this.store.deviceTypes().filter((t) => t.packages.includes(p)).map((t) => t.id));
    this.qty.update((q) => Object.fromEntries(Object.entries(q).filter(([k]) => allowed.has(Number(k)))));
    this.picked.update((s) => new Set([...s].filter((id) => allowed.has(this.store.devices().find((d) => d.id === id)!.typeId))));
    this.stepError.set(null);
  }
  private defaultFeatures(p: PackageName | null) {
    if (!p) return new Set<number>();
    return new Set(this.store.featureGroups().flatMap((g) => g.features.filter((f) => f.packages.includes(p)).map((f) => f.id)));
  }
  protected toggleFeature(id: number, on: boolean) {
    this.features.update((s) => {
      const n = new Set(s);
      on ? n.add(id) : n.delete(id);
      return n;
    });
  }
  protected resetFeatures() {
    this.features.set(this.defaultFeatures(this.pkg()));
  }
  protected chooseType(t: CustomerType) {
    this.customerType.set(t);
    this.stepError.set(null);
  }

  // ── Admins ────────────────────────────────────────────────
  protected adminErr(ctl: AbstractControl, label: string, hint?: string) {
    return ctl.invalid && (ctl.touched || this.adminSubmitted()) ? messageFor(ctl, label, hint) : null;
  }
  protected addAdmin() {
    this.adminSubmitted.set(true);
    const f = this.adminForm;
    const email = f.controls.email.value.trim().toLowerCase();
    if (email && this.admins().some((a) => a.email.toLowerCase() === email)) {
      f.controls.email.setErrors({ taken: 'This person is already an admin.' });
    }
    if (f.invalid) {
      f.markAllAsTouched();
      return;
    }
    const v = f.getRawValue();
    this.admins.update((xs) => [...xs, { name: v.name.trim(), email: v.email.trim(), phone: `${v.dial} ${v.phone.trim()}` }]);
    f.reset({ name: '', email: '', dial: v.dial, phone: '' });
    this.adminSubmitted.set(false);
    this.stepError.set(null);
  }
  protected removeAdmin(a: Admin) {
    const before = this.admins();
    this.admins.update((xs) => xs.filter((x) => x !== a));
    this.toast.show(`${a.name} removed`, { tone: 'info', action: { label: 'Undo', run: () => this.admins.set(before) } });
  }
  protected useContactAsAdmin() {
    const g = this.general.getRawValue();
    this.adminForm.setValue({ name: `${g.firstName} ${g.lastName}`.trim(), email: g.contactEmail, dial: g.contactDial, phone: g.contactPhone });
  }

  // ── Hardware ──────────────────────────────────────────────
  protected setQty(typeId: number, raw: string | number) {
    const n = Math.max(0, Math.min(999, Math.floor(Number(raw) || 0)));
    this.qty.update((q) => ({ ...q, [typeId]: n }));
    if (n) this.stepError.set(null);
  }
  protected togglePick(id: string, on: boolean) {
    this.picked.update((s) => {
      const n = new Set(s);
      on ? n.add(id) : n.delete(id);
      return n;
    });
    if (on) this.stepError.set(null);
  }
  protected typeName(id: number) {
    return this.store.deviceType(id).name;
  }

  // ── Branding ──────────────────────────────────────────────
  protected setColour(hex: string) {
    this.colourText.set(hex);
    if (HEX_RE.test(hex)) this.colour.set(hex.toLowerCase());
  }
  protected onLogo(e: Event) {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    if (!/\.(png|jpe?g|svg)$/i.test(f.name)) return this.logoError.set(`${f.name} isn't a PNG, JPG or SVG.`);
    if (f.size > 2 * 1024 * 1024) return this.logoError.set(`${f.name} is ${fmtSize(f.size / 1024)}; the limit is 2 MB.`);
    const old = this.logo();
    if (old) URL.revokeObjectURL(old.url);
    this.logoError.set(null);
    this.logo.set({ name: f.name, url: URL.createObjectURL(f) });
  }
  protected clearLogo() {
    const old = this.logo();
    if (old) URL.revokeObjectURL(old.url);
    this.logo.set(null);
  }
  protected initials() {
    const name = this.general.controls.company.value.trim() || this.companyName();
    return name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('');
  }
}
