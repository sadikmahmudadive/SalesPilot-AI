# Checklist

Status of sub-projects 1 to 8 and of this plan (`docs/superpowers/plans/2026-11-06-foundation-core-data.md`).

Legend:

- `[x]` fully verified by automated tests that passed in the final gate. Where Firebase is involved, "verified" means against the local emulators; the real project is listed under "Unverified".
- `[~]` logic is tested, but the UI has not been seen in a browser, or the real external service (Cloudinary, a real Firebase project, Vercel) has not been exercised. The note says which.
- `[ ]` not started.

No UI has been run in a browser and no real external service has been used (see "Unverified").

## Sub-projects

- [~] 1. Foundation (auth, organizations, roles, security baseline, dashboard shell): logic tested, UI unverified
- [~] 2. Core data (CRM, products, inventory, uploads, overview): logic tested, UI and real Cloudinary unverified
- [~] 3. AI agents (Phase 3a: tool calling, bounded engine, test console): logic tested, UI and real OpenAI unverified (Phase 3b: RAG roadmap)
- [~] 4. WhatsApp and unified inbox: logic, webhook signature and routes tested (Phase 4); inbox screens not seen in a browser and no real WhatsApp message ever sent or received
- [~] 5. Orders, payments, courier: 5a orders + COD and 5b payments built (all tests pass; UI not seen in a browser); 5c couriers not started
- [ ] 6. Voice calls: not started
- [ ] 7. Follow-ups and automations (n8n): not started
- [ ] 8. Analytics and integrations settings: not started

## This plan, by task

Unit tests are `*.test.ts`; integration tests (`*.int.test.ts`) and rules tests run against the Firestore and Auth emulators via `npm run test:int`.

- [x] 1. Scaffold, tooling, git: `npm run typecheck`, `npm run lint`, `npm run build` pass
- [x] 2. Environment validation: `src/config/env.test.ts`, `src/config/env.client.test.ts`
- [x] 3. Permission matrix: `src/lib/security/permissions.test.ts`
- [x] 4. Errors, logger, API envelope: `src/lib/errors.test.ts`, `src/lib/logger.test.ts`, `src/lib/api/respond.test.ts`
- [x] 5. Firebase SDKs and emulator config: `src/lib/firebase/admin.test.ts`, `src/lib/firebase/admin.int.test.ts`
- [x] 6. Rate limiter and audit log: `src/lib/security/rate-limit.int.test.ts`, `src/lib/security/audit.int.test.ts`
- [x] 7. Session auth and route redirects: `src/lib/auth/session.test.ts`, `src/lib/auth/session.int.test.ts`, `src/lib/auth/redirect.test.ts`, `src/app/api/auth/session/route.int.test.ts`, `src/proxy.test.ts`
- [x] 8. Registration atomicity and `withApi`: `src/services/organizations/register.int.test.ts`, `src/app/api/organizations/register/route.int.test.ts`, `src/lib/api/handler.test.ts`, `src/lib/api/handler.int.test.ts`, `src/lib/api/csrf.test.ts`
- [x] 9. Firestore rules: `tests/rules/tenancy.rules.test.ts` (cross-org read and write denied, client writes denied, role matrix)
- [~] 10. Security headers: header values and CSP rules tested (`src/config/security-headers.test.ts`); behavior in a real browser (for example Google sign-in under the CSP) not seen
- [~] 11. Auth UI: schemas and client flow tested (`src/schemas/auth.test.ts`, `src/lib/auth/client-flow.test.ts`); the pages and forms have not been rendered or clicked in a browser
- [~] 12. Dashboard shell: navigation data tested (`src/config/nav.test.ts`, `src/lib/auth/dashboard-context.test.ts`); layout, responsive behavior and theme toggle not seen in a browser
- [x] 13. Repository base and pagination: `src/repositories/base.int.test.ts`, `src/lib/pagination.test.ts`
- [x] 14. Customer domain (schema, phone, segments): `src/lib/phone.test.ts`, `src/schemas/customer.test.ts`
- [x] 15. Customer service and API: `src/services/crm/customers.int.test.ts`, `src/app/api/customers/route.int.test.ts`, `src/services/crm/customer-query.test.ts`, `src/services/crm/customer-indexes.test.ts`
- [~] 16. Customer UI: form model, list params and hooks tested (`src/components/customers/*.test.ts`, `src/hooks/use-customers.test.ts`); screens not seen in a browser
- [x] 17. Product and category domain, service, API: `src/schemas/product.test.ts`, `src/services/products/products.int.test.ts`, `src/app/api/products/route.int.test.ts`, `src/app/api/categories/route.int.test.ts`, `src/services/products/product-query.test.ts`, `src/services/products/product-indexes.test.ts`
- [x] 18. Inventory service (reserve, release, commit, adjust): `src/services/inventory/stock.int.test.ts` (concurrency, idempotency, failure leaves counts unchanged), `src/app/api/inventory/route.int.test.ts`, `src/services/inventory/inventory-query.test.ts`, `src/services/inventory/inventory-indexes.test.ts`, `src/schemas/inventory.test.ts`
- [~] 19. Products and inventory UI: models and hooks tested (`src/components/products/*.test.ts`, `src/components/inventory/stock-model.test.ts`, `src/hooks/use-products.test.ts`, `src/hooks/use-inventory.test.ts`); screens not seen in a browser
- [~] 20. Cloudinary library and signing: tested with the SDK mocked (`src/lib/cloudinary/index.test.ts`, `src/lib/cloudinary/folders.test.ts`, `src/lib/cloudinary/urls.test.ts`, `src/app/api/uploads/uploads.int.test.ts`); never run against a real Cloudinary account
- [~] 21. Upload component: flow logic tested (`src/lib/uploads/upload-flow.test.ts`, `src/lib/uploads/xhr-upload.test.ts`, `src/lib/uploads/planned-deletes.test.ts`, `src/lib/uploads/focus-after-remove.test.ts`); component not seen in a browser, no real upload performed
- [~] 22. Overview KPIs: `src/services/dashboard/overview.int.test.ts`, `src/services/dashboard/overview.test.ts`, `src/services/dashboard/lead-segments.test.ts`; the page itself is unverified in a browser
- [~] 23. Documentation and release gates: `scripts/check-bundle-secrets.mjs` scan function tested in `src/test/check-bundle-secrets.test.ts`; `npm run check:bundle` passes on the built bundle; guides are written but unexercised (below)

