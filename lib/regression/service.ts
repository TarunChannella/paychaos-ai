import "server-only";

import { executeC03InvalidSignatureTest } from "@/lib/chaos/c03-execution-service";
import { armC07ClientConfirmationDrop } from "@/lib/chaos/c07-execution-service";
import {
  executeC11RealWebhookReplay,
  startC11AFailureObservation,
} from "@/lib/chaos/c11-execution-service";
import { revalidateEligibility } from "@/lib/chaos/eligibility-service";
import { executeC01Replay } from "@/lib/chaos/replay-service";
import { getChaosRunById } from "@/lib/chaos/run-repository";
import { createChaosRun } from "@/lib/chaos/run-service";
import {
  findFindingById,
  findInvariantResultById,
} from "@/lib/findings/repository";
import { evaluateChaosRun } from "@/lib/invariants/service";
import { resolveRegressionEligibility } from "@/lib/regression/eligibility";
import { resolveFreshC01Source } from "@/lib/regression/fresh-source";
import { decideRegressionOutcome } from "@/lib/regression/finalization";
import {
  markFindingStillFailingAfterRegression,
  readFindingLifecycle,
  resolveFindingAfterRegression,
} from "@/lib/regression/finding-lifecycle-repository";
import { FindingLifecycleError } from "@/lib/regression/finding-lifecycle-repository";
import {
  finalizeRegressionError,
  finalizeRegressionResolved,
  finalizeRegressionStillFailing,
  findRegressionRunById,
  insertPendingRegressionRun,
  listRegressionRunsForFinding,
  RegressionRepositoryError,
  startPendingRegressionRun,
} from "@/lib/regression/repository";

import type { ChaosPrecheckInput, ChaosScenarioId } from "@/lib/chaos/types";
import type { ChaosRunRow } from "@/lib/chaos/run-repository";
import type {
  RegressionAttemptRef,
  RegressionContinuation,
  RegressionOperationResult,
  RegressionRun,
  RegressionServiceReason,
  StartRegressionInput,
  StartRegressionResult,
} from "@/lib/regression/types";

/**
 * Phase 4E-R2 — the trusted server orchestration for one regression.
 *
 * ```text
 * existing Finding
 *   -> R1 eligibility (structural, read-only)
 *     -> the SAME original scenario, re-derived from persisted evidence
 *       -> the EXISTING createChaosRun safety gate  -> a NEW chaos run
 *         -> regression_runs links the Finding to that run
 *           -> the EXISTING scenario execution service
 *             -> the EXISTING evaluateChaosRun
 *               -> the FROZEN R1 pure decision
 *                 -> terminalize regression, THEN the Finding lifecycle
 * ```
 *
 * NO SECOND CHAOS RUNNER. Every effect is produced by a frozen Phase 3
 * service. This module composes them; it never reimplements webhook
 * processing, replay, signature verification, C07 suppression, C11
 * observation, or invariant evaluation.
 *
 * THE CALLER CHOOSES NOTHING THAT MATTERS. The public input is a Finding ID
 * plus, for the two provider-dependent scenarios, an existing internal order
 * to use as a fresh subject. The scenario, the mechanism and the relevant
 * invariant set are all re-derived from persisted rows.
 *
 * MULTI-STEP IS HONEST. C07 and C11-A genuinely require a real Razorpay Test
 * Mode action in a browser. They are armed/started and then return
 * `AWAITING_EXTERNAL_ACTION`. Nothing here fabricates a Checkout, a payment,
 * a failure or a webhook, and neither scenario is ever reported complete
 * because the server did its half.
 *
 * PERSISTED STATE IS AUTHORITATIVE. After calling an execution service this
 * module RE-READS `chaos_runs` and decides from the durable row, never from
 * the in-memory result alone.
 *
 * THE FINDING FOLLOWS THE NEWEST ATTEMPT. Terminalizing a regression releases
 * the active-regression boundary, so a newer attempt can start and finish
 * while an older one is still retrying its lifecycle write. Before touching a
 * Finding this module confirms the attempt is the deterministic latest, and
 * the write itself is compare-and-set on the Finding's `updated_at`. An older
 * verdict can therefore never overwrite a newer one — it returns `SUPERSEDED`
 * and its own historical row is left exactly as it is.
 *
 * DURABLE ORDERING. The regression row is terminalized BEFORE the Finding
 * lifecycle write. A terminal regression whose Finding has not caught up is
 * recoverable and honest; a Finding claiming RESOLVED above a still-running
 * regression would not be. `completeRegression` is retry-convergent: calling
 * it again re-reads immutable evidence, re-derives the same decision, and
 * converges the Finding with zero further writes once correct.
 */

