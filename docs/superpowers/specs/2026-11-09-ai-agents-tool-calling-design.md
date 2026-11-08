# SalesPilot AI — Phase 3a: AI Agents and Tool Calling Design

Date: 2026-11-09 · Scope: first slice of Phase 3 (AI sales engine) · Status: draft for review
Builds on: `2026-11-06-foundation-core-data-design.md` (sub-projects 1–2, merged to `main`).

## 1. Intent

Let an organization create AI sales agents, test them safely in a dashboard console, and get answers grounded only in the real catalog, prices and stock. The same engine will answer live WhatsApp conversations in Phase 4, so the conversation format and tool layer must be channel-neutral.

Success: an admin creates an agent from a role template, chats with it in Bangla, English or Banglish in the test console, sees correct prices, stock and totals pulled from the real catalog, sees exactly which tools ran and what the agent *would* have saved or escalated, and nothing is invented or written for real.

Decided with the user: this round = agents + tool calling (knowledge-base RAG is the next round); provider = OpenAI (key supplied by the user in `.env.local`); tools = read-only catalog tools + CRM capture + human escalation; test-console writes are always dry-run.

Out of scope this round: document knowledge base / embeddings / RAG, WhatsApp and voice channels, draft orders and payments, follow-up scheduling, delivery-charge rules, multiple providers (the abstraction allows adding Claude later).

## 2. Architecture

Same layering as sub-projects 1–2: `app/` → `services/` → `repositories/` → `lib/`. New units:

| Unit | Purpose |
|---|---|
| `lib/ai/provider.ts` | `ChatProvider` interface and neutral message/tool types |
| `lib/ai/openai-provider.ts` | OpenAI adapter on the official `openai` SDK, Responses API, strict JSON-schema function tools (server-only) |
| `lib/ai/mock-provider.ts` | Scripted provider for tests; never used outside tests |
| `services/agents/agents.ts` + repository | Agent CRUD with versioning, audit |
| `services/agents/templates.ts` | Built-in role templates (pure) |
| `services/agents/prompt.ts` | System-prompt assembly (pure) |
| `services/agents/tools/*` | Tool registry: one module per tool, Zod input/output, executor |
| `services/agents/engine.ts` | `runAgentTurn`: the bounded tool loop, streaming events |
| `services/agents/sessions.ts` + repository | Sessions and messages persistence |
| API routes under `app/api/agents/**`, `app/api/agent-sessions/**` | Via `withApi` |
| UI under `app/(dashboard)/agents/**`, `components/agents/**` | List, editor, test console |

The agent loop runs on our server (approach 1): the model proposes tool calls; we validate, authorize and execute them against Firestore; we send results back. Conversation state lives in our Firestore, not at OpenAI.

## 3. Data model

All org-scoped, written only by the server (Admin SDK).

**`agents/{id}`**: `organizationId`; `name` (1–80), `nameLower`; `description` (≤500); `role` (`retail_sales | wholesale_sales | customer_support | order_management | voice_sales`); `status` (`active | inactive`); `personality` (≤1000); `instructions` (≤8000); `objectives` (≤10 strings, each ≤200); `languages` (non-empty subset of `bn | en | banglish`); `tools` (subset of the tool names in §5); `productAccess` (`{ mode: "all" }` or `{ mode: "categories", categoryIds }` with 1–20 ids from the same org); `channels` (subset of `test | whatsapp | voice`; `test` always present; `whatsapp`/`voice` inert until their phases); `escalation` (`keywords` ≤20 each ≤40; `onMissingInfo` boolean; `maxTurnsBeforeHandover` 1–50 or absent); `limits` (`maxTurnsPerSession` 1–100 default 30, `maxToolCallsPerTurn` 1–6 default 4, `maxOutputTokens` 100–2000 default 600); `responseStyle` (`concise | detailed`); `model` (optional override, ≤100 chars, else `OPENAI_CHAT_MODEL`); `version` (integer, starts at 1); `createdBy`; `createdAt`; `updatedAt`.

`version` increments when any of `personality, instructions, objectives, languages, tools, productAccess, escalation, limits, responseStyle, model` changes. Name, description and status changes do not bump it.

**`agentSessions/{id}`**: `organizationId`, `agentId`, `agentVersion`, `channel` (`test` this round), `startedBy` (uid), `status` (`open | escalated | closed`), `turnCount`, `usage` (`inputTokens`, `outputTokens`), `createdAt`, `lastMessageAt`.

**`agentSessions/{id}/messages/{id}`**: `role` (`user | assistant`), `text` (≤8000), `toolCalls` (assistant only: `[{ id, name, args, resultSummary, dryRunAction?, status: ok | error | denied, durationMs }]`), `warnings` (e.g. `unverified_figure`), `model`, `usage`, `latencyMs`, `interrupted` boolean, `errorCode?`, `createdAt`.

