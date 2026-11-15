# Phase 3a AI Agents and Tool Calling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Org admins create AI sales agents, test them in a dashboard console, and get answers grounded only in the real catalog, prices and stock, with CRM writes and escalations shown as dry runs.

**Architecture:** Our own bounded agent loop on the server: a `ChatProvider` interface with an OpenAI Responses API adapter; a Zod-validated tool registry executed against Firestore with org scope and product-access filtering; sessions and messages stored in our Firestore; replies streamed to the console over SSE from a `withApi` POST route.

**Tech Stack:** Next.js 16 (App Router, `src/proxy.ts`), TypeScript strict, Firebase Admin/Firestore, Zod 4 (`z.toJSONSchema`), official `openai` SDK (new dependency), TanStack Query, shadcn/ui, Vitest + Firebase emulators.

**Spec:** `docs/superpowers/specs/2026-11-09-ai-agents-tool-calling-design.md` (read it; it is binding). Background: `docs/superpowers/specs/2026-11-06-foundation-core-data-design.md`.

## Global Constraints

- Follow existing patterns: `withApi` (explicit `permission` required), `OrgRepository` + `fromSnapshot(snap, orgId)`, `writeAuditInTransaction`, `assertRateLimit`, typed errors from `src/lib/errors.ts`, index tables in code mirrored in `firestore.indexes.json` with a table==JSON test, shared UI in `src/components/shared/*`, `apiFetch` on the client.
- All data org-scoped; only the server writes; `agentSessions` and messages are not client-readable (rules + rules test).
- Permissions: add `agents:read`, `agents:write`, `agents:test`; owner/admin all three; role `agent` read + test; viewer read only.
- Limits (spec §3): `maxTurnsPerSession` 1–100 default 30; `maxToolCallsPerTurn` 1–6 default 4; `maxOutputTokens` 100–2000 default 600; turn wall-clock budget 25 s; route `maxDuration = 60`; history window 20 messages; user message 1–2000 chars; 20 messages/min per user; per-org daily cap `AI_DAILY_MESSAGE_LIMIT` default 500.
- Test channel writes are always dry-run, decided on the server from `session.channel`.
- No message text or customer details in logs; agent audit rows carry field names only; `OPENAI_API_KEY` server-only.
- CI never calls OpenAI: tests use the mock provider or recorded fixtures.
- Windows/emulators: check listeners with PowerShell `Get-NetTCPConnection -State Listen` before/after `npm run test:int`; never kill processes; use a scratchpad alternate-port config if 8085/9199/4400 are busy. Do not start `next dev`/`next start` (they leak).
- Edit/Write tools decode `\uXXXX` escapes into raw characters: never edit `src/lib/phone.ts` / `src/schemas/customer.ts` with them; use escapes for any non-ASCII in regex source (e.g. `৳` for ৳, Bangla digits `০-৯`) and run `grep -nP '[^\x00-\x7F]'` on such files.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Bangla or Banglish shopping queries (`লাল শার্ট`, `lal shirt`): search must return a clean empty result (never an error) when nothing matches, and Bangla product names must match Bangla queries — Task 5.
2. The model requests a tool not on the agent's allow-list, or a product outside its product access: the tool result is `denied`/not found and leaks nothing about the out-of-scope product — Tasks 5 and 8.
3. An admin edits the agent while a test session is open: the next turn uses the current configuration and the message records the `agentVersion` it used — Task 8.
4. The user presses Stop (client aborts the stream) mid-reply: the partial reply is saved with `interrupted: true`, the turn counts once, and no orphan "open" state is left — Task 9.
5. OpenAI returns 429/5xx or times out: exactly one retry, then a typed provider error rendered as the static console message, with no provider text leaked — Tasks 4 and 9.

---

### Task 1: Agent domain (permissions, schemas, templates)

**Files:** Modify `src/lib/security/permissions.ts` (+ test); Create `src/schemas/agent.ts`, `src/schemas/agent.test.ts`, `src/services/agents/templates.ts`, `src/services/agents/templates.test.ts`, `src/config/agent-labels.ts`.

