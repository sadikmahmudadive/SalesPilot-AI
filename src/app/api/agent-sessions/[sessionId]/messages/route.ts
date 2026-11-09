/**
 * POST /api/agent-sessions/[sessionId]/messages
 *
 * Streams agent execution turn as Server-Sent Events (SSE).
 *
 * Headers: Content-Type: text/event-stream, Cache-Control: no-store, X-Accel-Buffering: no.
 * Events: text_delta, tool_started, tool_finished, dry_run_action, done, error.
 *
 * Pre-stream guards (4xx/5xx JSON envelope):
 *   - permission: agents:test
 *   - per-user rate limit: 20 msgs / min
 *   - per-org daily cap: AI_DAILY_MESSAGE_LIMIT (default 500)
 *   - AI provider configured (503 if not)
 *   - session exists in org (404)
 *   - session turn cap not exceeded (409)
 *
 * Errors after stream starts surface as `error` SSE events.
 */
import { getServerEnv } from "@/config/env";
import { withApi } from "@/lib/api/handler";
import { getChatProvider } from "@/lib/ai/openai-provider";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { assertRateLimit } from "@/lib/security/rate-limit";
import { sessionRepo } from "@/repositories/agent-sessions";
import { getAgent } from "@/services/agents/agents";
import { runAgentTurn } from "@/services/agents/engine";
import { encodeSse } from "@/services/agents/events";
import { z } from "zod";

export const maxDuration = 60;
export const runtime = "nodejs";

const messageBodySchema = z.object({
  text: z.string().trim().min(1).max(2000),
});

export const POST = withApi(
  {
    permission: "agents:test",
    schema: messageBodySchema,
    rateLimit: { name: "agents.message", limit: 20, windowSec: 60 },
  },
  async ({ req, params, body, organizationId, uid, requestId }) => {
    // 1. Guard: Chat provider configured (throws IntegrationNotConfiguredError -> 503)
    const provider = getChatProvider();

    // 2. Guard: Organization-wide daily message limit
    const dailyLimit = getServerEnv().AI_DAILY_MESSAGE_LIMIT;
    await assertRateLimit(`agents.daily:${organizationId}`, {
      limit: dailyLimit,
      windowSec: 86400,
    });

    // 3. Guard: Verify session exists within organization
    const sessionId = params.sessionId ?? "";
    const session = await sessionRepo.get(organizationId, sessionId);
    if (!session) {
      throw new NotFoundError("Session not found");
    }

    // 4. Guard: Turn count limit
    const agent = await getAgent({ organizationId, uid }, session.agentId);
    if (session.turnCount >= agent.limits.maxTurnsPerSession) {
      throw new ConflictError(
        "This session has reached its turn limit. Start a new session to continue chatting.",
      );
    }

    // 5. Stream the turn over SSE
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          await runAgentTurn(
            { provider },
            {
              ctx: { organizationId, uid },
              sessionId,
              userText: body.text,
              signal: req.signal,
              emit: (event) => {
                if (event.type === "error" && !event.requestId) {
                  controller.enqueue(
                    encoder.encode(encodeSse({ ...event, requestId })),
                  );
                } else {
                  controller.enqueue(encoder.encode(encodeSse(event)));
                }
              },
            },
          );
        } catch (err) {
          const code = (err as { code?: string })?.code || "INTERNAL_ERROR";
          try {
            controller.enqueue(
              encoder.encode(
                encodeSse({
                  type: "error",
                  code,
                  message: "The AI service didn't respond. Try again.",
                  requestId,
                }),
              ),
            );
          } catch {
            // Stream might already be closed or controller errored
          }
        } finally {
          try {
            controller.close();
          } catch {
            // Already closed
          }
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
      },
    });
  },
);
