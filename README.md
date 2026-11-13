# SalesPilot AI

SalesPilot AI is a multi-tenant sales platform for small businesses: staff sign in, each business gets its own organization, and everything they manage (customers, products, stock, images) is scoped to that organization. It is built with Next.js (App Router), TypeScript, Tailwind and shadcn/ui, with Firebase Auth and Firestore for identity and data, Cloudinary for images, and Vercel as the deployment target.

## Current scope

Sub-projects 1 to 6 (including 5a orders + cash-on-delivery, 5b payment gateways, 5c couriers & logistics, and 6 voice calls) are implemented; their logic is tested but no UI has been run in a browser. Sub-projects 7 and 8 do not exist yet; their dashboard pages show an explicit "coming later" state, not mock data.

| #   | Sub-project                                                                | State                                |
| --- | -------------------------------------------------------------------------- | ------------------------------------ |
| 1   | Foundation: auth, organizations, roles, security baseline, dashboard shell | implemented; UI not browser-verified |
| 2   | Core data: CRM, products, inventory, Cloudinary uploads, overview KPIs     | implemented; UI not browser-verified |
| 3   | AI agents: Phase 3a tool calling, bounded engine, test console              | implemented; UI not browser-verified |
| 4   | WhatsApp and unified inbox                                                 | implemented; UI not browser-verified |
| 5   | Orders, payments, courier                                                  | 5a orders, 5b payments, 5c couriers implemented; UI not browser-verified |
| 6   | Voice calls (Vapi, Twilio Voice, Mock)                                     | implemented; UI not browser-verified |
| 7   | Follow-ups and automations (n8n)                                           | roadmap                              |
| 8   | Analytics and integrations settings                                        | roadmap                              |

### Orders (5a)

Staff create orders from the Orders page (a draft first, then confirm), and AI agents can draft and confirm cash-on-delivery orders in WhatsApp conversations. A draft holds its stock; the hold expires and a scheduled sweep (`/api/cron/orders/expire`, see [docs/setup/vercel.md](docs/setup/vercel.md)) releases it. Delivery charges and hold times are set under Settings > Orders (owner and admin). The overview shows orders placed today and this month's paid or collected revenue (Asia/Dhaka time). Money is stored as integer paisa, currency BDT. Online payments and couriers are not built yet.

The design is in [docs/superpowers/specs/2026-11-06-foundation-core-data-design.md](docs/superpowers/specs/2026-11-06-foundation-core-data-design.md). What has and has not been verified is in [docs/CHECKLIST.md](docs/CHECKLIST.md).

## Prerequisites

- Node.js 22.x or 24.x (22.12 or newer; `engines` in `package.json`) and npm. Use npm only; the lockfile is `package-lock.json`. Node 20 is not supported: `firebase-admin` 14 requires Node 22, and on Node 20 `jwks-rsa` fails with `ERR_REQUIRE_ESM` when it loads `jose`.
- Java 21 or newer on `PATH`. The Firestore emulator needs it.
- `firebase-tools`. It is a dev dependency, so `npx firebase` works after `npm install`; no global install is required.

## Quick start (local, emulators only)

```bash
npm install
npm run emu      # terminal 1: Firestore (8085) and Auth (9199) emulators, project demo-salespilot
npm run dev      # terminal 2: http://localhost:3000
```

`npm run dev` loads the committed `.env.development`, which points the app at the emulators. You do not need a Firebase project, a Google account or any credentials for this. Register an account on `/register` and you land in the dashboard. Emulator data is lost when `npm run emu` stops.

Image uploads stay disabled ("Media storage not configured", API answers 503) until you add Cloudinary credentials. See [docs/setup/cloudinary.md](docs/setup/cloudinary.md).

## Environment variables

| File               | Committed        | Purpose                                                                              |
| ------------------ | ---------------- | ------------------------------------------------------------------------------------ |
| `.env.example`     | yes              | Every variable the app knows, with a legend. Template only.                          |
| `.env.development` | yes              | Demo values for the emulators (`demo-salespilot`). No secrets. Loaded by `next dev`. |
| `.env.local`       | no (git-ignored) | Your real credentials. Never commit it, never paste it into chat, issues or logs.    |

