import type { ChaosRunEvidenceBundleV1 } from "@/lib/evidence/chaos-run-evidence";

import { INVARIANT_EVALUATORS } from "./evaluators";
import { correlationsFrom, nonPersistableEvaluation } from "./evaluator-utils";
import { getInvariantDefinition, P0_INVARIANT_IDS } from "./registry";
import type { InvariantEvaluationEnvelope, MoneyInvariantId } from "./types";

/**
 * Phase 3F-B — the pure deterministic dispatcher.
 *
 * PURE. It selects an evaluator and returns its envelope. It performs no I/O
 * of any kind, reads no clock, and persists nothing. It never inspects,
 * overrides or "corrects" an evaluator's disposition: routing is not
 * evaluating, and nothing here can turn an `UNKNOWN` into a `PASS`.
 *
 * NO PERSISTENCE, NO ORCHESTRATION. Loading evidence from the database,
 * deriving a chaos run's outcome, and appending rows to `invariant_results`
 * are Phase 3F-C. This module returns in-memory envelopes only.
 */

/**
 * The ONE place a genuine internal-contract failure can occur in 3F-B: the
 * frozen catalogue and the evaluator table are two separate frozen artefacts,
 * and an ID present in one but absent from the other is an impossible
 * internal state rather than a fact about payment truth.
 *
 * `ERROR` is the truthful disposition for exactly that case — and it is
 * structurally non-persistable, so it can never be written to
 * `invariant_results` as though it were a verdict (`ERROR` is never converted
 * to `UNKNOWN`, `PASS` or `FAIL`). Repository/database failure handling is a
 * different concern and belongs to Phase 3F-C.
 */
function internalContractError(
  invariantId: MoneyInvariantId,
  bundle: ChaosRunEvidenceBundleV1,
  reason: string,
): InvariantEvaluationEnvelope {
  return nonPersistableEvaluation({
    invariantId,
    invariantVersion: getInvariantDefinition(invariantId)?.version ?? "1",
    disposition: "ERROR",
    correlations: correlationsFrom(bundle),
    reason,
    evidenceRefs: [{ kind: "CHAOS_RUN", id: bundle.run.id }],
  });
}

/**
 * Evaluates ONE invariant against one immutable evidence bundle.
 *
 * Deterministic: the same `(invariantId, bundle)` always yields the same
 * disposition, severity, summaries, reason and evidence references.
 */
export function evaluateInvariant(
  invariantId: MoneyInvariantId,
  bundle: ChaosRunEvidenceBundleV1,
): InvariantEvaluationEnvelope {
  const evaluator = INVARIANT_EVALUATORS[invariantId];
  if (typeof evaluator !== "function") {
    return internalContractError(
      invariantId,
      bundle,
      "No deterministic evaluator is registered for this catalogued invariant ID.",
    );
  }
  if (getInvariantDefinition(invariantId) === undefined) {
    return internalContractError(
      invariantId,
      bundle,
      "This invariant ID has an evaluator but no frozen catalogue definition.",
    );
  }
  return evaluator(bundle);
}

/**
 * Evaluates every catalogued P0 invariant against one bundle, in the frozen
 * `P0_INVARIANT_IDS` order.
 *
 * Returns all twelve envelopes including the `NOT_APPLICABLE` ones — an
 * inapplicable rule is a fact worth reporting, and filtering happens where
 * persistence decisions are made, in Phase 3F-C.
 */
export function evaluateAllInvariants(
  bundle: ChaosRunEvidenceBundleV1,
): readonly InvariantEvaluationEnvelope[] {
  return P0_INVARIANT_IDS.map((id) => evaluateInvariant(id, bundle));
}
