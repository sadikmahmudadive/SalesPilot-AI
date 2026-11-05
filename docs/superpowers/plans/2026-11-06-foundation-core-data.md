# SalesPilot AI Foundation + Core Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A secure, organization-scoped Next.js app where a user can register, log in, manage customers and products, adjust stock transactionally, and upload images to Cloudinary, with tenant isolation proven by tests.

**Architecture:** Single npm package, Next.js App Router. Layers flow `app/ → services/ → repositories/ → lib/`; `schemas/` (Zod) is shared by API and forms; `config/env.ts` is the only reader of `process.env`. Browser sign-in uses Firebase Auth; the server exchanges the ID token for an httpOnly session cookie and does every write through the Admin SDK. Firestore rules give org members read-only client access.

**Tech Stack:** Next.js (latest stable), React, TypeScript strict, Tailwind, shadcn/ui, Lucide, React Hook Form, Zod, TanStack Query, Firebase Auth + Firestore + Admin SDK, Cloudinary SDK, Vitest, `@firebase/rules-unit-testing`, Firebase emulators.

**Spec:** `docs/superpowers/specs/2026-11-06-foundation-core-data-design.md`

## Global Constraints

- npm only (no pnpm/yarn); single package; `src/` layout; TypeScript `strict` plus `noUncheckedIndexedAccess`.
- `process.env` is read only in `src/config/env.ts`. Server-only modules import `server-only`. No secret in any `NEXT_PUBLIC_*` variable or client bundle.
- Roles: `owner | admin | agent | viewer`. Money = integer minor units, currency `BDT`.
- Every business doc has `organizationId`. All client writes to Firestore are denied by rules; all writes go through route handlers using the Admin SDK with Zod validation, permission check, rate limit, audit log.
- Typed errors map to HTTP: Validation 400, Unauthenticated 401, Forbidden 403, NotFound 404, Conflict 409, InsufficientStock 409, RateLimited 429, IntegrationNotConfigured 503. Error responses are `{ error: { code, message, requestId } }` with no stack or secret.
- Unconfigured integrations return 503 / "not configured" UI; nothing is faked as real.
- Emulator ports (avoid Windows leak collisions): Firestore `8085`, Auth `9199`, UI disabled; project id `demo-salespilot`. Before any emulator run check `netstat -ano | findstr "8085 9199"`; if busy, stop and ask the user to free them (do not kill processes).
- Next.js: use the request-interception file convention of the scaffolded version (`middleware.ts`, or `proxy.ts` if that version renamed it); check its official docs before writing Task 7.
- Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Never commit `.env.local`.
- Test commands: unit `npm run test:unit`; integration/rules `npm run test:int` (wraps `firebase emulators:exec`). Files `*.test.ts` are unit, `*.int.test.ts` and `tests/rules/*.rules.test.ts` are integration.

## Review Focus

1. Bangladeshi local phone `01712-345678` must normalize to `+8801712345678`; `abc`, empty, and 5-digit input are rejected (Task 15).
2. Two simultaneous creates of the same phone in one org yield exactly one customer and one `Conflict` (Task 15).
3. Reservation quantity `0`, negative, or fractional is rejected; releasing more than reserved is rejected; counts never go negative (Task 18).
4. Double-submitted registration (same uid twice) creates one organization, not two; a tampered or expired session cookie gives 401, not 500 (Tasks 7–8).
5. Bangla and whitespace-only names: `"   "` is rejected; searching by a Bangla name prefix returns the customer; an invalid or stale pagination cursor returns 400, not a crash (Tasks 15–16).

---

### Task 1: Scaffold, tooling, and git

**Files:**
- Create: project via `create-next-app`, `vitest.config.ts`, `.prettierrc`, `.env.example`, `.gitignore` additions, `src/lib/smoke.test.ts` (deleted after pass)
- Modify: `package.json` scripts

**Interfaces:**
- Produces: npm scripts `dev`, `build`, `lint`, `typecheck` (`tsc --noEmit`), `test:unit`, `test:int`, `emu` (`firebase emulators:start --only firestore,auth --project demo-salespilot`).

