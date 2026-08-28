import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Phase 3D-D — static safety/provenance guard against the C11-B RUNTIME
 * execution surface (`lib/chaos/c11-execution-service.ts` and
 * `app/api/chaos/runs/[runId]/execute-c11-b/route.ts`). Unlike
 * `tests/unit/supabase/057-chaos-c11-fixture-provenance-guard.test.ts`
 * (which guards a Phase 3D-C TEST-INFRASTRUCTURE integration test file),
 * this guard protects the actual production runtime path C11-B now
 * executes through, so the eight STOP-condition boundaries this task was
 * built under (no migration, no TEST_FIXTURE-at-runtime, no C01 mutation,
 * no processor/browser modification, no fabricated evidence, no arbitrary
 * network input) cannot silently regress in a later round.
 *
 * A plain static text check (no imports of the target modules, no
 * Supabase, no mocks) — runs in the offline unit suite.
 */

const repoRoot = path.resolve(import.meta.dirname, "../../../");
const serviceFile = path.join(
  repoRoot,
  "lib",
  "chaos",
  "c11-execution-service.ts",
);
const routeFile = path.join(
  repoRoot,
  "app",
  "api",
  "chaos",
  "runs",
  "[runId]",
  "execute-c11-b",
  "route.ts",
);

const serviceSource = fs.readFileSync(serviceFile, "utf-8");
const routeSource = fs.readFileSync(routeFile, "utf-8");

/**
 * Strips `//` line comments and `/** ... *\/` block comments, mirroring
 * `057-chaos-c11-fixture-provenance-guard.test.ts`'s helper exactly, so a
 * documentation reference explaining WHY a forbidden pattern must never
 * appear in functional code does not itself trip the guard.
 */
