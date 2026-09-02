import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The control is a client component; `renderToStaticMarkup` provides no app
// router context, so the navigation hooks are stubbed. Nothing about the
// component's own behaviour is replaced.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, replace: () => {}, push: () => {} }),
  usePathname: () => "/",
}));

import { FindingCasefilePanel } from "@/components/findings/finding-casefile";

import type {
  FindingCasefile,
  RegressionComparison,
} from "@/lib/findings/casefile-read";

/**
 * Phase 5 correction — the regression control (P4-AC-06).
 *
 * The control is an ADAPTER to the frozen Phase 4E lifecycle, so these tests
 * are about truthfulness rather than plumbing: that a verdict is only ever
 * shown when it was persisted, that no lifecycle state is quietly upgraded
 * into a pass, and that the component itself decides nothing.
 *
 * Rendered with `react-dom/server`, matching the other component tests. The
 * click-path behaviour (double submit, API errors) is proven against the
 * module source and in Playwright, since no DOM test runner is installed and
 * this correction must not add one.
 */

/**
 * The component's own source, read from disk.
 *
 * Source-level assertions use the file rather than `Function.prototype
 * .toString()` because the latter returns transpiled output, which would let
 * a real change slip past a check that only ever saw generated code.
 */
const ACTION_SOURCE = readFileSync(
  join(process.cwd(), "components", "findings", "regression-action.tsx"),
  "utf8",
);

/**
 * The same source with comments stripped.
 *
 * Documentation that NAMES a banned construct in order to say it is absent
 * must not be able to fail a check, and equally must not be able to satisfy
 * one. Behavioural assertions run against this.
 */
const ACTION_CODE = ACTION_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "")
  .split(String.fromCharCode(10))
  .filter((line) => !line.trimStart().startsWith("//"))
  .join(String.fromCharCode(10));

function casefile(overrides: Partial<FindingCasefile> = {}): FindingCasefile {
  return {
    findingId: "11111111-1111-4111-8111-111111111111",
    status: "OPEN",
    resolvedAt: null,
    diagnosis: {
      code: "RC-004",
      strength: "STRONG_EVIDENCE",
      summary: "A duplicate processing path executed the effect twice.",
      diagnosedAt: "2026-09-01T00:00:00.000Z",
    },
    recommendation: {
      code: "FIX-002",
      text: "Enforce event-id idempotency before the business effect.",
    },
    regressionRuns: [],
    ...overrides,
  } as FindingCasefile;
}

function run(status: string, id = "reg-1") {
  return {
    id,
    findingId: "11111111-1111-4111-8111-111111111111",
    chaosRunId: "run-2",
    status,
    startedAt: null,
    completedAt: null,
    createdAt: "2026-09-01T00:00:00.000Z",
  };
}

const COMPARISON: RegressionComparison = {
  regressionRunId: "reg-1",
  status: "RESOLVED",
  before: {
    invariantResultId: "res-1",
    invariantId: "INV-002",
    result: "FAIL",
    severity: "CRITICAL",
    reason: "The protected effect executed twice.",
    evaluatedAt: "2026-08-01T00:00:00.000Z",
  },
  after: [
    {
      invariantResultId: "res-9",
      invariantId: "INV-002",
      result: "PASS",
      severity: "CRITICAL",
      reason: "The protected effect executed once.",
      evaluatedAt: "2026-09-01T00:00:00.000Z",
    },
  ],
} as RegressionComparison;

function renderPanel(
  file: FindingCasefile,
  comparison: RegressionComparison | null = null,
): string {
  return renderToStaticMarkup(
    <FindingCasefilePanel casefile={file} comparison={comparison} />,
  );
}

describe("regression control — it exists and is startable (P4-AC-06)", () => {
  it("1: an eligible finding shows Run Regression Test", () => {
    const html = renderPanel(casefile());

    expect(html).toContain("Run Regression Test");
    expect(html).toContain('data-testid="regression-start"');
  });

  it("2: it posts to the existing Phase 4E routes and nothing else", () => {
    expect(ACTION_SOURCE).toContain("/api/findings/");
    expect(ACTION_SOURCE).toContain("/regressions");
    expect(ACTION_SOURCE).toContain("/advance");
    // Only the internal finding id is sent; the server derives the scenario.
    expect(ACTION_SOURCE).not.toContain("scenarioId");
    expect(ACTION_SOURCE).not.toContain("chaosRunId");
    expect(ACTION_SOURCE).not.toContain("orderId");
  });

  it("3: double submit is prevented by both a disabled state and a guard", () => {
    expect(ACTION_CODE).toContain("inFlight");
    expect(ACTION_CODE).toContain("if (inFlight.current) return");
    expect(ACTION_CODE).toContain("disabled={isBusy}");
  });

  it("4: a non-ok response is rendered as failure, never as success", () => {
    // The failure branch sets `failed` and returns BEFORE the success path,
    // so no refresh and no success styling can follow a rejected request.
    expect(ACTION_SOURCE).toContain("if (!response.ok)");
    expect(ACTION_SOURCE).toContain("setFailed(true)");
    const failureBranch = ACTION_SOURCE.slice(
      ACTION_SOURCE.indexOf("if (!response.ok)"),
      ACTION_SOURCE.indexOf("router.refresh()"),
    );
    expect(failureBranch).toContain("return");
  });

  it("5: an active regression offers advance, never a second start", () => {
    const html = renderPanel(
      casefile({ regressionRuns: [run("RUNNING")] as never }),
    );

    expect(html).toContain('data-testid="regression-advance"');
    expect(html).not.toContain('data-testid="regression-start"');
    expect(html).toContain("rather than starting a second one");
  });
});

