/**
 * Phase 3D-A (correction round 1) — server-only orchestration for C03's
 * invalid-webhook-signature chaos mechanism (docs/CHAOS_SCENARIOS.md
 * Section 15, this task's Section 9 "C03 Execution Service").
 *
 * `executeC03InvalidSignatureTest(chaosRunId)` is the single trusted entry
 * point. Its ONLY input is an internal `chaos_runs.id` — never a body,
 * config, payload, signature, or count.
 *
 * ============================================================================
 * BLOCKER 2 CORRECTION — VERIFICATION-ONLY RUNTIME BOUNDARY
 * ============================================================================
 * The prior round's runtime mechanism invoked the real webhook route
 * (`app/api/webhooks/razorpay/route.ts`'s `POST`) in-process. That is unsafe:
 * if the production signature-verification boundary ever regressed
 * fail-open, C03's own synthetic request could have flowed into the real
 * canonical webhook persistence path and fabricated a `webhook_events` row
 * carrying the production `REAL_RAZORPAY_WEBHOOK` provenance model — exactly
 * the kind of synthetic-evidence-fabrication this project's safety rules
 * forbid, even when the merchant behavior under test is buggy.
 *
 * This module now imports ONLY the underlying verification primitive,
 * `verifyWebhookSignature` from `lib/razorpay/webhook-verification.ts` — the
 * exact same function the real route relies on internally. It does NOT
 * import (directly or transitively through anything it calls):
 *   - `app/api/webhooks/razorpay/route.ts`;
 *   - `lib/webhooks/service.ts` or any webhook/event-processing repository;
 *   - `lib/events/processor.ts` (the merchant-processing transaction).
 * This makes the production runtime mechanism STRUCTURALLY INCAPABLE of
 * creating a `webhook_events`, `event_processing_attempts`, `payments`,
 * `orders`, or `fulfilments` row — not merely unlikely to, by construction,
 * regardless of how the signature-verification behavior itself performs.
 * `tests/unit/chaos/c03-static-guard.test.ts` proves this import boundary
 * statically.
 *
 * `verifyWebhookSignature` internally reads the real configured secret in
 * the normal production way (the exact boundary being tested) — this module
 * never retrieves the secret value itself merely to manufacture an HMAC.
 *
 * Two fixed runtime cases:
 *   - WRONG_SIGNATURE: a deliberately malformed, fixed, server-owned
 *     signature value that is rejected by `verifyWebhookSignature`'s own
 *     accepted-format contract (`isWellFormedSignature`) DETERMINISTICALLY —
 *     never a "cryptographically guaranteed" argument about a well-formed
 *     value happening not to collide with the real HMAC, which would be
 *     mathematically false reasoning even at negligible probability. The
 *     deeper exact-raw-body HMAC-MISMATCH case (a well-formed-but-wrong
 *     64-hex signature) is separately and rigorously proven by the
 *     MODIFIED_BODY unit test using a controlled synthetic secret, where the
 *     mismatch is exact and provable, not probabilistic.
 *   - MISSING_SIGNATURE: represents "no signature supplied" using the
 *     smallest existing verification-layer API available —
 *     `verifyWebhookSignature`'s input requires a `string`, and
 *     `lib/razorpay/webhook-verification.ts` exposes no separate
 *     missing-value overload, so an absent header is represented as an
 *     empty string, which the same `isWellFormedSignature` shape check also
 *     rejects before any crypto comparison. The distinct HTTP-level
 *     classification between "missing" (`WebhookSignatureMissingError`) and
 *     "invalid" (`WebhookSignatureInvalidError`) is an application-layer
 *     distinction implemented in `lib/webhooks/service.ts` — deliberately
 *     not imported here — and is proven separately by the offline
 *     route-level tests (`tests/unit/api/webhooks-razorpay-route-signature-rejection.test.ts`)
 *     that exercise the real route with persistence mocked.
 *
 * If verification unexpectedly ACCEPTS either fixed invalid input (a
 * potential fail-open regression), that is NOT a technical execution
 * error — it is recorded as `classification: "UNEXPECTED_ACCEPTANCE"` and
 * the run still completes `COMPLETED`/`UNKNOWN`. A later Phase 3F Money
 * Invariant Engine decides PASS/FAIL; this module never does.
 *
 * ============================================================================
 * BLOCKER 1 CORRECTION — PRE-SEC-007 BLOCK PERSISTENCE MUST BE VERIFIED
 * ============================================================================
 * The prior round returned `BLOCKED_PRE_SEC_007` whenever
 * `blockPendingC03RunForPreSec007` was CALLED, even if it threw, returned
 * `null`, or returned an unexpected shape — meaning the API could report
 * `COMPLETED/BLOCKED/PRE-SEC-007` while the durable row was actually still
 * `PENDING` (or had been changed by a concurrent actor). Verified persisted
 * state is authoritative in this project; a claim the database does not
 * back is never acceptable.
 *
 * This module now independently validates the EXACT returned row shape
 * (`isValidPreSec007BlockedShape`) before ever returning `BLOCKED_PRE_SEC_007`.
 * Any throw, `null`, or shape mismatch returns `BLOCK_PERSISTENCE_FAILED`
 * instead — the mechanism never executes either way (no RUNNING claim, no
 * verification call), and the run's own durable state is left exactly as
 * the repository call left it (PENDING, or whatever a concurrent actor did)
 * — this module never fabricates a `FAILED`/`ERROR` transition for a run
 * whose execution never started.
 *
 * PRE-SEC-010 (operator/session authorization) is NOT this module's
 * concern — it is enforced by the untrusted HTTP boundary
 * (`app/api/chaos/runs/[runId]/execute-c03/route.ts`) before this function
 * is ever called, exactly like `lib/chaos/replay-service.ts`'s
 * `executeC01Replay`.
 */
