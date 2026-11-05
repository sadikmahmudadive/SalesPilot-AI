/**
 * Firebase Admin SDK access. Server-only. Lazy singletons so importing this module
 * never initialises anything (or reads credentials) until first use.
 *
 * Re-evaluating this module (HMR, separate server bundles) must be harmless. The
 * firebase-admin app and Firestore instance outlive a module re-evaluation, and
 * Firestore#settings() throws if called twice, so "already configured" is tracked in a
 * process-wide WeakSet (on globalThis) keyed by the Firestore instance, not in module
 * state. (firebase-admin's initializeFirestore() cannot be used: it only forwards
 * `preferRest`, silently dropping `ignoreUndefinedProperties`.)
 */
import "server-only";
import { cert, getApp, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

import { getServerEnv, isEmulator } from "@/config/env";

const DEFAULT_APP_NAME = "[DEFAULT]";

function adminApp(): App {
  if (getApps().some((app) => app.name === DEFAULT_APP_NAME)) return getApp();
  // getServerEnv() validates first: it rejects a partial or production emulator setup,
  // so the isEmulator() gate below can be trusted.
  const env = getServerEnv();
  if (isEmulator()) {
    // The emulators accept any identity; a project id is enough and no key is needed.
    return initializeApp({ projectId: env.FIREBASE_PROJECT_ID });
  }
  // Explicit service-account credentials only. Never fall back to application-default
  // credentials: a missing key must fail loudly rather than pick up ambient identity.
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

const CONFIGURED_KEY = Symbol.for("salespilot.admin.configuredFirestore");

function configuredFirestores(): WeakSet<Firestore> {
  const store = globalThis as unknown as Record<symbol, WeakSet<Firestore> | undefined>;
  return (store[CONFIGURED_KEY] ??= new WeakSet<Firestore>());
}

export function adminDb(): Firestore {
  const db = getFirestore(adminApp());
  const configured = configuredFirestores();
  if (configured.has(db)) return db;
  try {
    db.settings({ ignoreUndefinedProperties: true });
  } catch (error) {
    // Only tolerate the "settings() called twice" case; anything else is a real fault.
    if (!(error instanceof Error) || !/already been initialized/i.test(error.message)) throw error;
  }
  configured.add(db);
  return db;
}