**Rules:** `agents` readable by org members (same pattern as `products`); `agentSessions` and messages not client-readable (contain customer data); no client writes anywhere.

**Indexes:** `agents` list by `organizationId` + `updatedAt desc`; sessions by `organizationId` + `agentId` + `lastMessageAt desc`; messages read by `createdAt asc` within one session (single-field). Index tables in code mirrored in `firestore.indexes.json`, as for the other modules.

**Permissions:** new `agents:read`, `agents:write`, `agents:test`.

| Role | agents:read | agents:write | agents:test |
|---|---|---|---|
| owner, admin | yes | yes | yes |
| agent (human sales staff) | yes | no | yes |
| viewer | yes | no | no |

UI copy calls the human role "Sales agent (team member)" where the two could be confused.

**Audit:** `agent.create`, `agent.update` (changed field names and new version only, no instruction text), `agent.activate`, `agent.deactivate`.

## 4. Engine

**Provider interface.** `ChatProvider.generate({ model, system, messages, tools, maxOutputTokens, signal, onTextDelta }) → { text, toolCalls: [{ id, name, argumentsJson }], usage, stopReason }`. Messages use a neutral format (user text, assistant text + tool calls, tool results). The OpenAI adapter maps to the Responses API with `strict: true` function schemas generated from the tools' Zod input schemas. Provider errors map to typed errors: timeout, rate-limited, unavailable (5xx), bad request.

**`runAgentTurn({ ctx, agent, session, userText, signal, emit })`:**
1. Build the system prompt (`prompt.ts`): fixed safety preamble first (states that it cannot be overridden by later instructions), then the agent's personality, instructions, objectives and response style, then the language rule (reply in the customer's language: Bangla, English or Banglish; keep product names as stored), then organization name and today's date in Asia/Dhaka.
2. Load the session's last 20 messages as history (tool results are summarized, not replayed in full).
3. Loop: call the provider; stream text deltas to `emit`; for each tool call: check it is in `agent.tools` (else `denied` result), parse arguments with the tool's Zod schema (else an error result), run the executor with the agent's product-access filter and org scope, emit tool started/finished, send the result back. Stop when the model returns text with no tool calls, when tool calls reach `limits.maxToolCallsPerTurn`, or when the turn's wall-clock budget (25 s) is spent; in the last two cases the model gets one final call without tools to wrap up.
4. Run the unverified-figure check (§6), persist the user message and the assistant message (with tool calls, warnings, usage, latency) and update the session (`turnCount`, `usage`, `lastMessageAt`) in one batch.

**Channel-driven mode.** Dry-run vs real writes is decided on the server from `session.channel`: `test` → dry-run always. The client cannot change it.

## 5. Tools

Every tool: Zod input and output schemas, runs only within the agent's organization, respects `productAccess`, returns compact results (no internal fields such as `nameLower`, `organizationId`, lock data), formats money server-side.

| Tool | Behaviour |
|---|---|
| `search_products` `{ query (1–100), categoryId?, limit ≤5 }` | Keyword search over the org's non-archived, `active`, in-scope products: tokenised, case- and NFKC-insensitive match on name, SKU, category name and specification values; Bangla text supported. Reads at most 1000 products per org (documented limit; semantic search arrives with RAG). Returns `[{ productId, name, sku, priceText, availability, stockStatus }]`. |
| `get_product_details` `{ productId }` | Description, variants (id, size, color), specifications, FAQs; NotFound result if out of scope. |
| `get_price` `{ productId, variantId?, customerType: retail \| wholesale }` | `{ priceMinor, salePriceMinor?, effectiveMinor, priceText }`; wholesale falls back to retail when no wholesale price, stated in the result. |
| `check_stock` `{ productId, variantId? }` | `{ status: in_stock \| low \| out_of_stock, available }` using `LOW_STOCK_THRESHOLD`. |
| `calculate_order_total` `{ items: [{ productId, variantId?, quantity 1–1000 }] ≤20, customerType }` | Line totals and subtotal in paisa and as taka text; flags lines that are out of scope, archived or exceed available stock; states "delivery charges are not available yet". |
| `lookup_customer` `{ phone }` | Normalizes with `normalizePhone`; returns `{ exists, fullName?, segment? }` only. |
| `save_customer_info` `{ phone, fullName?, address?, email?, notes?, segment? }` | Live channels: create or update via the existing customer service (validation, phone locks, audit with actor `ai-agent:{agentId}`). Test channel: full validation through the same schemas, then returns `dryRunAction: { kind: "create" \| "update", fields }` without writing. |
| `escalate_to_human` `{ reason (1–300) }` | Live: sets session `status` to `escalated` with the reason. Test: returns `dryRunAction` only. |

A failing tool returns a static error result to the model; the safety preamble tells the model to apologise and offer a human when tools fail.

## 6. Safety

