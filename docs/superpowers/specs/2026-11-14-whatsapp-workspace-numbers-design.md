# WhatsApp numbers connected per workspace — design

Date: 2026-11-14 · Status: draft for approval · Branch: `fix/whatsapp-sessions`

## Intent

Let a workspace owner connect their business WhatsApp number from the Integrations page instead of
editing `.env` / Vercel. Each workspace can have its own number. Incoming messages reach only the
workspace that owns the number, and every message the platform sends for a workspace goes out from
that workspace's number.

## Approaches

1. **Webhook URL per workspace.** Each workspace uses its own Meta app, webhook URL and verify token.
   Isolates tenants by URL, but every business must run a Meta app.
2. **One shared webhook URL, routed by phone number (chosen by the user).** The platform runs ONE
   Meta app. Each business number is added to that app's WhatsApp setup. Meta posts every message to
   `/api/webhooks/whatsapp`, and the platform routes it by `metadata.phone_number_id`.
   Trade-off: for numbers in other companies' Meta business accounts, the platform must become a
   Meta Tech Provider (embedded signup / shared business assets). Numbers inside the platform
   owner's own Meta Business Manager work right away.

## Goals

- Integrations > Platform > WhatsApp: connect, edit, test, disable and disconnect the workspace's number.
- Route inbound messages by phone number to the owning workspace only.
- Send from the owning workspace's number on all three send paths: AI replies (webhook), staff
  replies (inbox), automation follow-ups.
- Keep the current env setup working for a single-number deployment.

## Non-goals

- Meta embedded signup / Tech Provider onboarding (owners paste ids and a token).
- More than one number per workspace.
- Media messages (still text only).

## Anti-goals

- A message delivered to, or sent from, the wrong workspace.
- The access token ever returned to the browser or logged.
- Fake success: a send path that pretends it sent when no number is connected.

## Constraints

- The Meta app's **app secret** and **verify token** are platform-level (one app): they stay in
  env (`WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`) and the webhook route verifies with them,
  unchanged. Workspaces never enter them.
- Credentials are encrypted with the existing secret box (`ENCRYPTION_KEY`). Without it, saving a
  connection is refused with a clear message.
- Managing it needs `integrations:manage` (owner, admin).

## Design

**Data**
- `whatsappConnections/{orgId}` (one per workspace): `organizationId`, `phoneNumberId`,
  `businessAccountId`, `displayPhoneNumber | null`, `verifiedName | null`, `credentials`
  (sealed `{ accessToken }`), `enabled`, `lastTestedAt`, `lastTestResult`, `createdAt`, `updatedAt`.
- `whatsappPhoneNumbers/{phoneNumberId}`: `{ organizationId }`. A lock that makes a number belong to
  at most one workspace and gives the webhook a one-read lookup. Written in the same transaction as
  the connection; changing the number moves the lock; disconnecting deletes both.
- Both collections are server-only (Firestore catch-all deny; rules test added).

**Routing (webhook).** `resolveOrgId(phoneNumberId)`:
1. The lock doc's organization, if that workspace's connection exists and is enabled.
2. Otherwise the env fallback (from the previous change): `WHATSAPP_PHONE_NUMBER_ID` +
   `WHATSAPP_ORGANIZATION_ID`, only if no lock claims that number.
3. Otherwise drop (logged without content). No other fallback.

**Sending.** One resolver `whatsappClientFor(orgId)`: the enabled connection's number and token,
else the env number when `WHATSAPP_ORGANIZATION_ID === orgId`, else null. Used by:
- the webhook (replies from the number the message arrived on);
- `sendHumanMessage` (inbox). With no number, keep today's behaviour: store the message with a
  simulated id. The UI already shows WhatsApp as not connected;
- the automations engine. With no number, the run is **skipped** ("WhatsApp is not connected for this
  workspace") instead of recording a fake message id. Today it sends every workspace's follow-ups
  from the one env number, which this fixes.

**API** (all `withApi`, `integrations:manage`, rate-limited)
- `GET /api/integrations/whatsapp` → summary: `connected`, `phoneNumberId`, `businessAccountId`,
  `displayPhoneNumber`, `verifiedName`, `enabled`, `hasAccessToken`, `lastTestedAt`,
  `lastTestResult`, `webhookUrl` (`/api/webhooks/whatsapp`), `platformWebhookReady` (env app secret
  and verify token set). Never the token.
- `PUT /api/integrations/whatsapp` `{ phoneNumberId, businessAccountId, accessToken?, enabled }`:
  creates or updates. The token is required on first save and kept when omitted later. A number owned by
  another workspace is a 409 "This WhatsApp number is connected to another workspace."
- `POST /api/integrations/whatsapp/test`: calls Graph
  `GET /{version}/{phoneNumberId}?fields=display_phone_number,verified_name` with the token and
  stores the result (`ok` plus the display number and name, or `failed`).
- `DELETE /api/integrations/whatsapp`: disconnect (removes connection + lock).

**UI.** On Integrations > Platform, the WhatsApp card becomes a form. It has fields for Phone Number
ID, Business Account ID and Access token (write-only: shows "saved", never the value), plus an
Enabled switch. Buttons: Save (then an automatic test), Test, Disconnect. The status line shows
the tested display number and verified name. A note explains that the webhook URL, verify token and
app secret belong to the platform's Meta app; a platform admin sets them once.

**Docs.** `docs/setup/whatsapp.md` splits into "Platform setup (once)" (Meta app, app secret, verify
token, webhook) and "Connect a business number (per workspace)", with the Tech Provider note.

## Testing

- Unit: input schema; summary has no token.
- Integration:
  - Connection service: seal and round-trip; another workspace's number is a 409; changing the
    number moves the lock; disconnect removes it; tenancy.
  - Resolver: the lock beats env; a disabled connection is ignored; the env fallback still works.
  - Routes: viewer and agent get 403; owner gets 200; cross-site requests are rejected.
  - Webhook with two workspaces and two numbers: each message lands in its own workspace and the
    reply goes out with that workspace's token (fake fetch).
  - Automation skips when no number is connected; the inbox send uses the workspace's client.

## Left to the builder

File layout inside `src/services/whatsapp/`; exact copy; the test-call timeout (10 s suggested).