### Phase 3a: AI Agents and Tool Calling

- [x] 24. Agent domain (permissions, schemas, templates): `src/schemas/agent.test.ts`, `src/services/agents/templates.test.ts`, `src/lib/security/permissions.test.ts`
- [x] 25. Agent service, repository, rules, indexes: `src/services/agents/agents.int.test.ts`, `src/services/agents/agent-indexes.test.ts`, `tests/rules/tenancy.rules.test.ts`
- [x] 26. Agent API routes: `src/app/api/agents/route.int.test.ts`
- [x] 27. AI provider layer: `src/lib/ai/openai-provider.test.ts`, `src/lib/ai/mock-provider.test.ts`, `src/lib/ai/strict-schema.test.ts`, `src/lib/errors.test.ts`
- [x] 28. Tool registry and catalog tools: `src/services/agents/tools/catalog-tools.int.test.ts`, `src/services/agents/tools/registry.test.ts`
- [x] 29. CRM tools with channel-driven dry-run: `src/services/agents/tools/crm-tools.int.test.ts`, `src/services/agents/tools/ai-notes.test.ts`
- [x] 30. Prompt assembly and unverified-figure check: `src/services/agents/prompt.test.ts`, `src/services/agents/figures.test.ts`
- [x] 31. Sessions and bounded agent engine: `src/services/agents/sessions.int.test.ts`, `src/services/agents/engine.int.test.ts`, `src/services/agents/events.test.ts`
- [x] 32. Session API with SSE streaming and usage guards: `src/app/api/agent-sessions/sessions.int.test.ts`, `src/config/env.test.ts`
- [~] 33. Agents list and editor UI: form model tested (`src/components/agents/agent-form-model.test.ts`), navigation tested (`src/config/nav.test.ts`), production build verified; UI unverified in browser
- [~] 34. Agent test console: SSE client & state tested (`src/lib/agents/sse-client.test.ts`, `src/lib/agents/console-state.test.ts`), production build verified; UI unverified in browser
- [x] 35. OpenAI setup guide and Phase 3a gates: `docs/setup/openai.md`, bundle secrets clean (`npm run check:bundle`), full gate passed

### Phase 4: WhatsApp and Unified Inbox

