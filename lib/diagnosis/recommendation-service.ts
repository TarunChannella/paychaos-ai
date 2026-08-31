import "server-only";

import { assembleDiagnosisEvidencePackForFinding } from "@/lib/diagnosis/evidence-pack-service";
import { persistFindingRecommendation } from "@/lib/diagnosis/recommendation-repository";
import { buildRecommendation } from "@/lib/diagnosis/recommendations";
import { diagnoseFinding } from "@/lib/diagnosis/root-cause-service";
import { logEvent } from "@/lib/security/logger";

import type { RecommendationPersistenceResult } from "@/lib/diagnosis/recommendation-repository";
import type { RecommendationV1 } from "@/lib/diagnosis/recommendations";
import type { DiagnoseFindingResult } from "@/lib/diagnosis/root-cause-service";

/**
 * Phase 4D-R2 — server-only orchestration for one Finding's recommendation.
 *
 *   diagnoseFinding(findingId)                          (Phase 4C, trusted)
 *     -> assembleDiagnosisEvidencePackForFinding(...)   (Phase 4A-R2)
 *       -> buildRecommendation(pack, classification)    (Phase 4D-R1, pure)
 *         -> persistFindingRecommendation(...)          (Phase 4D-R2)
 *
 * THE CLASSIFICATION IS DERIVED, NEVER SUPPLIED. The only input is a Finding
 * id. A caller cannot hand in an Evidence Pack, a signal set, a
 * classification, a recommendation, a diagnosis code, recommendation text or a
 * timestamp. Phase 4D-R1 can verify that a classification is internally
 * COHERENT, but coherence is not trustworthiness — a well-formed object can
 * still be fabricated. Deriving it server-side through the frozen Phase 4C
 * service is what closes that gap.
 *
 * PHASE 4C KEEPS OWNING THE DIAGNOSIS. This module calls `diagnoseFinding`
 * rather than reproducing its work, so diagnosis persistence, its race
 * semantics and its audit logging all stay in one place. It never calls
 * `classifyRootCause`, `extractDiagnosticSignals` or
 * `persistFindingDiagnosis` itself.
 *
 * TWO READS ARE DELIBERATE. One `recommendFinding` performs the trusted
 * diagnosis operation plus one read-only Evidence Pack assembly for the
 * recommendation. Eliminating the second read would mean duplicating Phase 4C
 * orchestration here, which is the more expensive mistake. `buildRecommendation`
 * already fails closed if the pack and the classification are materially
 * incompatible, so the two reads cannot silently diverge.
 *
 * ADVISORY ONLY. Nothing here writes payment, order, fulfilment, webhook,
 * processing, chaos-run or invariant-result state, changes a Finding's
 * `status` or `resolved_at`, or touches `diagnosis_code`, `diagnosis_strength`
 * or `diagnosed_at` — those are Phase 4C's and Phase 4E's respectively.
 *
 * TWO-STAGE DURABILITY IS INTENTIONAL. Diagnosis and recommendation are two
 * independent durable stages. If the recommendation write fails, the already
 * valid diagnosis STAYS persisted and this call rejects; a later retry finds
 * `ALREADY_DIAGNOSED` and proceeds to the recommendation. That partial state
 * is visible and recoverable, which is better than inventing a transaction to
 * hide it or rolling back a correct verdict.
 *
 * NO AI. No prompt, no model, no provider client.
 */

/** The one safe structured audit event this module emits. */
const RECOMMENDATION_EVENT = "diagnosis.recommendation.persisted";

export interface RecommendFindingResult {
  readonly diagnosis: DiagnoseFindingResult;
  readonly recommendation: RecommendationV1;
  readonly persistence: RecommendationPersistenceResult;
}

