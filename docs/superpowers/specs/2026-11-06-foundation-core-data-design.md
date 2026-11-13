# SalesPilot AI — Foundation + Core Data Design

Date: 2026-11-06 · Scope: sub-projects 1–2 of 8 · Status: draft for review

## 1. Intent

Build the secure, org-scoped base of an AI sales platform: authentication, organizations and roles, a dashboard shell, CRM, products/inventory, and Cloudinary media. Success means a user can register, get an organization, log in, manage customers and products, adjust stock, and upload images, with provable tenant isolation and no secrets in client bundles. AI, WhatsApp, orders, payments, voice, follow-ups, and analytics are later sub-projects and are out of scope here, except where this work must expose the interfaces they need (stock reservation, consent fields, audit logging).

From the user's brief: stack (Next.js App Router, TypeScript, Tailwind, shadcn/ui, Firebase Auth + Firestore + Admin SDK, Cloudinary, Vercel), org-scoped data from day one, Zod on all inputs, no fake integrations presented as real.
Assumptions (correct me): single npm package; roles `owner|admin|agent|viewer`; money as integer minor units (BDT); the Firebase project is `salespilot-ai-9b1cd` (decided 2026-11-08), while development and tests use emulators with the `demo-salespilot` id.

## 2. Architecture

Layers, one direction of dependency: `app/` (routes, UI) → `services/` (business rules) → `repositories/` (Firestore access) → `lib/` (SDK wrappers: firebase, cloudinary, security). `schemas/` (Zod) is shared by API handlers and forms. `src/config/env.ts` (server) and `src/config/env.client.ts` (public `NEXT_PUBLIC_*`) are the only places `process.env` is read.

- **Reads vs writes.** Server Components and route handlers use the Admin SDK. The browser may read org-scoped lists directly under Firestore rules (for realtime later). All writes go through route handlers or Server Actions: Zod validation, permission check, rate limit, audit log.
- **Auth.** Client signs in with Firebase Auth, posts the ID token to `/api/auth/session`, the server mints an httpOnly session cookie. `src/proxy.ts` (Next 16 renamed middleware to Proxy) only checks cookie presence for redirects; `getCurrentUser()` verifies the cookie with Admin SDK on every protected server call. Role and org come from the `organizationMembers` doc (source of truth), not from client-supplied data.
- **Tenancy.** Every business doc has `organizationId`. Rules allow read only when the caller has a member doc for that org; all client writes to privileged collections are denied.

## 3. Components

| Unit | Purpose | Depends on |
|---|---|---|
| `config/env.ts`, `config/env.client.ts` | Zod-validate server env (server-only, `isConfigured(integration)`) and public env | zod |
| `lib/firebase/{admin,client}` | Lazy SDK init, emulator-aware | env |
| `lib/security/permissions` | Role → permission matrix, `can()` | — |
| `lib/security/{rate-limit,audit}` | Firestore-backed limiter (swappable); audit writer | admin |
| `lib/logger`, `lib/api` | Redacting structured logger; error envelope, `withAuth()` wrapper | permissions |
| `repositories/base` | Org-scoped CRUD, cursor pagination, converters | admin |
| `services/crm`, `services/products`, `services/inventory` | Business rules | repositories, audit |
| `lib/cloudinary` + `api/uploads/sign` | Signed upload params scoped to org folder; delete; URL helpers | env |
| Dashboard shell + feature pages | UI | services via API / server components |

Collections in this phase: `users`, `organizations`, `organizationMembers`, `customers`, `products`, `categories`, `inventory`, `auditLogs`, `rateLimits`.

## 4. Key behaviors

**Registration** creates `users`, `organizations`, and an `owner` member in one transaction. Failure leaves no partial org.

**Permissions** (server-enforced, mirrored in rules): owner/admin manage everything; agent: customers read/write, products read; viewer: read-only. Role changes and member management are owner/admin only.

**CRM.** Customer fields per brief, 8 segments, consent status (`granted|denied|unknown`, with timestamp and source — required later for WhatsApp/voice/follow-ups), tags, search by name/phone prefix, filters, sort, cursor pagination. Phone numbers normalized to E.164; unique per org to prevent duplicate customers.

**Inventory.** `available = onHand − reserved`. `reserveStock`, `releaseStock`, `commitStock` run in Firestore transactions and fail with a typed error when stock is insufficient; reservations carry an `idempotencyKey` so retries do not double-reserve. Manual adjustments require a reason and write an audit log. Orders (sub-project 5) will call these functions unchanged.

**Cloudinary.** Server signs params only after auth, permission check, rate limit, MIME allow-list (jpeg/png/webp/avif for products), size cap, and folder forced to `organizations/{orgId}/{type}/`. Client-supplied folders are ignored. Firestore stores `{url, publicId, width, height}`. If credentials are absent the UI shows "Media storage not configured" and the endpoint returns 503; nothing is faked.

**Security baseline.** CSP/HSTS/frame/referrer headers; rate limits on auth session, uploads, and mutations; errors return a generic envelope with a request id, never stack traces or secrets; logger redacts keys/tokens/phone numbers.

## 5. Error handling

Typed errors (`ValidationError`, `Unauthenticated`, `Forbidden`, `NotFound`, `Conflict`, `InsufficientStock`, `RateLimited`, `IntegrationNotConfigured`) map to HTTP 400/401/403/404/409/409/429/503. UI shows loading, empty, error, and success states for every list and form.

## 6. Testing

- Rules tests (emulator): cross-org read/write denied, privileged-collection client writes denied, role matrix.
- Unit: env validation, permission matrix, Zod schemas, phone normalization, Cloudinary signing scope, rate limiter.
- Integration (emulator): session route bad/expired token → 401; registration atomicity; audit entries on mutations.
- Concurrency: N parallel reservations against M stock never exceed M; idempotent retry reserves once; failure leaves counts unchanged.
- Build gate: `tsc --noEmit`, lint, `next build`, and a grep of `.next/static` confirming no secret names/values.
- Windows note: check ports 8085 (Firestore) and 9199 (Auth) before emulator runs; if they are taken, fall back to a temporary config with alternate ports (and matching emulator host variables), deleted afterwards.

## 7. Out of scope (later sub-projects)

AI/RAG/tool calling, WhatsApp, inbox, orders, payments, courier, voice, follow-ups, n8n, analytics, i18n beyond storing language preference. Dashboard items for these render an explicit "coming later" state, not mock data.

## 8. Open questions

1. Firebase project. **Decided 2026-11-08:** reuse `salespilot-ai-9b1cd` (asia-southeast1); development and tests still use the `demo-salespilot` emulator project.
2. Cloudinary credentials will be provided by the user directly in `.env.local`.
