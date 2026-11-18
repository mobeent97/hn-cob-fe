import { NotificationKind } from '../data/models';
import { IconName } from '../../shared/ui/icon';

/** How each kind is labelled and drawn, shared by the bell, the page and the preferences. */
export const KIND_META: Record<NotificationKind, { label: string; icon: IconName; description: string }> = {
  order: { label: 'Hardware orders', icon: 'truck', description: 'A customer places an order, or an order ships or is delivered.' },
  onboarding: { label: 'Onboarding', icon: 'building-2', description: 'A customer finishes a section or completes onboarding.' },
  deletion: { label: 'Deletion requests', icon: 'trash', description: 'Someone asks to delete a customer account.' },
  device: { label: 'Devices', icon: 'cpu', description: 'A device is marked faulty, goes offline for 24 h or is returned.' },
  contract: { label: 'Contracts', icon: 'calendar', description: 'A customer contract ends within 60 days.' },
  account: { label: 'Account & security', icon: 'shield', description: 'Policy changes, new sign-ins and password resets.' },
};

const OTHER = { label: 'Other', icon: 'bell' as IconName, description: '' };

/** KIND_META for a kind this build may not know yet (the server can add kinds before the portal does). */
export function kindMeta(kind: string): { label: string; icon: IconName; description: string } {
  return (KIND_META as Record<string, (typeof KIND_META)[NotificationKind]>)[kind] ?? OTHER;
}
