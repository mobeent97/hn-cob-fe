import { ChangeDetectionStrategy, Component, computed, inject, model } from '@angular/core';
import { Router } from '@angular/router';
import { Store } from '../data/store';
import { Dialog } from '../../shared/ui/dialog';
import { Toaster } from '../../shared/ui/toast';
import { Icon } from '../../shared/ui/icon';

/**
 * Design-phase tool: sign in as any sample user to see the portal through their role and
 * organization. Remove when real authentication lands (the backend decides who you are).
 */
@Component({
  selector: 'app-preview-as',
  imports: [Dialog, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-dialog [(open)]="open" heading="Preview as another user" subheading="Design preview only: see exactly what each person can open and change." width="560px">
      @for (g of byOrg(); track g.org.id) {
        <section>
          <h3><span class="sw" [style.background]="g.org.brandColour"></span>{{ g.org.name }} <span class="muted">· {{ g.org.kind }}</span></h3>
          <ul>
            @for (u of g.users; track u.id) {
              <li>
                <button [class.current]="u.id === store.currentUser().id" (click)="pick(u.id)">
                  <span class="who"><strong>{{ u.name }}</strong><small>{{ u.isSuperuser ? 'Superuser · created with createsuperuser' : u.groups.join(', ') }}</small></span>
                  @if (u.id === store.currentUser().id) { <span class="pill info">Signed in</span> }
                  @else { <app-icon name="arrow-right" [size]="14" /> }
                </button>
              </li>
            }
          </ul>
        </section>
      }
    </app-dialog>
  `,
  styles: `
    section + section { margin-top: 18px; }
    h3 { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
    .sw { width: 10px; height: 10px; border-radius: 3px; }
    ul { list-style: none; margin: 0; padding: 0; }
    li + li { border-top: 1px solid var(--rule); }
    button { width: 100%; display: flex; align-items: center; gap: 10px; border: 0; background: none; text-align: left; padding: 9px 8px; border-radius: 6px; color: var(--text); }
    button:hover { background: var(--raised); }
    button app-icon { color: var(--muted); margin-left: auto; }
    .pill { margin-left: auto; }
    .who { display: flex; flex-direction: column; }
    .who small { color: var(--muted); font-size: 12px; }
  `,
})
export class PreviewAs {
  protected readonly store = inject(Store);
  private readonly router = inject(Router);
  private readonly toast = inject(Toaster);
  readonly open = model(false);

  protected readonly byOrg = computed(() =>
    this.store.organizations().map((org) => ({
      org,
      users: this.store.allUsers().filter((u) => u.orgId === org.id && u.status === 'Active'),
    })).filter((g) => g.users.length),
  );

  protected pick(id: number) {
    this.store.signInAs(id);
    const u = this.store.currentUser();
    this.open.set(false);
    this.router.navigate(['/dashboard']);
    this.toast.show(`Previewing as ${u.name}`, { tone: 'info', body: `${this.store.currentOrg().name} · ${u.isSuperuser ? 'Superuser' : u.groups.join(', ')}` });
  }
}
