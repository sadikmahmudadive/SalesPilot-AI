# Phase 5a — Orders Core + COD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Orders with a guarded lifecycle, stock held from draft to shipment, cash on delivery, an expiry sweep, staff UI and AI draft-and-confirm tools.

**Architecture:** Pure domain modules (`state-machine.ts`, `pricing.ts`) decide transitions and money; `src/services/orders/*` run them in Firestore transactions with audit + timeline events, calling the existing `reserveStock / releaseStock / commitStock` unchanged. Staff use `withApi` routes and TanStack Query screens; the AI uses new tools in the existing registry; a cron route sweeps expired holds.

**Tech Stack:** Next.js 16 App Router (route `params` is a Promise; read `node_modules/next/dist/docs` before writing routes/pages), TypeScript strict, Zod 4, Firebase Admin + emulators, Vitest (`npm run test:unit`, `npm run test:int`), TanStack Query, shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-11-11-orders-payments-courier-design.md` (§3–§5, §8, §9, §10 auth fix, §11, §12 Plan 5a). Read it with this plan.

## Global Constraints

- Money is integer paisa, `currency: "BDT"`; never floats. Display via `formatMoneyMinor`.
- Max 20 lines per order (`MAX_ORDER_LINES`), quantity 1..1000 (`MAX_LINE_QUANTITY`), both imported from `src/services/agents/tools/order-total.ts`.
- Defaults: inside Dhaka ৳60 (`6000`), outside Dhaka ৳120 (`12000`), draft hold 30 minutes, payment hold 24 hours.
- Order number format `SP-000123` (6-digit zero padded, grows past 999999 without truncation).
- Every mutation writes `writeAuditInTransaction` and an `orderEvents` entry in the same transaction as the state change.
- Every route uses `withApi` with an explicit `permission`, Zod body schema and a `rateLimit`; ids that are invalid, missing or of another org are the same `NotFoundError`.
- Stock calls from HTTP paths pass `{ maxAttempts: 3 }`; the cron uses the default budget.
- New collections are server-only: the catch-all deny in `firestore.rules` covers them; rules tests assert it.
- No status is ever set outside `state-machine.ts` transitions.
- Secret-box / integration accounts are **not** in this plan (they move to 5b, where first used).
- Commit after each task with the message given; end commit messages with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Crash between order write and reservations.** A draft whose lines were never reserved (process died) must still be cancelled by the sweep, and releasing a never-reserved key (`NotFoundError`) must count as already free. → Task 6 test `sweep cancels a draft whose lines are still pending`.
2. **Same unit on two lines.** Two lines of the same product/variant must be checked against stock cumulatively, so splitting a line cannot oversell. → Task 4 test `rejects split lines that together exceed stock`.
3. **Confirm racing expiry.** Confirming a draft at the moment its hold expires must either confirm (hold still valid inside the transaction) or fail with `order_expired`; it must never confirm a draft the sweep has cancelled. → Task 5 test `confirm after sweep cancelled fails`.
4. **AI retries.** The model re-sending `create_draft_order` with identical arguments in the same turn must not create a second order or double-reserve. → Task 8 test `same idempotency key returns the same order`.
5. **Discount larger than subtotal / overflow.** Must be a `ValidationError`, never a negative total. → Task 2 test `rejects discount above subtotal`.

---

## File Structure

```
src/lib/auth/session.ts                          (modify) allowlist of session-ending auth codes
src/lib/security/permissions.ts                  (modify) orders:read, orders:write, integrations:manage
src/schemas/customer.ts                          (modify) export phone input schema
src/schemas/order.ts                             (new) enums, Order type, input schemas, settings schema
src/services/orders/state-machine.ts             (new) pure transition table
src/services/orders/pricing.ts                   (new) pure totals + delivery charge
src/repositories/orders.ts                       (new) orderRepo, counters, locks, events, settings refs
src/services/orders/order-indexes.ts             (new) index table; firestore.indexes.json (modify)
src/services/orders/settings.ts                  (new) get/update order settings
src/services/orders/drafts.ts                    (new) createDraftOrder, updateDraftOrder
src/services/orders/lifecycle.ts                 (new) confirm/process/ship/deliver/return/cancel/refund
src/services/orders/stock-holds.ts               (new) release/commit order lines, idempotent
src/services/orders/queries.ts                   (new) listOrders, getOrder, listOrderEvents
src/services/orders/sweep.ts                     (new) expiry + stuck stock sweep
src/app/api/orders/**                            (new) routes
src/app/api/settings/orders/route.ts             (new)
src/app/api/cron/orders/expire/route.ts          (new); vercel.json (new)
src/services/agents/tools/{order-access,create-draft-order,update-draft-order,confirm-order,order-status}.ts (new)
src/schemas/agent.ts, tools/registry.ts, tools/types.ts, config/agent-labels.ts, agents/templates.ts, agents/engine.ts, tools/order-total.ts (modify)
src/hooks/use-orders.ts                          (new)
src/components/orders/*                          (new)
src/app/(dashboard)/orders/{page,new/page,[id]/page}.tsx (new/modify)
src/app/(dashboard)/settings/page.tsx            (modify) Orders tab
src/components/inbox/customer-sidebar.tsx        (modify) Orders block
src/config/nav.ts                                (modify) drop phase 5 marker
docs/CHECKLIST.md, .env.example, docs/setup/vercel.md (modify)
```

---

### Task 1: Session errors allowlist

**Files:**
- Modify: `src/lib/auth/session.ts` (`isInvalidSessionError`)
- Test: `src/lib/auth/session.test.ts`

**Interfaces:** Produces no new names; behaviour of `verifySessionValue` changes.

- [ ] **Step 1: Write failing tests** in `session.test.ts` (`describe("isInvalidSessionError allowlist")`, exercised through `verifySessionValue` with a mocked `verifySessionCookie` rejecting with `{ code }`):
  - `auth/session-cookie-expired`, `auth/session-cookie-revoked`, `auth/user-disabled`, `auth/user-not-found` → resolves `null`.
  - `auth/argument-error` with message `"Decoding Firebase session cookie failed"` → `null`; with an empty message → rejects.
  - `auth/quota-exceeded`, `auth/insufficient-permission`, `auth/internal-error`, `auth/network-request-failed`, a codeless `Error` → rejects (rethrown, not `null`).
- [ ] **Step 2: Run** `npx vitest run --project unit src/lib/auth/session.test.ts` → the quota/permission cases FAIL.
- [ ] **Step 3: Implement** `isInvalidSessionError(err: unknown): boolean` as a `ReadonlySet` allowlist of the four codes plus the `auth/argument-error` + `/session cookie/i` message rule. Update the doc comment to say why (an Auth outage must not log everyone out).
- [ ] **Step 4: Run** unit + `npx vitest run --project integration src/lib/auth/session.int.test.ts` via `npm run test:int` → PASS.
- [ ] **Step 5: Commit** `fix(auth): only session-ending auth errors invalidate a session`

---

### Task 2: Permissions, order schemas, state machine, pricing (pure)

**Files:**
- Modify: `src/lib/security/permissions.ts`, `src/lib/security/permissions.test.ts`, `src/schemas/customer.ts` (export `phoneInputSchema = phoneCore`)
- Create: `src/schemas/order.ts`, `src/schemas/order.test.ts`, `src/services/orders/state-machine.ts`, `state-machine.test.ts`, `src/services/orders/pricing.ts`, `pricing.test.ts`

**Interfaces — Produces:**

```ts
// src/schemas/order.ts
export const ORDER_STATUSES = ["draft","confirmed","processing","shipped","delivered","cancelled","returned"] as const;
export const PAYMENT_STATUSES = ["cod_pending","cod_collected","awaiting_payment","paid","failed","refunded"] as const;
export const PAYMENT_METHODS = ["cod","online"] as const;
export const DELIVERY_ZONES = ["inside_dhaka","outside_dhaka"] as const;
export const LINE_HOLD_STATES = ["pending","held","released","committed"] as const;
export const STOCK_STATES = ["pending","held","releasing","released","committing","committed"] as const;
export type OrderStatus, PaymentStatus, PaymentMethod, DeliveryZone, LineHoldState, StockState;

export const orderLineInputSchema   // { productId: id, variantId?: id, quantity: int 1..MAX_LINE_QUANTITY }
export const shippingAddressSchema  // { recipientName 1..120 trimmed, phone: phoneInputSchema, line1 1..300, area? ≤120, district? ≤120, zone: DeliveryZone, note? ≤500 } -> output adds phoneE164
export const orderCreateSchema      // { customerId, lines: 1..20, shippingAddress, paymentMethod, discountMinor: int 0..1e9 default 0, notes? ≤1000, confirm: boolean default false, idempotencyKey: /^[A-Za-z0-9_-]{8,128}$/ }
export const orderDraftPatchSchema  // partial of { lines, shippingAddress, paymentMethod, discountMinor, notes }, at least one key
export const reasonSchema           // { reason: 1..300 trimmed }
export const processSchema          // { allowUnpaidReason?: 1..300 }
export const orderSettingsSchema    // { deliveryChargeInsideDhakaMinor, deliveryChargeOutsideDhakaMinor: int 0..1_000_000; draftHoldMinutes: int 5..1440; paymentHoldHours: int 1..168 }
export const DEFAULT_ORDER_SETTINGS: OrderSettings = { 6000, 12000, 30, 24 };
export type OrderLineInput, ShippingAddress (z.output, includes phoneE164), OrderCreateInput, OrderDraftPatch, OrderSettings, OrderListQuery  // z.output of the schemas above
export const orderListQuerySchema   // { status?, paymentStatus?, customerId?, q? (order number or phone), from?, to? ISO, limit 1..100 default 25, cursor? }

export interface OrderLine { productId; variantId; productName; variantLabel: string | null; sku: string | null;
  unitPriceMinor; quantity; lineTotalMinor; holdKey: string; holdState: LineHoldState }
export interface Order { id; organizationId; orderNumber; status; source: "ai" | "staff";
  createdBy: { kind: "ai"; agentId: string; sessionId: string } | { kind: "user"; uid: string };
  customerId; customerSnapshot: { name: string; phoneE164: string };
  shippingAddress: ShippingAddress; lines: OrderLine[]; pendingLines: OrderLine[] | null; revision: number;
  subtotalMinor; discountMinor; deliveryChargeMinor; totalMinor; currency: "BDT";
  paymentMethod; paymentStatus; holdExpiresAt: string | null; stockState: StockState;
  conversationId: string | null; notes: string | null; idempotencyKey: string;
  createdAt; updatedAt; confirmedAt: string | null; cancelledAt: string | null; cancelReason: string | null;
  refund: { reason: string; at: string; by: string } | null; allowUnpaidReason: string | null }
export interface OrderEvent { id; organizationId; orderId; type: OrderEventType; from: string | null; to: string | null;
  actor: { kind: "ai" | "user" | "system"; id: string }; detail: string | null; createdAt }
export const ORDER_EVENT_TYPES = ["created","updated","status_changed","stock_released","stock_committed","refund_recorded","note"] as const;

// src/services/orders/state-machine.ts
export type OrderAction = "confirm" | "process" | "ship" | "deliver" | "return" | "cancel" | "expire" | "refund";
export interface TransitionInput { status: OrderStatus; paymentStatus: PaymentStatus; paymentMethod: PaymentMethod; allowUnpaid?: boolean }
export function transition(input: TransitionInput, action: OrderAction): { status: OrderStatus; paymentStatus: PaymentStatus };  // throws OrderTransitionError
export function allowedActions(input: TransitionInput): OrderAction[];
export function initialPaymentStatus(method: PaymentMethod): PaymentStatus; // cod -> cod_pending, online -> awaiting_payment
export class OrderTransitionError extends ConflictError {} // static message "This order can't do that in its current state"
export class OrderExpiredError extends ConflictError {}    // static message "The order hold has expired"

// src/services/orders/pricing.ts
export function priceOrder(input: { lines: Array<{ unitPriceMinor: number; quantity: number }>; discountMinor: number; zone: DeliveryZone; settings: OrderSettings })
  : { subtotalMinor: number; discountMinor: number; deliveryChargeMinor: number; totalMinor: number };
export function deliveryChargeFor(zone: DeliveryZone, settings: OrderSettings): number;
```

Permissions: add `"orders:read"`, `"orders:write"`, `"integrations:manage"` to `PERMISSIONS`; `agent` gets `orders:read` + `orders:write`; `viewer` gets `orders:read`; owner/admin get all (already via `ALL_PERMISSIONS`).

Transition table (exact; everything else throws):

| action | from status | payment condition | to status | to paymentStatus |
|---|---|---|---|---|
| confirm | draft | — | confirmed | unchanged |
| process | confirmed | method cod, or paymentStatus paid, or `allowUnpaid` | processing | unchanged |
| ship | confirmed (cod only), processing | — | shipped | unchanged |
| deliver | shipped | — | delivered | cod_pending → cod_collected, else unchanged |
| return | shipped, delivered | — | returned | unchanged |
| cancel | draft, confirmed, processing | paymentStatus ≠ paid | cancelled | unchanged |
| expire | draft; confirmed with awaiting_payment or failed | — | cancelled | unchanged |
| refund | any | paymentStatus paid | unchanged | refunded |

- [ ] **Step 1: Write failing tests:**
  - `permissions.test.ts`: agent can `orders:write`, viewer can `orders:read` not `orders:write`, only owner/admin can `integrations:manage`.
  - `order.test.ts`: `orderCreateSchema` rejects 21 lines, quantity 0 and 1001, bad idempotency key `"short"`; address output has `phoneE164: "+8801712345678"` for input `"01712345678"`; settings rejects `draftHoldMinutes: 4`; patch rejects `{}`.
  - `state-machine.test.ts`: one `it.each` over **every** (status × paymentStatus × method × action) combination asserting allowed vs `OrderTransitionError` against the table above (build the expected result from the table in the test, not from the implementation); `allowedActions` of a confirmed COD order is `["process","ship","cancel"]` (order of the `OrderAction` union); `cancel` of a paid processing order throws; `refund` then `cancel` succeeds.
  - `pricing.test.ts`: lines `[{1500,2},{999,1}]`, discount 0, inside Dhaka → `{subtotal 3999, delivery 6000, total 9999}`; outside Dhaka uses 12000; `rejects discount above subtotal` (ValidationError, path `discountMinor`); a line with `unitPriceMinor: 1e9, quantity: 1000` × 20 lines stays exact (`Number.isSafeInteger`); non-integer input → ValidationError.
- [ ] **Step 2: Run** `npx vitest run --project unit src/schemas/order.test.ts src/services/orders src/lib/security/permissions.test.ts` → FAIL (modules missing).
- [ ] **Step 3: Implement** the three modules per the Interfaces block. Pure: no `server-only`, no Firestore imports.
- [ ] **Step 4: Run** the same command → PASS; `npm run typecheck` → clean.
- [ ] **Step 5: Commit** `feat(orders): schemas, permissions, state machine and pricing`

---

### Task 3: Repositories, numbering, settings, indexes, rules

**Files:**
- Create: `src/repositories/orders.ts`, `src/services/orders/settings.ts`, `src/services/orders/settings.int.test.ts`, `src/services/orders/order-indexes.ts`, `src/services/orders/order-indexes.test.ts`
- Modify: `firestore.indexes.json`, `tests/rules/tenancy.rules.test.ts`

**Interfaces — Produces:**

```ts
// src/repositories/orders.ts (server-only)
export const ORDERS = "orders", ORDER_EVENTS = "orderEvents", ORDER_COUNTERS = "orderCounters",
  ORDER_NUMBERS = "orderNumbers", ORDER_IDEMPOTENCY = "orderIdempotency", ORDER_SETTINGS = "orderSettings";
export const orderRepo: OrgRepository<Order>;        // filterable: status, paymentStatus, customerId, orderNumber, customerSnapshot.phoneE164; sortable: createdAt
export const orderEventRepo: OrgRepository<OrderEvent>; // filterable: orderId; sortable: createdAt
export function counterRef(orgId: string): DocumentReference;               // orderCounters/{orgId}  { organizationId, next }
export function orderNumberRef(orgId: string, orderNumber: string): DocumentReference; // orderNumbers/{orgId}_{orderNumber} { organizationId, orderId }
export function idempotencyRef(orgId: string, key: string): DocumentReference;   // orderIdempotency/{orgId}_{sha256(key) hex[0..40]} { organizationId, orderId }
export function settingsRef(orgId: string): DocumentReference;              // orderSettings/{orgId}
export function formatOrderNumber(n: number): string;                       // 1 -> "SP-000001"
export function nextOrderNumber(tx: Transaction, orgId: string): Promise<string>; // reads + increments counter (starts at 1)
export function buildOrderEvent(orgId: string, e: Omit<OrderEvent, "id"|"organizationId"|"createdAt">): { ref; data };

// src/services/orders/settings.ts (server-only)
export interface OrderCtx { organizationId: string; uid: string; actor?: { kind: "ai"; agentId: string; sessionId: string } }
export async function getOrderSettings(orgId: string): Promise<OrderSettings>;           // defaults when doc absent or malformed
export async function updateOrderSettings(ctx: OrderCtx, patch: Partial<OrderSettings>): Promise<OrderSettings>; // audited, action "orderSettings.update"
```

Indexes (`ORDER_INDEXES` table, each with `__name__` in the order field's direction, both directions for `createdAt` lists): `orders (organizationId, createdAt)`, `(organizationId, status, createdAt)`, `(organizationId, paymentStatus, createdAt)`, `(organizationId, customerId, createdAt)`, `(organizationId, customerSnapshot.phoneE164, createdAt)`; sweep: `orders (status, holdExpiresAt ASC)`, `orders (stockState, updatedAt ASC)`; `orderEvents (organizationId, orderId, createdAt ASC)`. Follow the pattern and test style of `src/services/crm/customer-indexes.ts` / `.test.ts` (table entries == JSON, no extra `orders`/`orderEvents` entries in JSON).

- [ ] **Step 1: Write failing tests:**
  - `order-indexes.test.ts`: every table entry is in `firestore.indexes.json`; JSON has no other `orders`/`orderEvents` indexes; `formatOrderNumber(1) === "SP-000001"`, `formatOrderNumber(1234567) === "SP-1234567"` (put the number tests in a small `orders.test.ts` beside the repository if `server-only` blocks unit import; the unit project stubs `server-only` via `src/test/server-only-stub.ts`).
  - `settings.int.test.ts`: absent doc → `DEFAULT_ORDER_SETTINGS`; update then get round-trips; update writes one `auditLogs` doc with action `orderSettings.update`; another org's settings unaffected; 20 concurrent `nextOrderNumber` transactions on one org yield 20 distinct consecutive numbers.
  - `tenancy.rules.test.ts`: a signed-in member cannot read or write `orders`, `orderEvents`, `orderCounters`, `orderNumbers`, `orderIdempotency`, `orderSettings` of their own org.
- [ ] **Step 2: Run** `npm run test:unit` and `npm run test:int` → new tests FAIL.
- [ ] **Step 3: Implement** the repository module, settings service and index table; add the JSON entries.
- [ ] **Step 4: Run** `npm run test:unit`, `npm run test:int` → PASS.
- [ ] **Step 5: Commit** `feat(orders): repositories, numbering, settings and indexes`

---

### Task 4: Draft orders with stock holds

**Files:**
- Create: `src/services/orders/drafts.ts`, `src/services/orders/stock-holds.ts`, `src/services/orders/drafts.int.test.ts`

**Interfaces:**
- Consumes: `reserveStock`, `releaseStock` (`src/services/inventory/stock.ts`), `getProduct` (`services/products/products.ts`), `resolveUnit`, `stockUnitIds`, `retailMinor` (`tools/catalog-access.ts`), `customerRepo`, Task 2–3 names.
- Produces:

```ts
export interface DraftInput { customerId: string; lines: OrderLineInput[]; shippingAddress: ShippingAddress; paymentMethod: PaymentMethod;
  discountMinor: number; notes?: string; idempotencyKey: string; source: "ai" | "staff"; conversationId?: string }
export async function createDraftOrder(ctx: OrderCtx, input: DraftInput): Promise<Order>;
export async function updateDraftOrder(ctx: OrderCtx, orderId: string, patch: OrderDraftPatch): Promise<Order>;
// stock-holds.ts
export function holdKey(orderId: string, revision: number, lineIndex: number): string; // `ord_${orderId}_r${revision}_l${lineIndex}`
export async function releaseLines(orgId: string, lines: readonly OrderLine[], options?: StockOptions): Promise<void>; // NotFoundError on a key = already free; ConflictError "already committed" propagates
export async function commitLines(orgId: string, lines: readonly OrderLine[], options?: StockOptions): Promise<void>;
export class OrderLineError extends ValidationError {} // details: [{ path: `lines.${i}`, message: "out_of_stock" | "unavailable" | "invalid_variant" }]
```

Algorithm for `createDraftOrder` (pinned; the order of writes is what makes crashes safe):
1. `assertOrgCtx`; customer must exist in the org (else `NotFoundError`).
2. If `idempotencyRef(org, key)` exists for this org → return that order (no new writes).
3. Load each distinct product; a line is `unavailable` if the product is missing/not `active`, `invalid_variant` per `resolveUnit` rules (variants required when present); read inventory `available` for the distinct units and check **cumulative** quantity per unit → `out_of_stock`. Any failure → `OrderLineError` listing every failing line, nothing written.
4. Price with `retailMinor` and `priceOrder` (settings from `getOrderSettings`).
5. Transaction A: re-check idempotency lock (exists → return existing); `nextOrderNumber`; create order (`status: draft`, `paymentStatus: initialPaymentStatus(method)`, `revision: 1`, lines with `holdState: "pending"`, `stockState: "pending"`, `holdExpiresAt: now + draftHoldMinutes`), number lock, idempotency lock, event `created`, audit `order.create`.
6. Reserve lines in order with `{ maxAttempts: 3 }`; check result `status === "reserved"`. On any failure: `releaseLines` for the lines reserved so far, then Transaction C: `transition(..., "cancel")` with `cancelReason: "stock_unavailable"`, all lines `released`, `stockState: "released"`, `holdExpiresAt: null`; rethrow (`InsufficientStockError` → `OrderLineError` `out_of_stock` on that line; `InventoryBusyError` unchanged).
7. Transaction B: lines `held`, `stockState: "held"`. Return the order.

`updateDraftOrder`: only `draft` and not past `holdExpiresAt` (else `OrderTransitionError` / `OrderExpiredError`). Transaction 1 writes `pendingLines` (new revision keys, `pending`) and `revision + 1`; reserve them; Transaction 2 swaps `lines = pendingLines (held)`, `pendingLines = null`, re-prices, extends `holdExpiresAt`, event `updated`, audit; then `releaseLines(old lines)`. On reserve failure release the reserved new lines and clear `pendingLines` (the old lines stay held). A patch without `lines` skips the stock steps.

- [ ] **Step 1: Write failing tests** (`drafts.int.test.ts`, emulator; seed products/inventory with the existing product service and `adjustStock`):
  - creates `SP-000001` with lines held: inventory `reserved` equals the quantities, `stockState: "held"`, `holdExpiresAt` ≈ now + 30 min, one `created` event, one audit.
  - `same idempotency key returns the same order` (second call: same id, reserved unchanged).
  - `rejects split lines that together exceed stock` (stock 3, lines 2 + 2 of the same unit → `OrderLineError` with `out_of_stock` on line 1, nothing written).
  - archived product → `unavailable`; product with variants and no `variantId` → `invalid_variant`.
  - race: stock 5, ten concurrent drafts of 1 each from different keys → exactly 5 orders with `stockState: "held"`, the rest fail or end `cancelled` with `stock_unavailable`; inventory `reserved` is 5.
  - another org's customer id → `NotFoundError`.
  - update replaces lines: old reservations `released`, new `reserved`, totals re-priced, `revision: 2`.
  - update of an expired draft → `OrderExpiredError`.
- [ ] **Step 2: Run** `npm run test:int` → FAIL.
- [ ] **Step 3: Implement** `drafts.ts` and `stock-holds.ts` per the algorithm.
- [ ] **Step 4: Run** `npm run test:int` → PASS.
- [ ] **Step 5: Commit** `feat(orders): draft orders with stock holds`

---

### Task 5: Lifecycle transitions and queries

**Files:**
- Create: `src/services/orders/lifecycle.ts`, `src/services/orders/queries.ts`, `src/services/orders/lifecycle.int.test.ts`, `src/services/orders/queries.int.test.ts`

**Interfaces — Produces:**

```ts
export async function confirmOrder(ctx: OrderCtx, orderId: string): Promise<Order>;  // draft, holdExpiresAt > now (inside tx) else ConflictError("order_expired"); cod -> holdExpiresAt null; online -> now + paymentHoldHours; pendingLines must be null
export async function startProcessing(ctx: OrderCtx, orderId: string, opts?: { allowUnpaidReason?: string }): Promise<Order>;
export async function markShipped(ctx: OrderCtx, orderId: string): Promise<Order>;   // tx: transition + stockState "committing"; commitLines; tx: lines committed, stockState "committed", event stock_committed
export async function markDelivered(ctx: OrderCtx, orderId: string): Promise<Order>;
export async function markReturned(ctx: OrderCtx, orderId: string): Promise<Order>;  // no stock change (restock is a manual inventory adjustment; say so in the event detail)
export async function cancelOrder(ctx: OrderCtx, orderId: string, reason: string, action?: "cancel" | "expire"): Promise<Order>; // tx: transition + stockState "releasing" + holdExpiresAt null; releaseLines(lines + pendingLines); tx: released + event stock_released
export async function recordManualRefund(ctx: OrderCtx, orderId: string, reason: string): Promise<Order>;
export async function getOrder(ctx: OrderCtx, orderId: string): Promise<Order & { expired: boolean }>; // expired = draft/awaiting hold past holdExpiresAt
export async function listOrders(ctx: OrderCtx, q: OrderListQuery): Promise<{ items: Order[]; nextCursor: string | null }>;
export async function listOrderEvents(ctx: OrderCtx, orderId: string): Promise<OrderEvent[]>; // ascending, max 200
export async function listCustomerOrders(ctx: OrderCtx, customerId: string, limit?: number): Promise<Order[]>; // newest first, default 5
```

Every function: one transaction for the status change (re-read, `fromSnapshot(snap, orgId)` null → `NotFoundError`, `transition(...)`, write, event `status_changed` with `from`/`to`, audit `order.<action>`). Actor in events: `ctx.actor` (AI) or `{ kind: "user", id: ctx.uid }`. `listOrders` `q`: if it matches `/^SP-\d+$/i` filter `orderNumber ==` upper-cased; else if `normalizePhone(q)` succeeds filter `customerSnapshot.phoneE164 ==`; else `ValidationError` on `q`.

- [ ] **Step 1: Write failing tests:**
  - confirm COD: `status confirmed`, `paymentStatus cod_pending`, `holdExpiresAt null`; confirm online: `awaiting_payment`, hold ≈ now + 24 h.
  - `confirm after sweep cancelled fails` (cancel with action `expire`, then confirm → `OrderTransitionError`); confirm with `holdExpiresAt` in the past → `OrderExpiredError` (pin the clock with `src/test/pin-clock.ts`).
  - process online unpaid → throws; with `allowUnpaidReason` → ok and reason stored.
  - ship commits: inventory `onHand` and `reserved` both drop by the quantities once; calling `markShipped` again throws a transition error and stock is unchanged.
  - deliver COD → `cod_collected`.
  - cancel releases: `reserved` back to 0, `stockState: "released"`; cancel shipped → throws; cancel a paid order → throws, after `recordManualRefund` → ok.
  - every mutation wrote exactly one audit and one `status_changed` event; failing audit (seam as in `customers.int.test.ts`) persists nothing.
  - queries: list by status, by `q: "SP-000002"`, by phone; another org's order → `NotFoundError`; events ascending; `getOrder` marks an expired draft `expired: true`.
- [ ] **Step 2: Run** `npm run test:int` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm run test:int` → PASS.
- [ ] **Step 5: Commit** `feat(orders): lifecycle transitions and queries`

---

### Task 6: Expiry sweep and cron route

**Files:**
- Create: `src/services/orders/sweep.ts`, `src/services/orders/sweep.int.test.ts`, `src/app/api/cron/orders/expire/route.ts`, `src/app/api/cron/orders/expire/route.int.test.ts`, `vercel.json`
- Modify: `.env.example` (`CRON_SECRET`: how to generate, `openssl rand -base64 32`), `docs/setup/vercel.md` (cron section incl. Hobby = daily limitation)

**Interfaces — Produces:**

```ts
export interface SweepResult { expired: number; released: number; committed: number; errors: number }
export async function sweepOrders(now?: Date, opts?: { batch?: number }): Promise<SweepResult>; // batch default 50
```

Sweep steps: (1) `orders where status in ["draft","confirmed"] and holdExpiresAt <= now` → for each, skip confirmed orders whose `paymentStatus` is not `awaiting_payment|failed`; `cancelOrder` with action `expire`, reason `"expired"`, system actor (`uid: "system:sweep"`); (2) `stockState == "releasing" and updatedAt <= now − 5 min` → `releaseLines` then mark released; (3) `stockState == "committing"` likewise → `commitLines` then mark committed; (4) `stockState == "pending" and status == "cancelled"` same as (2). Each order is isolated in try/catch (`errors++`, `logger.warn` with order id only).

Route: `GET` only; not `withApi` (no session). `Authorization` header must equal `Bearer ${CRON_SECRET}` compared with `timingSafeEqual` over equal-length buffers; unset `CRON_SECRET` → 503 `{ error: { code: "NOT_CONFIGURED" } }`; mismatch → 401; success → 200 `SweepResult`. `export const dynamic = "force-dynamic"`. `vercel.json`: `{ "crons": [{ "path": "/api/cron/orders/expire", "schedule": "*/10 * * * *" }] }`.

