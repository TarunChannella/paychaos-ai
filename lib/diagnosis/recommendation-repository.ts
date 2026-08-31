import "server-only";

import { isUuid } from "@/lib/findings/types";
import { getSupabaseServerClient } from "@/lib/supabase/server";

import type {
  DiagnosisEvidenceStrength,
  RootCauseCode,
} from "@/lib/diagnosis/root-cause-classifier";
import type { RecommendationCode } from "@/lib/diagnosis/recommendations";

/**
 * Phase 4D-R2 — the ONLY writer of a Finding's advisory recommendation fields.
 *
 * EXACTLY FOUR COLUMNS, ON EXACTLY ONE ROW. A successful first recommendation
 * writes `diagnosis_summary`, `recommendation_code`, `recommendation_text` and
 * `updated_at` on one Finding named by its own id. It never writes `status`,
 * `resolved_at`, `title`, `invariant_result_id` or `created_at`, and — the
 * point of this whole module — it never writes `diagnosis_code`,
 * `diagnosis_strength` or `diagnosed_at`, which belong to Phase 4C.
 *
 * THE DIAGNOSIS IS A PRECONDITION, NOT A PAYLOAD. Those three Phase 4C fields
 * appear only as `.eq(...)` guards on the update. A recommendation is advice
 * ABOUT a diagnosis, so writing one onto a Finding whose diagnosis has since
 * changed would attach reasoning to a verdict that no longer exists.
 *
 * SELECT AND CONDITIONAL UPDATE ONLY. No INSERT, no UPSERT, no DELETE and no
 * RPC. The update is guarded so it can only succeed while the recommendation
 * fields are still NULL and the diagnosis still matches, which makes a first
 * write safe under concurrency without a retry loop.
 *
 * NEVER SILENTLY OVERWRITE OR FILL AROUND. A partially-recommended Finding, or
 * one whose stored recommendation disagrees with the deterministic output,
 * raises a typed integrity conflict. An identical re-recommendation performs
 * zero writes and preserves the original `updated_at`.
 *
 * SAFE ERRORS ONLY. Every failure surfaces as a
 * `RecommendationRepositoryError` with a stable code and a fixed message. A
 * raw Supabase error, its details, its hint, any query text and any credential
 * are never propagated.
 */

// ============================================================================
// ERROR MODEL
// ============================================================================

export const RECOMMENDATION_REPOSITORY_ERROR_CODES = Object.freeze([
  /** The supplied finding identifier is not an internal UUID. */
  "RECOMMENDATION_PERSIST_FINDING_ID_INVALID",
  /** No finding exists with that id. Genuine, established absence. */
  "RECOMMENDATION_PERSIST_FINDING_NOT_FOUND",
  /** A read did not complete. NOT the same as the record being absent. */
  "RECOMMENDATION_PERSIST_READ_FAILED",
  /** A conditional update did not complete. */
  "RECOMMENDATION_PERSIST_UPDATE_FAILED",
  /**
   * Persisted state is partial, contradicts the deterministic output, or its
   * diagnosis no longer matches the one this recommendation explains.
   */
  "RECOMMENDATION_PERSIST_INTEGRITY_CONFLICT",
] as const);

export type RecommendationRepositoryErrorCode =
  (typeof RECOMMENDATION_REPOSITORY_ERROR_CODES)[number];

export class RecommendationRepositoryError extends Error {
  readonly code: RecommendationRepositoryErrorCode;

  constructor(code: RecommendationRepositoryErrorCode, message: string) {
    super(message);
    this.name = "RecommendationRepositoryError";
    this.code = code;
  }
}

// ============================================================================
// SHAPES
// ============================================================================

/** Explicit allowlist projection. Never `select("*")`. */
const RECOMMENDATION_COLUMNS =
  "id, invariant_result_id, status, title, diagnosis_code, diagnosis_strength, diagnosis_summary, recommendation_code, recommendation_text, diagnosed_at, resolved_at, created_at, updated_at";

