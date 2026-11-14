# WhatsApp Numbers per Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Owners connect their business WhatsApp number on Integrations > Platform. The shared webhook routes each message by phone number, and every send path uses the owning workspace's number.

**Architecture:** One connection doc per workspace plus a phone-number lock doc (unique owner, one-read routing). A single resolver turns an org id into a WhatsApp client (connection first, env fallback). The webhook, inbox and automations all send through that resolver. A `withApi` route set and a card on the Integrations page manage the connection.

**Tech Stack:** Next.js 16 route handlers (read `node_modules/next/dist/docs` first), Firebase Admin, Zod 4, Vitest unit + integration (emulators), existing `secret-box` (AES-256-GCM), `createWhatsAppClient(options)`.

**Spec:** `docs/superpowers/specs/2026-11-14-whatsapp-workspace-numbers-design.md`

## Global Constraints

- The access token is never returned by any API, never logged, and stored only as a sealed secret (`sealSecret(JSON.stringify({ accessToken }))`).
- The webhook keeps verifying signatures with env `WHATSAPP_APP_SECRET`, and the GET challenge with env `WHATSAPP_VERIFY_TOKEN`, both unchanged.
- A phone number belongs to at most one workspace. Conflict copy: `"This WhatsApp number is connected to another workspace."` (409).
- Without `ENCRYPTION_KEY`, saving is refused with `IntegrationNotConfiguredError("encryption")` (503).
- All management routes: `withApi`, permission `integrations:manage`, rate-limited.
- Routing order: lock doc of an enabled connection → env fallback (`WHATSAPP_PHONE_NUMBER_ID` + `WHATSAPP_ORGANIZATION_ID`, only if no lock claims that number) → drop. No other fallback.
- Automations with no connected number: status `skipped`, summary `"WhatsApp is not connected for this workspace"`.
- Inbox staff send with no connected number: unchanged (simulated id).
- Graph test call: `GET https://graph.facebook.com/{version}/{phoneNumberId}?fields=display_phone_number,verified_name`, 10 s timeout.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Changing a connection to a new number** must free the old number (lock moved, not leaked), or the old number keeps routing to this workspace. → Task 1 test `changing the number moves the lock`.
2. **A disabled connection** must not receive or send. Messages to its number are dropped, not routed through the env fallback to some other workspace. → Task 2 test `disabled connection drops and does not fall back`.
3. **Saving without re-entering the token** (editing only the business account id) must keep the stored token, not wipe it. → Task 1 test `update without accessToken keeps the token`.
4. **A webhook payload with two numbers of two workspaces** (Meta batches per app) must split per change, not route the whole payload to the first workspace. → Task 2 test `routes each change to its own workspace`.
5. **A Graph test failure** (bad token, network) records `failed` without throwing a 500 or echoing Meta's error body to the client. → Task 1 test `test records failed on a Graph error`.

---

## File Structure

```
src/schemas/whatsapp-connection.ts                     (new) input schema, doc type, summary type + toSummary
src/repositories/whatsapp-connections.ts               (new) refs: connectionRef(orgId), phoneLockRef(phoneNumberId)
src/services/whatsapp/connections.ts                   (new) get/save/test/disconnect; resolveWhatsAppOrg; whatsappClientFor
src/services/whatsapp/connections.int.test.ts          (new)
src/app/api/integrations/whatsapp/route.ts             (new) GET, PUT, DELETE
src/app/api/integrations/whatsapp/test/route.ts        (new) POST
src/app/api/integrations/whatsapp/route.int.test.ts    (new)
src/services/inbox/webhook-handler.ts                  (modify) routing + per-org client
src/services/inbox/inbox.ts                            (modify) sendHumanMessage uses resolver
src/services/automations/engine.ts                     (modify) send via resolver, skip when null
src/components/integrations/whatsapp-card.tsx          (new) form card
src/app/(dashboard)/integrations/page.tsx              (modify) render card, drop env-only link
docs/setup/whatsapp.md, docs/CHECKLIST.md, tests/rules/tenancy.rules.test.ts (modify)
```

---

### Task 1: Connection schema, storage and service

