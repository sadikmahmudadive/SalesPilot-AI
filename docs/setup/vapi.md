# Vapi Voice AI Setup

SalesPilot AI uses [Vapi](https://vapi.ai) as the primary Voice AI provider for outbound and inbound customer calls with live tool execution.

## 1. Prerequisites

- A Vapi account with an API key (Private Key).
- At least one imported or purchased phone number in Vapi (Phone Number ID).

## 2. Connect Vapi in SalesPilot AI

1. Open **Integrations -> Voice & Telephony** in SalesPilot AI.
2. Click **Connect Voice Provider** and select **Vapi Voice AI**.
3. Enter:
   - **Display Label**: e.g., `Vapi Sales Line`
   - **Vapi Private API Key**: your Vapi private key (`sk_...`)
   - **Vapi Phone Number ID**: UUID of your Vapi phone number
   - **Assistant ID** *(optional)*: leave blank to use your SalesPilot AI Agent's dynamic system prompt and tools inline, or enter a fixed Vapi Assistant UUID.
   - **Webhook Secret** *(optional, recommended)*: a random shared secret string.
4. Click **Connect Provider**, then click **Test Connection** to verify credentials against `https://api.vapi.ai/phone-number`.
5. Copy the **Inbound / Server Webhook URL** shown on the card:
   `https://<your-domain>/api/webhooks/voice/vapi/<accountId>`

## 3. Configure Webhooks in Vapi

1. In Vapi Dashboard, set your Phone Number (or Assistant) **Server URL** to the copied Webhook URL.
2. If you set a **Webhook Secret** in SalesPilot AI, configure the custom header `x-vapi-secret: <your-secret>` in Vapi's Server URL settings.
3. Enable server events for `tool-calls`, `status-update`, and `end-of-call-report`.

## 4. Enable an AI Agent for Voice

1. Open **AI Agents** and edit (or create) an agent.
2. Under **Channels**, check **Voice Calls**.
3. Ensure the desired tools (e.g., `lookup_customer`, `create_draft_order`, `confirm_order`, `escalate_to_human`) are enabled on the agent.
