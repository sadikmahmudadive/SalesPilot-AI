import { Timestamp, type Query } from "firebase-admin/firestore";

import { NotFoundError } from "@/lib/errors";
import { adminDb } from "@/lib/firebase/admin";
import type {
  CallDirection,
  CallStatus,
  VoiceAccount,
  VoiceCall,
} from "@/schemas/voice";

export const VOICE_ACCOUNTS = "voiceAccounts";
export const VOICE_CALLS = "voiceCalls";

export function voiceAccountsRef() {
  return adminDb().collection(VOICE_ACCOUNTS);
}

export function voiceCallsRef() {
  return adminDb().collection(VOICE_CALLS);
}

export async function getVoiceAccount(
  organizationId: string,
  id: string,
): Promise<VoiceAccount | null> {
  const snap = await voiceAccountsRef().doc(id).get();
  if (!snap.exists) return null;
  const data = snap.data() as VoiceAccount;
  if (data.organizationId !== organizationId) return null;
  return { ...data, id: snap.id };
}

export async function getVoiceAccountByIdUnsafe(id: string): Promise<VoiceAccount | null> {
  const snap = await voiceAccountsRef().doc(id).get();
  if (!snap.exists) return null;
  const data = snap.data() as VoiceAccount;
  return { ...data, id: snap.id };
}

export async function listVoiceAccounts(organizationId: string): Promise<VoiceAccount[]> {
  const snap = await voiceAccountsRef()
    .where("organizationId", "==", organizationId)
    .orderBy("createdAt", "asc")
    .get();

  return snap.docs.map((d) => ({ ...(d.data() as VoiceAccount), id: d.id }));
}

export async function getDefaultVoiceAccount(
  organizationId: string,
): Promise<VoiceAccount | null> {
  const defaultSnap = await voiceAccountsRef()
    .where("organizationId", "==", organizationId)
    .where("isDefault", "==", true)
    .where("enabled", "==", true)
    .limit(1)
    .get();

  if (!defaultSnap.empty) {
    const doc = defaultSnap.docs[0];
    if (doc) return { ...(doc.data() as VoiceAccount), id: doc.id };
  }

  const enabledSnap = await voiceAccountsRef()
    .where("organizationId", "==", organizationId)
    .where("enabled", "==", true)
    .limit(1)
    .get();

  if (enabledSnap.empty) return null;
  const doc = enabledSnap.docs[0];
  return doc ? { ...(doc.data() as VoiceAccount), id: doc.id } : null;
}

export async function createVoiceAccount(
  data: Omit<VoiceAccount, "id" | "createdAt" | "updatedAt">,
): Promise<VoiceAccount> {
  const db = adminDb();
  const docRef = voiceAccountsRef().doc();
  const now = Timestamp.now();

  const account: VoiceAccount = {
    ...data,
    id: docRef.id,
    createdAt: now,
    updatedAt: now,
  };

  if (data.isDefault) {
    await db.runTransaction(async (tx) => {
      const existingDefaults = await tx.get(
        voiceAccountsRef()
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

export async function updateVoiceAccount(
  organizationId: string,
  id: string,
  updates: Partial<Omit<VoiceAccount, "id" | "organizationId" | "createdAt">>,
): Promise<VoiceAccount> {
  const db = adminDb();
  const docRef = voiceAccountsRef().doc(id);
  const now = Timestamp.now();

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    if (!snap.exists || (snap.data() as VoiceAccount).organizationId !== organizationId) {
      throw new NotFoundError("Voice account not found");
    }

    if (updates.isDefault) {
      const existingDefaults = await tx.get(
        voiceAccountsRef()
          .where("organizationId", "==", organizationId)
          .where("isDefault", "==", true),
      );
      for (const d of existingDefaults.docs) {
        if (d.id !== id) {
          tx.update(d.ref, { isDefault: false, updatedAt: now });
        }
      }
    }

    tx.update(docRef, { ...updates, updatedAt: now });
  });

  const updated = await getVoiceAccount(organizationId, id);
  if (!updated) throw new NotFoundError("Voice account not found");
  return updated;
}

export async function deleteVoiceAccount(organizationId: string, id: string): Promise<void> {
  const existing = await getVoiceAccount(organizationId, id);
  if (!existing) throw new NotFoundError("Voice account not found");
  await voiceAccountsRef().doc(id).delete();
}

export async function getVoiceCall(
  organizationId: string,
  id: string,
): Promise<VoiceCall | null> {
  const snap = await voiceCallsRef().doc(id).get();
  if (!snap.exists) return null;
  const data = snap.data() as VoiceCall;
  if (data.organizationId !== organizationId) return null;
  return { ...data, id: snap.id };
}

export async function getVoiceCallByProviderId(
  organizationId: string,
  providerCallId: string,
): Promise<VoiceCall | null> {
  if (!providerCallId) return null;
  const snap = await voiceCallsRef()
    .where("organizationId", "==", organizationId)
    .where("providerCallId", "==", providerCallId)
    .limit(1)
    .get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return doc ? { ...(doc.data() as VoiceCall), id: doc.id } : null;
}

export interface ListVoiceCallsOptions {
  direction?: CallDirection;
  status?: CallStatus;
  customerId?: string;
  orderId?: string;
  limit?: number;
}

export async function listVoiceCalls(
  organizationId: string,
  opts: ListVoiceCallsOptions = {},
): Promise<VoiceCall[]> {
  let q: Query = voiceCallsRef().where("organizationId", "==", organizationId);
  if (opts.direction) q = q.where("direction", "==", opts.direction);
  if (opts.status) q = q.where("status", "==", opts.status);
  if (opts.customerId) q = q.where("customerId", "==", opts.customerId);
  if (opts.orderId) q = q.where("orderId", "==", opts.orderId);
  q = q.orderBy("createdAt", "desc").limit(Math.min(opts.limit ?? 50, 100));

  const snap = await q.get();
  return snap.docs.map((d) => ({ ...(d.data() as VoiceCall), id: d.id }));
}

export async function createVoiceCall(
  data: Omit<VoiceCall, "id" | "createdAt" | "updatedAt">,
): Promise<VoiceCall> {
  const docRef = voiceCallsRef().doc();
  const nowIso = new Date().toISOString();
  const call: VoiceCall = {
    ...data,
    id: docRef.id,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  await docRef.set(call);
  return call;
}

export async function updateVoiceCall(
  organizationId: string,
  id: string,
  updates: Partial<Omit<VoiceCall, "id" | "organizationId" | "createdAt">>,
): Promise<VoiceCall> {
  const docRef = voiceCallsRef().doc(id);
  const snap = await docRef.get();
  if (!snap.exists || (snap.data() as VoiceCall).organizationId !== organizationId) {
    throw new NotFoundError("Voice call not found");
  }
  const nowIso = new Date().toISOString();
  await docRef.update({ ...updates, updatedAt: nowIso });
  const updated = await getVoiceCall(organizationId, id);
  if (!updated) throw new NotFoundError("Voice call not found");
  return updated;
}
