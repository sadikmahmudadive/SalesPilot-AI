import { describe, expect, it } from "vitest";

import {
  MIN_VALUE_LENGTH,
  PEM_MARKERS,
  SERVER_ONLY_VARIABLES,
  scanContent,
  skippedShortValues,
  valueForms,
} from "../../scripts/check-bundle-secrets.mjs";

const FAKE_SECRET = "fixture-secret-value-0123456789";

describe("scanContent (bundle secret scan)", () => {
  it("returns nothing for clean bundle text", () => {
    const clean = 'var a="NEXT_PUBLIC_FIREBASE_API_KEY";console.log(a)';
    expect(scanContent(clean, {})).toEqual([]);
  });

  it("flags every server-only variable name", () => {
    for (const name of SERVER_ONLY_VARIABLES) {
      expect(scanContent(`x=process.env.${name};`, {})).toContainEqual({
        kind: "name",
        label: name,
      });
    }
  });

  it("does not flag public variable names or unrelated text", () => {
    expect(scanContent("NEXT_PUBLIC_APP_URL CLOUDINARY_CLOUD_NAME OPENAI_CHAT_MODEL", {})).toEqual(
      [],
    );
  });

  it("flags a set value and reports only the variable name", () => {
    const findings = scanContent(`const k="${FAKE_SECRET}";`, { CRON_SECRET: FAKE_SECRET });
    expect(findings).toEqual([{ kind: "value", label: "CRON_SECRET" }]);
    expect(JSON.stringify(findings)).not.toContain(FAKE_SECRET);
  });

  it("ignores unset and empty values", () => {
    const text = 'const k="";';
    expect(scanContent(text, { CRON_SECRET: "", ENCRYPTION_KEY: undefined })).toEqual([]);
  });

  it("does not search for values of variables that are not on the server-only list", () => {
    expect(scanContent(`"${FAKE_SECRET}"`, { SOMETHING_ELSE: FAKE_SECRET })).toEqual([]);
  });

  it("finds a multi-line value that the bundle holds with escaped newlines", () => {
    const key = "line-one\nline-two\nline-three";
    const bundled = `var k="line-one\\nline-two\\nline-three";`;
    // Fails if the real-newline -> backslash-n form is dropped from valueForms.
    expect(scanContent(bundled, { FIREBASE_PRIVATE_KEY: key })).toContainEqual({
      kind: "value",
      label: "FIREBASE_PRIVATE_KEY",
    });
  });

  it("finds a .env-style value (literal backslash-n) that the bundle holds with real newlines", () => {
    const envValue = "line-one\\nline-two\\nline-three";
    const bundled = "var k=`line-one\nline-two\nline-three`;";
    // Fails if the backslash-n -> real newline form is dropped from valueForms.
    expect(scanContent(bundled, { FIREBASE_PRIVATE_KEY: envValue })).toContainEqual({
      kind: "value",
      label: "FIREBASE_PRIVATE_KEY",
    });
  });

  it("builds all three forms of a value", () => {
    expect(valueForms("a\nb")).toEqual(["a\nb", "a\\nb"]);
    expect(valueForms("a\\nb")).toEqual(["a\\nb", "a\nb"]);
  });

  it("ignores values shorter than the minimum and reports their names only", () => {
    const text = 'var k="short";';
    const env = { CRON_SECRET: "short" };
    expect(MIN_VALUE_LENGTH).toBe(8);
    expect(scanContent(text, env)).toEqual([]);
    expect(skippedShortValues(env)).toEqual(["CRON_SECRET"]);
    expect(JSON.stringify(skippedShortValues(env))).not.toContain("short");
    expect(skippedShortValues({ CRON_SECRET: "long-enough-value", ENCRYPTION_KEY: "" })).toEqual(
      [],
    );
  });

  it("covers the verify token and webhook secrets", () => {
    expect(SERVER_ONLY_VARIABLES).toContain("WHATSAPP_VERIFY_TOKEN");
    expect(SERVER_ONLY_VARIABLES).toContain("TWILIO_WEBHOOK_SECRET");
  });

  it("flags PEM private key markers", () => {
    expect(PEM_MARKERS).toContain("-----BEGIN PRIVATE KEY-----");
    expect(scanContent("-----BEGIN PRIVATE KEY-----\nabc", {})).toContainEqual({
      kind: "pem",
      label: "-----BEGIN PRIVATE KEY-----",
    });
  });

  it("reports both the name and the value when both are present", () => {
    const findings = scanContent(`OPENAI_API_KEY="${FAKE_SECRET}"`, {
      OPENAI_API_KEY: FAKE_SECRET,
    });
    expect(findings).toEqual([
      { kind: "name", label: "OPENAI_API_KEY" },
      { kind: "value", label: "OPENAI_API_KEY" },
    ]);
  });
});
