# Follow-ups & n8n Automations Setup

SalesPilot AI includes built-in scheduled/event follow-up rules and two-way webhook integration for **n8n**, Make, or Zapier.

## 1. Built-in Triggers & Opt-Out Safety

Scheduled rules are evaluated automatically by the cron sweep (`/api/cron/orders/expire`) or on demand via **Automations -> Run Sweep Now**:

- **Stale Draft Order** (`draft_order_stale`): matches draft orders older than `delayMinutes`.
- **Order Confirmed / Order Delivered** (`order_confirmed`, `order_delivered`): matches orders in that lifecycle state.
- **Inactive Customer** (`customer_inactive`): matches customers whose `lastInteractionAt` is older than `inactiveDays`.
- **Low Stock Alert** (`inventory_low_stock`): matches inventory records where `available <= lowStockThreshold`.

Every target is deduplicated per rule (`automationRuns.dedupeKey`), and any customer with `consent.status === "denied"` is automatically skipped for `send_whatsapp` and `place_voice_call` actions.

## 2. Outbound Webhooks to n8n

1. In n8n, add a **Webhook** trigger node (`POST`) and copy its Production URL.
2. In SalesPilot AI **Automations -> New Automation Rule**, select your trigger and set **Then (Action)** to **Send Signed Webhook (n8n)**.
3. Paste your n8n Webhook URL and enter a **Webhook Secret**.
4. When triggered, SalesPilot AI sends an HTTP `POST` JSON payload with header:
   `x-salespilot-signature: sha256=<hmac-sha256-hex>`
5. In n8n, verify the signature against the raw JSON body using HMAC-SHA256 with the same secret.

## 3. Inbound Triggers from n8n

1. In SalesPilot AI **Automations -> New Automation Rule**, select **When (Trigger)** -> **Inbound Webhook (n8n)** and pick any SalesPilot AI action (e.g., `Send WhatsApp Message`, `Place AI Voice Call`, or `Update Customer CRM`).
2. Enter a **Webhook Secret** and save the rule.
3. Copy the generated **n8n Inbound Trigger URL**:
   `https://<your-domain>/api/webhooks/automations/<ruleId>`
4. In n8n, add an **HTTP Request** node (`POST`) pointing to that URL:
   - Header: `x-n8n-secret: <your-secret>`
   - JSON Body (any combination):
     ```json
     {
       "customerId": "...",
       "orderId": "...",
       "phone": "+8801712345678",
       "variables": { "customNote": "VIP" }
     }
     ```
