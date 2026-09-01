import "server-only";

import { getRazorpayEnv } from "@/lib/config/razorpay-env";
import { getCurrentReliabilityScore } from "@/lib/reliability/service";

import {
  loadSelectedRunInvariantEvidence,
  loadUnresolvedFindings,
} from "./repository";
import { evaluateGoLiveReadinessV1 } from "./readiness";

import type { ReadinessRunInvariantEvidence } from "./repository";
import type {
  GoLiveReadinessV1,
  ReadinessGateState,
  ReadinessScenarioInvariantGate,
} from "./types";
import type { ReliabilityScoreReadModel } from "@/lib/reliability/service";

/**
 * Phase 4G — the deterministic composition of Go-Live Readiness.
 *
 * ```text
 * frozen 4F getCurrentReliabilityScore()
 *   -> SELECT-only readiness evidence (findings, selected-run invariants)
 *     -> authoritative gate states
 *       -> evaluateGoLiveReadinessV1(...)     <- sole readiness authority
 * ```
 *
 * NO SECOND SCORE ENGINE AND NO SECOND SELECTOR. The score and the four
 * current scenario states come from the frozen Phase 4F read model, which is
 * returned alongside the assessment unmodified. Nothing here recalculates a
 * deduction, re-applies eligibility or re-selects a current run.
 *
 * READ-ONLY AND NON-PERSISTING. Two extra SELECTs, no writes. Readiness is
 * derived on demand and is never stored: there is no `readiness_scores`,
 * `readiness_snapshots` or `go_live_status` table.
 *
 * READ FAILURE PROPAGATES. A typed repository error is allowed through
 * untouched. It is deliberately NOT caught and turned into "no unresolved
 * findings" — a database outage reported as a clean bill of health is exactly
 * how a false READY would be produced.
 *
 * NO FABRICATED PASS. Gates that this runtime cannot authoritatively establish
 * are reported `UNKNOWN`, never `PASS`. See `deriveOperationalGates` below.
 */

// ============================================================================
// GATE DERIVATION
// ============================================================================

/**
 * Test Mode enforcement, from the existing frozen configuration authority.
 *
 * `getRazorpayEnv()` fails closed on any non-Test-Mode key — including a
 * `rzp_live_` key id — so reaching a value at all IS the Test Mode proof. A
 * throw means the configuration is invalid or forbidden, which is a genuine
 * FAIL rather than an unknown.
 *
 * No key, secret or environment value is read out of the result or returned.
 */
function deriveTestModeSecurityGate(): ReadinessGateState {
  try {
    getRazorpayEnv();
    return "PASS";
  } catch {
    return "FAIL";
  }
}

/**
 * The required healthy baseline.
 *
 * Deliberately `UNKNOWN`. `docs/MONEY_INVARIANTS.md` Section 53 describes what
 * a healthy baseline evaluation should contain, but the project freezes NO
 * rule for deciding which persisted baseline is the CURRENT authoritative one.
 * The only "baseline" the codebase implements is the Phase 3 chaos
 * subject-freshness check (`isFreshBaseline`: UNPAID / OPEN / zero
 * fulfilments), which answers a different question entirely — whether an order
 * may be used as a chaos subject, not whether the merchant is healthy.
 *
 * Inventing a latest-baseline selection rule here would be exactly the kind of
 * undocumented authority this project forbids, and it would let READY rest on
 * a rule no one approved. Reporting `UNKNOWN` truthfully prevents READY
 * without asserting that a baseline failed.
 */
function deriveHealthyBaselineGate(): ReadinessGateState {
  return "UNKNOWN";
}

/**
 * The four operational gates that have no runtime representation.
 *
 * A handoff saying "the build passed" is historical developer verification,
 * not current runtime evidence, and this module must not launder one into the
 * other. Until Phase 5 supplies an authoritative verification adapter, each is
 * `UNKNOWN`: honest, and sufficient to prevent a READY nobody has earned.
 *
 * The pure evaluator already accepts `PASS` for every one of these, so the
 * READY path is fully reachable and fully tested today.
 */
