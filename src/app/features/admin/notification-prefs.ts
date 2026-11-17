import {
  ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, input, linkedSignal, signal, untracked, viewChild,
} from '@angular/core';
import { Store } from '../../core/data/store';
import { NotificationKind, NotificationPrefs } from '../../core/data/models';
import { KIND_META } from '../../core/notifications/notification-feed';
import { SettingsApi } from '../../core/api/settings.api';
import { ApiError, errorText } from '../../core/api/api-client';
import { Toaster } from '../../shared/ui/toast';
import { LoadError, loadState } from '../../shared/ui/load-state';
import { Select, SelectOption } from '../../shared/ui/select';

/** Editable form of NotificationPrefs: quiet hours keep their times while switched off. */
interface NotifDraft {
  channels: NotificationPrefs['channels'];
  digest: NotificationPrefs['digest'];
  quietOn: boolean;
  from: string;
  to: string;
  timezone: string;
}
const toDraft = (p: NotificationPrefs): NotifDraft => ({
  channels: structuredClone(p.channels),
  digest: p.digest,
  quietOn: !!p.quiet,
  from: p.quiet?.from ?? '20:00',
  to: p.quiet?.to ?? '07:00',
  timezone: p.timezone,
});
const toPrefs = (d: NotifDraft): NotificationPrefs => ({
  channels: structuredClone(d.channels),
  digest: d.digest,
  quiet: d.quietOn ? { from: d.from, to: d.to } : null,
  timezone: d.timezone,
});
const minutes = (t: string) => {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(t);
  return m ? +m[1] * 60 + +m[2] : null;
};
/** The browser's zone, offered when the stored one is still the default UTC. */
const browserZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

/**
 * Notification preferences — "What reaches me, and when?" Every signed-in user's own row
 * (GET/PUT /notifications/preferences/), shown on My profile so partners can reach it too
 * (SETTINGS_API "Frontend note"). `?section=notifications` (bell → Preferences) scrolls here.
 */
@Component({
  selector: 'app-notification-prefs',
  imports: [Select, SelectOption, LoadError],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './notification-prefs.html',
  styleUrls: ['./settings-layout.css', './notification-prefs.css'],
})
export class NotificationPrefsPanel {
  protected readonly store = inject(Store);
  private readonly api = inject(SettingsApi);
  private readonly toast = inject(Toaster);
  protected readonly state = loadState();
  protected readonly saving = signal(false);

  /** True when the page was opened at this section: scroll to it and mark it briefly. */
  readonly focus = input(false);
  private readonly section = viewChild<ElementRef<HTMLElement>>('section');
  protected readonly flash = signal(false);

  protected readonly kindMeta = KIND_META;
  protected readonly kinds = Object.keys(KIND_META) as NotificationKind[];
  protected readonly notif = linkedSignal(() => toDraft(this.store.notificationPrefs()));
  protected readonly zones = computed(() => {
    const z = new Set(['UTC', browserZone(), this.notif().timezone]);
    return [...z];
  });

  constructor() {
    void this.load();
    effect(() => {
      const el = this.section()?.nativeElement;
      if (!this.focus() || this.state.loading() || !el) return;
      untracked(() => {
        // After the router's own scroll-to-top for this navigation.
        setTimeout(() => {
          const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
          let box = el.parentElement;
          while (box && !/(auto|scroll)/.test(getComputedStyle(box).overflowY)) box = box.parentElement;
          const top = (box ? box.scrollTop + el.getBoundingClientRect().top - box.getBoundingClientRect().top : 0) - 16;
          (box ?? window).scrollTo({ top, behavior: reduced ? 'auto' : 'smooth' });
          this.flash.set(true);
          setTimeout(() => this.flash.set(false), 1400);
        }, 60);
      });
    });
  }

  protected async load() {
    const prefs = await this.state.run(() => this.api.preferences());
    if (prefs) this.store.notificationPrefs.set(prefs);
  }

  protected readonly notifDirty = computed(
    () => JSON.stringify(toPrefs(this.notif())) !== JSON.stringify(this.store.notificationPrefs()),
  );

  protected readonly quietError = computed(() => {
    const d = this.notif();
    if (!d.quietOn) return { from: '', to: '' };
    const f = minutes(d.from);
    const t = minutes(d.to);
    return {
      from: f == null ? 'Enter a time as HH:MM.' : '',
      to: t == null ? 'Enter a time as HH:MM.' : f != null && f === t ? 'Choose an end time different from the start.' : '',
    };
  });
  protected readonly notifValid = computed(() => !this.quietError().from && !this.quietError().to);
  /** The server's refusal (400 4504 / 4019), shown under the panel. */
  protected readonly serverError = signal('');

  /** "20:00 to 07:00 the next day · 11 h" */
  protected readonly quietSpan = computed(() => {
    const d = this.notif();
    const f = minutes(d.from);
    const t = minutes(d.to);
    if (f == null || t == null || f === t) return '';
    const span = (t - f + 1440) % 1440;
    const h = Math.floor(span / 60);
    const m = span % 60;
    return `${d.from} to ${d.to}${t < f ? ' the next day' : ''} · ${h} h${m ? ` ${m} min` : ''}`;
  });

  /** The current choice in one sentence, for the label column. */
  protected readonly notifSummary = computed(() => {
    const d = this.notif();
    const inApp = this.kinds.filter((k) => d.channels[k].inApp).length;
    const email = this.kinds.filter((k) => d.channels[k].email).length;
    const digest = { off: 'one email per event', daily: 'a daily digest at 08:00', weekly: 'a weekly digest on Monday' }[d.digest];
    const parts = [`${inApp} of ${this.kinds.length} kinds in the portal.`, email ? `${email} by email, as ${digest}.` : 'No email.'];
    if (d.quietOn && this.quietSpan()) parts.push(`Quiet ${d.from}–${d.to}.`);
    return parts.join(' ');
  });

  protected readonly emailCount = computed(() => this.kinds.filter((k) => this.notif().channels[k].email).length);

  protected setChannel(k: NotificationKind, ch: 'inApp' | 'email', on: boolean) {
    this.notif.update((d) => ({ ...d, channels: { ...d.channels, [k]: { ...d.channels[k], [ch]: on } } }));
  }
  protected setNotif<K extends keyof NotifDraft>(k: K, v: NotifDraft[K]) {
    this.notif.update((d) => ({ ...d, [k]: v }));
  }
  protected discardNotif() {
    this.serverError.set('');
    this.notif.set(toDraft(this.store.notificationPrefs()));
  }
  protected async saveNotif() {
    if (!this.notifDirty() || !this.notifValid() || this.saving()) return;
    this.saving.set(true);
    this.serverError.set('');
    try {
      const saved = await this.api.savePreferences(toPrefs(this.notif()));
      this.store.notificationPrefs.set(saved);
      this.toast.show('Notification preferences saved', { body: 'New notifications follow these choices from now on.' });
    } catch (err) {
      const fields = err instanceof ApiError ? Object.values(err.fieldErrors).flat() : [];
      this.serverError.set([errorText(err), ...fields].join(' '));
    } finally {
      this.saving.set(false);
    }
  }
}
