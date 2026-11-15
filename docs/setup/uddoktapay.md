# UddoktaPay Integration Guide

This guide walks you through configuring UddoktaPay payment gateway integration in SalesPilot AI for accepting payments via automated bKash, Nagad, Rocket, and other Bangladeshi payment methods.

---

## 1. Prerequisites

1. An approved account with [UddoktaPay](https://uddoktapay.com/).
2. For testing/sandbox: Register for a test account at [UddoktaPay Sandbox](https://sandbox.uddoktapay.com/).
3. Note your credentials:
   - **API Key**
   - **API Base URL** (e.g. `https://sandbox.uddoktapay.com/api/checkout-v2` or `https://your-domain.uddoktapay.com/api/checkout-v2`)

---

## 2. Environment Configuration

Ensure that your environment includes a secure 32-byte hex encryption key used to seal gateway credentials in Firestore:

```env
# 32-byte AES-256-GCM encryption key (64 hex characters)
ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
```

---

## 3. Configuring UddoktaPay in SalesPilot AI

1. In the SalesPilot AI dashboard, navigate to **Integrations** (`/integrations`).
2. Click **Connect Gateway** and select **UddoktaPay**.
3. Fill in:
   - **Label**: Friendly display name (e.g. `UddoktaPay Live`).
   - **Environment**: Choose **Sandbox** or **Live**.
   - **API Key**: Your UddoktaPay API key.
   - **API Base URL**: Your UddoktaPay API base URL.
   - **Set as Default**: Toggle ON if you want this gateway selected by default for customer payment links.
4. Click **Connect Gateway**. SalesPilot will test the credentials and encrypt them with AES-256-GCM before saving.

---

## 4. How Payments Work

1. **Payment Link Generation**: When an online order is confirmed (either manually by staff or automatically by an AI Agent via `send_payment_link`), SalesPilot generates a secure payment token and link (`/pay/[token]`).
2. **Customer Checkout**: Customer opens the link, chooses UddoktaPay, and is redirected to the hosted checkout page.
3. **Instant IPN & Redirect**:
   - On completion, UddoktaPay sends a webhook/IPN to `/api/payments/uddoktapay/ipn`.
   - SalesPilot verifies the transaction with UddoktaPay via server-to-server verification API.
   - Once verified, the order status transitions to `paid` and payment is logged transactionally.
4. **Reconciliation**: A background sweeper checks pending attempts and queries UddoktaPay to reconcile any interrupted sessions.