- [ ] **Step 1: Write failing tests:**
  - `sweep cancels a draft whose lines are still pending` (write a draft doc directly with `holdState: "pending"` keys never reserved, hold past → after sweep `cancelled`, no error).
  - expired held draft → cancelled, stock released; unexpired draft untouched; confirmed COD (`holdExpiresAt null`) untouched; confirmed online with expired hold → cancelled.
  - stuck `releasing` order older than 5 minutes → released; one younger than 5 minutes untouched.
  - one corrupt order (missing lines) counts in `errors` and does not stop the others.
  - route: no header → 401; wrong secret → 401; unset secret → 503; right secret → 200 with counts.
- [ ] **Step 2: Run** `npm run test:int` → FAIL.
- [ ] **Step 3: Implement** sweep, route, `vercel.json`, docs.
- [ ] **Step 4: Run** `npm run test:int` → PASS.
- [ ] **Step 5: Commit** `feat(orders): hold expiry sweep and cron route`

---

### Task 7: Order and settings API routes

**Files:**
- Create: `src/app/api/orders/route.ts`, `src/app/api/orders/[id]/route.ts`, `src/app/api/orders/[id]/[action]/route.ts`, `src/app/api/orders/[id]/events/route.ts`, `src/app/api/settings/orders/route.ts`, `src/app/api/orders/route.int.test.ts`

