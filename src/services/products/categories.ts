/**
 * Category service: create and list. Server-only.
 *
 * Categories are flat, per organization, and referenced by id from products. This phase has no
 * rename, delete or slug: add them together with a lock-moving transaction when needed (YAGNI).
 *
 * UNIQUENESS. A name is unique per organization, ignoring case, spacing and Unicode
 * compatibility forms (`sortKey`), through `categoryNames/{organizationId}_{sha256(nameLower)}`
 * created in the SAME transaction as the category (an ALREADY_EXISTS on it is the duplicate).
 *
 * LIST CAP. `listCategories` returns at most 200 categories (`CATEGORY_LIST_LIMIT`), sorted by
 * name, with no pagination: the product form needs them all in one dropdown. Exceeding the cap
 * should be handled by paginating then; the cap keeps responses bounded meanwhile.
 *
 * AUDIT. Same transaction; ids and field names only.
 */
import "server-only";

import { FieldValue } from "firebase-admin/firestore";

import { ConflictError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import { isAlreadyExists } from "@/lib/firestore-errors";
import { writeAuditInTransaction } from "@/lib/security/audit";
import { sortKey } from "@/lib/text";
import { invalid } from "@/lib/validation-error";
import {
  CATEGORIES,
  buildCategory,
  categoryNameLockRef,
  categoryRepo,
  type CategoryDoc,
} from "@/repositories/categories";
import type { Category, CategoryInput } from "@/schemas/product";

import { assertCtx, type ProductCtx } from "./products";

export const CATEGORY_LIST_LIMIT = 200;
const DUPLICATE_NAME_MESSAGE = "A category with this name already exists";

function toCategory(doc: CategoryDoc): Category {
  const copy: Partial<CategoryDoc> = { ...doc };
  delete copy.nameLower;
  return copy as Category;
}

export async function createCategory(ctx: ProductCtx, input: CategoryInput): Promise<Category> {
  assertCtx(ctx);
  const orgId = ctx.organizationId;
  const name = typeof input?.name === "string" ? input.name : "";
  const nameLower = sortKey(name);
  if (nameLower.length === 0) throw invalid("name", "Enter the category name");
  const description = typeof input.description === "string" ? input.description : undefined;
  const lockRef = categoryNameLockRef(orgId, nameLower);

  let id = "";
  try {
    await adminDb().runTransaction(async (tx) => {
      const { ref, data } = buildCategory(orgId, {
        name,
        nameLower,
        ...(description !== undefined ? { description } : {}),
      });
      id = ref.id;
      tx.create(lockRef, {
        organizationId: orgId,
        categoryId: ref.id,
        createdAt: FieldValue.serverTimestamp(),
      });
      tx.create(ref, data);
      writeAuditInTransaction(tx, {
        organizationId: orgId,
        actorUid: ctx.uid,
        action: "category.create",
        resource: "category",
        resourceId: ref.id,
        after: { changedFields: description !== undefined ? ["name", "description"] : ["name"] },
      });
    });
  } catch (err) {
    if (isAlreadyExists(err)) throw new ConflictError(DUPLICATE_NAME_MESSAGE);
    throw err;
  }
  const stored = await categoryRepo.get(orgId, id);
  if (!stored) throw new Error("Category vanished after creation");
  return toCategory(stored);
}

/** Up to `CATEGORY_LIST_LIMIT` categories of the organization, by normalised name. */
export async function listCategories(ctx: ProductCtx): Promise<Category[]> {
  assertCtx(ctx);
  // Not `categoryRepo.list`: it caps pages at 100, and this endpoint is deliberately unpaginated.
  const snap = await adminDb()
    .collection(CATEGORIES)
    .where("organizationId", "==", ctx.organizationId)
    .orderBy("nameLower")
    .limit(CATEGORY_LIST_LIMIT)
    .get();
  return snap.docs
    .map((doc) => categoryRepo.fromSnapshot(doc, ctx.organizationId))
    .filter((c): c is CategoryDoc => c !== null)
    .map(toCategory);
}
