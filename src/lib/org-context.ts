/**
 * Service-call context and id assertions shared by the tenant-scoped services. Pure.
 */
import { NotFoundError } from "@/lib/errors";
import { isValidIdSegment } from "@/lib/ids";

/** Derived by the route wrapper from the verified session + membership, never from client input. */
export interface OrgCtx {
  organizationId: string;
  uid: string;
}

/** Fail closed: a missing organization or user must never reach a query. */
export function assertOrgCtx(ctx: OrgCtx, serviceName: string): void {
  if (
    !ctx ||
    !isValidIdSegment(ctx.organizationId) ||
    typeof ctx.uid !== "string" ||
    ctx.uid.trim() === ""
  ) {
    throw new Error(`${serviceName} service requires an organization and user context`);
  }
}

/** Invalid ids get the same NotFound as missing ones, so ids cannot be probed. */
export function assertEntityId(id: unknown): asserts id is string {
  if (!isValidIdSegment(id)) throw new NotFoundError();
}
