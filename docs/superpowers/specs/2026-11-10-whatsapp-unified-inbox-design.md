# SalesPilot AI — Phase 4: WhatsApp and Unified Inbox Design

Date: 2026-11-10 · Scope: Phase 4 (WhatsApp Cloud API integration & Unified Inbox) · Status: draft for review
Builds on: `2026-11-06-foundation-core-data-design.md` and `2026-11-09-ai-agents-tool-calling-design.md` (Phases 1–3, merged to `main`).

## 1. Intent

Connect SalesPilot AI to real-time customer messaging channels, starting with the official Meta WhatsApp Cloud API, and provide a single, calm unified inbox for human sales staff and AI agents to collaborate seamlessly.

### Core Objectives:
1. **Official WhatsApp Cloud API Integration**:
   - Receive incoming customer messages and delivery receipts via verified webhooks (`GET` verification challenge + `POST` with HMAC-SHA256 signature verification).
   - Send outbound messages (text, quick replies) via Meta Graph API v21.0+.
   - Resilient webhook processing: idempotent message handling (keyed by Meta `wamid`), fast 200 response to Meta, background dispatch to AI agent or inbox queue.

2. **Unified Inbox Data Architecture**:
   - Organization-scoped `conversations` and `messages` collections in Firestore.
   - Contact-centric threading: conversations grouped by contact phone number, automatically linked to CRM `customers`.
   - Clear lifecycle states: `ai_handling`, `needs_reply`, `human_handling`, `resolved`.

3. **Autonomous AI Sales on WhatsApp**:
   - When an incoming WhatsApp message arrives on an `ai_handling` conversation, invoke the bounded AI engine (`runAgentTurn`) with `channel: "whatsapp"`.
   - Grounded tool execution: catalog searches, price/stock checks, and live CRM capture (`save_customer_info`) tied strictly to the verified WhatsApp sender (`contactPhoneE164`).
   - Human escalation: when the AI agent escalates (`escalate_to_human`), automatically transition conversation state to `needs_reply` / `human_handling` and notify team.

4. **Rich Unified Inbox Experience (`/inbox`)**:
   - Responsive 3-pane layout:
     - Left: searchable conversation list with filter pills (`All`, `Needs Reply`, `AI Active`, `Human Active`, `Resolved`), unread counters, and channel badges.
     - Center: live conversation thread with message bubbles, status ticks (sent, delivered, read), AI tool execution inspector, human reply input, and seamless "Take Over from AI" / "Hand to AI" controls.
     - Right: collapsible CRM customer context (profile, contact numbers, segment badge, address, order notes) and quick action to view/edit in CRM.

---

## 2. Architecture & Layering

Following the existing codebase conventions:

| Layer | Files | Purpose |
|---|---|---|
| **Schemas & Permissions** | `src/schemas/inbox.ts`, `src/lib/security/permissions.ts` | Zod validation schemas for conversations, messages, queries, webhooks; `inbox:read` and `inbox:write` permissions. |
| **WhatsApp Library** | `src/lib/whatsapp/client.ts`, `src/lib/whatsapp/webhook.ts` | Meta Graph API client, HMAC-SHA256 signature verification, webhook payload normalization. |
| **Repositories** | `src/repositories/conversations.ts`, `src/repositories/inbox-messages.ts` | Org-scoped data access with composite indexing and pagination. |
| **Service Layer** | `src/services/inbox/inbox.ts`, `src/services/inbox/webhook-handler.ts` | Message ingestion, customer linking, AI agent dispatch, human takeover, and resolution. |
| **API Route Handlers** | `src/app/api/webhooks/whatsapp/route.ts`, `src/app/api/inbox/**` | Meta webhook endpoints + RESTful `withApi` routes for conversation/message management. |
| **UI Components** | `src/app/(dashboard)/inbox/page.tsx`, `src/components/inbox/**` | TanStack Query powered 3-pane interactive Unified Inbox. |

---

## 3. Data Model

All collections are scoped by `organizationId` and written server-side only via Admin SDK.

### 3.1 `conversations/{id}`
- `id`: string (UUID or deterministic `conv_${channel}_${phoneE164}`)
- `organizationId`: string
- `channel`: `'whatsapp' | 'messenger' | 'instagram' | 'email'` (default `'whatsapp'`)
- `contactPhoneE164`: string (e.g. `+8801712345678`)
- `contactName`: string (from WhatsApp profile or CRM)
- `customerId`: string | null (foreign key to `customers` collection)
- `assignedAgentId`: string | null (AI agent assigned to this channel/conversation)
- `assignedUserId`: string | null (human team member UID who took over)
- `status`: `'ai_handling' | 'needs_reply' | 'human_handling' | 'resolved'`
- `unreadCount`: number
- `lastMessage`: `{ text: string, sender: 'customer' | 'agent' | 'user' | 'system', senderName: string, at: string }`
- `lastActivityAt`: string (ISO 8601 timestamp)
- `createdAt`: string (ISO 8601 timestamp)
- `updatedAt`: string (ISO 8601 timestamp)