**Interfaces:**
- Consumes: Tasks 4–5 services, `withApi`.
- Produces (HTTP, consumed by Task 9 hooks):

| Method + path | Permission | Body | Returns | Rate limit name / limit per 60 s |
|---|---|---|---|---|
| `GET /api/orders?status&paymentStatus&customerId&q&from&to&limit&cursor` | orders:read | — | `{ items, nextCursor }` | `orders.list` 120 |
| `POST /api/orders` | orders:write | `orderCreateSchema` | 201 `Order` (`confirm: true` → created then confirmed) | `orders.create` 30 |
| `GET /api/orders/[id]` | orders:read | — | `Order & { expired }` | — |
| `PATCH /api/orders/[id]` | orders:write | `orderDraftPatchSchema` | `Order` | `orders.update` 60 |
| `POST /api/orders/[id]/[action]` action ∈ confirm, process, ship, deliver, return, cancel, refund | orders:write | confirm/ship/deliver/return: none; process: `processSchema`; cancel/refund: `reasonSchema` | `Order` | `orders.action` 60 |
| `GET /api/orders/[id]/events` | orders:read | — | `{ items: OrderEvent[] }` | — |
| `GET /api/settings/orders` | orders:read | — | `OrderSettings` | — |
| `PATCH /api/settings/orders` | org:manage | `orderSettingsSchema.partial()` (≥1 key) | `OrderSettings` | `orders.settings` 20 |

