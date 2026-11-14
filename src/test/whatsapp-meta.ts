/**
 * TEST SUPPORT ONLY. A fake Meta Graph API for WhatsApp tests: it accepts the given phone number
 * ids (number lookup + business account listing) with the given token, records message sends, and
 * refuses anything else with a 401 like Meta does for a bad token.
 */
export interface FakeMetaSend {
  phoneNumberId: string;
  authorization: string | null;
  body: string;
}

export function fakeMeta(
  accepted: Record<string, string>, // phoneNumberId -> the token Meta accepts for it
  opts: { displayPhoneNumber?: string; verifiedName?: string } = {},
): typeof fetch & { sends: FakeMetaSend[] } {
  const sends: FakeMetaSend[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    const auth = new Headers(init?.headers).get("authorization");
    const parts = url.pathname.split("/").filter(Boolean); // [version, id, (edge)]
    const id = parts[1] ?? "";
    const edge = parts[2];
    const tokenOk = (number: string) => accepted[number] !== undefined && auth === `Bearer ${accepted[number]}`;

    if (edge === "messages") {
      if (!tokenOk(id)) return Response.json({ error: { message: "Invalid OAuth access token" } }, { status: 401 });
      sends.push({ phoneNumberId: id, authorization: auth, body: String(init?.body ?? "") });
      return Response.json({ messages: [{ id: `wamid.fake.${sends.length}` }], success: true });
    }
    if (edge === "phone_numbers") {
      const owned = Object.keys(accepted).filter((n) => auth === `Bearer ${accepted[n]}`);
      if (owned.length === 0) return Response.json({ error: { message: "Invalid OAuth access token" } }, { status: 401 });
      return Response.json({ data: owned.map((n) => ({ id: n })) });
    }
    if (edge === undefined && tokenOk(id)) {
      return Response.json({
        id,
        display_phone_number: opts.displayPhoneNumber ?? "+880 1711-000000",
        verified_name: opts.verifiedName ?? "Brand Booster",
      });
    }
    return Response.json({ error: { message: "Invalid OAuth access token" } }, { status: 401 });
  }) as typeof fetch & { sends: FakeMetaSend[] };
  fn.sends = sends;
  return fn;
}
