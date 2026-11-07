# Checklist

Status of sub-projects 1 to 8 and of this plan (`docs/superpowers/plans/2026-11-06-foundation-core-data.md`).

Legend:

- `[x]` there are automated tests for it and they passed in the final gate (see "Last verified run" at the end).
- `[ ]` not verified, or only partly verified. The note says which part.

A tick means the logic is covered by tests. It does not mean anyone has seen the screen in a browser; no UI has been run in a browser (see "Unverified").

## Sub-projects

- [x] 1. Foundation (auth, organizations, roles, security baseline, dashboard shell): logic tested, UI unverified
- [x] 2. Core data (CRM, products, inventory, uploads, overview): logic tested, UI and real Cloudinary unverified
- [ ] 3. AI agents (RAG, tool calling): not started
- [ ] 4. WhatsApp and unified inbox: not started
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
- [x] 10. Security headers: `src/config/security-headers.test.ts`
- [ ] 11. Auth UI: schemas and client flow tested (`src/schemas/auth.test.ts`, `src/lib/auth/client-flow.test.ts`); the pages and forms have not been rendered or clicked in a browser
- [ ] 12. Dashboard shell: navigation data tested (`src/config/nav.test.ts`, `src/lib/auth/dashboard-context.test.ts`); layout, responsive behavior and theme toggle not seen in a browser
- [x] 13. Repository base and pagination: `src/repositories/base.int.test.ts`, `src/lib/pagination.test.ts`
- [x] 14. Customer domain (schema, phone, segments): `src/lib/phone.test.ts`, `src/schemas/customer.test.ts`
- [x] 15. Customer service and API: `src/services/crm/customers.int.test.ts`, `src/app/api/customers/route.int.test.ts`, `src/services/crm/customer-query.test.ts`, `src/services/crm/customer-indexes.test.ts`
- [ ] 16. Customer UI: form model, list params and hooks tested (`src/components/customers/*.test.ts`, `src/hooks/use-customers.test.ts`); screens not seen in a browser
- [x] 17. Product and category domain, service, API: `src/schemas/product.test.ts`, `src/services/products/products.int.test.ts`, `src/app/api/products/route.int.test.ts`, `src/app/api/categories/route.int.test.ts`, `src/services/products/product-query.test.ts`, `src/services/products/product-indexes.test.ts`
- [x] 18. Inventory service (reserve, release, commit, adjust): `src/services/inventory/stock.int.test.ts` (concurrency, idempotency, failure leaves counts unchanged), `src/app/api/inventory/route.int.test.ts`, `src/services/inventory/inventory-query.test.ts`, `src/services/inventory/inventory-indexes.test.ts`, `src/schemas/inventory.test.ts`
- [ ] 19. Products and inventory UI: models and hooks tested (`src/components/products/*.test.ts`, `src/components/inventory/stock-model.test.ts`, `src/hooks/use-products.test.ts`, `src/hooks/use-inventory.test.ts`); screens not seen in a browser
- [ ] 20. Cloudinary library and signing: tested with the SDK mocked (`src/lib/cloudinary/index.test.ts`, `src/lib/cloudinary/folders.test.ts`, `src/lib/cloudinary/urls.test.ts`, `src/app/api/uploads/uploads.int.test.ts`); never run against a real Cloudinary account
- [ ] 21. Upload component: flow logic tested (`src/lib/uploads/upload-flow.test.ts`, `src/lib/uploads/xhr-upload.test.ts`, `src/lib/uploads/planned-deletes.test.ts`, `src/lib/uploads/focus-after-remove.test.ts`); component not seen in a browser, no real upload performed
- [x] 22. Overview KPIs: `src/services/dashboard/overview.int.test.ts`, `src/services/dashboard/overview.test.ts`, `src/services/dashboard/lead-segments.test.ts`; the page itself is unverified in a browser
- [x] 23. Documentation and release gates: `scripts/check-bundle-secrets.mjs` scan function tested in `src/test/check-bundle-secrets.test.ts`; `npm run check:bundle` passes on the built bundle; guides are written but unexercised (below)

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

- **Firebase project:** reuse `salespilot-ai-9b1cd` (asia-southeast1) or create a new project for production. Until decided, development uses the emulators.
- **Cloudinary credentials:** to be provided directly in `.env.local` (and in Vercel) by the project owner.
- **Authorized domains and `authDomain`:** staying on `*.firebaseapp.com` unless a custom auth domain is wanted (needs a CSP change).

## Last verified run

Release gate, in order: `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run test:int`, `npm run build`, `npm run check:bundle`. The results of the last run are recorded in the Task 23 report in `.superpowers/sdd/2026-11-06-foundation-core-data/task-23-report.md` (local, not committed).
