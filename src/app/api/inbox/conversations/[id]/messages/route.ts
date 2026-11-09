/**
 * GET  /api/inbox/conversations/[id]/messages ?limit&cursor -> 200 { items: InboxMessage[], nextCursor: string | null }
 * POST /api/inbox/conversations/[id]/messages sendMessageInputSchema -> 201 InboxMessage
 */
import { withApi } from "@/lib/api/handler";
import { sendMessageInputSchema } from "@/schemas/inbox";
import { listMessages, sendHumanMessage } from "@/services/inbox/inbox";
import { z } from "zod";

const listMessagesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
});

export const GET = withApi(
  { permission: "inbox:read" },
  async ({ req, params, organizationId, uid }) => {
    const searchParams = new URL(req.url).searchParams;
    const query = listMessagesQuerySchema.parse(Object.fromEntries(searchParams));
    return listMessages({ organizationId, uid }, params.id ?? "", query);
  },
);

export const POST = withApi(
  {
    permission: "inbox:write",
    schema: sendMessageInputSchema,
    rateLimit: { name: "inbox.message", limit: 60, windowSec: 60 },
  },
  async ({ params, body, organizationId, uid }) => {
    const msg = await sendHumanMessage({ organizationId, uid }, params.id ?? "", body);
    return Response.json(msg, { status: 201 });
  },
);
