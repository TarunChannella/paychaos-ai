import "server-only";

import { assembleChaosRunEvidence } from "@/lib/evidence/chaos-evidence-service";
import type { ChaosRunEvidenceBundleV1 } from "@/lib/evidence/chaos-run-evidence";
import type { ChaosScenarioId } from "@/lib/chaos/types";
import type {
  ChaosRunOutcome,
  InvariantResultInvariantId,
} from "@/lib/supabase/types";

import { evaluateInvariant } from "./evaluate";
import {
  finalizeChaosRunOutcome,
  persistInvariantResult,
  type InvariantResultRow,
} from "./result-repository";
import {
  isMoneyInvariantId,
  isPersistableEvaluation,
  type EvaluationDisposition,
  type InvariantEvaluationEnvelope,
  type MoneyInvariantId,
} from "./types";

/**
 * Phase 3F-C — server-only orchestration for one chaos run's Money Invariant
 * evaluation.
 *
 * The whole operation is: load the FROZEN evidence bundle, evaluate the
 * scenario's required invariants IN MEMORY, persist only the authoritative
 * dispositions, then finalize the run's aggregate outcome. There is no fourth
 * step: this module creates no finding, produces no diagnosis or
 * recommendation, computes no reliability score, and never calls an LLM.
 *
 * IT DECIDES NOTHING. Every disposition comes from the frozen Phase 3F-B
 * evaluators. This module selects which invariants to run, filters which
 * results may be stored, and aggregates — it never converts one disposition
 * into another.
 *
 * EVIDENCE INPUT IS FROZEN. The only input is
 * `assembleChaosRunEvidence(chaosRunId)`. Current mutable `orders`,
 * `payment_attempts`, `payments` and `fulfilments` are never read to
 * reconstruct historical truth: a historical `state_before`/`state_after` of
 * `NULL` means NOT_CAPTURED and stays that way.
 *
 * NO RAZORPAY, NO NETWORK, NO AI. Nothing here reaches outside the database.
 */

/** Deterministic domain error — never leaks a raw Supabase error, secret or payload. */
export class InvariantEvaluationServiceError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "InvariantEvaluationServiceError";
    this.code = code;
  }
}

/** One invariant's outcome for this run, including the ones that create no row. */
export interface InvariantEvaluationReport {
  readonly invariantId: MoneyInvariantId;
  readonly disposition: EvaluationDisposition;
  /** The persisted row, or `null` for a disposition that is never stored. */
  readonly persistedResultId: string | null;
  /** `true` when an equivalent row already existed and was reused unchanged. */
  readonly alreadyPersisted: boolean;
}

export interface EvaluateChaosRunResult {
  readonly chaosRunId: string;
  readonly scenarioId: ChaosScenarioId;
  readonly aggregateOutcome: Extract<
    ChaosRunOutcome,
    "PASS" | "FAIL" | "UNKNOWN"
  >;
  readonly outcomeFinalization: "FINALIZED" | "ALREADY_FINAL";
  /** Every required invariant, including `NOT_APPLICABLE`. */
  readonly evaluations: readonly InvariantEvaluationReport[];
  readonly persistedResults: readonly InvariantResultRow[];
}

/**
 * The aggregate `chaos_runs.outcome`, derived ONLY from this run's required
 * invariant dispositions.
 *
 * Deterministic priority (docs/MONEY_INVARIANTS.md §32/§77/§78):
 *
 *   any FAIL                                            -> FAIL
 *   else any UNKNOWN                                    -> UNKNOWN
 *   else at least one PASS, rest PASS/NOT_APPLICABLE    -> PASS
 *   else every invariant NOT_APPLICABLE                 -> UNKNOWN
 *
 * `NOT_APPLICABLE` never becomes `PASS`: a run where nothing applied has
 * proven nothing, so it cannot claim a clean bill of health. `UNKNOWN` never
 * becomes `PASS`. `ERROR` never reaches this function at all — the caller
 * stops first.
 *
 * Pure: no I/O, no clock, no randomness. The scenario ID is never consulted.
 */
