import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ReliabilityOverview } from "@/components/reliability/reliability-overview";

import type { ReliabilityScoreReadModel } from "@/lib/reliability/service";

/**
 * Phase 4F-R3 — what the Reliability page actually SHOWS.
 *
 * Rendered with `react-dom/server`, which the project already depends on — no
 * new testing framework is introduced for this. The assertions are about
 * semantic content, never CSS: the point is that an operator or a judge can
 * read the score, the four scenarios, every deduction and the reason for each,
 * and cannot be misled about provenance.
 *
 * The fixture is FIXED rather than live, so the visual contract stays proven
 * even when the database legitimately changes. P4-AC-12 is a semantic
 * guarantee, not a particular row in Supabase.
 */

const MODEL: ReliabilityScoreReadModel = {
  score: {
    algorithmVersion: "RELIABILITY-V1",
    selectionVersion: "LATEST_SELECTION_V1",
    score: 85,
    totalDeduction: 15,
    scenarioBreakdown: [
      {
        scenarioId: "C01",
        state: "UNKNOWN",
        deduction: 15,
        requiredDataClassification: "RECORDED_TEST_EVIDENCE",
        eligibleCandidateCount: 1,
        selectedRunId: "40a08f61-11dd-48c1-9460-238166150283",
        selectedDataClassification: "RECORDED_TEST_EVIDENCE",
        selectedRunStatus: "COMPLETED",
        selectedRunOutcome: "UNKNOWN",
        selectedRunCreatedAt: "2026-08-26T17:10:34.481872+00:00",
        selectedRunCompletedAt: "2026-08-26T17:17:36.663+00:00",
        supportingFailedInvariantResultId: null,
        supportingInvariantId: null,
        supportingSeverity: null,
        provenanceLabel: "Recorded test evidence",
      },
      {
        scenarioId: "C03",
        state: "PASS",
        deduction: 0,
        requiredDataClassification: "SYNTHETIC_DEMO",
        eligibleCandidateCount: 9,
        selectedRunId: "839984d8-f421-4b13-9f08-917bb417df43",
        selectedDataClassification: "SYNTHETIC_DEMO",
        selectedRunStatus: "COMPLETED",
        selectedRunOutcome: "PASS",
        selectedRunCreatedAt: "2026-09-01T02:51:18.832584+00:00",
        selectedRunCompletedAt: "2026-09-01T02:51:20.673+00:00",
        supportingFailedInvariantResultId: null,
        supportingInvariantId: null,
        supportingSeverity: null,
        provenanceLabel: "Controlled PayChaos security simulation",
      },
      {
        scenarioId: "C07",
        state: "PASS",
        deduction: 0,
        requiredDataClassification: "RECORDED_TEST_EVIDENCE",
        eligibleCandidateCount: 3,
        selectedRunId: "853762e4-3e1f-498f-978b-1baf1ad49ae1",
        selectedDataClassification: "RECORDED_TEST_EVIDENCE",
        selectedRunStatus: "COMPLETED",
        selectedRunOutcome: "PASS",
        selectedRunCreatedAt: "2026-08-31T19:44:47.37496+00:00",
        selectedRunCompletedAt: "2026-08-31T19:52:31.324+00:00",
        supportingFailedInvariantResultId: null,
        supportingInvariantId: null,
        supportingSeverity: null,
        provenanceLabel: "Recorded test evidence",
      },
      {
        scenarioId: "C11",
        state: "PASS",
        deduction: 0,
        requiredDataClassification: "RECORDED_TEST_EVIDENCE",
        eligibleCandidateCount: 4,
        selectedRunId: "d97e3fc6-e0f1-48f5-a613-95f87989101c",
        selectedDataClassification: "RECORDED_TEST_EVIDENCE",
        selectedRunStatus: "COMPLETED",
        selectedRunOutcome: "PASS",
        selectedRunCreatedAt: "2026-09-01T03:42:54.052766+00:00",
        selectedRunCompletedAt: "2026-09-01T03:49:43.112+00:00",
        supportingFailedInvariantResultId: null,
        supportingInvariantId: null,
        supportingSeverity: null,
        provenanceLabel: "Recorded test evidence",
      },
    ],
  },
  selectionDiagnostics: [
    {
      scenarioId: "C01",
      totalCandidateCount: 1,
      eligibleCandidateCount: 1,
      ineligibleCandidateCount: 0,
      selectionReason: "LATEST_ELIGIBLE_RUN",
    },
    {
      scenarioId: "C03",
      totalCandidateCount: 9,
      eligibleCandidateCount: 9,
      ineligibleCandidateCount: 0,
      selectionReason: "LATEST_ELIGIBLE_RUN",
    },
    {
      scenarioId: "C07",
      totalCandidateCount: 4,
      eligibleCandidateCount: 3,
      ineligibleCandidateCount: 1,
      selectionReason: "LATEST_ELIGIBLE_RUN",
    },
    {
      scenarioId: "C11",
      totalCandidateCount: 5,
      eligibleCandidateCount: 4,
      ineligibleCandidateCount: 1,
      selectionReason: "LATEST_ELIGIBLE_RUN",
    },
  ],
};

