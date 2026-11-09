# Phase 4 WhatsApp and Unified Inbox Implementation Plan

> **For agentic workers:** Implement this plan task-by-task. Each step uses checkbox (`- [ ]`) syntax for tracking. Follow TDD (failing test -> pass -> typecheck -> lint -> commit).

**Goal:** Provide an official Meta WhatsApp Cloud API integration and a full-featured Unified Inbox (`/inbox`) where AI agents and human staff manage customer conversations with grounded catalog tools and live CRM capture.

**Architecture:**
- Webhook endpoints (`GET` for Meta challenge verification, `POST` for message/status events with HMAC-SHA256 signature verification).
- WhatsApp Graph API client (`fetch` based, zero external dependencies).
- Firestore data model for `conversations` and subcollection `messages`, strictly tenant-isolated via `organizationId`.
- Automated AI agent dispatch on inbound messages using `runAgentTurn` with `channel: "whatsapp"`.
- 3-pane interactive Unified Inbox dashboard (`/inbox`) built with TanStack Query and shadcn/ui.

**Tech Stack:** Next.js 16 (App Router), TypeScript strict, Firebase Admin/Firestore, Zod 4, TanStack Query, Vitest + Firebase emulators.

**Spec:** `docs/superpowers/specs/2026-11-10-whatsapp-unified-inbox-design.md`.

---

## Global Constraints

- Follow existing project standards: `withApi` with explicit permissions, `OrgRepository` tenancy enforcement, `writeAuditInTransaction`, `assertRateLimit`.
- Permissions: add `inbox:read`, `inbox:write`; roles `owner`, `admin`, `agent` have both; `viewer` has `inbox:read`.
- No client writes to `conversations` or `messages` in Firestore; all mutations go through server route handlers / webhooks.
- Keep source files pure ASCII: encode any non-ASCII characters in regex using `\uXXXX` escapes.
- Every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 1: Permissions, schemas, and types for Unified Inbox & WhatsApp

**Files:**
- Modify `src/lib/security/permissions.ts` (+ test)
- Create `src/schemas/inbox.ts`, `src/schemas/inbox.test.ts`

**Interfaces — Produces:**
- Permissions `inbox:read`, `inbox:write` added to `PERMISSIONS` and `PERMISSION_MATRIX`.
- `CONVERSATION_CHANNELS = ['whatsapp', 'messenger', 'instagram', 'email'] as const`.
- `CONVERSATION_STATUSES = ['ai_handling', 'needs_reply', 'human_handling', 'resolved'] as const`.
- `MESSAGE_SENDERS = ['customer', 'agent', 'user', 'system'] as const`.
- `MESSAGE_STATUSES = ['received', 'sent', 'delivered', 'read', 'failed'] as const`.
- Schemas: `conversationSchema`, `inboxMessageSchema`, `conversationListQuerySchema`, `sendMessageInputSchema`, `updateConversationSchema`.

- [ ] **Step 1: Failing tests.** Write schema and permission tests.
- [ ] **Step 2: Run** `npx vitest run --project unit src/lib/security/permissions.test.ts src/schemas/inbox.test.ts` -> FAIL.
- [ ] **Step 3: Implement.** Add permissions and schemas.
- [ ] **Step 4: Run** -> PASS; `npm run typecheck`.
- [ ] **Step 5: Commit** `feat(inbox): permissions and inbox schemas`.

---

### Task 2: WhatsApp Cloud API client & webhook signature verification

**Files:**
- Create `src/lib/whatsapp/types.ts`
- Create `src/lib/whatsapp/signature.ts`, `src/lib/whatsapp/signature.test.ts`
- Create `src/lib/whatsapp/client.ts`, `src/lib/whatsapp/client.test.ts`

**Interfaces — Produces:**
- `verifyWhatsAppSignature(rawBody: string | Buffer, signatureHeader: string | null, appSecret: string): boolean`.
- Meta webhook payload types (`WhatsAppWebhookPayload`, `WhatsAppMessage`, `WhatsAppStatus`).
- `createWhatsAppClient(opts?: { accessToken?: string; phoneNumberId?: string; apiVersion?: string })`:
  - `sendTextMessage(to: string, body: string): Promise<{ messageId: string }>`
  - `markMessageAsRead(messageId: string): Promise<boolean>`

- [ ] **Step 1: Failing tests.** Test signature verification with valid/tampered payloads, test client requests and error mapping with mocked fetch.
- [ ] **Step 2: Run** `npx vitest run --project unit src/lib/whatsapp` -> FAIL.
- [ ] **Step 3: Implement.** Webhook signature verification and Meta Graph API client.
- [ ] **Step 4: Run** -> PASS; `npm run typecheck`.
- [ ] **Step 5: Commit** `feat(whatsapp): client and webhook signature verification`.

---

### Task 3: Repositories, Firestore rules, and indexes

**Files:**
- Create `src/repositories/conversations.ts`
- Create `src/repositories/inbox-messages.ts`
- Create `src/services/inbox/inbox-indexes.ts`, `src/services/inbox/inbox-indexes.test.ts`
- Modify `firestore.rules`, `firestore.indexes.json`, `tests/rules/tenancy.rules.test.ts`

**Interfaces — Produces:**
- `conversationRepo` (`OrgRepository<ConversationDoc>`), `messageRepo`.
- Composite indexes for `conversations` (`organizationId ASC, lastActivityAt DESC`, `organizationId ASC, status ASC, lastActivityAt DESC`).
- Security rules: org members can read `conversations` and `messages`; client writes denied.

