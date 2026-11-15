# WhatsApp Cloud API (Meta) Setup Guide

SalesPilot uses **one Meta app for the whole platform**, with one shared webhook. Each workspace connects
its own WhatsApp business number on **Integrations > Platform**. Incoming messages are routed by the
number they were sent to, and every reply goes out from that workspace's number: AI replies, staff replies
from the inbox, and automation follow-ups.

There are two parts:

1. **Platform setup (once)**, done by whoever runs the deployment: the Meta app, its app secret, the
   verify token and the webhook.
2. **Connect a business number (per workspace)**, done by each workspace's owner or admin in the app.

---

## 1. Platform setup (once)

### 1.1 Meta app

1. At [Meta for Developers](https://developers.facebook.com/), click **Create App**, choose **Other** >
   **Business**, and add the **WhatsApp** product.
2. Copy the **App Secret** from **App settings** > **Basic**.

### 1.2 Environment variables

Add these to `.env.local` and to the Vercel project's environment variables, then redeploy. Never commit
or share them.

```env
WHATSAPP_APP_SECRET=your_meta_app_secret               # verifies Meta's webhook signatures
WHATSAPP_VERIFY_TOKEN=choose_a_secure_random_string    # e.g. openssl rand -hex 32
META_GRAPH_API_VERSION=v21.0
ENCRYPTION_KEY=...                                     # required to store workspace tokens encrypted
WHATSAPP_APP_ID=your_meta_app_id                       # optional: refuse tokens made in another Meta app
```

### 1.3 Webhook

Meta needs a public HTTPS URL, so `localhost` won't work.

- **Deployed:** `https://<your-domain>/api/webhooks/whatsapp`. The Integrations card shows this URL with
  a copy button.
- **Local testing:** run `npm run dev`, then start a tunnel, for example
  `npx cloudflared tunnel --url http://localhost:3000` or `ngrok http 3000`. Use the printed
  `https://...` address followed by `/api/webhooks/whatsapp`.

1. In the Meta app, go to **WhatsApp** > **Configuration** > **Webhook** and click **Edit**.
2. Set the **Callback URL** to the URL above and the **Verify Token** to exactly `WHATSAPP_VERIFY_TOKEN`,
   then click **Verify and Save**.
3. Under **Webhook fields**, click **Manage** and subscribe to **`messages`**. This one field carries
   incoming messages and the sent, delivered and read updates.

**Business accounts are subscribed automatically.** Meta sends a WhatsApp Business Account's webhooks
only to apps subscribed to that account. When a workspace connects a number, SalesPilot subscribes the
app to the number's account for you (`POST /<WABA_ID>/subscribed_apps` with the workspace's token). If
Meta refuses, the number is not connected and the card says so.

**Whose numbers can be added?** Numbers in WhatsApp Business Accounts inside your own Meta Business
Manager can be added to this app directly. To connect numbers that belong to other companies' Meta
accounts, the platform has to become a **Meta Tech Provider**, with embedded signup or shared business
assets. That onboarding is not built into SalesPilot yet.

---

## 2. Connect a business number (per workspace)

1. Create a token that does not expire. In Meta **Business Settings**, create a **System User**, assign it
   the app and the WhatsApp account, and generate a token with `whatsapp_business_messaging` and
   `whatsapp_business_management`. The API Setup page also has a temporary token, but it expires after
   about 24 hours.
2. In SalesPilot, open **Integrations** > **Platform & Webhooks** > **WhatsApp business number**, paste the
   token and click **Connect WhatsApp**. SalesPilot asks Meta which numbers the token covers. If there is
   one, it is connected straight away; if there are several, pick one from the list.
3. The card then shows the number and verified business name.

Before connecting, the server asks Meta to confirm that the token can see the number and that the number
belongs to the Business Account. A number that Meta does not confirm cannot be saved, so no workspace can
claim a number it doesn't control.

**Entering the IDs yourself.** If Meta does not report which numbers a token covers, or you prefer to type
them, click **Enter the IDs manually instead**. Copy the **Phone Number ID** and the **WhatsApp Business
Account ID** from the Meta app under **WhatsApp** > **API Setup**, enter them with the token, and click
**Save**.

Notes:

- The token is stored encrypted and is never shown again. To keep it, leave the field blank when you save.
- A number can be connected to only one workspace. If another workspace already connected it, saving says
  so.
- If you **disable** a number, nothing is sent from it. Messages that arrive while it is disabled are
  discarded, not held for later. **Disconnect** frees the number so another workspace can connect it.
- Replies always go out from the number the customer wrote to. If that number has since been changed or
  disconnected, staff replies in that conversation are refused with a clear message instead of being sent
  from a different number, which Meta would reject.
- With no number connected, staff replies are refused, not faked, and WhatsApp automation follow-ups are
  recorded as skipped. A skipped follow-up is not retried after you connect a number.
- When the AI escalates to a person, the conversation moves to **Needs reply** and the AI stops answering
  until a team member hands it back.
- While you use Meta's test number, add your own phone under **To** as an allowed recipient (up to 5).

### Make the AI answer

At `/agents`, make one agent **Active** with the **WhatsApp** channel ticked, and set `OPENAI_API_KEY`. New
conversations go to the first active WhatsApp agent. If there is none, they go to **Needs reply** for a
person. The AI continues one session per conversation, so it remembers earlier messages. An order drafted
in one message can be confirmed in a later one.

---

## Optional: a single number via environment

For a one-workspace deployment you can skip the Integrations card. Set the number in env instead:

```env
WHATSAPP_PHONE_NUMBER_ID=...
WHATSAPP_BUSINESS_ACCOUNT_ID=...
WHATSAPP_ACCESS_TOKEN=...
WHATSAPP_ORGANIZATION_ID=...   # the workspace (Firestore organization id) that owns this number
```

A number connected on the Integrations card always takes priority over this setup. Only the workspace
named in `WHATSAPP_ORGANIZATION_ID` can connect the env number on the card.

**Upgrading an env-only deployment:** set `WHATSAPP_ORGANIZATION_ID`. Without it, inbound messages are
dropped, automations skip, and staff replies are refused.

---

## Troubleshooting

- **Verify and Save fails in Meta:** the verify token doesn't match `WHATSAPP_VERIFY_TOKEN`, or the URL
  can't be reached.
- **The card says the webhook isn't configured:** set `WHATSAPP_APP_SECRET` and `WHATSAPP_VERIFY_TOKEN`
  and redeploy.
- **Test failed:** the Phone Number ID or the token is wrong, or the token has expired.
- **Messages never appear:** check the logs for `/api/webhooks/whatsapp`.
  - A `401` means `WHATSAPP_APP_SECRET` is wrong.
  - `whatsapp.webhook.unknown_number` means no workspace has connected that number.
  - `whatsapp.webhook.number_disabled` means the number's connection is disabled or missing.
  - `whatsapp.webhook.client_unavailable` means the stored token couldn't be decrypted. Messages are kept
    and go to **Needs reply**. Check that `ENCRYPTION_KEY` is the one the token was saved with.
- **No AI reply:** no active agent has the WhatsApp channel, or `OPENAI_API_KEY` is missing.

## Limitations

- Text messages only. Images, voice notes and other message types are ignored.
- One number per workspace.
- Not yet tested against a real Meta account. The first live test is the verification.
