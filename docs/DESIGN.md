# HN COB Portal — Design system

The frontend design is built with sample data first (`src/app/core/data/`). Every screen
follows these rules. They come from the taste skill's app-screen chapter, Emil Kowalski's
design-engineering notes and the transitions.dev motion scale.

## Style: framed sheet

- The sidebar and the 52px top bar share one tinted frame (`--frame`) with no rule between them.
  The page lives on a white sheet, inset 8px from the right and bottom, with 16px corners, a 1px
  edge and no shadow.
- Colour goes on **data, status and the one primary action**, about 3% of the screen. The brand
  blue (`--accent`) is the main chart series, a selected filter, and links. The primary button is
  near-black (`.btn.primary`).
- One typeface, IBM Plex Sans, at 12/14/16/22/28. IBM Plex Mono (`.mono`) is for IDs, IMEIs, SIM
  numbers and keys only.
- The title row has a 22px noun title and one grey subline. The subline states the screen's one
  finding when there is one. There's one primary action on the right.

## Themes

Light and dark come from the same tokens. `:root[data-theme='dark']` in `src/styles/_tokens.scss`
switches to true neutral darks, with no navy and no slate. Elevation comes from lightness, the
accent is lifted to `#4fb0d9`, and the primary button inverts.

- **Switching:** the `Theme` service (`core/theme/theme.ts`) stores light, dark or system and
  applies it to `<html data-theme>`. `index.html` sets the theme before first paint so there's no
  white flash. A switch cross-fades the window once.
- **Colours:** never hard-code a colour that should adapt. On fills use `--on-primary` or
  `--on-accent`; for scrims use `--overlay`; for hovers use `--hover-tint`.
- **Canvas and map code:** read tokens with `getComputedStyle`, and re-read them when
  `Theme.version()` changes. Map tiles use `filter: var(--map-tiles)`.

## Notifications

- **Data:** `Store.notifications` holds the list and `unread` the count. Use `markRead`,
  `markAllRead`, `removeNotifications` and `pushNotification`. Preferences live in
  `Store.notificationPrefs`, with in-app and email settings per kind, a digest and quiet hours.
- **Labels:** `KIND_META` (`core/notifications/notification-feed.ts`) gives each kind its label,
  icon and description.
- **Bell:** in the top bar, with an unread badge that pops when the count rises. The panel shows
  the latest 6.
- **Feed:** `NotificationFeed` stands in for server push until the API exists. It delivers an
  event about every 90 seconds while the tab is visible.

## Organizations and access (multi-tenant)

- **Tenants.** HyperNym is the *Platform* organization. Telcos such as Vodafone Qatar and MTN
  Nigeria are *Partner* organizations that onboard their own B2B (and optionally B2C) customers.
  Customers, consumers, devices, orders, users, roles, audit rows, vouchers, notifications and
  IoT records all carry an `orgId`.
- **Scope.** Partner users always see only their own organization. Platform users pick
  *All organizations* or one tenant in the sidebar switcher (`Store.activeOrgId`).
  `Store.customers()` and the other lists are **already filtered** to the scope, and their
  `update`/`set` only touch rows in scope. `.all()` returns every row; use it only on platform
  screens (Organizations) and to compute new ids. New records take `store.writeOrgId()`.
- **Features.** Every screen belongs to one feature (`core/access/features.ts`). Access per
  feature = the lower of the organization's entitlement and the user's best role. Superusers,
  created with `manage.py createsuperuser`, get read/write everywhere. `platformOnly` features
  are never available to partners.
- **In code:**
  - Inject `Access` and use `can('Customers', 'RW')` or `readOnly('Customers')`.
  - Hide write actions without RW, and say why in a hint when the page is read-only.
  - Show an *Organization* column or filter only when `store.crossTenant() && store.scopeOrgId() == null`.
- **Routing.** `featureGuard` blocks routes without read access, and `/new` and `/edit` routes
  without read/write, and sends the user to `/forbidden`.
- **Design preview.** Account menu → *Preview as another user*, or add `?as=<userId>` to any URL:
  - `1` is the superuser.
  - `101` is Vodafone's admin, `102` a Vodafone onboarding agent, `103` a Vodafone support viewer.
  - `104` is MTN's admin.
  - `2` is HyperNym onboarding staff.

## Every screen

