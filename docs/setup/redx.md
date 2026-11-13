# RedX Logistics Integration Guide

This guide walks you through configuring RedX logistics integration in SalesPilot AI for automated parcel creation, tracking, and delivery status synchronization across Bangladesh.

---

## 1. Prerequisites

1. An active merchant account with [RedX](https://redx.com.bd/).
2. Access to RedX Merchant Portal at [https://redx.com.bd/merchant](https://redx.com.bd/merchant).
3. Retrieve your API access token from **Settings -> API Credentials / Developer Token**:
   - **API Token (Bearer Key)**

---

## 2. Environment Configuration

Ensure `ENCRYPTION_KEY` is configured in your `.env.local` or host environment variables:

```env
# 32-byte AES-256-GCM encryption key
ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
```

---

## 3. Configuring RedX in SalesPilot AI

1. In the SalesPilot AI dashboard, navigate to **Integrations** (`/integrations`).
2. Select the **Couriers & Delivery** tab.
3. Click **Connect Courier Partner** and select **RedX Logistics**.
4. Fill in:
   - **Display Label**: e.g. `RedX Express`.
   - **Environment**: Choose **Sandbox** or **Live**.
   - **RedX API Token**: Your RedX bearer token.
   - **Webhook Verification Secret (Optional)**: Secret key for verifying inbound webhooks.
5. Click **Connect Courier**. SalesPilot validates connectivity via RedX `/v1.0.0-beta/areas` endpoint and seals your token before persisting to Firestore.

---

## 4. Inbound Webhook Configuration

1. Copy the Inbound Webhook URL from your RedX integration card:
   `https://<your-domain>/api/webhooks/couriers/redx/<accountId>`
2. Configure this endpoint in your RedX merchant developer settings.
3. Inbound status updates (e.g. `pickup_pending`, `picked_up`, `received_at_hub`, `delivery_in_progress`, `delivered`, `returned_to_hub`) are verified, deduplicated via `webhookEvents`, and automatically synchronized with the corresponding orders.
