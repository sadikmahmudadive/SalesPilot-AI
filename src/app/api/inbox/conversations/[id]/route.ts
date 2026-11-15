/**
 * GET   /api/inbox/conversations/[id]  -> 200 Conversation
 * PATCH /api/inbox/conversations/[id]  updateConversationSchema -> 200 Conversation
 */
import { withApi } from "@/lib/api/handler";
import { updateConversationSchema } from "@/schemas/inbox";
import { getConversation, updateConversation } from "@/services/inbox/inbox";

export const GET = withApi(
  { permission: "inbox:read" },
  async ({ params, organizationId, uid }) =>
    getConversation({ organizationId, uid }, params.id ?? ""),
);

export const PATCH = withApi(
  {
    permission: "inbox:write",
    schema: updateConversationSchema,
    rateLimit: { name: "inbox.update", limit: 60, windowSec: 60 },
  },
  async ({ params, body, organizationId, uid }) =>
    updateConversation({ organizationId, uid }, params.id ?? "", body),
);
