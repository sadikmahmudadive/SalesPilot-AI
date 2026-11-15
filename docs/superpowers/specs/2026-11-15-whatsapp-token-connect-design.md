# WhatsApp token-only connect

## Why

Connecting a WhatsApp business number asked for three values copied from Meta's dashboard (Phone Number
ID, Business Account ID, access token) plus a manual `subscribed_apps` call. The owner wants connecting
to be as close to one tap as possible.

## Approaches

1. **Embedded Signup (Meta popup).** True one tap, no token. Needs the platform's Meta app approved as a
   Tech Provider (business verification + App Review). The business is not verified, so the popup would
   only work for the app's own admins and testers. Not built now.
2. **Token-only connect (chosen).** The user pastes the access token; the platform asks Meta which numbers
   it covers and connects the only one, or offers a list. Works today with no Meta approval.
3. Leave the three-field form. Rejected: it is the thing being simplified.

Embedded Signup can be added later on top of this: it needs the same number lookup and subscription.

## Design

- `POST /api/integrations/whatsapp/numbers { accessToken }` (owner/admin, 10/min) returns
  `{ numbers: [{ phoneNumberId, businessAccountId, displayPhoneNumber, verifiedName }] }`. It calls
  Meta's `debug_token` to read the business accounts in `granular_scopes[].target_ids`, then each
  account's `phone_numbers`. Nothing is stored; the token is never returned or logged.
- With `WHATSAPP_APP_ID` (optional, new) and `WHATSAPP_APP_SECRET` set, the token is inspected as the
  platform app and a token from a different Meta app is refused, since its messages would never reach
  this platform's webhook.
- Saving a connection (unchanged route) now also subscribes the app to the business account
  (`POST /{waba}/subscribed_apps`) whenever it verifies with Meta. If Meta refuses, the save fails.
- The card shows one token field and a **Connect WhatsApp** button while not connected. One number
  connects immediately; several show a pick list; none (Meta reports no accounts) points to the manual
  form, which stays available behind "Enter the IDs manually instead" and is what a connected workspace
  sees for changes.

## Not verified

The Meta calls are exercised against a fake Graph API only. `debug_token` returning `target_ids` for a
system-user token has not been checked against live Meta.