Unknown `[action]` → 404 (`NotFoundError`). Query string parsed with `orderListQuerySchema` (invalid → 400 envelope). Staff create sets `source: "staff"`, `createdBy: { kind: "user", uid }`. Read the route-handler doc in `node_modules/next/dist/docs` for dynamic segments before writing `[action]`.

- [ ] **Step 1: Write failing tests** (`route.int.test.ts`, following `src/app/api/customers/route.int.test.ts` for auth-emulator sessions):
  - viewer: GET list 200, POST 403; agent: POST 201; unauthenticated: 401; cross-site POST (bad `Origin`) 403.
  - POST with `confirm: true` returns `status: "confirmed"`; second POST with same `idempotencyKey` returns the same id (201 or 200, same body id).
  - `POST /api/orders/{id}/cancel` with `{ reason: "" }` → 400; unknown action `/explode` → 404; another org's id → 404.
  - settings PATCH by agent → 403, by owner → 200.
- [ ] **Step 2: Run** `npm run test:int` → FAIL.
- [ ] **Step 3: Implement** the routes as thin `withApi` wrappers (doc comment at top listing method → body → response like the customers route).
- [ ] **Step 4: Run** `npm run test:int`, `npm run build` → PASS.
- [ ] **Step 5: Commit** `feat(orders): order and settings API routes`