// ============================================================================
// ERRORS
// ============================================================================

export const REGRESSION_SERVICE_ERROR_CODES = Object.freeze([
  "REGRESSION_SERVICE_RUN_NOT_FOUND",
  "REGRESSION_SERVICE_FINDING_UNREADABLE",
] as const);

export type RegressionServiceErrorCode =
  (typeof REGRESSION_SERVICE_ERROR_CODES)[number];

export class RegressionServiceError extends Error {
  readonly code: RegressionServiceErrorCode;

  constructor(code: RegressionServiceErrorCode, message: string) {
    super(message);
    this.name = "RegressionServiceError";
    this.code = code;
  }
}

// ============================================================================
// PLAN — the same scenario, re-derived and re-validated
// ============================================================================

/**
 * How a regression for one scenario is created and driven.
 *
 * `SINGLE_STEP` runs to completion inside one server call. `MULTI_STEP` is
 * armed and then waits for a real provider/browser action.
 */
type RegressionPlan =
  | {
      readonly step: "SINGLE_STEP";
      readonly create: ChaosPrecheckInput;
      readonly execute: (
        chaosRunId: string,
      ) => Promise<{ readonly kind: string }>;
    }
  | {
      readonly step: "MULTI_STEP";
      readonly create: ChaosPrecheckInput;
      readonly execute: (
        chaosRunId: string,
      ) => Promise<{ readonly kind: string }>;
      readonly continuation: RegressionContinuation;
      /** The `kind` an arm/start service returns when it truly armed. */
      readonly armedKind: string;
    };

type PlanResult =
  | { readonly ok: true; readonly plan: RegressionPlan }
  | { readonly ok: false; readonly reason: RegressionServiceReason }
  | {
      /**
       * Not a failure. A genuine external Test Mode action must happen before
       * this scenario can be re-tested at all, and nothing has been created.
       */
      readonly ok: false;
      readonly awaiting: RegressionContinuation;
      readonly reason: RegressionServiceReason;
    };

/**
 * Rebuilds the original scenario's creation input from persisted evidence,
 * re-validating any source it depends on AT REGRESSION TIME.
 *
 * A historical source id is never trusted just because it once worked: an
 * order can have been paid since, and an event can have stopped being an
 * eligible replay source. Each path re-confirms through the frozen chaos
 * eligibility service and fails closed rather than silently substituting
 * different evidence.
 */
