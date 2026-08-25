import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Phase 2G real-verification UI consistency fix — structural source checks
// only (this codebase has no React component-rendering test dependency;
// every other client component in this repo is proven the same way, e.g.
// tests/unit/api/webhooks-razorpay-route.test.ts's own "structural checks"
// describe block). The actual decision logic under test lives in the pure,
// directly-unit-tested `isPaymentCaptureConfirmedByRealWebhook`
// (tests/unit/demo-merchant/view-model.test.ts) — this file only proves the
// button component actually wires that decision into the two mutually
// exclusive message strings, rather than still hard-coding the stale claim.

const source = fs.readFileSync(
  path.resolve(
    import.meta.dirname,
    "../../../app/demo-merchant/pay-with-razorpay-button.tsx",
  ),
  "utf-8",
);

describe("PayWithRazorpayButton — structural checks (Phase 2G UI consistency fix)", () => {
  it("requires a webhookConfirmed prop (never defaulted, so a caller cannot silently fall back to the removed unconditional claim)", () => {
    expect(source).toMatch(/webhookConfirmed:\s*boolean/);
    expect(source).not.toMatch(/webhookConfirmed\s*=\s*(true|false)/);
  });

  it("the awaiting-confirmation message is no longer unconditional — it is one branch of a webhookConfirmed ternary", () => {
    const awaitingIndex = source.indexOf(
      "Checkout response verified — awaiting webhook confirmation.",
    );
    const confirmedIndex = source.indexOf(
      "Payment capture confirmed by Razorpay Test Mode webhook.",
    );
    const ternaryConditionIndex = source.indexOf("webhookConfirmed\n");
    expect(awaitingIndex).toBeGreaterThan(-1);
    expect(confirmedIndex).toBeGreaterThan(-1);
    expect(ternaryConditionIndex).toBeGreaterThan(-1);
    // The condition must appear before both message strings it chooses
    // between (the JSX ternary `{webhookConfirmed ? confirmed : awaiting}`).
    expect(ternaryConditionIndex).toBeLessThan(confirmedIndex);
    expect(ternaryConditionIndex).toBeLessThan(awaitingIndex);
  });

  it("both messages remain distinct — the fix never silently drops the awaiting message for the not-yet-confirmed case", () => {
    expect(source).toContain(
      "Checkout response verified — awaiting webhook confirmation.",
    );
    expect(source).toContain(
      "Payment capture confirmed by Razorpay Test Mode webhook.",
    );
  });
});
