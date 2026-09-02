import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildExplanation,
  buildRegressionGuidance,
} from "@/lib/diagnosis/explanation-templates";
import {
  MIN_ROWS_FOR_CORRELATION,
  correlateFindings,
} from "@/lib/findings/grouping";

import type { EvidenceStrength } from "@/lib/diagnosis/explanation-templates";
import type { GroupableFinding } from "@/lib/findings/grouping";

/**
 * Phase 4H-1 / 4H-2 / 4H-3 — the deterministic P1 differentiators.
 *
 * Phase 4H ships NO model. These modules are the whole of its "intelligence",
 * so the tests are about the two properties that make that honest: the output
 * is a pure function of persisted evidence, and it never asserts more than the
 * evidence supports.
 */

/** Documentation naming a banned construct must never fail a code check. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(String.fromCharCode(10))
    .filter((line) => !line.trimStart().startsWith("//"))
    .join(String.fromCharCode(10));
}

const BASE = {
  diagnosisCode: "RC-001",
  strength: "STRONG_EVIDENCE" as EvidenceStrength,
  diagnosisSummary: "A duplicate processing path executed the effect twice.",
  invariantId: "INV-002",
  scenarioId: "C01",
  recommendationCode: "FIX-EVENT-IDEMPOTENCY",
};

describe("4H-1 explanation templates — deterministic and bounded", () => {
  it("1: identical input always produces identical output", () => {
    expect(buildExplanation(BASE)).toEqual(buildExplanation(BASE));
  });

  it("2: the impact statement comes from the invariant that failed", () => {
    const explanation = buildExplanation(BASE);

    expect(explanation.impactStatement).toContain("more than one fulfilment");
    expect(explanation.impactStatement).toContain("C01");
  });

  it("3: an unmapped invariant states a fact rather than inventing one", () => {
    const explanation = buildExplanation({ ...BASE, invariantId: "INV-999" });

    expect(explanation.impactStatement).toContain("INV-999");
    expect(explanation.impactStatement).toContain("did not hold");
  });

  it("4: a null scenario adds no scenario claim", () => {
    const explanation = buildExplanation({ ...BASE, scenarioId: null });
    expect(explanation.impactStatement).not.toContain("scenario");
  });

  it("5: INSUFFICIENT_EVIDENCE says so plainly", () => {
    const explanation = buildExplanation({
      ...BASE,
      strength: "INSUFFICIENT_EVIDENCE",
    });

    expect(explanation.confidenceStatement).toContain("not sufficient");
    expect(explanation.confidenceStatement).toContain(
      "reporting that gap rather than guessing",
    );
    // It must never read as a weak conclusion.
    expect(explanation.confidenceStatement).not.toContain("likely");
    expect(explanation.confidenceStatement).not.toContain("probably");
  });

  it("6: PARTIAL_EVIDENCE is a candidate, not a settled answer", () => {
    const explanation = buildExplanation({
      ...BASE,
      strength: "PARTIAL_EVIDENCE",
    });

    expect(explanation.confidenceStatement).toContain(
      "not a settled conclusion",
    );
  });

  it("7: every strength states a limitation", () => {
    for (const strength of [
      "STRONG_EVIDENCE",
      "PARTIAL_EVIDENCE",
      "INSUFFICIENT_EVIDENCE",
    ] as const) {
      const explanation = buildExplanation({ ...BASE, strength });
      expect(explanation.limitationStatement.length, strength).toBeGreaterThan(
        0,
      );
    }
  });

  it("8: no percentage, probability or AI claim is ever produced", () => {
    for (const strength of [
      "STRONG_EVIDENCE",
      "PARTIAL_EVIDENCE",
      "INSUFFICIENT_EVIDENCE",
    ] as const) {
      const text = Object.values(buildExplanation({ ...BASE, strength })).join(
        " ",
      );

      expect(text, strength).not.toMatch(/\d+\s*%/);
      for (const forbidden of [
        "confidence score",
        "probability",
        "AI ",
        "model predicts",
        "machine learning",
      ]) {
        expect(text, `${strength}: ${forbidden}`).not.toContain(forbidden);
      }
    }
  });
});

describe("4H-3 regression guidance — text, never execution", () => {
  const GUIDANCE_INPUT = {
    invariantId: "INV-002",
    scenarioId: "C01",
    recommendationCode: "FIX-EVENT-IDEMPOTENCY",
  };

  it("9: identical input always produces identical output", () => {
    expect(buildRegressionGuidance(GUIDANCE_INPUT)).toEqual(
      buildRegressionGuidance(GUIDANCE_INPUT),
    );
  });

  it("10: it names the invariant that must pass and the behaviour to remove", () => {
    const guidance = buildRegressionGuidance(GUIDANCE_INPUT);

    expect(guidance.invariantToProve).toContain("INV-002");
    expect(guidance.invariantToProve).toContain("PASS");
    expect(guidance.behaviourToEliminate).toContain("second fulfilment");
    expect(guidance.objective).toContain("C01");
    expect(guidance.objective).toContain("FIX-EVENT-IDEMPOTENCY");
  });

  it("11: a missing recommendation degrades honestly", () => {
    const guidance = buildRegressionGuidance({
      ...GUIDANCE_INPUT,
      recommendationCode: null,
    });

    expect(guidance.objective).toContain("After applying your fix");
  });

  it("12: it generates no executable code and triggers nothing", () => {
    const source = stripComments(
      readFileSync(
        join(process.cwd(), "lib", "diagnosis", "explanation-templates.ts"),
        "utf8",
      ),
    );

    for (const forbidden of [
      "startRegression",
      "advanceRegression",
      "eval(",
      "Function(",
      "exec(",
      "spawn",
      "getSupabaseServerClient",
      "fetch(",
      "Date.now(",
      "Math.random(",
      "server-only",
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });
});

describe("4H-2 grouping — deterministic, and honest about thin data", () => {
  function finding(
    id: string,
    overrides: Partial<GroupableFinding> = {},
  ): GroupableFinding {
    return {
      findingId: id,
      diagnosisCode: "RC-001",
      invariantId: "INV-002",
      scenarioId: "C01",
      ...overrides,
    };
  }

  it("13: below the minimum row count it reports insufficiency, not a trend", () => {
    const result = correlateFindings([finding("f-1"), finding("f-2")]);

    expect(result.sufficient).toBe(false);
    expect(result.groups).toEqual([]);
    expect(result.totalFindings).toBe(2);
    expect(MIN_ROWS_FOR_CORRELATION).toBe(3);
  });

  it("14: an empty dataset is insufficient, never an empty 'result'", () => {
    expect(correlateFindings([]).sufficient).toBe(false);
  });

  it("15: it groups by exact value on each supported key", () => {
    const result = correlateFindings([
      finding("f-1"),
      finding("f-2"),
      finding("f-3", { diagnosisCode: "RC-002" }),
    ]);

    expect(result.sufficient).toBe(true);
    const diagnosisGroup = result.groups.find(
      (group) => group.key === "diagnosisCode" && group.value === "RC-001",
    );
    expect(diagnosisGroup?.count).toBe(2);
    expect(diagnosisGroup?.findingIds).toEqual(["f-1", "f-2"]);
  });

  it("16: undiagnosed findings are never grouped together", () => {
    // "Not yet diagnosed" is an absent fact, not a shared root cause.
    const result = correlateFindings([
      finding("f-1", { diagnosisCode: null }),
      finding("f-2", { diagnosisCode: null }),
      finding("f-3", { diagnosisCode: null }),
    ]);

    expect(result.groups.some((group) => group.key === "diagnosisCode")).toBe(
      false,
    );
  });

  it("17: a group of one is not reported as a correlation", () => {
    const result = correlateFindings([
      finding("f-1", { scenarioId: "C01" }),
      finding("f-2", { scenarioId: "C03" }),
      finding("f-3", { scenarioId: "C07" }),
    ]);

    expect(result.groups.every((group) => group.count >= 2)).toBe(true);
  });

  it("18: output order does not depend on input order", () => {
    const rows = [
      finding("f-1"),
      finding("f-2", { scenarioId: "C03" }),
      finding("f-3", { invariantId: "INV-003" }),
    ];

    expect(correlateFindings(rows)).toEqual(
      correlateFindings([...rows].reverse()),
    );
  });

  it("19: it computes no percentage and uses no clustering", () => {
    // Checked against comment-stripped code: the module's own documentation
    // says "no distance metric, no clustering" in order to state that they
    // are absent, and prose must never be able to fail a behavioural check.
    const source = stripComments(
      readFileSync(
        join(process.cwd(), "lib", "findings", "grouping.ts"),
        "utf8",
      ),
    );

    for (const forbidden of [
      "percent",
      "Math.",
      "distance",
      "cluster",
      "kmeans",
      "similarity",
      "Date.now(",
      "getSupabaseServerClient",
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });
});
