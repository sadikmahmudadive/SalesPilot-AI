# Steadfast Courier Integration Guide

This guide walks you through configuring Steadfast Courier logistics integration in SalesPilot AI for nationwide parcel delivery, automated consignment booking, cash on delivery (COD) collection, and live parcel tracking across Bangladesh.

---

## 1. Prerequisites

1. An approved merchant account with [Steadfast Courier](https://steadfast.com.bd/).
2. Access to the Steadfast Merchant Portal at [https://steadfast.com.bd/login](https://steadfast.com.bd/login).
3. Retrieve your API credentials from **Settings -> API Credentials**:
   - **API Key**
   - **Secret Key**

---

## 2. Environment Configuration

Ensure that your environment includes a secure 32-byte hex or base64 encryption key used to seal courier credentials in Firestore:

```env
# 32-byte AES-256-GCM encryption key
ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
```

> **Security Note**: Never commit `ENCRYPTION_KEY` to source control. In production, configure this in your Vercel project environment variables.

---

## 3. Configuring Steadfast in SalesPilot AI

1. In the SalesPilot AI dashboard, navigate to **Integrations** (`/integrations`).
2. Select the **Couriers & Delivery** tab.
3. Click **Connect Courier Partner** and select **Steadfast Courier**.
4. Fill in:
   - **Display Label**: Friendly display name (e.g. `Steadfast Primary`).
   - **Environment**: Choose **Sandbox** for testing or **Live** for production.
   - **API Key**: Your Steadfast API Key.
   - **Secret Key**: Your Steadfast Secret Key.
   - **Webhook Verification Secret (Optional)**: Bearer secret configured in Steadfast webhook settings.
   - **Make Default**: Toggle ON if you want Steadfast pre-selected when booking order shipments.
5. Click **Connect Courier**. SalesPilot tests the connection and encrypts your credentials with AES-256-GCM before storing.

---

## 4. Setting up Real-Time Webhook Updates

To receive instant delivery status changes from Steadfast directly into SalesPilot AI:

1. Copy the **Inbound Webhook URL** displayed on your Steadfast courier card:
   `https://<your-domain>/api/webhooks/couriers/steadfast/<accountId>`
2. In the Steadfast Merchant Portal, navigate to **Developer Settings / Webhook Settings**.
3. Paste the Webhook URL into the callback endpoint field.
4. Set the authentication Bearer token to match the webhook secret you configured in SalesPilot AI.
5. Enable webhook events for parcel status updates (`picked_up`, `in_transit`, `delivered`, `returned`, etc.).

---

## 5. Automated Order Lifecycle Effects

When Steadfast emits status updates via webhook or manual refresh:

| Steadfast Status | SalesPilot Courier Status | Order Lifecycle Effect |
|---|---|---|
| `in_review` / `pending` | `booked` / `pending_pickup` | None (shipment recorded) |
| `picked` / `picked_up` | `picked_up` | Order transitions to `shipped`; stock committed |
| `in_transit` | `in_transit` | Order transitions to `shipped`; stock committed |
| `holding` / `out_for_delivery` | `out_for_delivery` | Order is out for delivery |
| `delivered` | `delivered` | Order transitions to `delivered`; COD marked collected |
| `partial_delivered` | `partial_delivered` | Order transitions to `delivered`; COD marked collected |
| `returned` | `returned` | Order transitions to `returned` |
