/**
 * GET  /api/agents/[id]/sessions   ?limit&cursor -> 200 { items: AgentSession[], nextCursor: string | null }
 *                                  (ordered newest first by lastMessageAt desc)
 * POST /api/agents/[id]/sessions   -> 201 AgentSession (channel: 'test')
 *
 * organizationId and uid come from the verified session and membership document.
 * Errors: 401, 403, 404 (unknown or cross-org agent), 429.
 */
import { withApi } from "@/lib/api/handler";
import { cursorParam, limitParam, parseQueryParams } from "@/lib/list-params";
import {
  createSession,
  listSessions,
  type ListSessionsQuery,
} from "@/services/agents/sessions";
import { z } from "zod";

const listParamsSchema = z.object({ limit: limitParam(), cursor: cursorParam() });

export const GET = withApi(
  { permission: "agents:test" },
  async ({ req, params, organizationId, uid }) => {
    const p = parseQueryParams(new URL(req.url).searchParams, listParamsSchema);
    const query: ListSessionsQuery = {};
    if (p.limit !== undefined) query.limit = p.limit;
    if (p.cursor !== undefined) query.cursor = p.cursor;
    return listSessions({ organizationId, uid }, params.id ?? "", query);
  },
);

export const POST = withApi(
  {
    permission: "agents:test",
    rateLimit: { name: "agents.sessions.create", limit: 30, windowSec: 60 },
  },
  async ({ params, organizationId, uid }) =>
    Response.json(await createSession({ organizationId, uid }, params.id ?? "", "test"), {
      status: 201,
    }),
);