- [x] 36. Inbox domain (permissions, schemas): `src/lib/security/permissions.test.ts`, `src/schemas/inbox.test.ts`
- [x] 37. WhatsApp client and webhook signature verification: `src/lib/whatsapp/client.test.ts`, `src/lib/whatsapp/signature.test.ts` (the HTTP client is tested with `fetch` mocked and the signature code with fixed vectors; real WhatsApp delivery was never exercised, see "Unverified")
- [x] 38. Inbox repositories, rules and indexes: `src/services/inbox/inbox-indexes.test.ts`, `tests/rules/tenancy.rules.test.ts`
- [x] 39. Inbox service and webhook processor: `src/services/inbox/inbox.int.test.ts`, `src/services/inbox/webhook-handler.int.test.ts`
- [x] 40. Webhook and inbox API routes: `src/app/api/webhooks/whatsapp/route.test.ts`, `src/app/api/inbox/conversations/route.int.test.ts`
- [~] 41. Unified Inbox UI and navigation: navigation data tested (`src/config/nav.test.ts`); the inbox screens (`src/components/inbox/*`) have no tests and were not seen in a browser
- [x] 42. WhatsApp setup guide: `docs/setup/whatsapp.md`

### Phase 5a: Orders and Cash on Delivery

Plan: `docs/superpowers/plans/2026-11-11-orders-core-cod.md`. Payments (5b) and couriers (5c) are not started.

- [x] 43. Session errors allowlist (an Auth outage no longer logs everyone out): `src/lib/auth/session.test.ts`, `src/lib/auth/session.int.test.ts`
- [x] 44. Permissions, order schemas, state machine, pricing: `src/lib/security/permissions.test.ts`, `src/schemas/order.test.ts`, `src/schemas/customer.test.ts`, `src/services/orders/state-machine.test.ts`, `src/services/orders/pricing.test.ts`
- [x] 45. Order repositories, numbering, settings, indexes, rules: `src/repositories/orders.test.ts`, `src/services/orders/settings.int.test.ts`, `src/services/orders/order-indexes.test.ts`, `tests/rules/tenancy.rules.test.ts`
- [x] 46. Draft orders with stock holds: `src/services/orders/drafts.int.test.ts`
- [x] 47. Lifecycle transitions and queries: `src/services/orders/lifecycle.int.test.ts`, `src/services/orders/queries.int.test.ts`
- [~] 48. Hold expiry sweep and cron route: `src/services/orders/sweep.int.test.ts`, `src/app/api/cron/orders/expire/route.int.test.ts`; Vercel Cron has never run on a real deployment
- [x] 49. Order and settings API routes: `src/app/api/orders/route.int.test.ts`
- [x] 50. AI order tools (draft, update, confirm, status), tested with the mock provider: `src/services/agents/tools/order-tools.int.test.ts`, `src/services/agents/tools/order-access.test.ts`, `src/services/agents/tools/registry.test.ts`, `src/services/agents/templates.test.ts`, `src/schemas/agent.test.ts`
- [~] 51. Orders list page and hooks: `src/hooks/use-orders.test.ts`, `src/components/orders/order-list-params.test.ts`, `src/config/order-labels.test.ts`, `src/config/nav.test.ts`; screens not seen in a browser
- [~] 52. New order form and order detail page: form model tested (`src/components/orders/order-form-model.test.ts`); screens not seen in a browser
- [~] 53. Settings Orders tab, inbox orders block, overview order KPIs: `src/components/settings/order-settings-model.test.ts`, `src/app/api/customers/[id]/orders/route.int.test.ts`, `src/services/dashboard/overview.test.ts`, `src/services/dashboard/overview.int.test.ts`, `src/services/dashboard/dhaka-time.test.ts`, `src/hooks/use-orders.test.ts`, `src/services/orders/order-indexes.test.ts`; the settings form, inbox block and KPI cards are not seen in a browser

### Phase 5b: Payment Gateways and Public Checkout

Plan: `docs/superpowers/plans/2026-11-13-payment-gateways-5b.md`. Couriers (5c) not started.

