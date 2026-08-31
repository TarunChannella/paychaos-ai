import "server-only";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/findings/types";

import type {
  DiagnosisEvidenceStrength,
  RootCauseCode,
} from "@/lib/diagnosis/root-cause-classifier";

/**
 * Phase 4C-R2 — the ONLY writer of a Finding's advisory diagnosis fields.
 *
 * This repository exists so Phase 4 diagnosis persistence lives with the
 * diagnosis domain rather than being bolted onto the frozen Phase 3G Finding
 * repository, which deliberately never writes a diagnosis field.
 *
 * EXACTLY FOUR COLUMNS, ON EXACTLY ONE ROW. A successful first diagnosis
 * writes `diagnosis_code`, `diagnosis_strength`, `diagnosed_at` and
 * `updated_at` on one Finding named by its own id. It never writes
 * `status`, `resolved_at`, `title`, `invariant_result_id`, `created_at`,
 * `diagnosis_summary`, `recommendation_code` or `recommendation_text`, and it
 * never touches `orders`, `payment_attempts`, `payments`, `fulfilments`,
 * `webhook_events`, `event_processing_attempts`, `chaos_runs` or
 * `invariant_results`.
 *
 * ADVISORY, NEVER AUTHORITATIVE. A diagnosis is a ranked engineering
 * hypothesis. The deterministic invariant FAIL it reports stays authoritative
 * and untouched (`docs/DATABASE.md` Section 17).
 *
 * SELECT AND CONDITIONAL UPDATE ONLY. No INSERT, no UPSERT, no DELETE and no
 * RPC. The update is guarded so it can only succeed while the advisory fields
 * are still in their fresh post-Phase-3G state, which makes a first write
 * safe under concurrency without a retry loop.
 *
 * NEVER SILENTLY OVERWRITE. A Finding whose diagnosis state is partial, or
 * whose existing diagnosis disagrees with the deterministic result, raises a
 * typed integrity conflict rather than being rewritten. An identical
 * re-diagnosis performs zero writes and preserves the original timestamps.
 *
 * SAFE ERRORS ONLY. Every failure surfaces as a `RootCauseRepositoryError`
 * with a stable code and a fixed message. A raw Supabase error, its details,
 * its hint, any query text and any credential are never propagated.
 */

// ============================================================================
// ERROR MODEL
// ============================================================================

export const ROOT_CAUSE_REPOSITORY_ERROR_CODES = Object.freeze([
  /** The supplied finding identifier is not an internal UUID. */
  "DIAGNOSIS_PERSIST_FINDING_ID_INVALID",
  /** No finding exists with that id. Genuine, established absence. */
  "DIAGNOSIS_PERSIST_FINDING_NOT_FOUND",
  /** A read did not complete. NOT the same as the record being absent. */
  "DIAGNOSIS_PERSIST_READ_FAILED",
  /** A conditional update did not complete. */
  "DIAGNOSIS_PERSIST_UPDATE_FAILED",
  /** Persisted advisory state is partial or contradicts the deterministic result. */
  "DIAGNOSIS_PERSIST_INTEGRITY_CONFLICT",
] as const);

export type RootCauseRepositoryErrorCode =
  (typeof ROOT_CAUSE_REPOSITORY_ERROR_CODES)[number];

export class RootCauseRepositoryError extends Error {
  readonly code: RootCauseRepositoryErrorCode;

  constructor(code: RootCauseRepositoryErrorCode, message: string) {
    super(message);
    this.name = "RootCauseRepositoryError";
    this.code = code;
  }
}

// ============================================================================
// SHAPES
// ============================================================================

/** Explicit allowlist projection. Never `select("*")`. */
const DIAGNOSIS_COLUMNS =
  "id, invariant_result_id, status, title, diagnosis_code, diagnosis_strength, diagnosis_summary, recommendation_code, recommendation_text, diagnosed_at, resolved_at, created_at, updated_at";

/** The advisory state of one Finding, as persisted. */
export interface FindingDiagnosisState {
  readonly id: string;
  readonly invariantResultId: string;
  readonly diagnosisCode: string | null;
  readonly diagnosisStrength: string | null;
  readonly diagnosisSummary: string | null;
  readonly recommendationCode: string | null;
  readonly recommendationText: string | null;
  readonly diagnosedAt: string | null;
  readonly updatedAt: string;
}

export type DiagnosisPersistenceKind = "DIAGNOSED" | "ALREADY_DIAGNOSED";

