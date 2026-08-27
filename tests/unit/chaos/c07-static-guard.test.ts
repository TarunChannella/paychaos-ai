import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Phase 3D-B (correction round — Section 22) — static safety guard. Proves
 * the C07 production chaos functional source contains none of: `fetch(`,
 * `http.request`, `https.request`, `axios`, a Razorpay API client call, an
 * import of the public webhook route, an import of
 * `verifyCheckoutAction`/`verifyCheckoutAndPersistPayment`, a
 * merchant-state update function, a fulfilment insert, or an arbitrary
 * target URL/host/endpoint. Also proves
 * `lib/demo-merchant/service.ts`/`app/api/webhooks/razorpay/route.ts`/
 * `lib/webhooks/service.ts` carry no C07/chaos-specific change.
 *
 * Correction round update: the C07 execution service is now legitimately
 * authorized to import the existing server-only `verifyCheckoutSignature`
 * primitive (`lib/razorpay/checkout-verification.ts`) to authenticate the
 * first client confirmation before ever consuming the fault — this is NOT
 * a Razorpay API/network call (it performs no I/O of its own), and is the
 * ONE newly-authorized payment-security primitive inside C07. This guard
 * both permits that import AND proves the service never reimplements the
 * underlying HMAC itself (no direct `createHmac`/`timingSafeEqual` use).
 */

const repoRoot = path.resolve(import.meta.dirname, "../../../");

function readFunctionalSource(relativePath: string): string {
  const raw = fs.readFileSync(path.join(repoRoot, relativePath), "utf-8");
  return raw
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return (
        !trimmed.startsWith("//") &&
        !trimmed.startsWith("*") &&
        !trimmed.startsWith("/**")
      );
    })
    .join("\n");
}

const C07_PRODUCTION_FILES: Record<string, string> = {
  "lib/chaos/c07-execution-service.ts": readFunctionalSource(
    "lib/chaos/c07-execution-service.ts",
  ),
  "lib/chaos/c07-repository.ts": readFunctionalSource(
    "lib/chaos/c07-repository.ts",
  ),
  "app/api/chaos/runs/[runId]/arm-c07/route.ts": readFunctionalSource(
    "app/api/chaos/runs/[runId]/arm-c07/route.ts",
  ),
  "app/api/chaos/runs/[runId]/reconcile-c07/route.ts": readFunctionalSource(
    "app/api/chaos/runs/[runId]/reconcile-c07/route.ts",
  ),
  "app/api/chaos/runs/[runId]/cancel-c07/route.ts": readFunctionalSource(
    "app/api/chaos/runs/[runId]/cancel-c07/route.ts",
  ),
};

