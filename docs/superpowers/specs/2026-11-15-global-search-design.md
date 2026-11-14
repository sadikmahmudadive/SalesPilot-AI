# Global search in the dashboard header — design (small change)

Date: 2026-11-15 · Status: approved in chat · Branch: `feat/global-search`

**Intent.** The header search box is a disabled placeholder. Make it find customers, products, orders and
conversations from anywhere in the dashboard.

**Approaches.** (1) Fan out to the existing per-section searches through one route — chosen: no new
indexes, same matching users already know from each list. (2) An external search index (Algolia/Typesense)
for "contains"/typo-tolerant search — rejected for now: new service, sync pipeline, cost.

**Design.**
- `GET /api/search?q=` (`withApi`, any member, rate-limited 120/60 s). `q` trimmed, 2–100 chars, else 400.
- Groups (max 5 each), each only if the role has its read permission; a group the role cannot read is
  `null`. A query a group cannot search (e.g. "shirt" for orders) gives that group `[]`, never an error:
  - Customers (`customers:read`): name prefix or phone prefix (existing `listCustomers` search).
  - Products (`products:read`): name prefix, plus SKU prefix when the query has no spaces (merged, unique).
  - Orders (`orders:read`): only when the query is an order number (`SP-…`) or a phone number.
  - Conversations (`inbox:read`): phone → exact contact; otherwise contact name or phone match among the
    100 most recent conversations (the inbox's existing search; stated in the UI copy).
- Hit: `{ id, title, subtitle, href }`. Links: `/customers/{id}`, `/products/{id}`, `/orders/{id}`,
  `/inbox?c={id}`. "See all" links: `/customers?q=`, `/products?q=`, `/orders?q=`, `/inbox?q=`; those list
  pages (and the inbox) start with that search (server page `searchParams`, remount keyed by it).
- UI: debounced (250 ms) dropdown under the box; `Ctrl/⌘ K` focuses; ↑/↓ move, Enter opens, Esc closes;
  click outside closes. Hidden below `md`, as today.

**Non-goals.** Contains/typo search; mobile search; searching messages' text.
**Anti-goals.** Showing anything a role cannot see; a failing group breaking the others.