- [ ] **Step 1: Failing tests.** Index equality tests and tenancy rules tests.
- [ ] **Step 2: Run** `npm run test:int` -> FAIL.
- [ ] **Step 3: Implement.** Repositories, indexes, and rules.
- [ ] **Step 4: Run** -> PASS.
- [ ] **Step 5: Commit** `feat(inbox): repositories, rules and indexes`.

---

### Task 4: Inbox service & AI agent channel dispatch

**Files:**
- Create `src/services/inbox/inbox.ts`, `src/services/inbox/inbox.int.test.ts`
- Create `src/services/inbox/webhook-handler.ts`, `src/services/inbox/webhook-handler.int.test.ts`

**Interfaces — Produces:**
- `listConversations(ctx, query)`, `getConversation(ctx, id)`, `listMessages(ctx, conversationId, query)`.
- `sendHumanMessage(ctx, conversationId, input: { text: string })`: sends via WhatsApp, persists message, updates conversation status and unread.
- `updateConversation(ctx, id, patch: { status?, assignedUserId?, assignedAgentId? })`: takeover, hand back to AI, resolve.
- `processWhatsAppWebhook(rawPayload: unknown)`: extracts messages/statuses, links CRM customer, invokes `runAgentTurn` on live WhatsApp channel, sends automated reply, or marks for human reply.

- [ ] **Step 1: Failing tests.** Test conversation lifecycle, human message sending, webhook handling, and AI agent auto-reply.
- [ ] **Step 2: Run** `npm run test:int` -> FAIL.
- [ ] **Step 3: Implement.** Service methods and webhook processor.
- [ ] **Step 4: Run** -> PASS.
- [ ] **Step 5: Commit** `feat(inbox): inbox service and webhook processor`.

---

### Task 5: Webhook & Inbox API route handlers

**Files:**
- Create `src/app/api/webhooks/whatsapp/route.ts`, `src/app/api/webhooks/whatsapp/route.test.ts`
- Create `src/app/api/inbox/conversations/route.ts`, `src/app/api/inbox/conversations/route.int.test.ts`
- Create `src/app/api/inbox/conversations/[id]/route.ts`
- Create `src/app/api/inbox/conversations/[id]/messages/route.ts`, `src/app/api/inbox/conversations/[id]/messages/route.int.test.ts`

**Interfaces — Produces:**
- `GET /api/webhooks/whatsapp` (Meta verification challenge).
- `POST /api/webhooks/whatsapp` (Meta webhook events).
- `GET /api/inbox/conversations` (`inbox:read`).
- `GET /api/inbox/conversations/[id]` (`inbox:read`).
- `PATCH /api/inbox/conversations/[id]` (`inbox:write`).
- `GET /api/inbox/conversations/[id]/messages` (`inbox:read`).
- `POST /api/inbox/conversations/[id]/messages` (`inbox:write`, rate-limited).

- [ ] **Step 1: Failing tests.** Route handler tests with mock session and real emulator.
- [ ] **Step 2: Run** `npm run test:int` -> FAIL.
- [ ] **Step 3: Implement.** Route handlers.
- [ ] **Step 4: Run** -> PASS.
- [ ] **Step 5: Commit** `feat(inbox): webhook and inbox API routes`.

---

### Task 6: Unified Inbox UI components & state hooks

**Files:**
- Create `src/hooks/use-inbox.ts`
- Create `src/components/inbox/conversation-card.tsx`
- Create `src/components/inbox/conversation-list.tsx`
- Create `src/components/inbox/chat-thread.tsx`
- Create `src/components/inbox/customer-sidebar.tsx`
- Create `src/components/inbox/inbox-shell.tsx`

- [ ] **Step 1: Unit tests.** Test models, helper formatting, and hooks.
- [ ] **Step 2: Implement.** Interactive 3-pane components.
- [ ] **Step 3: Run** `npm run test:unit` -> PASS; `npm run typecheck`.
- [ ] **Step 4: Commit** `feat(inbox): unified inbox UI components and hooks`.

---

### Task 7: Page integration & navigation update

**Files:**
- Modify `src/app/(dashboard)/inbox/page.tsx`
- Modify `src/config/nav.ts`, `src/config/nav.test.ts`

- [ ] **Step 1: Failing test.** `src/config/nav.test.ts` expects `/inbox` to be accessible with `inbox:read` permission (no longer `phase: 4`).
- [ ] **Step 2: Implement.** Replace `ComingLater` with `InboxShell` on `/inbox`, update `NAV_ITEMS`.
- [ ] **Step 3: Run** `npm run test:unit` -> PASS; `npm run typecheck && npm run build`.
- [ ] **Step 4: Commit** `feat(inbox): activate unified inbox page and navigation`.

---

### Task 8: Documentation, guides, and release gates

**Files:**
- Create `docs/setup/whatsapp.md`
- Modify `docs/CHECKLIST.md`, `README.md`

- [ ] **Step 1: Write setup guide.** Meta App creation, WhatsApp Business API setup, webhook configuration, verify token.
- [ ] **Step 2: Update checklist and readme.** Mark Sub-project 4 as completed.
- [ ] **Step 3: Run full release gate:**
  - `npm run typecheck`
  - `npm run lint`
  - `npm run test:unit`
  - `npm run test:int`
  - `npm run build`
  - `npm run check:bundle`
- [ ] **Step 4: Commit** `docs: record Phase 4 WhatsApp and Unified Inbox completion`.