function deriveOperationalGates(): {
  readonly realRazorpayManualVerificationGate: ReadinessGateState;
  readonly buildGate: ReadinessGateState;
  readonly securityVerificationGate: ReadinessGateState;
  readonly automatedTestGate: ReadinessGateState;
  readonly manualVerificationGate: ReadinessGateState;
} {
  return {
    realRazorpayManualVerificationGate: "UNKNOWN",
    buildGate: "UNKNOWN",
    securityVerificationGate: "UNKNOWN",
    automatedTestGate: "UNKNOWN",
    manualVerificationGate: "UNKNOWN",
  };
}

/**
 * Whether each selected current run's persisted invariant evidence supports
 * READY.
 *
 * `PASS` requires the run to have been selected AND to carry at least one
 * persisted result, none of which is `FAIL` or `UNKNOWN`. A scenario with no
 * selected run, or a selected run with no persisted evidence, is `UNKNOWN` —
 * absence of evidence is never evidence of correctness.
 *
 * A documented `NOT_APPLICABLE` invariant legitimately persists no row
 * (`lib/invariants/service.ts`), so no row is ever *required* for a specific
 * invariant id; only the rows that do exist are judged.
 */
function deriveSelectedRunInvariantGates(
  reliability: ReliabilityScoreReadModel,
  evidence: readonly ReadinessRunInvariantEvidence[],
): readonly ReadinessScenarioInvariantGate[] {
  const byRunId = new Map(evidence.map((entry) => [entry.chaosRunId, entry]));

  return reliability.score.scenarioBreakdown.map((entry) => {
    if (entry.selectedRunId === null) {
      return { scenarioId: entry.scenarioId, state: "UNKNOWN" as const };
    }
    const runEvidence = byRunId.get(entry.selectedRunId);
    if (runEvidence === undefined || runEvidence.results.length === 0) {
      return { scenarioId: entry.scenarioId, state: "UNKNOWN" as const };
    }
    if (runEvidence.results.some((row) => row.result === "FAIL")) {
      return { scenarioId: entry.scenarioId, state: "FAIL" as const };
    }
    if (runEvidence.results.some((row) => row.result === "UNKNOWN")) {
      return { scenarioId: entry.scenarioId, state: "UNKNOWN" as const };
    }
    return { scenarioId: entry.scenarioId, state: "PASS" as const };
  });
}

// ============================================================================
// COMPOSITION
// ============================================================================

/** The read model. `reliability` is the 4F object, verbatim. */
export interface GoLiveReadinessReadModel {
  readonly readiness: GoLiveReadinessV1;
  readonly reliability: ReliabilityScoreReadModel;
}

/**
 * Calculates current Go-Live Readiness from persisted evidence.
 *
 * The only I/O is the frozen reliability read plus two SELECTs. Everything
 * after that is gate derivation and the pure evaluator.
 */
export async function getCurrentGoLiveReadiness(): Promise<GoLiveReadinessReadModel> {
  // A failed read throws here and is never converted into a clean state.
  const reliability = await getCurrentReliabilityScore();

  const selectedRunIds = reliability.score.scenarioBreakdown
    .map((entry) => entry.selectedRunId)
    .filter((id): id is string => id !== null);

  const [unresolvedFindings, invariantEvidence] = [
    await loadUnresolvedFindings(),
    await loadSelectedRunInvariantEvidence(selectedRunIds),
  ];

  const readiness = evaluateGoLiveReadinessV1({
    reliability,
    testModeSecurityGate: deriveTestModeSecurityGate(),
    healthyBaselineGate: deriveHealthyBaselineGate(),
    selectedRunInvariantGates: deriveSelectedRunInvariantGates(
      reliability,
      invariantEvidence,
    ),
    unresolvedFindings,
    ...deriveOperationalGates(),
  });

  return { readiness, reliability };
}