export interface DiagnosisPersistenceResult {
  readonly kind: DiagnosisPersistenceKind;
  readonly diagnosisCode: RootCauseCode;
  readonly diagnosisStrength: DiagnosisEvidenceStrength;
  /** The persisted timestamp — the original one on a repeated diagnosis. */
  readonly diagnosedAt: string;
  readonly updatedAt: string;
}

interface DiagnosisRow {
  readonly id: string;
  readonly invariant_result_id: string;
  readonly diagnosis_code: string | null;
  readonly diagnosis_strength: string | null;
  readonly diagnosis_summary: string | null;
  readonly recommendation_code: string | null;
  readonly recommendation_text: string | null;
  readonly diagnosed_at: string | null;
  readonly updated_at: string;
}

function toState(row: DiagnosisRow): FindingDiagnosisState {
  return {
    id: row.id,
    invariantResultId: row.invariant_result_id,
    diagnosisCode: row.diagnosis_code,
    diagnosisStrength: row.diagnosis_strength,
    diagnosisSummary: row.diagnosis_summary,
    recommendationCode: row.recommendation_code,
    recommendationText: row.recommendation_text,
    diagnosedAt: row.diagnosed_at,
    updatedAt: row.updated_at,
  };
}

// ============================================================================
// STATE CLASSIFICATION
// ============================================================================

/**
 * How a Finding's persisted advisory state compares to a new deterministic
 * result.
 *
 * `FRESH` is deliberately strict: every advisory field must still be NULL. A
 * Finding carrying a summary or recommendation but no diagnosis is not fresh,
 * it is inconsistent, and writing a diagnosis over it would paper that over.
 */
type AdvisoryState =
  | { readonly kind: "FRESH" }
  | { readonly kind: "EQUIVALENT"; readonly diagnosedAt: string }
  | { readonly kind: "CONFLICT" };

function classifyAdvisoryState(
  state: FindingDiagnosisState,
  code: RootCauseCode,
  strength: DiagnosisEvidenceStrength,
): AdvisoryState {
  const hasCode = state.diagnosisCode !== null;
  const hasStrength = state.diagnosisStrength !== null;
  const hasDiagnosedAt = state.diagnosedAt !== null;
  const hasLaterPhaseField =
    state.diagnosisSummary !== null ||
    state.recommendationCode !== null ||
    state.recommendationText !== null;

  // Nothing has been diagnosed yet, and no later-phase field exists that
  // would imply a diagnosis once did.
  if (!hasCode && !hasStrength && !hasDiagnosedAt && !hasLaterPhaseField) {
    return { kind: "FRESH" };
  }

  // A complete, identical diagnosis. Later phases may legitimately have added
  // a summary or recommendation since; those are not this phase's to compare.
  if (
    hasCode &&
    hasStrength &&
    hasDiagnosedAt &&
    state.diagnosisCode === code &&
    state.diagnosisStrength === strength
  ) {
    return { kind: "EQUIVALENT", diagnosedAt: state.diagnosedAt! };
  }

  // Everything else — a partial write, a missing timestamp, a summary with no
  // diagnosis, or a disagreeing code or strength — is a contradiction between
  // persisted facts and must never be silently rewritten.
  return { kind: "CONFLICT" };
}

// ============================================================================
// READ
// ============================================================================

/** Reads one Finding's advisory diagnosis state by its own id. */
export async function readFindingDiagnosisState(
  findingId: string,
): Promise<FindingDiagnosisState> {
  if (!isUuid(findingId)) {
    throw new RootCauseRepositoryError(
      "DIAGNOSIS_PERSIST_FINDING_ID_INVALID",
      "A diagnosis was requested for an identifier that is not an internal UUID.",
    );
  }

  const client = getSupabaseServerClient();
  const { data, error } = await client
    .from("findings")
    .select(DIAGNOSIS_COLUMNS)
    .eq("id", findingId)
    .maybeSingle();

  if (error) {
    throw new RootCauseRepositoryError(
      "DIAGNOSIS_PERSIST_READ_FAILED",
      "The finding's diagnosis state could not be read.",
    );
  }
  if (!data) {
    throw new RootCauseRepositoryError(
      "DIAGNOSIS_PERSIST_FINDING_NOT_FOUND",
      "No finding exists with this identifier.",
    );
  }

  return toState(data as unknown as DiagnosisRow);
}

// ============================================================================
// CONDITIONAL WRITE
// ============================================================================

