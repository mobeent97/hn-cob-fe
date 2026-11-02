import { DestroyRef, Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Store } from '../data/store';
import { NotificationKind } from '../data/models';
import { IconName } from '../../shared/ui/icon';
import { Toaster } from '../../shared/ui/toast';

/** How each kind is labelled and drawn, shared by the bell, the page and the preferences. */
export const KIND_META: Record<NotificationKind, { label: string; icon: IconName; description: string }> = {
  order: { label: 'Hardware orders', icon: 'truck', description: 'A customer places an order, or an order ships or is delivered.' },
  onboarding: { label: 'Onboarding', icon: 'building-2', description: 'A customer finishes a section or completes onboarding.' },
  deletion: { label: 'Deletion requests', icon: 'trash', description: 'Someone asks to delete a customer account.' },
  device: { label: 'Devices', icon: 'cpu', description: 'A device is marked faulty, goes offline for 24 h or is returned.' },
  contract: { label: 'Contracts', icon: 'calendar', description: 'A customer contract ends within 60 days.' },
  account: { label: 'Account & security', icon: 'shield', description: 'Policy changes, new sign-ins and password resets.' },
};

/**
 * Design-phase stand-in for a server push (WebSocket / SSE). Delivers a believable event
 * now and then, honouring the user's in-app preferences, and announces it with a toast.
 * Replace `start()` with the real subscription when the Django API exists.
 */
@Injectable({ providedIn: 'root' })
export class NotificationFeed {
  private readonly store = inject(Store);
  private readonly toast = inject(Toaster);
  private readonly router = inject(Router);
  private timer: ReturnType<typeof setTimeout> | null = null;
  private i = 0;

  start(destroyRef: DestroyRef) {
    if (this.timer) return;
    const schedule = (ms: number) => {
      this.timer = setTimeout(() => {
        if (document.visibilityState === 'visible') this.deliver();
        schedule(90_000);
      }, ms);
    };
    schedule(25_000);
    destroyRef.onDestroy(() => {
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
    });
  }

  private deliver() {
    const events = this.samples();
    if (!events.length) return; // e.g. a partner with no customers yet
    const e = events[this.i++ % events.length];
    if (!this.store.notificationPrefs().channels[e.kind].inApp) return;
    const n = this.store.pushNotification(e);
    this.toast.show(n.title, {
      tone: 'info',
      body: n.body,
      action: { label: 'View', run: () => { this.store.markRead([n.id]); this.router.navigate(n.link); } },
    });
  }

  private samples() {
    const s = this.store;
    const c = s.customers().filter((x) => x.status === 'Active');
    const pick = (k: number) => c[k % c.length];
    const stock = s.devices().find((d) => d.status === 'Available');
    if (!c.length) return [];
    return [
      {
        orgId: pick(3).orgId as number | null,
        kind: 'order' as const,
        title: `New hardware order from ${pick(3).company}`,
        body: `${pick(3).contact.firstName} ordered 6 devices for ${pick(3).zone}.`,
        link: ['/orders'],
      },
      {
        orgId: pick(0).orgId as number | null,
        kind: 'onboarding' as const,
        title: `${pick(0).company} uploaded documents`,
        body: 'Trade licence and signed contract are ready for review.',
        link: ['/customers', String(pick(0).id)],
      },
      {
        orgId: (stock?.orgId ?? pick(0).orgId) as number | null,
        kind: 'device' as const,
        title: `${stock?.id ?? 'A device'} hasn't reported for 24 h`,
        body: 'Check its SIM and power. It stays in the customer\'s fleet until marked faulty.',
        link: ['/inventory'],
      },
    ];
  }
}