export interface FindingRecommendationState {
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

export type RecommendationPersistenceKind =
  "RECOMMENDED" | "ALREADY_RECOMMENDED";

export interface RecommendationPersistenceResult {
  readonly kind: RecommendationPersistenceKind;
  readonly diagnosisSummary: string;
  readonly recommendationCode: RecommendationCode;
  readonly recommendationText: string;
  /** The persisted timestamp — the original one on a repeated recommendation. */
  readonly updatedAt: string;
}

interface RecommendationRow {
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

function toState(row: RecommendationRow): FindingRecommendationState {
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

export interface PersistRecommendationInput {
  readonly findingId: string;
  readonly invariantResultId: string;
  /** Phase 4C's persisted diagnosis. Used ONLY as a precondition. */
  readonly expectedDiagnosisCode: RootCauseCode;
  readonly expectedDiagnosisStrength: DiagnosisEvidenceStrength;
  readonly expectedDiagnosedAt: string;
  readonly diagnosisSummary: string;
  readonly recommendationCode: RecommendationCode;
  readonly recommendationText: string;
  readonly attemptedAt: string;
}

type AdvisoryState =
  | { readonly kind: "FRESH" }
  | { readonly kind: "EQUIVALENT"; readonly updatedAt: string }
  | { readonly kind: "CONFLICT" };

function classifyRecommendationState(
  state: FindingRecommendationState,
  input: PersistRecommendationInput,
): AdvisoryState {
  const hasSummary = state.diagnosisSummary !== null;
  const hasCode = state.recommendationCode !== null;
  const hasText = state.recommendationText !== null;

  // Nothing recommended yet.
  if (!hasSummary && !hasCode && !hasText) return { kind: "FRESH" };

  // A complete, identical recommendation.
  if (
    hasSummary &&
    hasCode &&
    hasText &&
    state.diagnosisSummary === input.diagnosisSummary &&
    state.recommendationCode === input.recommendationCode &&
    state.recommendationText === input.recommendationText
  ) {
    return { kind: "EQUIVALENT", updatedAt: state.updatedAt };
  }

  // Everything else — a partial write, or a stored recommendation that
  // disagrees with the deterministic output — is a contradiction between
  // persisted facts. Filling around it would paper over the inconsistency.
  return { kind: "CONFLICT" };
}

/**
 * Verifies the Finding still carries exactly the diagnosis this
 * recommendation explains.
 */
function diagnosisMatches(
  state: FindingRecommendationState,
  input: PersistRecommendationInput,
): boolean {
  return (
    state.invariantResultId === input.invariantResultId &&
    state.diagnosisCode === input.expectedDiagnosisCode &&
    state.diagnosisStrength === input.expectedDiagnosisStrength &&
    state.diagnosedAt !== null &&
    state.diagnosedAt === input.expectedDiagnosedAt
  );
}

// ============================================================================
// READ
// ============================================================================

/** Reads one Finding's advisory recommendation state by its own id. */
export async function readFindingRecommendationState(
  findingId: string,
): Promise<FindingRecommendationState> {
  if (!isUuid(findingId)) {
    throw new RecommendationRepositoryError(
      "RECOMMENDATION_PERSIST_FINDING_ID_INVALID",
      "A recommendation was requested for an identifier that is not an internal UUID.",
    );
  }

  const client = getSupabaseServerClient();
  const { data, error } = await client
    .from("findings")
    .select(RECOMMENDATION_COLUMNS)
    .eq("id", findingId)
    .maybeSingle();

  if (error) {
    throw new RecommendationRepositoryError(
      "RECOMMENDATION_PERSIST_READ_FAILED",
      "The finding's recommendation state could not be read.",
    );
  }
  if (!data) {
    throw new RecommendationRepositoryError(
      "RECOMMENDATION_PERSIST_FINDING_NOT_FOUND",
      "No finding exists with this identifier.",
    );
  }

  return toState(data as unknown as RecommendationRow);
}

// ============================================================================
// CONDITIONAL WRITE
// ============================================================================

/**
 * Persists the deterministic recommendation onto one Finding, once.
 *
 * Idempotent by construction: the update is conditional on the recommendation
 * fields still being NULL AND the Phase 4C diagnosis still matching, so a
 * second caller cannot overwrite the first, and an identical
 * re-recommendation returns the ORIGINAL `updated_at` rather than the
 * timestamp this attempt generated.
 */
export async function persistFindingRecommendation(
  input: PersistRecommendationInput,
): Promise<RecommendationPersistenceResult> {
  const existing = await readFindingRecommendationState(input.findingId);

  // The diagnosis this recommendation explains must still be the one on the
  // row. Checked before anything else: a recommendation for a superseded
  // verdict is meaningless, however well-formed.
  if (!diagnosisMatches(existing, input)) {
    throw new RecommendationRepositoryError(
      "RECOMMENDATION_PERSIST_INTEGRITY_CONFLICT",
      "The finding's persisted diagnosis does not match the diagnosis this recommendation explains.",
    );
  }

  const state = classifyRecommendationState(existing, input);

  if (state.kind === "CONFLICT") {
    throw new RecommendationRepositoryError(
      "RECOMMENDATION_PERSIST_INTEGRITY_CONFLICT",
      "The finding's persisted recommendation state is incomplete or disagrees with the deterministic result.",
    );
  }

  if (state.kind === "EQUIVALENT") {
    // Case B — already recommended identically. Zero writes, and the original
    // lifecycle timestamp is returned unchanged.
    return {
      kind: "ALREADY_RECOMMENDED",
      diagnosisSummary: input.diagnosisSummary,
      recommendationCode: input.recommendationCode,
      recommendationText: input.recommendationText,
      updatedAt: state.updatedAt,
    };
  }

  // Case A — one conditional update. Pinned to this exact finding and its
  // invariant result, guarded on the exact Phase 4C diagnosis triplet, and
  // guarded so it can only apply while every recommendation field is NULL.
  //
  // Deliberately NOT guarded on `status`: recommendation ownership must not
  // reinterpret or depend on the Phase 4E lifecycle.
  const client = getSupabaseServerClient();
  const { data, error } = await client
    .from("findings")
    .update({
      diagnosis_summary: input.diagnosisSummary,
      recommendation_code: input.recommendationCode,
      recommendation_text: input.recommendationText,
      updated_at: input.attemptedAt,
    })
    .eq("id", input.findingId)
    .eq("invariant_result_id", input.invariantResultId)
    .eq("diagnosis_code", input.expectedDiagnosisCode)
    .eq("diagnosis_strength", input.expectedDiagnosisStrength)
    .eq("diagnosed_at", input.expectedDiagnosedAt)
    .is("diagnosis_summary", null)
    .is("recommendation_code", null)
    .is("recommendation_text", null)
    .select(RECOMMENDATION_COLUMNS)
    .maybeSingle();

  if (error) {
    throw new RecommendationRepositoryError(
      "RECOMMENDATION_PERSIST_UPDATE_FAILED",
      "The finding's recommendation could not be persisted.",
    );
  }

  if (data) {
    const written = toState(data as unknown as RecommendationRow);
    return {
      kind: "RECOMMENDED",
      diagnosisSummary: input.diagnosisSummary,
      recommendationCode: input.recommendationCode,
      recommendationText: input.recommendationText,
      updatedAt: written.updatedAt,
    };
  }

  // The guarded update matched no row: another writer recommended this
  // finding between the read and the write. Re-read once — NOT a retry of the
  // write — and accept only an identical winning recommendation.
  const winner = await readFindingRecommendationState(input.findingId);
  if (diagnosisMatches(winner, input)) {
    const winnerState = classifyRecommendationState(winner, input);
    if (winnerState.kind === "EQUIVALENT") {
      // Case E — concurrent equivalent writer.
      return {
        kind: "ALREADY_RECOMMENDED",
        diagnosisSummary: input.diagnosisSummary,
        recommendationCode: input.recommendationCode,
        recommendationText: input.recommendationText,
        updatedAt: winnerState.updatedAt,
      };
    }
  }

  // Case F — the winning recommendation differs, or the diagnosis moved.
  throw new RecommendationRepositoryError(
    "RECOMMENDATION_PERSIST_INTEGRITY_CONFLICT",
    "The finding was recommended concurrently with a different result.",
  );
}