async function resolveRegressionPlan(
  scenarioId: ChaosScenarioId,
  originalRun: ChaosRunRow,
  freshOrderId: string | undefined,
): Promise<PlanResult> {
  if (scenarioId === "C03") {
    // Subject-free and entirely internal: no order, no payment, no source
    // event, and no provider call at any point.
    return {
      ok: true,
      plan: {
        step: "SINGLE_STEP",
        create: {
          scenarioId: "C03",
          mechanism: "C",
          faultType: "INVALID_SIGNATURE_TEST",
        },
        execute: executeC03InvalidSignatureTest,
      },
    };
  }

  if (scenarioId === "C01") {
    // PHASE 5 CORRECTION — a C01 re-test uses FRESH evidence, never the
    // original subject.
    //
    // This branch used to replay `originalRun.source_webhook_event_id`. That
    // is unpassable by construction: the original C01 failure leaves more than
    // one FULFIL_ORDER row on its order, that evidence is preserved on
    // purpose, and PRECHECK-08 requires a PAID-with-exactly-one-fulfilment
    // baseline. The deployed run proved it — the re-test was BLOCKED with
    // `C01_BASELINE_NOT_PAID_ONE_FULFILMENT` and the regression terminalized
    // as ERROR.
    //
    // The precheck is correct and is not touched. The subject is genuinely
    // contaminated, by the very defect being re-tested, so the fix is to
    // re-test against new genuine evidence — the same reasoning C07 already
    // applies to its order, one branch below.
    //
    // REG-002 is preserved: this is still scenario C01, still mechanism B,
    // still REPLAY_EVENT, still the same invariant set. Only the subject is
    // new, which is what makes it a re-test rather than a re-reading of the
    // failure.
    if (originalRun.source_webhook_event_id === null) {
      return { ok: false, reason: "ORIGINAL_PATH_UNRESOLVED" };
    }

    const fresh = await resolveFreshC01Source(originalRun);
    if (fresh === null) {
      // Nothing is wrong and nothing is created — a new Test Mode payment
      // simply has not happened yet. Reported as AWAITING so the operator is
      // told what to do, instead of being handed an execution error.
      return {
        ok: false,
        awaiting: "C01_TEST_MODE_FRESH_CAPTURE",
        reason: "FRESH_CAPTURE_REQUIRED",
      };
    }

    // Re-validated through the frozen chaos eligibility service exactly as
    // before, so a source picked above still has to satisfy the same gate any
    // operator-selected source would.
    if (
      !(await revalidateEligibility(
        { scenarioId: "C01" },
        fresh.webhookEventId,
      ))
    ) {
      return { ok: false, reason: "SOURCE_NO_LONGER_ELIGIBLE" };
    }

    return {
      ok: true,
      plan: {
        step: "SINGLE_STEP",
        create: {
          scenarioId: "C01",
          mechanism: "B",
          faultType: "REPLAY_EVENT",
          sourceWebhookEventId: fresh.webhookEventId,
        },
        execute: executeC01Replay,
      },
    };
  }

  if (scenarioId === "C07") {
    // The historical order was consumed by the original run and can never be
    // the fresh subject again. A genuinely new one is required.
    if (freshOrderId === undefined) {
      return { ok: false, reason: "FRESH_ORDER_REQUIRED" };
    }
    // Structural reuse is refused BEFORE any eligibility call: the original
    // order could still look "fresh" if the earlier run never paid it, and a
    // re-test of the same subject would not be a re-test at all.
    if (freshOrderId === originalRun.order_id) {
      return { ok: false, reason: "FRESH_ORDER_REUSE_FORBIDDEN" };
    }
    if (!(await revalidateEligibility({ scenarioId: "C07" }, freshOrderId))) {
      return { ok: false, reason: "FRESH_ORDER_NOT_ELIGIBLE" };
    }
    return {
      ok: true,
      plan: {
        step: "MULTI_STEP",
        create: {
          scenarioId: "C07",
          mechanism: ["A", "C"],
          faultType: "DROP_CLIENT_CONFIRMATION",
          freshOrderId,
        },
        execute: armC07ClientConfirmationDrop,
        continuation: "C07_TEST_MODE_CHECKOUT",
        armedKind: "ARMED",
      },
    };
  }

  // C11 has two valid paths. The frozen discriminator is the ORIGINAL run's
  // persisted shape — never prose, and never a caller's choice.
  const sourceId = originalRun.source_webhook_event_id;
  if (sourceId !== null) {
    // C11-B: replay of a genuine, signature-verified payment.failed event.
    if (
      !(await revalidateEligibility(
        { scenarioId: "C11", mechanism: "B" },
        sourceId,
      ))
    ) {
      return { ok: false, reason: "SOURCE_NO_LONGER_ELIGIBLE" };
    }
    return {
      ok: true,
      plan: {
        step: "SINGLE_STEP",
        create: {
          scenarioId: "C11",
          mechanism: "B",
          // REAL_WEBHOOK_EVENT only. TEST_FIXTURE is a Phase 3D-C capture
          // path and is never reachable from a regression at runtime.
          failureEvidence: {
            kind: "REAL_WEBHOOK_EVENT",
            webhookEventId: sourceId,
          },
        },
        execute: executeC11RealWebhookReplay,
      },
    };
  }

  if (originalRun.order_id === null) {
    // Neither a replay source nor an order subject: the original run's shape
    // does not identify one path, and guessing between them is not allowed.
    return { ok: false, reason: "ORIGINAL_PATH_UNRESOLVED" };
  }

  // C11-A: observation of a genuine Test Mode failed payment.
  if (freshOrderId === undefined) {
    return { ok: false, reason: "FRESH_ORDER_REQUIRED" };
  }
  // Same structural rule as C07: never re-test the original subject.
  if (freshOrderId === originalRun.order_id) {
    return { ok: false, reason: "FRESH_ORDER_REUSE_FORBIDDEN" };
  }
  if (
    !(await revalidateEligibility(
      { scenarioId: "C11", mechanism: "A" },
      freshOrderId,
    ))
  ) {
    return { ok: false, reason: "FRESH_ORDER_NOT_ELIGIBLE" };
  }
  return {
    ok: true,
    plan: {
      step: "MULTI_STEP",
      create: { scenarioId: "C11", mechanism: "A", freshOrderId },
      execute: startC11AFailureObservation,
      continuation: "C11_A_TEST_MODE_FAILED_PAYMENT",
      armedKind: "OBSERVING",
    },
  };
}