- [ ] **Step 1:** In `F:\Code\Web Dev\SalesPilot AI`, run `git init`, then `npx create-next-app@latest . --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm` (keep existing `docs/`).
- [ ] **Step 2:** `npm i zod firebase firebase-admin cloudinary server-only @tanstack/react-query react-hook-form @hookform/resolvers lucide-react next-themes`; `npm i -D vitest @firebase/rules-unit-testing prettier firebase-tools`; `npx shadcn@latest init` (default neutral, CSS variables) and add `button input label card dialog dropdown-menu table badge sonner select textarea tabs skeleton sheet separator avatar`.
- [ ] **Step 3:** Set `tsconfig` `noUncheckedIndexedAccess: true`. Add `vitest.config.ts` with two projects, `unit` (`src/**/*.test.ts`, excluding `*.int.test.ts`) and `integration` (`src/**/*.int.test.ts`, `tests/rules/**/*.rules.test.ts`, `testTimeout: 20000`, `fileParallelism: false`), alias `@` → `src`, and a `server-only` alias to an empty stub for tests. Add the scripts listed above; `test:int` is `firebase emulators:exec --only firestore,auth --project demo-salespilot "vitest run --project integration"`.
- [ ] **Step 4:** Write `.env.example` with every variable from the brief grouped and commented (required vs optional, public vs secret), plus `NEXT_PUBLIC_USE_EMULATORS`, `FIRESTORE_EMULATOR_HOST`, `FIREBASE_AUTH_EMULATOR_HOST`. Confirm `.gitignore` ignores `.env*` except `.env.example`.
- [ ] **Step 5:** Add a throwaway `expect(1+1).toBe(2)` test; run `npm run test:unit` → PASS; delete it. Run `npm run typecheck && npm run lint && npm run build` → all succeed.
- [ ] **Step 6:** Commit `chore: scaffold Next.js app with tooling`.

### Task 2: Environment validation

**Files:** Create `src/config/env.ts`, `src/config/env.test.ts`

**Interfaces:**
- Produces: `getClientEnv(): ClientEnv`, `getServerEnv(): ServerEnv` (memoized; throws `Error` listing every invalid variable name, never values), `isConfigured(integration: 'cloudinary' | 'whatsapp' | 'openai' | 'twilio' | 'sslcommerz' | 'n8n'): boolean`, `isEmulator(): boolean`.

- [ ] **Step 1: Tests** in `env.test.ts` (reset memo between cases): missing `FIREBASE_PROJECT_ID` throws with that name in the message and no secret value; with emulator hosts set, `FIREBASE_CLIENT_EMAIL`/`FIREBASE_PRIVATE_KEY` are not required; without emulator they are; `FIREBASE_PRIVATE_KEY` with literal `\n` is converted to real newlines; `isConfigured('cloudinary')` is false until all three Cloudinary vars exist, true after; `getClientEnv()` result contains no key from the server schema.
- [ ] **Step 2:** Run `npx vitest run --project unit src/config/env.test.ts` → FAIL.
- [ ] **Step 3:** Implement with separate Zod schemas; optional groups parsed leniently. Import `server-only` only in the server half (export server functions from the same file guarded so the test alias works).
- [ ] **Step 4:** Run → PASS. Commit `feat(config): validated env with integration flags`.

### Task 3: Permission matrix

**Files:** Create `src/lib/security/permissions.ts`, `permissions.test.ts`

**Interfaces:**
- Produces: `type Role = 'owner'|'admin'|'agent'|'viewer'`; `type Permission = 'org:manage'|'members:manage'|'customers:read'|'customers:write'|'products:read'|'products:write'|'inventory:read'|'inventory:write'|'uploads:customers'|'uploads:products'|'uploads:org'|'audit:read'`; `can(role: Role | null | undefined, p: Permission): boolean`.

- [ ] **Step 1: Tests** — table-driven: owner/admin have all; agent has `customers:read|write`, `products:read`, `inventory:read`, `uploads:customers` and nothing else; viewer has only `*:read` (customers, products, inventory); `can(null, any)` and `can('hacker' as Role, any)` are false.
- [ ] **Step 2–4:** Run FAIL → implement as a `Record<Role, ReadonlySet<Permission>>` → PASS. Commit `feat(security): role permission matrix`.

### Task 4: Errors, logger, API envelope

**Files:** Create `src/lib/errors.ts`, `src/lib/logger.ts`, `src/lib/api/respond.ts` and a test beside each.

**Interfaces:**
- Produces: error classes `ValidationError(details?)`, `UnauthenticatedError`, `ForbiddenError`, `NotFoundError`, `ConflictError`, `InsufficientStockError`, `RateLimitedError(retryAfterSec)`, `IntegrationNotConfiguredError(name)`, all extending `AppError { code: string; status: number }`; `logger.{info,warn,error}(msg: string, ctx?: object)` emitting one-line JSON with `redact()` applied; `redact(obj: unknown): unknown`; `toErrorResponse(err: unknown, requestId: string): Response` (unknown errors → 500 generic message, logged with full detail server-side only).

- [ ] **Step 1: Tests** — each error maps to its status from Global Constraints; `toErrorResponse(new Error('secret sk-123'))` body contains neither the message nor a stack and has status 500 and a `requestId`; `redact` masks values under keys matching `/key|token|secret|password|authorization|cookie|private/i` at any depth and masks phone-like strings in a `phone` key; `RateLimitedError` response sets `Retry-After`.
- [ ] **Step 2–4:** FAIL → implement → PASS. Commit `feat: typed errors, redacting logger, error envelope`.

