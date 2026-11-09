# OpenAI setup

SalesPilot AI uses OpenAI's Responses API to drive AI sales agents with structured tool calling. Until the OpenAI key is set, agent execution endpoints answer 503 (`INTEGRATION_NOT_CONFIGURED`) and the dashboard test console displays a friendly setup notice. No real external API calls are made in tests or CI.

## 1. Create an API key

1. Sign up or sign in at [platform.openai.com](https://platform.openai.com/).
2. In the platform dashboard, navigate to **API Keys** and click **Create new secret key**.
3. Copy the key (starts with `sk-...`). Keep it secret.

| Variable | What it is | Server only? | Default |
|---|---|---|---|
| `OPENAI_API_KEY` | Secret API key from OpenAI | Yes, strictly server-only | Required for live agent execution |
| `OPENAI_CHAT_MODEL` | Default model for agent turns | Yes, server-only | `gpt-4o-mini` |
| `AI_DAILY_MESSAGE_LIMIT` | Per-organization daily message cap | Yes, server-only | `500` |

Put `OPENAI_API_KEY` in `.env.local` for local development or in Vercel project environment variables for production. Never commit this key to version control or paste it in chat.

After updating `.env.local`, restart `npm run dev` to reload server environment variables.

## 2. Cost and limits note

- Each agent turn streams text and can execute up to `maxToolCallsPerTurn` (default 4) tools against Firestore.
- Standard model: `gpt-4o-mini` is recommended for high performance and low latency with shopping workflows.
- Per-user rate limit: 20 messages per minute.
- Per-organization rate limit: 500 messages per 24 hours by default (configurable via `AI_DAILY_MESSAGE_LIMIT`).

## 3. Manual smoke test

Once you have set `OPENAI_API_KEY` in `.env.local`:

1. Sign in to your SalesPilot dashboard (`http://localhost:3000/login`).
2. Make sure you have at least one active product created in your catalogue with a price (e.g. "Red Cotton Shirt", price ৳1,200).
3. Navigate to **AI Agents** (`/agents`) and click **New agent**.
4. Choose the **Retail sales** template (pre-fills instructions, objectives, tools and Bangla example phrases). Click **Create agent**.
5. Click **Test in Console** to open `/agents/[id]/test`.
6. Ask the agent in Bangla for product pricing or availability (e.g., `লাল শার্ট এর দাম কত?`).
7. Verify in the chat pane and Inspector pane:
   - The agent calls the `search_products` / `get_price` tool.
   - The returned price matches the product in your catalogue.
   - Latency and token usage are recorded.
8. Ask the agent to save your contact information (e.g. `আমার নাম রহিম, ফোন 01711000000, ডেলিভারি দিন`).
9. Inspect the turn:
   - Verify a `dry_run_action` of kind `create_customer` is displayed in the Turn Inspector.
   - Go to **Customers** (`/customers`) and verify that **no customer was created** (test channel writes are always dry-run).
