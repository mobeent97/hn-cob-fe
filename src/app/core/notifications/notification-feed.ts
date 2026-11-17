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

// TODO(API): new notifications arrive by server push (WebSocket / SSE) — see docs/ROADMAP.md.
