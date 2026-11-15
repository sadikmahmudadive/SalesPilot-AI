import "server-only";

/**
 * Normalizes Bangla digits (\u09E6-\u09EF) to ASCII 0-9 digits.
 */
function normalizeDigits(str: string): string {
  return str.replace(/[\u09E6-\u09EF]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0x09E6 + 0x30),
  );
}

/**
 * Converts a string of digits and optional decimals to integer paisa string (e.g. 1250 -> "125000").
 */
function toPaisaString(digits: string, decimal: string | undefined): string {
  const cleanTaka = digits.replace(/^0+/, "") || "0";
  const takaPart = BigInt(cleanTaka);
  let paisa = BigInt(0);
  if (decimal !== undefined && decimal.length > 0) {
    const padded = decimal.padEnd(2, "0").slice(0, 2);
    paisa = BigInt(padded);
  }
  return (takaPart * BigInt(100) + paisa).toString();
}

/**
 * Extracts all monetary amounts found in a text string, normalized to integer paisa strings.
 * Uses unicode escapes for source hygiene (\u09F3 = ৳, \u09E6-\u09EF = Bangla digits, \u099F\u09BE\u0995\u09BE = taka).
 */
export function extractFiguresFromText(text: string): string[] {
  const found: Array<{ index: number; paisa: string }> = [];

  const parseNumberPart = (rawNum: string): string | null => {
    const ascii = normalizeDigits(rawNum).replace(/,/g, "").trim();
    if (!ascii) return null;
    const parts = ascii.split(".");
    const taka = parts[0] ?? "0";
    const decimal = parts[1];
    return toPaisaString(taka, decimal);
  };

  // Pattern A: Currency prefix (\u09F3 = ৳, Tk, TK, BDT, etc.)
  const prefixRegex =
    /(?:[\u09F3]|\b(?:Tk|TK|tk|BDT|bdt)\.?)\s*([0-9\u09E6-\u09EF][0-9\u09E6-\u09EF,]*(?:\.[0-9\u09E6-\u09EF]{1,2})?)/gi;
  let match: RegExpExecArray | null;
  while ((match = prefixRegex.exec(text)) !== null) {
    const matchedDigits = match[1];
    if (matchedDigits) {
      const paisaStr = parseNumberPart(matchedDigits);
      if (paisaStr !== null) {
        found.push({ index: match.index, paisa: paisaStr });
      }
    }
  }

  // Pattern B: Currency suffix (taka, tk, bdt, \u099F\u09BE\u0995\u09BE, /-, \u09F3)
  const suffixRegex =
    /(?<!\w)([0-9\u09E6-\u09EF][0-9\u09E6-\u09EF,]*(?:\.[0-9\u09E6-\u09EF]{1,2})?)\s*(?:taka|tk|bdt|[\u099F\u09BE\u0995\u09BE]|[\u09F3]|\/-)(?![a-zA-Z0-9\u0980-\u09FF])/gi;
  while ((match = suffixRegex.exec(text)) !== null) {
    const matchedDigits = match[1];
    if (matchedDigits) {
      const paisaStr = parseNumberPart(matchedDigits);
      if (paisaStr !== null) {
        found.push({ index: match.index, paisa: paisaStr });
      }
    }
  }

  // Sort by textual appearance order
  found.sort((a, b) => a.index - b.index);
  return found.map((f) => f.paisa);
}

/**
 * Traverses tool result payloads to find all verified monetary amounts (minor integer units and formatted texts).
 */
function collectVerifiedFigures(obj: unknown, verified: Set<string>): void {
  if (obj === null || obj === undefined) return;

  if (typeof obj === "string") {
    for (const fig of extractFiguresFromText(obj)) {
      verified.add(fig);
    }
    return;
  }

  if (Array.isArray(obj)) {
    for (const item of obj) {
      collectVerifiedFigures(item, verified);
    }
    return;
  }

  if (typeof obj === "object") {
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === "number" && Number.isFinite(value)) {
        if (/minor$/i.test(key) || /paisa$/i.test(key)) {
          verified.add(Math.round(value).toString());
        } else if (/price|total|cost|amount|subtotal/i.test(key)) {
          verified.add(Math.round(value).toString());
          verified.add(Math.round(value * 100).toString());
        }
      } else {
        collectVerifiedFigures(value, verified);
      }
    }
  }
}

/**
 * Finds all monetary figures mentioned in the assistant's reply that do not appear in any tool result.
 * Returns the amounts normalized as integer paisa strings (e.g. "125000" for 1,250 taka).
 */
export function findUnverifiedFigures(replyText: string, toolData: unknown[]): string[] {
  const replyFigures = extractFiguresFromText(replyText);
  if (replyFigures.length === 0) return [];

  const verified = new Set<string>();
  collectVerifiedFigures(toolData, verified);

  const unverified: string[] = [];
  for (const fig of replyFigures) {
    if (!verified.has(fig) && !unverified.includes(fig)) {
      unverified.push(fig);
    }
  }

  return unverified;
}
