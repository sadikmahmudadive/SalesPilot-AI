# Pathao Courier Integration Guide

This guide walks you through configuring Pathao Courier logistics integration in SalesPilot AI for nationwide parcel delivery, OAuth2 authentication, cascading location hierarchy (City -> Zone -> Area), and live webhook synchronization.

---

## 1. Prerequisites

1. An approved merchant account with [Pathao Courier](https://merchant.pathao.com/).
2. Access to Pathao Developer Portal / API credentials:
   - **Client ID**
   - **Client Secret**
   - **Username / Email** (registered merchant email)
   - **Password** (merchant account password)
3. Note your Pathao store ID if managing multiple pickup stores.

---

## 2. Environment Configuration

Ensure that your environment includes a secure 32-byte encryption key:

```env
# 32-byte AES-256-GCM encryption key
ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
```

---

## 3. Configuring Pathao in SalesPilot AI

1. In the SalesPilot AI dashboard, navigate to **Integrations** (`/integrations`).
2. Select the **Couriers & Delivery** tab.
3. Click **Connect Courier Partner** and select **Pathao Courier**.
4. Fill in:
   - **Display Label**: e.g. `Pathao Courier`.
   - **Environment**: Choose **Sandbox** or **Live**.
   - **Client ID**: Your Pathao OAuth Client ID.
   - **Client Secret**: Your Pathao OAuth Client Secret.
   - **Username**: Registered email.
   - **Password**: Account password.
   - **Webhook Verification Secret (Optional)**: Shared secret for webhook signature verification.
5. Click **Connect Courier**. SalesPilot performs an OAuth2 grant test, caches tokens in encrypted storage with single-flight mutex protection, and saves the integration.

---

## 4. Configuring Pathao Webhook & Handshake

Pathao requires a verification handshake challenge (`hub.challenge`) when configuring webhooks:

1. Copy the **Inbound Webhook URL** displayed on the Pathao card in SalesPilot:
   `https://<your-domain>/api/webhooks/couriers/pathao/<accountId>`
2. In the Pathao Merchant Portal, go to **Settings -> Webhook Integration**.
3. Paste the URL. When Pathao sends the handshake `GET` or `POST` request with a challenge parameter, SalesPilot automatically verifies and echoes the challenge response.
4. Save the webhook settings in Pathao.

---

## 5. Booking Workflow with Location Hierarchy

Pathao requires precise city and zone matching:
- When staff clicks **Book Courier** on any confirmed/processing order, SalesPilot dynamically queries the cached Pathao location hierarchy (cached for 7 days in Firestore).
- Staff selects the City/Division -> Thana/Zone -> Area.
- SalesPilot submits the order with pre-filled COD amount and weight.
- A consignment ID, tracking code, and live tracking link (`https://merchant.pathao.com/tracking?consignment_id=...`) are attached immediately.
