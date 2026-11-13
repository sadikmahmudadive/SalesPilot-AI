import type { BookShipmentInput } from "@/schemas/courier";

export interface BookCourierFormValues {
  courierAccountId: string;
  weightKg: string;
  codAmount: string;
  cityId: string;
  cityName: string;
  zoneId: string;
  zoneName: string;
  areaId: string;
  areaName: string;
  note: string;
}

export function validateBookCourierForm(
  values: BookCourierFormValues,
  requiresLocation: boolean,
): Record<string, string> {
  const errors: Record<string, string> = {};

  if (!values.courierAccountId.trim()) {
    errors.courierAccountId = "Select a courier account";
  }

  const weight = parseFloat(values.weightKg);
  if (isNaN(weight) || weight <= 0) {
    errors.weightKg = "Enter a valid weight in kg (greater than 0)";
  }

  const cod = parseFloat(values.codAmount);
  if (isNaN(cod) || cod < 0) {
    errors.codAmount = "Enter a valid COD amount (0 or more)";
  }

  if (requiresLocation) {
    if (!values.cityId.trim()) {
      errors.cityId = "City is required";
    }
    if (!values.zoneId.trim()) {
      errors.zoneId = "Zone is required";
    }
  }

  return errors;
}

export function buildBookShipmentPayload(values: BookCourierFormValues): BookShipmentInput {
  const weightKg = parseFloat(values.weightKg) || 0.5;
  const codAmount = parseFloat(values.codAmount) || 0;
  const codAmountMinor = Math.round(codAmount * 100);

  const hasLocation =
    values.cityId.trim() ||
    values.zoneId.trim() ||
    values.areaId.trim();

  return {
    courierAccountId: values.courierAccountId.trim(),
    weightKg,
    codAmountMinor,
    location: hasLocation
      ? {
          cityId: values.cityId.trim() || null,
          cityName: values.cityName.trim() || null,
          zoneId: values.zoneId.trim() || null,
          zoneName: values.zoneName.trim() || null,
          areaId: values.areaId.trim() || null,
          areaName: values.areaName.trim() || null,
        }
      : null,
    note: values.note.trim() ? values.note.trim() : undefined,
  };
}
