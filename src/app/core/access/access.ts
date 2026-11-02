import { Injectable, computed, inject } from '@angular/core';
import { CanActivateChildFn, Router } from '@angular/router';
import { Store } from '../data/store';
import { Permission } from '../data/models';
import { FEATURES, ROUTE_FEATURE } from './features';

const RANK: Record<string, number> = { R: 1, RW: 2 };
const lower = (a: Permission, b: Permission): Permission => (!a || !b ? null : RANK[a] <= RANK[b] ? a : b);
const higher = (a: Permission, b: Permission): Permission => (!a ? b : !b ? a : RANK[a] >= RANK[b] ? a : b);

/**
 * Feature-based access. For each feature:
 *   effective = min(organization entitlement, max over the user's roles)
 * Superusers (Django `createsuperuser`) get RW everywhere, in every organization.
 * Platform-only features are never effective for partner users, whatever their roles say.
 * The backend enforces the same rule per request; the UI only hides what the API would refuse.
 */
@Injectable({ providedIn: 'root' })
export class Access {
  private readonly store = inject(Store);

  readonly user = this.store.currentUser;
  readonly org = this.store.currentOrg;
  readonly isSuperuser = computed(() => this.user().isSuperuser);

  /** The user's roles, matched by name inside their own organization. */
  readonly roles = computed(() => {
    const u = this.user();
    return this.store.groups.all().filter((g) => g.orgId === u.orgId && u.groups.includes(g.name) && g.status === 'Active');
  });

  readonly levels = computed<Record<string, Permission>>(() => {
    const out: Record<string, Permission> = {};
    const org = this.org();
    for (const f of FEATURES) {
      if (this.isSuperuser()) {
        out[f.key] = 'RW';
        continue;
      }
      if (f.platformOnly && org.kind !== 'Platform') {
        out[f.key] = null;
        continue;
      }
      const fromRoles = this.roles().reduce<Permission>((acc, r) => higher(acc, r.permissions[f.key] ?? null), null);
      out[f.key] = lower(org.features[f.key] ?? null, fromRoles);
    }
    return out;
  });

  level(feature: string): Permission {
    return this.levels()[feature] ?? null;
  }
  can(feature: string, need: 'R' | 'RW' = 'R') {
    const l = this.level(feature);
    return !!l && RANK[l] >= RANK[need];
  }
  /** Read-only on a feature the user can see: screens disable their write actions. */
  readOnly(feature: string) {
    return this.level(feature) === 'R';
  }

  /** Feature for a URL, by its first path segment. */
  featureForUrl(url: string): string | null {
    const seg = url.split('?')[0].split('/').filter(Boolean)[0] ?? '';
    return ROUTE_FEATURE[seg] ?? null;
  }
}

/** Blocks screens the user has no access to; write-only routes (new/edit) need RW. */
export const featureGuard: CanActivateChildFn = (_route, state) => {
  const access = inject(Access);
  const router = inject(Router);
  const feature = access.featureForUrl(state.url);
  if (!feature) return true;
  const writeRoute = /\/(new|edit)(\/|$|\?)/.test(state.url);
  if (access.can(feature, writeRoute ? 'RW' : 'R')) return true;
  return router.createUrlTree(['/forbidden'], { queryParams: { feature, from: state.url.split('?')[0] } });
};