### Task 5: Firebase SDKs and emulator config

**Files:** Create `src/lib/firebase/admin.ts`, `src/lib/firebase/client.ts`, `firebase.json`, `.firebaserc`, `.env.development`; test `src/lib/firebase/admin.int.test.ts`

**Interfaces:**
- Consumes: `getServerEnv`, `isEmulator` (Task 2).
- Produces: `adminAuth(): Auth`, `adminDb(): Firestore` (lazy singletons; `ignoreUndefinedProperties: true`); client `getFirebaseAuth(): Auth` (connects to the Auth emulator when `NEXT_PUBLIC_USE_EMULATORS === 'true'`).

- [ ] **Step 1:** `firebase.json` with firestore rules `firestore.rules`, indexes `firestore.indexes.json`, emulators firestore 8085, auth 9199, `ui.enabled:false`. `.firebaserc` default `demo-salespilot`. `.env.development` holds emulator hosts and public demo config (no secrets).
- [ ] **Step 2: Integration test** — `adminDb().collection('smoke').doc('a').set({x:1})` then read back equals `{x:1}`; `adminAuth().createUser` returns a uid.
- [ ] **Step 3:** Implement; create placeholder allow-nothing `firestore.rules` and `{ "indexes": [], "fieldOverrides": [] }`. Run `npm run test:int` → PASS. Commit `feat(firebase): admin/client init with emulator support`.

### Task 6: Rate limiter and audit log

**Files:** Create `src/lib/security/rate-limit.ts`, `src/lib/security/audit.ts`, `*.int.test.ts` for each.

**Interfaces:**
- Consumes: `adminDb`.
- Produces: `checkRateLimit(key: string, opts: { limit: number; windowSec: number }): Promise<{ allowed: boolean; remaining: number; resetAt: number }>` (fixed window, doc `rateLimits/{sha256(key)}_{windowStart}` incremented in a transaction); `assertRateLimit(key, opts)` throws `RateLimitedError`; `writeAudit(entry: { organizationId: string; actorUid: string; action: string; resource: string; resourceId: string; before?: unknown; after?: unknown }): Promise<void>` writing `auditLogs` with server timestamp and secrets redacted.

- [ ] **Step 1: Tests** — with limit 3: calls 1–3 allowed, 4th `allowed:false`; 20 concurrent calls with limit 5 allow exactly 5; different keys are independent; new window resets; `writeAudit` doc contains `action`, `organizationId`, timestamp, and a `before` containing `{ token: 'x' }` is stored as masked.
- [ ] **Step 2–4:** FAIL → implement → PASS (`npm run test:int`). Commit `feat(security): firestore rate limiter and audit writer`.

### Task 7: Session auth and route interception

**Files:** Create `src/lib/auth/session.ts`, `src/app/api/auth/session/route.ts`, `middleware.ts` (or `proxy.ts`, see constraints), tests `session.int.test.ts`, `route.int.test.ts`.

**Interfaces:**
- Consumes: `adminAuth`, `assertRateLimit`, errors.
- Produces: `createSessionCookie(idToken: string): Promise<{ value: string; maxAgeSec: number }>` (rejects ID tokens older than 5 min); `getCurrentUser(): Promise<{ uid: string; email: string | null } | null>` (reads cookie via `next/headers`, `verifySessionCookie(value, true)`, returns null on any failure); `requireUser(): Promise<{uid; email}>` throws `UnauthenticatedError`. Cookie name `__session`, httpOnly, secure outside dev, sameSite lax, path `/`. `POST /api/auth/session {idToken}` sets it (rate limit 10/min per IP), `DELETE` clears it and revokes refresh tokens.

- [ ] **Step 1: Tests** — valid emulator ID token → 200 and `Set-Cookie` contains `HttpOnly`; garbage token → 401; missing body → 400; `getCurrentUser` with a tampered cookie → null (no throw); with a revoked user's cookie → null; 11th request in a minute → 429.
- [ ] **Step 2:** Interception file redirects: no `__session` cookie on `/dashboard`, `/inbox`, `/agents`, `/customers`, `/products`, `/inventory`, `/orders`, `/voice`, `/automations`, `/analytics`, `/integrations`, `/settings` → `/login?next=…`; cookie present on `/login` or `/register` → `/dashboard`. Comment that this is a UX redirect only; real verification is `requireUser`.
- [ ] **Step 3–4:** FAIL → implement → PASS. Commit `feat(auth): session cookie exchange and route redirects`.

### Task 8: Organizations, registration, and API wrapper

