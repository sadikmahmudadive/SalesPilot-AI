/**
 * Non-visual client auth flow: talks to the session / me / register routes and maps
 * Firebase auth errors to safe messages. Every function takes `fetch` as a parameter so it
 * is unit-testable, and none of them throws: failures come back as typed results.
 *
 * Messages returned here are fixed strings. Raw server or Firebase error text is never
 * echoed to the user.
 */

import { safeNextPath } from "@/lib/auth/redirect";

export type FetchFn = typeof fetch;

export const GENERIC_ERROR = "Something went wrong. Please try again.";
const NETWORK_ERROR = "Network problem. Check your connection and try again.";
const RATE_LIMITED = "Too many attempts. Please wait a minute and try again.";
export const SESSION_EXPIRED = "Your session has expired. Please sign in again.";
const SESSION_ERROR = "We could not start your session. Please try again.";

export interface MeResponse {
  uid: string;
  email: string | null;
  organizationId: string;
  role: string;
}

export type SessionResult =
  | { status: "ok" }
  | { status: "unauthenticated" | "rate_limited" | "network" | "error"; message: string };

export type MeResult =
  | { status: "ok"; me: MeResponse }
  | {
      status: "unauthenticated" | "no_organization" | "rate_limited" | "network" | "error";
      message: string;
    };

export type RegisterOrgResult =
  | { status: "created"; organizationId: string }
  | { status: "exists"; organizationId: string }
  | {
      status: "unauthenticated" | "rate_limited" | "invalid" | "network" | "error";
      message: string;
    };

export type PostSignInResult =
  { to: "app" } | { to: "onboarding" } | { to: "error"; message: string };

type Raw = { ok: true; status: number; body: unknown } | { ok: false; kind: "network" };

async function request(fetchFn: FetchFn, url: string, init: RequestInit): Promise<Raw> {
  try {
    const response = await fetchFn(url, { ...init, credentials: "same-origin" });
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return { ok: true, status: response.status, body };
  } catch {
    return { ok: false, kind: "network" };
  }
}

