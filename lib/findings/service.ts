import "server-only";

import type { InvariantResultInvariantId } from "@/lib/supabase/types";

import {
  deterministicFindingTitle,
  findFindingByInvariantResultId,
  findInvariantResultById,
  insertOpenFinding,
  listInvariantResultsForChaosRun,
  type InvariantResultDbRow,
} from "./repository";
import {
  isUuid,
  type FindingDetail,
  type FindingErrorCode,
  type FindingGenerationResult,
  type FindingRunGenerationEntry,
  type FindingRunGenerationSummary,
  type FindingRunSkippedEntry,
} from "./types";

/**
 * Phase 3G — Finding generation orchestration.
 *
 * THE TRUTH CHAIN, and the only one:
 *
 *   persisted invariant_results.result = 'FAIL'  ->  a Finding may exist
 *   PASS / UNKNOWN                               ->  no Finding, ever
 *
 * Nothing else may bring a Finding into existence. Not `chaos_runs.outcome`,
 * not a scenario ID, not a severity, not caller-supplied data, and certainly
 * not an LLM. The caller supplies ONE internal UUID; every fact used to build
 * the finding is loaded from authoritative persisted state.
 *
 * UNKNOWN IS NOT A FAILURE. An `UNKNOWN` result means the rule applied but the
 * evidence was insufficient. Converting that into a Finding would manufacture
 * a reliability issue out of missing evidence, which is exactly the confusion
 * the frozen Phase 3F-B evaluators exist to prevent. `UNKNOWN` returns
 * `NO_FINDING_REQUIRED`, the same normal disposition `PASS` returns.
 *
 * PHASE 3F IS UNTOUCHED. This service consumes what `evaluateChaosRun(...)`
 * already persisted. It never calls an evaluator, never assembles evidence
 * again, never executes chaos and never writes to `chaos_runs` or
 * `invariant_results`. Nothing in Phase 3F was modified to accommodate it.
 *
 * NO PHASE 4 BEHAVIOUR. No diagnosis, no root cause, no confidence, no
 * recommendation, no regression, no reliability score. Every finding is
 * created OPEN with all seven diagnosis/recommendation/resolution columns
 * left NULL.
 */

export class FindingServiceError extends Error {
  readonly code: FindingErrorCode;

  constructor(code: FindingErrorCode, message: string) {
    super(message);
    this.name = "FindingServiceError";
    this.code = code;
  }
}

/**
 * Generates — or reuses — the one Finding for a single persisted invariant
 * result.
 *
 * The only input is an internal `invariant_results.id`. There is deliberately
 * no parameter for the result, severity, title, expected/observed state or
 * evidence: accepting any of those would let a caller assert a failure the
 * database never recorded.
 */
export async function createFindingFromInvariantResult(
  invariantResultId: string,
): Promise<FindingGenerationResult> {
  if (!isUuid(invariantResultId)) {
    throw new FindingServiceError(
      "FINDING_INVARIANT_RESULT_ID_INVALID",
      "A finding was requested for an identifier that is not an internal UUID.",
    );
  }

  const result = await findInvariantResultById(invariantResultId);
  if (result === null) {
    throw new FindingServiceError(
      "FINDING_INVARIANT_RESULT_NOT_FOUND",
      "No persisted invariant result exists for this identifier, so no finding was created.",
    );
  }

  if (result.result !== "FAIL") {
    return {
      kind: "NO_FINDING_REQUIRED",
      invariantResultId,
      result: result.result,
      reason: "RESULT_NOT_FAIL",
    };
  }

  // Registry-derived, version-gated, deterministic. Throws a typed integrity
  // error rather than titling a historical verdict with today's semantics.
  const title = deterministicFindingTitle(
    result.invariant_id,
    result.invariant_version,
  );

  const persistence = await insertOpenFinding(invariantResultId, title);
  return persistence.kind === "INSERTED"
    ? { kind: "CREATED", finding: persistence.finding }
    : { kind: "ALREADY_PRESENT", finding: persistence.finding };
}

/**
 * Generates every Finding a completed chaos run's persisted results call for.
 *
 * It reads results and nothing else — no re-evaluation, no evidence
 * reassembly, no chaos-run read. A run with no persisted invariant results
 * returns zeros rather than an error: telling "unknown run" apart from "run
 * with no results" is Phase 3H's job, and reaching for `chaos_runs` here would
 * add a dependency this phase does not need.
 */
