import { describe, expect, it } from "vitest";

import {
  addTags,
  tagsErrorMessage,
  buildPatch,
  customerToFormValues,
  EMPTY_FORM_VALUES,
  mapApiError,
  prepareCustomerBody,
  type CustomerFormValues,
} from "@/components/customers/customer-form-model";
import { ApiError } from "@/lib/api/client";
import { customerInputSchema, customerPatchSchema, type Customer } from "@/schemas/customer";

const customer: Customer = {
  id: "c1",
  organizationId: "o1",
  fullName: "Rahim Uddin",
  phone: "01712345678",
  phoneE164: "+8801712345678",
  whatsappNumber: "01712345678",
  whatsappE164: "+8801712345678",
  email: "rahim@example.com",
  address: "Dhaka",
  customerType: "retail",
  leadSource: "Facebook",
  tags: ["VIP", "dhaka"],
  segment: "interested",
  preferences: { language: "bn", notes: "Prefers calls" },
  consent: { status: "granted", source: "In store", at: "2026-01-01T00:00:00.000Z" },
  totalSpendMinor: 0,
  lastInteractionAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("prepareCustomerBody", () => {
  it("drops blank optional strings and trims the rest", () => {
    const body = prepareCustomerBody({
      ...EMPTY_FORM_VALUES,
      fullName: "  Karim  ",
      phone: " 01811111111 ",
      email: "   ",
      address: "",
      leadSource: " ",
      whatsappNumber: "",
    });
    expect(body).toEqual({
      fullName: "Karim",
      phone: "01811111111",
      customerType: "retail",
      segment: "new_lead",
      tags: [],
      consent: { status: "unknown" },
    });
  });

  it("omits preferences when both parts are empty and keeps them otherwise", () => {
    expect(
      prepareCustomerBody({ ...EMPTY_FORM_VALUES, preferences: { notes: "  " } }).preferences,
    ).toBeUndefined();
    expect(
      prepareCustomerBody({ ...EMPTY_FORM_VALUES, preferences: { language: "en", notes: " hi " } })
        .preferences,
    ).toEqual({ language: "en", notes: "hi" });
  });

  it("keeps the consent source only for granted consent", () => {
    const granted = prepareCustomerBody({
      ...EMPTY_FORM_VALUES,
      consent: { status: "granted", source: " Form " },
    });
    expect(granted.consent).toEqual({ status: "granted", source: "Form" });
    const denied = prepareCustomerBody({
      ...EMPTY_FORM_VALUES,
      consent: { status: "denied", source: "Form" },
    });
    expect(denied.consent).toEqual({ status: "denied" });
  });

  it("removes blank and case-insensitive duplicate tags", () => {
    const body = prepareCustomerBody({ ...EMPTY_FORM_VALUES, tags: ["VIP", " vip ", "", "new"] });
    expect(body.tags).toEqual(["VIP", "new"]);
  });
});

describe("customerToFormValues", () => {
  it("maps a customer to editable form values (no consent time, no derived fields)", () => {
    const v = customerToFormValues(customer);
    expect(v.fullName).toBe("Rahim Uddin");
    expect(v.consent).toEqual({ status: "granted", source: "In store" });
    expect(v).not.toHaveProperty("phoneE164");
    expect(v).not.toHaveProperty("id");
  });

  it("uses empty strings for missing optional text", () => {
    const v = customerToFormValues({
      ...customer,
      email: undefined,
      address: undefined,
      leadSource: undefined,
      whatsappNumber: undefined,
      preferences: undefined,
    });
    expect(v.email).toBe("");
    expect(v.address).toBe("");
    expect(v.leadSource).toBe("");
    expect(v.whatsappNumber).toBe("");
    expect(v.preferences).toEqual({ language: undefined, notes: "" });
  });
});

describe("buildPatch", () => {
  const initial = prepareCustomerBody(customerToFormValues(customer));
  const edit = (change: Partial<CustomerFormValues>) =>
    buildPatch(initial, prepareCustomerBody({ ...customerToFormValues(customer), ...change }));

  it("is empty when nothing changed", () => {
    expect(edit({})).toEqual({});
  });

  it("sends only changed fields", () => {
    expect(edit({ fullName: "Rahim U." })).toEqual({ fullName: "Rahim U." });
    expect(edit({ segment: "converted", tags: ["VIP"] })).toEqual({
      segment: "converted",
      tags: ["VIP"],
    });
  });

  it("sends null for cleared clearable fields", () => {
    expect(edit({ email: "", address: "  ", leadSource: "", whatsappNumber: "" })).toEqual({
      email: null,
      address: null,
      leadSource: null,
      whatsappNumber: null,
    });
  });

  it("does not send null for required fields that are emptied (validation catches them instead)", () => {
    expect(edit({ fullName: "" })).toEqual({ fullName: "" });
  });

  it("replaces the whole consent map when consent changes", () => {
    expect(edit({ consent: { status: "denied" } })).toEqual({ consent: { status: "denied" } });
    expect(edit({ consent: { status: "granted", source: "Phone call" } })).toEqual({
      consent: { status: "granted", source: "Phone call" },
    });
  });

  it("sends an empty preferences object when preferences are cleared", () => {
    expect(edit({ preferences: { language: undefined, notes: "" } })).toEqual({ preferences: {} });
  });

  it("sends the whole preferences map when only the notes changed", () => {
    expect(edit({ preferences: { language: "bn", notes: "Prefers WhatsApp" } })).toEqual({
      preferences: { language: "bn", notes: "Prefers WhatsApp" },
    });
  });

  it("sends the whole consent map when only the source changed", () => {
    expect(edit({ consent: { status: "granted", source: "Phone call" } })).toEqual({
      consent: { status: "granted", source: "Phone call" },
    });
  });

  it("never sends assignedAgentId or read-only fields", () => {
    const patch = edit({ fullName: "X" });
    expect(Object.keys(patch)).toEqual(["fullName"]);
  });
});

describe("mapApiError", () => {
  const api = (init: Partial<ConstructorParameters<typeof ApiError>[0]>) =>
    new ApiError({ status: 400, code: "VALIDATION_ERROR", message: "Invalid input", ...init });

  it("maps 409 CONFLICT onto the phone field", () => {
    const r = mapApiError(api({ status: 409, code: "CONFLICT", message: "dup" }));
    expect(r.fields).toEqual([
      { name: "phone", message: "A customer with this phone number already exists" },
    ]);
    expect(r.formError).toBeNull();
  });

  it("maps validation details onto matching fields", () => {
    const r = mapApiError(
      api({
        details: [
          { path: "phone", message: "Enter a valid mobile number" },
          { path: "consent.source", message: "Record how consent was obtained" },
          { path: "tags.2", message: "Use 40 characters or fewer per tag" },
        ],
      }),
    );
    expect(r.fields).toEqual([
      { name: "phone", message: "Enter a valid mobile number" },
      { name: "consent.source", message: "Record how consent was obtained" },
      { name: "tags", message: "Use 40 characters or fewer per tag" },
    ]);
    expect(r.formError).toBeNull();
  });

  it("sends unknown detail paths to the top-level message", () => {
    const r = mapApiError(api({ details: [{ path: "body", message: "Bad body" }] }));
    expect(r.fields).toEqual([]);
    expect(r.formError).toBe("Bad body");
  });

  it("falls back to the error message with the request id for other errors", () => {
    const r = mapApiError(
      api({
        status: 500,
        code: "INTERNAL_ERROR",
        message: "Internal server error",
        requestId: "r-9",
      }),
    );
    expect(r.fields).toEqual([]);
    expect(r.formError).toBe("Internal server error");
    expect(r.requestId).toBe("r-9");
  });

  it("gives a friendly message for 401 and 403", () => {
    expect(mapApiError(api({ status: 401, code: "UNAUTHENTICATED" })).formError).toMatch(
      /sign in/i,
    );
    expect(mapApiError(api({ status: 403, code: "FORBIDDEN" })).formError).toMatch(/permission/i);
  });
});

describe("addTags", () => {
  it("adds comma separated tags, trimmed, ignoring blanks", () => {
    expect(addTags(["a"], " b, c ,, ")).toEqual({ tags: ["a", "b", "c"] });
  });

  it("ignores case-insensitive duplicates", () => {
    expect(addTags(["VIP"], "vip, new")).toEqual({ tags: ["VIP", "new"] });
  });

  it("caps the list at 20 tags and says so", () => {
    const current = Array.from({ length: 19 }, (_, i) => `t${i}`);
    const result = addTags(current, "x, y, z");
    expect(result.tags).toHaveLength(20);
    expect(result.error).toMatch(/20 tags/);
  });

  it("refuses a tag over 40 characters with a message and adds no chip", () => {
    const result = addTags(["a"], "x".repeat(41));
    expect(result.tags).toEqual(["a"]);
    expect(result.error).toMatch(/40 characters/);
  });

  it("accepts a tag of exactly 40 characters", () => {
    const tag = "x".repeat(40);
    expect(addTags([], tag)).toEqual({ tags: [tag] });
  });

  it("keeps the valid tags in the same input as a refused one", () => {
    const result = addTags([], `ok, ${"y".repeat(50)}, fine`);
    expect(result.tags).toEqual(["ok", "fine"]);
    expect(result.error).toBeDefined();
  });
});

describe("tagsErrorMessage", () => {
  it("reads the array-level message", () => {
    expect(tagsErrorMessage({ message: "Use at most 20 tags" })).toBe("Use at most 20 tags");
  });

  it("reads a root message", () => {
    expect(tagsErrorMessage({ root: { message: "Tags must be a list" } })).toBe(
      "Tags must be a list",
    );
  });

  it("surfaces the first nested per-item error (errors.tags[2])", () => {
    const nested = [undefined, undefined, { message: "Use 40 characters or fewer per tag" }];
    expect(tagsErrorMessage(nested)).toBe("Use 40 characters or fewer per tag");
  });

  it("is undefined when there is no error", () => {
    expect(tagsErrorMessage(undefined)).toBeUndefined();
    expect(tagsErrorMessage([undefined, undefined])).toBeUndefined();
  });

  it("matches what the resolver produces for an over-long tag", () => {
    const body = prepareCustomerBody({
      ...EMPTY_FORM_VALUES,
      fullName: "A",
      phone: "01811111111",
      tags: ["x".repeat(41)],
    });
    const result = customerInputSchema.safeParse(body);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path.join(".")).toBe("tags.0");
  });
});

