# Vercel deployment

Prerequisite: a real Firebase project ([firebase.md](firebase.md), sections 1 to 4 done) and, if you want image uploads, Cloudinary credentials ([cloudinary.md](cloudinary.md)). Without a real Firebase project do not deploy: production refuses to start with emulator settings, and the emulators are not reachable from Vercel.

This deployment has not been performed yet.

## 1. Import the repository

1. Vercel dashboard > Add New > Project > Import the GitHub repository.
2. Framework Preset: Next.js (detected automatically).
3. Root Directory: the repository root (single npm package, no monorepo).
4. Node.js Version: 22.x or 24.x (22.12 or newer) (Project Settings > General). `package.json` requires `>=22.12`: firebase-admin 14 needs Node 22, and `jwks-rsa` 4 needs the native `require(esm)` that arrived in 22.12. Node 20 fails with `ERR_REQUIRE_ESM` (see the README, "Dependency overrides").
5. Install command: `npm install` (the default when `package-lock.json` is present). Use npm only.

## 2. Build settings

| Setting          | Value                                  |
| ---------------- | -------------------------------------- |
| Build command    | `npm run build` (default `next build`) |
| Output directory | default (leave empty for Next.js)      |
| Install command  | `npm install`                          |

`NEXT_PUBLIC_*` values are inlined into the browser bundle at build time. Set them before the first build and redeploy after changing any of them.

Optional extra check: run `npm run check:bundle` after a local `npm run build` (with your real server variables exported in the shell) to confirm no server-only name or value reached `.next/static`. It does not need to run on Vercel.

## 3. Environment variables

Add these in Project Settings > Environment Variables, choosing the environments (Production, Preview, Development) deliberately. This mirrors `.env.example`. "Public" means it is shipped to the browser; "secret" means server-only and must never use a `NEXT_PUBLIC_` prefix.

| Name                                                                                                                                                          | Required                     | Public / secret | Where to get it                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | --------------- | ------------------------------------------------------------------------------ |
| `NEXT_PUBLIC_APP_URL`                                                                                                                                         | required                     | public          | The deployed base URL, no trailing slash (for example your production domain)  |
| `NEXT_PUBLIC_FIREBASE_API_KEY`                                                                                                                                | required                     | public          | Firebase console > Project settings > Your apps > web app config               |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`                                                                                                                            | required                     | public          | Same; keep it `<project-id>.firebaseapp.com` (see CSP note)                    |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID`                                                                                                                             | required                     | public          | Same                                                                           |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`                                                                                                                         | required                     | public          | Same                                                                           |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`                                                                                                                    | required                     | public          | Same                                                                           |
| `NEXT_PUBLIC_FIREBASE_APP_ID`                                                                                                                                 | required                     | public          | Same                                                                           |
| `NEXT_PUBLIC_USE_EMULATORS`                                                                                                                                   | optional                     | public          | Leave unset or `false`                                                         |
| `FIREBASE_PROJECT_ID`                                                                                                                                         | required                     | secret          | Service account JSON `project_id`                                              |
| `FIREBASE_CLIENT_EMAIL`                                                                                                                                       | required (outside emulators) | secret          | Service account JSON `client_email`                                            |
| `FIREBASE_PRIVATE_KEY`                                                                                                                                        | required (outside emulators) | secret          | Service account JSON `private_key`, see below                                  |
| `SESSION_COOKIE_MAX_DAYS`                                                                                                                                     | optional                     | secret          | Integer 1 to 14, default 5                                                     |
| `CLOUDINARY_CLOUD_NAME`                                                                                                                                       | optional (uploads)           | secret          | Cloudinary console                                                             |
| `CLOUDINARY_API_KEY`                                                                                                                                          | optional (uploads)           | secret          | Cloudinary console                                                             |
| `CLOUDINARY_API_SECRET`                                                                                                                                       | optional (uploads)           | secret          | Cloudinary console                                                             |
| `ENCRYPTION_KEY`                                                                                                                                              | optional now                 | secret          | Reserved for storing integration credentials; generate 32 random bytes, base64 |
| `CRON_SECRET`                                                                                                                                                 | optional now                 | secret          | Reserved for cron endpoints; generate a long random string                     |
| `OPENAI_API_KEY`, `OPENAI_CHAT_MODEL`, `OPENAI_REALTIME_MODEL`                                                                                                | optional                     | secret          | Not used yet (sub-project 3)                                                   |
| `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `META_GRAPH_API_VERSION` | optional                     | secret          | Not used yet (sub-project 4)                                                   |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, `TWILIO_WEBHOOK_SECRET`                                                                     | optional                     | secret          | Not used yet (sub-project 6)                                                   |
| `SSLCOMMERZ_STORE_ID`, `SSLCOMMERZ_STORE_PASSWORD`, `SSLCOMMERZ_IS_LIVE`                                                                                      | optional                     | secret          | Not used yet (sub-project 5)                                                   |
| `N8N_WEBHOOK_URL`, `N8N_WEBHOOK_SECRET`                                                                                                                       | optional                     | secret          | Not used yet (sub-project 7)                                                   |

Mark every secret variable as Sensitive in Vercel where the option is offered. Do not set variables for features that are not built; they have no effect.

### Never set the emulator variables in Production

Do not set `FIRESTORE_EMULATOR_HOST` or `FIREBASE_AUTH_EMULATOR_HOST` in any Vercel environment. In production, the app refuses to start if either is present. Note that `.env.development` (committed, with emulator hosts) is only loaded by `next dev`, not by `next build` or `next start`, so it does not leak into a Vercel build.

### `FIREBASE_PRIVATE_KEY` and newlines

The private key is multi-line. Paste it as one line with the line breaks written as the literal two characters `\n`:

```text
-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n
```

The app replaces each `\n` sequence with a real line break when it reads the variable. If Vercel stores the value with real line breaks instead, that also works; what breaks is losing the line breaks altogether. If the Admin SDK reports an invalid PEM or credential error on the first request, this is the first thing to check. Do not wrap the value in quotes in the Vercel field unless you see that the quotes are not being stripped, and never paste the key into chat or an issue.

## 4. Preview versus production

- **Production** builds the production branch (usually `main`) and serves the production domain.
- **Preview** builds every other branch and pull request on a `*.vercel.app` URL.
- Previews use the same variables you assign to the Preview environment. Point them at a staging Firebase project, not at production data. If you do not want a staging project yet, leave the Firebase service account out of Preview. The app should then fail at runtime on previews instead of touching production data; this is expected but has not been verified.
- Sign-in on a preview URL requires that hostname in Firebase Authentication > Settings > Authorized domains. Add it, or accept that sign-in works only on the production domain.
- `NEXT_PUBLIC_APP_URL` differs per environment; set it separately for Preview and Production.

## 5. CSP note when adding domains

Security headers (CSP, HSTS, frame, referrer) are built in `src/config/security-headers.ts` and applied in `next.config.ts`. They allow only the origins the app needs today. If you add a custom domain for Firebase `authDomain`, load images from another host, or embed another service, update that file and its test (`src/config/security-headers.test.ts`) rather than loosening the policy elsewhere. Keep `authDomain` on `*.firebaseapp.com` unless you do that.

## 6. After the first deploy

1. Redeploy once after all variables are in place, so `NEXT_PUBLIC_*` values are inlined.
2. Deploy Firestore rules and indexes to the Firebase project ([firebase.md](firebase.md), section 4) and wait for indexes to reach `READY`.
3. Enable the TTL policy for `rateLimits` (section 5 of the Firebase guide).
4. Work through the smoke checklist in the Firebase guide, then the Cloudinary one if you configured it.
