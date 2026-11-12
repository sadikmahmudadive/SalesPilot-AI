import { Timestamp } from "firebase-admin/firestore";

import { NotFoundError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import type { GatewayAccount } from "@/schemas/integration";

const COLLECTION = "gatewayAccounts";

export function gatewayAccountsRef() {
  return adminDb().collection(COLLECTION);
}

export async function getGatewayAccount(
  organizationId: string,
  id: string,
): Promise<GatewayAccount | null> {
  const snap = await gatewayAccountsRef().doc(id).get();
  if (!snap.exists) return null;
  const data = snap.data() as GatewayAccount;
  if (data.organizationId !== organizationId) return null;
  return { ...data, id: snap.id };
}

export async function listGatewayAccounts(organizationId: string): Promise<GatewayAccount[]> {
  const snap = await gatewayAccountsRef()
    .where("organizationId", "==", organizationId)
    .orderBy("createdAt", "asc")
    .get();

  return snap.docs.map((d) => ({ ...(d.data() as GatewayAccount), id: d.id }));
}

export async function getDefaultGatewayAccount(
  organizationId: string,
): Promise<GatewayAccount | null> {
  const snap = await gatewayAccountsRef()
    .where("organizationId", "==", organizationId)
    .where("isDefault", "==", true)
    .where("enabled", "==", true)
    .limit(1)
    .get();

  if (snap.empty) return null;
  const doc = snap.docs[0];
  if (!doc) return null;
  return { ...(doc.data() as GatewayAccount), id: doc.id };
}

export async function createGatewayAccount(
  data: Omit<GatewayAccount, "id" | "createdAt" | "updatedAt">,
): Promise<GatewayAccount> {
  const db = adminDb();
  const docRef = gatewayAccountsRef().doc();
  const now = Timestamp.now();

  const account: GatewayAccount = {
    ...data,
    id: docRef.id,
    createdAt: now,
    updatedAt: now,
  };

  if (data.isDefault) {
    await db.runTransaction(async (tx) => {
      const existingDefaults = await tx.get(
        gatewayAccountsRef()
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

export async function updateGatewayAccount(
  organizationId: string,
  id: string,
  patch: Partial<Omit<GatewayAccount, "id" | "organizationId" | "createdAt">>,
): Promise<GatewayAccount> {
  const db = adminDb();
  const docRef = gatewayAccountsRef().doc(id);
  const now = Timestamp.now();

  let updatedAccount: GatewayAccount | null = null;

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    if (!snap.exists) throw new NotFoundError("Gateway account not found");
    const current = snap.data() as GatewayAccount;
    if (current.organizationId !== organizationId) {
      throw new NotFoundError("Gateway account not found");
    }

    if (patch.isDefault && !current.isDefault) {
      const existingDefaults = await tx.get(
        gatewayAccountsRef()
          .where("organizationId", "==", organizationId)
          .where("isDefault", "==", true),
      );
      for (const d of existingDefaults.docs) {
        if (d.id !== id) {
          tx.update(d.ref, { isDefault: false, updatedAt: now });
        }
      }
    }

    const next = {
      ...current,
      ...patch,
      updatedAt: now,
    };
    tx.set(docRef, next);
    updatedAccount = { ...next, id: snap.id };
  });

  return updatedAccount!;
}

export async function deleteGatewayAccount(organizationId: string, id: string): Promise<void> {
  const docRef = gatewayAccountsRef().doc(id);
  const snap = await docRef.get();
  if (!snap.exists) return;
  const current = snap.data() as GatewayAccount;
  if (current.organizationId !== organizationId) return;

  await docRef.delete();
}