---

### Task 8: AI order tools

**Files:**
- Create: `src/services/agents/tools/order-access.ts`, `create-draft-order.ts`, `update-draft-order.ts`, `confirm-order.ts`, `order-status.ts`, `src/services/agents/tools/order-tools.int.test.ts`
- Modify: `src/schemas/agent.ts` (`TOOL_NAMES`, `WRITE_TOOLS`), `tools/registry.ts`, `tools/types.ts` (`DryRunAction.kind` adds `"create_order" | "update_order" | "confirm_order"`), `src/config/agent-labels.ts`, `src/services/agents/templates.ts`, `src/services/agents/engine.ts` (summary cases), `tools/order-total.ts`, their existing tests (`registry.test.ts`, `templates.test.ts`, `schemas/agent.test.ts`)

**Interfaces:**
- Consumes: `createDraftOrder`, `updateDraftOrder`, `confirmOrder`, `listCustomerOrders`, `getOrderSettings`, `findCustomerByPhone`, `mayAccessPhone`, `isProductInScope`, `isLiveChannel`, `toolFailure`.
- Produces: tool names `create_draft_order`, `update_draft_order`, `confirm_order`, `get_my_order_status` (all four in `TOOL_NAMES`; the first three in `WRITE_TOOLS`).

```ts
// order-access.ts
export async function contactCustomer(ctx: ToolContext): Promise<CustomerDoc | null>; // live: by ctx.contactPhoneE164 only; test channel: null (tools then dry-run)
export async function openDraftFor(ctx: ToolContext, customerId: string): Promise<Order | null>; // newest draft of this customer created by this session (createdBy.sessionId === ctx.sessionId), not expired
export function toolIdempotencyKey(ctx: ToolContext, args: unknown): string; // `ai_${sha256(sessionId + stableJson(args)) hex[0..40]}`
```

