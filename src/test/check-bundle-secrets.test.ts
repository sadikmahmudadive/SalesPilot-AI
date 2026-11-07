import { describe, expect, it } from "vitest";

import {
  PEM_MARKERS,
  SERVER_ONLY_VARIABLES,
  scanContent,
} from "../../scripts/check-bundle-secrets.mjs";

const FAKE_SECRET = "fixture-secret-value-0123456789";

describe("scanContent (bundle secret scan)", () => {
  it("returns nothing for clean bundle text", () => {
    const clean = 'var a="NEXT_PUBLIC_FIREBASE_API_KEY";console.log(a)';
    expect(scanContent(clean, {})).toEqual([]);
  });

  it("flags every server-only variable name", () => {
    for (const name of SERVER_ONLY_VARIABLES) {
      expect(scanContent(`x=process.env.${name};`, {})).toContainEqual({ kind: "name", label: name });
    }
  });

  it("does not flag public variable names or unrelated text", () => {
    expect(scanContent("NEXT_PUBLIC_APP_URL CLOUDINARY_CLOUD_NAME OPENAI_CHAT_MODEL", {})).toEqual([]);
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

  it("finds a multi-line private key stored with escaped newlines", () => {
    const key = "line-one\nline-two\nline-three";
    const bundled = `var k="${key.replace(/\n/g, "\n")}";`;
    expect(scanContent(bundled, { FIREBASE_PRIVATE_KEY: key })).toContainEqual({
      kind: "value",
      label: "FIREBASE_PRIVATE_KEY",
    });
  });

  it("flags PEM private key markers", () => {
    expect(PEM_MARKERS).toContain("-----BEGIN PRIVATE KEY-----");
    expect(scanContent("-----BEGIN PRIVATE KEY-----\nabc", {})).toContainEqual({
      kind: "pem",
      label: "-----BEGIN PRIVATE KEY-----",
    });
  });

  it("reports both the name and the value when both are present", () => {
    const findings = scanContent(`OPENAI_API_KEY="${FAKE_SECRET}"`, { OPENAI_API_KEY: FAKE_SECRET });
    expect(findings).toEqual([
      { kind: "name", label: "OPENAI_API_KEY" },
      { kind: "value", label: "OPENAI_API_KEY" },
    ]);
  });
});
