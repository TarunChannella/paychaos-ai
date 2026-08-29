import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

import {
  EVALUATION_DISPOSITIONS,
  INVARIANT_EVIDENCE_KINDS,
  INVARIANT_SEVERITIES,
  isInvariantSeverity,
  isMoneyInvariantId,
  isPersistableEvaluation,
  isPersistedInvariantResult,
  MONEY_INVARIANT_IDS,
  NON_PERSISTABLE_DISPOSITIONS,
  PERSISTED_INVARIANT_RESULTS,
  type InvariantEvaluationEnvelope,
} from "@/lib/invariants/types";

/**
 * Phase 3F-A — runtime assertions for `lib/invariants/types.ts`.
 *
 * This file exists ONLY because that module genuinely exports runtime
 * values (frozen tuples and pure guards), not merely compile-time aliases.
 * It asserts nothing about evaluator behavior — no evaluator exists in
 * Phase 3F-A.
 */

const repoRoot = path.resolve(import.meta.dirname, "../../../");

describe("Phase 3F-A — MoneyInvariantId catalogue vocabulary", () => {
  it("1: contains exactly the twelve P0 IDs, in order, with no duplicates", () => {
    expect(MONEY_INVARIANT_IDS).toEqual([
      "INV-001",
      "INV-002",
      "INV-003",
      "INV-004",
      "INV-005",
      "INV-006",
      "INV-007",
      "INV-008",
      "INV-009",
      "INV-010",
      "INV-011",
      "INV-012",
    ]);
    expect(new Set(MONEY_INVARIANT_IDS).size).toBe(12);
  });

  it("2: excludes the P1 invariants INV-013 and INV-014", () => {
    expect(MONEY_INVARIANT_IDS).not.toContain("INV-013");
    expect(MONEY_INVARIANT_IDS).not.toContain("INV-014");
    expect(isMoneyInvariantId("INV-013")).toBe(false);
    expect(isMoneyInvariantId("INV-014")).toBe(false);
  });

  it("3: isMoneyInvariantId accepts every catalogued ID and fails closed otherwise", () => {
    for (const id of MONEY_INVARIANT_IDS) {
      expect(isMoneyInvariantId(id)).toBe(true);
    }
    for (const rejected of [
      "INV-000",
      "inv-001",
      "INV-1",
      "INV_001",
      " INV-001",
      "INV-001 ",
      "",
      null,
      undefined,
      1,
      { invariantId: "INV-001" },
      ["INV-001"],
    ]) {
      expect(isMoneyInvariantId(rejected)).toBe(false);
    }
  });

  it("4: the exported tuples are frozen — the catalogue vocabulary cannot be mutated at runtime", () => {
    expect(Object.isFrozen(MONEY_INVARIANT_IDS)).toBe(true);
    expect(Object.isFrozen(PERSISTED_INVARIANT_RESULTS)).toBe(true);
    expect(Object.isFrozen(EVALUATION_DISPOSITIONS)).toBe(true);
    expect(Object.isFrozen(NON_PERSISTABLE_DISPOSITIONS)).toBe(true);
    expect(Object.isFrozen(INVARIANT_SEVERITIES)).toBe(true);
    expect(Object.isFrozen(INVARIANT_EVIDENCE_KINDS)).toBe(true);
  });
});

describe("Phase 3F-A — the persisted/in-memory result split", () => {
  it("5: exactly PASS, FAIL and UNKNOWN are persistable", () => {
    expect(PERSISTED_INVARIANT_RESULTS).toEqual(["PASS", "FAIL", "UNKNOWN"]);
  });

  it("6: NOT_APPLICABLE and ERROR exist in memory but are never persistable", () => {
    expect(EVALUATION_DISPOSITIONS).toEqual([
      "PASS",
      "FAIL",
      "UNKNOWN",
      "NOT_APPLICABLE",
      "ERROR",
    ]);
    expect(NON_PERSISTABLE_DISPOSITIONS).toEqual(["NOT_APPLICABLE", "ERROR"]);
    expect(isPersistedInvariantResult("NOT_APPLICABLE")).toBe(false);
    expect(isPersistedInvariantResult("ERROR")).toBe(false);
  });

  it("7: every in-memory disposition is either persistable or explicitly non-persistable — there is no third category", () => {
    for (const disposition of EVALUATION_DISPOSITIONS) {
      const persistable = isPersistedInvariantResult(disposition);
      const nonPersistable = (
        NON_PERSISTABLE_DISPOSITIONS as readonly string[]
      ).includes(disposition);
      expect(persistable !== nonPersistable).toBe(true);
    }
  });

  it("8: isPersistedInvariantResult fails closed on unknown values", () => {
    for (const rejected of [
      "pass",
      "Pass",
      "PASSED",
      "OK",
      "NOT-APPLICABLE",
      "",
      null,
      undefined,
      0,
      true,
    ]) {
      expect(isPersistedInvariantResult(rejected)).toBe(false);
    }
  });

  it("9: isPersistableEvaluation narrows a PASS/FAIL/UNKNOWN envelope and rejects NOT_APPLICABLE/ERROR", () => {
    const base = {
      invariantId: "INV-005",
      invariantVersion: "1",
      correlations: {
        orderId: null,
        paymentAttemptId: null,
        paymentId: null,
        chaosRunId: "00000000-0000-4000-8000-000000000000",
      },
      reason: "deterministic evaluator explanation",
      evidenceRefs: [],
    } as const;

    const persistable: InvariantEvaluationEnvelope = {
      ...base,
      disposition: "PASS",
      severity: "CRITICAL",
      expectedSummary: "expected",
      observedSummary: "observed",
    };
    const notApplicable: InvariantEvaluationEnvelope = {
      ...base,
      disposition: "NOT_APPLICABLE",
    };
    const errored: InvariantEvaluationEnvelope = {
      ...base,
      disposition: "ERROR",
    };

    expect(isPersistableEvaluation(persistable)).toBe(true);
    expect(isPersistableEvaluation(notApplicable)).toBe(false);
    expect(isPersistableEvaluation(errored)).toBe(false);
  });
});

