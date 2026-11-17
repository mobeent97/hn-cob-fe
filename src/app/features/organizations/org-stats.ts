import { Organization } from '../../core/data/models';

export interface OrgStats {
  customers: number;
  consumers: number;
  inService: number;
  devices: number;
  users: number;
  activeUsers: number;
  invitedUsers: number;
  seatsUsed: number;
  roles: number;
  orders: number;
}

/**
 * Usage of one organization, from its `usage` (GET /organizations/ and /organizations/{id}/).
 * Customers, consumers, devices and orders stay 0 until those modules exist (ORGANIZATIONS_API).
 */
export function statsOf(o: Organization | null | undefined): OrgStats {
  const u = o?.usage;
  return {
    customers: u?.customers ?? 0,
    consumers: u?.consumers ?? 0,
    inService: u?.devicesInService ?? 0,
    devices: u?.devices ?? 0,
    users: u?.users ?? 0,
    activeUsers: u?.activeUsers ?? 0,
    invitedUsers: u?.invitedUsers ?? 0,
    seatsUsed: u?.seatsUsed ?? 0,
    roles: u?.roles ?? 0,
    orders: u?.orders ?? 0,
  };
}
