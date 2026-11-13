# SalesPilot AI — Phase 5: Orders, Payments and Courier Design

Date: 2026-11-11 · Scope: Phase 5 (orders lifecycle, COD, online payment gateways, courier delivery, AI order tools) · Status: draft for review
Builds on: `2026-11-06-foundation-core-data-design.md`, `2026-11-09-ai-agents-tool-calling-design.md`, `2026-11-10-whatsapp-unified-inbox-design.md` (all on `main`).
Branch: `feat/orders-payments`.

## 1. Intent

Turn conversations into fulfilled orders. A customer agrees to buy on WhatsApp (or staff enters the order), stock is held, the customer pays cash on delivery or online through the gateway they pick, staff books the parcel with the courier they pick, and delivery status flows back automatically.

Decisions already made with the user:

- **Scope:** everything this round: orders + COD + online payments + couriers + AI draft-and-confirm.
- **Payment gateways:** SSLCommerz, aamarPay and UddoktaPay, all three, as selectable options.
- **Couriers:** Steadfast, Pathao and RedX, all three, selectable in the UI.
- **Delivery charge:** per-org flat rates, inside Dhaka (default ৳60) and outside Dhaka (default ৳120), editable in Settings. The courier's own charge is recorded separately.
- **Stock:** reserved when a draft is created. Drafts hold stock for 30 minutes; orders awaiting online payment hold for 24 hours. Commit at courier pickup, release on cancel or expiry.
- **Who creates orders:** the AI (draft, then confirm only on the customer's explicit yes) and staff (UI).
- **Credentials:** per org, entered in Integrations, encrypted at rest, never sent to the browser.

### Non-goals (this round)

- Gateway refunds through the API. Staff record a manual refund (reason + audit).
- COD settlement reconciliation with couriers (courier payout reports).
- Bulk booking, pickup scheduling, return-to-merchant workflows beyond the `returned` status.
- Invoices/PDF, discounts engine, coupons, tax.
- Other couriers or gateways (the interfaces make them a new adapter each).

### Honesty rule

Every gateway and courier is built against its documented API and tested against recorded HTTP fixtures plus a mock adapter. **None is claimed verified until a real sandbox run is done**; `docs/CHECKLIST.md` marks them `[~]` until then. The API details in §6 and §7 come from public SDKs and docs that are partly unofficial; each adapter's first plan task is to confirm endpoints and field names against the provider's current docs or sandbox, and record differences in this spec.

---

## 2. Architecture and layering

| Layer | New files | Purpose |
|---|---|---|
| Schemas | `src/schemas/order.ts`, `src/schemas/payment.ts`, `src/schemas/courier.ts`, `src/schemas/integration.ts` | Zod for orders, lines, addresses, settings, gateway and courier accounts, API inputs |
| Permissions | `src/lib/security/permissions.ts` | `orders:read`, `orders:write`, `integrations:manage` |
| Crypto | `src/lib/security/secret-box.ts` | AES-256-GCM encrypt/decrypt of integration credentials with `ENCRYPTION_KEY` |
| Pure domain | `src/services/orders/state-machine.ts`, `src/services/orders/pricing.ts` | Transition table, totals, delivery charge |
| Repositories | `src/repositories/orders.ts`, `order-events.ts`, `payment-attempts.ts`, `gateway-accounts.ts`, `courier-accounts.ts` | Org-scoped data access |
| Order services | `src/services/orders/*` | create/update/confirm/cancel, numbering, reservation, expiry sweep |
| Payments | `src/lib/payments/{types,sslcommerz,aamarpay,uddoktapay,mock}.ts`, `src/services/payments/*` | Gateway adapters + payment-link, session, verification services |
| Couriers | `src/lib/couriers/{types,status-map,steadfast,pathao,redx,mock}.ts`, `src/services/couriers/*` | Courier adapters + booking, status sync, location cache |
| API routes | `src/app/api/orders/**`, `api/integrations/**`, `api/pay/**`, `api/payments/**`, `api/webhooks/couriers/**`, `api/cron/**` | `withApi` for staff routes; dedicated handlers for public/callback routes |
| AI tools | `src/services/agents/tools/{create-draft-order,update-draft-order,confirm-order,send-payment-link,order-status}.ts` | Registered in the existing tool registry |
| UI | `src/app/(dashboard)/orders/**`, `integrations/page.tsx`, `settings/page.tsx`, `src/app/pay/[token]/**`, `src/components/orders/**`, `components/integrations/**` | Orders list/detail/new, booking dialog, integrations, pay page |

Conventions carried over: `withApi` with explicit `permission`, Zod at every boundary, typed `AppError`s with the static error envelope, `writeAuditInTransaction` on every mutation, `assertRateLimit` on public and expensive routes, index tables in code mirrored in `firestore.indexes.json` (table == JSON test), money as integer paisa (`BDT`).

---

## 3. Data model

All collections are top-level, written only by the Admin SDK. Firestore rules deny all client writes; credential-bearing collections (`gatewayAccounts`, `courierAccounts`) and `paymentAttempts` also deny all client reads. Orders are read through the API (no client listeners this round), so rules deny client reads on `orders` and `orderEvents` too.

### 3.1 `orders/{orderId}`

```ts
{
  organizationId: string;
  orderNumber: string;              // "SP-000123", per-org sequence
  status: OrderStatus;              // §4.1
  source: "ai" | "staff";
  createdBy: { kind: "ai"; agentId; sessionId } | { kind: "user"; uid };
  customerId: string;
  customerSnapshot: { name; phoneE164 };
  shippingAddress: { recipientName; phoneE164; line1; area?; district?; zone: "inside_dhaka" | "outside_dhaka"; note? };
  lines: Array<{
    productId; variantId; productName; variantLabel; sku?;
    unitPriceMinor: number; quantity: number; lineTotalMinor: number;
    holdKey: string;                // reservation idempotency key, `ord_{orderId}_r{revision}_l{index}`
    holdState: "pending" | "held" | "released" | "committed";
  }>;                               // 1..MAX_ORDER_LINES (20)
  pendingLines: Lines | null;       // new revision's lines while a draft edit is reserving (sweep releases them too)
  revision: number;
  stockState: "pending" | "held" | "releasing" | "released" | "committing" | "committed"; // lets the sweep finish interrupted release/commit
  subtotalMinor; discountMinor; deliveryChargeMinor; totalMinor; currency: "BDT";
  paymentMethod: "cod" | "online";
  paymentStatus: PaymentStatus;     // §4.2
  payment?: { gateway; attemptId; paidAt; gatewayTxnId; riskFlag?: boolean };
  holdExpiresAt: Timestamp | null;  // set while stock is held for a draft / awaiting_payment
  shipment?: Shipment;              // §7.3
  conversationId?: string;
  notes?: string;
  idempotencyKey: string;           // dedupe for AI/tool retries and double submits
  createdAt; updatedAt; confirmedAt?; cancelledAt?; cancelReason?;
}
```

- **Numbering:** counter doc `orderCounters/{orgId}` incremented in the create transaction; `orderNumber` is also locked via `orderNumbers/{orgId}_{orderNumber}` so it can be looked up from courier webhooks and gateway callbacks that only carry the invoice.
- **Idempotency:** create takes an `idempotencyKey`; lock doc `orderIdempotency/{orgId}_{key}` maps to the existing order, so retries return the same order instead of creating a second one.
- **Line snapshot:** names and prices are frozen at draft time; editing a draft re-prices it.

### 3.2 `orderEvents/{id}`

Timeline entries: `{ organizationId, orderId, type, from?, to?, actor, detail?, createdAt }`. Types: `created`, `updated`, `status_changed`, `payment_link_sent`, `payment_attempt`, `payment_confirmed`, `payment_failed`, `courier_booked`, `courier_status`, `stock_released`, `stock_committed`, `refund_recorded`, `note`. The detail page renders these; audit logs remain the security record.

### 3.3 `orderSettings/{orgId}`

There is no org settings document yet, so order settings get their own doc (keyed by org id, server-only like the rest). When the doc is absent the defaults below apply:

```ts
{ deliveryChargeInsideDhakaMinor: 6000, deliveryChargeOutsideDhakaMinor: 12000,
  draftHoldMinutes: 30, paymentHoldHours: 24, defaultGateway?: GatewayId, defaultCourierAccountId?: string }
```

### 3.4 Integration accounts

`gatewayAccounts/{id}` and `courierAccounts/{id}`:

```ts
{ organizationId; provider; label; mode: "sandbox" | "live" | "mock"; enabled: boolean; isDefault: boolean;
  credentials: SealedSecret;        // encrypted JSON of provider credentials
  webhookSecret?: SealedSecret;     // courier webhooks (§7.4)
  tokenCache?: SealedSecret;        // Pathao OAuth token + expiry
  publicConfig: { ... };            // non-secret: e.g. Pathao storeId, RedX pickupStoreId, UddoktaPay baseUrl
  lastTestedAt?; lastTestResult?: "ok" | "failed"; createdAt; updatedAt }
```

`SealedSecret = { v: 1; iv: string; tag: string; data: string }` (base64). `secret-box.ts` derives a 32-byte key from `ENCRYPTION_KEY` (base64-decoded, must be 32 bytes; startup check rejects anything else). If `ENCRYPTION_KEY` is not set, Integrations shows "encryption key not configured" and only `mock` accounts can be created. API responses expose `{ provider, label, mode, enabled, isDefault, publicConfig, lastTested* , hasCredentials: true }`, never the credentials.

Mode `mock` uses the mock adapter (no network) and is labelled "Mock" everywhere it appears.

### 3.5 `paymentAttempts/{tranId}`

Top-level and keyed by `tranId` because gateway callbacks carry no org context.

```ts
{ organizationId; orderId; gatewayAccountId; gateway: GatewayId;
  tranId: string;                   // 128-bit random, base32; doc id
  expectedAmountMinor; currency: "BDT";
  state: "created" | "redirected" | "paid" | "failed" | "cancelled" | "expired";
  gatewayRef?: string;              // SSLCommerz val_id / bank_tran_id, aamarPay pg_txnid, UddoktaPay invoice_id
  verifiedAt?; failureReason?; raw?: object (verification response, secrets stripped);
  createdAt; updatedAt }
```

### 3.6 `paymentLinks/{tokenHash}`

`{ organizationId, orderId, expiresAt, createdAt, revokedAt? }`. The token is 32 random bytes (base64url) shown once in the link; only its SHA-256 is stored.

### 3.7 `webhookEvents/{provider}_{eventKey}`

Dedupe for courier webhooks and gateway IPNs: created with `create()` (fails if present). `eventKey` is a provider event id when present, otherwise SHA-256 of the raw body. Retained 30 days (swept by the cron).

### 3.8 `courierLocations/{orgId}_{provider}_{level}_{parentId|root}`

Cached city/zone/area lists for Pathao and RedX: `{ items: [{ id, name }], fetchedAt }`, refreshed when older than 7 days.

### 3.9 Indexes

`orders`: `(organizationId, createdAt desc)`, `(organizationId, status, createdAt desc)`, `(organizationId, paymentStatus, createdAt desc)`, `(organizationId, shipment.provider, createdAt desc)`, `(organizationId, customerId, createdAt desc)`, `(status, holdExpiresAt)` for the sweep. `orderEvents`: `(organizationId, orderId, createdAt)`. `paymentAttempts`: `(state, createdAt)` for the reconciler. Kept in code tables + `firestore.indexes.json` with the equality test.

---

## 4. Order lifecycle

### 4.1 `status`

```
draft ──confirm──▶ confirmed ──start──▶ processing ──book/pickup──▶ shipped ──▶ delivered
  │                   │                     │                          │
  └──expire/cancel──▶ cancelled ◀───────────┘◀──── cancel (before pickup)  └──▶ returned
```

- `draft`: stock held, `holdExpiresAt = now + draftHoldMinutes`. Editable.
- `confirmed`: customer agreed. COD → `paymentStatus: cod_pending`, hold cleared (stock stays reserved, no expiry). Online → `paymentStatus: awaiting_payment`, `holdExpiresAt = now + paymentHoldHours`.
- `processing`: staff is preparing it. Online orders can enter only when `paid` (staff can override with an audited "allow unpaid" reason).
- `shipped`: set when the courier reports `picked_up` (or staff marks shipped manually for self-delivery). **Stock is committed here.**
- `delivered`, `returned`: from courier status or staff.
- `cancelled`: allowed from `draft`, `confirmed`, `processing`; releases held stock. Not allowed once shipped (use `returned`). A paid order being cancelled requires recording a manual refund.

The transition table lives in `state-machine.ts` (pure, exhaustively unit-tested). Every service mutation calls `assertTransition(from, to, context)`; no route or tool sets `status` directly.

### 4.2 `paymentStatus`

`cod_pending | cod_collected | awaiting_payment | paid | failed | refunded`. `failed` is non-terminal (the customer can retry until the hold expires). `cod_collected` is set when the courier reports `delivered` for a COD order. `refunded` is staff-recorded.

### 4.3 Stock

Uses `src/services/inventory/stock.ts` unchanged, following its header rules:

- One idempotency key per order line: `ord_{orderId}_r{revision}_l{n}` (a draft edit reserves the new revision's lines first, then releases the old ones).
- After `reserveStock`, check the returned `status`; `released`/`committed` mean nothing is held and the draft creation fails with a clear error.
- Reserve does not check availability; `createDraftOrder` checks `available >= quantity` from inventory first and returns `out_of_stock` per line, then reserves. Contention surfaces `InventoryBusyError` (retryable, 503 with `Retry-After`).
- Reservations across lines are not one transaction (budget limits). The draft is written first (lines `pending`, `holdExpiresAt` set), then lines are reserved. If line k fails, lines 0..k-1 are released and the draft is cancelled (`stock_unavailable`); a crash at any point leaves a draft with `holdExpiresAt` that the sweep cancels, releasing every key (a never-reserved key counts as free). Interrupted release/commit is finished by the sweep via `stockState`.
- Release on cancel and on expiry; commit on `shipped`. All three are idempotent, so the sweep, webhooks and staff actions can race safely.

### 4.4 Expiry sweep

`GET /api/cron/orders/expire` (Vercel Cron, every 10 minutes, listed in `vercel.json`), authorised by `Authorization: Bearer ${CRON_SECRET}` compared in constant time; 401 otherwise, 503 if `CRON_SECRET` is unset. It:

1. Queries `orders where status in (draft, confirmed) and holdExpiresAt <= now` (batches of 50, bounded runtime).
2. For each: transaction re-reads and re-checks; draft → `cancelled` (`cancelReason: "expired"`); confirmed+awaiting_payment → `cancelled` + payment link revoked; then releases stock.
3. Reconciles stale payment attempts (§6.4).
4. Deletes `webhookEvents` older than 30 days and expired `paymentLinks`.

Reads also treat a draft past `holdExpiresAt` as expired (UI shows "expired", tools refuse to confirm it), so correctness never depends on the cron's timing.

### 4.5 Pricing

`pricing.ts` (pure): `subtotal = Σ unitPrice × qty` (sale price when active, as `get_price` does), `deliveryCharge` from the address zone and org settings, `total = subtotal − discount + deliveryCharge`, all integers, with overflow guards. The existing `calculate_order_total` tool switches from `DELIVERY_NOTE` to real delivery charges when an address zone is known.

---

## 5. Order services and API

Services (`src/services/orders/`): `createDraftOrder`, `updateDraftOrder`, `confirmOrder`, `startProcessing`, `markShipped`, `markDelivered`, `markReturned`, `cancelOrder`, `recordManualRefund`, `listOrders`, `getOrder`, `listOrderEvents`. Each takes an `OrderCtx` (`orgId`, actor) and writes audit + order event in the same transaction as the state change.

Staff routes (`withApi`, CSRF, Zod, rate-limited):

| Route | Permission |
|---|---|
| `GET /api/orders` (filters: status, paymentStatus, courier, customerId, date range; cursor pagination) | `orders:read` |
| `POST /api/orders` (staff draft or direct confirm) | `orders:write` |
| `GET/PATCH /api/orders/[id]` | read / write |
| `POST /api/orders/[id]/{confirm,process,ship,deliver,return,cancel,refund}` | `orders:write` |
| `POST /api/orders/[id]/payment-link` | `orders:write` |
| `POST /api/orders/[id]/shipment` (book), `POST .../shipment/refresh` | `orders:write` |
| `GET /api/orders/[id]/events` | `orders:read` |
| `GET/PATCH /api/settings/orders` | `org:manage` |
| `GET/POST /api/integrations/{gateways,couriers}`, `PATCH/DELETE .../[id]`, `POST .../[id]/test` | `integrations:manage` |
| `GET /api/integrations/couriers/[id]/locations?level=&parent=` | `orders:write` |

Role mapping: owner/admin get all; `agent` gets `orders:read`, `orders:write`; `viewer` gets `orders:read`. Only owner/admin get `integrations:manage`.

---

## 6. Payment gateways

### 6.1 Interface

```ts
type GatewayId = "sslcommerz" | "aamarpay" | "uddoktapay";

interface PaymentGateway {
  id: GatewayId;
  testConnection(account): Promise<void>;
  createSession(account, input: {
    tranId; amountMinor; currency: "BDT"; orderNumber;
    customer: { name; phoneE164; email? };
    urls: { success; fail; cancel; ipn };
  }): Promise<{ redirectUrl: string; gatewayRef?: string }>;
  /** Server-to-server truth. Called for every callback; callbacks themselves are never trusted. */
  verify(account, ref: { tranId; gatewayRef? }): Promise<{
    outcome: "paid" | "failed" | "pending";
    amountMinor?; currency?; gatewayTxnId?; risk?: "low" | "high"; raw: object;
  }>;
  /** Extract tranId / gatewayRef from an incoming callback (form or query), without trusting status. */
  parseCallback(req: { query; form }): { tranId?; gatewayRef? };
}
```

Amounts go out as decimal strings from paisa (`12345 → "123.45"`) through one helper; incoming amounts are parsed back to paisa and compared as integers (never floats).

### 6.2 Adapters (to be confirmed against current docs in each adapter's first task)

| | SSLCommerz | aamarPay | UddoktaPay |
|---|---|---|---|
| Credentials | `storeId`, `storePassword` | `storeId`, `signatureKey` | `apiKey`; `baseUrl` (self-hosted panel) in `publicConfig` |
| Create session | `POST {host}/gwprocess/v4/api.php` (form) → `GatewayPageURL` | `POST {host}/jsonpost.php` (JSON, `type: json`) → `payment_url` | `POST {baseUrl}/api/checkout-v2` with `RT-UDDOKTAPAY-API-KEY` → `payment_url`; our `tranId` in `metadata` |
| Callbacks | IPN POST (`val_id`, `tran_id`) + success/fail/cancel POSTs | success/fail POSTs (`mer_txnid`, `pg_txnid`), cancel URL | redirect with `invoice_id`; webhook POST if the panel supports it |
| Verify | `GET {host}/validator/api/validationserverAPI.php?val_id=…` → `status VALID/VALIDATED`, `amount`, `currency`, `tran_id`, `risk_level` | `GET {host}/api/v1/trxcheck/request.php?request_id={tranId}&store_id&signature_key&type=json` → `pay_status: "Successful"`, `amount` | `POST {baseUrl}/api/verify-payment` `{ invoice_id }` → `status: "COMPLETED"`, `amount`, `metadata` |
| Hosts | sandbox `sandbox.sslcommerz.com`, live `securepay.sslcommerz.com` | sandbox `sandbox.aamarpay.com`, live `secure.aamarpay.com` | per account `baseUrl` |
| Minimum | 10 BDT | (confirm) | (confirm) |

UddoktaPay `baseUrl` is entered by an admin, so to limit SSRF it must be `https:` with a DNS hostname: IP literals, `localhost`, and `.local`/`.internal`/`.lan` names are rejected (no DNS resolution check this round; noted as a residual). Requests use a 10 s timeout and do not follow redirects.

Mock gateway: `createSession` redirects to an internal `/pay/[token]/mock` page with Pay / Fail buttons that call the mock callback; `verify` reads the mock outcome. Only allowed in non-production or for `mode: "mock"` accounts.

### 6.3 Flow

1. **Link.** `POST /api/orders/[id]/payment-link` (staff) or the `send_payment_link` tool creates a `paymentLinks` entry for a `confirmed` online order and returns `{APP_URL}/pay/{token}`. Expires with the order's hold.
2. **Pay page** `/pay/[token]` (public, outside the dashboard, server-rendered, `noindex`): shows org name, order number, items, delivery charge, total, and one button per enabled gateway (default first). No address or phone shown. Already-paid / expired / cancelled states render read-only.
3. **Session.** `POST /api/pay/[token]/session { gatewayAccountId }`: rate-limited per IP and per token; checks link valid, order `confirmed` + `awaiting_payment|failed`, account enabled for the org; creates a `paymentAttempts` doc (`created`), calls `createSession`, sets `redirected`, returns `redirectUrl`. Same-origin required (it is called from our page).
4. **Callbacks.** `POST|GET /api/payments/[gateway]/{ipn,success,fail,cancel}`: no session, no CSRF (gateways post cross-site), body size capped, rate-limited per IP. Each one:
   - parses `tranId`/`gatewayRef` via `parseCallback`; unknown `tranId` → logged, 200 (IPN) or redirect to a generic status page;
   - dedupes via `webhookEvents`;
   - calls `confirmPaymentAttempt(tranId, gatewayRef)` (below), whatever the callback claims;
   - success/fail/cancel then redirect (303) to `/pay/{token}/status?t={tranId}`, which reads the real state from Firestore.
5. **`confirmPaymentAttempt`** (the only code that marks an order paid): loads the attempt and its gateway account, calls `verify`, then in one transaction re-reads attempt + order and:
   - `paid` + amount == expected + currency BDT + tranId matches → attempt `paid`, order `paymentStatus: paid`, `payment` block set, `holdExpiresAt` cleared, event + audit. Already paid → no-op.
   - amount or currency mismatch → attempt `failed` (`amount_mismatch`), order flagged for review, security log entry; order not marked paid.
   - `failed` → attempt `failed`, order `paymentStatus: failed` (retry allowed).
   - `pending` → unchanged; the reconciler re-checks.
   - order already `cancelled` (hold expired) but gateway says paid → attempt `paid`, order gets `payment` + `paidAfterCancel: true` flag and a staff alert in the timeline; stock is **not** silently re-reserved.
   - SSLCommerz `risk_level=1` → paid with `riskFlag: true`, shown prominently.

### 6.4 Reconciler

In the cron run: attempts in `created|redirected` older than 15 minutes and younger than 48 hours are re-verified (max 50 per run). This covers gateways without a reliable IPN (aamarPay, UddoktaPay without webhook) and lost callbacks. Older than 48 hours → `expired`.

---

## 7. Couriers

### 7.1 Interface

```ts
type CourierId = "steadfast" | "pathao" | "redx";

interface CourierAdapter {
  id: CourierId;
  requiresLocation: boolean;                                  // pathao, redx
  testConnection(account): Promise<void>;
  listLocations?(account, level: "city" | "zone" | "area", parentId?): Promise<CourierLocation[]>;
  createParcel(account, input: ParcelInput): Promise<{ consignmentId; trackingCode?; chargeMinor?; raw }>;
  findParcelByInvoice?(account, invoice: string): Promise<{ consignmentId; trackingCode? } | null>;
  getStatus(account, consignmentId): Promise<{ status: CourierStatus; rawStatus: string; at?: Date }>;
  verifyWebhook(headers, rawBody, secret): boolean;
  parseWebhook(body): CourierStatusEvent[];                   // { consignmentId?, invoice?, rawStatus, status, at }
  webhookHandshake?(req): Response | null;                    // Pathao integration challenge
}
```

`ParcelInput`: invoice (= `orderNumber`), recipient name/phone/address, location ids (when required), COD amount (`totalMinor` if COD and unpaid, else 0), weight (default 0.5 kg, editable), item description, note.

### 7.2 Normalised status

`booked, pending_pickup, picked_up, in_transit, out_for_delivery, delivered, partial_delivered, returned, cancelled, on_hold, unknown`. `status-map.ts` holds one mapping table per courier (raw → normalised), unit-tested per entry. Unknown raw statuses map to `unknown`, are logged, and never fail a webhook. Order effects: `picked_up|in_transit|out_for_delivery` → order `shipped` (commit stock once); `delivered|partial_delivered` → `delivered` (+ `cod_collected` for COD); `returned` → `returned`; `cancelled` before pickup → shipment cancelled, order back to `processing`.

### 7.3 `shipment` block on the order

```ts
{ courierAccountId; provider: CourierId;
  bookingState: "booking" | "booked" | "booking_unknown" | "failed" | "cancelled";
  bookingLockAt?; consignmentId?; trackingCode?; trackingUrl?;
  status: CourierStatus; rawStatus?; statusAt?; chargeMinor?; codAmountMinor;
  location?: { cityId?; zoneId?; areaId?; areaName? }; weightKg; bookedAt?; lastSyncedAt? }
```

### 7.4 Adapters (to be confirmed against current docs in each adapter's first task)

| | Steadfast | Pathao | RedX |
|---|---|---|---|
| Credentials | `apiKey`, `secretKey` (headers `Api-Key`, `Secret-Key`) | `clientId`, `clientSecret`, `username`, `password`; `storeId` in `publicConfig` | `accessToken` (header `API-ACCESS-TOKEN: Bearer …`); `pickupStoreId` in `publicConfig` |
| Base | `portal.packzy.com/api/v1` (formerly `portal.steadfast.com.bd`) | sandbox `courier-api-sandbox.pathao.com`, live `api-hermes.pathao.com`, paths `/aladdin/api/v1/…` | sandbox `sandbox.redx.com.bd/v1.0.0-beta`, live `openapi.redx.com.bd/v1.0.0-beta` |
| Auth | static keys | OAuth2 `issue-token` (password grant) + refresh; token cached encrypted on the account with expiry, refreshed 5 min early, single-flight per account | static token |
| Locations | none (free-text address) | city → zone → area lists | area list (`delivery_area_id` + name) |
| Create | `POST /create_order` (`invoice`, recipient, `cod_amount`) | `POST /orders` (`store_id`, `merchant_order_id`, recipient, city/zone/area, `delivery_type`, `item_type`, weight, `amount_to_collect`) | `POST /parcel` (customer, `delivery_area_id`, `delivery_area`, `merchant_invoice_id`, `cash_collection_amount`, weight, value) |
| Find by invoice | `status_by_invoice/{invoice}` | (confirm) | (confirm) |
| Status | `status_by_cid/{id}` | order info by consignment | parcel info by tracking id |
| Webhook auth | Bearer token configured in Steadfast portal | integration secret header + challenge handshake | shared secret header (confirm) |

### 7.5 Booking (no double parcels)

`bookShipment(orderId, courierAccountId, location?, weight?)`:

1. Transaction: order must be `confirmed` (COD) or `processing`; online orders must be `paid` unless overridden. If `shipment.bookingState` is `booked`, return it; if `booking` and the lock is younger than 60 s, reject `409 booking_in_progress`; else set `booking` + `bookingLockAt`.
2. Outside the transaction: if the previous state was `booking_unknown`, call `findParcelByInvoice` first and adopt an existing parcel. Otherwise `createParcel` with a 15 s timeout.
3. Transaction: success → `booked`, consignment ids, `status: booked`, event + audit; definite provider error → `failed` with the provider message (sanitised); timeout or 5xx → `booking_unknown` (staff sees "Couldn't confirm. Check before retrying"; retry looks up by invoice first; couriers without lookup show a warning before retry).

### 7.6 Status sync

- **Webhooks** `POST /api/webhooks/couriers/[provider]/[accountId]`: account resolves the org; `verifyWebhook` with the account's webhook secret (constant-time compare); Pathao handshake answered first; raw body capped (64 KB); dedupe via `webhookEvents`; each event is matched to the order by consignment id or invoice and applied only if `at` is newer than `shipment.statusAt` (out-of-order safe); always 200 for authenticated requests (errors logged), 401 for bad auth.
- **Manual refresh** `POST /api/orders/[id]/shipment/refresh` calls `getStatus`, rate-limited per order.
- The Integrations page shows each courier account's webhook URL and lets the admin set or rotate the secret to paste into the courier portal.

### 7.7 Location cache

`listLocations` results are cached in `courierLocations` for 7 days per org/provider/level/parent; the booking dialog's cascading selects call the locations route, which serves the cache or refreshes it.

---

## 8. AI order tools

Added to the tool registry (strict schemas, `normalizeNulls`, existing tool-loop bounds). All are bound to the live contact: on live channels the customer is resolved from `contactPhoneE164`, never from model arguments. On the test channel they run as **dry-run**: they validate, price and return what they would do (`dryRun: true`), but reserve nothing and write nothing.

| Tool | Behaviour |
|---|---|
| `create_draft_order` | Lines (product/variant/qty, catalog-access rules apply), shipping address, zone, payment method. Checks stock, reserves, prices with delivery charge, returns order number, lines, totals, hold expiry. Idempotency key = session id + turn + hash of arguments. One open draft per conversation: a second call updates it. |
| `update_draft_order` | Replace lines/address/payment method on the conversation's open draft; re-reserves and re-prices. |
| `confirm_order` | Requires `customerConfirmed: true` plus a `confirmationQuote` (the customer's own words). The prompt instructs the model to call it only after an explicit yes to the shown summary. Refuses expired, already-confirmed or other-contact drafts. Online orders return a payment link in the result. |
| `send_payment_link` | For the contact's confirmed, unpaid online order; returns the link (the agent includes it in the reply). |
| `get_my_order_status` | The contact's own recent orders: number, status, payment status, tracking code. Nothing about other customers. |

Template prompt additions (Phase 3a templates): always show the full summary (items, delivery charge, total, payment method) before asking for confirmation; never invent prices or delivery charges; COD vs online explained from org settings. Escalate when the customer disputes a price or asks for a discount.

---

## 9. UI

- **`/orders`** (activate the placeholder page): table with order number, customer, total, status badge, payment badge, courier + tracking, created; filter pills (All, Drafts, Confirmed, Processing, Shipped, Delivered, Cancelled) plus payment, courier and date filters; search by order number or phone; cursor pagination. Empty and error states as in the CRM list.
- **`/orders/new`**: customer picker (existing CRM search) or quick-create, line editor with product/variant picker showing available stock, address with zone, payment method, live totals; "Save draft" or "Create confirmed".
- **`/orders/[id]`**: header with status actions allowed by the state machine (only valid buttons shown); cards for lines and totals, customer and address, payment (status, gateway, txn id, copy/send payment link, record refund), shipment (Book courier, tracking, refresh, status history); timeline from `orderEvents`.
- **Book courier dialog**: courier account selector (enabled accounts only, default pre-selected, "Mock" label when applicable) → for Pathao/RedX cascading city/zone/area selects → weight, COD amount (pre-filled, read-only unless staff unlocks), note → Book. Shows `booking_unknown` guidance.
- **`/integrations`**: "Payment gateways" and "Couriers" sections, a card per provider: connect (credentials form; mode sandbox/live/mock), Test connection, Enable, Set default, Disconnect; courier cards show the webhook URL + secret controls. Credentials fields are write-only (show "saved" not the value).
- **`/settings`**: Orders tab for delivery charges, hold durations, default gateway and courier.
- **Inbox customer sidebar**: "Orders" block listing the contact's recent orders with links.
- **`/pay/[token]`, `/pay/[token]/status`, `/pay/[token]/mock`**: public, minimal, mobile-first, org name shown, no dashboard chrome.
- Dashboard overview: orders today, revenue (paid + COD delivered) this month. Real numbers only.

`proxy.ts` already protects `/orders/:path*`; `/pay/*` and all `/api/*` stay outside its matcher. A unit test asserts `/pay` is not in `PROTECTED_PREFIXES`.

---

## 10. Security

- Credentials encrypted with AES-256-GCM (`secret-box.ts`), decrypted only inside adapter calls, never logged (logger redaction list extended with credential field names), never returned by APIs.
- Gateway callbacks: never trusted; server-side verify with amount/currency/tranId match before any paid state. Unknown or mismatched data is logged as a security event.
- Courier webhooks: per-account secret, constant-time compare, size cap, dedupe, monotonic status.
- Public routes (`/pay`, `/api/pay`, `/api/payments`, `/api/webhooks/couriers`, `/api/cron`) have explicit per-IP rate limits and their own tests for 401/404/413/429 paths.
- Payment link tokens: 256-bit, hashed at rest, expire, revocable; the pay page reveals no address or phone.
- Outbound HTTP: one `fetchJson` helper with timeout, no redirects, response size cap, JSON parse guard; errors mapped to typed `IntegrationError` with sanitised messages.
- AI tools cannot pick another customer, cannot mark paid, cannot book couriers, cannot cancel confirmed orders.
- **Auth fix folded in:** `isInvalidSessionError` in `src/lib/auth/session.ts` becomes an allowlist: `auth/session-cookie-expired`, `auth/session-cookie-revoked`, `auth/user-disabled`, `auth/user-not-found`, and `auth/argument-error` whose message mentions the session cookie. Everything else (quota, permission, internal) is rethrown, so an Auth outage no longer logs everyone out.

---

## 11. Testing

- **Unit:** state machine (every allowed and forbidden transition), pricing and money conversion (paisa ↔ decimal strings, overflow), status maps per courier, webhook verifiers, gateway `parseCallback`, secret-box round trip and tamper detection, pay page state mapping, permission matrix additions, index table == JSON.
- **Adapter tests:** each gateway and courier adapter against recorded HTTP fixtures (request shape asserted: URL, headers, body; responses: success, provider error, malformed, timeout). Pathao token refresh and single-flight.
- **Integration (emulator):** draft creation with concurrent customers on limited stock (never oversells), partial reservation failure compensation, expiry sweep vs concurrent confirm, confirm idempotency, cancel releases, ship commits once; payment: verified paid, amount mismatch, replayed IPN, unknown tranId, paid-after-cancel, reconciler; booking: double click, `booking_unknown` then retry adopts existing parcel; webhooks: bad secret, duplicate, out-of-order; route permission and CSRF tests; rules tests for new collections (client read/write denied).
- **AI tools:** dry-run writes nothing; live binding ignores model-supplied customer; confirm refuses without `customerConfirmed`.
- **Manual (not claimed until done):** each gateway's sandbox end to end, each courier's sandbox booking and webhook, UI in a browser.

Gates per plan: `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:int`, `npm run build`, `npm run check:bundle`.

---

## 12. Delivery: three plans on one branch

Each plan ends green and usable on its own.

1. **Plan 5a — Orders core + COD.** Permissions, schemas, state machine, pricing, repositories, numbering, order services with reservation, expiry cron, settings, order API, AI tools (COD; online confirm returns "payment link unavailable" until 5b), Orders UI (list, new, detail without payment/courier cards), inbox sidebar block, auth fix.
2. **Plan 5b — Payment gateways.** Secret-box, integration accounts (gateways), gateway interface, mock + SSLCommerz + aamarPay + UddoktaPay adapters, payment links, pay pages, session and callback routes, `confirmPaymentAttempt`, reconciler, payment card in order detail, Integrations UI for gateways, `send_payment_link`.
3. **Plan 5c — Couriers.** Courier accounts, courier interface, mock + Steadfast + Pathao + RedX adapters, status maps, location cache, booking service, webhooks, refresh, Book courier dialog, shipment card, Integrations UI for couriers, `get_my_order_status` tracking fields.

Docs per plan: `docs/setup/{sslcommerz,aamarpay,uddoktapay,steadfast,pathao,redx}.md` (where to get sandbox credentials, which URLs to register), `.env.example` notes for `ENCRYPTION_KEY` (how to generate 32 bytes) and `CRON_SECRET`, `docs/CHECKLIST.md` Phase 5 items with honest `[x]`/`[~]` marks.

## 13. Open items

- Each provider's exact endpoints/fields/webhook auth are confirmed in that adapter's first task; differences are written back into §6.2 / §7.4.
- Real sandbox credentials are needed for manual verification; the user enters them in Integrations (never in chat).
- Vercel Cron frequency depends on the Vercel plan (Hobby allows daily only). If the project is on Hobby, the sweep runs daily from Vercel and the read-time expiry rule keeps behaviour correct; an external scheduler can call the same route more often.