function jsonPost(fetchFn: FetchFn, url: string, payload: unknown): Promise<Raw> {
  return request(fetchFn, url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

const failure = (status: "network", message: string = NETWORK_ERROR) =>
  ({ status, message }) as const;

/** Exchanges a fresh Firebase ID token for the httpOnly session cookie. */
export async function exchangeSession(idToken: string, fetchFn: FetchFn): Promise<SessionResult> {
  const raw = await jsonPost(fetchFn, "/api/auth/session", { idToken });
  if (!raw.ok) return failure("network");
  if (raw.status >= 200 && raw.status < 300) return { status: "ok" };
  if (raw.status === 401) return { status: "unauthenticated", message: SESSION_ERROR };
  if (raw.status === 429) return { status: "rate_limited", message: RATE_LIMITED };
  return { status: "error", message: SESSION_ERROR };
}

function isMe(value: unknown): value is MeResponse {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.uid === "string" && typeof v.organizationId === "string" && typeof v.role === "string"
  );
}

/**
 * Clears the session cookie (and revokes refresh tokens) server-side. Never throws; resolves to
 * whether the server confirmed (2xx). Callers that only care about best effort can ignore it.
 */
export async function endSession(fetchFn: FetchFn): Promise<boolean> {
  const raw = await request(fetchFn, "/api/auth/session", { method: "DELETE" });
  return raw.ok && raw.status >= 200 && raw.status < 300;
}

export interface SignOutDeps {
  fetch: FetchFn;
  /** Firebase client `signOut(getFirebaseAuth())`, injected so this stays unit-testable. */
  firebaseSignOut(): Promise<void>;
}

export type SignOutResult =
  | { ok: true }
  /** `serverCleared` is false when the DELETE failed, i.e. the session cookie may still be present. */
  | { ok: false; serverCleared: boolean; message: string };

const SIGN_OUT_ERROR =
  "We could not fully sign you out. Please close this browser window if you are on a shared device.";

/**
 * Full sign-out: server session first (cookie cleared, refresh tokens revoked), then the Firebase
 * client session. A failure of one never skips the other; the caller navigates to /login either
 * way and may show the message as a toast. Never throws.
 */
export async function signOutEverywhere(deps: SignOutDeps): Promise<SignOutResult> {
  const serverCleared = await endSession(deps.fetch);
  let firebaseCleared = true;
  try {
    await deps.firebaseSignOut();
  } catch {
    firebaseCleared = false;
  }
  return serverCleared && firebaseCleared
    ? { ok: true }
    : { ok: false, serverCleared, message: SIGN_OUT_ERROR };
}

/** Reads the signed-in member. 403 means signed in but no organization yet. */
export async function fetchMe(fetchFn: FetchFn): Promise<MeResult> {
  const raw = await request(fetchFn, "/api/me", {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  if (!raw.ok) return failure("network");
  if (raw.status === 200) {
    return isMe(raw.body)
      ? { status: "ok", me: raw.body }
      : { status: "error", message: GENERIC_ERROR };
  }
  if (raw.status === 401) return { status: "unauthenticated", message: SESSION_EXPIRED };
  if (raw.status === 403)
    return { status: "no_organization", message: "No organization found for this account." };
  if (raw.status === 429) return { status: "rate_limited", message: RATE_LIMITED };
  return { status: "error", message: GENERIC_ERROR };
}

/** Creates the organization for the signed-in user (requires the session cookie). */
export async function registerOrganizationRequest(
  body: { organizationName: string; displayName: string },
  fetchFn: FetchFn,
): Promise<RegisterOrgResult> {
  const raw = await jsonPost(fetchFn, "/api/organizations/register", body);
  if (!raw.ok) return failure("network");
  if (raw.status === 200 || raw.status === 201) {
    const id = (raw.body as { organizationId?: unknown } | null)?.organizationId;
    if (typeof id === "string") {
      return raw.status === 201
        ? { status: "created", organizationId: id }
        : { status: "exists", organizationId: id };
    }
    return { status: "error", message: GENERIC_ERROR };
  }
  if (raw.status === 401) return { status: "unauthenticated", message: SESSION_EXPIRED };
  if (raw.status === 429) return { status: "rate_limited", message: RATE_LIMITED };
  if (raw.status === 400)
    return { status: "invalid", message: "Please check the details you entered and try again." };
  return { status: "error", message: "We could not create your organization. Please try again." };
}

/**
 * After Firebase sign-in: set the session cookie, then decide where the user belongs.
 * Members go to the app, users without an organization go to onboarding.
 */
export async function resolvePostSignIn(
  idToken: string,
  fetchFn: FetchFn,
): Promise<PostSignInResult> {
  const session = await exchangeSession(idToken, fetchFn);
  if (session.status !== "ok") return { to: "error", message: session.message };
  const me = await fetchMe(fetchFn);
  if (me.status === "ok") return { to: "app" };
  if (me.status === "no_organization") return { to: "onboarding" };
  return { to: "error", message: me.message };
}

/**
 * Wrong password, unknown user, invalid credential and a disabled account all share one
 * message so the UI never reveals whether an account exists. `user-disabled` is mapped here
 * deliberately: a distinct "this account is disabled" message would confirm the account exists.
 */
const CREDENTIAL_ERRORS = new Set([
  "wrong-password",
  "user-not-found",
  "invalid-credential",
  "invalid-login-credentials",
  "user-disabled",
]);
/** The user simply closed or superseded the Google popup: show nothing. */
const SILENT_ERRORS = new Set(["popup-closed-by-user", "cancelled-popup-request"]);

function normaliseCode(code: string): string {
  return code.startsWith("auth/") ? code.slice(5) : code;
}

/**
 * Maps a Firebase auth error code to a friendly fixed message, or null when nothing should be
 * shown (popup closed). Unknown codes get the generic message; raw text is never echoed.
 */
export function mapAuthError(code: string): string | null {
  const c = normaliseCode(code);
  if (SILENT_ERRORS.has(c)) return null;
  if (CREDENTIAL_ERRORS.has(c)) return "Incorrect email or password.";
  switch (c) {
    case "email-already-in-use":
      return "An account with this email already exists. Try signing in instead.";
    case "account-exists-with-different-credential":
      return "This email is already linked to a different sign-in method. Use the method you originally signed up with.";
    case "weak-password":
      return "Choose a stronger password with at least 10 characters.";
    case "too-many-requests":
      return "Too many attempts. Please wait a few minutes and try again.";
    case "network-request-failed":
      return NETWORK_ERROR;
    case "popup-blocked":
      return "Your browser blocked the sign-in popup. Allow popups and try again.";
    default:
      return GENERIC_ERROR;
  }
}

/** Reads `.code` off an unknown thrown value (Firebase errors carry a string `code`). */
export function authErrorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return "";
}

export interface RegisterAccountDeps<U> {
  createUser(email: string, password: string): Promise<U>;
  updateProfile(user: U, displayName: string): Promise<void>;
  getIdToken(user: U): Promise<string>;
  fetch: FetchFn;
}

export interface RegisterAccountInput {
  displayName: string;
  organizationName: string;
  email: string;
  password: string;
  /** Raw `next` query value; validated with safeNextPath before it is returned. */
  next?: string | null;
}

export type RegisterAccountResult =
  /** Fully registered; navigate to `path` (already validated). */
  | { outcome: "success"; path: string }
  /** Account and session exist but the organization was not created: send to onboarding to retry. */
  | { outcome: "onboarding"; message: string }
  /** The account exists but no session was started. Offer sign-in; never invite re-registering. */
  | { outcome: "session-failed"; message: string }
  /** The Firebase user was not created. `message` is null when nothing should be shown. */
  | { outcome: "auth-failed"; message: string | null };

const ACCOUNT_CREATED_SIGN_IN_FAILED = "Your account was created, but we could not sign you in.";
const ONBOARDING_MESSAGE =
  "Your account was created, but we could not set up your organization. Please finish setup to continue.";

/**
 * Email registration: create the Firebase user, set the display name (best effort), start the
 * session, then create the organization. Never throws; the caller only does UI and navigation.
 */
export async function registerAccount<U>(
  deps: RegisterAccountDeps<U>,
  input: RegisterAccountInput,
): Promise<RegisterAccountResult> {
  let user: U;
  try {
    user = await deps.createUser(input.email, input.password);
  } catch (error) {
    return { outcome: "auth-failed", message: mapAuthError(authErrorCode(error)) };
  }

  try {
    await deps.updateProfile(user, input.displayName);
  } catch {
    // Cosmetic only; the display name is also sent with the organization registration.
  }

  let idToken: string;
  try {
    idToken = await deps.getIdToken(user);
  } catch {
    return {
      outcome: "session-failed",
      message: `${ACCOUNT_CREATED_SIGN_IN_FAILED} ${SESSION_ERROR}`,
    };
  }

  const session = await exchangeSession(idToken, deps.fetch);
  if (session.status !== "ok") {
    return {
      outcome: "session-failed",
      message: `${ACCOUNT_CREATED_SIGN_IN_FAILED} ${session.message}`,
    };
  }

  const org = await registerOrganizationRequest(
    { organizationName: input.organizationName, displayName: input.displayName },
    deps.fetch,
  );
  if (org.status === "created" || org.status === "exists") {
    return { outcome: "success", path: safeNextPath(input.next) };
  }
  return { outcome: "onboarding", message: ONBOARDING_MESSAGE };
}

export interface SignOutNavigation {
  /** `replace`: client-side `router.replace(url)`. `assign`: hard `window.location.assign(url)`. */
  kind: "replace" | "assign";
  url: string;
  toast?: string;
}

const DEVICE_ONLY_NOTICE = "Signed out on this device. Session revocation couldn't be confirmed.";

/**
 * Where to go after `signOutEverywhere`. When the server DELETE succeeded the cookie is gone, so a
 * client-side replace to /login works. When it failed the cookie may survive and the proxy would bounce
 * /login back to /dashboard, so hard-navigate to /api/auth/expired, which clears the cookie and
 * redirects to /login (it does not revoke tokens, hence the notice).
 */
export function signOutNavigation(result: SignOutResult): SignOutNavigation {
  if (result.ok) return { kind: "replace", url: "/login" };
  if (result.serverCleared) return { kind: "replace", url: "/login", toast: result.message };
  return { kind: "assign", url: "/api/auth/expired", toast: DEVICE_ONLY_NOTICE };
}
