import "server-only";

import { extractDiagnosticSignals } from "@/lib/diagnosis/diagnostic-signals";
import { assembleDiagnosisEvidencePackForFinding } from "@/lib/diagnosis/evidence-pack-service";
import { classifyRootCause } from "@/lib/diagnosis/root-cause-classifier";
import { persistFindingDiagnosis } from "@/lib/diagnosis/root-cause-repository";
import { logEvent } from "@/lib/security/logger";

import type { DiagnosisEvidencePackV1 } from "@/lib/diagnosis/evidence-pack";
import type { RootCauseClassificationV1 } from "@/lib/diagnosis/root-cause-classifier";
import type { DiagnosisPersistenceResult } from "@/lib/diagnosis/root-cause-repository";

/**
 * Phase 4C-R2 — server-only orchestration for one Finding's diagnosis.
 *
 * The whole operation is one evidence read, two pure derivations and one
 * guarded write:
 *
 *   assembleDiagnosisEvidencePackForFinding(findingId)  (Phase 4A-R2)
 *     -> extractDiagnosticSignals(pack)                 (Phase 4B-R1, pure)
 *       -> classifyRootCause(pack, signals)             (Phase 4C-R1, pure)
 *         -> persistFindingDiagnosis(...)               (Phase 4C-R2)
 *
 * ONE EVIDENCE ASSEMBLY PER DIAGNOSIS. The Evidence Pack is assembled exactly
 * once and then handed to both pure layers. This module deliberately does NOT
 * call `assembleDiagnosticSignalsForFinding`, because that server service
 * would assemble a SECOND pack for the same operation — two reads of the same
 * evidence, with a window in which they could disagree.
 *
 * ADVISORY ONLY. The deterministic invariant FAIL stays authoritative. This
 * module writes no payment, order, fulfilment, webhook, processing, chaos-run
 * or invariant-result state, never changes a Finding's `status` or
 * `resolved_at`, and never populates `diagnosis_summary`,
 * `recommendation_code` or `recommendation_text` — those belong to later
 * Phase 4 work (`docs/AI_DESIGN.md` Sections 42–49).
 *
 * `RC-016` IS A RESULT, NOT A FAILURE. Valid evidence that cannot support a
 * specific cause is persisted normally, with `INSUFFICIENT_EVIDENCE` and a
 * real timestamp. The invariant failure is proven; only the root cause is
 * not, and that distinction is made durable rather than left as a NULL.
 *
 * READ FAILURE IS NOT ABSENCE. Phase 4A service errors, the R1
 * classification errors and the R2 persistence errors all propagate
 * UNCHANGED. None of them is ever rewritten as `RC-016`: an infrastructure or
 * integrity failure must not be presented as an honest evidence-based
 * observation.
 *
 * LOGGING IS SUPPLEMENTAL. The structured audit line is emitted last and on a
 * best-effort basis. A logging fault can never turn a committed diagnosis
 * into a reported failure — see `emitDiagnosisAuditLog` below.
 *
 * NO AI. No prompt, no model, no provider client. P0 diagnosis works with
 * zero AI services available.
 */

/** The one safe structured audit event this module emits. */
const DIAGNOSIS_EVENT = "diagnosis.root_cause.persisted";

export interface DiagnoseFindingResult {
  readonly classification: RootCauseClassificationV1;
  readonly persistence: DiagnosisPersistenceResult;
}

/**
 * Writes the safe structured audit line for a diagnosis that has ALREADY been
 * committed.
 *
 * BEST-EFFORT BY DESIGN. PostgreSQL is authoritative; a structured log line is
 * supplemental. Once the Finding row carries the diagnosis, the operation has
 * genuinely succeeded, and letting a logging fault reject the call would hand
 * the caller a failure for work the database has already durably accepted —
 * an ambiguous partial success, and the worst possible answer.
 *
 * The catch is scoped to this one call and nothing else. Evidence assembly,
 * signal extraction, classification and persistence all sit OUTSIDE it, so
 * their failures continue to propagate unchanged.
 *
 * The swallowed error is deliberately not re-logged: the logger is the thing
 * that just failed, its message is uncontrolled text, and the authoritative
 * service result already tells the caller everything it needs.
 *
 * Content is identifiers, frozen vocabulary values and counts only — no
 * evidence content, no payload, no signature, no secret.
 */
function emitDiagnosisAuditLog(
  pack: DiagnosisEvidencePackV1,
  classification: RootCauseClassificationV1,
  persistence: DiagnosisPersistenceResult,
): void {
  try {
    logEvent(DIAGNOSIS_EVENT, {
      finding_id: classification.findingId,
      invariant_result_id: classification.invariantResultId,
      invariant_id: pack.invariant.invariantId,
      diagnosis_code: persistence.diagnosisCode,
      diagnosis_strength: persistence.diagnosisStrength,
      output_source: classification.outputSource,
      source_version: classification.ruleVersion,
      supporting_evidence_count:
        classification.selected.supportingSignalCodes.length,
      contradictory_evidence_count:
        classification.selected.contradictorySignalCodes.length,
      blocking_gap_count: classification.selected.blockingGapCodes.length,
      candidate_count: classification.rankedCandidates.length,
      fallback_used: classification.selected.code === "RC-016",
      diagnosed_at: persistence.diagnosedAt,
      persistence_kind: persistence.kind,
    });
  } catch {
    // Supplemental logging must never alter the authoritative persistence
    // result. No rollback, no repeated write, no re-read, and no downgrade of
    // the diagnosis that has already been committed.
  }
}

/**
 * Diagnoses one persisted Finding and durably records the selected
 * deterministic root cause.
 *
 * Deterministic apart from the single server timestamp: the classification
 * for unchanged evidence is always deep-equal, and a repeated call performs
 * no second write and returns the ORIGINAL `diagnosedAt`.
 *
 * The timestamp is generated here — the first layer permitted to create one,
 * since both pure layers are deliberately timeless — and only after a
 * classification exists. It is never accepted from a caller.
 */
export async function diagnoseFinding(
  findingId: string,
): Promise<DiagnoseFindingResult> {
  // 1 — the single evidence assembly for this operation.
  const pack = await assembleDiagnosisEvidencePackForFinding(findingId);

  // 2/3 — the two frozen pure layers, over that exact pack.
  const signals = extractDiagnosticSignals(pack);
  const classification = classifyRootCause(pack, signals);

  // 4 — the first and only timestamp, created after a result exists.
  const attemptedAt = new Date().toISOString();

  // 5 — one guarded write of exactly four columns on exactly one row.
  const persistence = await persistFindingDiagnosis({
    findingId: classification.findingId,
    invariantResultId: classification.invariantResultId,
    diagnosisCode: classification.selected.code,
    diagnosisStrength: classification.selected.strength,
    attemptedAt,
  });

  // 6 — supplemental audit only. Deliberately best-effort, and deliberately
  // last: by this point the database is already authoritative.
  emitDiagnosisAuditLog(pack, classification, persistence);

  return { classification, persistence };
}
