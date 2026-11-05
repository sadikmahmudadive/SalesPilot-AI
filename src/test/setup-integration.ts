// Safe defaults for integration tests. `firebase emulators:exec` normally sets the
// emulator hosts; these fallbacks keep the suite pointed at local emulators only.
process.env.FIREBASE_PROJECT_ID ||= "demo-salespilot";
process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8085";
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= "127.0.0.1:9199";