Two kinds of variable:

- `NEXT_PUBLIC_*` are public. Next.js inlines them into the browser bundle, so never put a secret in one. They are validated in `src/config/env.client.ts`.
- Everything else is server-only and validated in `src/config/env.ts`, which imports `server-only` so a client import fails the build. These two files are the only readers of `process.env`.

Validation errors list variable names, never values. Emulator mode needs both `FIRESTORE_EMULATOR_HOST` and `FIREBASE_AUTH_EMULATOR_HOST`; setting only one, or setting either in production, makes the app refuse to start. Outside the emulators, `FIREBASE_CLIENT_EMAIL` and `FIREBASE_PRIVATE_KEY` are required.

## Scripts

| Script                 | What it does                                                                                                                                                                                                     |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`          | Next.js dev server on port 3000 (uses `.env.development`).                                                                                                                                                       |
| `npm run build`        | Production build.                                                                                                                                                                                                |
| `npm run start`        | Serve the production build.                                                                                                                                                                                      |
| `npm run lint`         | ESLint over the repo.                                                                                                                                                                                            |
| `npm run typecheck`    | `next typegen` then `tsc --noEmit`.                                                                                                                                                                              |
| `npm run test:unit`    | Vitest unit project. No emulator needed.                                                                                                                                                                         |
| `npm run test:int`     | Starts the Firestore and Auth emulators (`firebase emulators:exec`, project `demo-salespilot`), then runs the Vitest integration project and the Firestore rules tests. Needs Java and free ports 8085 and 9199. |
| `npm run emu`          | Starts the emulators for manual work (`npm run dev`).                                                                                                                                                            |
| `npm run check:bundle` | Scans `.next/static` for server-only variable names, their values (when set in the current environment) and PEM private key markers. Exits 1 on any hit. Run `npm run build` first.                              |

Release gate, in order: `typecheck`, `lint`, `test:unit`, `test:int`, `build`, `check:bundle`.

## Architecture

Dependencies point one way:

```text
src/app (routes, UI) -> src/services (business rules) -> src/repositories (Firestore access) -> src/lib (SDK wrappers: firebase, cloudinary, security)
```

- `src/schemas` holds the Zod schemas shared by API handlers and forms. All input is validated with them.
- `src/config` holds env validation, navigation, security headers (CSP, HSTS and friends).
- **Reads and writes.** Server Components and route handlers use the Firebase Admin SDK. Every write goes through a route handler wrapped by `withApi` (`src/lib/api/handler.ts`), which runs, in order, the same-origin (CSRF) check, session authentication, organization membership, the permission check, the rate limit and body validation. Mutations write an audit log entry.
- **Auth and session.** The browser signs in with Firebase Auth and posts the ID token to `/api/auth/session`; the server verifies it and sets an httpOnly `__session` cookie. `src/proxy.ts` (the Next 16 name for middleware) only checks that the cookie exists, to redirect. It is not a security boundary: every protected server call verifies the cookie with the Admin SDK. A cookie Firebase calls invalid (expired, revoked, user disabled) signs the user out; if Firebase Auth cannot be reached the request fails with a 500 or the error page and the cookie is kept, so an outage does not log everyone out. **Sign-out revokes the user's refresh tokens, so it signs the user out on all devices**; the user menu says so.
- **Tenancy and roles.** Every business document carries `organizationId`. Role and organization come from the `organizationMembers` document, never from the client. Roles are `owner`, `admin`, `agent` and `viewer`; the matrix is in `src/lib/security/permissions.ts`.
- **Firestore rules** (`firestore.rules`) let a member read their own organization's documents and deny every client write. Cross-organization access is denied. Rules are tested in `tests/rules/tenancy.rules.test.ts`.
- **Money** is stored as integer minor units (BDT). **Phone numbers** are normalized to E.164 and unique per organization. **Inventory** reserve, release and commit are server-only transactions; manual adjustments go through `/api/inventory/adjust` with a reason.
- **Indexes.** Composite indexes for the customer, product and inventory lists are in `firestore.indexes.json` and must be deployed to any real project (see the Firebase guide).

## Dependency overrides

`package.json` pins `jwks-rsa` to `jose@4.15.9` through `overrides`.

- **Why.** `jwks-rsa` 4 depends on `jose@6`, which is ESM-only. When the package is loaded with `require()` on an older Node, or through a bundling path that does not support `require(esm)`, it fails with `ERR_REQUIRE_ESM`. The override gives `jwks-rsa` the dual-format `jose@4` instead.
- **Is 4.15.9 enough?** `jwks-rsa` only uses `importJWK`, `exportSPKI`, `decodeJwt` and `decodeProtectedHeader`, all present in `jose` 4.15.9, which also contains the fix for CVE-2024-28176.
- **Where it matters.** `jwks-rsa` is reached only through `firebase-admin`'s App Check and phone-number verification code paths. Session cookies and ID tokens (the paths this app uses) verify with `firebase-admin`'s own keys code.
- **Rule.** On any `firebase-admin` or `jwks-rsa` upgrade, re-check which `jose` APIs `jwks-rsa` calls, and try removing the override on Node 22.12 or newer. Remove it if everything still loads (`node -e "require('firebase-admin/auth'); require('jwks-rsa')"`) and the tests pass.

## Real versus mock

Nothing is faked in the UI. Integrations are either real or absent.

| Service                                   | Local development                                                                                                   | Real                                                                                                                        |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Firebase Auth and Firestore               | Emulators (`npm run emu`), project `demo-salespilot`.                                                               | The project is `salespilot-ai-9b1cd` (decided 2026-11-08); setup per [docs/setup/firebase.md](docs/setup/firebase.md) is not done yet. Always pass `--project` to Firebase CLI deploy commands.                                     |
| Cloudinary                                | Not configured until `CLOUDINARY_*` are set; uploads answer 503 and the UI says so. Integration tests mock the SDK. | Set the three variables ([docs/setup/cloudinary.md](docs/setup/cloudinary.md)). Never exercised against a real account yet. |
| OpenAI                                    | Not configured until `OPENAI_API_KEY` is set; agent routes answer 503 and console shows setup notice. Integration tests mock the provider. | Set `OPENAI_API_KEY` ([docs/setup/openai.md](docs/setup/openai.md)). Never exercised against real OpenAI in CI. |
| WhatsApp, Twilio, SSLCommerz, n8n         | Not built. The variables exist in `.env.example` for later sub-projects.                                            | Sub-projects 4 to 7.                                                                                                        |

## Windows notes

The Firestore emulator runs as a Java process that `firebase emulators:exec` can leave running after a failed or interrupted run. A leaked process keeps its ports and the next run fails to bind.

- Before `npm run emu` or `npm run test:int`, check what is listening (PowerShell):

  ```powershell
  Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -in 8085, 9199 }
  ```

- If a port is held by a leftover `java` process from an earlier run, stop that process yourself (for example `Stop-Process -Id <pid>` after confirming the PID with the command above). Nothing in this repo kills processes for you.
- If the default ports are taken by something you cannot stop, copy `firebase.json` to a temporary file with different `firestore.port` and `auth.port`, point both the emulator command (`--config <file>`) and the host variables (`FIRESTORE_EMULATOR_HOST`, `FIREBASE_AUTH_EMULATOR_HOST`) at the new ports, and delete the temporary file afterwards. Do not commit it. If you run `npm run dev` against a non-default Auth port, also set `NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_URL` (for example `http://127.0.0.1:9299`) in `.env.local`; the browser SDK otherwise looks for the Auth emulator on 9199.

## Setup guides

- [Firebase](docs/setup/firebase.md): project, auth providers, service account, rules, indexes, TTL, smoke test.
- [Cloudinary](docs/setup/cloudinary.md): account, keys, what the app signs, known limits, smoke test.
- [OpenAI](docs/setup/openai.md): API key, model options, limits, smoke test.
- [Vercel](docs/setup/vercel.md): import, environment variables, build, preview versus production.
- [Checklist](docs/CHECKLIST.md): sub-project status, verified versus unverified, open decisions.