1. **One question.** Write it in the component's doc comment. The biggest block answers it.
2. **Data from the store.** `inject(Store)` gives signals. Counts and totals are `computed()`
   from the rows; never type a total.
3. **States.** Each screen has:
   - **Loading:** `simulateLoad('key')`, with flat grey `.skeleton` bars at the real size.
   - **Empty:** a dashed `.empty` box with one sentence and an action.
   - **Zero:** printed as `0`.
   - **Missing:** a grey `—` (`.dash`).
   - **Error:** inside the block that failed, with a Retry button.
4. **Phone (≤640px).** Tables get `class="table stack"`, which turns them into two-line rows. Mark
   the status cell `keep` and secondary cells `hide-sm`. The KPI strip folds to two columns on its
   own.

## Building blocks

| Need | Use |
|---|---|
| Page wrapper | `<div class="page">` → `.title-row` (`.title-block` h1 + `.subline`, `.actions`) |
| Grid | `.grid` (12 columns, 16px gap) with `.span-4/6/8/12` |
| Card | `.card` → `.card-head` (h2 + `.card-sub`, action on the right) → `.card-body` |
| KPIs | `.kpi-strip` → `.kpi` → `.kpi-label`, `.kpi-value` (wrap the number in `<app-num [value]>`), `.kpi-caption` (name the baseline) |
| Filter cards | `.count-cards` → `button.count-card(.selected)` → `.cc-label`, `.cc-value` |
| Tabs | `<app-tabs [tabs] [(value)]>`: underline tabs with a sliding indicator and counts |
| Toolbar | `.toolbar` → `.left` (`label.search` + `.input`) / `.right` (`.count`, sort `.select`) |
| Table | `.table-wrap` > `table.table.stack`: 12px grey headers, numbers in `td.num` (right-aligned, tabular), `.primary-cell` + `.sub` for two-line cells |
| Paging | `<app-pager [total] [size] [(page)] noun>` + `pageOf(rows, page, size)` |
| Row actions | `<app-menu [items]>`: one kebab per row, in a cell with `(click)="$event.stopPropagation()"` |
| Status | `<span class="pill" [class]="status \| tone">`. Tones: positive, negative, warning, info, neutral |
| Dialog / drawer | `<app-dialog [(open)] heading subheading variant="modal\|drawer" width>`; buttons go in `<ng-container slot="footer">` |
| Toast | `inject(Toaster).show(title, { body, tone, action: { label: 'Undo', run } })` |
| Forms | `.form-grid` (3 columns) → `.field` → `label` + `.input/.select/.textarea` + `.hint/.error`; `.check`, `.toggle`; `.input-group` for dial code + phone |
| Charts | `<app-bar-chart [data]>`, `<app-line-chart [data] [compare]>`, `<app-ring [segments]>` with the legend as a table beside it |
| Icons | `<app-icon name="…">`: Lucide outline, 16px, grey. Add a new icon in `shared/ui/icon.ts` |
| Formatting | Pipes `date`, `datetime`, `rel`, `n`, `tone`; `fmtMoney(n, 'AED')`; `downloadCsv()` |

## Motion

App screens don't perform entrances. Motion is feedback only:

- **Buttons:** press scale 0.97 at 120ms.
- **Menus:** grow from the trigger, 150–220ms, using `--ease-out`.
- **Dialogs:** scale up from 0.96, and close faster.
- **Drawers:** slide in with `--ease-drawer`.
- **Toasts:** rise in and leave faster.
- **Tabs:** the indicator slides.
- **Checkboxes and toggles:** the check draws and the thumb overshoots slightly.
- **Changing data:** figures tween (`<app-num>`) and chart marks morph.
- **Route changes:** the sheet cross-fades through the View Transitions API.

Use the tokens: `--duration-*`, `--ease-out`, `--ease-in-out`, `--ease-drawer`,
`--ease-bounce`. Never animate keyboard-initiated actions such as the ⌘K search.
`prefers-reduced-motion` is handled globally.

## Never

- Gradients, glows or glass.
- An icon in a tinted circle on a KPI or card, or sparklines on KPIs.
- Rainbow charts: one hue per chart, neutrals for the rest.
- Zebra rows, uppercase tracked headers, or left-aligned numbers.
- Emoji, or placeholder names (Acme, John Doe, lorem).
- Violet or indigo.
- Shadows on resting cards.
- Pagination under a short overview list: cap it and add "View all".