/**
 * Writes the safe structured audit line for a recommendation that has ALREADY
 * been committed or reused.
 *
 * BEST-EFFORT BY DESIGN, exactly as in Phase 4C: PostgreSQL is authoritative
 * and a log line is supplemental, so a logging fault must never turn a
 * committed recommendation into a reported failure. The catch is scoped to
 * this one call; diagnosis, evidence assembly, recommendation building and
 * persistence all sit outside it.
 *
 * Content is identifiers, frozen vocabulary values and counts only. The
 * generated `diagnosis_summary`, the remediation text and the observed
 * evidence prose are deliberately NOT logged — they are long derived text, and
 * an audit line is not the place to duplicate it.
 */
function emitRecommendationAuditLog(
  invariantId: string,
  recommendation: RecommendationV1,
  diagnosis: DiagnoseFindingResult,
  persistence: RecommendationPersistenceResult,
): void {
  try {
    logEvent(RECOMMENDATION_EVENT, {
      finding_id: recommendation.findingId,
      invariant_result_id: recommendation.invariantResultId,
      invariant_id: invariantId,
      diagnosis_code: recommendation.diagnosis.rootCauseCode,
      diagnosis_strength: recommendation.diagnosis.strength,
      recommendation_code: persistence.recommendationCode,
      diagnosis_rule_version: diagnosis.classification.ruleVersion,
      recommendation_catalogue_version: recommendation.catalogueVersion,
      template_version: recommendation.templateVersion,
      recommendation_output_source: recommendation.outputSource,
      supporting_signal_count: recommendation.supportingSignalCodes.length,
      blocking_gap_count: recommendation.blockingGapCodes.length,
      persistence_kind: persistence.kind,
      updated_at: persistence.updatedAt,
    });
  } catch {
    // Supplemental logging must never alter the authoritative persistence
    // result. No rollback, no repeated write, no re-diagnosis, and no
    // downgrade of the recommendation that has already been committed.
  }
}

/**
 * Diagnoses one persisted Finding and durably records the deterministic
 * recommendation that explains that diagnosis.
 *
 * Every upstream error propagates unchanged — Phase 4A evidence errors, Phase
 * 4C diagnosis errors, the Phase 4D-R1 `RecommendationError`, and the
 * recommendation persistence errors. None is ever rewritten as `RC-016` or
 * `INVESTIGATE-EVIDENCE-GAP`: those are valid deterministic answers about real
 * evidence, not infrastructure fallbacks.
 */
export async function recommendFinding(
  findingId: string,
): Promise<RecommendFindingResult> {
  // 1 — the trusted diagnosis. Phase 4C owns its persistence and provenance.
  const diagnosis = await diagnoseFinding(findingId);

  // 2 — the evidence the recommendation explains, read-only.
  const pack = await assembleDiagnosisEvidencePackForFinding(findingId);

  // 3 — the frozen pure catalogue, over the TRUSTED classification. This also
  // re-validates identity, FAIL, provenance and selected/ranked integrity.
  const recommendation = buildRecommendation(pack, diagnosis.classification);

  // 4 — the only timestamp this phase creates, for the recommendation write.
  const attemptedAt = new Date().toISOString();

  // 5 — one guarded write of exactly four columns on exactly one row. The
  // Phase 4C diagnosis travels as a PRECONDITION, never as a payload.
  const persistence = await persistFindingRecommendation({
    findingId: recommendation.findingId,
    invariantResultId: recommendation.invariantResultId,
    expectedDiagnosisCode: diagnosis.persistence.diagnosisCode,
    expectedDiagnosisStrength: diagnosis.persistence.diagnosisStrength,
    expectedDiagnosedAt: diagnosis.persistence.diagnosedAt,
    diagnosisSummary: recommendation.explanation.diagnosisSummary,
    recommendationCode: recommendation.recommendation.code,
    recommendationText: recommendation.recommendation.text,
    attemptedAt,
  });

  // 6 — supplemental audit only, deliberately last and best-effort.
  emitRecommendationAuditLog(
    pack.invariant.invariantId,
    recommendation,
    diagnosis,
    persistence,
  );

  return { diagnosis, recommendation, persistence };
}
