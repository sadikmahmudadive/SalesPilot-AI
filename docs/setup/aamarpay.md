# aamarPay Integration Guide

This guide walks you through configuring aamarPay payment gateway integration in SalesPilot AI for accepting payments via mobile financial services (bKash, Rocket, Nagad, Upay) and debit/credit cards in Bangladesh.

---

## 1. Prerequisites

1. An approved merchant account with [aamarPay](https://aamarpay.com/).
2. For testing/sandbox: Request sandbox test credentials from aamarPay support.
3. Note your credentials:
   - **Store ID** (e.g. `aamarpaytest` for sandbox)
   - **Signature Key** (API Key / Secret)

---

## 2. Environment Configuration

Ensure that your environment includes a secure 32-byte hex encryption key used to seal gateway credentials in Firestore:

```env
# 32-byte AES-256-GCM encryption key (64 hex characters)
ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
```

---

## 3. Configuring aamarPay in SalesPilot AI

1. In the SalesPilot AI dashboard, navigate to **Integrations** (`/integrations`).
2. Click **Connect Gateway** and select **aamarPay**.
3. Fill in:
   - **Label**: Friendly display name (e.g. `aamarPay Production`).
   - **Environment**: Choose **Sandbox** or **Live**.
   - **Store ID**: Your aamarPay Store ID.
   - **Signature Key**: Your aamarPay Signature Key.
   - **Set as Default**: Toggle ON if you want this gateway selected by default for customer payment links.
4. Click **Connect Gateway**. SalesPilot will test the credentials and encrypt them with AES-256-GCM before saving.

---

## 4. How Payments Work

1. **Payment Link Generation**: When an online order is confirmed (either manually by staff or automatically by an AI Agent via `send_payment_link`), SalesPilot generates a secure payment token and link (`/pay/[token]`).
2. **Customer Checkout**: Customer opens the link, chooses aamarPay, and is redirected to the hosted checkout page.
3. **Instant IPN & Redirect**:
   - On completion, aamarPay sends a callback to `/api/payments/aamarpay/callback`.
   - SalesPilot verifies the transaction with aamarPay via server-to-server validation API.
   - Once verified, the order status transitions to `paid` and payment is logged transactionally.
4. **Reconciliation**: A background sweeper checks pending attempts and queries aamarPay to reconcile any interrupted sessions.