describe("regression control — every lifecycle state renders honestly", () => {
  it("6: PENDING does not look completed", () => {
    const html = renderPanel(
      casefile({ regressionRuns: [run("PENDING")] as never }),
    );

    expect(html).toContain("Pending");
    expect(html).not.toContain("Fix verified");
  });

  it("7: RUNNING does not look completed", () => {
    const html = renderPanel(
      casefile({ regressionRuns: [run("RUNNING")] as never }),
    );

    expect(html).toContain("Running");
    expect(html).not.toContain("Fix verified");
  });

  it("8: RESOLVED alone renders FIX VERIFIED", () => {
    const html = renderPanel(
      casefile({ regressionRuns: [run("RESOLVED")] as never }),
    );

    expect(html).toContain("Fix verified");
  });

  it("9: STILL_FAILING never renders FIX VERIFIED", () => {
    const html = renderPanel(
      casefile({ regressionRuns: [run("STILL_FAILING")] as never }),
    );

    expect(html).toContain("Still failing");
    expect(html).not.toContain("Fix verified");
  });

  it("10: ERROR never renders FIX VERIFIED", () => {
    const html = renderPanel(
      casefile({ regressionRuns: [run("ERROR")] as never }),
    );

    expect(html).toContain("Error");
    expect(html).not.toContain("Fix verified");
  });

  it("11: the original FAIL stays visible beside the new evidence", () => {
    const html = renderPanel(
      casefile({ regressionRuns: [run("RESOLVED")] as never }),
      COMPARISON,
    );

    // Re-pointed in the Phase 5 UI pass: the panel label changed from
    // "Before — original failure" to "Before fix" + a HISTORICAL provenance
    // tag. Targeting the testid is stricter than matching prose, and the
    // property is unchanged — the original FAIL is still its own panel.
    expect(html).toContain('data-testid="regression-before"');
    expect(html).toContain("Before fix");
    expect(html).toContain("Historical");
    expect(html).toContain("FAIL");
    expect(html).toContain("The protected effect executed twice.");
  });

  it("12: the new PASS is shown separately, not merged over the failure", () => {
    const html = renderPanel(
      casefile({ regressionRuns: [run("RESOLVED")] as never }),
      COMPARISON,
    );

    expect(html).toContain('data-testid="regression-after"');
    expect(html).toContain("After fix — regression run");
    expect(html).toContain("The protected effect executed once.");
    expect(html).toContain(
      "The original failure is preserved. A regression adds new evidence",
    );
  });

  it("13: an external/manual action is never converted into completion", () => {
    // The multi-step case: C07 and C11-A genuinely require a real Test Mode
    // action, and the UI must say so rather than claim a verdict.
    expect(ACTION_SOURCE).toContain("AWAITING_EXTERNAL_ACTION");
    const message = ACTION_SOURCE.slice(
      ACTION_SOURCE.indexOf("AWAITING_EXTERNAL_ACTION"),
    );
    expect(message).toContain("waiting for the required");
    expect(message).toContain("NOT complete");
    // The component never renders a verdict of its own. Checked against
    // comment-stripped code, because the doc block legitimately mentions
    // RESOLVED in order to say this component does not render it.
    expect(ACTION_CODE).not.toContain("RESOLVED");
    expect(ACTION_CODE).not.toContain("FIX VERIFIED");
    expect(ACTION_CODE).not.toContain("Fix verified");
  });
});

describe("regression control — it decides nothing", () => {
  it("14: no payment, invariant, reliability or readiness logic is present", () => {
    for (const forbidden of [
      "calculateReliabilityScoreV1",
      "evaluateGoLiveReadinessV1",
      "evaluateInvariant",
      "evaluateChaosRun",
      "startRegression",
      "advanceRegression",
      "completeRegression",
      "getSupabaseServerClient",
      ".from(",
      "insert",
      "update",
      "delete",
      // No invented certainty and no client-side verdict.
      "confidence",
      "probability",
    ]) {
      expect(ACTION_CODE, forbidden).not.toContain(forbidden);
    }
  });

  it("15: state is re-read from the server, never patched locally", () => {
    // The persisted status is authoritative, so the component refreshes the
    // server-derived casefile instead of writing the response into its own
    // view of the finding.
    expect(ACTION_SOURCE).toContain("router.refresh()");
    expect(ACTION_SOURCE).not.toContain("setCasefile");
    expect(ACTION_SOURCE).not.toContain("setRegressionRuns");
  });
});
