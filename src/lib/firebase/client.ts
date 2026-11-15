/**
 * Firebase client (browser) SDK access. Client-safe: reads only public config via
 * getClientEnv(). No `server-only` import and no server variables.
 */
import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, type Auth } from "firebase/auth";

import { getClientEnv } from "@/config/env.client";

let authEmulatorConnected = false;

function firebaseApp(): FirebaseApp {
  if (getApps().length > 0) return getApp();
  const env = getClientEnv();
  return initializeApp({
    apiKey: env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: env.NEXT_PUBLIC_FIREBASE_APP_ID,
  });
}

export function getFirebaseAuth(): Auth {
  const auth = getAuth(firebaseApp());
  const env = getClientEnv();
  if (env.NEXT_PUBLIC_USE_EMULATORS && !authEmulatorConnected) {
    connectAuthEmulator(auth, env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_URL, {
      disableWarnings: true,
    });
    authEmulatorConnected = true;
  }
  return auth;
}