describe("compatibility with the API schemas", () => {
  it("a prepared create body parses with customerInputSchema", () => {
    const body = prepareCustomerBody({
      ...EMPTY_FORM_VALUES,
      fullName: "Karim",
      phone: "01811111111",
      consent: { status: "granted", source: "In store" },
    });
    expect(customerInputSchema.safeParse(body).success).toBe(true);
  });

  it("a patch with nulls and replaced maps parses with customerPatchSchema", () => {
    const initial = prepareCustomerBody(customerToFormValues(customer));
    const next = prepareCustomerBody({
      ...customerToFormValues(customer),
      email: "",
      preferences: { language: undefined, notes: "" },
      consent: { status: "denied" },
    });
    const patch = buildPatch(initial, next);
    expect(patch).toEqual({ email: null, preferences: {}, consent: { status: "denied" } });
    expect(customerPatchSchema.safeParse(patch).success).toBe(true);
  });

  it("a granted consent without a source is rejected with the path the form maps", () => {
    const body = prepareCustomerBody({
      ...EMPTY_FORM_VALUES,
      fullName: "A",
      phone: "01811111111",
      consent: { status: "granted", source: "  " },
    });
    const result = customerInputSchema.safeParse(body);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path.join(".")).toBe("consent.source");
  });
});
