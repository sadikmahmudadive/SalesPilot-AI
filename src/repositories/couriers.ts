import { Timestamp } from "firebase-admin/firestore";

import { NotFoundError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import type { CourierAccount, CourierLocation, CourierProvider } from "@/schemas/courier";

export const COURIER_ACCOUNTS = "courierAccounts";
export const COURIER_LOCATIONS = "courierLocations";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export function courierAccountsRef() {
  return adminDb().collection(COURIER_ACCOUNTS);
}

export function courierLocationsRef() {
  return adminDb().collection(COURIER_LOCATIONS);
}

export function locationDocId(
  organizationId: string,
  provider: CourierProvider,
  level: "city" | "zone" | "area",
  parentId?: string,
): string {
  const parent = parentId && parentId.trim().length > 0 ? parentId.trim() : "root";
  return `${organizationId}_${provider}_${level}_${parent}`;
}

export async function getCourierAccount(
  organizationId: string,
  id: string,
): Promise<CourierAccount | null> {
  const snap = await courierAccountsRef().doc(id).get();
  if (!snap.exists) return null;
  const data = snap.data() as CourierAccount;
  if (data.organizationId !== organizationId) return null;
  return { ...data, id: snap.id };
}

export async function listCourierAccounts(organizationId: string): Promise<CourierAccount[]> {
  const snap = await courierAccountsRef()
    .where("organizationId", "==", organizationId)
    .orderBy("createdAt", "asc")
    .get();

  return snap.docs.map((d) => ({ ...(d.data() as CourierAccount), id: d.id }));
}

export async function getEnabledCourierAccounts(organizationId: string): Promise<CourierAccount[]> {
  const snap = await courierAccountsRef()
    .where("organizationId", "==", organizationId)
    .where("enabled", "==", true)
    .get();

  return snap.docs.map((d) => ({ ...(d.data() as CourierAccount), id: d.id }));
}

export async function getDefaultCourierAccount(
  organizationId: string,
): Promise<CourierAccount | null> {
  const snap = await courierAccountsRef()
    .where("organizationId", "==", organizationId)
    .where("isDefault", "==", true)
    .where("enabled", "==", true)
    .limit(1)
    .get();

  if (snap.empty) return null;
  const doc = snap.docs[0];
  if (!doc) return null;
  return { ...(doc.data() as CourierAccount), id: doc.id };
}

export async function createCourierAccount(
  data: Omit<CourierAccount, "id" | "createdAt" | "updatedAt">,
): Promise<CourierAccount> {
  const db = adminDb();
  const docRef = courierAccountsRef().doc();
  const now = Timestamp.now();

  const account: CourierAccount = {
    ...data,
    id: docRef.id,
    createdAt: now,
    updatedAt: now,
  };

  if (data.isDefault) {
    await db.runTransaction(async (tx) => {
      const existingDefaults = await tx.get(
        courierAccountsRef()
          .where("organizationId", "==", data.organizationId)
          .where("isDefault", "==", true),
      );
      for (const d of existingDefaults.docs) {
        tx.update(d.ref, { isDefault: false, updatedAt: now });
      }
      tx.set(docRef, account);
    });
  } else {
    await docRef.set(account);
  }

  return account;
}

export async function updateCourierAccount(
  organizationId: string,
  id: string,
  patch: Partial<Omit<CourierAccount, "id" | "organizationId" | "createdAt">>,
): Promise<CourierAccount> {
  const db = adminDb();
  const docRef = courierAccountsRef().doc(id);
  const now = Timestamp.now();

  let updatedAccount: CourierAccount | null = null;

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    if (!snap.exists) throw new NotFoundError("Courier account not found");
    const current = snap.data() as CourierAccount;
    if (current.organizationId !== organizationId) {
      throw new NotFoundError("Courier account not found");
    }

    if (patch.isDefault && !current.isDefault) {
      const existingDefaults = await tx.get(
        courierAccountsRef()
          .where("organizationId", "==", organizationId)
          .where("isDefault", "==", true),
      );
      for (const d of existingDefaults.docs) {
        if (d.id !== id) {
          tx.update(d.ref, { isDefault: false, updatedAt: now });
        }
      }
    }

    const nextData = {
      ...patch,
      updatedAt: now,
    };

    tx.update(docRef, nextData);
    updatedAccount = {
      ...current,
      ...nextData,
      id,
    };
  });

  if (!updatedAccount) throw new NotFoundError("Courier account not found");
  return updatedAccount;
}

export async function deleteCourierAccount(organizationId: string, id: string): Promise<void> {
  const docRef = courierAccountsRef().doc(id);
  const snap = await docRef.get();
  if (!snap.exists) return;
  const current = snap.data() as CourierAccount;
  if (current.organizationId !== organizationId) return;

  await docRef.delete();
}

/**
 * Reads cached locations if available and younger than 7 days.
 */
export async function getCachedLocations(
  organizationId: string,
  provider: CourierProvider,
  level: "city" | "zone" | "area",
  parentId?: string,
): Promise<CourierLocation[] | null> {
  const docId = locationDocId(organizationId, provider, level, parentId);
  const snap = await courierLocationsRef().doc(docId).get();
  if (!snap.exists) return null;

  const data = snap.data();
  if (!data || !Array.isArray(data.items) || !data.fetchedAt) return null;

  let fetchedMillis = 0;
  if (typeof data.fetchedAt.toMillis === "function") {
    fetchedMillis = data.fetchedAt.toMillis();
  } else if (typeof data.fetchedAt === "string") {
    fetchedMillis = new Date(data.fetchedAt).getTime();
  }

  if (Date.now() - fetchedMillis > SEVEN_DAYS_MS) {
    return null; // Expired
  }

  return data.items as CourierLocation[];
}

/**
 * Stores cached locations with a fetched timestamp.
 */
export async function setCachedLocations(
  organizationId: string,
  provider: CourierProvider,
  level: "city" | "zone" | "area",
  parentId: string | undefined,
  items: CourierLocation[],
): Promise<void> {
  const docId = locationDocId(organizationId, provider, level, parentId);
  await courierLocationsRef().doc(docId).set({
    organizationId,
    provider,
    level,
    parentId: parentId && parentId.trim().length > 0 ? parentId.trim() : "root",
    items,
    fetchedAt: Timestamp.now(),
  });
}
