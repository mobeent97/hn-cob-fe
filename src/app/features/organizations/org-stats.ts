import { Store } from '../../core/data/store';

export interface OrgStats {
  customers: number;
  consumers: number;
  inService: number;
  devices: number;
  users: number;
  activeUsers: number;
  roles: number;
  orders: number;
}

/** Usage per organization, across every tenant (call inside a computed). */
export function orgStats(store: Store): Map<number, OrgStats> {
  const m = new Map<number, OrgStats>();
  const get = (id: number) => {
    let s = m.get(id);
    if (!s) m.set(id, (s = { customers: 0, consumers: 0, inService: 0, devices: 0, users: 0, activeUsers: 0, roles: 0, orders: 0 }));
    return s;
  };
  for (const o of store.organizations()) get(o.id);
  for (const c of store.customers.all()) get(c.orgId).customers++;
  for (const c of store.consumers.all()) get(c.orgId).consumers++;
  for (const d of store.devices.all()) {
    const s = get(d.orgId);
    s.devices++;
    if (d.status === 'Sold') s.inService++;
  }
  for (const u of store.allUsers()) {
    const s = get(u.orgId);
    s.users++;
    if (u.status === 'Active') s.activeUsers++;
  }
  for (const g of store.groups.all()) if (g.orgId != null) get(g.orgId).roles++;
  for (const o of store.orders.all()) get(o.orgId).orders++;
  return m;
}
