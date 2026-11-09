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
- [x] 4. WhatsApp and unified inbox: logic, webhooks, and UI tested (Phase 4)
- [ ] 5. Orders, payments, courier: not started (stock reserve/release/commit exist for it)
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
- [x] 37. WhatsApp client and webhook signature verification: `src/lib/whatsapp/client.test.ts`, `src/lib/whatsapp/signature.test.ts`
- [x] 38. Inbox repositories, rules and indexes: `src/services/inbox/inbox-indexes.test.ts`, `tests/rules/tenancy.rules.test.ts`
- [x] 39. Inbox service and webhook processor: `src/services/inbox/inbox.int.test.ts`, `src/services/inbox/webhook-handler.int.test.ts`
- [x] 40. Webhook and inbox API routes: `src/app/api/webhooks/whatsapp/route.test.ts`, `src/app/api/inbox/conversations/route.int.test.ts`
- [x] 41. Unified Inbox UI and navigation: `src/config/nav.test.ts`, `src/components/inbox/*`
- [x] 42. WhatsApp setup guide: `docs/setup/whatsapp.md`

## Unverified

These have not been done or observed. Do not assume they work.

- No UI has been run in a browser: auth pages, dashboard, customers, products, inventory, uploads, theme toggle, responsive navigation, accessibility behavior.
- No real Cloudinary account: signature acceptance, `overwrite=0`, folder mode, replay behavior, Admin API quotas, deleting assets. See [setup/cloudinary.md](setup/cloudinary.md), section 5.
- No real Firebase project: nothing has been deployed, Auth providers (Email/Password, Google) have not been enabled or used, the service-account path has not been exercised.
- Composite indexes (`firestore.indexes.json`, 54 definitions) are not deployed and not confirmed `READY`. Tests compare queries with the index file; Firestore itself has not validated them.
- Firestore TTL policy for `rateLimits.expiresAt` is documented, not applied; the gcloud command needs a double-check against current docs.
- No Vercel deployment: build settings, env handling (especially `FIREBASE_PRIVATE_KEY`) and preview behavior are untested.
- No load or soak testing, no penetration test, no cross-browser testing.
- Orphaned Cloudinary uploads have no cleanup job.

## Open decisions

- **Firebase project (decided 2026-11-08):** reuse `salespilot-ai-9b1cd` (asia-southeast1). Development and tests still use the `demo-salespilot` emulator project. Nothing has been deployed to it yet.
- **Cloudinary credentials:** to be provided directly in `.env.local` (and in Vercel) by the project owner.
- **Authorized domains and `authDomain`:** staying on `*.firebaseapp.com` unless a custom auth domain is wanted (needs a CSP change).

## Last verified run (2026-11-07, branch `feat/foundation-core-data`)

| Command                | Result                                                                                   |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| `npm run typecheck`    | passes (`next typegen` then `tsc --noEmit`, no errors)                                   |
| `npm run lint`         | passes, no output                                                                        |
| `npm run test:unit`    | 67 test files, 1267 tests pass                                                           |
| `npm run test:int`     | 20 test files, 533 tests pass (Firestore and Auth emulators)                             |
| `npm run build`        | passes                                                                                   |
| `npm run check:bundle` | passes (53 files scanned in `.next/static`, no server-only names, values or PEM markers) |

Re-run the gate in this order before a release.
