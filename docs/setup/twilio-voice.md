# Twilio Voice Setup

SalesPilot AI supports [Twilio Voice](https://www.twilio.com/voice) via REST call initiation and TwiML webhooks.

## 1. Prerequisites

- A Twilio account with **Account SID** and **Auth Token**.
- A Twilio voice-capable phone number in E.164 format (e.g., `+15551234567`).

## 2. Connect Twilio in SalesPilot AI

1. Open **Integrations -> Voice & Telephony** in SalesPilot AI.
2. Click **Connect Voice Provider** and select **Twilio Voice (TwiML)**.
3. Enter:
   - **Display Label**: e.g., `Twilio Support Line`
   - **Twilio Account SID**: `AC...`
   - **Twilio Auth Token**: your Twilio auth token
   - **From Phone Number**: your Twilio E.164 phone number
   - **Webhook Secret** *(optional, recommended)*: shared secret for `x-voice-secret` header verification.
4. Click **Connect Provider**, then **Test Connection** to verify the Account SID and Auth Token against Twilio's REST API.
5. Copy the **Inbound / Server Webhook URL**:
   `https://<your-domain>/api/webhooks/voice/twilio/<accountId>`

## 3. Configure Twilio Phone Number Webhooks

1. In Twilio Console -> **Phone Numbers -> Manage -> Active numbers**, select your number.
2. Under **Voice Configuration**:
   - **A call comes in**: Webhook -> `https://<your-domain>/api/webhooks/voice/twilio/<accountId>` (`HTTP POST`)
   - **Call status changes**: `https://<your-domain>/api/webhooks/voice/twilio/<accountId>` (`HTTP POST`)
3. Save the configuration. Outbound calls initiated from SalesPilot AI automatically pass this webhook URL for both TwiML instructions and status callbacks.