import "server-only";

import { getRazorpayWebhookSecret } from "@/lib/config/razorpay-webhook-env";
import { verifyWebhookSignature } from "@/lib/razorpay/webhook-verification";
import { captureC03MutationSnapshot } from "@/lib/chaos/c03-mutation-snapshot-repository";
import {
  C03_MUTATION_SNAPSHOT_VERSION,
  serializeC03MutationEvidence,
  type C03MutationEvidenceV1,
  type C03MutationSnapshotV1,
} from "@/lib/chaos/c03-mutation-snapshot";
import {
  blockPendingC03RunForPreSec007,
  completeRunningChaosRunUnknown,
  failRunningChaosRunExecution,
  getChaosRunById,
  startPendingC03RunAtomically,
  type ChaosRunRow,
} from "@/lib/chaos/run-repository";
import { logEvent } from "@/lib/security/logger";

/**
 * Deliberately malformed shape — never 64 lowercase hex characters — so
 * rejection is guaranteed by `verifyWebhookSignature`'s own accepted-format
 * contract (`isWellFormedSignature`) BEFORE any HMAC comparison is even
 * attempted. See module doc comment for why this avoids a probabilistic
 * cryptographic-guarantee claim.
 */
const WRONG_SIGNATURE_VALUE = "paychaos-synthetic-wrong-signature-value";

/**
 * Represents "no signature supplied" at `verifyWebhookSignature`'s own typed
 * API surface (see module doc comment). Also rejected by the same
 * accepted-format contract before any crypto comparison.
 */
const MISSING_SIGNATURE_VALUE = "";

/** Small, server-owned, synthetic raw body — no genuine Razorpay payment/order/event IDs, no customer/card data, no secret. Never transmitted over any network or HTTP boundary; used only as the exact bytes `verifyWebhookSignature` hashes. */
function buildSyntheticC03RawBody(
  chaosRunId: string,
  caseName: string,
): Buffer {
  return Buffer.from(
    JSON.stringify({
      event: "payment.captured",
      payload: {
        payment: {
          entity: { id: `paychaos_synthetic_c03_${chaosRunId}_${caseName}` },
        },
      },
    }),
    "utf8",
  );
}

