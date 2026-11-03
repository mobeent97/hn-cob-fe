import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Store } from '../../core/data/store';
import { Icon } from '../../shared/ui/icon';
import { Toaster } from '../../shared/ui/toast';
import { simulateLoad } from '../../shared/ui/loading';
import { Faq, Topic, TOPICS, buildFaqs } from './faqs';

/**
 * Help — "How do I do this in the portal, and who do I ask if it isn't here?"
 * FAQs are grouped by job and filtered as you type; answers quote the live settings
 * (lockout, page size) so they never drift from what the portal actually does.
 */
@Component({
  selector: 'app-help',
  imports: [Icon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './help.html',
  styleUrl: './help.css',
})
export class Help {
  private readonly store = inject(Store);
  private readonly toast = inject(Toaster);
  protected readonly loading = simulateLoad('help');
  protected readonly topics = TOPICS;

  protected readonly q = signal('');
  protected readonly open = signal<Set<string>>(new Set());

  protected readonly faqs = computed(() => buildFaqs(this.store.settings()));
  protected readonly matches = computed(() => {
    const words = this.q().trim().toLowerCase().split(/\s+/).filter(Boolean);
    return this.faqs().filter((f) => words.every((w) => `${f.q} ${f.a.join(' ')}`.toLowerCase().includes(w)));
  });
  protected readonly grouped = computed(() =>
    this.topics.map((t) => ({ ...t, items: this.matches().filter((f) => f.topic === t.id) })).filter((g) => g.items.length),
  );

  constructor() {
    // While searching, open what matches so the answer is visible without another click.
    effect(() => {
      const q = this.q().trim();
      this.open.set(q.length >= 3 ? new Set(this.matches().map((f) => f.id)) : new Set());
    });
  }

  protected isOpen(f: Faq) {
    return this.open().has(f.id);
  }
  protected toggle(f: Faq) {
    this.open.update((s) => {
      const n = new Set(s);
      if (n.has(f.id)) n.delete(f.id);
      else n.add(f.id);
      return n;
    });
  }
  protected topicCount(t: Topic) {
    return this.faqs().filter((f) => f.topic === t).length;
  }

  protected async copyEmail() {
    await navigator.clipboard?.writeText('support@hypernymbiz.com').catch(() => undefined);
    this.toast.show('Email address copied', { tone: 'info' });
  }
}
