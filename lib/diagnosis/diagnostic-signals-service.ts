/**
 * Phase 4B-R2 — server-only orchestration for one Finding's diagnostic signals.
 *
 * The whole operation is one read and one pure derivation:
 *
 *   assembleDiagnosisEvidencePackForFinding(findingId)  -> the ONE evidence surface
 *   extractDiagnosticSignals(pack)                      -> the frozen R1 rules
 *
 * There is no third step. This module contains no signal rule, no threshold,
 * no root-cause classification, no evidence-strength judgement, no
 * recommendation, no regression logic, no score and no readiness rule. Those
 * belong to Phase 4C and later (`docs/AI_DESIGN.md` Sections 14–40).
 *
 * ONE EVIDENCE SURFACE. Every persisted fact reaches the signal rules through
 * the Phase 4A service, which already owns evidence assembly. This module
 * never queries `orders`, `payment_attempts`, `payments`, `fulfilments`,
 * `webhook_events`, `event_processing_attempts`, `chaos_runs`,
 * `invariant_results` or `findings`, and never builds a second evidence model.
 * A second reader would be a second version of the truth.
 *
 * THE FINDING IS THE ENTRY BOUNDARY (`docs/AI_DESIGN.md` Section 10). The only
 * accepted input is an existing persisted Finding id, which the Phase 4A
 * service validates. Signals cannot be requested for an arbitrary payment or
 * order identifier.
 *
 * STRICTLY READ-ONLY. Zero INSERT, UPDATE, UPSERT, DELETE and zero mutating
 * RPC. It never writes `diagnosis_code`, `diagnosis_strength`,
 * `diagnosis_summary`, `recommendation_code`, `recommendation_text` or
 * `diagnosed_at`, never changes a Finding's status, and never touches an
 * invariant result, chaos run or any merchant row. Deriving an observation
 * must never change the evidence it observes.
 *
 * READ FAILURE IS NOT ABSENCE. Phase 4A service errors propagate UNCHANGED.
 * A read that did not complete must never be rewritten as thirteen `UNKNOWN`
 * signals: that would present an infrastructure failure as an honest,
 * evidence-based observation. `UNKNOWN` is a claim about evidence, and it is
 * only ever made by the frozen R1 extractor about a pack that genuinely
 * assembled (`docs/MONEY_INVARIANTS.md` Principle 3).
 *
 * SIGNALS ARE ADVISORY. The deterministic invariant result stays
 * authoritative. Nothing here can change a PASS/FAIL verdict, and no AI or LLM
 * participates at any point.
 */

import "server-only";

import { extractDiagnosticSignals } from "@/lib/diagnosis/diagnostic-signals";
import type { DiagnosticSignalSetV1 } from "@/lib/diagnosis/diagnostic-signals";
import { assembleDiagnosisEvidencePackForFinding } from "@/lib/diagnosis/evidence-pack-service";

/**
 * Derives the deterministic diagnostic signal set for one persisted Finding.
 *
 * Deterministic: called twice against unchanged data it returns a deep-equal
 * set. Nothing here reads the clock, generates an identifier or consults
 * randomness, and the assembled pack is passed to the extractor exactly as
 * received — neither the pack nor the returned set is copied, reshaped,
 * filtered or otherwise adjusted.
 *
 * Every error from the Phase 4A service propagates unchanged, so a failure to
 * establish the evidence surfaces as a failure rather than as an empty or
 * uniformly-unknown result.
 */
export async function assembleDiagnosticSignalsForFinding(
  findingId: string,
): Promise<DiagnosticSignalSetV1> {
  const pack = await assembleDiagnosisEvidencePackForFinding(findingId);
  return extractDiagnosticSignals(pack);
}