**Files:** Create `src/schemas/organization.ts`, `src/repositories/organizations.ts`, `src/services/organizations/register.ts`, `src/lib/api/handler.ts`, `src/app/api/organizations/register/route.ts`, `src/lib/auth/context.ts`; tests `register.int.test.ts`, `handler.int.test.ts`.

**Interfaces:**
- Consumes: `requireUser`, `can`, `assertRateLimit`, `writeAudit`, `toErrorResponse`.
- Produces: `registerOrganization(input: { uid: string; email: string; displayName: string; organizationName: string }): Promise<{ organizationId: string }>` — one Firestore transaction creating `users/{uid}`, `organizations/{id}`, `organizationMembers/{organizationId}_{uid}` (`role:'owner'`); idempotent per uid (second call returns the existing org id, creates nothing). `getMembership(uid: string, organizationId?: string): Promise<{ organizationId: string; role: Role } | null>` (default org from `users/{uid}.defaultOrganizationId`). `withApi<T>(opts: { permission?: Permission; rateLimit?: { limit: number; windowSec: number }; schema?: ZodType<T> }, fn: (ctx: { uid: string; organizationId: string; role: Role; body: T; req: Request; params: Record<string,string> }) => Promise<Response | object>): (req: Request, routeCtx) => Promise<Response>` — resolves user and membership, enforces permission and rate limit, parses body with Zod, converts thrown errors via `toErrorResponse`, adds `requestId`. `members:manage` required to alter members (not built this phase; matrix only).

- [ ] **Step 1: Tests** — register creates exactly 3 docs with owner role; second call for same uid returns same org and org count stays 1; 5 parallel calls for the same uid → 1 org; if the members write fails (inject failure), no org or user doc remains; `withApi` returns 401 without a cookie, 403 for a viewer on a `customers:write` route, 400 on invalid body, 500 envelope with no leaked message on an unexpected throw; a user can never address another org's data (organizationId always comes from membership, never the request body).
- [ ] **Step 2–4:** FAIL → implement → PASS. Commit `feat(orgs): atomic registration and withApi wrapper`.

### Task 9: Firestore rules and rules tests

**Files:** Modify `firestore.rules`; Create `tests/rules/tenancy.rules.test.ts`

**Interfaces:** Rules helper `isMember(orgId)` = `exists(/databases/$(database)/documents/organizationMembers/$(orgId + '_' + request.auth.uid))`.

- [ ] **Step 1: Tests** (using `initializeTestEnvironment`, seeding via `withSecurityRulesDisabled`): member of org A can read A's `customers`, `products`, `categories`, `inventory`; cannot read org B's; unauthenticated cannot read anything; **no client (any role) can create/update/delete** in any collection; `rateLimits`, `auditLogs`, `inventory/*/reservations` are unreadable by clients; `users/{uid}` readable only by that uid; `organizationMembers` readable by the member themselves and org admins/owners only; a doc whose `organizationId` is changed client-side cannot be written.
- [ ] **Step 2–4:** FAIL → write rules (default deny, explicit per-collection read; writes `false`) → PASS. Commit `feat(rules): strict org-isolated firestore rules`.

### Task 10: Security headers

**Files:** Modify `next.config.ts`; Create `src/config/security-headers.ts`, `security-headers.test.ts`

**Interfaces:** Produces `securityHeaders(isDev: boolean): { key: string; value: string }[]`.

- [ ] **Step 1: Tests** — includes `Strict-Transport-Security` (prod only), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, and a CSP whose `img-src` allows `res.cloudinary.com` and `connect-src` allows Firebase Auth/Firestore/Identity Toolkit and Cloudinary upload hosts; dev adds `'unsafe-eval'` while prod does not.
- [ ] **Step 2–4:** FAIL → implement → PASS; apply in `headers()` for `/(.*)`. Commit `feat(security): http security headers`.

### Task 11: Auth UI

**Files:** Create `src/app/(auth)/{login,register,forgot-password}/page.tsx`, `src/components/auth/{login-form,register-form,forgot-form}.tsx`, `src/schemas/auth.ts`, `src/schemas/auth.test.ts`, `src/hooks/use-session.ts`

**Interfaces:** Consumes `getFirebaseAuth`, `/api/auth/session`, `POST /api/organizations/register`. Produces `loginSchema`, `registerSchema` (password ≥ 10 chars; org name trimmed 2–80).

- [ ] **Step 1: Tests** on schemas: short password rejected; whitespace-only org name rejected; invalid email rejected.
- [ ] **Step 2:** Forms with React Hook Form + zod resolver: email/password and Google sign-in → post ID token to session route → redirect to `next` or `/dashboard`; register creates the Firebase user, calls register route, then session. Every form shows loading, field errors, and a server error banner. Forgot-password calls `sendPasswordResetEmail` and shows a neutral success message regardless of account existence.
- [ ] **Step 3:** Run schema tests → PASS; `npm run typecheck && npm run lint`. Commit `feat(auth): login, register, forgot-password UI`.