/** Markup with tags stripped, so assertions read the visible text. */
function visibleText(model: ReliabilityScoreReadModel): string {
  return renderToStaticMarkup(<ReliabilityOverview model={model} />)
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&#x2014;/g, "—")
    .replace(/\s+/g, " ");
}

const TEXT = visibleText(MODEL);
const MARKUP = renderToStaticMarkup(<ReliabilityOverview model={MODEL} />);

describe("Reliability overview — the score is visible", () => {
  it("1: the score and total deduction are shown", () => {
    expect(TEXT).toContain("Reliability Score");
    expect(TEXT).toContain("85 / 100");
    expect(TEXT).toContain("Total deduction: 15");
  });

  it("2: the frozen algorithm and selection versions are shown", () => {
    expect(TEXT).toContain("RELIABILITY-V1");
    expect(TEXT).toContain("LATEST_SELECTION_V1");
  });

  it("3: all four mandatory scenarios appear, in frozen order", () => {
    const order = ["C01", "C03", "C07", "C11"].map((id) =>
      MARKUP.indexOf(`reliability-row-${id}`),
    );
    expect(order.every((index) => index > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});

describe("Reliability overview — every deduction is explained", () => {
  it("4: each scenario shows its state and its deduction", () => {
    for (const [id, state, deduction] of [
      ["C01", "UNKNOWN", 15],
      ["C03", "PASS", 0],
      ["C07", "PASS", 0],
      ["C11", "PASS", 0],
    ] as const) {
      expect(MARKUP, id).toContain(`reliability-state-${id}`);
      expect(MARKUP, id).toContain(`reliability-deduction-${id}`);
      expect(TEXT, id).toContain(state);
      expect(TEXT, `${id} deduction`).toContain(`Deduction: ${deduction}`);
    }
  });

  it("5: P4-AC-12 — UNKNOWN is visibly NOT a pass", () => {
    // The single most important sentence on this page: an inconclusive result
    // must never read as a clean bill of health.
    expect(TEXT).toContain("Inconclusive evidence — not counted as PASS");
    expect(TEXT).toContain("15-point deduction");
  });

  it("6: nothing is described as healthy, safe, certified or production ready", () => {
    for (const forbidden of [
      "healthy",
      "Healthy",
      "safe",
      "Safe",
      "production ready",
      "Production Ready",
      "certified",
      "Certified",
      "approved by Razorpay",
    ]) {
      expect(TEXT, forbidden).not.toContain(forbidden);
    }
  });

  it("7: selected runs are shown and link to the existing run detail route", () => {
    for (const [id, runId] of [
      ["C01", "40a08f61-11dd-48c1-9460-238166150283"],
      ["C03", "839984d8-f421-4b13-9f08-917bb417df43"],
      ["C07", "853762e4-3e1f-498f-978b-1baf1ad49ae1"],
      ["C11", "d97e3fc6-e0f1-48f5-a613-95f87989101c"],
    ] as const) {
      expect(TEXT, id).toContain(runId);
      expect(MARKUP, id).toContain(`/chaos/runs/${runId}`);
    }
  });

  it("8: P4-AC-11 — candidate diagnostics explain the selection", () => {
    expect(TEXT).toContain("9 total, 9 eligible, 0 ineligible");
    expect(TEXT).toContain("4 total, 3 eligible, 1 ineligible");
    expect(TEXT).toContain("Latest eligible run selected.");
  });
});

describe("Reliability overview — provenance is truthful", () => {
  it("9: C03 is a controlled simulation, classified SYNTHETIC_DEMO", () => {
    expect(TEXT).toContain("Controlled PayChaos security simulation");
    expect(MARKUP).toContain("reliability-classification-C03");
    expect(TEXT).toContain("SYNTHETIC_DEMO");
  });

  it("10: C03 is never presented as genuine Razorpay evidence", () => {
    for (const forbidden of [
      "Real Razorpay Event",
      "real webhook delivery",
      "recorded provider evidence",
      "Verified by Razorpay",
      "Razorpay certified",
    ]) {
      expect(TEXT, forbidden).not.toContain(forbidden);
    }
  });

  it("11: C01/C07/C11 are shown as recorded test evidence", () => {
    expect(TEXT).toContain("Recorded test evidence");
    expect(TEXT).toContain("RECORDED_TEST_EVIDENCE");
  });
});

describe("Reliability overview — no Phase 4G readiness", () => {
  it("12: no readiness verdict is rendered", () => {
    for (const forbidden of [
      "NOT READY",
      "NOT_READY",
      "NEEDS ATTENTION",
      "NEEDS_ATTENTION",
      "Go-Live Readiness:",
      "readiness score",
    ]) {
      expect(TEXT, forbidden).not.toContain(forbidden);
    }
    // A neutral pointer is allowed; a verdict is not.
    expect(TEXT).toContain("Go-Live Readiness is evaluated separately.");
  });
});

describe("Reliability overview — other states render honestly", () => {
  function withScenario(
    overrides: Partial<
      ReliabilityScoreReadModel["score"]["scenarioBreakdown"][number]
    >,
    diagnostics?: Partial<
      ReliabilityScoreReadModel["selectionDiagnostics"][number]
    >,
  ): ReliabilityScoreReadModel {
    return {
      score: {
        ...MODEL.score,
        scenarioBreakdown: [
          { ...MODEL.score.scenarioBreakdown[0]!, ...overrides },
          ...MODEL.score.scenarioBreakdown.slice(1),
        ],
      },
      selectionDiagnostics: [
        { ...MODEL.selectionDiagnostics[0]!, ...diagnostics },
        ...MODEL.selectionDiagnostics.slice(1),
      ],
    };
  }

  it("13: a FAIL names its supporting invariant and severity", () => {
    const text = visibleText(
      withScenario({
        state: "FAIL",
        deduction: 25,
        supportingFailedInvariantResultId: "res-abc",
        supportingInvariantId: "INV-011",
        supportingSeverity: "CRITICAL",
      }),
    );

    expect(text).toContain("Failed invariant evidence caused this deduction.");
    expect(text).toContain("INV-011");
    expect(text).toContain("CRITICAL");
    expect(text).toContain("res-abc");
    expect(text).toContain("Deduction: 25");
  });

  it("14: NOT_RUN says no eligible run was selected, and still deducts", () => {
    const text = visibleText(
      withScenario(
        {
          state: "NOT_RUN",
          deduction: 15,
          selectedRunId: null,
          selectedDataClassification: null,
          selectedRunStatus: null,
          selectedRunOutcome: null,
          provenanceLabel: null,
          eligibleCandidateCount: 0,
        },
        {
          totalCandidateCount: 0,
          eligibleCandidateCount: 0,
          ineligibleCandidateCount: 0,
          selectionReason: "NO_CANDIDATES",
        },
      ),
    );

    expect(text).toContain("No eligible selected run.");
    expect(text).toContain(
      "No eligible completed evidence is currently selected. 15-point deduction.",
    );
    expect(text).toContain("No run of this scenario exists yet.");
  });

  it("15: NO_ELIGIBLE_CANDIDATES reads differently from NO_CANDIDATES", () => {
    // The distinction that makes a NOT_RUN explainable rather than mysterious.
    const text = visibleText(
      withScenario(
        {
          state: "NOT_RUN",
          deduction: 15,
          selectedRunId: null,
          selectedDataClassification: null,
          selectedRunStatus: null,
          selectedRunOutcome: null,
          provenanceLabel: null,
          eligibleCandidateCount: 0,
        },
        {
          totalCandidateCount: 3,
          eligibleCandidateCount: 0,
          ineligibleCandidateCount: 3,
          selectionReason: "NO_ELIGIBLE_CANDIDATES",
        },
      ),
    );

    expect(text).toContain("3 total, 0 eligible, 3 ineligible");
    expect(text).toContain(
      "Runs exist, but none met this scenario's evidence requirements.",
    );
  });

  it("16: BLOCKED and ERROR each state their own 15-point deduction", () => {
    expect(visibleText(withScenario({ state: "BLOCKED" }))).toContain(
      "Required test could not complete. 15-point deduction.",
    );
    expect(visibleText(withScenario({ state: "ERROR" }))).toContain(
      "Technical or inconsistent test result. 15-point deduction.",
    );
  });
});
