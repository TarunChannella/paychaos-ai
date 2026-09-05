import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { evaluateInv001, evaluateInv007 } from "@/lib/invariants/evaluators";
import { didNoProtectedWork } from "@/lib/invariants/evaluator-utils";
import { decideRegressionOutcome } from "@/lib/regression/finalization";

import {
  attempt,
  bundle,
  fulfilment,
  snapshot,
  ORDER_ID,
  PROC_A,
  PROC_B,
} from "./fixtures";

/**
 * Phase 5 correction — a SKIPPED_DUPLICATE attempt is not an evidence gap.
 *
 * ============================================================================
 * THE CONFIRMED PRODUCTION DEFECT
 * ============================================================================
 *
 * A fresh, SAFE-profile C01 regression ran on genuinely new Razorpay Test Mode
 * evidence and produced, from the live database:
 *
 *   INV-002 = PASS        INV-006 = PASS
 *   INV-001 = UNKNOWN     INV-007 = UNKNOWN
 *   chaos_runs.outcome = UNKNOWN
 *   regression_runs.status = ERROR       finding.status = OPEN
 *
 * The UNKNOWN reason was "relevant attempts without complete protected-effect
 * evidence = 1 (missing: state_after, state_before)". That attempt was a
 * `SKIPPED_DUPLICATE` row — created when Razorpay legitimately delivered the
 * same event more than once and PayChaos's dedup boundary refused it. Its
 * snapshots are NULL by design: nothing ran, so nothing was captured.
 *
 * Counting it as missing evidence made the aggregate UNKNOWN. The frozen D-6
 * rule then correctly refused to treat an inconclusive run as a verdict and
 * terminalized ERROR, leaving the Finding OPEN. So a correct merchant, with
 * correct duplicate-delivery protection, could never resolve its own Finding.
 *
 * WHAT THE FIX DOES AND DOES NOT DO. It narrows WHICH attempts must carry
 * evidence — an attempt that provably did no work has no protected effect to
 * evidence. It does not relax WHAT that evidence must show: a SUCCEEDED
 * attempt with a missing snapshot still forces UNKNOWN (architect blocker
 * FINAL-08), and no UNKNOWN is ever converted to PASS.
 */

const CAPTURED = (s = snapshot()) => ({
  kind: "CAPTURED" as const,
  snapshot: s,
});
const NOT_CAPTURED = { kind: "NOT_CAPTURED" as const };

/** One healthy fulfilment — the SAFE outcome a regression should prove. */
function healthy() {
  return snapshot({ fulfilments: [fulfilment()] });
}

describe("skipped duplicates — the status vocabulary", () => {
  it("1: only SKIPPED_DUPLICATE counts as provably no work", () => {
    expect(didNoProtectedWork("SKIPPED_DUPLICATE")).toBe(true);

    // In-flight states may still act, so their missing evidence is genuinely
    // unknown and must keep forcing UNKNOWN.
    for (const status of [
      "PENDING",
      "HELD",
      "PROCESSING",
      "SUCCEEDED",
      "FAILED",
    ]) {
      expect(didNoProtectedWork(status), status).toBe(false);
    }
  });
});

describe("skipped duplicates — INV-001 and INV-007 on healthy SAFE evidence", () => {
  /**
   * The deployed shape: one real delivery that succeeded and captured its
   * snapshots, plus one duplicate delivery the dedup boundary skipped.
   */
  function safeEvidenceWithSkippedDuplicate() {
    return bundle({
      scenarioId: "C01",
      originalProcessingAttempts: [
        attempt({
          id: PROC_A,
          stateBefore: CAPTURED(healthy()),
          stateAfter: CAPTURED(healthy()),
        }),
        attempt({
          id: PROC_B,
          status: "SKIPPED_DUPLICATE",
          isDuplicateDelivery: true,
          stateBefore: NOT_CAPTURED,
          stateAfter: NOT_CAPTURED,
        }),
      ],
    });
  }

  it("2: INV-001 is no longer blocked by a skipped duplicate", () => {
    // THE DEFECT, pinned. This returned UNKNOWN before the fix.
    const result = evaluateInv001(safeEvidenceWithSkippedDuplicate());
    expect(result.disposition).not.toBe("UNKNOWN");
    expect(result.disposition).toBe("PASS");
  });

  it("3: INV-007 is no longer blocked by a skipped duplicate", () => {
    const result = evaluateInv007(safeEvidenceWithSkippedDuplicate());
    expect(result.disposition).not.toBe("UNKNOWN");
    expect(result.disposition).toBe("PASS");
  });
});