export type C03RuntimeCase = "WRONG_SIGNATURE" | "MISSING_SIGNATURE";
export type C03CheckClassification = "REJECTED" | "UNEXPECTED_ACCEPTANCE";

export interface C03CheckResult {
  readonly case: C03RuntimeCase;
  readonly classification: C03CheckClassification;
}

export interface C03FaultState {
  readonly checks: readonly C03CheckResult[];
  /**
   * Phase 3F evidence-compatibility correction — the before/after merchant
   * state observed around the two controlled verification checks, captured
   * during THIS run.
   *
   * docs/MONEY_INVARIANTS.md INV-005 states its rule as three deltas
   * (`trusted canonical webhook rows created = 0`, `payment/business state
   * delta = 0`, `fulfilment delta = 0`) and §6 requires before/after snapshots
   * of `orders`, `payment_attempts`, `payments`, `fulfilments` and
   * `webhook_events`. C03 correctly creates no `event_processing_attempts`
   * row, so it has no `state_before`/`state_after` pair and had nowhere to put
   * this evidence until now. It lives here, on the existing `fault_state`
   * JSONB column — no new table, no fabricated processing attempt, no
   * fabricated webhook event.
   *
   * This is FACTUAL EVIDENCE, never a verdict. Nothing in this module compares
   * `before` against `after`; that comparison IS INV-005's decision and
   * belongs to the Phase 3F Money Invariant Engine.
   */
  readonly mutationEvidence: C03MutationEvidenceV1;
}

/**
 * Invokes the real, unmodified `verifyWebhookSignature` for one fixed
 * synthetic case. `verified === true` (an unexpected acceptance of invalid
 * input — a potential fail-open regression) is recorded as
 * `UNEXPECTED_ACCEPTANCE`, never converted to an invariant verdict here. A
 * thrown exception (e.g. a secret becoming invalid mid-flight) propagates —
 * the caller's outer try/catch treats that as a genuine technical execution
 * failure.
 */
function runVerificationCase(
  caseName: C03RuntimeCase,
  signature: string,
  rawBody: Buffer,
): C03CheckResult {
  const verified = verifyWebhookSignature({ rawBody, signature });
  return {
    case: caseName,
    classification: verified ? "UNEXPECTED_ACCEPTANCE" : "REJECTED",
  };
}

/**
 * Captures one side of the C03 mutation evidence without ever being able to
 * fail the run.
 *
 * `captureC03MutationSnapshot` is already written not to throw, so this is
 * belt-and-braces: a capture problem must NEVER prevent the two signature
 * checks from executing (they are the scenario), and must NEVER be papered
 * over with a fabricated snapshot. A `null` here is a truthful "this evidence
 * was not captured", which a later evaluator turns into UNKNOWN — not into a
 * PASS, and not into a FAIL.
 */
async function captureC03MutationSnapshotSafely(
  chaosRunId: string,
  side: "before" | "after",
): Promise<C03MutationSnapshotV1 | null> {
  try {
    return await captureC03MutationSnapshot();
  } catch (err) {
    logEvent("chaos_c03_mutation_snapshot_capture_failed", {
      chaos_run_id: chaosRunId,
      side,
      error_name: err instanceof Error ? err.name : "UnknownError",
    });
    return null;
  }
}

function isEligibleC03PendingRun(run: ChaosRunRow): boolean {
  return (
    run.scenario_id === "C03" &&
    run.status === "PENDING" &&
    run.fault_type === "INVALID_SIGNATURE_TEST" &&
    run.data_classification === "SYNTHETIC_DEMO"
  );
}

/**
 * Blocker 1 — the exact durable shape a genuine PRE-SEC-007 BLOCKED
 * transition must have before this module will ever report
 * `BLOCKED_PRE_SEC_007` to a caller. Anything else (wrong id, wrong
 * scenario, wrong lifecycle fields) means the returned row does not
 * actually prove what the caller is about to claim.
 */