**Interfaces — Produces:**
- `AGENT_ROLES = ['retail_sales','wholesale_sales','customer_support','order_management','voice_sales'] as const`, `AGENT_LANGUAGES = ['bn','en','banglish'] as const`, `AGENT_CHANNELS = ['test','whatsapp','voice'] as const`, `TOOL_NAMES = ['search_products','get_product_details','get_price','check_stock','calculate_order_total','lookup_customer','save_customer_info','escalate_to_human'] as const`, `WRITE_TOOLS: ReadonlySet<ToolName>` = save_customer_info, escalate_to_human; types `AgentRole`, `AgentLanguage`, `AgentChannel`, `ToolName`.
- `agentInputSchema`, `agentPatchSchema` (no defaults applied, empty patch rejected, `status` patchable), `type AgentInput`, `type AgentPatch`, `type Agent` (adds `id, organizationId, version, createdBy, createdAt, updatedAt` as ISO strings), `VERSIONED_FIELDS` (the ten fields listed in spec §3).
- `AGENT_TEMPLATES: Readonly<Record<AgentRole, Pick<AgentInput,'description'|'personality'|'instructions'|'objectives'|'tools'|'languages'|'responseStyle'>>>`.
- `AGENT_ROLE_LABELS`, `AGENT_LANGUAGE_LABELS`, `TOOL_LABELS` (name + one-line description), `HUMAN_AGENT_ROLE_LABEL = "Sales agent (team member)"`.

- [ ] **Step 1: Failing tests.** Permission matrix table test for the three new permissions per role. Schema tests: all field bounds from spec §3 (name 1–80 trimmed, description ≤500, personality ≤1000, instructions ≤8000, objectives ≤10×≤200, languages non-empty unique, tools ⊆ TOOL_NAMES unique, productAccess `{mode:'all'}` or `{mode:'categories', categoryIds}` 1–20 valid id segments, channels must include `'test'`, escalation keywords ≤20×≤40, maxTurnsBeforeHandover 1–50 optional, limits defaults 30/4/600 and bounds, responseStyle, model ≤100); unknown keys stripped (`version`, `organizationId`, `createdBy`); patch `{name}` parses to exactly `{name}`; `{}` rejected. Templates: every role has a template that parses with `agentInputSchema` (with a name added); every template's tools ⊆ TOOL_NAMES; customer_support template has no catalog-write assumptions (only listed tools).
- [ ] **Step 2: Run** `npx vitest run --project unit src/schemas/agent.test.ts src/services/agents/templates.test.ts src/lib/security/permissions.test.ts` → FAIL.
- [ ] **Step 3: Implement.** Templates: plain English instructions with short Bangla example phrases; each instructs grounding on tools and offering a human when unsure. Add the three permissions to `PERMISSIONS` and the matrix.
- [ ] **Step 4: Run** the same command → PASS; `npm run typecheck`.
- [ ] **Step 5: Commit** `feat(agents): agent schemas, permissions and role templates`.

### Task 2: Agent service, repository, rules and indexes

**Files:** Create `src/repositories/agents.ts`, `src/services/agents/agents.ts`, `src/services/agents/agent-indexes.ts`, `src/services/agents/agents.int.test.ts`, `src/services/agents/agent-indexes.test.ts`; Modify `firestore.rules`, `firestore.indexes.json`, `tests/rules/tenancy.rules.test.ts`.

**Interfaces — Consumes:** Task 1 schemas. **Produces:** `AgentCtx = { organizationId: string; uid: string }`; `createAgent(ctx, input: AgentInput): Promise<Agent>` (version 1, `createdBy` = uid, audit `agent.create`); `getAgent(ctx, id): Promise<Agent>` (NotFound cross-org); `listAgents(ctx, q: { limit?: number; cursor?: string }): Promise<{ items: Agent[]; nextCursor: string | null }>` (ordered `updatedAt desc`); `updateAgent(ctx, id, patch: AgentPatch): Promise<Agent>` (transaction; bumps `version` iff any `VERSIONED_FIELDS` value changes by deep compare; audit `agent.update` with changed field names + new version, or `agent.activate`/`agent.deactivate` for status-only changes); `productAccess.categoryIds` must exist in the same org (ValidationError otherwise); `AGENT_LIST_INDEXES`.

