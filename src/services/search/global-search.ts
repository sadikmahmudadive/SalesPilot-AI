/**
 * Header search across the dashboard. Server-only.
 *
 * It fans out to the EXISTING per-section searches (so matching is what each list already does, and no
 * new index is needed), in parallel, at most `SEARCH_GROUP_LIMIT` hits per group:
 *   customers      name prefix or phone prefix (`listCustomers` search)
 *   products       name prefix, plus SKU prefix when the query has no spaces
 *   orders         only for an order number (`SP-…`) or a phone number (`listOrders` q)
 *   conversations  a phone number -> that contact's conversation; otherwise a name/phone match among
 *                  the 100 most recent conversations (the inbox's own search)
 * A group the role cannot read is `null`. A query a group cannot search (its ValidationError) is `[]`;
 * any other failure is logged and is `[]` too, so one group never breaks the others. Every service call
 * is scoped to the caller's organization.
 */
import "server-only";

import { z } from "zod";

import { ValidationError } from "@/lib/errors";
import { formatMoneyMinor } from "@/lib/format";
import { logger } from "@/lib/logger";
import { normalizePhone } from "@/lib/phone";
import { can, type Permission, type Role } from "@/lib/security/permissions";
import { findConversationByContact } from "@/repositories/conversations";
import { listCustomers } from "@/services/crm/customers";
import { listConversations } from "@/services/inbox/inbox";
import { listOrders } from "@/services/orders/queries";
import { listProducts } from "@/services/products/products";

export const SEARCH_GROUP_LIMIT = 5;

/** The search text: 2-100 characters after trimming. */
export const searchQuerySchema = z
  .string()
  .trim()
  .min(2, { error: "Type at least 2 characters" })
  .max(100, { error: "Search must be 100 characters or fewer" });
const CONVERSATION_SCAN = 100;
const ORDER_NUMBER = /^SP-\d+$/i;

export interface SearchHit {
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
}

export interface SearchResults {
  customers: SearchHit[] | null;
  products: SearchHit[] | null;
  orders: SearchHit[] | null;
  conversations: SearchHit[] | null;
}

export interface SearchCtx {
  organizationId: string;
  uid: string;
  role: Role;
}

type Group = keyof SearchResults;

const PERMISSION: Readonly<Record<Group, Permission>> = {
  customers: "customers:read",
  products: "products:read",
  orders: "orders:read",
  conversations: "inbox:read",
};

/** Runs one group: null without permission, [] when the query does not apply or the group fails. */
async function group(
  name: Group,
  allowed: (permission: Permission) => boolean,
  run: () => Promise<SearchHit[]>,
): Promise<SearchHit[] | null> {
  if (!allowed(PERMISSION[name])) return null;
  try {
    return (await run()).slice(0, SEARCH_GROUP_LIMIT);
  } catch (err) {
    if (!(err instanceof ValidationError)) {
      logger.warn("search.group_failed", {
        group: name,
        error: err instanceof Error ? err.name : "unknown",
      });
    }
    return [];
  }
}

const enc = encodeURIComponent;

export async function globalSearch(
  ctx: SearchCtx,
  rawQuery: string,
  options: { can?: (permission: Permission) => boolean } = {},
): Promise<SearchResults> {
  const q = rawQuery.trim();
  const allowed = options.can ?? ((permission: Permission) => can(ctx.role, permission));
  const scoped = { organizationId: ctx.organizationId, uid: ctx.uid };
  const phone = normalizePhone(q);

  const [customers, products, orders, conversations] = await Promise.all([
    group("customers", allowed, async () => {
      const page = await listCustomers(scoped, {
        search: q,
        sort: "createdAt",
        dir: "desc",
        limit: SEARCH_GROUP_LIMIT,
      });
      return page.items.map((c) => ({
        id: c.id,
        title: c.fullName,
        subtitle: c.phoneE164 ?? null,
        href: `/customers/${enc(c.id)}`,
      }));
    }),
    group("products", allowed, async () => {
      const base = { sort: "name" as const, dir: "asc" as const, limit: SEARCH_GROUP_LIMIT };
      const byName = await listProducts(scoped, { ...base, q }).catch((e: unknown) => {
        if (e instanceof ValidationError) return { items: [] };
        throw e;
      });
      const bySku = /\s/.test(q)
        ? { items: [] }
        : await listProducts(scoped, { ...base, sku: q }).catch((e: unknown) => {
            if (e instanceof ValidationError) return { items: [] };
            throw e;
          });
      const seen = new Set<string>();
      return [...byName.items, ...bySku.items]
        .filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)))
        .map((p) => ({
          id: p.id,
          title: p.name,
          subtitle: [p.sku, formatMoneyMinor(p.salePriceMinor ?? p.regularPriceMinor)]
            .filter(Boolean)
            .join(" · "),
          href: `/products/${enc(p.id)}`,
        }));
    }),
    group("orders", allowed, async () => {
      if (!ORDER_NUMBER.test(q) && !phone) return [];
      const page = await listOrders(scoped, { q, limit: SEARCH_GROUP_LIMIT });
      return page.items.map((o) => ({
        id: o.id,
        title: o.orderNumber,
        subtitle: `${o.customerSnapshot.name} · ${formatMoneyMinor(o.totalMinor)}`,
        href: `/orders/${enc(o.id)}`,
      }));
    }),
    group("conversations", allowed, async () => {
      const found = phone
        ? [await findConversationByContact(ctx.organizationId, phone, "whatsapp")].filter(
            (c): c is NonNullable<typeof c> => c !== null,
          )
        : (await listConversations(scoped, { limit: CONVERSATION_SCAN, search: q })).items;
      return found.map((c) => ({
        id: c.id,
        title: c.contactName,
        subtitle: c.contactPhoneE164,
        href: `/inbox?c=${enc(c.id)}`,
      }));
    }),
  ]);

  return { customers, products, orders, conversations };
}
