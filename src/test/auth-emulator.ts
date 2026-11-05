import { randomUUID } from "node:crypto";

import { adminAuth } from "@/lib/firebase/admin";

const authHost = (): string => process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9199";
const signInUrl = (): string =>
  `http://${authHost()}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`;

export interface EmulatorUser {
  uid: string;
  email: string;
  idToken: string;
}

/** Creates a fresh Auth emulator user and signs in through the emulator REST API. */
export async function createEmulatorUser(): Promise<EmulatorUser> {
  const email = `t-${randomUUID()}@example.com`;
  const password = `pw-${randomUUID()}`;
  const user = await adminAuth().createUser({ email, password });
  const res = await fetch(signInUrl(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  if (!res.ok) throw new Error(`Emulator sign-in failed: ${res.status}`);
  const body = (await res.json()) as { idToken: string };
  return { uid: user.uid, email, idToken: body.idToken };
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