Tool inputs (strict schemas; no customer id or phone arguments — the customer is always the contact):
- `create_draft_order`: `{ lines: [{ productId, variantId?, quantity }] (1..20), address: { recipientName, line1, area?, district?, zone }, paymentMethod: "cod" | "online" }`. Recipient phone = contact phone. Products outside the agent's `productAccess` → that line `unavailable`. If an open draft exists for this session → behaves as `update_draft_order`. Output: `{ orderNumber, lines: [{ name, quantity, lineTotalText }], subtotalText, deliveryChargeText, totalText, paymentMethod, holdMinutes }`.
- `update_draft_order`: same fields all optional; `not_found` when no open draft.
- `confirm_order`: `{ customerConfirmed: boolean, confirmationQuote: string 1..200 }`; `customerConfirmed !== true` → `invalid` with static message "Ask the customer to confirm the summary first."; online orders return `paymentLinkAvailable: false` and `note: "Online payment links are not available yet; offer cash on delivery or tell the customer the team will send a link."` (5b replaces this).
- `get_my_order_status`: `{}` → `{ orders: [{ orderNumber, status, paymentStatus, totalText, createdAt }] }` up to 5.

Rules: test channel → no writes; return `dryRunAction` with the priced summary (`create_draft_order`/`update_draft_order` still check stock read-only and price via `priceOrder`); live channel without a resolvable contact customer → `denied` (`CONTACT_DENIED`). Errors map: `OrderLineError` → `invalid` with a static message per code ("One item is out of stock." / "One item isn't available." / "Choose a size or colour for one item."), `InventoryBusyError` → `failed`, `OrderExpiredError` → `invalid` "The order hold expired; create the order again." Actor passed to services: `{ kind: "ai", agentId: ctx.agent.id, sessionId: ctx.sessionId }`, `uid: ctx.actorUid`.

