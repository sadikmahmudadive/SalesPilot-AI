/**
 * Shared customer access for the CRM agent tools. Server-only.
 *
 * TENANCY. The customer is found through the phone lock `customerPhones/{orgId}_{phoneE164}`
 * (the org id is part of the document id AND checked on the stored `organizationId`), then read
 * through `customerRepo.get`, which compares the stored organization again. A customer of
 * another organization is therefore indistinguishable from a missing one.
 */
import "server-only";

import { normalizePhone } from "@/lib/phone";
import { customerRepo, phoneLockRef, type CustomerDoc } from "@/repositories/customers";

import { isLiveChannel, type ToolContext } from "./types";

/** E.164 form of a phone number the model passed, or null when it is not a supported mobile. */
export const phoneE164Of = (raw: string): string | null => normalizePhone(raw);

/** The customer of `organizationId` with this E.164 number, or null. */
export async function findCustomerByPhone(
  organizationId: string,
  phoneE164: string,
): Promise<CustomerDoc | null> {
  const lock = await phoneLockRef(organizationId, phoneE164).get();
  if (!lock.exists || lock.get("organizationId") !== organizationId) return null;
  const customerId: unknown = lock.get("customerId");
  if (typeof customerId !== "string" || customerId.length === 0) return null;
  return customerRepo.get(organizationId, customerId);
}

/** Static message for a live call about a customer other than the one in the conversation. */
export const CONTACT_DENIED = "That customer can't be accessed in this conversation.";

/**
 * Live channels may only act on the conversing customer: the normalised input phone must equal
 * `ctx.contactPhoneE164` (set by the channel layer). A missing or different number is not
 * allowed. The test channel (and any non-live channel) is unrestricted.
 */
export function mayAccessPhone(
  ctx: Pick<ToolContext, "channel" | "contactPhoneE164">,
  phoneE164: string,
): boolean {
  if (!isLiveChannel(ctx.channel)) return true;
  const contact = ctx.contactPhoneE164 ? phoneE164Of(ctx.contactPhoneE164) : null;
  return contact !== null && contact === phoneE164;
}