### Task 12: Dashboard shell

**Files:** Create `src/app/(dashboard)/layout.tsx`, `src/components/dashboard/{sidebar,header,theme-toggle,coming-later}.tsx`, `src/config/nav.ts`, `src/config/nav.test.ts`, placeholder pages for `inbox agents orders voice automations analytics integrations settings`, `src/app/providers.tsx`

**Interfaces:** Produces `NAV_ITEMS: { label; href; icon; permission?: Permission; phase?: number }[]` covering all 12 items from the brief; `<ComingLater phase={n} title={string} />`.

- [ ] **Step 1: Test** — `NAV_ITEMS` has 12 entries in the brief's order, unique hrefs, and every entry without `phase` is a page built this plan (Overview, Customers, Products, Inventory, Settings) .
- [ ] **Step 2:** Server layout calls `requireUser()` + `getMembership` (redirect to `/login` if null), renders sidebar (collapsible; `Sheet` on mobile), header (search input disabled with "coming later" title, org name, role badge, emulator/mock-mode status chip, user menu with sign-out calling `DELETE /api/auth/session`), theme toggle (next-themes), `QueryClientProvider`. Unbuilt pages render `ComingLater` — no fake data.
- [ ] **Step 3:** Run the test; `npm run build`; start `npm run emu` and `npm run dev`, register, confirm the shell at mobile and desktop widths. Commit `feat(ui): dashboard shell with responsive navigation`.

### Task 13: Repository base

**Files:** Create `src/repositories/base.ts`, `src/lib/pagination.ts`, `base.int.test.ts`

**Interfaces:**
- Produces: `class OrgRepository<T extends { id: string; organizationId: string }>` with `constructor(collection: string)`, `get(orgId, id): Promise<T | null>` (returns null if doc belongs to another org), `create(orgId, data: Omit<T,'id'|'organizationId'|'createdAt'|'updatedAt'>, id?: string): Promise<T>`, `update(orgId, id, patch): Promise<T>` (throws `NotFoundError` cross-org), `remove(orgId, id)`, `list(orgId, q: { where?: [field, op, value][]; orderBy: [field, 'asc'|'desc']; limit: number; cursor?: string }): Promise<{ items: T[]; nextCursor: string | null }>`. `encodeCursor/decodeCursor(token)`; `decodeCursor` throws `ValidationError` on garbage. Timestamps stored as Firestore `Timestamp`, serialized as ISO strings.

- [ ] **Step 1: Tests** — create then get returns the doc with `organizationId` forced to the argument even if `data` contains another; get/update/remove with the wrong org → null / NotFound; pagination across 25 docs with limit 10 returns 10/10/5 and null cursor, no duplicates; garbage cursor → `ValidationError`.
- [ ] **Step 2–4:** FAIL → implement → PASS. Commit `feat(repo): org-scoped repository base with cursor pagination`.

### Task 14: Customer domain (schema, phone, segments)

**Files:** Create `src/lib/phone.ts`, `src/lib/phone.test.ts`, `src/schemas/customer.ts`, `src/schemas/customer.test.ts`

**Interfaces:**
- Produces: `normalizePhone(raw: string, defaultCountry = 'BD'): string | null` returning E.164 or null; `CUSTOMER_SEGMENTS = ['new_lead','interested','qualified_lead','potential_buyer','converted','repeat_customer','wholesale_customer','inactive']`; `customerInputSchema` (fullName trimmed 1–120 non-blank, phone, whatsappNumber?, email?, address?, customerType `retail|wholesale`, leadSource?, tags string[] ≤ 20, segment, preferences?, assignedAgentId?, consent `{ status: 'granted'|'denied'|'unknown'; at?: string; source?: string }`); type `Customer` adds `id, organizationId, phoneE164, totalSpendMinor, lastInteractionAt, createdAt, updatedAt`.

- [ ] **Step 1: Tests** — `normalizePhone('01712-345678')`, `'+880 1712 345678'`, `'8801712345678'` all → `+8801712345678`; `'abc'`, `''`, `'12345'` → null; schema rejects `fullName: '   '`, unknown segment, 21 tags; accepts Bangla name `"রহিম উদ্দিন"`; consent defaults to `{status:'unknown'}`; `granted` without `source` is rejected.
- [ ] **Step 2–4:** FAIL → implement (hand-written BD rules; no new dependency) → PASS. Commit `feat(crm): customer schema and phone normalization`.

### Task 15: Customer service and API

**Files:** Create `src/repositories/customers.ts`, `src/services/crm/customers.ts`, `src/app/api/customers/route.ts`, `src/app/api/customers/[id]/route.ts`, `customers.int.test.ts`

