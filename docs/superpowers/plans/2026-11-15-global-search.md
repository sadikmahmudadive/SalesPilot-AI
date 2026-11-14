# Global Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use `- [ ]`.

**Goal:** A working header search over customers, products, orders and conversations.
**Architecture:** One route fans out to existing list services (parallel, per-group try/catch, permission-gated); a client dropdown renders grouped hits; list pages accept `?q=`.
**Spec:** `docs/superpowers/specs/2026-11-15-global-search-design.md`

## Global Constraints
- `q` 2–100 chars after trim; max 5 hits per group; group `null` when the role lacks its read permission.
- A group that throws `ValidationError` (query not searchable there) returns `[]`; any other error is logged and returns `[]` (one group never breaks the response).
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus
1. Phone-looking queries ("01711…") must not error in groups that do name search. → Task 1 test `phone query searches every group without errors`.
2. A role without a permission never receives that group's data. → Task 1 test `omits groups the role cannot read` (unit-test the gate with a role map).
3. Other workspaces' records never appear. → Task 1 test `only returns this workspace's records`.

### Task 1: Search service and route
Files: `src/services/search/global-search.ts`, `src/services/search/global-search.int.test.ts`, `src/app/api/search/route.ts`, `src/app/api/search/route.int.test.ts`.
Produces: `SearchHit { id; title; subtitle: string | null; href }`, `SearchResults { customers; products; orders; conversations: SearchHit[] | null }`, `globalSearch(ctx: { organizationId; uid; role }, q: string): Promise<SearchResults>`, `searchQuerySchema`.
- [ ] Failing tests (int): finds a customer by name and by phone; a product by name and by SKU; an order by `SP-` number and by phone; a conversation by name and by phone; phone query has no group errors; other org's records absent; `q` of 1 char → 400 via route; unauthenticated → 401.
- [ ] Implement, run, commit `feat(search): global search service and API`.

### Task 2: Header dropdown and `?q=` on list pages
Files: `src/components/dashboard/global-search.tsx`, `src/components/dashboard/global-search-model.ts` (+ `.test.ts`), modify `header.tsx`, the customers/products/orders pages + list components (`initialSearch` prop, `key`), inbox page/shell (`?q=`, `?c=`).
Produces (pure): `flattenHits(results): Array<{ group; hit }>`, `moveIndex(i: number, delta: 1 | -1, length: number): number` (wraps, -1 when empty), `seeAllHref(group, q): string`.
- [ ] Failing unit tests for the model; implement; typecheck, lint, unit, build; commit `feat(search): header search dropdown`.
