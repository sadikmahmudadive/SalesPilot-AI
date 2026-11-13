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
3. Under **WhatsApp** > **API Setup**:
   - You will see a temporary test access token and a test Phone Number ID.
   - For production, create a **System User** in Meta Business Manager with permissions to manage WhatsApp business assets and generate a **Permanent Access Token**.

---

## 3. Environment Variables

Add the following to your `.env.local` (and your Vercel deployment project settings):

```env
# ---------------------------------------------------------------- WhatsApp Cloud API (Meta)
WHATSAPP_PHONE_NUMBER_ID=your_meta_phone_number_id
WHATSAPP_BUSINESS_ACCOUNT_ID=your_whatsapp_business_account_id
WHATSAPP_ACCESS_TOKEN=your_permanent_system_user_access_token
WHATSAPP_VERIFY_TOKEN=choose_a_secure_random_string
WHATSAPP_APP_SECRET=your_meta_app_secret
META_GRAPH_API_VERSION=v21.0
```

---

## 4. Webhook Setup

1. In the Meta App Dashboard, navigate to **WhatsApp** > **Configuration** > **Webhook**.
2. Click **Edit**:
   - **Callback URL**: `https://<your-domain>/api/webhooks/whatsapp` (e.g. `https://sales-pilot-ai-five.vercel.app/api/webhooks/whatsapp`)
   - **Verify Token**: Must match `WHATSAPP_VERIFY_TOKEN` in your environment.
   - Click **Verify and Save**. Meta will issue a `GET` challenge to your endpoint.
3. Under **Webhook fields**, click **Manage** and subscribe to:
   - `messages` (for inbound customer messages)
   - `message_deliveries` / `message_reads` (for delivery and read receipts)

---

## 5. Testing with AI Agents

1. Go to your dashboard at `/agents`.
2. Configure or enable an AI Sales Agent and ensure **WhatsApp** is enabled under its channel settings.
3. Send a message to your WhatsApp Business number from a real phone.
4. The AI agent will respond grounded in your real catalog and CRM data!
5. Open `/inbox` on your dashboard: you will see the conversation in real-time, with options to take over control or monitor tool executions.
