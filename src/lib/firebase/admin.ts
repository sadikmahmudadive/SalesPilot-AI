/**
 * Firebase Admin SDK access. Server-only. Lazy singletons so importing this module
 * never initialises anything (or reads credentials) until first use.
 */
import "server-only";
import { cert, getApp, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

import { getServerEnv, isEmulator } from "@/config/env";

let firestoreConfigured = false;

function adminApp(): App {
  if (getApps().length > 0) return getApp();
  const env = getServerEnv();
  if (isEmulator()) {
    // The emulators accept any identity; a project id is enough and no key is needed.
    return initializeApp({ projectId: env.FIREBASE_PROJECT_ID });
  }
  return initializeApp({
    credential: cert({
      projectId: env.FIREBASE_PROJECT_ID,
      clientEmail: env.FIREBASE_CLIENT_EMAIL,
      privateKey: env.FIREBASE_PRIVATE_KEY,
    }),
    projectId: env.FIREBASE_PROJECT_ID,
  });
}

export function adminAuth(): Auth {
  return getAuth(adminApp());
}

export function adminDb(): Firestore {
  const db = getFirestore(adminApp());
  if (!firestoreConfigured) {
    // settings() may be called only once, before the first Firestore operation.
    db.settings({ ignoreUndefinedProperties: true });
    firestoreConfigured = true;
  }
  return db;
}