export function deriveAggregateOutcome(
  dispositions: readonly EvaluationDisposition[],
): Extract<ChaosRunOutcome, "PASS" | "FAIL" | "UNKNOWN"> {
  if (dispositions.includes("ERROR")) {
    throw new InvariantEvaluationServiceError(
      "INVARIANT_EVALUATION_ERROR",
      "An evaluator returned ERROR, which is never aggregated into a payment outcome.",
    );
  }
  if (dispositions.includes("FAIL")) return "FAIL";
  if (dispositions.includes("UNKNOWN")) return "UNKNOWN";
  if (dispositions.includes("PASS")) return "PASS";
  // Empty, or every invariant NOT_APPLICABLE: nothing was proven.
  return "UNKNOWN";
}

/**
 * The invariant IDs this run's frozen scenario requires.
 *
 * Taken from `bundle.requiredInvariantIds`, which the evidence layer copies
 * from the frozen `lib/chaos/registry.ts` mapping. A chaos run evaluates ONLY
 * its scenario's invariants — the catalogue holding twelve does not mean every
 * run evaluates twelve.
 */
function requiredInvariantIdsFor(
  bundle: ChaosRunEvidenceBundleV1,
): readonly MoneyInvariantId[] {
  const ids: MoneyInvariantId[] = [];
  for (const id of bundle.requiredInvariantIds) {
    if (!isMoneyInvariantId(id)) {
      throw new InvariantEvaluationServiceError(
        "INVARIANT_EVALUATION_ERROR",
        "This scenario requires an invariant that is not in the frozen P0 catalogue.",
      );
    }
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

/**
 * Is this run in a state whose evidence can be evaluated at all?
 *
 * Only a `COMPLETED` execution is evaluable. `PENDING`/`RUNNING` have not
 * finished; a `FAILED` status means the mechanism itself could not complete;
 * a `BLOCKED` outcome means the scenario never executed. None of those is a
 * merchant FAIL — an ineligible run is a service error, never a verdict.
 */
function assertEvaluable(bundle: ChaosRunEvidenceBundleV1): void {
  if (bundle.run.status !== "COMPLETED") {
    throw new InvariantEvaluationServiceError(
      "CHAOS_RUN_NOT_EVALUABLE",
      "This chaos run has not completed execution, so its evidence cannot be evaluated.",
    );
  }
  if (bundle.run.outcome === "BLOCKED") {
    throw new InvariantEvaluationServiceError(
      "CHAOS_RUN_NOT_EVALUABLE",
      "This chaos run was blocked before execution, so there is no scenario evidence to evaluate.",
    );
  }
  if (bundle.run.outcome === "ERROR") {
    throw new InvariantEvaluationServiceError(
      "CHAOS_RUN_NOT_EVALUABLE",
      "This chaos run recorded a technical execution error, so its evidence is not a basis for a money verdict.",
    );
  }
}

/**
 * Evaluates one chaos run's required Money Invariants and persists the
 * authoritative results.
 *
 * Order is strict and deliberate:
 *
 *   1. load the frozen evidence bundle;
 *   2. verify the run is eligible;
 *   3. resolve the scenario's required invariant IDs;
 *   4. evaluate ALL of them in memory FIRST;
 *   5. if ANY returned `ERROR`, persist NOTHING and raise a typed service
 *      error — `ERROR` is never stored, never becomes `UNKNOWN`, and never
 *      lets the run claim `PASS`;
 *   6. persist only `PASS`/`FAIL`/`UNKNOWN`; `NOT_APPLICABLE` creates no row
 *      but stays in the returned report;
 *   7. only after every persistable row is stored, derive and finalize the
 *      aggregate outcome.
 *
 * Step 4 before step 6 matters: a run must never end up with some invariants
 * persisted and then discover an `ERROR` in a later one.
 *
 * PARTIAL PERSISTENCE. Rows are inserted sequentially. If a later insert
 * fails, the earlier immutable rows REMAIN — they are never deleted or
 * rewritten — the aggregate outcome is NOT finalized, and the error surfaces.
 * Re-running is safe: each already-written row is recognised as equivalent and
 * reused, so a retry converges rather than duplicating.
 */
export async function evaluateChaosRun(
  chaosRunId: string,
): Promise<EvaluateChaosRunResult> {
  // --- 1. Frozen evidence, and only frozen evidence. ---
  let bundle: ChaosRunEvidenceBundleV1 | null;
  try {
    bundle = await assembleChaosRunEvidence(chaosRunId);
  } catch {
    throw new InvariantEvaluationServiceError(
      "INVARIANT_EVIDENCE_LOAD_FAILED",
      "Failed to assemble the chaos run's evidence bundle.",
    );
  }
  if (bundle === null) {
    throw new InvariantEvaluationServiceError(
      "CHAOS_RUN_NOT_EVALUABLE",
      "No chaos run exists with that identifier.",
    );
  }

  // --- 2. Eligibility. ---
  assertEvaluable(bundle);

  // --- 3. Required invariants, from the frozen scenario mapping. ---
  const requiredIds = requiredInvariantIdsFor(bundle);

  // --- 4. Evaluate everything in memory before persisting anything. ---
  const envelopes: InvariantEvaluationEnvelope[] = requiredIds.map((id) =>
    evaluateInvariant(id, bundle),
  );

  // --- 5. ERROR stops the whole orchestration. Nothing is persisted. ---
  const errored = envelopes.filter((e) => e.disposition === "ERROR");
  if (errored.length > 0) {
    throw new InvariantEvaluationServiceError(
      "INVARIANT_EVALUATION_ERROR",
      "An invariant evaluator reported an internal error, so no result was persisted and no outcome was derived.",
    );
  }

  // --- 6. Persist only the authoritative dispositions. ---
  const reports: InvariantEvaluationReport[] = [];
  const persistedResults: InvariantResultRow[] = [];

  for (const envelope of envelopes) {
    if (!isPersistableEvaluation(envelope)) {
      // NOT_APPLICABLE: reported truthfully, stored nowhere. No placeholder
      // row, no SKIPPED marker, no NOT_RUN sentinel.
      reports.push({
        invariantId: envelope.invariantId,
        disposition: envelope.disposition,
        persistedResultId: null,
        alreadyPersisted: false,
      });
      continue;
    }

    const persistence = await persistInvariantResult({
      invariantId: envelope.invariantId as InvariantResultInvariantId,
      invariantVersion: envelope.invariantVersion,
      orderId: envelope.correlations.orderId,
      paymentAttemptId: envelope.correlations.paymentAttemptId,
      paymentId: envelope.correlations.paymentId,
      chaosRunId: bundle.run.id,
      result: envelope.disposition,
      severity: envelope.severity,
      expectedSummary: envelope.expectedSummary,
      observedSummary: envelope.observedSummary,
      reason: envelope.reason,
      evidenceRefs: envelope.evidenceRefs,
    });

    persistedResults.push(persistence.row);
    reports.push({
      invariantId: envelope.invariantId,
      disposition: envelope.disposition,
      persistedResultId: persistence.row.id,
      alreadyPersisted: persistence.kind === "ALREADY_PERSISTED",
    });
  }

  // --- 7. Only now: derive and finalize the aggregate outcome. ---
  const aggregateOutcome = deriveAggregateOutcome(
    reports.map((r) => r.disposition),
  );
  const finalization = await finalizeChaosRunOutcome(
    bundle.run.id,
    aggregateOutcome,
  );

  return {
    chaosRunId: bundle.run.id,
    scenarioId: bundle.run.scenarioId,
    aggregateOutcome,
    outcomeFinalization: finalization.kind,
    evaluations: reports,
    persistedResults,
  };
}