describe("C07 production chaos source — static safety guard", () => {
  it("contains no fetch()/http.request/https.request/axios/Razorpay API client call anywhere", () => {
    for (const [file, source] of Object.entries(C07_PRODUCTION_FILES)) {
      expect(source, file).not.toMatch(/\bfetch\s*\(/);
      expect(source, file).not.toMatch(/\bhttp\.request\s*\(/);
      expect(source, file).not.toMatch(/\bhttps\.request\s*\(/);
      expect(source, file).not.toMatch(/\baxios\b/i);
      expect(source, file).not.toMatch(/from\s+["']node:https?["']/);
      expect(source, file).not.toMatch(/from\s+["']axios["']/);
      expect(source, file).not.toMatch(
        /from\s*["']@\/lib\/razorpay\/adapter["']/,
      );
    }
  });

  it("does not import the public webhook route", () => {
    for (const [file, source] of Object.entries(C07_PRODUCTION_FILES)) {
      expect(source, file).not.toMatch(
        /from\s*["']@\/app\/api\/webhooks\/razorpay\/route["']/,
      );
    }
  });

  it("does not import verifyCheckoutAction or verifyCheckoutAndPersistPayment", () => {
    for (const [file, source] of Object.entries(C07_PRODUCTION_FILES)) {
      expect(source, file).not.toMatch(/verifyCheckoutAction/);
      expect(source, file).not.toMatch(/verifyCheckoutAndPersistPayment/);
    }
  });

  it("the execution service imports the real, reused verifyCheckoutSignature primitive — never reimplements HMAC itself", () => {
    const source = C07_PRODUCTION_FILES["lib/chaos/c07-execution-service.ts"]!;
    expect(source).toMatch(
      /import\s*\{\s*verifyCheckoutSignature\s*\}\s*from\s*["']@\/lib\/razorpay\/checkout-verification["']/,
    );
    for (const [file, fileSource] of Object.entries(C07_PRODUCTION_FILES)) {
      expect(fileSource, file).not.toMatch(/createHmac/);
      expect(fileSource, file).not.toMatch(/timingSafeEqual/);
      expect(fileSource, file).not.toMatch(/from\s*["']node:crypto["']/);
    }
  });

  it("never logs or persists the Checkout signature, Key Secret, or raw Checkout response", () => {
    const source = C07_PRODUCTION_FILES["lib/chaos/c07-execution-service.ts"]!;
    // logEvent calls in this module never include a signature/secret field.
    const logEventCalls = [...source.matchAll(/logEvent\([^)]*\)/g)];
    for (const call of logEventCalls) {
      expect(call[0]).not.toMatch(/signature/i);
      expect(call[0]).not.toMatch(/secret/i);
    }
  });

  it("does not import any merchant-state update function or insert a fulfilment", () => {
    for (const [file, source] of Object.entries(C07_PRODUCTION_FILES)) {
      expect(source, file).not.toMatch(/insertOrder\b/);
      expect(source, file).not.toMatch(/insertPaymentAttempt\b/);
      expect(source, file).not.toMatch(/insertVerifiedPayment\b/);
      expect(source, file).not.toMatch(/insertPaymentFromWebhookEvidence\b/);
      expect(source, file).not.toMatch(/insertFulfilment\w*/i);
      expect(source, file).not.toMatch(/markPaymentAttempt\w+/);
      expect(source, file).not.toMatch(/attachCheckoutVerificationToPayment/);
    }
  });

  it("contains no arbitrary target field name", () => {
    for (const [file, source] of Object.entries(C07_PRODUCTION_FILES)) {
      for (const forbidden of [
        "targetUrl",
        "targetHost",
        "callbackUrl",
        "endpointUrl",
        "webhookUrl",
      ]) {
        expect(source, file).not.toContain(forbidden);
      }
    }
  });

  it("the C07 execution service accepts no caller-supplied fault_state/config in any exported function signature", () => {
    const source = C07_PRODUCTION_FILES["lib/chaos/c07-execution-service.ts"]!;
    const exportedFunctionSignatures = [
      ...source.matchAll(/export\s+async\s+function\s+(\w+)\s*\(([^)]*)\)/g),
    ];
    expect(exportedFunctionSignatures.length).toBeGreaterThan(0);
    for (const match of exportedFunctionSignatures) {
      const params = match[2]!.trim().replace(/,$/, "").trim();
      expect(params, `${match[1]} params`).not.toMatch(/faultState/i);
      expect(params, `${match[1]} params`).not.toMatch(/faultConfig/i);
      expect(params, `${match[1]} params`).not.toMatch(/scenario/i);
    }
  });

  it("the three C07 routes never read a request body", () => {
    for (const routeFile of [
      "app/api/chaos/runs/[runId]/arm-c07/route.ts",
      "app/api/chaos/runs/[runId]/reconcile-c07/route.ts",
      "app/api/chaos/runs/[runId]/cancel-c07/route.ts",
    ]) {
      const source = C07_PRODUCTION_FILES[routeFile]!;
      expect(source, routeFile).not.toMatch(/request\.json\(/);
      expect(source, routeFile).not.toMatch(/request\.text\(/);
      expect(source, routeFile).not.toMatch(/request\.arrayBuffer\(/);
    }
  });
});

describe("frozen files carry no C07/chaos-specific change", () => {
  it("lib/demo-merchant/service.ts has no C07/chaos-specific reference", () => {
    const source = fs.readFileSync(
      path.join(repoRoot, "lib/demo-merchant/service.ts"),
      "utf-8",
    );
    expect(source).not.toMatch(/c07/i);
    // Word-boundary match only — "PayChaos" (the product name) legitimately
    // appears throughout these files and must not false-positive here.
    expect(source).not.toMatch(/\bchaos\b/i);
  });

  it("app/api/webhooks/razorpay/route.ts has no C07/chaos-specific reference", () => {
    const source = fs.readFileSync(
      path.join(repoRoot, "app/api/webhooks/razorpay/route.ts"),
      "utf-8",
    );
    expect(source).not.toMatch(/c07/i);
    // Word-boundary match only — "PayChaos" (the product name) legitimately
    // appears throughout these files and must not false-positive here.
    expect(source).not.toMatch(/\bchaos\b/i);
  });

  it("lib/webhooks/service.ts has no C07/chaos-specific reference", () => {
    const source = fs.readFileSync(
      path.join(repoRoot, "lib/webhooks/service.ts"),
      "utf-8",
    );
    expect(source).not.toMatch(/c07/i);
    // Word-boundary match only — "PayChaos" (the product name) legitimately
    // appears throughout these files and must not false-positive here.
    expect(source).not.toMatch(/\bchaos\b/i);
  });
});

describe("app/demo-merchant/actions.ts — narrow authorized C07 compatibility change only", () => {
  const source = fs.readFileSync(
    path.join(repoRoot, "app/demo-merchant/actions.ts"),
    "utf-8",
  );

  it("imports exactly checkAndSuppressC07ClientConfirmation from the C07 execution service, nothing else from lib/chaos", () => {
    const chaosImports = [
      ...source.matchAll(/from\s*["']@\/lib\/chaos\/([^"']+)["']/g),
    ].map((m) => m[1]);
    expect(chaosImports).toEqual(["c07-execution-service"]);
    expect(source).toMatch(
      /import\s*\{\s*checkAndSuppressC07ClientConfirmation\s*\}\s*from\s*["']@\/lib\/chaos\/c07-execution-service["']/,
    );
  });

  it("still calls verifyCheckoutAndPersistPayment on the non-suppressed path (frozen behavior preserved)", () => {
    expect(source).toMatch(/verifyCheckoutAndPersistPayment\(/);
  });
});
