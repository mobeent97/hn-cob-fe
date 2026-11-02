# HN COB Portal — Frontend (`hn-cob-fe`)

Frontend for the **HN Customer Onboarding (COB) Portal**, built with **Angular**.
It consumes the REST API exposed by the Django monolith backend
([`hn-cob-be`](https://github.com/mobeent97/hn-cob-be)).

## Tech Stack

| Concern     | Choice                            |
|-------------|-----------------------------------|
| Framework   | Angular (latest, standalone components) |
| Language    | TypeScript                        |
| Styling     | SCSS                              |
| HTTP        | Angular `HttpClient` + JWT interceptor |
| Testing     | Angular default test runner       |

## Project Structure

```
hn-cob-fe/
├── src/
│   ├── app/
│   │   ├── core/          # auth, interceptors, guards, singleton services
│   │   ├── shared/        # reusable components, pipes, directives
│   │   └── features/
│   │       ├── auth/        # login / registration
│   │       ├── onboarding/  # multi-step onboarding flow
│   │       ├── documents/   # document upload
│   │       └── dashboard/   # customer & admin dashboards
│   └── environments/      # environment.ts, .staging.ts, .prod.ts
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

Prerequisites: Node.js LTS and Angular CLI (`npm i -g @angular/cli`).

```bash
git clone https://github.com/mobeent97/hn-cob-fe.git
cd hn-cob-fe
git checkout development

npm install
ng serve        # http://localhost:4200
```

The backend should be running at `http://localhost:8000` (configured in
`src/environments/environment.ts`).

## Builds per Environment

```bash
ng build --configuration development
ng build --configuration staging
ng build --configuration production
```

## Common Commands

```bash
ng generate component features/<feature>/<name>
ng test
ng lint
```