// ============================================================================
// HELPERS
// ============================================================================

function nowIso(): string {
  return new Date().toISOString();
}

function refOf(run: RegressionRun, scenarioId: string): RegressionAttemptRef {
  return {
    findingId: run.findingId,
    regressionRunId: run.id,
    chaosRunId: run.chaosRunId,
    scenarioId,
  };
}

/** Terminalizes a regression as ERROR. The Finding is never touched. */
async function errorOut(
  run: RegressionRun,
  scenarioId: string,
  reason: RegressionServiceReason,
  failedPrecheckId: string | null = null,
): Promise<RegressionOperationResult> {
  await finalizeRegressionError({
    regressionRunId: run.id,
    completedAt: nowIso(),
  });
  return {
    kind: "ERRORED",
    attempt: refOf(run, scenarioId),
    reason,
    failedPrecheckId,
  };
}

/**
 * The original Finding's own invariant, read structurally.
 *
 * Deliberately not `resolveRegressionEligibility`: that correctly reports an
 * ACTIVE_RUN_EXISTS refusal while this very regression is in flight, which is
 * exactly when completion needs the invariant id.
 */
async function readOriginalInvariantId(findingId: string): Promise<string> {
  const finding = await findFindingById(findingId);
  if (finding === null) {
    throw new RegressionServiceError(
      "REGRESSION_SERVICE_FINDING_UNREADABLE",
      "The finding this regression re-tests could not be read.",
    );
  }
  const result = await findInvariantResultById(finding.invariantResultId);
  if (result === null) {
    throw new RegressionServiceError(
      "REGRESSION_SERVICE_FINDING_UNREADABLE",
      "The original invariant result could not be read.",
    );
  }
  return result.invariant_id;
}

/** The two verdicts that may move a Finding. `ERROR` proved nothing. */
function isConclusive(status: RegressionRun["status"]): boolean {
  return status === "RESOLVED" || status === "STILL_FAILING";
}

/**
 * Does any NEWER conclusive attempt exist for this Finding?
 *
 * Deliberately not "is this the newest row". An `ERROR` attempt carries
 * `NO_CHANGE` semantics and never writes a Finding, so it must not be able to
 * suppress an earlier `RESOLVED`/`STILL_FAILING` verdict that has not been
 * applied yet. Only a newer CONCLUSIVE attempt owns the Finding.
 *
 * Reuses the frozen R1 history reader, which already orders
 * `created_at DESC, id DESC` — there is deliberately no second history query
 * implementation here.
 */
async function isNewestConclusiveAttempt(run: RegressionRun): Promise<boolean> {
  const history = await listRegressionRunsForFinding(run.findingId);
  const index = history.findIndex((entry) => entry.id === run.id);
  if (index === -1) return false;
  // Everything before this index is strictly newer.
  return !history.slice(0, index).some((entry) => isConclusive(entry.status));
}

/**
 * Applies the newest previous CONCLUSIVE verdict before a new attempt starts.
 *
 * The window this closes: an attempt terminalizes `RESOLVED`, its Finding
 * write is lost, and the active boundary releases. If the next attempt then
 * ends `ERROR` — which correctly changes nothing — the earlier verdict would
 * never reach the Finding at all. Converging first makes the sequence behave
 * the way it reads: the Finding always carries the newest CONCLUSIVE result.
 *
 * LIFECYCLE CONVERGENCE ONLY — IT NEVER RE-EVALUATES THE OLD RUN.
 *
 * The durable ordering this module guarantees is: terminalize
 * `regression_runs` FIRST, then apply the Finding lifecycle. So a regression
 * row that already reads `RESOLVED` or `STILL_FAILING` has ALREADY been
 * through the chaos run, the invariant evaluation and the deterministic
 * finalization — the stored status IS that verdict. The only durable step
 * that can still be missing is the later Finding write, and recovering it
 * needs the stored status and nothing else.
 *
 * Re-deriving the verdict by re-running the historical chaos run is therefore
 * unnecessary, and after an invariant version increment it is actively WRONG.
 * Determinism in docs/MONEY_INVARIANTS.md §47 is "same evidence + SAME
 * invariant version = same result". Re-evaluating a v1 run under v2 asks a
 * different question of the same evidence and silently reinterprets a
 * historical verdict. It is also refused at the storage layer, correctly:
 * `persistInvariantResult` throws `INVARIANT_RESULT_INTEGRITY_CONFLICT`
 * rather than rewrite the immutable `(chaos_run_id, invariant_id)` row (§49),
 * which previously made every affected Finding permanently unable to start a
 * new regression.
 *
 * A re-test does not reinterpret old evidence — it produces NEW evidence:
 *
 *   original FAIL -> Finding -> fix -> NEW chaos run -> NEW evidence
 *     -> evaluation under the CURRENT invariant versions -> NEW results
 *
 * Creates no chaos run and no regression row, never rewrites a historical
 * regression status, and writes to the Finding only when the stored verdict
 * and the Finding actually disagree.
 */
