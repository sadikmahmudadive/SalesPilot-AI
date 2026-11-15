# SSLCommerz Integration Guide

This guide walks you through configuring SSLCommerz payment gateway integration in SalesPilot AI for accepting payments via bKash, Nagad, cards, and internet banking in Bangladesh.

---

## 1. Prerequisites

1. An approved merchant account with [SSLCommerz](https://sslcommerz.com/).
2. For testing/sandbox: Register for a sandbox account at [SSLCommerz Developer Portal](https://developer.sslcommerz.com/).
3. Note your credentials:
   - **Store ID**
   - **Store Password**

---

## 2. Environment Configuration

Ensure that your environment includes a secure 32-byte hex encryption key used to seal gateway credentials in Firestore:

```env
# 32-byte AES-256-GCM encryption key (64 hex characters)
ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
```

> **Security Note**: Never commit `ENCRYPTION_KEY` to source control. In production, configure this in your Vercel project environment variables.

---

## 3. Configuring SSLCommerz in SalesPilot AI

1. In the SalesPilot AI dashboard, navigate to **Integrations** (`/integrations`).
2. Click **Connect Gateway** and select **SSLCommerz**.
3. Fill in:
   - **Label**: Friendly display name (e.g. `SSLCommerz Production` or `SSLCommerz Sandbox`).
   - **Environment**: Choose **Sandbox** for testing or **Live** for production.
   - **Store ID**: Your SSLCommerz Store ID.
   - **Store Password**: Your SSLCommerz Store Password.
   - **Set as Default**: Toggle ON if you want this gateway selected by default for customer payment links.
4. Click **Connect Gateway**. SalesPilot will test the credentials and encrypt them with AES-256-GCM before saving.

---

## 4. How Payments Work

1. **Payment Link Generation**: When an online order is confirmed (either manually by staff or automatically by an AI Agent via `send_payment_link`), SalesPilot generates a secure payment token and link (`/pay/[token]`).
2. **Customer Checkout**: Customer opens the link, chooses the payment gateway, and is redirected to SSLCommerz's hosted payment page.
3. **Instant IPN & Redirect**:
   - On completion, SSLCommerz sends an IPN/callback to `/api/payments/sslcommerz/callback`.
   - SalesPilot verifies the transaction with SSLCommerz via server-to-server validation API.
   - Once verified, the order status transitions to `paid` and payment is logged transactionally.
4. **Reconciliation**: A background sweeper checks pending attempts and queries SSLCommerz to reconcile any interrupted sessions.
