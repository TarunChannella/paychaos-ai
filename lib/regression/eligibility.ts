import "server-only";

import {
  getScenarioDefinition,
  isRegisteredScenarioId,
} from "@/lib/chaos/registry";
import {
  findFindingById,
  findInvariantResultById,
} from "@/lib/findings/repository";
import { isUuid } from "@/lib/findings/types";
import { findActiveRegressionForFinding } from "@/lib/regression/repository";
import { RegressionRepositoryError } from "@/lib/regression/repository";
import { getSupabaseServerClient } from "@/lib/supabase/server";

import type {
  RegressionEligibility,
  RegressionIneligibilityCode,
} from "@/lib/regression/types";
import type { InvariantResultInvariantId } from "@/lib/supabase/types";

/**
 * Phase 4E-R1 — READ-ONLY regression eligibility.
 *
 * Answers one question about one Finding: can a regression be started for it
 * right now, and if so, what does a later round need to know?
 *
 * STRICTLY READ-ONLY. This module creates no chaos run, inserts no regression,
 * executes no scenario, evaluates no invariant and writes no Finding. Every
 * statement it issues is a SELECT.
 *
 * STRUCTURAL EVIDENCE ONLY. Eligibility is resolved by following persisted
 * identifiers:
 *
 *   finding.invariant_result_id
 *     -> invariant_results.chaos_run_id
 *       -> chaos_runs.scenario_id
 *         -> the frozen chaos registry's requiredInvariants
 *
 * It NEVER reads a Finding's `title`, `diagnosis_summary`, `recommendation_text`
 * or any other prose, and it never requires a diagnosis or recommendation to
 * exist: a Finding is eligible because of what it points at, not because of
 * what has been written about it. Parsing prose to decide whether a re-test may
 * run would make generated text load-bearing for execution, which it must
 * never be.
 *
 * NO LOCAL SCENARIO MAPPING. The scenario's required invariants come from
 * `getScenarioDefinition(...).requiredInvariants` — the single authoritative
 * registry. There is deliberately no `C01 -> [...]` array in this directory; a
 * second copy could only ever drift from the first.
 *
 * EVERY FINDING STATUS IS ELIGIBLE IN PRINCIPLE (architect decision D-2).
 * `OPEN`, `STILL_FAILING` and `RESOLVED` may all be re-tested — a resolved
 * Finding can legitimately be verified again later. Status is reported, never
 * used to reject.
 */

// ============================================================================
// ERROR MODEL
// ============================================================================

export const REGRESSION_ELIGIBILITY_ERROR_CODES = Object.freeze([
  /** The supplied identifier is not an internal UUID. */
  "REGRESSION_ELIGIBILITY_FINDING_ID_INVALID",
  /** A read did not complete. NOT the same as a record being absent. */
  "REGRESSION_ELIGIBILITY_READ_FAILED",
] as const);

export type RegressionEligibilityErrorCode =
  (typeof REGRESSION_ELIGIBILITY_ERROR_CODES)[number];

/**
 * A malformed identifier or a failed read is an INFRASTRUCTURE fault, raised
 * as an error — deliberately not folded into `INELIGIBLE`. "We could not
 * check" and "we checked, and it cannot run" are different facts, and
 * collapsing them would let a transient outage read as a settled verdict.
 */
export class RegressionEligibilityError extends Error {
  readonly code: RegressionEligibilityErrorCode;

  constructor(code: RegressionEligibilityErrorCode, message: string) {
    super(message);
    this.name = "RegressionEligibilityError";
    this.code = code;
  }
}

// ============================================================================
// HELPERS
// ============================================================================

function ineligible(
  code: RegressionIneligibilityCode,
  reason: string,
  findingId: string | null,
): RegressionEligibility {
  return { kind: "INELIGIBLE", code, reason, findingId };
}

/** Explicit allowlist projection for the original chaos run. */
const CHAOS_RUN_COLUMNS = "id, scenario_id";

interface OriginalChaosRun {
  readonly id: string;
  readonly scenarioId: string;
}

async function readOriginalChaosRun(
  chaosRunId: string,
): Promise<OriginalChaosRun | null> {
  const { data, error } = await getSupabaseServerClient()
    .from("chaos_runs")
    .select(CHAOS_RUN_COLUMNS)
    .eq("id", chaosRunId)
    .maybeSingle();

  if (error !== null) {
    throw new RegressionEligibilityError(
      "REGRESSION_ELIGIBILITY_READ_FAILED",
      "The original chaos run could not be read.",
    );
  }
  if (data === null) return null;
  const row = data as unknown as { id: string; scenario_id: string };
  return { id: row.id, scenarioId: row.scenario_id };
}

// ============================================================================
// ELIGIBILITY
// ============================================================================

/**
 * Resolves whether a Finding can start a regression.
 *
 * The only input is a Finding ID. Nothing about the scenario, the invariant
 * set or the original run is caller-supplied — all of it is re-derived from
 * persisted rows every time.
 */