- [ ] **Step 1: Failing tests.** Integration: create returns version 1 and audit row without instruction text; update of `name` keeps version; update of `instructions` bumps to 2; patch with an unchanged `tools` array keeps version; status inactive→active writes `agent.activate`; cross-org get/update → NotFound; foreign `categoryIds` → ValidationError; list order and pagination with no duplicates. Rules: org member can read own org's `agents`, not another org's; nobody can read `agentSessions` or `agentSessions/*/messages` (seed via rules-disabled context); no client writes. Index test: table == JSON for `agents` and `agentSessions`; other collections untouched.
- [ ] **Step 2: Run** `npm run test:int` (agents + rules files) → FAIL.
- [ ] **Step 3: Implement.** Indexes: agents `(organizationId ASC, updatedAt DESC, __name__ DESC)`; sessions `(organizationId ASC, agentId ASC, lastMessageAt DESC, __name__ DESC)`. Rules: `agents` read like `products`; `agentSessions` (and subcollection) deny all.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(agents): agent service with versioning, rules and indexes`.

### Task 3: Agent API routes

**Files:** Create `src/app/api/agents/route.ts`, `src/app/api/agents/[id]/route.ts`, `src/app/api/agents/route.int.test.ts`.

**Interfaces — Consumes:** Task 2 service. **Produces:** `GET /api/agents` (`agents:read`, query `limit`, `cursor`) → `{ items, nextCursor }`; `POST /api/agents` (`agents:write`, rateLimit `agents.create` 30/min, schema `agentInputSchema`) → 201 Agent; `GET /api/agents/[id]` (`agents:read`); `PATCH /api/agents/[id]` (`agents:write`, rateLimit `agents.update` 60/min, schema `agentPatchSchema`). Invalid/other-org id → 404.

- [ ] **Step 1: Failing tests** in the style of `src/app/api/customers/route.int.test.ts` (mocked session, real emulator): viewer GET 200 / POST 403; role `agent` POST 403; admin create 201; PATCH bumps version per Task 2 rules; cross-org 404; invalid body 400; text/plain 415; cross-origin 403; unauthenticated 401.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(agents): agent API routes`.

### Task 4: AI provider layer

**Files:** `npm i openai` (pin the installed version in the report); Create `src/lib/ai/provider.ts`, `src/lib/ai/openai-provider.ts`, `src/lib/ai/mock-provider.ts`, `src/lib/ai/strict-schema.ts`, tests `openai-provider.test.ts` (with JSON fixtures under `src/lib/ai/__fixtures__/`), `strict-schema.test.ts`, `mock-provider.test.ts`; Modify `src/lib/errors.ts` (+ test).

**Interfaces — Produces:**
- Types: `ChatMessage = { role: 'user'; text: string } | { role: 'assistant'; text: string; toolCalls: ProviderToolCall[] } | { role: 'tool'; toolCallId: string; name: string; resultJson: string }`; `ProviderToolCall = { id: string; name: string; argumentsJson: string }`; `ToolSpec = { name: string; description: string; parameters: Record<string, unknown> }`; `ProviderRequest = { model: string; system: string; messages: ChatMessage[]; tools: ToolSpec[]; maxOutputTokens: number; signal?: AbortSignal; onTextDelta?: (delta: string) => void }`; `ProviderResult = { text: string; toolCalls: ProviderToolCall[]; usage: { inputTokens: number; outputTokens: number }; stopReason: 'end' | 'tool_calls' | 'max_tokens' }`; `interface ChatProvider { generate(req: ProviderRequest): Promise<ProviderResult> }`.
- `class AiProviderError extends AppError` with `kind: 'timeout' | 'rate_limited' | 'unavailable' | 'bad_request'`, status 503 (bad_request 502), static message "The AI service didn't respond. Try again."; registered with `isAppError`/`toErrorResponse` like other errors.
- `createOpenAiProvider(opts: { apiKey: string; client?: OpenAILike }): ChatProvider` (server-only); `getChatProvider(): ChatProvider` (throws `IntegrationNotConfiguredError('openai')` when `!isConfigured('openai')`).
- `toStrictJsonSchema(schema: ZodType): Record<string, unknown>` — `z.toJSONSchema` output converted for OpenAI strict mode (every property required, optional → nullable, `additionalProperties: false` at every object level).
- `createMockProvider(script: Array<ProviderResult | ((req: ProviderRequest) => ProviderResult | Promise<ProviderResult>) | Error>): ChatProvider & { calls: ProviderRequest[] }`.

