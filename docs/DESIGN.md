# HN COB Portal — Design system

The COB portal uses the **IoTility design system**, so it reads as a sibling of IoTility and FleetPoint:
the same tokens, type, shell, controls, motion, dark mode, charts and maps. The frontend is still built on
sample data (`src/app/core/data/`).

**Source of truth:** the IoTility repo, branch `qpmc`, commit `035c514` (read only). When IoTility changes,
sync the copied files below instead of restyling the COB by hand.

| Copied from IoTility | Lives in the COB at | Changed? |
|---|---|---|
| `shared-ui/src/styles/theme.css`, `controls.css`, `animations.css` | `src/styles/iotility/` | No (header comment only) |
| `fleetpoint/src/app/shared/styles/fields.css` | `src/styles/iotility/fields.css` | Drops its `@reference` line (imported globally) |
| `shared-ui/src/lib/*` (dropdown, tooltip, tab-indicator, skeleton, status-badge, blocking-loader, smooth-height, spotlight-border, motion, plural, charts) | `src/app/shared/iotility-ui/` (imported as `@iotility/shared-ui`) | See its `README.md` |
| `fleetpoint/src/app/shared/maps/maplibre.ts` (part) | `src/app/shared/maps/maplibre.ts` | Only the helpers the COB uses |
| `fleetpoint/src/app/layout/*` | `src/app/core/layout/shell.*` | Rebuilt with the COB's nav and header pieces |
| `iotility/src/app/auth/auth-layout`, `login` | `src/app/features/auth/auth-layout.*`, `auth-form.css` | Look and proportions ported (63% brand panel, full-width form card); COB forms kept, the brand panel shows the MapLibre globe |
| Boot screen in `iotility/src/index.html` | `src/index.html`, `src/main.ts` | HyperNym logo and copy |
| Inter (`public/assets/fonts/`), HyperNym logos, a few FleetPoint icons | `public/assets/` | No |

## Styling stack

- **Tailwind CSS 4** through `@tailwindcss/postcss` (`.postcssrc.json`). No Sass anywhere.
- **Global stylesheet** `src/styles.css`, in IoTility's order: MapLibre CSS, `theme.css` (which imports
  Tailwind — imported once, unlike IoTility), `animations.css`, `controls.css`, `fields.css`, then the COB
  layer in `src/styles/cob/` (`base.css`, `components.css`), the `.color-icon` mask and the thin brand
  scrollbars.
- **Component styles** are `.css` files that start with `@reference "<relative path>/styles.css";` and use
  `@apply` with IoTility tokens. Shared partials are separate files listed in `styleUrls`, never `@import`ed.
  New components get `.css` (the CLI schematic is set to `css`).
- **Dark mode** is the `.dark` class on `<html>`. Use the `dark:` variant; `:host-context(.dark)` only where a
  utility can't reach (gradients, third-party DOM).

## Tokens

All from `theme.css`. Use the Tailwind names in templates and `@apply`, the CSS variables in plain CSS.

| Role | Light | Dark |
|---|---|---|
| Brand | `brand-50…950` (Tailwind purple). Primary = `bg-brand-600 hover:bg-brand-700 text-white` | Accents `brand-300` / `brand-400` |
| Text | `ink` `#1e1b4b` | `white` |
| Secondary text | `muted` | `muted` (`#a29db6`) or `brand-300` |
| Lines | `line` `#e7e2ed` | `dark-line` `#3a3443` |
| Page | `canvas` `#f8f7fa` | `dark-canvas` `#09090f` |
| Cards | `white` | `dark-surface` `#17131f` |
| Status | `success` `#21a179`, `danger` `#d9435f`, `warning` `#e7a92d`, `info` `#3978d4` | same |