export async function generateFindingsForChaosRun(
  chaosRunId: string,
): Promise<FindingRunGenerationSummary> {
  if (!isUuid(chaosRunId)) {
    throw new FindingServiceError(
      "FINDING_CHAOS_RUN_ID_INVALID",
      "Findings were requested for an identifier that is not an internal UUID.",
    );
  }

  const results = await listInvariantResultsForChaosRun(chaosRunId);

  const findings: FindingRunGenerationEntry[] = [];
  const skipped: FindingRunSkippedEntry[] = [];

  for (const row of results) {
    if (row.result !== "FAIL") {
      skipped.push({
        invariantResultId: row.id,
        invariantId: row.invariant_id,
        result: row.result,
        reason: "RESULT_NOT_FAIL",
      });
      continue;
    }

    const generated = await createFindingFromInvariantResult(row.id);
    if (generated.kind === "NO_FINDING_REQUIRED") {
      // Unreachable in practice — the row was read as FAIL a moment ago — but
      // reported truthfully rather than asserted away, because the persisted
      // result is the authority, not this loop's earlier read.
      skipped.push({
        invariantResultId: row.id,
        invariantId: row.invariant_id,
        result: generated.result,
        reason: "RESULT_NOT_FAIL",
      });
      continue;
    }

    findings.push({
      invariantResultId: row.id,
      invariantId: row.invariant_id,
      findingId: generated.finding.id,
      kind: generated.kind === "CREATED" ? "CREATED" : "ALREADY_PRESENT",
    });
  }

  return {
    chaosRunId,
    evaluatedResultCount: results.length,
    failedResultCount: results.filter((r) => r.result === "FAIL").length,
    findings,
    skipped,
  };
}

function toDetail(
  finding: {
    readonly id: string;
    readonly invariantResultId: string;
    readonly status: FindingDetail["status"];
    readonly title: string;
    readonly createdAt: string;
    readonly updatedAt: string;
  },
  result: InvariantResultDbRow,
): FindingDetail {
  return {
    findingId: finding.id,
    invariantResultId: finding.invariantResultId,
    status: finding.status,
    title: finding.title,
    createdAt: finding.createdAt,
    updatedAt: finding.updatedAt,
    invariant: {
      invariantId: result.invariant_id as InvariantResultInvariantId,
      invariantVersion: result.invariant_version,
      severity: result.severity,
      expectedSummary: result.expected_summary,
      observedSummary: result.observed_summary,
      reason: result.reason,
      evaluatedAt: result.evaluated_at,
      evidenceRefs: result.evidence_refs,
    },
    correlations: {
      chaosRunId: result.chaos_run_id,
      orderId: result.order_id,
      paymentAttemptId: result.payment_attempt_id,
      paymentId: result.payment_id,
    },
  };
}

/**
 * The Finding Detail read model — the server-side contract Phase 3H consumes.
 *
 * Every factual field about WHAT failed is read live from the linked
 * `invariant_results` row, never from a copy on the finding. That is the whole
 * point: the invariant result is immutable append-only evidence, so a value
 * read through the join cannot have drifted from the authoritative verdict.
 *
 * Diagnosis and recommendation are deliberately not exposed. They are Phase 4
 * surface and are NULL after Phase 3G creation; returning them now would
 * invite a caller to depend on a field this phase never populates.
 */
export async function getFindingDetailByInvariantResultId(
  invariantResultId: string,
): Promise<FindingDetail> {
  if (!isUuid(invariantResultId)) {
    throw new FindingServiceError(
      "FINDING_INVARIANT_RESULT_ID_INVALID",
      "A finding was requested for an identifier that is not an internal UUID.",
    );
  }

  const finding = await findFindingByInvariantResultId(invariantResultId);
  if (finding === null) {
    throw new FindingServiceError(
      "FINDING_NOT_FOUND",
      "No finding exists for this invariant result.",
    );
  }

  const result = await findInvariantResultById(finding.invariantResultId);
  if (result === null) {
    // Structurally impossible while the FK holds — RESTRICT forbids deleting a
    // referenced invariant result — so this is an integrity failure, not a
    // routine miss, and it must never degrade into a partial detail object.
    throw new FindingServiceError(
      "FINDING_INTEGRITY_CONFLICT",
      "The invariant result this finding reports could not be read.",
    );
  }

  return toDetail(finding, result);
}
