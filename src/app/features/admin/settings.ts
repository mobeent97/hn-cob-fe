import {
  ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, input, linkedSignal, signal, untracked, viewChild,
} from '@angular/core';
import { Store } from '../../core/data/store';
import { NotificationKind, NotificationPrefs, PortalSettings } from '../../core/data/models';
import { KIND_META } from '../../core/notifications/notification-feed';
import { Toaster } from '../../shared/ui/toast';
import { simulateLoad } from '../../shared/ui/loading';
import { ReadOnlyNote, writeAccess } from '../tenancy';
import { Select, SelectOption } from '../../shared/ui/select';

type Section = keyof PortalSettings;
type Ranges<T> = Partial<Record<keyof T, [number, number]>>;

const RANGES: { password: Ranges<PortalSettings['password']>; login: Ranges<PortalSettings['login']> } = {
  password: { minLength: [8, 64], expiryDays: [0, 365], history: [0, 24] },
  login: { sessionMinutes: [5, 480], maxAttempts: [3, 10], lockMinutes: [1, 1440] },
};

/** Editable form of NotificationPrefs: quiet hours keep their times while switched off. */
interface NotifDraft {
  channels: NotificationPrefs['channels'];
  digest: NotificationPrefs['digest'];
  quietOn: boolean;
  from: string;
  to: string;
}
const toDraft = (p: NotificationPrefs): NotifDraft => ({
  channels: structuredClone(p.channels),
  digest: p.digest,
  quietOn: !!p.quiet,
  from: p.quiet?.from ?? '20:00',
  to: p.quiet?.to ?? '07:00',
});
const toPrefs = (d: NotifDraft): NotificationPrefs => ({
  channels: structuredClone(d.channels),
  digest: d.digest,
  quiet: d.quietOn ? { from: d.from, to: d.to } : null,
});
const minutes = (t: string) => {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(t);
  return m ? +m[1] * 60 + +m[2] : null;
};

/**
 * Settings — "What rules apply to every portal account, and are they what we want?"
 * Two-column settings rows (taste app-screens §8.2): label and current values on the left, the panel
 * on the right with its own Save. Legacy fix: yes/no rules are real booleans, not 'Yes'/'No' strings,
 * and page size feeds every list through store.settings.
 */
@Component({
  selector: 'app-settings',
  imports: [Select, SelectOption, ReadOnlyNote],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './settings.html',
  styleUrl: './settings.scss',
})
export class Settings {
  protected readonly store = inject(Store);
  /** Settings RW gates every write action on this screen. */
  protected readonly w = writeAccess('Settings');
  private readonly toast = inject(Toaster);
  protected readonly loading = simulateLoad('settings');
  protected readonly pageSizes = [10, 25, 50];

  /** ?section=notifications (bell → Preferences) scrolls that section into view and briefly marks it. */
  readonly section = input<string | undefined>(undefined);
  private readonly notifSection = viewChild<ElementRef<HTMLElement>>('notifSection');
  protected readonly flash = signal(false);

  constructor() {
    effect(() => {
      const el = this.notifSection()?.nativeElement;
      if (this.section() !== 'notifications' || this.loading() || !el) return;
      untracked(() => {
        // After the router's own scroll-to-top for this navigation.
        setTimeout(() => {
          const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
          // Scroll only the sheet; scrollIntoView would also nudge the fixed frame around it.
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

  protected readonly password = linkedSignal(() => ({ ...this.store.settings().password }));
  protected readonly pagination = linkedSignal(() => ({ ...this.store.settings().pagination }));
  protected readonly login = linkedSignal(() => ({ ...this.store.settings().login }));

  private readonly drafts = { password: this.password, pagination: this.pagination, login: this.login };

  protected readonly dirty = computed(() => {
    const s = this.store.settings();
    const same = (a: object, b: object) => JSON.stringify(a) === JSON.stringify(b);
    return { password: !same(s.password, this.password()), pagination: !same(s.pagination, this.pagination()), login: !same(s.login, this.login()) };
  });

  protected readonly errors = computed(() => {
    const out: Record<string, string> = {};
    const check = <T extends object>(sec: 'password' | 'login', draft: T) => {
      for (const [k, [lo, hi]] of Object.entries(RANGES[sec]) as [string, [number, number]][]) {
        const v = (draft as Record<string, number>)[k];
        if (v == null || !Number.isInteger(v) || v < lo || v > hi) out[`${sec}.${k}`] = `Enter a whole number from ${lo} to ${hi}.`;
      }
    };
    check('password', this.password());
    check('login', this.login());
    return out;
  });
  protected err(key: string) {
    return this.errors()[key];
  }
  private sectionValid(sec: Section) {
    return !Object.keys(this.errors()).some((k) => k.startsWith(sec + '.'));
  }

  protected num(e: Event): number {
    const v = (e.target as HTMLInputElement).value;
    return v === '' ? (null as unknown as number) : +v;
  }
  protected setPassword<K extends keyof PortalSettings['password']>(k: K, v: PortalSettings['password'][K]) {
    this.password.update((d) => ({ ...d, [k]: v }));
  }
  protected setLogin<K extends keyof PortalSettings['login']>(k: K, v: PortalSettings['login'][K]) {
    this.login.update((d) => ({ ...d, [k]: v }));
  }

  /** The rules as a person will read them on the change-password screen. */
  protected readonly rules = computed(() => {
    const p = this.password();
    return [
      `At least ${p.minLength || '—'} characters`,
      ...(p.requireNumber ? ['At least one number'] : []),
      ...(p.requireSymbol ? ['At least one symbol, such as ! or #'] : []),
      p.history ? `Different from the last ${p.history} passwords` : 'May reuse a previous password',
      p.expiryDays ? `Must be changed every ${p.expiryDays} days` : 'Never expires',
    ];
  });

  protected pages(n: number) {
    return Math.max(1, Math.ceil(n / this.pagination().pageSize));
  }

  protected discard(sec: Section) {
    const s = this.store.settings();
    if (sec === 'password') this.password.set({ ...s.password });
    if (sec === 'pagination') this.pagination.set({ ...s.pagination });
    if (sec === 'login') this.login.set({ ...s.login });
  }

  protected save(sec: Section) {
    if (!this.dirty()[sec] || !this.sectionValid(sec)) return;
    const value = this.drafts[sec]();
    this.store.settings.update((s) => ({ ...s, [sec]: { ...value } }));
    const copy: Record<Section, [string, string]> = {
      password: ['Password policy saved', 'New rules apply the next time someone sets a password.'],
      pagination: ['Page size saved', `Lists now show ${this.pagination().pageSize} rows per page.`],
      login: ['Sign-in settings saved', 'Session changes apply at the next sign-in.'],
    };
    this.toast.show(copy[sec][0], { body: copy[sec][1] });
  }

  // ── Notifications ──────────────────────────────────────────
  protected readonly kindMeta = KIND_META;
  protected readonly kinds = Object.keys(KIND_META) as NotificationKind[];
  protected readonly notif = linkedSignal(() => toDraft(this.store.notificationPrefs()));

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
    const parts = [
      `${inApp} of ${this.kinds.length} kinds in the portal.`,
      email ? `${email} by email, as ${digest}.` : 'No email.',
    ];
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
    this.notif.set(toDraft(this.store.notificationPrefs()));
  }
  protected saveNotif() {
    if (!this.notifDirty() || !this.notifValid()) return;
    this.store.notificationPrefs.set(toPrefs(this.notif()));
    this.toast.show('Notification preferences saved', { body: 'New notifications follow these choices from now on.' });
  }
}