**Interfaces:**
- Consumes: `OrgRepository`, `withApi`, `writeAudit`, `normalizePhone`.
- Produces: `createCustomer(ctx, input): Promise<Customer>`, `updateCustomer(ctx, id, patch)`, `deleteCustomer(ctx, id)`, `listCustomers(ctx, q: { search?: string; segment?; customerType?; tag?; sort: 'createdAt'|'fullName'|'lastInteractionAt'; dir; limit ≤ 50; cursor? })`, where `ctx = { organizationId: string; uid: string }`. Uniqueness via a lock doc `customerPhones/{organizationId}_{phoneE164}` created inside the same transaction (add collection to rules deny-all in Task 9's file). Search matches `fullNameLower` prefix or `phoneE164` prefix. Routes: `GET/POST /api/customers` (`customers:read`/`write`), `GET/PATCH/DELETE /api/customers/[id]`.

- [ ] **Step 1: Tests** — create normalizes phone and writes an audit entry; second create with the same phone (different formatting) → `ConflictError`; 10 concurrent creates of one phone → exactly 1 succeeds; update changing phone moves the lock; delete frees it; search `"রহিম"` prefix finds the Bangla customer, case-insensitive for Latin; filter by segment; viewer POST → 403; agent DELETE (needs `customers:write`) → allowed; cross-org id → 404; bad cursor → 400.
- [ ] **Step 2–4:** FAIL → implement → PASS. Commit `feat(crm): customer service and API`.

### Task 16: Customer UI

**Files:** Create `src/app/(dashboard)/customers/page.tsx`, `customers/[id]/page.tsx`, `src/components/customers/{customer-table,customer-form,customer-filters,customer-profile}.tsx`, `src/hooks/use-customers.ts`

**Interfaces:** Consumes `/api/customers`. Produces TanStack Query hooks `useCustomers(filters)`, `useCreateCustomer`, `useUpdateCustomer`, `useDeleteCustomer`.

- [ ] **Step 1:** Table with debounced search, segment/type/tag filters, sort, "Load more" cursor pagination; loading skeleton, empty state with CTA, error state with retry; create/edit dialog with RHF + `customerInputSchema`, server `Conflict` shown on the phone field; hide write buttons for viewer role; profile page with details, consent card, and empty "Conversations" and "Orders" panels labelled for later phases.
- [ ] **Step 2:** `npm run typecheck && npm run lint`; manual check against emulators: create, duplicate phone error, search, filter, edit, delete. Commit `feat(crm): customer list, form, and profile UI`.

### Task 17: Product and category domain, service, API

**Files:** Create `src/schemas/product.ts`, `src/schemas/product.test.ts`, `src/repositories/{products,categories}.ts`, `src/services/products/{products,categories}.ts`, `src/app/api/products/route.ts`, `src/app/api/products/[id]/route.ts`, `src/app/api/categories/route.ts`, `products.int.test.ts`

**Interfaces:**
- Produces: `productInputSchema` (name 1–200, `sku` unique per org, `slug` auto-derived unique per org, description, `categoryId?`, `images: { url; publicId; width; height }[] ≤ 10`, `variants: { id; size?; color?; sku? }[]`, `regularPriceMinor` int ≥ 0, `salePriceMinor?` ≤ regular, `wholesalePriceMinor?`, `availability: 'active'|'draft'|'archived'`, `specifications: Record<string,string>`, `faqs: {q;a}[]`); `createProduct/updateProduct/archiveProduct/listProducts(ctx, …)`; creating a product also creates inventory docs (`inventory/{productId}__{variantId}` with `variantId='default'` when no variants, `onHand:0`, `reserved:0`). Uniqueness locks `productSkus/{orgId}_{sku}` and slugs `productSlugs/{orgId}_{slug}` in-transaction.

- [ ] **Step 1: Tests** — schema rejects float or negative price, sale > regular, 11 images, image URL not on `res.cloudinary.com`; duplicate SKU → Conflict; slug collision gets `-2` suffix; creating a product with 2 variants creates 2 inventory docs at 0; agent/viewer cannot POST (403) but can GET; archived products are excluded from default list.
- [ ] **Step 2–4:** FAIL → implement → PASS. Commit `feat(products): product/category schema, service, API`.

### Task 18: Inventory service

**Files:** Create `src/services/inventory/stock.ts`, `src/app/api/inventory/route.ts`, `src/app/api/inventory/adjust/route.ts`, `stock.int.test.ts`

**Interfaces:**
- Consumes: `adminDb`, `writeAudit`, `InsufficientStockError`.
- Produces (all run in Firestore transactions; `quantity` must be a positive integer else `ValidationError`):
  - `reserveStock(orgId: string, productId: string, variantId: string, quantity: number, idempotencyKey: string): Promise<{ reservationId: string; available: number }>` — writes `inventory/{id}/reservations/{idempotencyKey}` `{quantity,status:'reserved'}`; same key again returns the existing reservation without changing counts; throws `InsufficientStockError` when `onHand − reserved < quantity`.
  - `releaseStock(orgId, productId, variantId, idempotencyKey): Promise<void>` — only from `reserved`; repeat is a no-op.
  - `commitStock(orgId, productId, variantId, idempotencyKey): Promise<void>` — reserved → committed: `onHand -= q`, `reserved -= q`; repeat is a no-op.
  - `adjustStock(ctx, productId, variantId, input: { delta: number; reason: string }): Promise<InventoryRecord>` — integer ≠ 0, reason ≥ 3 chars, result `onHand` must stay ≥ `reserved`; writes audit.
  - `listInventory(ctx, q)`; routes `GET /api/inventory` (`inventory:read`), `POST /api/inventory/adjust` (`inventory:write`).

- [ ] **Step 1: Tests** — stock 5: reserving 3 then 3 → second throws `InsufficientStockError`, available stays 2; **30 concurrent reserves of 1 against stock 10 → exactly 10 succeed, `reserved === 10`**; same idempotency key twice → one reservation, `reserved` unchanged on retry; release restores availability and a second release is a no-op; commit twice decrements once; quantity `0`, `-1`, `1.5` → `ValidationError`; release of an unknown key → NotFound; adjust that would drop `onHand` below `reserved` → Conflict; adjust without a reason → 400; adjust writes an audit entry with before/after; counts are never negative after any sequence.
- [ ] **Step 2–4:** FAIL → implement → PASS (repeat the concurrency test 5× for flake check). Commit `feat(inventory): transactional reserve/release/commit and adjustments`.

### Task 19: Products and inventory UI

**Files:** Create `src/app/(dashboard)/{products,inventory}/page.tsx`, `products/[id]/page.tsx`, `src/components/products/{product-table,product-form,variant-editor,image-gallery}.tsx`, `src/components/inventory/{inventory-table,adjust-dialog}.tsx`, `src/hooks/use-products.ts`, `src/hooks/use-inventory.ts`

- [ ] **Step 1:** Product list (search, availability filter, load more), editor (RHF + `productInputSchema`; price inputs accept taka with decimals and convert to integer paisa; variants add/remove; specs and FAQ repeaters; image slot using the uploader from Task 21 once available, until then a disabled "Media storage not configured" state), inventory table with `onHand / reserved / available` and low-stock badge (available ≤ 5), adjust dialog requiring delta and reason. Write controls hidden by role. Loading, empty, error states throughout.
- [ ] **Step 2:** Typecheck, lint; manual check on emulators: create product with 2 variants, adjust stock, see available update. Commit `feat(products): product editor and inventory UI`.

### Task 20: Cloudinary library and signing endpoint

**Files:** Create `src/lib/cloudinary/{index,folders}.ts`, `src/app/api/uploads/sign/route.ts`, `src/app/api/uploads/confirm/route.ts`, `src/schemas/upload.ts`, tests `folders.test.ts`, `index.test.ts`, `sign.int.test.ts` (Cloudinary SDK mocked)

**Interfaces:**
- Consumes: `isConfigured('cloudinary')`, `withApi`, `can`.
- Produces: `type UploadKind = 'products'|'customers'|'knowledge'|'campaigns'`; `orgFolder(orgId: string, kind: UploadKind): string` → `organizations/{orgId}/{kind}`; `kindPermission(kind): Permission` (products→`uploads:products`, customers→`uploads:customers`, knowledge/campaigns→`uploads:org`); `signUpload(orgId, kind, file: { contentType: string; bytes: number }): { cloudName; apiKey; timestamp; folder; allowedFormats: string; signature }` (allowed types jpeg/png/webp/avif, max 5 MB for images; any client folder ignored; signature via `cloudinary.utils.api_sign_request` over `folder`, `timestamp`, `allowed_formats`); `confirmUpload(orgId, publicId): Promise<{ url; publicId; width; height }>` — rejects publicIds not starting with `orgFolder(orgId, …)`, fetches the asset through the Admin API, deletes and rejects it if `bytes` > cap; `deleteAsset(orgId, publicId)` with the same prefix check; `thumbUrl(url, w, h)` / `optimizedUrl(url)` inserting `c_fill,f_auto,q_auto` transformations. Not configured → `IntegrationNotConfiguredError` (503).

- [ ] **Step 1: Tests** — folder always `organizations/<orgId>/products` even if the request body includes `folder: 'organizations/other/products'`; `image/svg+xml`, `application/pdf` (for products) and 6 MB are rejected (400); signature verifies against the mocked secret and changes when the folder changes; viewer → 403, agent signing `products` → 403 but `customers` → 200; `confirmUpload('orgA', 'organizations/orgB/products/x')` → Forbidden; oversize asset is deleted and rejected; missing credentials → 503 and no SDK call; 31st sign request per minute → 429; `thumbUrl` output contains `c_fill` and never the API secret.
- [ ] **Step 2–4:** FAIL → implement → PASS. Commit `feat(storage): org-scoped signed Cloudinary uploads`.

### Task 21: Upload component

**Files:** Create `src/components/uploads/media-uploader.tsx`, `src/hooks/use-upload.ts`; Modify `product-form.tsx` / `image-gallery.tsx`

**Interfaces:** `<MediaUploader kind={UploadKind} onUploaded={(m: { url; publicId; width; height }) => void} />`; `useUpload(kind)` posts to `/api/uploads/sign`, uploads direct to Cloudinary's `image/upload` endpoint with the signed fields, then calls `/api/uploads/confirm`.

- [ ] **Step 1:** Client-side pre-check (type/size) for UX only; progress and error states; when `/api/uploads/sign` returns 503 show "Media storage not configured" with a link to the setup guide; remove-image calls delete via the server.
- [ ] **Step 2:** Typecheck/lint; manual check without credentials shows the not-configured state. With credentials supplied by the user in `.env.local`, upload one image and confirm it lands under `organizations/<orgId>/products/` (report honestly if the user has not provided credentials). Commit `feat(storage): media uploader component`.

### Task 22: Overview KPIs

**Files:** Create `src/services/dashboard/overview.ts`, `overview.int.test.ts`, `src/app/(dashboard)/dashboard/page.tsx`, `src/components/dashboard/kpi-card.tsx`

**Interfaces:** Produces `getOverview(orgId): Promise<{ customers: number; leads: number; products: number; lowStock: number }>` using Firestore `count()` aggregations; `leads` = customers with segment in `new_lead, interested, qualified_lead, potential_buyer`; `lowStock` = inventory docs with `onHand − reserved ≤ 5`.

- [ ] **Step 1: Tests** — seeded org A and B: counts reflect only the caller's org; empty org returns zeros; archived products not counted.
- [ ] **Step 2–4:** FAIL → implement → PASS. Page shows these four KPI cards plus honest "no data yet — available after phase N" cards for orders, revenue, conversations, and calls. Commit `feat(dashboard): overview KPIs from real data`.

### Task 23: Documentation and release gates

**Files:** Create `README.md`, `docs/setup/{firebase,cloudinary,vercel}.md`, `docs/CHECKLIST.md`, `scripts/check-bundle-secrets.mjs`; Modify `docs/superpowers/specs/…-design.md` (finish the truncated open question)

- [ ] **Step 1:** `scripts/check-bundle-secrets.mjs` scans `.next/static` for server-only variable names (`FIREBASE_PRIVATE_KEY`, `CLOUDINARY_API_SECRET`, `OPENAI_API_KEY`, `WHATSAPP_ACCESS_TOKEN`, …) and exits 1 on any hit; add `npm run check:bundle`.
- [ ] **Step 2:** README: local setup with emulators (including the Windows port check), scripts, architecture summary, env table, mock-mode labels; setup guides for Firebase (create project, enable Auth providers, deploy rules/indexes, service account → Vercel env), Cloudinary (create account, put keys only in `.env.local`/Vercel), Vercel (env vars, build settings). `docs/CHECKLIST.md` lists sub-projects 1–8 with this plan's items ticked only if their tests passed.
- [ ] **Step 3: Gate** — run in order and report real output: `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run test:int`, `npm run build`, `npm run check:bundle`. All must pass. Commit `docs: setup guides, checklist, and release gates`.

---

## Self-review notes

- **Spec coverage:** env (T2), permissions (T3), errors/logger/envelope (T4), Firebase + emulators (T5), rate limit + audit (T6), session auth + redirects (T7), registration atomicity + `withApi` (T8), rules (T9), headers (T10), auth UI (T11), shell (T12), repository + pagination (T13), CRM (T14–16), products + inventory (T17–19), Cloudinary (T20–21), overview (T22), docs and gates (T23). Out-of-scope items are placeholders only (T12).
- **Interface check:** `ctx` shape `{ organizationId, uid }` is used by T15, T17, T18, T22 and supplied by `withApi` (T8). Inventory doc id `{productId}__{variantId}` is defined in T17 and consumed in T18/T22. Lock collections `customerPhones`, `productSkus`, `productSlugs` must be added deny-all in T9's rules file; T15 and T17 modify `firestore.rules` and extend the rules test accordingly.
- **Known gap:** composite indexes are derived during T15/T17/T22 as emulator or runtime errors reveal them and are added to `firestore.indexes.json`; real-project deployment is documented in T23 but not performed.