async function convergePreviousConclusive(
  findingId: string,
): Promise<{ readonly ok: boolean }> {
  const history = await listRegressionRunsForFinding(findingId);
  // Newest-first, so this is the newest CONCLUSIVE attempt. An intervening
  // `ERROR` carries NO_CHANGE semantics and must never mask an older verdict.
  const previous = history.find((entry) => isConclusive(entry.status));
  if (previous === undefined) return { ok: true };

  try {
    const lifecycle = await readFindingLifecycle(findingId);
    if (lifecycle === null) {
      // The Finding cannot be read, so its convergence cannot be confirmed.
      return { ok: false };
    }

    const target =
      previous.status === "RESOLVED" ? "RESOLVED" : "STILL_FAILING";
    if (lifecycle.status === target) {
      // Already converged. Zero writes — `updated_at` is not disturbed, and
      // a RESOLVED Finding keeps its original `resolved_at`.
      return { ok: true };
    }

    // Compare-and-set on the `updated_at` just read, so a concurrent
    // lifecycle write always wins over this recovery rather than clobbering
    // it. `markFindingStillFailingAfterRegression` clears `resolved_at` in
    // the same statement when it reopens a RESOLVED Finding.
    if (target === "RESOLVED") {
      await resolveFindingAfterRegression({
        findingId,
        resolvedAt: nowIso(),
        expectedUpdatedAt: lifecycle.updatedAt,
      });
    } else {
      await markFindingStillFailingAfterRegression({
        findingId,
        updatedAt: nowIso(),
        expectedUpdatedAt: lifecycle.updatedAt,
      });
    }
  } catch {
    // Fail closed. Starting on top of known unconverged state could lose the
    // earlier verdict permanently.
    return { ok: false };
  }
  return { ok: true };
}

function superseded(
  run: RegressionRun,
  scenarioId: string,
  regressionStatus: Extract<
    RegressionRun["status"],
    "RESOLVED" | "STILL_FAILING" | "ERROR"
  >,
): RegressionOperationResult {
  return {
    kind: "SUPERSEDED",
    attempt: refOf(run, scenarioId),
    regressionStatus,
    reason: "NEWER_REGRESSION_EXISTS",
  };
}

async function loadRegression(regressionRunId: string): Promise<RegressionRun> {
  const run = await findRegressionRunById(regressionRunId);
  if (run === null) {
    throw new RegressionServiceError(
      "REGRESSION_SERVICE_RUN_NOT_FOUND",
      "No regression exists with that identifier.",
    );
  }
  return run;
}

// ============================================================================
// START
// ============================================================================

/**
 * Starts a regression for one existing Finding, and advances it as far as is
 * honestly possible in a single server call.
 */
