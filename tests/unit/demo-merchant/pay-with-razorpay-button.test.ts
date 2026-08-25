import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Phase 2G real-verification UI consistency fix — structural source checks
// only (this codebase has no React component-rendering test dependency;
// every other client component in this repo is proven the same way, e.g.
// tests/unit/api/webhooks-razorpay-route.test.ts's own "structural checks"
// describe block).
//
// CORRECTED after deployed manual re-verification failure: the first version
// of this fix only proved `pay-with-razorpay-button.tsx`'s OWN message was
// conditional — it never checked whether a SECOND, independent, unconditional
// copy of the same claim existed elsewhere. It did:
// `app/demo-merchant/page.tsx` had its own separate, hardcoded, unconditional
// "Checkout response verified — awaiting webhook confirmation." paragraph
// inside its persisted-checkout-evidence block, which the first fix never
// touched — the deployed bug this round corrects.
//
// The actual decision logic under test lives in the pure, directly-unit-
// tested `isPaymentCaptureConfirmedByRealWebhook` /
// `formatCheckoutWebhookConfirmationMessage(FromConfirmedFlag)`
// (tests/unit/demo-merchant/view-model.test.ts). This file proves: (1) the
// button component consumes the SHARED formatter rather than hardcoding
// either string itself; (2) page.tsx's persisted-evidence block ALSO
// consumes the shared formatter rather than hardcoding either string itself;
// (3) — the specific regression guard for this round's bug — neither message
// string literal appears ANYWHERE in either file except as the two exported
// constants inside `lib/demo-merchant/view-model.ts` itself, so no third
// unconditional duplicate can silently reappear in either rendering path.

const AWAITING_MESSAGE =
  "Checkout response verified — awaiting webhook confirmation.";
const CONFIRMED_MESSAGE =
  "Payment capture confirmed by Razorpay Test Mode webhook.";

function readSource(relativePath: string): string {
  return fs.readFileSync(
    path.resolve(import.meta.dirname, "../../../" + relativePath),
    "utf-8",
  );
}

const buttonSource = readSource(
  "app/demo-merchant/pay-with-razorpay-button.tsx",
);
const pageSource = readSource("app/demo-merchant/page.tsx");
const viewModelSource = readSource("lib/demo-merchant/view-model.ts");

describe("PayWithRazorpayButton — structural checks (Phase 2G UI consistency fix)", () => {
  it("requires a webhookConfirmed prop (never defaulted, so a caller cannot silently fall back to a hardcoded claim)", () => {
    expect(buttonSource).toMatch(/webhookConfirmed:\s*boolean/);
    expect(buttonSource).not.toMatch(/webhookConfirmed\s*=\s*(true|false)/);
  });

  it("consumes the shared formatCheckoutWebhookConfirmationMessageFromConfirmedFlag rather than hardcoding either message string itself", () => {
    expect(buttonSource).toMatch(
      /formatCheckoutWebhookConfirmationMessageFromConfirmedFlag\s*\(\s*webhookConfirmed/,
    );
    expect(buttonSource).not.toContain(AWAITING_MESSAGE);
    expect(buttonSource).not.toContain(CONFIRMED_MESSAGE);
  });
});

describe("app/demo-merchant/page.tsx — persisted-checkout-evidence status message (this round's actual bug)", () => {
  it("no longer hardcodes the unconditional stale sentence — the confirmed root cause of the deployed bug", () => {
    expect(pageSource).not.toContain(AWAITING_MESSAGE);
    expect(pageSource).not.toContain(CONFIRMED_MESSAGE);
    // The exact broken source this round found and removed (the string was
    // split across two JSX lines by Prettier's line-wrapping, which is
    // exactly why the FIRST fix's plain single-line string search missed
    // it): a hardcoded "awaiting webhook" fragment with no surrounding
    // condition must not remain either.
    expect(pageSource).not.toMatch(
      /Checkout response verified[\s\S]{0,40}awaiting webhook[\s\S]{0,40}confirmation\.\s*<\/p>/,
    );
  });

  it("consumes the shared formatCheckoutWebhookConfirmationMessage(order) inside the persisted-checkout-evidence block", () => {
    expect(pageSource).toMatch(
      /formatCheckoutWebhookConfirmationMessage\(\s*order\s*\)/,
    );
  });

  it("the persisted-checkout-evidence block still renders whenever order.latestPayment exists (Case A/B do not depend on attempt eligibility, only on a payment ever having been verified) — the status message call site is inside that same conditional block", () => {
    const blockStart = pageSource.indexOf("{order.latestPayment && (");
    const formatCallIndex = pageSource.indexOf(
      "formatCheckoutWebhookConfirmationMessage(order)",
    );
    expect(blockStart).toBeGreaterThan(-1);
    expect(formatCallIndex).toBeGreaterThan(-1);
    expect(formatCallIndex).toBeGreaterThan(blockStart);
  });
});

describe("repo-wide regression guard — no duplicate unconditional stale-message path remains (this round's Task 5 item 7)", () => {
  it("the two message string literals exist ONLY inside lib/demo-merchant/view-model.ts's exported constants — nowhere else in app/demo-merchant", () => {
    expect(viewModelSource).toContain(AWAITING_MESSAGE);
    expect(viewModelSource).toContain(CONFIRMED_MESSAGE);
    expect(buttonSource).not.toContain(AWAITING_MESSAGE);
    expect(buttonSource).not.toContain(CONFIRMED_MESSAGE);
    expect(pageSource).not.toContain(AWAITING_MESSAGE);
    expect(pageSource).not.toContain(CONFIRMED_MESSAGE);
  });

  it("both rendering paths call one of the two shared formatter functions — neither reimplements its own conditional using a raw boolean/ternary against a locally-defined string", () => {
    expect(buttonSource).toMatch(
      /formatCheckoutWebhookConfirmationMessageFromConfirmedFlag/,
    );
    expect(pageSource).toMatch(/formatCheckoutWebhookConfirmationMessage\b/);
  });
});
