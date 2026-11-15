# Phase 5b — Payment Gateways Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Multi-gateway online payments (SSLCommerz, aamarPay, UddoktaPay, and Mock) for confirmed orders, with encrypted credentials, tamper-proof payment links, public checkout pages, idempotent server-verified callbacks, payment reconciliation, staff integrations UI, and AI `send_payment_link` tool.

**Architecture:** 
- `secret-box.ts` handles AES-256-GCM sealed secrets derived from `ENCRYPTION_KEY`.
- Gateway interface `PaymentGateway` with standardized adapters (`mock`, `sslcommerz`, `aamarpay`, `uddoktapay`).
- Payment links store SHA-256 hash of tokens; `/pay/[token]` provides a public, mobile-first, privacy-safe payment UI.
- All callbacks (`ipn`, `success`, `fail`, `cancel`) are parsed and server-to-server verified against the gateway before any order is marked `paid`.
- Unverified/pending attempts are reconciled in the background cron job.

**Tech Stack:** Next.js 16 App Router, TypeScript strict, Zod 4, Firebase Admin + emulators, Vitest, TanStack Query, shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-11-11-orders-payments-courier-design.md` (§3.4–§3.7, §6, §8, §9, §10, §11, §12).

---

## File Structure

```
src/lib/security/secret-box.ts                         (new) AES-256-GCM encryption & decryption
src/lib/security/secret-box.test.ts                    (new) unit tests
src/schemas/integration.ts                             (new) gateway account schemas & credentials
src/schemas/payment.ts                                 (new) payment attempts, links, callbacks schemas
src/repositories/integrations.ts                       (new) gateway account repository
src/repositories/payments.ts                           (new) payment attempt & link repositories
src/services/payments/gateways/types.ts                (new) PaymentGateway interface
src/services/payments/gateways/mock.ts                 (new) mock gateway adapter
src/services/payments/gateways/sslcommerz.ts           (new) SSLCommerz adapter
src/services/payments/gateways/aamarpay.ts             (new) aamarPay adapter
src/services/payments/gateways/uddoktapay.ts           (new) UddoktaPay adapter
src/services/payments/gateways/registry.ts             (new) gateway factory/resolver
src/services/payments/links.ts                         (new) createPaymentLink, resolvePaymentLink
src/services/payments/attempts.ts                      (new) createPaymentSession, confirmPaymentAttempt
src/services/payments/reconciler.ts                    (new) reconcilePaymentAttempts (cron)
src/app/api/integrations/gateways/**                   (new) staff gateway configuration API
src/app/api/orders/[id]/payment-link/route.ts          (new) generate payment link API
src/app/api/pay/[token]/session/route.ts               (new) public session creation API
src/app/api/payments/[gateway]/[action]/route.ts       (new) callback & IPN handler
src/app/pay/[token]/page.tsx                           (new) public checkout page
src/app/pay/[token]/status/page.tsx                    (new) public payment status page
src/app/pay/[token]/mock/page.tsx                      (new) mock gateway payment simulator
src/app/(dashboard)/integrations/page.tsx              (modify) activate Integrations page with Gateways tab
src/components/orders/order-detail.tsx                 (modify) add Payment card & link controls
src/services/agents/tools/send-payment-link.ts         (new) AI payment link tool
src/services/orders/sweep.ts                           (modify) invoke payment reconciler
firestore.indexes.json                                 (modify) add paymentAttempts indexes
docs/setup/{sslcommerz,aamarpay,uddoktapay}.md         (new) setup guides
```

---

### Task 1: Secret Box (AES-256-GCM)

**Files:**
- Create: `src/lib/security/secret-box.ts`, `src/lib/security/secret-box.test.ts`
- Modify: `src/lib/logger.ts` (extend redaction list with `signatureKey`, `storePassword`, `apiKey`, `clientSecret`)

**Details:**
- `SealedSecret = { v: 1, iv: string, tag: string, data: string }` (base64 encoded).
- `sealSecret(plainText: string, key?: string): SealedSecret`: encrypts using AES-256-GCM. Derives or uses 32-byte key from `ENCRYPTION_KEY`.
- `unsealSecret(sealed: SealedSecret, key?: string): string`: decrypts and verifies tag; throws `ValidationError` on tampering.
- `isEncryptionConfigured(): boolean`: returns true if `ENCRYPTION_KEY` is present and valid 32-byte base64.

- [ ] **Step 1: Write unit tests** (`secret-box.test.ts`): seal/unseal round-trip, tampered data throws, tampered tag throws, tampered IV throws, 32-byte key length requirement.
- [ ] **Step 2: Run** `npm run test:unit` -> FAIL.
- [ ] **Step 3: Implement** `secret-box.ts` and update logger redaction.
- [ ] **Step 4: Run** `npm run test:unit` -> PASS.
- [ ] **Step 5: Commit** `feat(security): AES-256-GCM secret-box for integration credentials`

---

### Task 2: Integration Account & Payment Schemas & Repositories

**Files:**
- Create: `src/schemas/integration.ts`, `src/schemas/payment.ts`, `src/repositories/integrations.ts`, `src/repositories/payments.ts`
- Create: `src/schemas/integration.test.ts`, `src/schemas/payment.test.ts`, `src/repositories/integrations.int.test.ts`
- Modify: `firestore.rules`, `firestore.indexes.json`

**Details:**
- Schemas for gateway accounts (`sslcommerz`, `aamarpay`, `uddoktapay`, `mock`).
- Credentials validation per provider (e.g. `storeId` + `storePassword` for SSLCommerz; `storeId` + `signatureKey` for aamarPay; `apiKey` + `baseUrl` for UddoktaPay).
- `paymentAttempts`: doc id is `tranId` (128-bit base32); stores `organizationId`, `orderId`, `expectedAmountMinor`, `state`, etc.
- `paymentLinks`: doc id is `tokenHash` (SHA-256 of 32-byte base64url token).
- `webhookEvents`: doc id is `${provider}_${eventKey}`.
- Firestore rules: deny client read/write to `gatewayAccounts`, `paymentAttempts`, `paymentLinks`, `webhookEvents`.
- Firestore composite index for `paymentAttempts`: `(state, createdAt)`.

- [ ] **Step 1: Write failing tests** for schemas and tenancy repository operations.
- [ ] **Step 2: Run** `npm run test:unit`, `npm run test:int` -> FAIL.
- [ ] **Step 3: Implement** schemas, repositories, rules, and indexes.
- [ ] **Step 4: Run** `npm run test:unit`, `npm run test:int` -> PASS.
- [ ] **Step 5: Commit** `feat(payments): integration account and payment attempt schemas and repositories`

---

### Task 3: Payment Gateway Interface & Mock Adapter

**Files:**
- Create: `src/services/payments/gateways/types.ts`, `src/services/payments/gateways/mock.ts`, `src/services/payments/gateways/registry.ts`
- Create: `src/services/payments/gateways/mock.test.ts`

**Details:**
- Define `PaymentGateway` interface: `testConnection`, `createSession`, `verify`, `parseCallback`.
- Implement `MockPaymentGateway`: redirects to `/pay/[token]/mock?tranId=...`, verify reads in-memory/simulated outcome.
- `getPaymentGateway(provider)` factory.

- [ ] **Step 1: Write failing unit test** for mock gateway session and verification.
- [ ] **Step 2: Run** `npm run test:unit` -> FAIL.
- [ ] **Step 3: Implement** interface, registry, and mock gateway adapter.
- [ ] **Step 4: Run** `npm run test:unit` -> PASS.
- [ ] **Step 5: Commit** `feat(payments): payment gateway interface, registry and mock adapter`

---

### Task 4: Real Gateway Adapters (SSLCommerz, aamarPay, UddoktaPay)

**Files:**
- Create: `src/services/payments/gateways/sslcommerz.ts`, `src/services/payments/gateways/aamarpay.ts`, `src/services/payments/gateways/uddoktapay.ts`
- Create: `src/services/payments/gateways/sslcommerz.test.ts`, `src/services/payments/gateways/aamarpay.test.ts`, `src/services/payments/gateways/uddoktapay.test.ts`

**Details:**
- Single outbound `fetchWithTimeout` helper (10s timeout, max body size, no redirect following).
- **SSLCommerz**:
  - `createSession`: `POST {host}/gwprocess/v4/api.php` urlencoded form -> `GatewayPageURL`.
  - `verify`: `GET {host}/validator/api/validationserverAPI.php?val_id=...` -> checks `status === "VALID" | "VALIDATED"`, matches `amount`, `currency`, `tran_id`. Checks `risk_level === "1"` flag.
  - `parseCallback`: extracts `val_id`, `tran_id`.
- **aamarPay**:
  - `createSession`: `POST {host}/jsonpost.php` (JSON) -> `payment_url`.
  - `verify`: `GET {host}/api/v1/trxcheck/request.php` -> checks `pay_status === "Successful"`, amount, tranId.
  - `parseCallback`: extracts `mer_txnid`, `pg_txnid`.
- **UddoktaPay**:
  - Validates `baseUrl` is `https:` without IP literals or internal domains (`localhost`, `.lan`, etc.).
  - `createSession`: `POST {baseUrl}/api/checkout-v2` with `RT-UDDOKTAPAY-API-KEY` -> `payment_url`.
  - `verify`: `POST {baseUrl}/api/verify-payment` -> checks `status === "COMPLETED"`, amount.
  - `parseCallback`: extracts `invoice_id`, `metadata.tranId`.

- [ ] **Step 1: Write failing unit tests** with mocked network fixtures for all 3 adapters.
- [ ] **Step 2: Run** `npm run test:unit` -> FAIL.
- [ ] **Step 3: Implement** adapters with rigorous input/output parsing.
- [ ] **Step 4: Run** `npm run test:unit` -> PASS.
- [ ] **Step 5: Commit** `feat(payments): SSLCommerz, aamarPay and UddoktaPay gateway adapters`

---

### Task 5: Payment Links & Public Checkout Flow

**Files:**
- Create: `src/services/payments/links.ts`, `src/services/payments/links.int.test.ts`
- Create: `src/services/payments/attempts.ts`, `src/services/payments/attempts.int.test.ts`
- Create: `src/app/api/orders/[id]/payment-link/route.ts`, `src/app/api/orders/[id]/payment-link/route.int.test.ts`
- Create: `src/app/api/pay/[token]/session/route.ts`, `src/app/api/pay/[token]/session/route.int.test.ts`

**Details:**
- `createPaymentLink`: generates 32-byte secure token, records in `paymentLinks` with expiry matching order hold.
- `resolvePaymentLink`: retrieves order public summary (org name, items, delivery charge, total, order number; strips customer address & phone).
- `createPaymentSession`: rate-limited per IP and token, creates `paymentAttempts` record, calls gateway `createSession`, returns redirect URL.

- [ ] **Step 1: Write integration tests** for link creation, link resolution, and session creation.
- [ ] **Step 2: Run** `npm run test:int` -> FAIL.
- [ ] **Step 3: Implement** service functions and API routes.
- [ ] **Step 4: Run** `npm run test:int` -> PASS.
- [ ] **Step 5: Commit** `feat(payments): payment link generation and public checkout session API`

---

### Task 6: Payment Callback Handling, Verification & State Transitions

**Files:**
- Create: `src/services/payments/callbacks.ts`, `src/services/payments/callbacks.int.test.ts`
- Create: `src/app/api/payments/[gateway]/[action]/route.ts`, `src/app/api/payments/[gateway]/[action]/route.int.test.ts`

**Details:**
- `confirmPaymentAttempt(tranId, gatewayRef)`:
  - Fetches attempt and decrypts account credentials via `secret-box`.
  - Calls `gateway.verify(account, { tranId, gatewayRef })`.
  - In a Firestore transaction:
    - Verifies amount == `expectedAmountMinor`, currency == `"BDT"`.
    - If valid: sets attempt to `paid`, sets order `paymentStatus: "paid"`, clears `holdExpiresAt`, writes `orderEvents` and audit log.
    - If amount mismatch: sets attempt `failed` (`amount_mismatch`), flags order, logs security warning.
    - If order was cancelled (expired hold): sets `paidAfterCancel: true` and creates timeline alert.
- Route `/api/payments/[gateway]/[action]`:
  - Actions: `ipn`, `success`, `fail`, `cancel`.
  - Dedupes via `webhookEvents`.
  - Calls `confirmPaymentAttempt`.
  - `success`/`fail`/`cancel` redirect with status 303 to `/pay/[token]/status?t={tranId}`. `ipn` returns 200 OK.

- [ ] **Step 1: Write failing integration tests** for callback flows, amount mismatches, replay attacks, and paid-after-cancel.
- [ ] **Step 2: Run** `npm run test:int` -> FAIL.
- [ ] **Step 3: Implement** verification service and unified callback route.
- [ ] **Step 4: Run** `npm run test:int` -> PASS.
- [ ] **Step 5: Commit** `feat(payments): payment callback processing and transactional verification`

---

### Task 7: Payment Reconciler (Cron Integration)

**Files:**
- Create: `src/services/payments/reconciler.ts`, `src/services/payments/reconciler.int.test.ts`
- Modify: `src/services/orders/sweep.ts`, `src/services/orders/sweep.int.test.ts`

**Details:**
- `reconcilePaymentAttempts()`: Queries `paymentAttempts` with `state in ["created", "redirected"]` older than 15 minutes and younger than 48 hours (limit 50 per run).
- Calls `confirmPaymentAttempt` for each.
- Attempts older than 48 hours are transitioned to `expired`.
- Integrated directly into the existing order sweep cron (`GET /api/cron/orders/expire`).

- [ ] **Step 1: Write integration tests** for reconciler sweeping unverified attempts.
- [ ] **Step 2: Run** `npm run test:int` -> FAIL.
- [ ] **Step 3: Implement** reconciler and wire into `sweep.ts`.
- [ ] **Step 4: Run** `npm run test:int` -> PASS.
- [ ] **Step 5: Commit** `feat(payments): payment attempt reconciler in hold expiry sweep`

---

### Task 8: AI Agent Tool `send_payment_link`

**Files:**
- Create: `src/services/agents/tools/send-payment-link.ts`, `src/services/agents/tools/send-payment-link.int.test.ts`
- Modify: `src/services/agents/tools/registry.ts`, `src/services/agents/tools/types.ts`, `src/config/agent-labels.ts`, `src/services/agents/templates.ts`

**Details:**
- Tool `send_payment_link`: requires `orderNumber`.
- Resolves order for the active contact phone (`contactPhoneE164`).
- Order must be `confirmed` and `paymentStatus` in `["awaiting_payment", "failed"]`.
- Calls `createPaymentLink` and returns link URL + expiry time.
- On test/dry-run channels, returns simulated link without database writes.

- [ ] **Step 1: Write tests** for `send_payment_link` (valid order, other customer's order rejected, COD order rejected, dry-run).
- [ ] **Step 2: Run** `npm run test:int`, `npm run test:unit` -> FAIL.
- [ ] **Step 3: Implement** tool and wire into registry and prompt templates.
- [ ] **Step 4: Run** `npm run test:int`, `npm run test:unit` -> PASS.
- [ ] **Step 5: Commit** `feat(agents): send_payment_link tool for confirmed online orders`

---

### Task 9: Public Pay UI (`/pay/[token]`, `/pay/[token]/status`, `/pay/[token]/mock`)

**Files:**
- Create: `src/app/pay/[token]/page.tsx`, `src/app/pay/[token]/status/page.tsx`, `src/app/pay/[token]/mock/page.tsx`
- Create: `src/components/pay/pay-card.tsx`, `src/components/pay/gateway-selector.tsx`
- Modify: `src/proxy.test.ts` (assert `/pay` is not protected by auth proxy)

**Details:**
- Public, mobile-first, standalone pages outside dashboard layout.
- Displays order number, store name, items breakdown, delivery fee, total in BDT.
- No customer address, phone number, or internal notes exposed.
- Gateway selector buttons (e.g. "Pay with bKash / Card (SSLCommerz)", "aamarPay", "UddoktaPay", "Mock Pay").
- Status page displays real-time outcome (`paid`, `failed`, `expired`, `processing`) from Firestore attempt doc.
- Mock page offers simple "Simulate Success" and "Simulate Failure" buttons for testing.

- [ ] **Step 1: Write test** asserting `/pay` route accessibility and layout isolation.
- [ ] **Step 2: Run** `npm run test:unit` -> FAIL.
- [ ] **Step 3: Implement** public payment pages and mock simulator.
- [ ] **Step 4: Run** `npm run test:unit`, `npm run build` -> PASS.
- [ ] **Step 5: Commit** `feat(pay): public checkout, status and mock gateway pages`

---

### Task 10: Staff Integrations UI & Order Detail Payment Card

**Files:**
- Create: `src/app/api/integrations/gateways/route.ts`, `src/app/api/integrations/gateways/[id]/route.ts`, `src/app/api/integrations/gateways/[id]/test/route.ts`
- Create: `src/app/(dashboard)/integrations/page.tsx`, `src/components/integrations/gateway-card.tsx`, `src/components/integrations/gateway-form-dialog.tsx`
- Modify: `src/components/orders/order-detail.tsx`, `src/config/nav.ts` (activate Integrations navigation)

**Details:**
- Staff API routes for gateway accounts (`integrations:manage` permission required).
- Credentials encrypted on save via `sealSecret`; never sent back in API responses (shows `hasCredentials: true`).
- "Test Connection" button calls `gateway.testConnection(account)` and reports result.
- Integrations page with Gateway cards (SSLCommerz, aamarPay, UddoktaPay, Mock).
- Order detail page: Payment card shows payment method, status, gateway transaction ID, payment link generation button with copy-to-clipboard, and risk flags.

- [ ] **Step 1: Write integration tests** for gateway management API routes.
- [ ] **Step 2: Run** `npm run test:int` -> FAIL.
- [ ] **Step 3: Implement** API routes, Integrations page, and order detail Payment card.
- [ ] **Step 4: Run** `npm run test:int`, `npm run typecheck`, `npm run lint`, `npm run build` -> PASS.
- [ ] **Step 5: Commit** `feat(integrations): payment gateway management UI and order payment controls`

---

### Task 11: Setup Documentation & Release Gates

**Files:**
- Create: `docs/setup/sslcommerz.md`, `docs/setup/aamarpay.md`, `docs/setup/uddoktapay.md`
- Modify: `docs/CHECKLIST.md`, `README.md`, `.env.example`

**Details:**
- Step-by-step setup guides for SSLCommerz, aamarPay, and UddoktaPay sandboxes and live accounts.
- Document `ENCRYPTION_KEY` generation (`node -e "console.log(crypto.randomBytes(32).toString('base64'))"`).
- Update `docs/CHECKLIST.md` marking Plan 5b items completed.
- Run all 6 release gates.

- [ ] **Step 1: Write documentation files** and update checklist.
- [ ] **Step 2: Run full release gate**:
  - `npm run typecheck`
  - `npm run lint`
  - `npm run test:unit`
  - `npm run test:int`
  - `npm run build`
  - `npm run check:bundle`
- [ ] **Step 3: Commit** `docs(payments): gateway setup guides, checklist and Phase 5b completion`
