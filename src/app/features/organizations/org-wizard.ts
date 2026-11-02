import { ChangeDetectionStrategy, Component, computed, effect, inject, model, output, signal, untracked } from '@angular/core';
import { Store } from '../../core/data/store';
import { Organization, Permission } from '../../core/data/models';
import { Icon } from '../../shared/ui/icon';
import { Dialog } from '../../shared/ui/dialog';
import { Toaster } from '../../shared/ui/toast';
import {
  EMAIL_RE, FEATURES_BY_AREA, LEVELS, ORG_SWATCHES, PRESETS, PresetId, createOrganization, emailTaken, levelLabel, presetFeatures,
} from './org-util';

const STEPS = ['Profile', 'Features', 'Administrator'] as const;

/** New organization: three short steps (profile, features, first administrator), side-by-side transition. */
@Component({
  selector: 'app-org-wizard',
  imports: [Icon, Dialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './org-wizard.html',
  styleUrl: './org-wizard.scss',
})
export class OrgWizard {
  protected readonly store = inject(Store);
  private readonly toast = inject(Toaster);

  readonly open = model(false);
  readonly created = output<Organization>();

  protected readonly steps = STEPS;
  protected readonly presets = PRESETS;
  protected readonly levels = LEVELS;
  protected readonly levelLabel = levelLabel;
  protected readonly swatches = ORG_SWATCHES;
  /** Partners never see platform-only features. */
  protected readonly areas = FEATURES_BY_AREA.map((a) => ({ ...a, features: a.features.filter((f) => !f.platformOnly) })).filter((a) => a.features.length);

  protected readonly step = signal(0);
  protected readonly dir = signal<1 | -1>(1);
  protected readonly moved = signal(false);
  protected readonly tried = signal(false);

  protected readonly name = signal('');
  protected readonly legalName = signal('');
  protected readonly countries = signal<string[]>([]);
  protected readonly segments = signal<('B2B' | 'B2C')[]>(['B2B']);
  protected readonly brandColour = signal(ORG_SWATCHES[0]);
  protected readonly preset = signal<PresetId>('onboarding');
  protected readonly features = signal<Record<string, Permission>>(presetFeatures('onboarding', false));
  protected readonly adminName = signal('');
  protected readonly adminEmail = signal('');
  protected readonly adminPhone = signal('');
  protected readonly maxCustomers = signal('');
  protected readonly maxUsers = signal('10');

  constructor() {
    effect(() => {
      if (this.open()) untracked(() => this.reset());
    });
  }

  private reset() {
    this.step.set(0);
    this.moved.set(false);
    this.tried.set(false);
    this.name.set('');
    this.legalName.set('');
    this.countries.set([]);
    this.segments.set(['B2B']);
    const used = new Set(this.store.organizations().map((o) => o.brandColour));
    this.brandColour.set(ORG_SWATCHES.find((s) => !used.has(s)) ?? ORG_SWATCHES[0]);
    this.preset.set('onboarding');
    this.features.set(presetFeatures('onboarding', false));
    this.adminName.set('');
    this.adminEmail.set('');
    this.adminPhone.set('');
    this.maxCustomers.set('');
    this.maxUsers.set('10');
  }

  protected toggle<T extends string>(sig: { (): T[]; set(v: T[]): void }, v: T, on: boolean) {
    const list = sig().filter((x) => x !== v);
    sig.set(on ? [...list, v] : list);
  }
  protected setSegment(v: 'B2B' | 'B2C', on: boolean) {
    this.toggle(this.segments, v, on);
    const b2c = this.segments().includes('B2C');
    if (this.preset() !== 'custom') this.features.set(presetFeatures(this.preset(), b2c));
    else if (!b2c) this.features.update((f) => ({ ...f, Consumers: null }));
  }

  protected choosePreset(id: PresetId) {
    this.preset.set(id);
    this.features.set(presetFeatures(id, this.segments().includes('B2C')));
  }
  protected setLevel(key: string, l: Permission) {
    this.features.update((f) => ({ ...f, [key]: l }));
    this.preset.set('custom');
  }
  protected readonly enabled = computed(() => Object.values(this.features()).filter(Boolean).length);
  protected readonly grantable = this.areas.reduce((n, a) => n + a.features.length, 0);

  private parse(v: string): number | null | 'bad' {
    const t = v.trim();
    if (!t) return null;
    return /^\d+$/.test(t) && +t > 0 ? +t : 'bad';
  }

  protected readonly errors = computed(() => {
    const e: Record<string, string> = {};
    const s = this.step();
    if (s === 0) {
      const n = this.name().trim();
      if (!n) e['name'] = 'Enter the organization’s name.';
      else if (this.store.organizations().some((o) => o.name.toLowerCase() === n.toLowerCase())) e['name'] = 'An organization with this name already exists.';
      if (!this.legalName().trim()) e['legalName'] = 'Enter the registered legal name.';
      if (!this.countries().length) e['countries'] = 'Choose at least one country.';
      if (!this.segments().length) e['segments'] = 'Choose at least one segment.';
    } else if (s === 1) {
      if (!this.enabled()) e['features'] = 'Turn on at least one feature, or the organization can’t open anything.';
    } else {
      if (!this.adminName().trim()) e['adminName'] = 'Enter their full name.';
      if (!EMAIL_RE.test(this.adminEmail().trim())) e['adminEmail'] = 'Enter an email like name@company.com.';
      else if (emailTaken(this.store, this.adminEmail())) e['adminEmail'] = 'Someone on the portal already uses this email.';
      if (this.parse(this.maxCustomers()) === 'bad') e['maxCustomers'] = 'A whole number above 0, or empty.';
      if (this.parse(this.maxUsers()) === 'bad') e['maxUsers'] = 'A whole number above 0, or empty.';
    }
    return e;
  });
  protected err(k: string) {
    return this.tried() ? this.errors()[k] : undefined;
  }

  protected go(i: number) {
    if (i === this.step()) return;
    this.dir.set(i > this.step() ? 1 : -1);
    this.moved.set(true);
    this.tried.set(false);
    this.step.set(i);
  }
  protected next() {
    this.tried.set(true);
    if (Object.keys(this.errors()).length) return;
    if (this.step() < STEPS.length - 1) this.go(this.step() + 1);
    else this.finish();
  }
  protected backStep() {
    if (this.step() > 0) this.go(this.step() - 1);
  }

  private finish() {
    const c = this.parse(this.maxCustomers());
    const u = this.parse(this.maxUsers());
    const org = createOrganization(
      this.store,
      {
        name: this.name().trim(),
        legalName: this.legalName().trim(),
        countries: this.countries(),
        segments: this.segments(),
        features: this.features(),
        limits: { maxCustomers: c === 'bad' ? null : c, maxUsers: u === 'bad' ? null : u },
        contact: { name: this.adminName().trim(), email: this.adminEmail().trim().toLowerCase(), phone: this.adminPhone().trim() },
        brandColour: this.brandColour(),
      },
      { name: this.adminName(), email: this.adminEmail() },
    );
    this.open.set(false);
    this.toast.show(`${org.name} created`, { body: `Invitation sent to ${org.contact.email}. It shows as Invited until they sign in.` });
    this.created.emit(org);
  }
}
