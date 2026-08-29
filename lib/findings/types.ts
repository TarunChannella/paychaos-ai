import type {
  FindingDiagnosisStrength,
  FindingStatus,
  InvariantResultEvidenceRef,
  InvariantResultInvariantId,
  InvariantResultSeverity,
} from "@/lib/supabase/types";

/**
 * Phase 3G — the Finding domain contract.
 *
 * A Finding reports an already-persisted deterministic failure. It never
 * decides that something failed: the only thing that can bring one into
 * existence is a persisted `invariant_results` row whose `result` is `FAIL`.
 * `PASS` and `UNKNOWN` produce nothing, and `UNKNOWN` in particular is NEVER
 * upgraded to a Finding merely because the evidence was insufficient.
 *
 * NOTHING IS COPIED. Severity, expected/observed state, the deterministic
 * reason and the evidence references all live on the immutable invariant
 * result and are read through the foreign key. A duplicate could only ever
 * drift from, or contradict, the authoritative record.
 *
 * This module deliberately re-exports the two database vocabularies rather
 * than redeclaring them, so the domain and the database can never disagree
 * about what `status` or `diagnosis_strength` may hold.
 */

export type { FindingStatus, FindingDiagnosisStrength };

/** Every `findings` column, as persisted. */
export interface FindingRow {
  readonly id: string;
  readonly invariantResultId: string;
  readonly status: FindingStatus;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * What one generation attempt did.
 *
 * `CREATED` and `ALREADY_PRESENT` both carry the authoritative row, so a
 * caller never has to re-query to learn the outcome. `NO_FINDING_REQUIRED` is
 * a NORMAL disposition, not a failure: a `PASS` or `UNKNOWN` result simply has
 * no issue to report.
 */
export type FindingGenerationResult =
  | { readonly kind: "CREATED"; readonly finding: FindingRow }
  | { readonly kind: "ALREADY_PRESENT"; readonly finding: FindingRow }
  | {
      readonly kind: "NO_FINDING_REQUIRED";
      readonly invariantResultId: string;
      readonly result: "PASS" | "UNKNOWN";
      readonly reason: "RESULT_NOT_FAIL";
    };

/** One row's contribution to a run-level generation summary. */
export interface FindingRunGenerationEntry {
  readonly invariantResultId: string;
  readonly invariantId: InvariantResultInvariantId;
  readonly findingId: string;
  readonly kind: "CREATED" | "ALREADY_PRESENT";
}

/** One row the run-level generator deliberately did not act on. */
export interface FindingRunSkippedEntry {
  readonly invariantResultId: string;
  readonly invariantId: InvariantResultInvariantId;
  readonly result: "PASS" | "UNKNOWN";
  readonly reason: "RESULT_NOT_FAIL";
}

/**
 * The deterministic run-level summary.
 *
 * `evaluatedResultCount` counts persisted invariant results for the run — it
 * does NOT re-evaluate anything. A run with no persisted results yields zeros
 * rather than an error: distinguishing "unknown run" from "run with no
 * results" is Phase 3H's job, and reaching for `chaos_runs` here would add a
 * dependency this phase does not need.
 */
export interface FindingRunGenerationSummary {
  readonly chaosRunId: string;
  readonly evaluatedResultCount: number;
  readonly failedResultCount: number;
  readonly findings: readonly FindingRunGenerationEntry[];
  readonly skipped: readonly FindingRunSkippedEntry[];
}

/**
 * The Finding Detail read model — the server-side contract Phase 3H will
 * consume unchanged.
 *
 * The finding's own persisted fields sit alongside the linked invariant
 * result's immutable facts in ONE object, while persistence stays normalized.
 * Diagnosis and recommendation are deliberately absent: they are Phase 4
 * surface, they are NULL after Phase 3G creation, and exposing them here would
 * invite a caller to depend on a field this phase never populates.
 *
 * No raw payload, no signature, no secret and no customer PII can reach this
 * shape — every field originates from a column the frozen Phase 3F-A migration
 * already constrains to sanitized deterministic text or a reference.
 */
export interface FindingDetail {
  readonly findingId: string;
  readonly invariantResultId: string;
  readonly status: FindingStatus;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;

  readonly invariant: {
    readonly invariantId: InvariantResultInvariantId;
    readonly invariantVersion: string;
    readonly severity: InvariantResultSeverity;
    readonly expectedSummary: string;
    readonly observedSummary: string;
    readonly reason: string;
    readonly evaluatedAt: string;
    readonly evidenceRefs: readonly InvariantResultEvidenceRef[];
  };

  readonly correlations: {
    readonly chaosRunId: string | null;
    readonly orderId: string | null;
    readonly paymentAttemptId: string | null;
    readonly paymentId: string | null;
  };
}

/** Stable error codes. No raw database text is ever exposed through these. */
export const FINDING_ERROR_CODES = Object.freeze([
  "FINDING_INVARIANT_RESULT_ID_INVALID",
  "FINDING_CHAOS_RUN_ID_INVALID",
  "FINDING_INVARIANT_RESULT_NOT_FOUND",
  "FINDING_INVARIANT_UNKNOWN",
  "FINDING_INVARIANT_VERSION_MISMATCH",
  "FINDING_INTEGRITY_CONFLICT",
  "FINDING_INSERT_FAILED",
  "FINDING_READ_FAILED",
  "FINDING_NOT_FOUND",
] as const);

export type FindingErrorCode = (typeof FINDING_ERROR_CODES)[number];

/**
 * The canonical UUID shape. Phase 3G accepts internal identifiers only, so an
 * input that is not a UUID is rejected before it can reach the database.
 */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}