**Files:** create `src/schemas/whatsapp-connection.ts`, `src/schemas/whatsapp-connection.test.ts`, `src/repositories/whatsapp-connections.ts`, `src/services/whatsapp/connections.ts`, `src/services/whatsapp/connections.int.test.ts`. Modify `tests/rules/tenancy.rules.test.ts` (add both collections to `LOCKED`).

**Interfaces — Produces:**

```ts
// schemas/whatsapp-connection.ts (pure)
export const whatsappConnectionInputSchema // { phoneNumberId: /^\d{5,30}$/, businessAccountId: /^\d{5,30}$/, accessToken?: string 20..1000 trimmed, enabled: boolean default true }
export interface WhatsAppConnectionDoc { organizationId; phoneNumberId; businessAccountId; displayPhoneNumber: string | null;
  verifiedName: string | null; credentials: SealedSecret; enabled: boolean; lastTestedAt: string | null;
  lastTestResult: "ok" | "failed" | null; createdAt; updatedAt }
export interface WhatsAppConnectionSummary { connected: boolean; phoneNumberId: string | null; businessAccountId: string | null;
  displayPhoneNumber: string | null; verifiedName: string | null; enabled: boolean; hasAccessToken: boolean;
  lastTestedAt: string | null; lastTestResult: "ok" | "failed" | null; webhookUrl: "/api/webhooks/whatsapp"; platformWebhookReady: boolean }
export function toConnectionSummary(doc: WhatsAppConnectionDoc | null, platformWebhookReady: boolean): WhatsAppConnectionSummary

// repositories/whatsapp-connections.ts (server-only)
export const WHATSAPP_CONNECTIONS = "whatsappConnections", WHATSAPP_PHONE_NUMBERS = "whatsappPhoneNumbers";
export function connectionRef(orgId: string): DocumentReference;      // whatsappConnections/{orgId}
export function phoneLockRef(phoneNumberId: string): DocumentReference; // whatsappPhoneNumbers/{phoneNumberId}

// services/whatsapp/connections.ts (server-only), ctx = { organizationId, uid }
export async function getWhatsAppConnection(ctx): Promise<WhatsAppConnectionSummary>;
export async function saveWhatsAppConnection(ctx, input: WhatsAppConnectionInput): Promise<WhatsAppConnectionSummary>;
export async function testWhatsAppConnection(ctx, deps?: { fetchFn?: typeof fetch }): Promise<WhatsAppConnectionSummary>;
export async function disconnectWhatsApp(ctx): Promise<void>;
export const NUMBER_TAKEN_MESSAGE = "This WhatsApp number is connected to another workspace.";
```

`saveWhatsAppConnection` runs one transaction:
1. Read the connection and the new number's lock.
2. If the lock belongs to another org, throw ConflictError(NUMBER_TAKEN_MESSAGE).
3. If there is no existing connection and no token, throw ValidationError on `accessToken` ("Enter the access token").
4. Seal the token when given, otherwise keep the existing `credentials`.
5. If the number changed, delete the old lock.
6. Write the new lock `{ organizationId }`.
7. Write the connection. A changed number or token resets `displayPhoneNumber`, `verifiedName`, `lastTestResult` and `lastTestedAt` to null.
8. Write an audit row (`whatsapp.connection.save`, after = summary without token).

Call `isEncryptionConfigured()` first; when it returns false, throw `IntegrationNotConfiguredError("encryption")`. `platformWebhookReady` = env `WHATSAPP_APP_SECRET` and `WHATSAPP_VERIFY_TOKEN` both set. `testWhatsAppConnection` makes the Graph call from Global Constraints with `AbortSignal.timeout(10_000)`. On 2xx with JSON it stores `ok` plus `display_phone_number` and `verified_name`; on anything else (including a throw) it stores `failed` and logs only `{ organizationId, status }`.