- **Enforced in code, not only in the prompt:** tool allow-list, argument validation, product-access filter, org scoping, dry-run for test sessions.
- **No invented facts:** the preamble instructs that prices, stock, discounts and delivery times come only from tool results and to say it will check rather than guess. After each turn the engine extracts taka/৳ amounts from the reply and compares them with the amounts in that turn's tool results; any amount not found adds an `unverified_figure` warning, shown in the console inspector. This round it is a warning; Phase 4 can make it blocking before replies reach customers.
- **Prompt injection:** customer text and tool results are passed as data, never concatenated into the system prompt; tool results cannot add tools or change permissions.
- **Privacy:** logs contain ids, error codes and timings only, never message text or customer details. Audit rows for agents carry field names only. `OPENAI_API_KEY` stays server-side and is added to the bundle secret scan.

## 7. API

All via `withApi` (auth, membership, explicit permission, CSRF, Zod, error envelope).

- `GET /api/agents` (`agents:read`), `POST /api/agents` (`agents:write`, 30/min).
- `GET /api/agents/[id]` (`agents:read`), `PATCH /api/agents/[id]` (`agents:write`, 60/min; status changes go through this PATCH). No delete this round.
- `POST /api/agents/[id]/sessions` (`agents:test`, 30/min) — works for inactive agents; status gates live channels only.
- `GET /api/agents/[id]/sessions` (`agents:test`) — cursor-paginated, newest first.
- `GET /api/agent-sessions/[sessionId]` (`agents:test`) — session plus messages.
- `POST /api/agent-sessions/[sessionId]/messages` (`agents:test`) — body `{ text }` (1–2000). Response `text/event-stream` with events `text_delta`, `tool_started`, `tool_finished`, `dry_run_action`, `done` (usage, warnings), `error` (safe message, request id). `maxDuration = 60`, Node runtime. Refused with a clear 409 when the session reached `maxTurnsPerSession`.
- **Guards:** 20 messages/min per user; per-org daily cap from optional `AI_DAILY_MESSAGE_LIMIT` (default 500) via the existing Firestore rate limiter with a one-day window; `!isConfigured("openai")` → 503 `INTEGRATION_NOT_CONFIGURED`.

## 8. UI

- **`/agents`** (replaces the "coming later" stub): name, role, status, languages, channels, tool count, version, updated; "New agent" for writers; empty state offering the five role templates.
- **`/agents/new`, `/agents/[id]`:** long form in the product-editor style. Sections: Basics (choosing a role on a new agent pre-fills instructions, objectives and suggested tools from the template), Personality and instructions (counters), Objectives, Languages, Tools (descriptions; "writes data" badge on `save_customer_info` and `escalate_to_human`), Product access, Channels (WhatsApp/voice disabled with their phase), Escalation, Limits and response (model override shows the default). Status switch; saving shows the new version. Read-only for non-writers. Reuses shared form, alert, unsaved-changes and double-submit pieces.
- **`/agents/[id]/test`:** chat pane (streaming reply, Enter sends, Shift+Enter newline, Stop aborts the stream, session picker, New session, persistent banner "Test mode: nothing the agent does here changes real data") and inspector pane (per reply: tool calls with arguments, result summary and duration; highlighted dry-run actions; warnings; tokens and latency). "AI provider not configured" panel when OpenAI is missing. Inspector becomes a sheet on mobile. Completed replies announced to screen readers (not each delta); fully keyboard operable; theme tokens only.

## 9. Errors

- Provider timeout, 429 or 5xx: one retry after a short backoff, then a typed `AI provider unavailable` error; console shows "The AI service didn't respond. Try again."
- Malformed or unknown tool call: reported to the model once as a tool error; if repeated, the turn ends with a polite fallback reply.
- Tool failure: static error result to the model.
- Stream aborted by the client or the time budget: the partial assistant message is saved with `interrupted: true`.
- All typed errors map through the existing envelope; no provider error text reaches the client or logs.

## 10. Testing

- **Unit:** prompt assembly (preamble first, language rule, date), tool input/output schemas, allow-list and product-access filtering, loop limits (tool cap, time budget, malformed calls, errors, wrap-up call), unverified-figure detection (taka, ৳, Bangla digits), SSE encoding, OpenAI adapter mapping with recorded fixtures (no network), template validity.
- **Integration (emulator, scripted mock provider):** agent CRUD with versioning, permissions per role and cross-org isolation; sessions and messages persisted; each tool against seeded catalog data (prices, stock, totals in paisa, out-of-scope products refused); `save_customer_info` and `escalate_to_human` dry-run never write (verified by reading the CRM and session afterwards); turn limit, per-user rate limit and daily cap; 503 when OpenAI is not configured; rules deny client access to sessions.
- **Not in CI:** real OpenAI calls. A documented manual smoke test covers them once the key is in `.env.local`.

## 11. Open questions

None blocking. The model id defaults to `OPENAI_CHAT_MODEL`; the user chooses the value.