- **Tints** use the opacity pattern: `bg-success/10 text-success`, `border-danger/30 bg-danger/5`.
- **Shape:** cards `rounded-2xl`, buttons `rounded-xl`, fields `--control-radius` (0.75rem, FleetPoint's),
  chips and badges `rounded-full`, dialogs `rounded-3xl`.
- **Sizes:** `--control-height` 2.375rem (`-sm` 2rem, `-lg` 2.75rem), header `h-16`, sidebar 14rem → 5rem.
- **Shadows:** `--shadow-card`, `--shadow-card-hover`, `--shadow-popover`, `--shadow-modal` (dark variants built in).
- **Never** raw palette classes (`bg-red-500`), hex or rgb values in components, or text under 10px.
  Data colours (an organisation's `brandColour`) are bound from data and are the exception.

## Theme

- `Theme` (`core/theme/theme.ts`) stores light, dark or system and toggles `.dark` and `color-scheme` on
  `<html>`. Nothing saved means **dark**, as in IoTility. The pre-paint script in `index.html` does the same
  before Angular boots; those are the only two places that touch the theme.
- A switch cross-fades the window once (View Transitions). `Theme.version()` bumps after every switch.
- **Organization brand** (`hn-cob-be/docs/BRANDING_MEDIA_EMAIL.md` 1.4): `BrandTheme` (`core/theme/brand.ts`) sets
  the whole `--color-brand-*` scale inline on `<html>` for a partner user with a brand colour, derived by the pure
  `brandScale()` (`core/theme/brand-scale.ts`, tested against `brand_vectors.json`, shared with the backend). Platform
  users and superusers keep the purple. The last brand is kept in `localStorage['hn-brand']` (colour and scale
  only) for the pre-paint script and the login page. So **never hard-code purple**: every brand use goes through
  `brand-*`. Organization swatches and logos (`<app-org-logo>`) are data, not theme.
- **Canvas and WebGL code** (ECharts, MapLibre) can't read tokens or oklch: resolve colours with
  `cssColor('var(--color-…)')` (`shared/ui/css-color.ts`) and resolve again when the theme changes.

## Type and icons

- **Inter** variable, self-hosted and preloaded, with `font-feature-settings: 'cv05'`. `font-mono` (`.mono`)
  only for IDs, IMEIs, SIM numbers and keys.
- Page title `text-xl font-bold`, subtitle `text-xs text-muted`, card title `text-sm font-semibold`,
  body `text-[13px]`, table cells `text-xs`, labels and meta `text-[11px]`.
- **Icons:** Lucide through `<app-icon name>`, stroke 1.8: 16px inline, 20px in the nav. Add icons in
  `shared/ui/icon.ts`.

## Layout shell

FleetPoint's shell (`core/layout/shell.*`):

- Full-height sidebar on the brand gradient (`#0a0a0f → brand-950 → brand-900`): HyperNym logo (a partner user's
  organization logo and name instead), the tenant
  scope switcher, grouped nav in white / `brand-300`, the active item on a sliding pill
  (`[sharedTabIndicator] tabIndicatorVariant="pill"`) and a hover pill that glides between items.
  It collapses to a 5rem icon rail (remembered) with tooltips.
- White (dark: `dark-surface`) `h-16` header: global search (Ctrl K), environment tag, theme pill,
  notification bell, profile button with the account menu.
- Content on `bg-canvas`; pages pad themselves with `.page` (`p-5 sm:p-6`).
- Below 768px the sidebar is an off-canvas drawer with a blurred backdrop.
- `--shell-sidebar-w` holds the sidebar's current width (14rem, 5rem as a rail, 0 on phones) for elements
  fixed to the viewport, such as bulk action bars, to centre on the content.
- When printing, the shell hides its sidebar and header and lets the page flow (report PDFs).

## Every screen

1. **One question.** Write it in the component's doc comment. The biggest block answers it.
2. **Page header:** `.title-row` → `.title-block` (h1 + `.subline` with the one finding) and `.actions`
   (primary action on the right).
3. **Data from the store.** `inject(Store)` gives signals. Counts and totals are `computed()` from the rows.
4. **States:** loading (`loadState()` from `shared/ui/load-state.ts` on screens that read the API —
   `simulateLoad('key')` only where the module isn't connected yet — with `.skeleton` at the real size),
   empty (a dashed `.empty` box with one sentence and an action), zero (`0`), missing (`.dash` —), error
   (`<app-load-error [message] (retry)>` inside the block that failed).
5. **Entrances:** top-level sections may use `.smooth-reveal` with a small `--reveal-delay` stagger.
6. **Phone (≤640px):** tables get `table stack` (two-line rows; `keep` for the status cell, `hide-sm` for
   secondary cells). KPI tiles fold to two columns.

## Building blocks

| Need | Use |
|---|---|
| Page | `.page` → `.title-row`; `.grid` (12 columns) with `.span-4/6/8/12` |
| Card | `.card` (FleetPoint surface, `--shadow-card`) → `.card-head` (h2 + `.card-sub`) → `.card-body` |
| KPIs | `.kpi-strip` → `.kpi` (FleetPoint stat-card look) → `.kpi-label`, `.kpi-value` (`<span [uiCountUp]="n">`), `.kpi-caption` |
| Filter cards | `.count-cards` → `button.count-card(.selected)` → `.cc-label`, `.cc-value` |
| Buttons | `.btn` (secondary), `.btn.primary` (brand), `.btn.ghost`, `.btn.danger`, `.sm`, `.icon` |
| Segmented | `.seg` → `button(.on)` (FleetPoint `.segmented`) |
| Status | `<span class="pill" [class]="status \| tone">` — positive, negative, warning, info, neutral tints |
| Tabs | `<app-tabs [tabs] [(value)]>` — FleetPoint underline tabs on `[sharedTabIndicator]` |
| Table | `.table-wrap` > `table.table(.stack)` — data-table look: 11px muted headers, 12px cells, brand hover |
| Paging | `<app-pager [total] [size] [(page)] noun>` + `pageOf()` — data-table pagination look |
| Row actions | `<app-menu [items]>` (kebab) or `trigger="custom"` with projected content |
| Dialog / drawer | `<app-dialog [(open)] heading subheading variant="modal\|drawer" width>` — FleetPoint modal, IoTility dialog timings; footer buttons in `<ng-container slot="footer">`, secondary then primary |
| Toast | `inject(Toaster).show(title, { body, tone, action })` |
| Dropdowns | `<app-select>` + `<app-option>` — see below |
| Forms | `.form-grid` → `.field` → `label` (+ `.req`) + `.ui-control` + `.hint` / `.error`; `.check`, `.toggle`, `.input-group`, `.search` |
| Tooltip | `[tooltip]="text"` `[position]` (shared-ui) |
| Number that updates | `[uiCountUp]="value"` (shared-ui) |
| Icons | `<app-icon name>`, or `.color-icon` with `--icon: url(…)` for SVG files |
| Formatting | Pipes `date`, `datetime`, `rel`, `n`, `tone`; `fmtMoney(n, 'AED')`; `downloadCsv()` |

**Why some COB primitives stayed.** `app-select`, `app-dialog`, `app-tabs`, `app-pager` and `app-menu` keep
their COB APIs but are drawn exactly like their IoTility counterparts. `shared-dropdown` has no forms support
(ControlValueAccessor), no keyboard navigation and an absolute panel that tables and dialogs would clip;
`app-modal` isn't a native `<dialog>` (so fixed dropdowns inside it would be clipped) and has no drawer
variant; IoTility's `shared-data-table` is column-config driven and would mean rewriting every table's cells.

## Charts

IoTility's chart components from `@iotility/shared-ui`, always inside `ui-chart-card` (title, subtitle,
legend, `[chart-actions]` slot, loading skeleton, empty and error states):

- `ui-bar-chart` (`[horizontal]` for ranked bars), `ui-line-chart`, `ui-donut-chart`.
- Build inputs with the adapters in `shared/charts/chart-data.ts` (`barChart`, `lineChart`, `hbarChart`,
  `ringSlices`) inside a `computed` that reads `inject(ChartTheme).palette()`, so colours follow the theme.
- One series uses the brand colour; a marked period (the current, incomplete month) a lighter tone of it.

## Maps

MapLibre GL 5 with OpenFreeMap vector styles (`mapLightStyleUrl` / `mapDarkStyleUrl` in every environment
file), through `shared/maps/maplibre.ts`:

- `createIotMap()` picks the style for the current theme, swaps it when `.dark` changes, applies English
  labels and IoTility's fleet palette, and adds the compact attribution. A style swap drops custom layers:
  add yours on `'style.load'`.
- Draw many points as a GeoJSON circle layer (`upsertGeoJson`), frame them with `fitLatLngs` (keeps clear of
  the overlay controls). Vehicle colours follow FleetPoint's legend: moving `success`, idle `warning`,
  offline `muted`.
- Controls, popups and labels are styled after FleetPoint's map overlays; `::ng-deep` is used for
  MapLibre's own DOM only.
- **Sign-in globe** (`features/auth/globe.ts`): MapLibre's globe projection with its own minimal style on the
  same OpenFreeMap vector tiles (`mapVectorTilesUrl`): land and sea in dark brand tones and thin country borders,
  no labels. It always sits on the black brand panel, so it doesn't follow the theme. Its zoom is solved from
  MapLibre's camera so the visible disc fills the stage; a small spinner shows there until the tiles have
  drawn. Customer cities within 150 km merge into one metro marker; vehicles are dots. It turns
  slowly (paused while the user drags or uses the arrow keys, still under reduced motion) and loads MapLibre only
  on screens wide enough to show the panel. It carries no map credit because the portal is internal; a public
  screen would need OpenStreetMap's credit back (`createIotMap(…, { attribution: true })`, the default).

## Motion

IoTility's tokens: `--duration-press` (160ms), `--duration-hover` (150), `--duration-popover` (200),
`--duration-modal` (250), `--duration-dialog-*`, `--ease-out`, `--ease-in-out`, `--ease-drawer`,
`--ease-spring` (a real spring, for popovers), `--ease-overshoot` (toggles and checks only).

- **Buttons:** `scale: 0.97` on press, globally (theme.css).
- **Menus and selects:** spring open from the trigger; the dropdown option highlight glides.
- **Dialogs:** the backdrop fades and blurs, the panel glides up on `--ease-dialog`, exits faster.
- **Drawers:** slide on `--ease-drawer`.
- **Routes:** the incoming page fades in (`router-outlet + *`, theme.css). No router view transitions.
- **Sections:** `.smooth-reveal` on entrance. **Figures:** `[uiCountUp]`. **Charts:** marks morph.
- Never animate keyboard-initiated actions (the Ctrl K search opens instantly). Every animation has a
  `prefers-reduced-motion` fallback.

## z-index scale

| Layer | z-index |
|---|---|
| Page content | 0–30 |
| Sticky header | 50 |
| Dropdowns, popovers, menus, search results | 1700 |
| Phone nav drawer (backdrop 1790) | 1800 |
| Dialogs (native `<dialog>`, top layer) | 2000 |
| Selects opened from a dialog | 2100 |
| Toasts | 3000 |

## Notifications

Contract: `hn-cob-be/docs/PUSH_NOTIFICATIONS.md` (module 5c).

- **Feed:** persisted on the server (`core/api/notifications.api.ts`). `NotificationCenter`
  (`core/notifications/notification-center.ts`) fills the bell's `Store.notifications` (the latest 6) and
  `Store.unread` on sign-in, on window focus, every 60 s while visible (unread count only) and at once on a
  foreground push; its `changes` signal ticks on focus and push. Every write goes through it (read/unread,
  read-all, delete, restore) and the `unread` in each answer updates the badge. No WebSocket or SSE.
- **Page:** `FeedPager` (`core/notifications/feed-pager.ts`) pages the feed with the server's keyset cursor
  (20 per "Load more"), takes the All/Unread counts and the kind counts from the first page, and syncs the
  loaded rows in place (`/notifications/sync/`, a stale token reloads the first page). A row read on the
  Unread tab stays until the filters change. Delete is server-side at once; Undo calls restore.
- **Links** are portal routes (`/audit?request=42`), opened with `router.navigateByUrl` so query parameters
  survive; `routeOf()` (`core/notifications/link.ts`) sends anything else to `/notifications`. Audit honours
  `?request=`.
- **Labels:** `KIND_META` (`core/notifications/notification-feed.ts`) gives each kind its label, icon and
  description; `kindMeta()` falls back to "Other" for a kind this build doesn't know.
- **Bell:** in the header, FleetPoint's bell and panel. The badge pops and the bell swings when the count
  rises. The panel shows the latest 6, refreshed when it opens.
- **Preferences** live in `Store.notificationPrefs` (GET/PUT `/notifications/preferences/`): in the portal,
  email and **Browser** (push) per kind, a digest, quiet hours (no email or push inside them) and a time
  zone. Every user edits their own on **My profile → Notifications** (`/profile?section=notifications`).
- **Browser push** (`PushService`, `core/notifications/push.service.ts`): FCM through the modular Firebase
  SDK, loaded lazily, with the web config from `GET /notifications/push/config/` (never at build time).
  - The worker is `public/firebase-messaging-sw.js` (plain JS, no SDK or CDN), registered with the narrow
    scope `/firebase-cloud-messaging-push-scope` so it never controls page loads. Hosting must serve it as
    `application/javascript`, `Cache-Control: no-cache`, with no SPA fallback.
  - The "Browser notifications" switch asks for permission **only on click** and shows the unsupported,
    iOS-tab (Add to Home Screen, `public/manifest.webmanifest`), blocked, off and on states
    (`pushState()`, `core/notifications/push-state.ts`). On is per user and browser
    (`localStorage['hn.push.on.<userId>']`); at sign-in it re-registers silently, at most daily.
  - Foreground pushes refresh the bell and show an info toast with Open in the focused tab; a clicked
    system notification routes the existing tab in place. Sign-out sends `push_token` to `/auth/logout/`
    and deletes the Firebase token (capped at 1.5 s).
  - Icons: `public/assets/push/` (`icon-192.png`, `icon-512.png`, `badge-72.png`), exported from
    `bell-source.svg`.

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
- **Effective access** comes from the server: `GET /auth/me/access/` (loaded at sign-in, on window focus
  and after role or entitlement saves) fills `Store.access`, and `Access.levels` uses it. The same rule is
  computed locally only while it loads.
- **Organizations** for the switcher, pickers and the Roles caps come from `GET /organizations/options/`
  at sign-in (`SessionLoader`); the Organizations screen upgrades them to full objects.

## Authentication

- **Contract:** `hn-cob-be/docs/AUTH_API.md` (Auth API v1). `environment.apiUrl` ends in `/api/v1`
  (`http://localhost:8000/api/v1` locally).
- **`AuthService`** (`core/auth/auth.service.ts`) holds the signed-in `user()` and
  `isAuthenticated()` signals and makes every auth call: login, refresh, logout, me, forgot
  password, verify code and reset password. Failures become an `AuthError` (`core/auth/auth.models.ts`)
  with the HTTP status, the envelope's `status` code, its `message` (shown to the user as is) and `data`.
- **Tokens:** `TokenStorageService` keeps the JWT access and refresh tokens in `localStorage`. Refresh
  rotates both. *Remember my email* stores only the email, never the password. The reset token
  from the code step lives in `sessionStorage` until the password is changed.
- **Interceptor** (`core/auth/auth.interceptor.ts`): adds `Authorization: Bearer <access>` to calls to
  `environment.apiUrl` only, but not to the public auth endpoints. No cookies are used. A 401 refreshes once,
  and calls that fail at the same time share that refresh, then the request is retried. If the refresh fails,
  the session is cleared and the user goes to `/login?returnUrl=…`.
- **Start-up:** an app initializer calls `restoreSession()` (`GET /auth/me/`) when tokens exist. If that
  fails, the tokens are cleared quietly. Then `SessionLoader.load()` reads `/auth/me/access/`, `/settings/`
  and `/organizations/options/`; the sign-in screen calls it after a login too.
- **Password expired:** a login refused with 403 `4020` stores `data.reset_token` and opens
  `/reset-password`, which says the password has expired.
- **Set-password links** (`/set-password?token=`, public): invitations and admin-triggered resets.
  `POST /auth/set-password/verify/` then `POST /auth/set-password/`, then `/login` with the email filled in
  (navigation state, never the URL).
- **Routes:** `authGuard` protects the shell. `guestGuard` sends a signed-in user away from `/login`.
  `resetTokenGuard` sends visitors without a reset token from `/reset-password` to `/forgot-password`.
- **Connected modules** (typed services in `core/api/<module>.api.ts`, which unwrap the envelope and throw
  `ApiError` with the server's message and `fieldErrors`): Users, Roles, Organizations, Deletion audit,
  Settings and notification preferences, the notification feed and browser push, plus My profile (`/auth/me/…`). Users are identified by email;
  there are no usernames. Every other module's list still starts empty (`TODO(API)` in `store.ts`).