describe("Phase 3F-A — severity vocabulary", () => {
  it("10: is exactly LOW/MEDIUM/HIGH/CRITICAL with no INFO or WARNING", () => {
    expect(INVARIANT_SEVERITIES).toEqual(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
    expect(isInvariantSeverity("INFO")).toBe(false);
    expect(isInvariantSeverity("WARNING")).toBe(false);
    // The frozen lib/chaos/types.ts FailureSeverity spelling is title-case
    // and is deliberately NOT accepted here — the database CHECK is
    // upper-case only.
    expect(isInvariantSeverity("Critical")).toBe(false);
    expect(isInvariantSeverity("High")).toBe(false);
  });
});

describe("Phase 3F-A — the domain vocabulary agrees with the database vocabulary", () => {
  const supabaseTypesSource = fs.readFileSync(
    path.join(repoRoot, "lib", "supabase", "types.ts"),
    "utf-8",
  );

  it("11: lib/supabase/types.ts declares the same three persisted result values", () => {
    const match = supabaseTypesSource.match(
      /export type InvariantResultValue =([^;]*);/,
    );
    expect(match).not.toBeNull();
    const declared = [...match![1]!.matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]!);
    expect(declared).toEqual([...PERSISTED_INVARIANT_RESULTS]);
  });

  it("12: lib/supabase/types.ts declares the same four severities", () => {
    const match = supabaseTypesSource.match(
      /export type InvariantResultSeverity =([^;]*);/,
    );
    expect(match).not.toBeNull();
    const declared = [...match![1]!.matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]!);
    expect(declared).toEqual([...INVARIANT_SEVERITIES]);
  });

  it("13: lib/supabase/types.ts declares the same twelve invariant IDs", () => {
    const match = supabaseTypesSource.match(
      /export type InvariantResultInvariantId =([^;]*);/,
    );
    expect(match).not.toBeNull();
    const declared = [...match![1]!.matchAll(/"(INV-\d{3})"/g)].map(
      (m) => m[1]!,
    );
    expect(declared).toEqual([...MONEY_INVARIANT_IDS]);
  });

  it("14: NOT_APPLICABLE and ERROR appear nowhere in the database result type", () => {
    const match = supabaseTypesSource.match(
      /export type InvariantResultValue =([^;]*);/,
    );
    expect(match![1]!).not.toMatch(/NOT_APPLICABLE/);
    expect(match![1]!).not.toMatch(/ERROR/);
  });
});

describe("Phase 3F-A — lib/invariants/types.ts is pure and evaluator-free", () => {
  const source = fs.readFileSync(
    path.join(repoRoot, "lib", "invariants", "types.ts"),
    "utf-8",
  );

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

  const functionalSource = stripComments(source);

  it("15: performs no I/O — no Supabase, no fetch, no Razorpay, no filesystem", () => {
    expect(functionalSource).not.toMatch(/@\/lib\/supabase/);
    expect(functionalSource).not.toMatch(/\bfetch\s*\(/);
    expect(functionalSource).not.toMatch(/require\("razorpay"\)/);
    expect(functionalSource).not.toMatch(/from\s+["']razorpay["']/);
    expect(functionalSource).not.toMatch(/new Razorpay\(/);
    expect(functionalSource).not.toMatch(/node:fs/);
  });

  it("16: reads no clock and no randomness — evaluation stays deterministic", () => {
    expect(functionalSource).not.toMatch(/Date\.now\(/);
    expect(functionalSource).not.toMatch(/new Date\(/);
    expect(functionalSource).not.toMatch(/Math\.random\(/);
    expect(functionalSource).not.toMatch(/randomUUID/);
  });

  it("17: contains no evaluator and no AI/diagnosis/score surface", () => {
    expect(functionalSource).not.toMatch(/evaluateInvariant/);
    expect(functionalSource).not.toMatch(/\bevaluateChaosRun\b/);
    for (const forbidden of [
      "confidence",
      "rootCause",
      "root_cause",
      "recommendation",
      "diagnosis",
      "reliabilityScore",
      "llm",
      "openai",
      "anthropic",
      "ollama",
    ]) {
      expect(functionalSource.toLowerCase()).not.toContain(
        forbidden.toLowerCase(),
      );
    }
  });
});