- [ ] **Step 1: Write failing tests**
  - Unit (`whatsapp-connection.test.ts`):
    - The input rejects `phoneNumberId: "abc"` and a token shorter than 20 characters.
    - `toConnectionSummary(null, false).connected === false`.
    - A summary of a doc has no `credentials` and no `accessToken` key: `expect(JSON.stringify(summary)).not.toContain("credentials")`.
  - Integration (`connections.int.test.ts`):
    - `saves and reads back without the token`. The stored doc's `credentials` unseals to `{ accessToken }`, and the summary has `hasAccessToken: true`.
    - `another workspace's number is a 409`: org A saves `111111`, then org B saving `111111` → ConflictError with `NUMBER_TAKEN_MESSAGE`.
    - `changing the number moves the lock`: after A changes `111111` → `222222`, the lock `111111` is gone, `222222` belongs to A, and org B can now save `111111`.
    - `update without accessToken keeps the token`.
    - `first save without a token is a validation error`.
    - `disconnect removes connection and lock`.
    - `test records ok with the display number`, using a fake fetch returning `{ display_phone_number: "+880 1711-000000", verified_name: "Brand Booster" }`.
    - `test records failed on a Graph error`: a fake fetch with 401, and a fake fetch that throws. Both store `failed` and resolve (no throw).
    - `refuses without ENCRYPTION_KEY`: `vi.stubEnv("ENCRYPTION_KEY", "")`.
  - Rules: both new collections are client read/write denied.
- [ ] **Step 2: Run** `npx vitest run --project unit src/schemas/whatsapp-connection.test.ts` and the integration file via `firebase emulators:exec --only firestore,auth --project demo-salespilot "npx vitest run --project integration src/services/whatsapp tests/rules"`. Expect FAIL (modules missing).
- [ ] **Step 3: Implement** the schema, repository and service per the Interfaces block.
- [ ] **Step 4: Run** both commands again. Expect PASS.
- [ ] **Step 5: Commit** `feat(whatsapp): per-workspace number connection storage and service`

---

### Task 2: Routing and the sending resolver on all three send paths

**Files:** modify `src/services/whatsapp/connections.ts`, `src/services/inbox/webhook-handler.ts`, `src/services/inbox/inbox.ts`, `src/services/automations/engine.ts`. Tests: add to `connections.int.test.ts`, `src/services/inbox/webhook-ai.int.test.ts`, the automations engine int test (find the file with `send_whatsapp`), and `src/services/inbox/inbox.int.test.ts`.

**Interfaces — Produces:**

```ts
export async function resolveWhatsAppOrg(phoneNumberId: string | undefined): Promise<string | null>; // routing order from Global Constraints
export async function whatsappClientFor(orgId: string, deps?: { fetchFn?: typeof fetch }): Promise<WhatsAppClient | null>;
// enabled connection -> createWhatsAppClient({ accessToken, phoneNumberId, apiVersion: env META_GRAPH_API_VERSION ?? "v21.0", fetchFn });
// else env client when env WHATSAPP_ORGANIZATION_ID === orgId and env WHATSAPP_PHONE_NUMBER_ID + WHATSAPP_ACCESS_TOKEN are set; else null
```

Webhook changes:
- `defaultResolveOrgId` becomes `resolveWhatsAppOrg`. Remove the old env-only body, and keep the export name `defaultResolveOrgId` as an alias.
- Resolve the org per CHANGE (already per change). Build the client per resolved org: `deps.whatsappClient ?? await whatsappClientFor(orgId)`.
- A null client means no reply is sent. The conversation goes to `needs_reply`.

`sendHumanMessage`: `deps?.whatsappClient ?? await whatsappClientFor(orgId)`. Send if it's non-null, otherwise use the simulated id.

Automations `send_whatsapp`: use `whatsappClientFor(orgId)`. When it returns null, set `status = "skipped"` and `summary = "WhatsApp is not connected for this workspace"`, and create no conversation message.

