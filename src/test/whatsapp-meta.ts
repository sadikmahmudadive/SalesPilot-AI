/**
 * TEST SUPPORT ONLY. A fake Meta Graph API for WhatsApp tests: it accepts the given phone number
 * ids (number lookup + business account listing) with the given token, inspects tokens
 * (`debug_token`), records message sends and app subscriptions, and refuses anything else with a
 * 401 like Meta does for a bad token.
 */
export interface FakeMetaSend {
  phoneNumberId: string;
  authorization: string | null;
  body: string;
}

export interface FakeMetaOptions {
  displayPhoneNumber?: string;
  verifiedName?: string;
  /** The Meta app the accepted tokens belong to (`debug_token` `app_id`). */
  appId?: string;
  /** Business accounts `debug_token` reports for an accepted token; `null` reports none. */
  businessAccountIds?: string[] | null;
  /** `POST /{waba}/subscribed_apps` is refused. */
  subscribeFails?: boolean;
}

export type FakeMeta = typeof fetch & {
  sends: FakeMetaSend[];
  /** Business account ids the app was subscribed to. */
  subscriptions: string[];
  /** The `Authorization` header of each `debug_token` call. */
  inspections: Array<string | null>;
};

const invalid = () =>
  Response.json({ error: { message: "Invalid OAuth access token" } }, { status: 401 });

export function fakeMeta(
  accepted: Record<string, string>, // phoneNumberId -> the token Meta accepts for it
  opts: FakeMetaOptions = {},
): FakeMeta {
  const sends: FakeMetaSend[] = [];
  const subscriptions: string[] = [];
  const inspections: Array<string | null> = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input : input.url,
    );
    const auth = new Headers(init?.headers).get("authorization");
    const parts = url.pathname.split("/").filter(Boolean); // [version, id, (edge)]
    const id = parts[1] ?? "";
    const edge = parts[2];
    const tokenOk = (number: string) =>
      accepted[number] !== undefined && auth === `Bearer ${accepted[number]}`;
    const owned = () => Object.keys(accepted).filter((n) => auth === `Bearer ${accepted[n]}`);

    if (id === "debug_token") {
      inspections.push(auth);
      const inspected = url.searchParams.get("input_token");
      if (!Object.values(accepted).includes(inspected ?? "")) {
        return Response.json({ data: { is_valid: false } });
      }
      const targets = opts.businessAccountIds === undefined ? ["1022901"] : opts.businessAccountIds;
      return Response.json({
        data: {
          is_valid: true,
          app_id: opts.appId ?? "9001",
          granular_scopes: [
            { scope: "whatsapp_business_messaging" },
            { scope: "whatsapp_business_management", ...(targets ? { target_ids: targets } : {}) },
          ],
        },
      });
    }
    if (edge === "messages") {
      if (!tokenOk(id)) return invalid();
      sends.push({ phoneNumberId: id, authorization: auth, body: String(init?.body ?? "") });
      return Response.json({ messages: [{ id: `wamid.fake.${sends.length}` }], success: true });
    }
    if (edge === "subscribed_apps") {
      if (init?.method !== "POST" || owned().length === 0) return invalid();
      if (opts.subscribeFails) {
        return Response.json({ error: { message: "(#200) Permissions error" } }, { status: 400 });
      }
      subscriptions.push(id);
      return Response.json({ success: true });
    }
    if (edge === "phone_numbers") {
      if (owned().length === 0) return invalid();
      return Response.json({
        data: owned().map((n) => ({
          id: n,
          display_phone_number: opts.displayPhoneNumber ?? "+880 1711-000000",
          verified_name: opts.verifiedName ?? "Brand Booster",
        })),
      });
    }
    if (edge === undefined && tokenOk(id)) {
      return Response.json({
        id,
        display_phone_number: opts.displayPhoneNumber ?? "+880 1711-000000",
        verified_name: opts.verifiedName ?? "Brand Booster",
      });
    }
    return invalid();
  }) as FakeMeta;
  fn.sends = sends;
  fn.subscriptions = subscriptions;
  fn.inspections = inspections;
  return fn;
}