Also: `order-total.ts` takes an optional `zone` input; when given, output adds `deliveryChargeText` and `totalText` from org settings and drops `deliveryNote`; without it keeps the note, re-worded to "Delivery charge depends on the address; ask whether it is inside or outside Dhaka." The `order_management` template adds the four tools and replaces "You cannot take payment or confirm delivery; delivery charges are not available yet." with: show the full summary (items, delivery charge, total, payment method), ask for an explicit yes, then call `confirm_order` with the customer's words; never invent prices or charges; escalate on discount requests. Labels: "Create draft order", "Update draft order", "Confirm order", "Order status" with one-line descriptions.

- [ ] **Step 1: Write failing tests** (`order-tools.int.test.ts` plus updates to `registry.test.ts`/`templates.test.ts`):
  - test channel `create_draft_order` → `ok`, `dryRunAction.kind === "create_order"`, no `orders` docs, inventory `reserved` 0.
  - whatsapp with contact → order created for the contact customer, `source: "ai"`, `createdBy.sessionId` set, recipient phone = contact.
  - `same idempotency key returns the same order`: identical args twice in one session → one order, reserved once.
  - second create in the same session with different lines updates the open draft (one order, revision 2).
  - live without `contactPhoneE164` → `denied`; contact with no customer record → `denied`.
  - `confirm_order` with `customerConfirmed: false` → `invalid`; with true → order `confirmed`; on an expired draft → `invalid` hold message.
  - `get_my_order_status` returns only the contact's orders (seed another customer's order; it is absent).
  - out-of-scope category line → `invalid` "One item isn't available."
  - `calculate_order_total` with `zone: "outside_dhaka"` adds ৳120 delivery.
  - registry: every `TOOL_NAMES` entry is implemented; `WRITE_TOOLS` contains the three write tools.
- [ ] **Step 2: Run** `npm run test:unit`, `npm run test:int` → FAIL.
- [ ] **Step 3: Implement** tools, registry wiring, labels, template text, engine summary cases (`create_draft_order`/`update_draft_order`: "Draft SP-…: total …"; `confirm_order`: "Confirmed SP-…"; `get_my_order_status`: "N orders").
- [ ] **Step 4: Run** `npm run test:unit`, `npm run test:int` → PASS.
- [ ] **Step 5: Commit** `feat(agents): order draft, confirm and status tools`

---

### Task 9: Orders list page and hooks

**Files:**
- Create: `src/hooks/use-orders.ts`, `src/hooks/use-orders.test.ts`, `src/components/orders/order-list.tsx`, `src/components/orders/order-filters.tsx`, `src/components/orders/order-badges.tsx`, `src/config/order-labels.ts`, `src/config/order-labels.test.ts`
- Modify: `src/app/(dashboard)/orders/page.tsx` (replace `ComingLater`), `src/config/nav.ts` + `nav.test.ts` (remove `phase: 5` from Orders)

**Interfaces — Produces:**

```ts
// use-orders.ts (client) — mirror use-customers.ts / use-paged-list
export interface OrderListParams { status?: OrderStatus | ""; paymentStatus?: PaymentStatus | ""; q?: string; customerId?: string; from?: string; to?: string; limit?: number; cursor?: string }
export function orderListQueryString(params: OrderListParams): string;   // pure, tested
export function useOrderList(params: OrderListParams);                    // infinite query, key ["orders", params]
export function useOrder(id: string);                                     // key ["orders", id]
export function useOrderEvents(id: string);                               // key ["orders", id, "events"]
export function useOrderAction(id: string);   // mutation { action, body? } -> invalidates ["orders"]
export function useCreateOrder();             // mutation -> Order
export function useUpdateDraft(id: string);
export function useOrderSettings(); export function useUpdateOrderSettings();
// order-labels.ts
export const ORDER_STATUS_LABELS: Record<OrderStatus, string>;   // "Draft", "Confirmed", "Processing", "Shipped", "Delivered", "Cancelled", "Returned"
export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string>; // "COD pending", "COD collected", "Awaiting payment", "Paid", "Payment failed", "Refunded"
export const ACTION_LABELS: Record<OrderAction, string>;          // "Confirm", "Start processing", "Mark shipped", "Mark delivered", "Mark returned", "Cancel", "Expire", "Record refund"
```

List page: filter pills All / Drafts / Confirmed / Processing / Shipped / Delivered / Cancelled, payment status select, search input (order number or phone; invalid → inline hint, no request), table columns Order, Customer, Total, Status, Payment, Created; row links to `/orders/[id]`; "New order" button (hidden without `orders:write`); empty, loading (`ListSkeleton`) and error (`QueryErrorState`) states as in the customer list; drafts past hold show an "Expired" badge.

- [ ] **Step 1: Write failing tests:** `order-labels.test.ts` (every enum value has a label); `use-orders.test.ts` (`orderListQueryString` drops blank values, encodes `q`, keeps cursor); `nav.test.ts` (Orders has no `phase`).
- [ ] **Step 2: Run** `npm run test:unit` → FAIL.
- [ ] **Step 3: Implement** hooks, labels, components and page (server page reads permissions like `customers/page.tsx`).
- [ ] **Step 4: Run** `npm run test:unit`, `npm run typecheck`, `npm run lint`, `npm run build` → PASS.
- [ ] **Step 5: Commit** `feat(orders): orders list page`

