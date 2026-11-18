# HN COB Portal — Frontend (`hn-cob-fe`)

Frontend for the **HN Customer Onboarding (COB) Portal**, built with **Angular**.
It consumes the REST API exposed by the Django monolith backend
([`hn-cob-be`](https://github.com/mobeent97/hn-cob-be)).

## Tech Stack

| Concern     | Choice                            |
|-------------|-----------------------------------|
| Framework   | Angular 22 (standalone components, signals) |
| Language    | TypeScript                        |
| Styling     | Tailwind CSS 4 + the IoTility design system (see `docs/DESIGN.md`) |
| Charts, maps | ECharts 6 (IoTility chart components), MapLibre GL 5 |
| HTTP        | Angular `HttpClient` + JWT interceptor |
| Testing     | Vitest (`ng test`)                |

## Project Structure

```
hn-cob-fe/
├── src/
│   ├── app/
│   │   ├── core/
│   │   │   ├── guards/         # authGuard (redirects to /auth when not logged in)
│   │   │   ├── interceptors/   # authInterceptor: Authorization + X-Refresh-Token headers
│   │   │   └── services/       # TokenStorageService, LoggerService
│   │   ├── shared/             # reusable components, pipes, directives
│   │   ├── features/           # lazy-loaded, mirrors backend Django apps
│   │   │   ├── auth/           #   ↔ apps.auth_app
│   │   │   ├── settings/       #   ↔ apps.settings_app
│   │   │   └── notifications/  #   ↔ apps.notifications_app
│   │   ├── app.config.ts       # router + HttpClient with interceptors
│   │   └── app.routes.ts
│   └── environments/           # environment.ts (dev), .staging.ts, .prod.ts
├── angular.json
└── package.json
```

## Branching Strategy

| Branch        | Purpose                                   | Deploys to  |
|---------------|-------------------------------------------|-------------|
| `development` | Integration branch for day-to-day work    | Dev env     |
| `staging`     | Release candidates for QA / UAT           | Staging env |
| `production`  | Stable, released code only                | Production  |

**Flow:** `feature/*` → PR into `development` → merge into `staging` for testing →
merge into `production` for release. Hotfixes branch from `production` (`hotfix/*`)
and are merged back into `production`, `staging`, and `development`.

## Getting Started

Prerequisites: Node.js 22+ (developed on Node 24). Use `npx ng` or install the CLI with `npm i -g @angular/cli`.

```bash
git clone https://github.com/mobeent97/hn-cob-fe.git
cd hn-cob-fe
git checkout development

npm install
npm start       # http://localhost:4200
```

The backend should be running at `http://localhost:8000` (configured in
`src/environments/environment.ts`).

## Builds per Environment

Each configuration swaps in its own file from `src/environments/` (`apiUrl` = backend `BACKEND_URL`).

```bash
npm run build:dev       # environment.ts
npm run build:staging   # environment.staging.ts
npm run build:prod      # environment.prod.ts
npm run build:azure-dev # environment.azure-dev.ts (the Azure dev deployment below)
```

### Azure dev deployment (branch `dev`)

Every push to `dev` runs `.github/workflows/deploy-azure-dev.yml`: it builds with `build:azure-dev` and deploys
to the Azure App Service **app-hypernym-portal-dev** (rg-dev, Free tier), https://app-hypernym-portal-dev.azurewebsites.net.
The backend is `hypernym-portal-be` (hn-cob-be, branch `dev`) at
https://devgateway.hypernymbiz.com/hypernym-portal-be/api/v1, whose `CORS_ALLOWED_ORIGINS` already lists this app.
Merge `development` into `dev` to release; the workflow can also be run by hand from the Actions tab.

> Set the real backend URLs in `environment.staging.ts` and `environment.prod.ts` before deploying,
> and add the frontend origin to the backend's `CORS_ALLOWED_ORIGINS` / `CSRF_TRUSTED_ORIGINS`.

## Common Commands

```bash
ng generate component features/<feature>/<name>
ng test --watch=false
```
