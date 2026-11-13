/**
 * GET  /api/agents   ?limit&cursor -> 200 { items: Agent[], nextCursor: string | null }
 *                    (most recently updated first; other query params are ignored)
 * POST /api/agents   agentInputSchema -> 201 Agent (starts inactive, version 1)
 *
 * organizationId and uid come from the verified session and membership document, never from the
 * request. Errors: 400 validation (including categories of another organization), 401, 403, 415, 429.
 */
import { withApi } from "@/lib/api/handler";
import { cursorParam, limitParam, parseQueryParams } from "@/lib/list-params";
import { agentInputSchema } from "@/schemas/agent";
import { createAgent, listAgents, type AgentListQuery } from "@/services/agents/agents";
import { z } from "zod";

const listParamsSchema = z.object({ limit: limitParam(), cursor: cursorParam() });

export const GET = withApi({ permission: "agents:read" }, async ({ req, organizationId, uid }) => {
  const p = parseQueryParams(new URL(req.url).searchParams, listParamsSchema);
  const query: AgentListQuery = {};
  if (p.limit !== undefined) query.limit = p.limit;
  if (p.cursor !== undefined) query.cursor = p.cursor;
  return listAgents({ organizationId, uid }, query);
});

export const POST = withApi(
  {
    permission: "agents:write",
    schema: agentInputSchema,
    rateLimit: { name: "agents.create", limit: 30, windowSec: 60 },
  },
  async ({ body, organizationId, uid }) =>
    Response.json(await createAgent({ organizationId, uid }, body), { status: 201 }),
);
