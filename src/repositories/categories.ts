/**
 * Category data access. Server-only.
 *
 *   categories/{categoryId}                              the category (see CategoryDoc)
 *   categoryNames/{organizationId}_{sha256(nameLower)}   name uniqueness lock { organizationId, categoryId, createdAt }
 *
 * The lock is created in the SAME transaction as the category, so a category name is unique per
 * organization (case, spacing and Unicode-compatibility insensitive) without a query. The name
 * is hashed because it may contain "/" or other characters that are unsafe in a document id.
 * Both collections are denied to clients for writes by the Firestore rules (`categories` is
 * read-only for members; `categoryNames` falls through to default deny).
 */
import "server-only";

import { createHash } from "node:crypto";

import type { DocumentReference } from "firebase-admin/firestore";

import { ValidationError } from "@/lib/errors";
import type { Category } from "@/schemas/product";

import { OrgRepository, type OrgCreateInput } from "./base";
import { orgLockRef } from "./products";

/** Stored category: the public shape plus the service-computed unique/sort key. */
export type CategoryDoc = Category & { nameLower: string };

export const CATEGORIES = "categories";
export const CATEGORY_NAMES = "categoryNames";

export const categoryRepo = new OrgRepository<CategoryDoc>(CATEGORIES, {
  filterable: [],
  sortable: ["nameLower"],
});

/** `categoryRepo.build` for payloads that hold Firestore sentinels (typed loosely on purpose). */
export function buildCategory(orgId: string, data: Record<string, unknown>) {
  return categoryRepo.build(orgId, data as unknown as OrgCreateInput<CategoryDoc>);
}

/** Lock of (organization, normalised category name). */
export function categoryNameLockRef(orgId: string, nameLower: string): DocumentReference {
  if (typeof nameLower !== "string" || nameLower.length === 0) {
    throw new ValidationError([{ path: "name", message: "Invalid name" }]);
  }
  const digest = createHash("sha256").update(nameLower, "utf8").digest("hex");
  return orgLockRef(CATEGORY_NAMES, orgId, digest, "name");
}