export async function startRegression(
  input: StartRegressionInput,
): Promise<StartRegressionResult> {
  // --- 1. Structural eligibility. Nothing is created if this refuses. ------
  const eligibility = await resolveRegressionEligibility(input.findingId);
  if (eligibility.kind === "INELIGIBLE") {
    return {
      kind: "NOT_STARTED",
      findingId: input.findingId,
      reason: "NOT_ELIGIBLE",
      ineligibility: eligibility.code,
    };
  }

  // --- 2. Apply any previous conclusive verdict BEFORE creating anything. -
  if (!(await convergePreviousConclusive(input.findingId)).ok) {
    return {
      kind: "NOT_STARTED",
      findingId: input.findingId,
      reason: "PRIOR_CONVERGENCE_FAILED",
      ineligibility: null,
    };
  }

  // --- 3. The original run, re-read for its authoritative shape. ----------
  const originalRun = await getChaosRunById(eligibility.originalChaosRunId);
  if (originalRun === null) {
    return {
      kind: "NOT_STARTED",
      findingId: input.findingId,
      reason: "ORIGINAL_RUN_UNREADABLE",
      ineligibility: null,
    };
  }

  // --- 4. The same scenario, re-derived and re-validated NOW. -------------
  const planned = await resolveRegressionPlan(
    eligibility.scenarioId,
    originalRun,
    input.freshOrderId,
  );
  if (!planned.ok) {
    // A missing external prerequisite is NOT a refusal and NOT an error.
    // Nothing was created, and the operator is told exactly what to do —
    // rather than being handed an execution failure for a payment that simply
    // has not been made yet.
    if ("awaiting" in planned) {
      return {
        kind: "AWAITING_EXTERNAL_PREREQUISITE",
        findingId: input.findingId,
        scenarioId: eligibility.scenarioId,
        reason: planned.reason,
        continuation: planned.awaiting,
      };
    }
    return {
      kind: "NOT_STARTED",
      findingId: input.findingId,
      reason: planned.reason,
      ineligibility: null,
    };
  }

  // --- 5. The EXISTING safety gate creates the new run. -------------------
  const created = await createChaosRun(planned.plan.create);
  if (created.kind === "NOT_PERSISTED_BLOCKED") {
    // Nothing durable exists, so there is nothing to link a regression to.
    return {
      kind: "NOT_STARTED",
      findingId: input.findingId,
      reason: "CHAOS_RUN_NOT_PERSISTED",
      ineligibility: null,
    };
  }

  // --- 6. Link the attempt. The FK requires the chaos run to exist first. -
  let regression: RegressionRun;
  try {
    regression = await insertPendingRegressionRun({
      findingId: input.findingId,
      chaosRunId: created.chaosRunId,
    });
  } catch (error) {
    if (
      error instanceof RegressionRepositoryError &&
      error.code === "REGRESSION_ACTIVE_RUN_CONFLICT"
    ) {
      // A concurrent start won. The safety-gated run stays exactly as it is:
      // never executed, never deleted — it is audit evidence that a start was
      // attempted, and deleting reliability evidence is not this phase's job.
      return {
        kind: "ORPHAN_START",
        findingId: input.findingId,
        chaosRunId: created.chaosRunId,
        scenarioId: created.scenarioId,
        reason: "ACTIVE_RACE_LOST",
      };
    }
    throw error;
  }

  // --- 7. A BLOCKED run never executes. Close the attempt honestly. -------
  if (created.kind === "PERSISTED_BLOCKED") {
    // `started_at` correctly stays NULL: nothing ever ran.
    return errorOut(
      regression,
      created.scenarioId,
      "CHAOS_RUN_BLOCKED",
      created.failedPrecheckId,
    );
  }

  return advanceRegression(regression.id);
}

// ============================================================================
// ADVANCE
// ============================================================================

/**
 * Resumes a persisted attempt from durable state alone.
 *
 * Creates no second chaos run and no second regression row, never re-executes
 * a run that already finished, and is therefore safe to call after a process
 * died between two durable steps.
 */
