/**
 * Pure logic behind the Settings > Orders form: stored settings to form text, form text to the
 * PATCH body (with per-field messages) and API errors onto fields. No React, so it is unit tested.
 *
 * MONEY. Delivery charges are typed in taka and parsed with `parseTakaToMinor` (string maths, never
 * a float); the API stores and receives integer paisa.
 */
import { ApiError } from "@/lib/api/client";
import { mapApiErrorWith, type MappedApiError } from "@/lib/api/map-error";
import { formatMinorToTakaInput, parseTakaToMinor } from "@/lib/money";
import { orderSettingsSchema, type OrderSettings } from "@/schemas/order";

export interface OrderSettingsFormValues {
  /** Taka text, e.g. "60.00". */
  deliveryChargeInsideDhaka: string;
  deliveryChargeOutsideDhaka: string;
  /** Whole-number text. */
  draftHoldMinutes: string;
  paymentHoldHours: string;
}

export type OrderSettingsFieldName = keyof OrderSettingsFormValues;

export type OrderSettingsValidation =
  | { ok: true; settings: OrderSettings }
  | { ok: false; errors: Partial<Record<OrderSettingsFieldName, string>> };

export function settingsToForm(settings: OrderSettings): OrderSettingsFormValues {
  return {
    deliveryChargeInsideDhaka: formatMinorToTakaInput(settings.deliveryChargeInsideDhakaMinor),
    deliveryChargeOutsideDhaka: formatMinorToTakaInput(settings.deliveryChargeOutsideDhakaMinor),
    draftHoldMinutes: String(settings.draftHoldMinutes),
    paymentHoldHours: String(settings.paymentHoldHours),
  };
}

/** The limit of the schema's charge field (1,000,000 paisa) in the words a person types. */
const CHARGE_RANGE_MESSAGE = "Enter 0 to 10,000 taka";
const WHOLE = /^\d{1,6}$/;

type Parsed = { ok: true; value: number } | { ok: false; message: string };

function parseCharge(text: string): Parsed {
  const parsed = parseTakaToMinor(text);
  if (!parsed.ok) return { ok: false, message: parsed.message };
  const check = orderSettingsSchema.shape.deliveryChargeInsideDhakaMinor.safeParse(parsed.minor);
  return check.success
    ? { ok: true, value: parsed.minor }
    : { ok: false, message: CHARGE_RANGE_MESSAGE };
}

function parseWhole(
  text: string,
  schema: typeof orderSettingsSchema.shape.draftHoldMinutes,
): Parsed {
  const trimmed = text.trim();
  // The schema is the source of the range message; a non-integer typed value fails it too.
  const check = schema.safeParse(WHOLE.test(trimmed) ? Number(trimmed) : Number.NaN);
  return check.success
    ? { ok: true, value: check.data }
    : { ok: false, message: check.error.issues[0]?.message ?? "Enter a whole number" };
}

/** Validates the typed values; on success the full settings body, on failure a message per bad field. */
export function validateOrderSettingsForm(
  values: OrderSettingsFormValues,
): OrderSettingsValidation {
  const inside = parseCharge(values.deliveryChargeInsideDhaka);
  const outside = parseCharge(values.deliveryChargeOutsideDhaka);
  const minutes = parseWhole(values.draftHoldMinutes, orderSettingsSchema.shape.draftHoldMinutes);
  const hours = parseWhole(values.paymentHoldHours, orderSettingsSchema.shape.paymentHoldHours);

  const errors: Partial<Record<OrderSettingsFieldName, string>> = {};
  if (!inside.ok) errors.deliveryChargeInsideDhaka = inside.message;
  if (!outside.ok) errors.deliveryChargeOutsideDhaka = outside.message;
  if (!minutes.ok) errors.draftHoldMinutes = minutes.message;
  if (!hours.ok) errors.paymentHoldHours = hours.message;
  if (!inside.ok || !outside.ok || !minutes.ok || !hours.ok) return { ok: false, errors };

  return {
    ok: true,
    settings: {
      deliveryChargeInsideDhakaMinor: inside.value,
      deliveryChargeOutsideDhakaMinor: outside.value,
      draftHoldMinutes: minutes.value,
      paymentHoldHours: hours.value,
    },
  };
}

const API_FIELDS: Readonly<Record<string, OrderSettingsFieldName>> = {
  deliveryChargeInsideDhakaMinor: "deliveryChargeInsideDhaka",
  deliveryChargeOutsideDhakaMinor: "deliveryChargeOutsideDhaka",
  draftHoldMinutes: "draftHoldMinutes",
  paymentHoldHours: "paymentHoldHours",
};

export function mapOrderSettingsApiError(error: ApiError): MappedApiError<OrderSettingsFieldName> {
  return mapApiErrorWith<OrderSettingsFieldName>(error, {
    toField: (path) => API_FIELDS[path] ?? null,
    onConflict: (e) => ({ fields: [], formError: e.message }),
  });
}