function stripComments(text: string): string {
  const withoutBlockComments = text.replace(/\/\*[\s\S]*?\*\//g, "");
  return withoutBlockComments
    .split("\n")
    .map((line) => {
      const idx = line.indexOf("//");
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join("\n");
}

const functionalServiceSource = stripComments(serviceSource);
const functionalRouteSource = stripComments(routeSource);

describe("lib/chaos/c11-execution-service.ts — required runtime elements present", () => {
  it("declares its own fixed, independent C11_REPLAY_ATTEMPT_COUNT = 1", () => {
    expect(functionalServiceSource).toMatch(
      /export const C11_REPLAY_ATTEMPT_COUNT\s*=\s*1\s*;/,
    );
  });

  it("uses insertReplayProcessingAttempt (the PAYCHAOS_REPLAY mechanics path)", () => {
    expect(functionalServiceSource).toMatch(/insertReplayProcessingAttempt/);
  });

  it("uses the real, unmodified processMerchantWebhookEvent", () => {
    expect(functionalServiceSource).toMatch(/processMerchantWebhookEvent/);
  });

  it("documents/produces PAYCHAOS_REPLAY provenance somewhere in the module", () => {
    expect(serviceSource).toMatch(/PAYCHAOS_REPLAY/);
  });
});

describe("lib/chaos/c11-execution-service.ts — forbidden runtime elements absent (functional code)", () => {
  it("never loads TEST_FIXTURE content or the Phase 3D-C JSON fixture path at runtime", () => {
    expect(functionalServiceSource).not.toMatch(/TEST_FIXTURE/);
    expect(functionalServiceSource).not.toMatch(
      /payment-failed-test-mode\.fixture\.json/,
    );
    expect(functionalServiceSource).not.toMatch(
      /loadC11TestFixtureFailureEvidence/,
    );
  });

  it("never inserts/updates webhook_events, and never calls record_webhook_duplicate_delivery", () => {
    expect(functionalServiceSource).not.toMatch(
      /\.from\(\s*["']webhook_events["']\s*\)/,
    );
    expect(functionalServiceSource).not.toMatch(
      /record_webhook_duplicate_delivery/,
    );
  });

  it("never calls the Razorpay API client or makes an arbitrary network/HTTP call — column reads like razorpay_payment_status are legitimate, only an actual SDK/client usage is forbidden", () => {
    expect(functionalServiceSource).not.toMatch(
      /require\(\s*["']razorpay["']\s*\)/i,
    );
    expect(functionalServiceSource).not.toMatch(/from\s*["']razorpay["']/i);
    expect(functionalServiceSource).not.toMatch(/new\s+Razorpay\s*\(/);
    expect(functionalServiceSource).not.toMatch(/fetch\(/);
    expect(functionalServiceSource).not.toMatch(/axios/);
    expect(functionalServiceSource).not.toMatch(/https?\.request\(/);
  });

  it("never accepts an arbitrary target URL/host/endpoint as input", () => {
    for (const forbidden of [
      "targetUrl",
      "targetHost",
      "endpoint",
      "url:",
      "host:",
    ]) {
      expect(functionalServiceSource).not.toContain(forbidden);
    }
  });

  it("never imports or reuses C01_REPLAY_ATTEMPT_COUNT", () => {
    expect(functionalServiceSource).not.toMatch(/C01_REPLAY_ATTEMPT_COUNT/);
  });

  it("never accepts a caller-supplied replay count — executeC11RealWebhookReplay takes exactly one parameter, chaosRunId: string", () => {
    const signatureMatch = serviceSource.match(
      /export async function executeC11RealWebhookReplay\(([\s\S]*?)\)/,
    );
    expect(signatureMatch).not.toBeNull();
    expect(signatureMatch![1]!.trim().replace(/,$/, "")).toBe(
      "chaosRunId: string",
    );
    expect(functionalServiceSource).not.toMatch(/replayCount/);
    expect(functionalServiceSource).not.toMatch(/attemptCount\s*:\s*number/);
  });

  it("never accepts a caller-supplied RECORDED_TEST_EVIDENCE / data_classification override parameter — RECORDED_TEST_EVIDENCE only appears as a read-only equality check or a type-narrowing literal against the already-persisted run row, never as a write value or a default parameter", () => {
    const occurrences = [
      ...functionalServiceSource.matchAll(/RECORDED_TEST_EVIDENCE/g),
    ];
    expect(occurrences.length).toBeGreaterThan(0);
    for (const line of functionalServiceSource
      .split("\n")
      .filter((l) => l.includes("RECORDED_TEST_EVIDENCE"))) {
      const isRuntimeEqualityCheck =
        /===\s*["']RECORDED_TEST_EVIDENCE["']/.test(line);
      // A TypeScript type-narrowing literal, e.g.
      // `data_classification: "RECORDED_TEST_EVIDENCE";` inside a type
      // intersection — never a value assignment (no leading `=` before the
      // colon, and never inside an `.insert(`/object-literal write).
      const isTypeNarrowingLiteral =
        /^\s*data_classification:\s*["']RECORDED_TEST_EVIDENCE["'];?\s*$/.test(
          line,
        );
      expect(isRuntimeEqualityCheck || isTypeNarrowingLiteral).toBe(true);
      expect(line).not.toMatch(/dataClassification\s*[:=]/);
    }
  });

  it("never imports verifyCheckoutAction or verifyCheckoutAndPersistPayment — C11-B does not depend on browser Checkout", () => {
    expect(functionalServiceSource).not.toMatch(/verifyCheckoutAction/);
    expect(functionalServiceSource).not.toMatch(
      /verifyCheckoutAndPersistPayment/,
    );
  });

  it("never imports or calls the C01 replay service", () => {
    expect(functionalServiceSource).not.toMatch(
      /from\s*["']@\/lib\/chaos\/replay-service["']/,
    );
    expect(functionalServiceSource).not.toMatch(/\bexecuteC01Replay\b/);
  });
});

describe("app/api/chaos/runs/[runId]/execute-c11-b/route.ts — forbidden runtime elements absent (functional code)", () => {
  it("never loads TEST_FIXTURE content or the Phase 3D-C JSON fixture path", () => {
    expect(functionalRouteSource).not.toMatch(/TEST_FIXTURE/);
    expect(functionalRouteSource).not.toMatch(
      /payment-failed-test-mode\.fixture\.json/,
    );
  });

  it("never inserts/updates webhook_events, and never calls record_webhook_duplicate_delivery", () => {
    expect(functionalRouteSource).not.toMatch(
      /\.from\(\s*["']webhook_events["']\s*\)/,
    );
    expect(functionalRouteSource).not.toMatch(
      /record_webhook_duplicate_delivery/,
    );
  });

  it("never calls the Razorpay API client or makes an arbitrary network/HTTP call", () => {
    expect(functionalRouteSource).not.toMatch(
      /require\(\s*["']razorpay["']\s*\)/i,
    );
    expect(functionalRouteSource).not.toMatch(/from\s*["']razorpay["']/i);
    expect(functionalRouteSource).not.toMatch(/new\s+Razorpay\s*\(/);
    expect(functionalRouteSource).not.toMatch(/fetch\(/);
    expect(functionalRouteSource).not.toMatch(/axios/);
  });

  it("never imports or reuses C01_REPLAY_ATTEMPT_COUNT or the C01 replay route/service", () => {
    expect(functionalRouteSource).not.toMatch(/C01_REPLAY_ATTEMPT_COUNT/);
    expect(functionalRouteSource).not.toMatch(
      /from\s*["']@\/lib\/chaos\/replay-service["']/,
    );
  });
});

describe("frozen C11 TEST_FIXTURE PRECHECK-07 permanence — sanity", () => {
  it("lib/chaos/c11-execution-service.ts is never imported by lib/chaos/repository.ts's TEST_FIXTURE resolver path", () => {
    const repositoryFile = path.join(repoRoot, "lib", "chaos", "repository.ts");
    const repositorySource = fs.readFileSync(repositoryFile, "utf-8");
    expect(repositorySource).not.toMatch(
      /from\s*["']@\/lib\/chaos\/c11-execution-service["']/,
    );
  });
});
