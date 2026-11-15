import { withApi } from "@/lib/api/handler";
import { adminDb } from "@/lib/firebase/admin";

export const dynamic = "force-dynamic";

export interface AuditLogSummary {
  id: string;
  actorUid: string;
  action: string;
  resource: string;
  resourceId: string;
  createdAt: string | null;
}

function toMillis(v: unknown): number {
  if (v instanceof Date) return v.getTime();
  if (typeof v === "string") {
    const ms = Date.parse(v);
    return Number.isNaN(ms) ? 0 : ms;
  }
  if (
    v !== null &&
    typeof v === "object" &&
    "toDate" in v &&
    typeof (v as { toDate?: unknown }).toDate === "function"
  ) {
    return (v as { toDate: () => Date }).toDate().getTime();
  }
  return 0;
}

function toIso(v: unknown): string | null {
  const ms = toMillis(v);
  return ms > 0 ? new Date(ms).toISOString() : null;
}

export const GET = withApi(
  {
    permission: "audit:read",
    rateLimit: { name: "audit.read", limit: 60, windowSec: 60 },
  },
  async ({ req, organizationId }) => {
    const sp = new URL(req.url).searchParams;
    const rawLimit = Number(sp.get("limit") ?? "50");
    const limit = Number.isFinite(rawLimit)
      ? Math.min(Math.max(Math.trunc(rawLimit), 1), 100)
      : 50;

    const snap = await adminDb()
      .collection("auditLogs")
      .where("organizationId", "==", organizationId)
      .get();

    const rows = snap.docs
      .map((doc) => {
        const d = doc.data();
        return {
          id: doc.id,
          actorUid: typeof d.actorUid === "string" ? d.actorUid : "unknown",
          action: typeof d.action === "string" ? d.action : "unknown",
          resource: typeof d.resource === "string" ? d.resource : "unknown",
          resourceId: typeof d.resourceId === "string" ? d.resourceId : "",
          createdAt: toIso(d.createdAt),
          _sortMs: toMillis(d.createdAt),
        };
      })
      .sort((a, b) => b._sortMs - a._sortMs)
      .slice(0, limit)
      .map<AuditLogSummary>((item) => ({
        id: item.id,
        actorUid: item.actorUid,
        action: item.action,
        resource: item.resource,
        resourceId: item.resourceId,
        createdAt: item.createdAt,
      }));

    return { items: rows };
  },
);
