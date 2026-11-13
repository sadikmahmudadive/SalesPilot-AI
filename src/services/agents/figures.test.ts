import { describe, expect, it } from "vitest";

import { findUnverifiedFigures } from "./figures";

describe("unverified figures check", () => {
  it("detects English and Bangla currency formats and normalizes to integer paisa strings", () => {
    // \u09F3 is ৳, \u09E6-\u09EF are Bangla digits 0-9, \u099F\u09BE\u0995\u09BE is taka
    const reply =
      "The shirt is \u09F31,250. Another color is 1200 taka. Premium jacket is Tk 2,500.50. " +
      "Special discount \u09F3\u09E7\u09E8\u09EB\u09E6 (\u09E7\u09E8\u09EB\u09E6 \u099F\u09BE\u0995\u09BE).";

    // No tool data provided: all figures should be unverified
    const unverified = findUnverifiedFigures(reply, []);

    // 1,250 -> 125000 paisa
    // 1200 -> 120000 paisa
    // 2,500.50 -> 250050 paisa
    // Bangla 1250 -> 125000 paisa (deduplicated)
    expect(unverified).toEqual(["125000", "120000", "250050"]);
  });

  it("does not flag amounts present in tool data as priceMinor or priceText", () => {
    const reply = "The shirt costs \u09F31,250 and delivery is 100 taka.";
    const toolData = [
      {
        priceMinor: 125000,
        priceText: "\u09F31,250.00",
      },
    ];

    // 125000 is verified by priceMinor/priceText in tool data.
    // 100 taka (10000 paisa) was NOT in tool data, so it is unverified.
    const unverified = findUnverifiedFigures(reply, toolData);
    expect(unverified).toEqual(["10000"]);
  });

  it("does not flag amounts in nested tool outcomes or arrays", () => {
    const reply = "Your total for the order is Tk 3,450.00.";
    const toolData = [
      {
        ok: true,
        data: {
          subtotalMinor: 345000,
          subtotalText: "Tk 3,450.00",
          lines: [
            { lineMinor: 345000, lineText: "Tk 3,450.00" },
          ],
        },
      },
    ];

    const unverified = findUnverifiedFigures(reply, toolData);
    expect(unverified).toEqual([]);
  });

  it("does not flag non-money numbers such as quantities, phone numbers or plain digits", () => {
    const reply =
      "You ordered 2 pieces of product #42. We have 15 items in stock. " +
      "Please call us at 01711234567. We will deliver in 3 days.";

    // No currency symbols or words attached to these numbers
    const unverified = findUnverifiedFigures(reply, []);
    expect(unverified).toEqual([]);
  });

  it("handles decimal paisa values accurately", () => {
    const reply = "Price is \u09F3500.75 and discount is Tk 50.5";
    const unverified = findUnverifiedFigures(reply, []);

    // 500.75 -> 50075
    // 50.5 -> 5050
    expect(unverified).toEqual(["50075", "5050"]);
  });
});