### 3.2 `conversations/{id}/messages/{messageId}`
- `id`: string (Meta `wamid` for WhatsApp messages, or generated UUID)
- `organizationId`: string
- `conversationId`: string
- `direction`: `'inbound' | 'outbound'`
- `sender`: `'customer' | 'agent' | 'user' | 'system'`
- `senderName`: string (e.g. customer profile name, agent name, or human staff name)
- `type`: `'text' | 'interactive' | 'system'`
- `text`: string (message body up to 4096 characters)
- `status`: `'received' | 'sent' | 'delivered' | 'read' | 'failed'`
- `errorMessage`: string | null
- `externalId`: string | null (WhatsApp message ID `wamid`)
- `aiMetadata`: object | null (records agent ID, tool calls, figures verification for AI turns)
- `createdAt`: string (ISO 8601 timestamp)

### 3.3 Security Rules & Indexes
- **Rules (`firestore.rules`)**:
  - `conversations`: org members have `read` access; client `write` is denied (`allow write: if false;`).
  - `conversations/{id}/messages/{messageId}`: org members have `read` access; client `write` is denied (`allow write: if false;`).
- **Indexes (`firestore.indexes.json`)**:
  - `conversations`: `organizationId ASC, lastActivityAt DESC, __name__ DESC`
  - `conversations`: `organizationId ASC, status ASC, lastActivityAt DESC, __name__ DESC`
  - `conversations`: `organizationId ASC, contactPhoneE164 ASC, __name__ DESC`
  - `messages`: `organizationId ASC, conversationId ASC, createdAt ASC, __name__ ASC`

---

## 4. WhatsApp Cloud API & Webhook Flow

### 4.1 Verification (`GET /api/webhooks/whatsapp`)
- Meta sends `hub.mode`, `hub.verify_token`, `hub.challenge`.
- Endpoint validates `hub.mode === 'subscribe'` and `hub.verify_token === WHATSAPP_VERIFY_TOKEN`.
- Returns `200` with raw `hub.challenge` text. Rejects mismatches with `403`.

### 4.2 Ingestion (`POST /api/webhooks/whatsapp`)
- Computes SHA256 HMAC of raw request body using `WHATSAPP_APP_SECRET`.
- Compares with `X-Hub-Signature-256` header (constant-time `crypto.timingSafeEqual`).
- Extracts WhatsApp messages (`from`, `id`, `text.body`, `timestamp`, `profile.name`) and delivery statuses (`status`, `id`, `recipient_id`).
- For status updates: updates matching message `status` (`sent` → `delivered` → `read` / `failed`).
- For inbound messages:
  1. Normalizes sender phone to E.164.
  2. Finds or links CRM customer (`lookup_customer` by `phoneE164`).
  3. Finds or creates `conversation` for the contact.
  4. Stores inbound message in subcollection.
  5. If conversation is `ai_handling`:
     - Dispatches turn to bounded AI engine with `channel: "whatsapp"`.
     - AI tool execution runs live: grounded catalog queries + CRM capture for verified sender.
     - Outbound AI text reply sent via Meta Graph API; message saved with `sender: "agent"`.
     - If AI triggers `escalate_to_human`, sets conversation `status` to `needs_reply` and `assignedAgentId: null`.
  6. If conversation is `human_handling`: increments `unreadCount` and sets status to `needs_reply`.

---

## 5. Unified Inbox UI Experience

### 5.1 Route & Layout
- Replaces placeholder at `src/app/(dashboard)/inbox/page.tsx`.
- Protected by `inbox:read` permission.
- 3-column split view (responsive: collapses to 1/2 columns on mobile/tablet):
  - **Left Pane: Conversations List**
    - Search bar (filters by customer name or phone).
    - Status tabs: `All`, `Needs Reply` (with count), `AI Active`, `Human Active`, `Resolved`.
    - Conversation cards displaying customer name, formatted phone, channel badge, message preview, relative timestamp, and status tag.
  - **Center Pane: Conversation Thread**
    - Conversation header with customer info, status pill, "Take Over" / "Hand to AI" toggle, and "Mark Resolved" button.
    - Message history feed:
      - Inbound customer bubbles (dark gray / neutral).
      - Human outbound bubbles (primary brand color).
      - AI outbound bubbles (brand-accented with an "AI Agent" badge and expandable "Tools Executed" pill).
      - Message delivery indicators (clock, single check, double check, blue check).
    - Reply box:
      - Text area with `Ctrl+Enter` send shortcut.
      - "Take over" prompt if sending while AI is in handling mode.
  - **Right Pane: Customer & CRM Info**
    - Customer profile card: name, segment pill, phone, WhatsApp link, address, lifetime spend.
    - Quick link to customer profile in CRM (`/customers/[id]`).
    - Assigned agent details.

---

## 6. Permissions & Audit

### 6.1 Permissions Matrix
New permissions added to `src/lib/security/permissions.ts`:
- `inbox:read`: View conversations and message history.
- `inbox:write`: Send replies, take over from AI, hand over to AI, resolve conversations.

| Role | inbox:read | inbox:write |
|---|---|---|
| **owner** | Yes | Yes |
| **admin** | Yes | Yes |
| **agent** (human sales staff) | Yes | Yes |
| **viewer** | Yes | No |

### 6.2 Audit Logs
Key actions logged via `writeAuditInTransaction`:
- `inbox.takeover`: Human staff member takes over from AI agent.
- `inbox.handover_ai`: Human staff returns conversation to AI agent.
- `inbox.resolve`: Conversation marked resolved.
- `inbox.reopen`: Resolved conversation reopened.
