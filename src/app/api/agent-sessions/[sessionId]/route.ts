/**
 * GET /api/agent-sessions/[sessionId] -> 200 { session: AgentSession, messages: AgentMessage[] }
 *                                        (messages ordered oldest to newest by createdAt asc)
 *
 * organizationId and uid come from the verified session and membership document.
 * Errors: 401, 403, 404 (unknown or cross-org session).
 */
import { withApi } from "@/lib/api/handler";
import { getSessionWithMessages } from "@/services/agents/sessions";

export const GET = withApi(
  { permission: "agents:test" },
  async ({ params, organizationId, uid }) =>
    getSessionWithMessages({ organizationId, uid }, params.sessionId ?? ""),
);