- [x] 54. AES-256-GCM secret box for integration credentials: `src/lib/security/secret-box.test.ts`
- [x] 55. Schemas and repositories for integration accounts and payment attempts: `src/schemas/integration.test.ts`, `src/schemas/payment.test.ts`, `src/services/payments/payment-indexes.test.ts`, `tests/rules/tenancy.rules.test.ts`
- [x] 56. Gateway interface, registry and mock adapter: `src/services/payments/gateways/mock.test.ts`, `src/services/payments/gateways/registry.test.ts`
- [x] 57. Real gateway adapters (SSLCommerz, aamarPay, UddoktaPay) and outbound safe HTTP client: `src/services/payments/gateways/sslcommerz.test.ts`, `src/services/payments/gateways/aamarpay.test.ts`, `src/services/payments/gateways/uddoktapay.test.ts`, `src/services/payments/gateways/outbound-safe.test.ts`
- [x] 58. Payment links, public checkout session API and attempt lifecycle: `src/services/payments/links.test.ts`, `src/app/api/orders/[id]/payment-link/payment-link.int.test.ts`, `src/app/api/pay/[token]/session/session.int.test.ts`
- [x] 59. Payment callbacks and verification routes: `src/services/payments/callbacks.int.test.ts`, `src/app/api/payments/[gateway]/[action]/route.int.test.ts`
- [x] 60. Payment reconciler wired to order hold-expiry sweep: `src/services/payments/reconciler.int.test.ts`
- [x] 61. AI agent tool `send_payment_link`: `src/services/agents/tools/send-payment-link.int.test.ts`, `src/services/agents/tools/registry.test.ts`, `src/services/agents/templates.test.ts`, `src/schemas/agent.test.ts`
- [~] 62. Public checkout pages and mock checkout simulator: `src/app/pay/[token]/page.tsx`, `src/app/pay/[token]/status/page.tsx`, `src/proxy.test.ts`; checkout UI not seen in a real browser
- [~] 63. Staff integrations management UI and order payment controls: `src/app/api/integrations/gateways/gateways.int.test.ts`, `src/config/nav.test.ts`; integrations UI not seen in a real browser
- [x] 64. Setup guides and Phase 5b gates: `docs/setup/sslcommerz.md`, `docs/setup/aamarpay.md`, `docs/setup/uddoktapay.md`

## Unverified

These have not been done or observed. Do not assume they work.

- No UI has been run in a browser: auth pages, dashboard, customers, products, inventory, uploads, inbox, theme toggle, responsive navigation, accessibility behavior.
- The Orders UI (list, new order form, order detail, Settings Orders tab, the inbox Orders block, the overview order cards) has not been seen in a browser.
- Real WhatsApp delivery: no message has been sent or received through the WhatsApp Cloud API; only the client (with `fetch` mocked) and the signature code are tested. See [setup/whatsapp.md](setup/whatsapp.md).
- The Vercel Cron job for the order hold sweep is set to daily (`0 3 * * *`) in `vercel.json` due to Vercel Hobby plan limits (once per day); Pro accounts can increase frequency to `*/10 * * * *`. External schedulers can trigger it more frequently if desired.
- The dashboard revenue figure uses a Firestore `sum()` aggregation, and the composite index it needs (`orders`: organizationId, paymentStatus, createdAt, totalMinor) is a best reading of the Firestore index rules; the emulator does not enforce indexes, so the real query has not been run against Firestore.
- No real Cloudinary account: signature acceptance, `overwrite=0`, folder mode, replay behavior, Admin API quotas, deleting assets. See [setup/cloudinary.md](setup/cloudinary.md), section 5.
- No real Firebase project: nothing has been deployed, Auth providers (Email/Password, Google) have not been enabled or used, the service-account path has not been exercised.
- Composite indexes (`firestore.indexes.json`, 73 definitions) are not deployed and not confirmed `READY`. Tests compare queries with the index file; Firestore itself has not validated them.
- Firestore TTL policy for `rateLimits.expiresAt` is documented, not applied; the gcloud command needs a double-check against current docs.
- No Vercel deployment: build settings, env handling (especially `FIREBASE_PRIVATE_KEY`) and preview behavior are untested.
- No load or soak testing, no penetration test, no cross-browser testing.
- Orphaned Cloudinary uploads have no cleanup job.

## Open decisions

- **Firebase project (decided 2026-11-08):** reuse `salespilot-ai-9b1cd` (asia-southeast1). Development and tests still use the `demo-salespilot` emulator project. Nothing has been deployed to it yet.
- **Cloudinary credentials:** to be provided directly in `.env.local` (and in Vercel) by the project owner.
- **Payments (5b) and couriers (5c):** not started. No payment gateway or courier has been chosen, and no gateway or courier account exists.
- **Authorized domains and `authDomain`:** staying on `*.firebaseapp.com` unless a custom auth domain is wanted (needs a CSP change).

## Last verified run (2026-11-12, branch `feat/orders-payments`)

| Command                | Result                                                                                   |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| `npm run typecheck`    | passes (`next typegen` then `tsc --noEmit`, no errors)                                   |
| `npm run lint`         | passes, no output                                                                        |
| `npm run test:unit`    | 104 test files, 3120 tests pass                                                          |
| `npm run test:int`     | 39 test files, 859 tests pass (Firestore and Auth emulators, alternate ports)            |
| `npm run build`        | passes                                                                                   |
| `npm run check:bundle` | passes (90 files scanned in `.next/static`, no server-only names, values or PEM markers) |

Re-run the gate in this order before a release.