export async function resolveRegressionEligibility(
  findingId: string,
): Promise<RegressionEligibility> {
  if (!isUuid(findingId)) {
    throw new RegressionEligibilityError(
      "REGRESSION_ELIGIBILITY_FINDING_ID_INVALID",
      "The finding identifier is not an internal UUID.",
    );
  }

  // --- 1. The Finding itself. ----------------------------------------------
  let finding;
  try {
    finding = await findFindingById(findingId);
  } catch {
    throw new RegressionEligibilityError(
      "REGRESSION_ELIGIBILITY_READ_FAILED",
      "The finding could not be read.",
    );
  }
  if (finding === null) {
    return ineligible(
      "REGRESSION_FINDING_NOT_FOUND",
      "No finding exists with that identifier.",
      null,
    );
  }

  // --- 2. The failed evaluation it reports. --------------------------------
  let invariantResult;
  try {
    invariantResult = await findInvariantResultById(finding.invariantResultId);
  } catch {
    throw new RegressionEligibilityError(
      "REGRESSION_ELIGIBILITY_READ_FAILED",
      "The original invariant result could not be read.",
    );
  }
  if (invariantResult === null) {
    // The FK makes this practically unreachable, but a missing row would mean
    // there is no original scenario to rerun — reported, never guessed around.
    return ineligible(
      "REGRESSION_NO_ORIGINAL_CHAOS_RUN",
      "The original invariant result is no longer readable, so no scenario can be rerun.",
      findingId,
    );
  }

  // --- 3. The chaos run that produced it. ----------------------------------
  // `chaos_run_id` is nullable: a baseline evaluation has no chaos run, and
  // there is therefore nothing to rerun. That is a truthful ineligibility,
  // not an error.
  const originalChaosRunId = invariantResult.chaos_run_id;
  if (originalChaosRunId === null) {
    return ineligible(
      "REGRESSION_NO_ORIGINAL_CHAOS_RUN",
      "This finding came from a baseline evaluation with no chaos run, so there is no scenario to rerun.",
      findingId,
    );
  }

  const originalRun = await readOriginalChaosRun(originalChaosRunId);
  if (originalRun === null) {
    return ineligible(
      "REGRESSION_ORIGINAL_CHAOS_RUN_NOT_FOUND",
      "The original chaos run could not be found.",
      findingId,
    );
  }

  // --- 4. The scenario, re-confirmed against the executable P0 registry. ---
  if (!isRegisteredScenarioId(originalRun.scenarioId)) {
    return ineligible(
      "REGRESSION_SCENARIO_NOT_REGISTERED",
      "The original scenario is not in the executable P0 registry, so it cannot be rerun.",
      findingId,
    );
  }
  const scenarioId = originalRun.scenarioId;
  const definition = getScenarioDefinition(scenarioId);
  if (definition === undefined) {
    // Unreachable while `isRegisteredScenarioId` and the registry agree, but
    // asserted rather than assumed: a narrowed id with no definition would
    // otherwise read as an empty invariant set.
    return ineligible(
      "REGRESSION_SCENARIO_NOT_REGISTERED",
      "The original scenario has no definition in the executable P0 registry.",
      findingId,
    );
  }
  // Widened to strings deliberately. The registry names the eight invariant
  // IDs the P0 scenarios reference; a persisted result may carry any of the
  // twelve in the catalogue. Comparing as strings lets a finding whose
  // invariant is outside the scenario's set be REPORTED below rather than
  // rejected by the type system as impossible.
  const requiredInvariantIds: readonly string[] = definition.requiredInvariants;

  // --- 5. The finding's own invariant must belong to that scenario's set. --
  const originalInvariantId =
    invariantResult.invariant_id as InvariantResultInvariantId;
  if (!requiredInvariantIds.includes(originalInvariantId)) {
    return ineligible(
      "REGRESSION_ORIGINAL_INVARIANT_NOT_REQUIRED",
      "The finding's invariant is not part of the original scenario's approved relevant invariant set, so rerunning that scenario could not re-test it.",
      findingId,
    );
  }

  // --- 6. At most one active regression per finding. -----------------------
  // A fast, friendly pre-check. The database's partial unique index remains
  // the authority for a genuine race.
  let active;
  try {
    active = await findActiveRegressionForFinding(findingId);
  } catch (error) {
    if (error instanceof RegressionRepositoryError) {
      throw new RegressionEligibilityError(
        "REGRESSION_ELIGIBILITY_READ_FAILED",
        "The finding's active regression could not be read.",
      );
    }
    throw error;
  }
  if (active !== null) {
    return ineligible(
      "REGRESSION_ACTIVE_RUN_EXISTS",
      "A regression is already pending or running for this finding.",
      findingId,
    );
  }

  // Terminal regression history never blocks: a finding may be re-tested as
  // many times as it needs to be.
  return {
    kind: "ELIGIBLE",
    findingId,
    findingStatus: finding.status,
    originalInvariantResultId: invariantResult.id,
    originalInvariantId,
    originalChaosRunId,
    scenarioId,
    requiredInvariantIds,
  };
}