describe("skipped duplicates — the evidence rule is narrowed, never relaxed", () => {
  /** A SUCCEEDED attempt with no snapshots: a genuine gap. */
  function genuineGap() {
    return bundle({
      scenarioId: "C01",
      originalProcessingAttempts: [
        attempt({
          id: PROC_A,
          stateBefore: CAPTURED(healthy()),
          stateAfter: CAPTURED(healthy()),
        }),
        attempt({
          id: PROC_B,
          status: "SUCCEEDED",
          stateBefore: NOT_CAPTURED,
          stateAfter: NOT_CAPTURED,
        }),
      ],
    });
  }

  it("4: a SUCCEEDED attempt missing snapshots still forces UNKNOWN (FINAL-08)", () => {
    // The property that must NOT change. If this ever passes, the fix has
    // become a weakening.
    expect(evaluateInv001(genuineGap()).disposition).toBe("UNKNOWN");
    expect(evaluateInv007(genuineGap()).disposition).toBe("UNKNOWN");
  });

  it("5: an in-flight attempt missing snapshots still forces UNKNOWN", () => {
    for (const status of ["PENDING", "HELD", "PROCESSING"]) {
      const inFlight = bundle({
        scenarioId: "C01",
        originalProcessingAttempts: [
          attempt({
            id: PROC_A,
            stateBefore: CAPTURED(healthy()),
            stateAfter: CAPTURED(healthy()),
          }),
          attempt({
            id: PROC_B,
            status,
            stateBefore: NOT_CAPTURED,
            stateAfter: NOT_CAPTURED,
          }),
        ],
      });
      expect(evaluateInv001(inFlight).disposition, status).toBe("UNKNOWN");
    }
  });

  it("6: a real duplicate is still detected as FAIL, skipped rows or not", () => {
    // The original failure must remain provable. Two fulfilments on the order
    // is a FAIL regardless of any skipped attempt beside them.
    const duplicated = snapshot({
      fulfilments: [
        fulfilment({ id: "ffffffff-ffff-4fff-8fff-fffffffffff1" }),
        fulfilment({ id: "ffffffff-ffff-4fff-8fff-fffffffffff2" }),
      ],
    });
    const contaminated = bundle({
      scenarioId: "C01",
      originalProcessingAttempts: [
        attempt({
          id: PROC_A,
          stateBefore: CAPTURED(duplicated),
          stateAfter: CAPTURED(duplicated),
        }),
        attempt({
          id: PROC_B,
          status: "SKIPPED_DUPLICATE",
          stateBefore: NOT_CAPTURED,
          stateAfter: NOT_CAPTURED,
        }),
      ],
    });

    expect(evaluateInv007(contaminated).disposition).toBe("FAIL");
  });

  it("7: the order under test is the fixture's own order", () => {
    // Guards the tests above from passing because they looked at nothing.
    const state = safeOrderId();
    expect(state).toBe(ORDER_ID);
  });

  function safeOrderId(): string | null {
    return bundle({ scenarioId: "C01" }).run.orderId;
  }
});

describe("skipped duplicates — the frozen regression contract is unchanged", () => {
  const evaluations = (entries: readonly (readonly [string, string])[]) =>
    entries.map(([invariantId, disposition]) => ({
      invariantId,
      disposition,
      persistedResultId: `row-${invariantId}`,
      alreadyPersisted: false,
    })) as never;

  it("8: aggregate UNKNOWN still terminalizes ERROR / NO_CHANGE (D-6)", () => {
    // The fix removes a spurious CAUSE of UNKNOWN. It does not change what
    // UNKNOWN means, and never converts one to PASS.
    const decision = decideRegressionOutcome(
      {
        aggregateOutcome: "UNKNOWN",
        evaluations: evaluations([
          ["INV-002", "PASS"],
          ["INV-001", "UNKNOWN"],
        ]),
      },
      "INV-002",
    );

    expect(decision.regressionStatus).toBe("ERROR");
    expect(decision.findingAction).toBe("NO_CHANGE");
    expect(decision.reason).toBe("INCONCLUSIVE_UNKNOWN");
  });

  it("9: aggregate PASS with the original invariant PASS resolves (D-5)", () => {
    const decision = decideRegressionOutcome(
      {
        aggregateOutcome: "PASS",
        evaluations: evaluations([
          ["INV-001", "PASS"],
          ["INV-002", "PASS"],
          ["INV-006", "PASS"],
          ["INV-007", "PASS"],
        ]),
      },
      "INV-002",
    );

    expect(decision.regressionStatus).toBe("RESOLVED");
    expect(decision.findingAction).toBe("RESOLVE");
  });

  it("10: aggregate PASS but the original invariant not PASS still fails closed", () => {
    const decision = decideRegressionOutcome(
      {
        aggregateOutcome: "PASS",
        evaluations: evaluations([["INV-001", "PASS"]]),
      },
      "INV-002",
    );

    expect(decision.regressionStatus).toBe("ERROR");
    expect(decision.findingAction).toBe("NO_CHANGE");
    expect(decision.reason).toBe("ORIGINAL_INVARIANT_NOT_PROVEN_PASS");
  });

  it("11: aggregate FAIL still marks STILL_FAILING, never resolves", () => {
    const decision = decideRegressionOutcome(
      {
        aggregateOutcome: "FAIL",
        evaluations: evaluations([["INV-002", "PASS"]]),
      },
      "INV-002",
    );

    expect(decision.regressionStatus).toBe("STILL_FAILING");
    expect(decision.findingAction).toBe("MARK_STILL_FAILING");
  });
});