function isValidPreSec007BlockedShape(
  row: ChaosRunRow,
  chaosRunId: string,
): boolean {
  return (
    row.id === chaosRunId &&
    row.scenario_id === "C03" &&
    row.fault_type === "INVALID_SIGNATURE_TEST" &&
    row.data_classification === "SYNTHETIC_DEMO" &&
    row.status === "COMPLETED" &&
    row.outcome === "BLOCKED" &&
    row.failed_precheck_id === null &&
    row.execution_block_code === "PRE-SEC-007" &&
    row.started_at === null &&
    row.completed_at !== null
  );
}

const SAFE_PRE_SEC_007_BLOCK_REASON =
  "Required server secrets for webhook verification were unavailable.";
const SAFE_EXECUTION_FAILURE_REASON =
  "Chaos execution failed before the intended scenario could complete.";
const SAFE_FINALIZATION_FAILURE_REASON =
  "Chaos execution completed, but the final run state could not be persisted.";

export type C03ExecutionResult =
  | {
      readonly kind: "COMPLETED";
      readonly chaosRunId: string;
      readonly checks: readonly C03CheckResult[];
    }
  | {
      readonly kind: "BLOCKED_PRE_SEC_007";
      readonly chaosRunId: string;
    }
  | {
      /**
       * Blocker 1 — PRE-SEC-007 failed AND the attempted BLOCKED transition
       * could not be durably proven (threw, returned null, lost a race, or
       * returned an unexpected shape). The mechanism never executed. The
       * run's actual durable state is unknown to the caller from this result
       * alone (it may still be PENDING, or have been changed by a
       * concurrent actor) — never presented as BLOCKED, and never
       * fabricated as FAILED/ERROR, since execution never began.
       */
      readonly kind: "BLOCK_PERSISTENCE_FAILED";
      readonly chaosRunId: string;
    }
  | {
      readonly kind: "NOT_STARTABLE";
      readonly reasonCategory:
        "RUN_NOT_FOUND" | "RUN_NOT_ELIGIBLE" | "ALREADY_STARTED_OR_NOT_PENDING";
    }
  | {
      readonly kind: "FAILED";
      readonly chaosRunId: string;
      readonly reasonCategory:
        "EXECUTION_FAILED" | "COMPLETION_PERSISTENCE_FAILED";
    };

/**
 * Executes C03's invalid-webhook-signature chaos mechanism for one
 * already-persisted PENDING chaos run. See module doc comment for the full
 * sequence and both correction rationales. Never throws for an ordinary
 * "not eligible to run right now" condition — those are
 * `NOT_STARTABLE`/`BLOCKED_PRE_SEC_007`/`BLOCK_PERSISTENCE_FAILED` results.
 * Genuine infrastructure failures reading the run (BEFORE any transition
 * attempt) propagate as exceptions; the caller (the untrusted route
 * boundary) is responsible for mapping any thrown error to a safe generic
 * response.
 */
