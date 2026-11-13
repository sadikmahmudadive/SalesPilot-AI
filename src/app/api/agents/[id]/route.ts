/**
 * GET   /api/agents/[id]  -> 200 Agent
 * PATCH /api/agents/[id]  agentPatchSchema -> 200 Agent
 *   `model: null` clears the model; `limits`, `escalation` and `productAccess` replace the whole
 *   stored object. `version` is bumped only when a behaviour field actually changes.
 *
 * An unknown id, an invalid id (e.g. containing "/") and another organization's id are all the
 * same 404, so ids cannot be probed.
 */
import { withApi } from "@/lib/api/handler";
import { agentPatchSchema } from "@/schemas/agent";
import { getAgent, updateAgent } from "@/services/agents/agents";

export const GET = withApi(
  { permission: "agents:read" },
  async ({ params, organizationId, uid }) => getAgent({ organizationId, uid }, params.id ?? ""),
);

export const PATCH = withApi(
  {
    permission: "agents:write",
    schema: agentPatchSchema,
    rateLimit: { name: "agents.update", limit: 60, windowSec: 60 },
  },
  async ({ params, body, organizationId, uid }) =>
    updateAgent({ organizationId, uid }, params.id ?? "", body),
);
