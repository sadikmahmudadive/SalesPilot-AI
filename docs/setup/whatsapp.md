# WhatsApp Cloud API (Meta) Setup Guide

This guide walks you through connecting your SalesPilot AI workspace to Meta's official WhatsApp Cloud API for autonomous AI customer interactions and unified team messaging.

---

## 1. Prerequisites

1. A [Meta for Developers](https://developers.facebook.com/) account.
2. A Meta Business Account (verified for production limits).
3. A clean phone number dedicated to WhatsApp Business (cannot be currently registered to a personal WhatsApp app).

---

## 2. Meta App Configuration

1. In the **Meta App Dashboard**, click **Create App** and select **Other** > **Business**.
2. Under "Add products to your app", locate **WhatsApp** and click **Set up**.
3. Under **WhatsApp** > **API Setup** you get a test phone number, its **Phone Number ID**, the
   **WhatsApp Business Account ID** and a temporary access token (valid about 24 hours).
4. While you use the test number, add your own phone under **To** as an allowed recipient (up to 5).
   Meta refuses messages to any other number until you register a real business number.
5. For a token that does not expire, create a **System User** in Meta Business Settings, assign it
   the app and the WhatsApp account, and generate a token with `whatsapp_business_messaging` and
   `whatsapp_business_management`.
6. Copy the **App Secret** from **App settings** > **Basic** (used to verify webhook signatures).

---

## 3. Environment Variables

Add the following to your `.env.local` (and your Vercel project's environment variables, then
redeploy). Never commit or share these values.

```env
# ---------------------------------------------------------------- WhatsApp Cloud API (Meta)
WHATSAPP_PHONE_NUMBER_ID=your_meta_phone_number_id
WHATSAPP_BUSINESS_ACCOUNT_ID=your_whatsapp_business_account_id
WHATSAPP_ACCESS_TOKEN=your_permanent_system_user_access_token
WHATSAPP_VERIFY_TOKEN=choose_a_secure_random_string   # e.g. openssl rand -hex 32
WHATSAPP_APP_SECRET=your_meta_app_secret
WHATSAPP_ORGANIZATION_ID=the_workspace_that_receives_messages
META_GRAPH_API_VERSION=v21.0
```

**`WHATSAPP_ORGANIZATION_ID`** is the workspace that owns this number. Find it on
**Integrations** > **Platform** > **WhatsApp Cloud API** ("Copy ID"); the card says "Messages are
delivered to this workspace" once it is set to your workspace. Messages sent to any other phone
number, or while this variable is unset or points to a missing workspace, are dropped. There is no
fallback to another workspace.

---

## 4. Webhook Setup

Meta needs a public HTTPS URL; it cannot reach `localhost`.

- **Deployed:** `https://<your-domain>/api/webhooks/whatsapp`.
- **Local testing:** run `npm run dev`, then open a tunnel in another terminal, for example
  `npx cloudflared tunnel --url http://localhost:3000` or `ngrok http 3000`, and use the printed
  `https://...` address plus `/api/webhooks/whatsapp`.

1. In the Meta App Dashboard, navigate to **WhatsApp** > **Configuration** > **Webhook**.
2. Click **Edit**:
   - **Callback URL**: the URL above.
   - **Verify Token**: exactly the value of `WHATSAPP_VERIFY_TOKEN`.
   - Click **Verify and Save**. Meta sends a `GET` challenge, which the app answers.
3. Under **Webhook fields**, click **Manage** and subscribe to **`messages`**. This one field
   carries inbound customer messages and the sent / delivered / read status updates.

---

## 5. Testing with AI Agents

1. At `/agents`, make one agent **Active** with the **WhatsApp** channel enabled, and set
   `OPENAI_API_KEY`. A new conversation is assigned to the first active WhatsApp agent; with none,
   it goes to **Needs reply** for a person.
2. Send a text message to your WhatsApp Business number from an allowed phone.
3. The conversation appears in `/inbox`, and the AI replies on WhatsApp.
4. The AI continues one agent session per conversation, so it remembers earlier messages. It
   starts a new session when the conversation is reassigned to another agent, after an escalation,
   or when the agent's turn limit is reached.
5. Orders: an order drafted in one message can be confirmed in a later message of the same
   conversation.

### Troubleshooting

- **Verify and Save fails:** the verify token does not match, or the URL is not reachable.
- **Messages never appear:** check the logs for `/api/webhooks/whatsapp`. A `401` means
  `WHATSAPP_APP_SECRET` is wrong. A `whatsapp.webhook.unknown_number` or
  `whatsapp.webhook.no_organization` warning means `WHATSAPP_PHONE_NUMBER_ID` or
  `WHATSAPP_ORGANIZATION_ID` is not set correctly.
- **No AI reply:** no active agent has the WhatsApp channel, or `OPENAI_API_KEY` is missing; the
  conversation then shows as **Needs reply**.

### Limitations

- Text messages only; images, voice notes and other types are ignored.
- One WhatsApp number per deployment (the credentials are environment variables).
- Not yet exercised against a real Meta account; treat the first live test as the verification.