export async function executeC03InvalidSignatureTest(
  chaosRunId: string,
): Promise<C03ExecutionResult> {
  const run = await getChaosRunById(chaosRunId);
  if (!run) {
    return { kind: "NOT_STARTABLE", reasonCategory: "RUN_NOT_FOUND" };
  }

  if (!isEligibleC03PendingRun(run)) {
    return { kind: "NOT_STARTABLE", reasonCategory: "RUN_NOT_ELIGIBLE" };
  }

  // PRE-SEC-007: confirm required server secrets exist. The returned value
  // is never read/used — only whether this call succeeds or throws matters.
  try {
    getRazorpayWebhookSecret();
  } catch {
    let blockedRun: ChaosRunRow | null = null;
    try {
      blockedRun = await blockPendingC03RunForPreSec007(
        chaosRunId,
        SAFE_PRE_SEC_007_BLOCK_REASON,
      );
    } catch (err) {
      logEvent("chaos_c03_pre_sec_007_block_persistence_failed", {
        chaos_run_id: chaosRunId,
        error_name: err instanceof Error ? err.name : "UnknownError",
      });
      return { kind: "BLOCK_PERSISTENCE_FAILED", chaosRunId };
    }

    if (!blockedRun || !isValidPreSec007BlockedShape(blockedRun, chaosRunId)) {
      logEvent("chaos_c03_pre_sec_007_block_persistence_failed", {
        chaos_run_id: chaosRunId,
      });
      return { kind: "BLOCK_PERSISTENCE_FAILED", chaosRunId };
    }

    // Independently proven above — the durable row genuinely is the
    // execution-time BLOCKED shape this result claims.
    return { kind: "BLOCKED_PRE_SEC_007", chaosRunId };
  }

  const claimed = await startPendingC03RunAtomically(chaosRunId);
  if (!claimed) {
    return {
      kind: "NOT_STARTABLE",
      reasonCategory: "ALREADY_STARTED_OR_NOT_PENDING",
    };
  }

  try {
    // FROZEN EXECUTION ORDER: capture BEFORE -> WRONG_SIGNATURE ->
    // MISSING_SIGNATURE -> capture AFTER. The two captures bracket the two
    // controlled verification checks and nothing else, so the observation
    // window contains only synchronous, in-process HMAC comparisons — no
    // network call, no HTTP request, no merchant processing and no write.
    //
    // Capture is INSTRUMENTATION. It never becomes merchant-state authority,
    // never gates the checks, and never decides an invariant.
    const stateBefore = await captureC03MutationSnapshotSafely(
      chaosRunId,
      "before",
    );

    const wrongSignatureCheck = runVerificationCase(
      "WRONG_SIGNATURE",
      WRONG_SIGNATURE_VALUE,
      buildSyntheticC03RawBody(chaosRunId, "wrong"),
    );
    const missingSignatureCheck = runVerificationCase(
      "MISSING_SIGNATURE",
      MISSING_SIGNATURE_VALUE,
      buildSyntheticC03RawBody(chaosRunId, "missing"),
    );

    const stateAfter = await captureC03MutationSnapshotSafely(
      chaosRunId,
      "after",
    );

    const faultState: C03FaultState = {
      checks: [wrongSignatureCheck, missingSignatureCheck],
      mutationEvidence: {
        version: C03_MUTATION_SNAPSHOT_VERSION,
        before: stateBefore,
        after: stateAfter,
      },
    };

    let completed: ChaosRunRow | null;
    try {
      completed = await completeRunningChaosRunUnknown(chaosRunId, {
        // Serialized explicitly, field by field, rather than cast — the
        // persisted JSON is exactly the declared contract and nothing else.
        checks: faultState.checks.map((check) => ({
          case: check.case,
          classification: check.classification,
        })),
        mutationEvidence: serializeC03MutationEvidence(
          faultState.mutationEvidence,
        ),
      });
    } catch (err) {
      logEvent("chaos_c03_completion_persistence_failed", {
        chaos_run_id: chaosRunId,
        error_name: err instanceof Error ? err.name : "UnknownError",
      });
      completed = null;
    }

    if (!completed) {
      await failRunningChaosRunExecution(
        chaosRunId,
        SAFE_FINALIZATION_FAILURE_REASON,
      ).catch(() => {
        // Best-effort only — never mask the safe
        // COMPLETION_PERSISTENCE_FAILED result this function is about to
        // return, and never fabricate a database state if this best-effort
        // call itself fails.
      });
      return {
        kind: "FAILED",
        chaosRunId,
        reasonCategory: "COMPLETION_PERSISTENCE_FAILED",
      };
    }

    return { kind: "COMPLETED", chaosRunId, checks: faultState.checks };
  } catch (err) {
    logEvent("chaos_c03_execution_failed", {
      chaos_run_id: chaosRunId,
      error_name: err instanceof Error ? err.name : "UnknownError",
    });
    await failRunningChaosRunExecution(
      chaosRunId,
      SAFE_EXECUTION_FAILURE_REASON,
    ).catch(() => {
      // Best-effort only — never mask the original execution failure this
      // function is about to report.
    });
    return { kind: "FAILED", chaosRunId, reasonCategory: "EXECUTION_FAILED" };
  }
}
