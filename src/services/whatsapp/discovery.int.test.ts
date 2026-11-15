import { afterEach, describe, expect, it, vi } from "vitest";

import { __resetEnvCacheForTests } from "@/config/env";
import { ValidationError } from "@/lib/errors";
import { fakeMeta } from "@/test/whatsapp-meta";

import { TOKEN_REJECTED_MESSAGE, WRONG_APP_MESSAGE, discoverWhatsAppNumbers } from "./discovery";

const TOKEN = "EAAG-discovery-token-0123456789";

function stubApp(appId: string, secret: string) {
  vi.stubEnv("WHATSAPP_APP_ID", appId);
  vi.stubEnv("WHATSAPP_APP_SECRET", secret);
  __resetEnvCacheForTests();
}

afterEach(() => {
  vi.unstubAllEnvs();
  __resetEnvCacheForTests();
});

describe("discoverWhatsAppNumbers", () => {
  it("lists the numbers of every business account the token can manage", async () => {
    const meta = fakeMeta(
      { "111111": TOKEN, "222222": TOKEN },
      {
        businessAccountIds: ["900001"],
        displayPhoneNumber: "+880 1711-123456",
        verifiedName: "Shop",
      },
    );
    const result = await discoverWhatsAppNumbers(TOKEN, { fetchFn: meta });
    expect(result.numbers).toEqual([
      {
        phoneNumberId: "111111",
        businessAccountId: "900001",
        displayPhoneNumber: "+880 1711-123456",
        verifiedName: "Shop",
      },
      {
        phoneNumberId: "222222",
        businessAccountId: "900001",
        displayPhoneNumber: "+880 1711-123456",
        verifiedName: "Shop",
      },
    ]);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it("rejects a token Meta does not recognise", async () => {
    const meta = fakeMeta({ "111111": TOKEN });
    const err = await discoverWhatsAppNumbers("made-up-token-0123456789", { fetchFn: meta }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).message).toBe(TOKEN_REJECTED_MESSAGE);
  });

  it("returns no numbers when Meta names no business account for the token", async () => {
    const meta = fakeMeta({ "111111": TOKEN }, { businessAccountIds: null });
    expect(await discoverWhatsAppNumbers(TOKEN, { fetchFn: meta })).toEqual({ numbers: [] });
  });

  it("ignores business account ids that are not numeric", async () => {
    const meta = fakeMeta({ "111111": TOKEN }, { businessAccountIds: ["../me", "900001"] });
    const result = await discoverWhatsAppNumbers(TOKEN, { fetchFn: meta });
    expect(result.numbers.map((n) => n.businessAccountId)).toEqual(["900001"]);
  });

  it("inspects the token as the platform app when its id and secret are configured", async () => {
    stubApp("9001", "app-secret");
    const meta = fakeMeta({ "111111": TOKEN }, { appId: "9001" });
    await discoverWhatsAppNumbers(TOKEN, { fetchFn: meta });
    expect(meta.inspections).toEqual(["Bearer 9001|app-secret"]);
  });

  it("refuses a token that belongs to a different Meta app", async () => {
    stubApp("9001", "app-secret");
    const meta = fakeMeta({ "111111": TOKEN }, { appId: "7777" });
    const err = await discoverWhatsAppNumbers(TOKEN, { fetchFn: meta }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).message).toBe(WRONG_APP_MESSAGE);
  });

  it("treats a network failure as a rejected token, not a crash", async () => {
    const down = (async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;
    const err = await discoverWhatsAppNumbers(TOKEN, { fetchFn: down }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
  });
});
