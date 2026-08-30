/**
 * Phase 4A-R2 — server-only orchestration for one Finding's Evidence Pack.
 *
 * The whole operation is three reads and one pure build:
 *
 *   findings            -> the persisted Finding, by its own id
 *   invariant_results   -> the authoritative verdict it reports
 *   chaos evidence      -> the frozen Phase 3 assembler, when a run correlates
 *   buildDiagnosisEvidencePack(...)
 *
 * There is no fourth step. This module assigns no verdict, derives no signal,
 * classifies no root cause, produces no recommendation, writes nothing and
 * calls no AI provider. Every decision that could be called a judgement —
 * the FAIL-only gate, identity checks, chaos-run compatibility, gaps, the safe
 * narrow projection and deterministic ordering — belongs to the frozen R1 pure
 * builder, which stays authoritative.
 *
 * THE FINDING IS THE ENTRY BOUNDARY (docs/AI_DESIGN.md Section 10). The only
 * accepted input is an existing persisted Finding id. This module never scans
 * payments, orders or webhook events looking for something that might be
 * wrong, and it cannot be pointed at an arbitrary payment identifier: a
 * diagnosis may begin only from a deterministic failure that already exists.
 *
 * STRICTLY READ-ONLY. It performs zero INSERT, UPDATE, UPSERT, DELETE and zero
 * mutating RPC. It never creates a Finding, never populates a diagnosis field,
 * never touches `diagnosed_at`, and never modifies an invariant result, chaos
 * run, order, payment attempt, payment, fulfilment, webhook event or
 * processing attempt. Assembling evidence must never change the evidence it is
 * assembling.
 *
 * READ FAILURE IS NOT ABSENCE. A database error never degrades into "no
 * finding" or "no evidence". Genuine absence produces either a typed service
 * error (the Finding does not exist) or an R1 gap inside a valid pack (the
 * optional evidence does not exist). An inability to establish a fact produces
 * an error and never a pack that quietly implies the fact was checked.
 */

import "server-only";

import { buildDiagnosisEvidencePack } from "@/lib/diagnosis/evidence-pack";
import type { DiagnosisEvidencePackV1 } from "@/lib/diagnosis/evidence-pack";
import { assembleChaosRunEvidence } from "@/lib/evidence/chaos-evidence-service";
import type { ChaosRunEvidenceBundleV1 } from "@/lib/evidence/chaos-run-evidence";
import {
  findFindingById,
  findInvariantResultById,
} from "@/lib/findings/repository";
import { getFindingDetailByInvariantResultId } from "@/lib/findings/service";
import type { FindingDetail } from "@/lib/findings/types";
import type { InvariantResultValue } from "@/lib/supabase/types";

// ============================================================================
// ERROR MODEL
// ============================================================================

/**
 * Stable machine-readable service failures.
 *
 * These are deliberately distinct from the R1 gap vocabulary. A GAP says a
 * fact is genuinely absent and the pack is still valid. An ERROR here says a
 * fact could not be established at all, so no pack is returned rather than one
 * that understates what is known.
 *
 * Every message is a fixed safe string. A raw Supabase error, SQL fragment,
 * credential, connection detail or database response never travels through
 * these — the constructor accepts no such value.
 */
export const EVIDENCE_PACK_SERVICE_ERROR_CODES = Object.freeze([
  /** The supplied finding identifier is not an internal UUID. */
  "EVIDENCE_PACK_FINDING_ID_INVALID",
  /** No finding exists with that id. Genuine, established absence. */
  "EVIDENCE_PACK_FINDING_NOT_FOUND",
  /** The finding exists but the invariant result it reports could not be resolved. */
  "EVIDENCE_PACK_INVARIANT_RESULT_NOT_FOUND",
  /** Two persisted facts contradict each other. Fails closed; never papered over. */
  "EVIDENCE_PACK_INTEGRITY_CONFLICT",
  /** A read did not complete. NOT the same as the record being absent. */
  "EVIDENCE_PACK_READ_FAILED",
] as const);

export type EvidencePackServiceErrorCode =
  (typeof EVIDENCE_PACK_SERVICE_ERROR_CODES)[number];

export class EvidencePackServiceError extends Error {
  readonly code: EvidencePackServiceErrorCode;

  constructor(code: EvidencePackServiceErrorCode, message: string) {
    super(message);
    this.name = "EvidencePackServiceError";
    this.code = code;
  }
}

/**
 * The stable code an underlying frozen module reported, when it exposes one.
 *
 * Only the code is inspected. The underlying message is never read, never
 * re-thrown and never copied into a service error, so no raw database text can
 * escape through this path.
 */
function underlyingCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

/**
 * Maps a frozen read failure onto this module's vocabulary.
 *
 * The distinction that matters: a code meaning "could not read" becomes
 * `EVIDENCE_PACK_READ_FAILED`, and an unrecognised failure is also treated as
 * a read failure rather than being optimistically downgraded to absence. Only
 * an explicit, established `null` from a read is ever treated as absence, and
 * that decision is made by the caller below, never here.
 */