export async function advanceRegression(
  regressionRunId: string,
): Promise<RegressionOperationResult> {
  const regression = await loadRegression(regressionRunId);
  const chaosRun = await getChaosRunById(regression.chaosRunId);
  if (chaosRun === null) {
    return errorOut(regression, "", "ORIGINAL_RUN_UNREADABLE");
  }
  const scenarioId = chaosRun.scenario_id;

  // A finished attempt never re-executes. It may still need its Finding to
  // catch up, which completion handles idempotently.
  if (regression.status !== "PENDING" && regression.status !== "RUNNING") {
    return completeRegression(regressionRunId);
  }

  // The chaos run already finished — go straight to the verdict.
  if (chaosRun.status === "COMPLETED" || chaosRun.status === "FAILED") {
    return completeRegression(regressionRunId);
  }

  const planned = await resolveRegressionPlanForRun(chaosRun);
  if (!planned.ok) {
    return errorOut(regression, scenarioId, planned.reason);
  }
  const plan = planned.plan;

  // Claim execution. An already-RUNNING regression comes back ALREADY.
  if (regression.status === "PENDING") {
    await startPendingRegressionRun({
      regressionRunId: regression.id,
      startedAt: nowIso(),
    });
  }

  // A multi-step run already claimed by its arm/start service is waiting for
  // the real provider action; calling arm again would be wrong.
  if (plan.step === "MULTI_STEP" && chaosRun.status === "RUNNING") {
    return {
      kind: "AWAITING_EXTERNAL_ACTION",
      attempt: refOf(regression, scenarioId),
      continuation: plan.continuation,
    };
  }

  const executed = await plan.execute(regression.chaosRunId);

  if (plan.step === "MULTI_STEP") {
    // PERSISTED STATE DECIDES, NOT THE RETURNED `kind`.
    //
    // The arm/start contracts are explicit that a `BLOCK_PERSISTENCE_FAILED`
    // result leaves durable state UNKNOWN, and a `NOT_STARTABLE` can simply
    // mean a concurrent actor already armed the run. Re-reading the row is the
    // only honest way to know whether a real external action is now pending.
    const after = await getChaosRunById(regression.chaosRunId);
    if (after === null) {
      return errorOut(regression, scenarioId, "ORIGINAL_RUN_UNREADABLE");
    }

    if (after.status === "RUNNING") {
      // Genuinely armed/observing — whatever the in-memory result claimed.
      return {
        kind: "AWAITING_EXTERNAL_ACTION",
        attempt: refOf(regression, scenarioId),
        continuation: plan.continuation,
      };
    }
    if (after.status === "COMPLETED" || after.status === "FAILED") {
      // Already finished (including a durably BLOCKED precheck). The trusted
      // finalization path handles every outcome; nothing waits on a human.
      return completeRegression(regressionRunId);
    }

    // Still PENDING: the arm/start was not durably established. This is NOT
    // BLOCKED — persisted state proves nothing of the sort — and it is not
    // awaiting an external action either. A later advance may retry safely.
    return { kind: "IN_PROGRESS", attempt: refOf(regression, scenarioId) };
  }

  // PERSISTED STATE DECIDES, NOT THE RETURNED `kind` — the same rule the
  // multi-step branch above follows. A `NOT_STARTABLE` result frequently just
  // means another actor already advanced the run, and terminalizing on it
  // would discard genuinely completed evidence. `completeRegression` re-reads
  // the row and handles COMPLETED, FAILED, BLOCKED, ERROR and still-in-flight
  // alike.
  void executed;
  return completeRegression(regressionRunId);
}

/**
 * Rebuilds the plan for an EXISTING run, so `advance` knows whether the
 * scenario is single- or multi-step without re-validating a source it is no
 * longer about to select. The run already exists and already passed the
 * safety gate; only its shape is needed here.
 */
async function resolveRegressionPlanForRun(
  chaosRun: ChaosRunRow,
): Promise<PlanResult> {
  const scenarioId = chaosRun.scenario_id as ChaosScenarioId;
  if (scenarioId === "C03") {
    return {
      ok: true,
      plan: {
        step: "SINGLE_STEP",
        create: {
          scenarioId: "C03",
          mechanism: "C",
          faultType: "INVALID_SIGNATURE_TEST",
        },
        execute: executeC03InvalidSignatureTest,
      },
    };
  }
  if (scenarioId === "C01") {
    return {
      ok: true,
      plan: {
        step: "SINGLE_STEP",
        create: {
          scenarioId: "C01",
          mechanism: "B",
          faultType: "REPLAY_EVENT",
          sourceWebhookEventId: chaosRun.source_webhook_event_id ?? "",
        },
        execute: executeC01Replay,
      },
    };
  }
  if (scenarioId === "C07") {
    return {
      ok: true,
      plan: {
        step: "MULTI_STEP",
        create: {
          scenarioId: "C07",
          mechanism: ["A", "C"],
          faultType: "DROP_CLIENT_CONFIRMATION",
          freshOrderId: chaosRun.order_id ?? "",
        },
        execute: armC07ClientConfirmationDrop,
        continuation: "C07_TEST_MODE_CHECKOUT",
        armedKind: "ARMED",
      },
    };
  }
  if (chaosRun.source_webhook_event_id !== null) {
    return {
      ok: true,
      plan: {
        step: "SINGLE_STEP",
        create: {
          scenarioId: "C11",
          mechanism: "B",
          failureEvidence: {
            kind: "REAL_WEBHOOK_EVENT",
            webhookEventId: chaosRun.source_webhook_event_id,
          },
        },
        execute: executeC11RealWebhookReplay,
      },
    };
  }
  if (chaosRun.order_id === null) {
    return { ok: false, reason: "ORIGINAL_PATH_UNRESOLVED" };
  }
  return {
    ok: true,
    plan: {
      step: "MULTI_STEP",
      create: {
        scenarioId: "C11",
        mechanism: "A",
        freshOrderId: chaosRun.order_id,
      },
      execute: startC11AFailureObservation,
      continuation: "C11_A_TEST_MODE_FAILED_PAYMENT",
      armedKind: "OBSERVING",
    },
  };
}

