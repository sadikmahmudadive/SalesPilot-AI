# Firebase setup

Local development needs none of this: `npm run emu` and `npm run dev` use the emulators with the demo project `demo-salespilot`. Follow this guide only when you want a real Firebase project (a shared staging site, or production on Vercel).

Nothing in this guide has been run against a real project yet. Treat the first run as a test and tick the smoke checklist at the end.

## 1. Choose the project (open decision)

The project is not decided. Two options:

- **Reuse `salespilot-ai-9b1cd`** (Firestore region `asia-southeast1`). It already exists, so you skip creation. Use it only if you are happy for it to hold production data and its settings are as you expect. Check its region in the console before relying on it; the Firestore location cannot be changed later.
- **Create a new project.** Choose a clean project id, enable Firestore in Native mode, and pick the location closest to your users (for example `asia-southeast1`; the location is permanent). Use this if `salespilot-ai-9b1cd` was a throwaway or has unwanted history.

Either way, keep one project per environment you care about (for example staging and production). Do not share a project between a public production site and experiments.

Install and sign in to the CLI (it is already a dev dependency):

```bash
npx firebase login
npx firebase projects:list
```

Replace `<project-id>` below with the chosen project id.

## 2. Enable Firestore and Authentication

In the Firebase console:

1. Build > Firestore Database > Create database > Native mode, pick the location.
2. Build > Authentication > Get started > Sign-in method. Enable:
   - Email/Password
   - Google
3. Project settings > General > Your apps > Add app > Web. Copy the config values for the `NEXT_PUBLIC_FIREBASE_*` variables:

   | Variable                                   | Config field        |
   | ------------------------------------------ | ------------------- |
   | `NEXT_PUBLIC_FIREBASE_API_KEY`             | `apiKey`            |
   | `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`         | `authDomain`        |
   | `NEXT_PUBLIC_FIREBASE_PROJECT_ID`          | `projectId`         |
   | `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`      | `storageBucket`     |
   | `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | `messagingSenderId` |
   | `NEXT_PUBLIC_FIREBASE_APP_ID`              | `appId`             |

   These are public identifiers, not secrets, but still put them in `.env.local` or the Vercel settings rather than committing real values.

4. Authentication > Settings > Authorized domains: add your Vercel domains (the production domain and, if you want sign-in on previews, the `*.vercel.app` preview hostnames you use). `localhost` is there by default.

### Keep `authDomain` on `*.firebaseapp.com`

The Content Security Policy in `src/config/security-headers.ts` sets `frame-src` to `https://*.firebaseapp.com` and `https://accounts.google.com`. The Firebase sign-in popup and redirect helper load from `authDomain`, so it must stay on `<project-id>.firebaseapp.com`. If you move `authDomain` to a custom domain, sign-in will be blocked by the CSP until you add that domain to `frame-src` (and `connect-src` if needed) in `src/config/security-headers.ts`, update its test, and redeploy.

## 3. Service account for the server

The server uses the Admin SDK with a service account.

1. Project settings > Service accounts > Generate new private key. A JSON file downloads.
2. Map it to environment variables:

   | Variable                | JSON field     |
   | ----------------------- | -------------- |
   | `FIREBASE_PROJECT_ID`   | `project_id`   |
   | `FIREBASE_CLIENT_EMAIL` | `client_email` |
   | `FIREBASE_PRIVATE_KEY`  | `private_key`  |

3. `private_key` contains real line breaks. Store it as a single line with the line breaks written as the two characters `\n`, inside double quotes:

   ```text
   FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n....\n-----END PRIVATE KEY-----\n"
   ```

   The app converts `\n` back to line breaks (`src/config/env.ts`). In the Vercel dashboard, paste the value with the `\n` sequences and, if the field keeps quotes literally, leave them out; see [vercel.md](vercel.md).

4. Put these in `.env.local` for a local run against the real project, or in Vercel. Never commit the JSON file or the values; `*.pem` and `.env*` are git-ignored, but a `.json` key file is not, so keep it outside the repo and delete it after copying.
5. To try the real project from your machine, use a production build, which does not load `.env.development` (that file turns the emulators on): put every `NEXT_PUBLIC_FIREBASE_*` and `FIREBASE_*` value in `.env.local`, keep `NEXT_PUBLIC_USE_EMULATORS=false`, do not set the emulator host variables, then run `npm run build` and `npm run start`. `NEXT_PUBLIC_*` values are inlined at build time, so rebuild after changing them. Do not run `npm run dev` against real credentials: it loads `.env.development` and the emulator hosts would apply.

## 4. Deploy Firestore rules and indexes

`firebase.json` points at `firestore.rules` and `firestore.indexes.json`. Deploy both:

```bash
npx firebase deploy --only firestore:rules,firestore:indexes --project <project-id>
```

- The rules deny every client write and allow members to read only their own organization's documents.
- `firestore.indexes.json` holds the composite indexes for the customer (31), product (19), category (1) and inventory (3) list queries. Building indexes on an empty database is quick, but on a database with data it can take minutes. Until an index is `READY` (Firebase console > Firestore > Indexes), the matching list query fails with a "requires an index" error.
- Indexes were derived from emulator runs and unit tests that compare the queries to the index file. They have never been deployed, so the smoke checklist below is how you confirm them. If a list shows an index error, the error message contains a console link that creates the missing index; add the same definition to `firestore.indexes.json` so the repo stays the source of truth.

## 5. Rate-limit TTL policy

The rate limiter stores one counter document per key and time window in `rateLimits`, each with an `expiresAt` timestamp. Firestore does not delete them on its own; enable a TTL policy so old windows are removed:

```bash
gcloud firestore fields ttls update expiresAt --collection-group=rateLimits --enable-ttl --project=<project-id>
```

Double-check this command against the current gcloud documentation before running it (the command group and flag names have changed between gcloud releases; `gcloud firestore fields ttls update --help` shows what your installed version accepts). You can also set it in the console: Firestore > Time-to-live > Create policy, collection group `rateLimits`, field `expiresAt`. TTL deletion is asynchronous (typically within a day or so after expiry), which is fine: expired counters are never read again.

## 6. Post-deploy smoke checklist

Run this against the deployed app (or a local `next start` pointed at the real project). Use a throwaway account.

1. Register a new account with email and password; confirm you reach the dashboard, then sign out and sign back in. Repeat with Google sign-in.
2. Open Firebase console > Firestore and confirm `users`, `organizations` and `organizationMembers` documents exist for the account.
3. Customers: create a customer whose full name is in Bangla, and another whose name starts with an emoji. Search by the Bangla prefix and by the emoji-prefixed name; both must find the customer.
4. Customers list: switch through every sort option (created, name, last interaction) in ascending and descending order, and apply each filter the toolbar offers (segment, customer type, tag). Each combination must load without an error. This is what proves the customer indexes.
5. Products: create a product with a variant. Open the product list, try each sort and each filter the toolbar offers. Each must load.
6. Inventory: adjust stock for a variant with a reason (this should show in `auditLogs`), then use the low-stock filter and the other inventory filters and sorts. Each must load.
7. Dashboard overview: confirm the customer, product and low-stock counts match what you created.
8. In Firestore > Indexes, confirm every index shows `READY`.
9. Confirm `rateLimits` documents are appearing, then check the TTL policy is `Serving` (console: Firestore > Time-to-live).
10. Image upload checks belong to [cloudinary.md](cloudinary.md).