- [ ] **Step 1: Write failing tests:**
  - `lock beats env` (env number = `333333` for org A, lock `333333` → org B → returns B).
  - `disabled connection drops and does not fall back` (B's connection disabled, env also names `333333`/A → null).
  - `env fallback still works` (no lock).
  - `whatsappClientFor uses the connection token` (fake fetch captures the `Authorization: Bearer <token>` header and the URL path `/v21.0/<phoneNumberId>/messages`).
  - In `webhook-ai.int.test.ts`, `routes each change to its own workspace`: two orgs with connections `444444` and `555555`, and one payload with two changes. Each message lands in its own org's conversation, and each reply's fake-fetch call carries its own org's token. Use `resolveOrgId` and `whatsappClient` deps undefined, with a fake `fetchFn` injected through the connection-resolver deps; add `deps.fetchFn` to `WebhookHandlerDeps` for this.
  - Automations: a rule with `send_whatsapp` in an org with no connection → run `skipped` with the exact summary.
  - Inbox: `sendHumanMessage` in an org with a connection calls the fake fetch with that org's token.
- [ ] **Step 2: Run** the integration files. Expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm run test:int` (full suite; existing webhook and automations tests must still pass). Expect PASS.
- [ ] **Step 5: Commit** `feat(whatsapp): route by number and send from the workspace's number`

---

### Task 3: Management API routes

**Files:** create `src/app/api/integrations/whatsapp/route.ts`, `src/app/api/integrations/whatsapp/test/route.ts`, `src/app/api/integrations/whatsapp/route.int.test.ts`. Modify `src/app/api/integrations/status/route.ts`: drop `whatsappLinkedHere`, and set `whatsapp` to the connection's `connected && enabled`, or to the env fallback naming this org.

| Route | Body | Returns | Rate limit (per 60 s) |
|---|---|---|---|
| `GET /api/integrations/whatsapp` | — | `WhatsAppConnectionSummary` | `integrations.whatsapp.read` 60 |
| `PUT /api/integrations/whatsapp` | `whatsappConnectionInputSchema` | summary | `integrations.whatsapp.save` 20 |
| `POST /api/integrations/whatsapp/test` | — | summary | `integrations.whatsapp.test` 10 |
| `DELETE /api/integrations/whatsapp` | — | 204 | `integrations.whatsapp.delete` 10 |

- [ ] **Step 1: Write failing tests** (pattern: `src/app/api/integrations/gateways/gateways.int.test.ts`):
  - Agent and viewer get 403 on all four. Owner PUT → 200, and the body has no `accessToken`/`credentials`.
  - A cross-site PUT gets 403. A 409 from the other workspace's number comes back with `NUMBER_TAKEN_MESSAGE`.
  - DELETE → 204, then GET `connected: false`.
- [ ] **Step 2: Run** the test. Expect FAIL.
- [ ] **Step 3: Implement** the thin wrappers.
- [ ] **Step 4: Run** the test and `npm run build`. Expect PASS.
- [ ] **Step 5: Commit** `feat(whatsapp): connection management API`

---

### Task 4: Integrations card and docs

**Files:** create `src/components/integrations/whatsapp-card.tsx`. Modify `src/app/(dashboard)/integrations/page.tsx`: render `<WhatsAppCard />` in the Platform tab in place of the WhatsApp entry of the channels grid, and remove `WhatsAppWorkspaceLink` and the `workspaceId` state. Also modify `docs/setup/whatsapp.md`, `docs/CHECKLIST.md` and `.env.example`.

The card:
- Loads `GET /api/integrations/whatsapp`.
- Form: Phone Number ID, Business Account ID, Access token (`type="password"`, placeholder "Saved — leave blank to keep" when `hasAccessToken`), Enabled switch.
- Buttons: Save (PUT, then POST test on success), Test, Disconnect (confirm dialog).
- Status line: "Connected: {displayPhoneNumber} · {verifiedName}" when `lastTestResult === "ok"`, "Test failed — check the IDs and token" when `failed`, "Not connected" otherwise.
- Shows the webhook URL with a copy button and the note: "The webhook URL, verify token and app secret belong to the platform's Meta app and are set by the platform admin." When `platformWebhookReady` is false, show it as a warning.
- Follow the gateway card / dialog styling. Double-submit guard, as in other dialogs.

Docs:
- `whatsapp.md` gets two parts:
  - "Platform setup (once)": the Meta app, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, the webhook URL and the `messages` field.
  - "Connect a business number (per workspace)": the card, where the IDs and token come from, and the Tech Provider note from the spec. The env single-number setup becomes "Optional: single number via environment".
- CHECKLIST: add a line for this feature citing the test files, and mark the card `[~]` (not seen in a browser).
- `.env.example`: annotate `WHATSAPP_ORGANIZATION_ID` and the number/token as "optional fallback for one number; workspaces normally connect in Integrations".

- [ ] **Step 1:** Implement the card and docs. No unit test (UI only; behaviour lives in the tested service and routes).
- [ ] **Step 2: Run all gates:** `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run test:int`, `npm run build`, `npm run check:bundle`. Expect all PASS.
- [ ] **Step 3: Commit** `feat(whatsapp): connect a business number on the Integrations page`