function toReadFailure(error: unknown, message: string): never {
  const code = underlyingCode(error);
  if (code === "FINDING_INVARIANT_RESULT_ID_INVALID") {
    throw new EvidencePackServiceError(
      "EVIDENCE_PACK_FINDING_ID_INVALID",
      "An evidence pack was requested for an identifier that is not an internal UUID.",
    );
  }
  throw new EvidencePackServiceError("EVIDENCE_PACK_READ_FAILED", message);
}

// ============================================================================
// ORCHESTRATION
// ============================================================================

/**
 * Assembles the deterministic Evidence Pack for one persisted Finding.
 *
 * Deterministic: called twice against unchanged data it returns a semantically
 * identical pack. Nothing here reads the clock, generates an identifier or
 * consults randomness.
 *
 * Throws `EvidencePackServiceError` when a required fact cannot be
 * established, and lets the R1 `EvidencePackError` propagate unchanged so the
 * FAIL-only gate and the identity checks stay fail-closed exactly as the pure
 * builder defines them.
 */
export async function assembleDiagnosisEvidencePackForFinding(
  findingId: string,
): Promise<DiagnosisEvidencePackV1> {
  // 1 — the Finding itself. This is the entry boundary.
  let finding: Awaited<ReturnType<typeof findFindingById>>;
  try {
    finding = await findFindingById(findingId);
  } catch (error) {
    toReadFailure(error, "The finding could not be read.");
  }

  if (finding === null) {
    // Established absence: the read succeeded and returned no row.
    throw new EvidencePackServiceError(
      "EVIDENCE_PACK_FINDING_NOT_FOUND",
      "No finding exists with this identifier.",
    );
  }

  // 2 — the authoritative verdict. `FindingDetail` deliberately does not carry
  // the persisted `result`, so it is read here and handed to the builder
  // separately, letting the builder verify the FAIL-only gate for itself
  // rather than trusting this module.
  let resultRow: Awaited<ReturnType<typeof findInvariantResultById>>;
  try {
    resultRow = await findInvariantResultById(finding.invariantResultId);
  } catch (error) {
    toReadFailure(
      error,
      "The authoritative invariant result could not be read.",
    );
  }

  if (resultRow === null) {
    // Structurally impossible while the FK holds: `findings.invariant_result_id`
    // is NOT NULL and ON DELETE RESTRICT. Treated as an integrity failure, not
    // a routine miss.
    throw new EvidencePackServiceError(
      "EVIDENCE_PACK_INVARIANT_RESULT_NOT_FOUND",
      "The invariant result this finding reports could not be resolved.",
    );
  }

  // 3 — the safe Finding projection, reusing the frozen Phase 3G read model
  // rather than re-deriving it here, so the two can never drift apart.
  let detail: FindingDetail;
  try {
    detail = await getFindingDetailByInvariantResultId(
      finding.invariantResultId,
    );
  } catch (error) {
    const code = underlyingCode(error);
    if (code === "FINDING_NOT_FOUND" || code === "FINDING_INTEGRITY_CONFLICT") {
      // The finding was present a moment ago, so its disappearance or an
      // unreadable result is a contradiction rather than routine absence.
      throw new EvidencePackServiceError(
        "EVIDENCE_PACK_INTEGRITY_CONFLICT",
        "The finding and its invariant result could not be resolved consistently.",
      );
    }
    toReadFailure(error, "The finding detail could not be read.");
  }

  // The unique constraint on `invariant_result_id` means exactly one finding
  // reports a given result, so these two must name the same row.
  if (detail.findingId !== finding.id) {
    throw new EvidencePackServiceError(
      "EVIDENCE_PACK_INTEGRITY_CONFLICT",
      "The finding resolved through its invariant result is not the finding requested.",
    );
  }

  // 4 — chaos evidence, only when the Finding actually correlates to a run.
  // A baseline finding gets `null` and an honest gap from the builder; no
  // scenario, provenance or processing context is invented for it.
  let chaosEvidence: ChaosRunEvidenceBundleV1 | null = null;
  const chaosRunId = detail.correlations.chaosRunId;

  if (chaosRunId !== null) {
    let assembled: ChaosRunEvidenceBundleV1 | null;
    try {
      assembled = await assembleChaosRunEvidence(chaosRunId);
    } catch (error) {
      // A read failure here must never be reported as "this run had no
      // evidence" — that would understate what is unknown.
      toReadFailure(error, "The chaos run evidence could not be read.");
    }

    if (assembled === null) {
      // The invariant result holds an FK to this run, so an absent run row is
      // a contradiction between two persisted facts, not routine absence.
      throw new EvidencePackServiceError(
        "EVIDENCE_PACK_INTEGRITY_CONFLICT",
        "The chaos run this finding correlates to could not be resolved.",
      );
    }
    chaosEvidence = assembled;
  }

  // 5 — the pure builder decides everything else. Its errors propagate
  // unchanged: a non-FAIL source or a mismatched identity must fail closed.
  return buildDiagnosisEvidencePack({
    finding: detail,
    invariantResult: {
      id: resultRow.id,
      result: resultRow.result as InvariantResultValue,
    },
    chaosEvidence,
  });
}