- [ ] **Step 1: Failing tests.** OpenAI adapter with an injected fake client returning recorded Responses-API fixtures: maps text output, function calls (`id`, `name`, `arguments`), usage, stop reasons; sends `instructions` = system, function tools with `strict: true`, `max_output_tokens`; streams deltas to `onTextDelta`; maps SDK errors: 429 → `rate_limited`, 5xx → `unavailable`, timeout/abort → `timeout`, 400 → `bad_request`; retries once on 429/5xx/timeout (assert exactly 2 calls) and never on 400; error message never contains provider text. Strict schema: optional fields become required+nullable; nested objects/arrays get `additionalProperties:false`. Mock provider: replays script in order, records requests, throws scripted errors.
- [ ] **Step 2: Run** `npx vitest run --project unit src/lib/ai` → FAIL. **Step 3: Implement** (read the installed `openai` package's Responses API types; use `client.responses.create({ stream: true, ... })` events for deltas). **Step 4:** PASS + typecheck.
- [ ] **Step 5: Commit** `feat(ai): provider interface, OpenAI Responses adapter and mock provider`.

### Task 5: Tool registry and catalog tools

**Files:** Create `src/services/agents/tools/types.ts`, `registry.ts`, `catalog-access.ts`, `search-products.ts`, `product-details.ts`, `get-price.ts`, `check-stock.ts`, `order-total.ts`, `catalog-tools.int.test.ts`, `registry.test.ts`.

**Interfaces — Consumes:** `Agent` (Task 1), `toStrictJsonSchema` (Task 4), product/inventory repositories, `formatMoney`-style helper from `src/lib/format.ts` (reuse; add `formatTaka(minor)` there if missing, tested), `LOW_STOCK_THRESHOLD`. **Produces:**
- `ToolContext = { organizationId: string; agent: Agent; sessionId: string; channel: AgentChannel; actorUid: string }`.
- `DryRunAction = { kind: 'create_customer' | 'update_customer' | 'escalate'; fields: Record<string, unknown> }`.
- `ToolOutcome<O> = { ok: true; data: O; dryRunAction?: DryRunAction } | { ok: false; code: 'not_found' | 'denied' | 'invalid' | 'failed'; message: string }` (static messages).
- `interface AgentTool<I, O> { name: ToolName; description: string; input: ZodType<I>; output: ZodType<O>; writes: boolean; run(ctx: ToolContext, input: I): Promise<ToolOutcome<O>> }`.
- `TOOL_REGISTRY: Readonly<Record<ToolName, AgentTool<unknown, unknown>>>` (CRM tools are added in Task 6); `toolSpecsFor(agent: Agent): ToolSpec[]` (only `agent.tools`, strict schemas); `executeTool(ctx: ToolContext, name: string, argumentsJson: string): Promise<ToolOutcome<unknown>>` (unknown/not-allowed → `denied`; JSON/schema failure → `invalid`; thrown errors → `failed`, logged with tool name + code only).
- `isProductInScope(agent, product): boolean` in `catalog-access.ts`.

Tool contracts: exactly spec §5 (inputs, bounds, outputs, wholesale fallback flag `wholesaleFallback: true`, `calculate_order_total` line flags `out_of_scope | archived | insufficient_stock`, `deliveryNote: "Delivery charges are not available yet."`). `search_products` reads at most 1000 non-archived products per org (ordered by `nameLower`), filters `availability === 'active'` and scope, tokenises query and fields with NFKC + lower-case, scores by matched tokens (name > sku > category > specs), returns top `limit` (≤5); no match → `{ ok: true, data: { results: [] } }`.

- [ ] **Step 1: Failing tests** (emulator, seeded org with Bangla and English products, two categories, variants, stock): search finds by English token, SKU prefix, Bangla name token (`শার্ট`), category name; `lal shirt` with no match returns empty results (Review Focus 1); out-of-scope category products never appear; archived/draft never appear; details/price/stock on an out-of-scope product → `not_found` with no product data (Review Focus 2); `get_price` wholesale fallback flagged; `check_stock` thresholds (available 0 → out_of_stock, ≤5 → low, else in_stock); `calculate_order_total` subtotal exact in paisa and taka text, flags insufficient stock, refuses >20 lines/qty>1000 as `invalid`; `executeTool` with a tool not in `agent.tools` → `denied`, with malformed JSON → `invalid`. Unit: `toolSpecsFor` emits only allowed tools with strict schemas.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(agents): tool registry and catalog tools`.

### Task 6: CRM tools with channel-driven dry-run

**Files:** Create `src/services/agents/tools/lookup-customer.ts`, `save-customer-info.ts`, `escalate.ts`, `crm-tools.int.test.ts`; Modify `registry.ts`; Modify `src/services/crm/customers.ts` only if needed to accept an audit actor label (keep existing behaviour; add an optional `actorLabel` used as audit actor, default unchanged).

**Interfaces — Produces:** registry entries for `lookup_customer`, `save_customer_info`, `escalate_to_human` per spec §5. `save_customer_info` in `channel === 'test'`: parse with `customerInputSchema` (create) or `customerPatchSchema` (update, when the phone already exists in the org), return `dryRunAction` `{ kind: 'create_customer' | 'update_customer', fields }` (fields = parsed values minus derived/internal keys), no writes. Live channels: call `createCustomer`/`updateCustomer` with actor `ai-agent:{agentId}`. `escalate_to_human`: test → `dryRunAction { kind: 'escalate', fields: { reason } }`; live → set session `status: 'escalated'` + `escalationReason` (session update function provided by Task 8; until then accept an injected `escalateSession(ctx, reason)` dependency in `ToolContext`-adjacent deps).

- [ ] **Step 1: Failing tests:** lookup by local and +880 formats returns `{exists, fullName, segment}` only (no phone/email/address); unknown phone → `{exists:false}`; test-channel save of a new phone returns `create_customer` dry run and the customers collection is unchanged (count + lock collection checked); test-channel save of an existing phone returns `update_customer` with only provided fields; invalid phone → `invalid` with static message; test-channel escalate returns dry run and the session doc is unchanged; live-channel save creates the customer with audit actor `ai-agent:{agentId}` (exercise with `channel: 'whatsapp'` directly against the service).
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat(agents): CRM capture and escalation tools with dry-run`.

### Task 7: Prompt assembly and unverified-figure check

**Files:** Create `src/services/agents/prompt.ts`, `src/services/agents/figures.ts`, tests beside them.

**Interfaces — Produces:** `SAFETY_PREAMBLE: string`; `buildSystemPrompt(input: { agent: Agent; organizationName: string; now: Date }): string`; `findUnverifiedFigures(replyText: string, toolData: unknown[]): string[]` (returns the amounts, normalized as integer paisa strings, that appear in the reply but in no tool result).

- [ ] **Step 1: Failing tests:** preamble is the first block and states it cannot be overridden; personality/instructions/objectives/response style appear after it; language rule lists the agent's languages and says to reply in the customer's language and keep product names as stored; date rendered for Asia/Dhaka (`2026-11-09` for a UTC instant late on 2026-11-08 after 18:00 UTC); an instruction text containing "ignore previous instructions" stays inside the agent section, after the preamble. Figures: `৳1,250` / `1250 taka` / `Tk 1,250.50` / Bangla digits `৳১২৫০` detected; amounts present in tool data (as `priceMinor` 125000 or `priceText` "৳1,250.00") are not flagged; non-money numbers (quantities, phone numbers, "2 pieces") not flagged.
- [ ] **Step 2–4:** FAIL → implement (regexes with `৳` and `০-৯` escapes; non-ASCII grep clean) → PASS.
- [ ] **Step 5: Commit** `feat(agents): system prompt assembly and unverified figure check`.

### Task 8: Sessions and the agent engine

**Files:** Create `src/repositories/agent-sessions.ts`, `src/services/agents/sessions.ts`, `src/services/agents/engine.ts`, `src/services/agents/events.ts`, `engine.int.test.ts`, `sessions.int.test.ts`, `events.test.ts`.

**Interfaces — Consumes:** Tasks 2, 4, 5, 6, 7. **Produces:**
- `AgentSession`, `AgentMessage` types (spec §3 plus `agentVersion` on each assistant message).
- `createSession(ctx: AgentCtx, agentId: string, channel: AgentChannel = 'test'): Promise<AgentSession>`; `getSessionWithMessages(ctx, sessionId): Promise<{ session; messages }>`; `listSessions(ctx, agentId, q: { limit?: number; cursor?: string })`; `markEscalated(ctx, sessionId, reason)` (wired into Task 6's live escalate).
- `AgentEvent = { type: 'text_delta'; text } | { type: 'tool_started'; callId; name; args } | { type: 'tool_finished'; callId; name; status: 'ok'|'error'|'denied'; resultSummary; durationMs } | { type: 'dry_run_action'; callId; action: DryRunAction } | { type: 'done'; messageId; usage; warnings: string[]; latencyMs } | { type: 'error'; code: string; message: string; requestId?: string }`; `encodeSse(event: AgentEvent): string` (`event: <type>\ndata: <json>\n\n`).
- `runAgentTurn(deps: { provider: ChatProvider; now?: () => number; budgetMs?: number }, input: { ctx: AgentCtx; sessionId: string; userText: string; signal?: AbortSignal; emit: (e: AgentEvent) => void }): Promise<{ messageId: string; interrupted: boolean }>` — algorithm per spec §4: loads session + current agent config (Review Focus 3: uses current config; records `agentVersion` used), refuses with `ConflictError` when `turnCount >= limits.maxTurnsPerSession`, history = last 20 messages (tool results summarized), loop bounded by `maxToolCallsPerTurn` and `budgetMs` (default 25 000) with one final tools-free wrap-up call, malformed/unknown tool call reported once then polite fallback, figures check, single batched write of user message + assistant message + session counters; on abort saves the partial reply with `interrupted: true` and still counts the turn once.
- Tool result summaries for history/persistence: `summarizeToolResult(name, outcome): string` (≤500 chars, no customer phone/email/address).

- [ ] **Step 1: Failing tests** (emulator + mock provider scripts): plain reply persisted with usage and agentVersion; tool call → executes → second model call receives the tool result → final text; tool cap reached triggers wrap-up call without tools (assert last request has `tools: []`); budget exceeded (inject `now`) triggers wrap-up; denied tool (not in allow-list) yields `tool_finished status:'denied'` and no data (Review Focus 2); malformed arguments twice → fallback reply, no throw; dry-run save emits `dry_run_action` and CRM unchanged; reply quoting a price not in tool data → `done.warnings` contains `unverified_figure`; agent instructions edited between turns → second message has `agentVersion: 2` and the second provider call's system prompt contains the new instructions (Review Focus 3); abort via signal mid-stream → message saved `interrupted: true`, `turnCount` +1 once (Review Focus 4); turn limit → ConflictError and nothing written; provider `AiProviderError` → `error` event with static message and the user message still saved. Unit: `encodeSse` format and escaping of newlines inside JSON.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat(agents): sessions and bounded agent engine`.

### Task 9: Session API with streaming and guards

**Files:** Create `src/app/api/agents/[id]/sessions/route.ts`, `src/app/api/agent-sessions/[sessionId]/route.ts`, `src/app/api/agent-sessions/[sessionId]/messages/route.ts`, `src/app/api/agent-sessions/sessions.int.test.ts`; Modify `.env.example` (`AI_DAILY_MESSAGE_LIMIT`, optional, default 500), `src/config/env.ts` (+ test) to parse it.

**Interfaces — Produces:** routes per spec §7. Messages route: `withApi({ permission: 'agents:test', schema: { text: 1–2000 trimmed }, rateLimit: { name: 'agents.message', limit: 20, windowSec: 60 } })`; before the provider: `getChatProvider()` (503 when not configured), per-org daily cap `assertRateLimit('agents.daily:{orgId}', { limit, windowSec: 86400 })`; returns `new Response(ReadableStream)` with `Content-Type: text/event-stream`, `Cache-Control: no-store`, `X-Accel-Buffering: no`; `export const maxDuration = 60; export const runtime = 'nodejs'`. Client disconnect (`req.signal`) aborts the turn. Errors before streaming use the JSON envelope; errors after streaming starts are sent as an `error` event.

- [ ] **Step 1: Failing tests** (mock provider injected through a test seam in `getChatProvider`): viewer POST session 403; role `agent` can create session and send message; SSE body parses into ordered events ending with `done`; OpenAI not configured → 503 JSON envelope; 21st message in a minute → 429; daily cap (lowered via env) → 429; empty/whitespace text and 2001 chars → 400; other-org session → 404; turn limit → 409; provider error mid-stream → `error` event with the static message and no provider text (Review Focus 5); aborted request → session shows the interrupted message (Review Focus 4); GET session returns messages oldest first; sessions list paginated newest first.
- [ ] **Step 2–4:** FAIL → implement → PASS (pin the clock for the 429 tests with `src/test/pin-clock.ts`).
- [ ] **Step 5: Commit** `feat(agents): session API with SSE streaming and usage guards`.

### Task 10: Agents list and editor UI

**Files:** Replace `src/app/(dashboard)/agents/page.tsx` (stub); Create `src/app/(dashboard)/agents/new/page.tsx`, `src/app/(dashboard)/agents/[id]/page.tsx`, `src/hooks/use-agents.ts`, `src/components/agents/{agent-list,agent-form,agent-form-model,agent-form-sections,tool-picker,product-access-field}.tsx|ts`, `agent-form-model.test.ts`; Modify `src/config/nav.ts` (remove `phase: 3` from AI Agents) and its test.

**Interfaces — Consumes:** Task 3 routes, Task 1 labels/templates, shared components. **Produces:** `prepareAgentBody(values)`, `buildAgentPatch(baseline, values)` (only changed fields; arrays/maps whole when changed; no empty PATCH), `applyTemplate(values, role)` (only for new agents; does not overwrite fields the user already edited).

- [ ] **Step 1: Failing tests** (pure): template applied on role pick for new agents only; `buildAgentPatch` sends only changed fields, `tools`/`objectives`/`escalation`/`limits`/`productAccess` whole when changed, no request when nothing changed; status-only change produces `{ status }`; body parses with `agentInputSchema`.
- [ ] **Step 2–4:** FAIL → implement UI per spec §8 (pages call `requireDashboardContext()`, `params` awaited; writers only see New/Save; WhatsApp/voice channel checkboxes disabled with their phase; "writes data" badges; read-only for non-writers via `<fieldset disabled>`) → PASS; `npm run typecheck && npm run lint && npm run build`.
- [ ] **Step 5: Commit** `feat(agents): agents list and editor UI`.

### Task 11: Test console UI

**Files:** Create `src/app/(dashboard)/agents/[id]/test/page.tsx`, `src/components/agents/console/{test-console,chat-pane,inspector-pane,session-picker,message-bubble}.tsx`, `src/lib/agents/sse-client.ts`, `src/lib/agents/console-state.ts`, tests `sse-client.test.ts`, `console-state.test.ts`, `src/hooks/use-agent-sessions.ts`.

**Interfaces — Produces:** `readSseStream(response: Response, onEvent: (e: AgentEvent) => void, signal?: AbortSignal): Promise<void>` (handles chunk boundaries, multi-line data, unknown event types ignored); `consoleReducer(state, action)` building the transcript and inspector entries from events (text accumulation, tool rows keyed by `callId`, dry-run highlights, warnings, done/usage, error, interrupted).

- [ ] **Step 1: Failing tests** (pure): SSE parser across arbitrary chunk splits and CRLF; reducer turns an event sequence into one assistant message with tool rows, dry-run action, warnings, usage; error event produces the static message and keeps the user message; abort marks the message interrupted.
- [ ] **Step 2–4:** FAIL → implement UI per spec §8 (POST with `apiFetch`-compatible headers but read the body stream; Stop uses `AbortController`; Enter/Shift+Enter; banner text exactly "Test mode: nothing the agent does here changes real data."; "AI provider not configured" panel on 503; inspector in a `Sheet` on mobile; announce completed replies via the shared live-status hook) → PASS; typecheck, lint, build.
- [ ] **Step 5: Commit** `feat(agents): agent test console`.

### Task 12: Docs and release gates

**Files:** Create `docs/setup/openai.md`; Modify `README.md` (AI agents section, env table, mock vs real row), `docs/CHECKLIST.md` (Phase 3a items with markers), `scripts/check-bundle-secrets.mjs` only if `OPENAI_API_KEY` is missing from its list.

- [ ] **Step 1:** `docs/setup/openai.md`: create a key, put `OPENAI_API_KEY` and `OPENAI_CHAT_MODEL` in `.env.local`/Vercel (never commit or paste in chat), `AI_DAILY_MESSAGE_LIMIT`, cost note, and a manual smoke test (create agent from the retail template, ask in Bangla for a product price, verify the price matches the product page, ask to save your details and confirm the dry-run action, confirm no customer was created).
- [ ] **Step 2: Gate** (report real output): `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run test:int`, `npm run build`, `npm run check:bundle`.
- [ ] **Step 3: Commit** `docs: OpenAI setup, Phase 3a checklist`.
