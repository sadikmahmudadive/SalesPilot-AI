/**
 * GET /api/inbox/conversations ?limit&cursor&status&search -> 200 { items: Conversation[], nextCursor: string | null }
 */
import { withApi } from "@/lib/api/handler";
import { conversationListQuerySchema } from "@/schemas/inbox";
import { listConversations } from "@/services/inbox/inbox";

export const GET = withApi(
  { permission: "inbox:read" },
  async ({ req, organizationId, uid }) => {
    const searchParams = new URL(req.url).searchParams;
    const query = conversationListQuerySchema.parse(Object.fromEntries(searchParams));
    return listConversations({ organizationId, uid }, query);
  },
);
