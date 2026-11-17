import { Injectable, computed, inject } from '@angular/core';
import { CanActivateChildFn, Router } from '@angular/router';
import { Store } from '../data/store';
import { Permission } from '../data/models';
import { FEATURES, ROUTE_FEATURE } from './features';
import type { AccessReason } from '../auth/auth.models';

const RANK: Record<string, number> = { R: 1, RW: 2 };
const lower = (a: Permission, b: Permission): Permission => (!a || !b ? null : RANK[a] <= RANK[b] ? a : b);
const higher = (a: Permission, b: Permission): Permission => (!a ? b : !b ? a : RANK[a] >= RANK[b] ? a : b);

/**
 * Feature-based access. For each feature:
 *   effective = min(organization entitlement, max over the user's Active roles)
 * Superusers (Django `createsuperuser`) get RW everywhere, in every organization.
 * Platform-only features are never effective for partner users, whatever their roles say.
 *
 * The answer is the server's: `levels` from GET /auth/me/access/ (loaded at sign-in, on window focus
 * and after role or entitlement saves). Until it arrives, the same rule is computed locally from the
 * roles and entitlements the client knows. The backend enforces it per request either way.
 */
@Injectable({ providedIn: 'root' })
export class Access {
  private readonly store = inject(Store);

  readonly user = this.store.currentUser;
  readonly org = this.store.currentOrg;
  readonly isSuperuser = computed(() => this.store.access()?.is_superuser ?? this.user().isSuperuser);
  /** True once GET /auth/me/access/ has answered for this session. */
  readonly fromServer = computed(() => !!this.store.access());

  /** The roles the user holds (by id, from GET /auth/me/). */
  readonly roles = computed(() => this.user().roles);
  /** The server's reason per feature (profile screen), or null while loading. */
  readonly reasons = computed<Record<string, AccessReason> | null>(() => {
    const a = this.store.access();
    return a ? Object.fromEntries(a.features.map((f) => [f.key, f.reason])) : null;
  });

  /** Fallback while /auth/me/access/ loads: the user's Active roles the client has loaded. */
  private readonly localRoles = computed(() => {
    const ids = new Set(this.user().roles.map((r) => r.id));
    return this.store.groups.all().filter((g) => ids.has(g.id) && g.status === 'Active');
  });

  readonly levels = computed<Record<string, Permission>>(() => {
    const server = this.store.access();
    if (server) return Object.fromEntries(FEATURES.map((f) => [f.key, server.levels[f.key] ?? null]));
    const out: Record<string, Permission> = {};
    const org = this.org();
    for (const f of FEATURES) {
      if (this.user().isSuperuser) {
        out[f.key] = 'RW';
        continue;
      }
      if (f.platformOnly && org.kind !== 'Platform') {
        out[f.key] = null;
        continue;
      }
      const fromRoles = this.localRoles().reduce<Permission>((acc, r) => higher(acc, r.permissions[f.key] ?? null), null);
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
