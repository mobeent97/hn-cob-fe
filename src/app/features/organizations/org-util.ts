import { FEATURES, FeatureDef } from '../../core/access/features';
import { AdminUser, Group, Organization, Permission } from '../../core/data/models';
import { Store } from '../../core/data/store';
import { nowIso } from '../../core/data/mock-db';
import { Tone } from '../../core/data/format';

export const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
/** International format: optional +, digits and spaces. */
export const PHONE_RE = /^\+?[0-9][0-9 ]{6,16}$/;

/** Brand colours for a tenant (data, shown as swatches). No violet or indigo. */
export const ORG_SWATCHES = ['#0a6f96', '#a81c26', '#7a5b00', '#2a6f3e', '#b4441b', '#00695c', '#22313f', '#5f6b75'];

export const LEVELS: Permission[] = [null, 'R', 'RW'];
export const LEVEL_LABEL: Record<string, string> = { none: 'None', R: 'Read', RW: 'Read & write' };
export const levelLabel = (l: Permission) => LEVEL_LABEL[l ?? 'none'];
const RANK: Record<string, number> = { none: 0, R: 1, RW: 2 };
export const rank = (l: Permission) => RANK[l ?? 'none'];

export const AREAS: FeatureDef['area'][] = ['Overview', 'Onboarding', 'Devices', 'Device management', 'Catalogue', 'Administration'];
export const FEATURES_BY_AREA = AREAS.map((area) => ({ area, features: FEATURES.filter((f) => f.area === area) }));

/** Features a partner can be granted (platform-only ones never leave HyperNym). */
export const GRANTABLE = FEATURES.filter((f) => !f.platformOnly);

export const orgTone = (s: Organization['status']): Tone => (s === 'Active' ? 'positive' : s === 'Invited' ? 'info' : 'negative');

/** How many features the organization has at Read or better, out of the ones it could have. */
export function featureCount(o: Organization) {
  const pool = o.kind === 'Platform' ? FEATURES : GRANTABLE;
  return { on: pool.filter((f) => !!o.features[f.key]).length, of: pool.length };
}

// ── Presets for a new partner ─────────────────────────────────
export type PresetId = 'onboarding' | 'readonly' | 'custom';
export const PRESETS: { id: PresetId; label: string; description: string }[] = [
  { id: 'onboarding', label: 'Onboarding partner', description: 'Onboards customers, allocates devices and orders hardware. Reads reports and the catalogue.' },
  { id: 'readonly', label: 'Read-only partner', description: 'Sees customers, devices and reports but changes nothing, apart from managing its own users.' },
  { id: 'custom', label: 'Custom', description: 'Start from nothing and choose each feature.' },
];

export function presetFeatures(id: PresetId, b2c: boolean): Record<string, Permission> {
  const out: Record<string, Permission> = Object.fromEntries(FEATURES.map((f) => [f.key, null]));
  if (id === 'onboarding') {
    for (const k of ['Customers', 'Inventory', 'Hardware orders', 'Users', 'Roles']) out[k] = 'RW';
    if (b2c) out['Consumers'] = 'RW';
    for (const k of ['Dashboard', 'Live tracking', 'Reports', 'Device types', 'Packages', 'Audit']) out[k] = 'R';
  } else if (id === 'readonly') {
    for (const f of GRANTABLE) out[f.key] = 'R';
    if (!b2c) out['Consumers'] = null;
    out['Users'] = 'RW';
    out['Roles'] = 'RW';
  }
  return out;
}

// ── Writes that span tenants (platform screen only) ───────────
const capitalise = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const nextId = (rows: { id: number }[]) => Math.max(0, ...rows.map((r) => r.id)) + 1;

/** Copy a system role template (orgId null) into an organization. */
export function copyTemplate(store: Store, orgId: number, orgName: string, name: string): Group | null {
  const all = store.groups.all();
  const tpl = all.find((g) => g.orgId === null && g.name === name);
  if (!tpl) return null;
  const g: Group = {
    ...tpl,
    id: nextId(all),
    orgId,
    description: name === 'Organization admin' ? `${orgName} administrators` : capitalise(tpl.description.replace(/^Template · /, '')),
    permissions: { ...tpl.permissions },
  };
  store.groups.all.update((xs) => [...xs, g]);
  return g;
}

/** Make sure the organization has an "Organization admin" role; copy the template if not. */
export function ensureAdminRole(store: Store, org: Organization) {
  const has = store.groups.all().some((g) => g.orgId === org.id && g.name === 'Organization admin');
  if (!has) copyTemplate(store, org.id, org.name, 'Organization admin');
}

export function addAdministrator(store: Store, org: Organization, name: string, email: string): AdminUser {
  ensureAdminRole(store, org);
  const all = store.allUsers();
  const u: AdminUser = {
    id: nextId(all),
    orgId: org.id,
    isSuperuser: false,
    name: name.trim(),
    username: email.trim().split('@')[0].toLowerCase(),
    email: email.trim().toLowerCase(),
    groups: ['Organization admin'],
    manager: null,
    status: 'Active',
    type: 'Admin',
    lastLogin: null,
  };
  store.users.all.update((xs) => [...xs, u]);
  return u;
}

export function createOrganization(
  store: Store,
  draft: Omit<Organization, 'id' | 'createdAt' | 'status' | 'kind'>,
  admin: { name: string; email: string },
): Organization {
  const org: Organization = {
    ...draft,
    id: nextId(store.organizations()),
    kind: 'Partner',
    status: 'Invited',
    createdAt: nowIso(),
  };
  store.saveOrganization(org);
  for (const t of ['Organization admin', 'Onboarding agent', 'Viewer']) copyTemplate(store, org.id, org.name, t);
  addAdministrator(store, org, admin.name, admin.email);
  return org;
}

export const emailTaken = (store: Store, email: string) =>
  store.allUsers().some((u) => u.email.toLowerCase() === email.trim().toLowerCase());