---

### Task 10: New order form and order detail page

**Files:**
- Create: `src/app/(dashboard)/orders/new/page.tsx`, `src/app/(dashboard)/orders/[id]/page.tsx`, `src/components/orders/order-form.tsx`, `src/components/orders/order-form-model.ts`, `src/components/orders/order-form-model.test.ts`, `src/components/orders/line-editor.tsx`, `src/components/orders/order-detail.tsx`, `src/components/orders/order-timeline.tsx`, `src/components/orders/action-bar.tsx`, `src/components/orders/reason-dialog.tsx`

**Interfaces:**
- Consumes: Task 9 hooks/labels, `allowedActions`, `priceOrder`, `deliveryChargeFor`, existing customer search hook and product list hook.
- Produces:

```ts
// order-form-model.ts (pure)
export interface OrderFormValues { customerId: string; lines: Array<{ productId: string; variantId: string; quantity: string }>; address: {...}; paymentMethod: PaymentMethod; discount: string; notes: string }
export function toCreateBody(values: OrderFormValues, idempotencyKey: string, confirm: boolean): z.input<typeof orderCreateSchema>; // discount via parseTakaToMinor
export function previewTotals(values: OrderFormValues, unitPrices: Map<string, number>, settings: OrderSettings): ReturnType<typeof priceOrder> | null;
```

New order: customer picker (CRM search) with address prefilled from the customer, line editor (product → variant → quantity, shows available stock and unit price), zone radio, payment method radio, discount, notes, live totals; buttons "Save draft" and "Create confirmed"; the idempotency key is generated once per form mount (`crypto.randomUUID()` stripped of `-`) so a double click returns the same order; submit disabled while pending. Server line errors (`lines.N`) map to the matching row.

Detail: header (order number, status + payment badges, expired badge), action bar showing only `allowedActions` (cancel and refund open `reason-dialog`; process on an unpaid online order asks for an override reason), cards: Lines & totals, Customer & address, Payment (method, status, refund info; "Online payment links arrive in a later update" placeholder for online orders), Timeline (`orderEvents`). Viewers see no actions.

- [ ] **Step 1: Write failing tests** (`order-form-model.test.ts`): `toCreateBody` converts `"150.50"` discount to `15050`, drops blank optional address fields, passes the key; `previewTotals` returns null while a line lacks a price and matches `priceOrder` otherwise.
- [ ] **Step 2: Run** `npm run test:unit` → FAIL.
- [ ] **Step 3: Implement** the model, components and pages.
- [ ] **Step 4: Run** `npm run test:unit`, `npm run typecheck`, `npm run lint`, `npm run build` → PASS.
- [ ] **Step 5: Commit** `feat(orders): new order form and order detail page`

---

### Task 11: Settings Orders tab, inbox orders block, overview KPIs, docs

**Files:**
- Create: `src/components/settings/order-settings-form.tsx`, `src/components/settings/order-settings-model.ts`, `order-settings-model.test.ts`, `src/app/api/customers/[id]/orders/route.ts`, `src/app/api/customers/[id]/orders/route.int.test.ts`
- Modify: `src/app/(dashboard)/settings/page.tsx`, `src/components/inbox/customer-sidebar.tsx`, `src/services/dashboard/overview.ts` (+ tests, KPI grid), `src/services/orders/order-indexes.ts`, `firestore.indexes.json`, `docs/CHECKLIST.md`, `README.md` (orders section, if README lists modules)

**Interfaces:**
- Consumes: `useOrderSettings`, `useUpdateOrderSettings`, `listCustomerOrders`.
- Produces: `GET /api/customers/[id]/orders` (`orders:read`) → `{ items: Order[] }` (5 newest); `useCustomerOrders(customerId)` added to `use-orders.ts`.

Dashboard overview (`src/services/dashboard/overview.ts`, `METRICS`): add `ordersToday` (orders created since local midnight Asia/Dhaka, excluding `draft`/`cancelled`) and `revenueMonthMinor` (sum of `totalMinor` this calendar month for `paymentStatus in [paid, cod_collected]`, via an aggregate `sum` query); add the index entries both need to `ORDER_INDEXES` + JSON; KPI cards show them with `formatMoneyMinor`; a failing metric stays `{ ok: false }` like the others. Tests: extend `overview.int.test.ts` (draft and cancelled excluded, unpaid COD excluded from revenue).

Settings Orders tab: delivery charges in taka (two inputs via `parseTakaToMinor`), draft hold minutes, payment hold hours; save disabled for non-`org:manage` roles. Inbox sidebar: "Orders" block for the linked customer (order number, status badge, total, link), "No orders yet" when empty, hidden when the conversation has no customer.

`docs/CHECKLIST.md`: replace "5. Orders, payments, courier: not started" with "5. Orders, payments, courier: 5a orders + COD built (tests pass); 5b payments and 5c couriers not started", and add Phase 5a task lines (Tasks 1–11) using the legend honestly: services/routes/tools `[x]` with their test files; UI tasks `[~]` ("not seen in a browser"). Also correct the Phase 4 inbox UI items to `[~]` where their UI or real WhatsApp delivery was never seen (keep `[x]` for items backed only by passing tests).

- [ ] **Step 1: Write failing tests:** `order-settings-model.test.ts` (taka ↔ paisa round trip, `"60"` → `6000`, invalid `"6o"` → error message); `route.int.test.ts` (viewer 200 with own-org customer orders only, another org's customer → 404).
- [ ] **Step 2: Run** `npm run test:unit`, `npm run test:int` → FAIL.
- [ ] **Step 3: Implement** and update docs.
- [ ] **Step 4: Run all gates:** `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run test:int`, `npm run build`, `npm run check:bundle` → all PASS. (Windows: check ports 8085/9199 are free first with `Get-NetTCPConnection -LocalPort 8085,9199 -ErrorAction SilentlyContinue`; stop leaked emulator `java` processes after the run.)
- [ ] **Step 5: Commit** `feat(orders): order settings, inbox orders block and docs`