// ============================================================================
// COMPLETE
// ============================================================================

/**
 * Reaches a verdict from persisted chaos evidence alone.
 *
 * Performs no provider or browser work of any kind. Retry-convergent: an
 * already-terminal regression is re-derived from the same immutable evidence
 * and its Finding is converged with zero further writes once correct.
 */
export async function completeRegression(
  regressionRunId: string,
): Promise<RegressionOperationResult> {
  const regression = await loadRegression(regressionRunId);
  const chaosRun = await getChaosRunById(regression.chaosRunId);
  if (chaosRun === null) {
    return errorOut(regression, "", "ORIGINAL_RUN_UNREADABLE");
  }
  const scenarioId = chaosRun.scenario_id;
  const attempt = refOf(regression, scenarioId);

  // --- The run must have genuinely finished. ------------------------------
  if (chaosRun.status === "FAILED") {
    // Technical execution failure. The regression proved nothing, and a
    // failed EXECUTION is never reported as a failed INVARIANT.
    return errorOut(regression, scenarioId, "EXECUTION_FAILED");
  }
  if (chaosRun.status !== "COMPLETED") {
    if (regression.status === "PENDING" || regression.status === "RUNNING") {
      return { kind: "IN_PROGRESS", attempt };
    }
    return errorOut(regression, scenarioId, "EXECUTION_NOT_STARTABLE");
  }
  if (chaosRun.outcome === "BLOCKED" || chaosRun.outcome === "ERROR") {
    return errorOut(regression, scenarioId, "CHAOS_RUN_BLOCKED");
  }

  // --- The frozen evaluator. Never an invariant called individually. ------
  let evaluation;
  try {
    evaluation = await evaluateChaosRun(regression.chaosRunId);
  } catch {
    return errorOut(regression, scenarioId, "EVALUATION_FAILED");
  }

  const originalInvariantId = await readOriginalInvariantId(
    regression.findingId,
  );

  // --- The frozen R1 decision. Its rules are never restated here. ---------
  const decision = decideRegressionOutcome(evaluation, originalInvariantId);

  // --- Terminalize the regression FIRST (approved durable ordering). ------
  const completedAt = nowIso();
  if (decision.regressionStatus === "RESOLVED") {
    await finalizeRegressionResolved({
      regressionRunId: regression.id,
      completedAt,
    });
  } else if (decision.regressionStatus === "STILL_FAILING") {
    await finalizeRegressionStillFailing({
      regressionRunId: regression.id,
      completedAt,
    });
  } else {
    await finalizeRegressionError({
      regressionRunId: regression.id,
      completedAt,
    });
  }

  // --- Then the Finding lifecycle, if the verdict was conclusive. ---------
  if (decision.findingAction !== "NO_CHANGE") {
    // The Finding must always reflect the NEWEST attempt. An older completed
    // regression being retried has valid history but no authority here.
    if (!(await isNewestConclusiveAttempt(regression))) {
      return superseded(regression, scenarioId, decision.regressionStatus);
    }

    const lifecycle = await readFindingLifecycle(regression.findingId);
    if (lifecycle === null) {
      return errorOut(regression, scenarioId, "ORIGINAL_RUN_UNREADABLE");
    }

    try {
      if (decision.findingAction === "RESOLVE") {
        await resolveFindingAfterRegression({
          findingId: regression.findingId,
          resolvedAt: nowIso(),
          expectedUpdatedAt: lifecycle.updatedAt,
        });
      } else {
        await markFindingStillFailingAfterRegression({
          findingId: regression.findingId,
          updatedAt: nowIso(),
          expectedUpdatedAt: lifecycle.updatedAt,
        });
      }
    } catch (error) {
      // The compare-and-set closes the window the latest-attempt read alone
      // cannot: a newer regression may have completed and moved the Finding
      // between the check above and this write.
      if (
        error instanceof FindingLifecycleError &&
        error.code === "FINDING_LIFECYCLE_STATE_CONFLICT"
      ) {
        if (!(await isNewestConclusiveAttempt(regression))) {
          return superseded(regression, scenarioId, decision.regressionStatus);
        }
        // Still the newest attempt, so this is a genuine conflict about the
        // Finding itself. Never hidden.
        throw error;
      }
      throw error;
    }
  }

  return {
    kind: "COMPLETED",
    attempt,
    regressionStatus: decision.regressionStatus,
    findingAction: decision.findingAction,
    decisionReason: decision.reason,
  };
}
