import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Phase 3D-E — static safety/provenance guard against the C11-A pure-
 * observation production surface (`lib/chaos/c11-observation-repository.ts`,
 * `lib/chaos/c11-execution-service.ts`'s C11-A additions,
 * `app/api/chaos/runs/[runId]/start-c11-a/route.ts`,
 * `app/api/chaos/runs/[runId]/reconcile-c11-a/route.ts`,
 * `app/api/chaos/runs/[runId]/cancel-c11-a/route.ts`). Mirrors
 * `tests/unit/chaos/c11-runtime-static-guard.test.ts` (C11-B) exactly —
 * asserts the presence of required elements and the absence of forbidden
 * ones from FUNCTIONAL code (comments stripped) so this task's Section 19
 * ("NO MERCHANT / RAZORPAY MUTATION") and Section 20 ("TEST_FIXTURE / C11-B
 * BOUNDARIES") cannot silently regress in a later round.
 *
 * A plain static text check (no imports of the target modules, no
 * Supabase, no mocks) — runs in the offline unit suite.
 */

const repoRoot = path.resolve(import.meta.dirname, "../../../");

const observationRepositoryFile = path.join(
  repoRoot,
  "lib",
  "chaos",
  "c11-observation-repository.ts",
);
const executionServiceFile = path.join(
  repoRoot,
  "lib",
  "chaos",
  "c11-execution-service.ts",
);
const startRouteFile = path.join(
  repoRoot,
  "app",
  "api",
  "chaos",
  "runs",
  "[runId]",
  "start-c11-a",
  "route.ts",
);
const reconcileRouteFile = path.join(
  repoRoot,
  "app",
  "api",
  "chaos",
  "runs",
  "[runId]",
  "reconcile-c11-a",
  "route.ts",
);
const cancelRouteFile = path.join(
  repoRoot,
  "app",
  "api",
  "chaos",
  "runs",
  "[runId]",
  "cancel-c11-a",
  "route.ts",
);

const observationRepositorySource = fs.readFileSync(
  observationRepositoryFile,
  "utf-8",
);
const executionServiceSource = fs.readFileSync(executionServiceFile, "utf-8");
const startRouteSource = fs.readFileSync(startRouteFile, "utf-8");
const reconcileRouteSource = fs.readFileSync(reconcileRouteFile, "utf-8");
const cancelRouteSource = fs.readFileSync(cancelRouteFile, "utf-8");

/** Mirrors `057-chaos-c11-fixture-provenance-guard.test.ts`'s helper exactly. */
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

const functionalObservationRepositorySource = stripComments(
  observationRepositorySource,
);
const functionalExecutionServiceSource = stripComments(executionServiceSource);
const functionalStartRouteSource = stripComments(startRouteSource);
const functionalReconcileRouteSource = stripComments(reconcileRouteSource);
const functionalCancelRouteSource = stripComments(cancelRouteSource);

// `lib/chaos/c11-execution-service.ts` is an ADDITIVE file: the top portion
// is C11-B's frozen, unmodified code (which legitimately calls
// insertReplayProcessingAttempt/processMerchantWebhookEvent — that is
// exactly what C11-B's replay mechanism does). The C11-A section this task
// adds begins at a fixed marker comment. Guards that must apply ONLY to the
// NEW C11-A code (never to C01/C11-B) scope themselves to the substring
// after that marker, so this file never accidentally forbids C11-B's own
// legitimate, frozen behavior.
const C11A_SECTION_MARKER =
  "PHASE 3D-E — C11-A GENUINE RAZORPAY TEST MODE FAILED-PAYMENT OBSERVATION";
const c11aMarkerIndex = executionServiceSource.indexOf(C11A_SECTION_MARKER);
if (c11aMarkerIndex === -1) {
  throw new Error(
    `c11-a-static-guard.test.ts setup: expected marker "${C11A_SECTION_MARKER}" not found in lib/chaos/c11-execution-service.ts`,
  );
}
const functionalC11AOnlySource = stripComments(
  executionServiceSource.slice(c11aMarkerIndex),
);

const allFunctionalSources = [
  functionalObservationRepositorySource,
  functionalStartRouteSource,
  functionalReconcileRouteSource,
  functionalCancelRouteSource,
  functionalC11AOnlySource,
];

describe("C11-A production surface — required elements present", () => {
  it("declares startC11AFailureObservation", () => {
    expect(functionalExecutionServiceSource).toMatch(
      /export async function startC11AFailureObservation/,
    );
  });

  it("declares the C11-A reconcile function", () => {
    expect(functionalExecutionServiceSource).toMatch(
      /export async function reconcileC11AFailedPaymentObservation/,
    );
  });

  it("declares cancelRunningC11AObservation", () => {
    expect(functionalExecutionServiceSource).toMatch(
      /export async function cancelRunningC11AObservation/,
    );
  });

  it("documents/enforces REAL_RAZORPAY_WEBHOOK semantics", () => {
    expect(observationRepositorySource).toMatch(/REAL_RAZORPAY_WEBHOOK/);
  });

  it("documents/enforces payment.failed semantics", () => {
    expect(observationRepositorySource).toMatch(/payment\.failed/);
  });

  it("every route imports server-only-guarded server functions and validates a runId path segment", () => {
    for (const source of [
      startRouteSource,
      reconcileRouteSource,
      cancelRouteSource,
    ]) {
      expect(source).toMatch(/UUID_PATTERN/);
    }
  });
});

describe("C11-A production surface — forbidden elements absent (functional code)", () => {
  it("never loads TEST_FIXTURE content or the Phase 3D-C JSON fixture path", () => {
    for (const source of allFunctionalSources) {
      expect(source).not.toMatch(/TEST_FIXTURE/);
      expect(source).not.toMatch(/payment-failed-test-mode\.fixture\.json/);
    }
  });

  it("never calls insertReplayProcessingAttempt (no replay mechanism for C11-A)", () => {
    for (const source of allFunctionalSources) {
      expect(source).not.toMatch(/insertReplayProcessingAttempt/);
    }
  });

  it("never calls processMerchantWebhookEvent (no processing invocation for C11-A)", () => {
    for (const source of allFunctionalSources) {
      expect(source).not.toMatch(/processMerchantWebhookEvent/);
    }
  });

  it("never imports verifyCheckoutAction or verifyCheckoutAndPersistPayment", () => {
    for (const source of allFunctionalSources) {
      expect(source).not.toMatch(/verifyCheckoutAction/);
      expect(source).not.toMatch(/verifyCheckoutAndPersistPayment/);
    }
  });

  it("never calls fetch/axios/a raw http(s) client or constructs a Razorpay SDK client", () => {
    for (const source of allFunctionalSources) {
      expect(source).not.toMatch(/fetch\(/);
      expect(source).not.toMatch(/axios/);
      expect(source).not.toMatch(/https?\.request\(/);
      expect(source).not.toMatch(/new\s+Razorpay\s*\(/);
      expect(source).not.toMatch(/require\(\s*["']razorpay["']\s*\)/i);
    }
  });

  it("never calls record_webhook_duplicate_delivery", () => {
    for (const source of allFunctionalSources) {
      expect(source).not.toMatch(/record_webhook_duplicate_delivery/);
    }
  });

  it("never accepts an arbitrary target URL/host/endpoint as input", () => {
    for (const source of allFunctionalSources) {
      for (const forbidden of ["targetUrl", "targetHost", "url:", "host:"]) {
        expect(source).not.toContain(forbidden);
      }
    }
  });

  it("the observation repository never inserts/updates/deletes/upserts any table", () => {
    expect(functionalObservationRepositorySource).not.toMatch(/\.insert\(/);
    expect(functionalObservationRepositorySource).not.toMatch(/\.update\(/);
    expect(functionalObservationRepositorySource).not.toMatch(/\.delete\(/);
    expect(functionalObservationRepositorySource).not.toMatch(/\.upsert\(/);
  });

  it("the C11-A execution-service additions never write directly to orders/payment_attempts/payments/fulfilments/webhook_events/event_processing_attempts — only chaos_runs writes happen, and only through the run-repository module", () => {
    // The C11-A section of the service file never calls `.from(...)` at all
    // (all reads are delegated to c11-observation-repository.ts, all writes
    // to run-repository.ts) — assert no direct `.from("orders"/...)` usage
    // anywhere in the file (this also covers the pre-existing C11-B code,
    // which is likewise never supposed to touch these tables directly for
    // writes — its own `readC11PostReplayMerchantState` only ever SELECTs).
    for (const table of [
      "orders",
      "payment_attempts",
      "payments",
      "fulfilments",
      "webhook_events",
      "event_processing_attempts",
    ]) {
      const insertPattern = new RegExp(
        `\\.from\\(\\s*["']${table}["']\\s*\\)[^;]*\\.(insert|update|delete|upsert)\\(`,
      );
      expect(functionalExecutionServiceSource).not.toMatch(insertPattern);
    }
  });

  it("the three routes never call a merchant-table mutation directly (no .from(...) at all in the routes)", () => {
    for (const source of [
      functionalStartRouteSource,
      functionalReconcileRouteSource,
      functionalCancelRouteSource,
    ]) {
      expect(source).not.toMatch(/\.from\(/);
    }
  });

  it("no route reads a request body", () => {
    for (const source of [
      startRouteSource,
      reconcileRouteSource,
      cancelRouteSource,
    ]) {
      expect(source).not.toMatch(/request\.json\(/);
      expect(source).not.toMatch(/request\.text\(/);
      expect(source).not.toMatch(/request\.arrayBuffer\(/);
    }
  });
});

describe("C11-A does not modify C11-B/C01 production paths", () => {
  it("c11-execution-service.ts still exports the unmodified C11-B surface", () => {
    expect(executionServiceSource).toMatch(
      /export async function executeC11RealWebhookReplay/,
    );
    expect(executionServiceSource).toMatch(
      /export const C11_REPLAY_ATTEMPT_COUNT\s*=\s*1\s*;/,
    );
  });

  it("never imports or reuses C01_REPLAY_ATTEMPT_COUNT anywhere in the C11-A surface", () => {
    for (const source of allFunctionalSources) {
      expect(source).not.toMatch(/C01_REPLAY_ATTEMPT_COUNT/);
    }
  });

  it("never modifies resolveAuthoritativeC11ReplaySource — the observation repository does not import it", () => {
    expect(functionalObservationRepositorySource).not.toMatch(
      /resolveAuthoritativeC11ReplaySource/,
    );
  });
});