/**
 * Persists the selected deterministic diagnosis onto one Finding, once.
 *
 * Idempotent by construction: the update is conditional on the advisory
 * fields still being fresh, so a second caller cannot overwrite the first,
 * and an identical re-diagnosis returns the ORIGINAL `diagnosed_at` rather
 * than the timestamp this attempt generated.
 *
 * `attemptedAt` is generated server-side by the caller after a classification
 * exists. It is used only for a genuine first write.
 */
export async function persistFindingDiagnosis(input: {
  readonly findingId: string;
  readonly invariantResultId: string;
  readonly diagnosisCode: RootCauseCode;
  readonly diagnosisStrength: DiagnosisEvidenceStrength;
  readonly attemptedAt: string;
}): Promise<DiagnosisPersistenceResult> {
  const {
    findingId,
    invariantResultId,
    diagnosisCode,
    diagnosisStrength,
    attemptedAt,
  } = input;

  const existing = await readFindingDiagnosisState(findingId);

  if (existing.invariantResultId !== invariantResultId) {
    throw new RootCauseRepositoryError(
      "DIAGNOSIS_PERSIST_INTEGRITY_CONFLICT",
      "The finding does not report the invariant result this diagnosis was derived from.",
    );
  }

  const state = classifyAdvisoryState(
    existing,
    diagnosisCode,
    diagnosisStrength,
  );

  if (state.kind === "CONFLICT") {
    throw new RootCauseRepositoryError(
      "DIAGNOSIS_PERSIST_INTEGRITY_CONFLICT",
      "The finding's persisted diagnosis state is incomplete or disagrees with the deterministic result.",
    );
  }

  if (state.kind === "EQUIVALENT") {
    // Case B — already diagnosed identically. Zero writes, and the original
    // lifecycle timestamps are returned unchanged.
    return {
      kind: "ALREADY_DIAGNOSED",
      diagnosisCode,
      diagnosisStrength,
      diagnosedAt: state.diagnosedAt,
      updatedAt: existing.updatedAt,
    };
  }

  // Case A — one conditional update, pinned to this exact finding and its
  // invariant result, and guarded so it can only apply while EVERY advisory
  // field is still NULL. No status, scenario, date or other broad predicate.
  const client = getSupabaseServerClient();
  const { data, error } = await client
    .from("findings")
    .update({
      diagnosis_code: diagnosisCode,
      diagnosis_strength: diagnosisStrength,
      diagnosed_at: attemptedAt,
      updated_at: attemptedAt,
    })
    .eq("id", findingId)
    .eq("invariant_result_id", invariantResultId)
    .is("diagnosis_code", null)
    .is("diagnosis_strength", null)
    .is("diagnosed_at", null)
    .is("diagnosis_summary", null)
    .is("recommendation_code", null)
    .is("recommendation_text", null)
    .select(DIAGNOSIS_COLUMNS)
    .maybeSingle();

  if (error) {
    throw new RootCauseRepositoryError(
      "DIAGNOSIS_PERSIST_UPDATE_FAILED",
      "The finding's diagnosis could not be persisted.",
    );
  }

  if (data) {
    const written = toState(data as unknown as DiagnosisRow);
    if (written.diagnosedAt === null) {
      // Structurally impossible: this update set the column. Fails closed
      // rather than reporting a diagnosis whose timestamp is unknown.
      throw new RootCauseRepositoryError(
        "DIAGNOSIS_PERSIST_INTEGRITY_CONFLICT",
        "The persisted diagnosis is missing its diagnosis timestamp.",
      );
    }
    return {
      kind: "DIAGNOSED",
      diagnosisCode,
      diagnosisStrength,
      diagnosedAt: written.diagnosedAt,
      updatedAt: written.updatedAt,
    };
  }

  // The guarded update matched no row: another writer diagnosed this finding
  // between the read and the write. Re-read once — NOT a retry of the write —
  // and accept only an identical winning diagnosis.
  const winner = await readFindingDiagnosisState(findingId);
  const winnerState = classifyAdvisoryState(
    winner,
    diagnosisCode,
    diagnosisStrength,
  );

  if (winnerState.kind === "EQUIVALENT") {
    // Case D — concurrent equivalent writer.
    return {
      kind: "ALREADY_DIAGNOSED",
      diagnosisCode,
      diagnosisStrength,
      diagnosedAt: winnerState.diagnosedAt,
      updatedAt: winner.updatedAt,
    };
  }

  // Case E — the winning diagnosis differs, or the row is now inconsistent.
  throw new RootCauseRepositoryError(
    "DIAGNOSIS_PERSIST_INTEGRITY_CONFLICT",
    "The finding was diagnosed concurrently with a different result.",
  );
}
