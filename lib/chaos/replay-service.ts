/**
 * Phase 3C — server-only orchestration for C01's controlled replay
 * execution (docs/CHAOS_SCENARIOS.md Section 13, this task's Section 9
 * "Replay Service").
 *
 * `executeC01Replay(chaosRunId)` is the single trusted entry point. Its
 * ONLY input is an internal `chaos_runs.id` — never a URL, host, endpoint,
 * target, script, SQL, fault string, replay count, authorization boolean,
 * raw webhook body, or Razorpay credential. Its sequence:
 *
 *   1. load the persisted chaos_run (PRE-SEC-011: a run must already exist
 *      durably before it may ever execute — docs/SECURITY.md, satisfied by
 *      Phase 3B's chaos_runs table itself);
 *   2. require it to be an eligible C01/REPLAY_EVENT/RECORDED_TEST_EVIDENCE
 *      PENDING run with both correlation fields present;
 *   3. independently re-resolve the ONE authoritative source evidence via
 *      `lib/chaos/replay-repository.ts` (never trust anything cached on the
 *      run row beyond its own ID fields);
 *   4. PRE-SEC-007: C01's internal replay requires no additional
 *      mechanism-specific Razorpay secret — the event was already
 *      authenticated when the canonical evidence was created; nothing here
 *      invents a RAZORPAY_KEY_SECRET/RAZORPAY_WEBHOOK_SECRET dependency
 *      (docs/SECURITY.md; this task's Section 9 step 5);
 *   5. atomically claim PENDING -> RUNNING (never execute otherwise);
 *   6. create exactly `C01_REPLAY_ATTEMPT_COUNT` new PAYCHAOS_REPLAY
 *      processing attempts and run each through the existing, unmodified
 *      `processMerchantWebhookEvent` — never a second/duplicated merchant
 *      processor implementation;
 *   7. mark the run COMPLETED/UNKNOWN on success, or FAILED/ERROR on a
 *      technical execution failure after RUNNING was claimed.
 *
 * PRE-SEC-010 (operator/session authorization) is NOT this module's
 * concern — it is enforced by the untrusted HTTP boundary
 * (`app/api/chaos/runs/[runId]/replay/route.ts`) before this function is
 * ever called, exactly like `lib/chaos/run-service.ts`'s `createChaosRun`
 * has no untrusted caller boundary of its own.
 *
 * No invariant evaluation happens here — `outcome: "UNKNOWN"` on success is
 * deliberate (this task's Section 8; docs/CHAOS_SCENARIOS.md Money
 * Invariant evaluation is Phase 3F's job).
 */
import "server-only";

import {
  insertReplayProcessingAttempt,
  resolveAuthoritativeC01ReplaySource,
} from "@/lib/chaos/replay-repository";
import {
  completeRunningC01RunUnknown,
  failRunningC01RunExecution,
  getChaosRunById,
  startPendingC01RunAtomically,
  type ChaosRunRow,
} from "@/lib/chaos/run-repository";
import {
  MerchantProcessingError,
  processMerchantWebhookEvent,
} from "@/lib/events/processor";
import { markEventProcessingAttemptFailedIfNotFinal } from "@/lib/webhooks/event-processing-repository";
import { logEvent } from "@/lib/security/logger";

/**
 * Fixed, server-owned replay count for P0 Phase 3C (this task's Section 3
 * "Fixed Replay Count"). Never accepted from a caller — the source-of-truth
 * says "at least twice"; this is the smallest deterministic P0 value.
 */
export const C01_REPLAY_ATTEMPT_COUNT = 2;

export type ReplayServiceResult =
  | {
      readonly kind: "COMPLETED";
      readonly chaosRunId: string;
      readonly replayAttemptCount: number;
    }
  | {
      readonly kind: "NOT_STARTABLE";
      readonly reasonCategory:
        | "RUN_NOT_FOUND"
        | "RUN_NOT_ELIGIBLE"
        | "SOURCE_EVIDENCE_UNRESOLVED"
        | "ALREADY_STARTED_OR_NOT_PENDING";
    }
  | {
      readonly kind: "FAILED";
      readonly chaosRunId: string;
      readonly reasonCategory:
        "EXECUTION_FAILED" | "COMPLETION_PERSISTENCE_FAILED";
    };

const SAFE_EXECUTION_FAILURE_REASON =
  "Chaos replay execution failed before the intended scenario could complete.";

/**
 * Architect correction, Finding 1 — a NEW fixed safe reason, distinct from
 * `SAFE_EXECUTION_FAILURE_REASON` above: used only when the replay
 * mechanism itself completed successfully but the run's final
 * `COMPLETED`/`UNKNOWN` state could not be durably persisted. This is a
 * finalization-persistence failure, not an execution failure — kept as its
 * own fixed string so a `chaos_runs.error_message_redacted` reader can tell
 * the two apart without any raw error detail ever being involved in either.
 */
const SAFE_FINALIZATION_FAILURE_REASON =
  "Chaos replay execution completed, but the final run state could not be persisted.";

/**
 * Architect correction, Finding 2 — the fixed, safe (code, message) pair to
 * persist on the FAILED replay attempt itself via the EXISTING
 * `markEventProcessingAttemptFailedIfNotFinal` (never a raw DB/Postgres
 * error, never `err.message` from an unknown `Error`). `MerchantProcessingError`
 * already carries a deterministic safe `.code` and a fixed safe `.message`
 * (one of `lib/events/processor.ts`'s own `SAFE_MESSAGES`) — reused
 * verbatim. Any other thrown value (should not happen given
 * `processMerchantWebhookEvent`'s own contract, but never trusted blindly)
 * falls back to the existing generic safe processor code/message.
 */
function deriveSafeReplayProcessorFailure(err: unknown): {
  readonly code: string;
  readonly message: string;
} {
  if (err instanceof MerchantProcessingError) {
    return { code: err.code, message: err.message };
  }
  return {
    code: "PROCESSING_TRANSACTION_FAILED",
    message: "Merchant processing failed.",
  };
}

/**
 * `true` only for a chaos_run that Phase 3C is actually allowed to execute
 * as C01 controlled replay — every field independently re-checked against
 * the durably persisted row, never assumed from caller intent.
 */
function isEligibleC01PendingRun(run: ChaosRunRow): run is ChaosRunRow & {
  scenario_id: "C01";
  status: "PENDING";
  fault_type: "REPLAY_EVENT";
  data_classification: "RECORDED_TEST_EVIDENCE";
  source_webhook_event_id: string;
  payment_attempt_id: string;
} {
  return (
    run.scenario_id === "C01" &&
    run.status === "PENDING" &&
    run.fault_type === "REPLAY_EVENT" &&
    run.data_classification === "RECORDED_TEST_EVIDENCE" &&
    run.source_webhook_event_id !== null &&
    run.payment_attempt_id !== null
  );
}

/**
 * Executes C01's controlled replay for one already-persisted PENDING chaos
 * run. See module doc comment for the full sequence. Never throws for an
 * ordinary "not eligible to run right now" condition — those are
 * `NOT_STARTABLE` results. Genuine infrastructure failures reading the run
 * or resolving source evidence (BEFORE the atomic RUNNING claim, so nothing
 * needs to be marked FAILED) propagate as exceptions; the caller (the
 * untrusted route boundary) is responsible for mapping any thrown error to
 * a safe generic response.
 */
export async function executeC01Replay(
  chaosRunId: string,
): Promise<ReplayServiceResult> {
  const run = await getChaosRunById(chaosRunId);
  if (!run) {
    return { kind: "NOT_STARTABLE", reasonCategory: "RUN_NOT_FOUND" };
  }

  if (!isEligibleC01PendingRun(run)) {
    return { kind: "NOT_STARTABLE", reasonCategory: "RUN_NOT_ELIGIBLE" };
  }

  // Independently re-resolve the authoritative source — never trust
  // anything beyond the run's own correlation fields, and never assume the
  // evidence that made this run PENDING is still resolvable now.
  const source = await resolveAuthoritativeC01ReplaySource({
    sourceWebhookEventId: run.source_webhook_event_id,
    paymentAttemptId: run.payment_attempt_id,
    paymentId: run.payment_id,
  });
  if (!source) {
    return {
      kind: "NOT_STARTABLE",
      reasonCategory: "SOURCE_EVIDENCE_UNRESOLVED",
    };
  }

  // PRE-SEC-007: nothing to check here by design — C01 internal replay
  // requires no additional Razorpay secret (see module doc comment).
  // PRE-SEC-011: satisfied — `run` above was loaded from durable storage.

  const claimed = await startPendingC01RunAtomically(chaosRunId);
  if (!claimed) {
    return {
      kind: "NOT_STARTABLE",
      reasonCategory: "ALREADY_STARTED_OR_NOT_PENDING",
    };
  }

  try {
    for (let i = 0; i < C01_REPLAY_ATTEMPT_COUNT; i++) {
      const replayAttempt = await insertReplayProcessingAttempt({
        chaosRunId,
        webhookEventId: source.webhookEventId,
        paymentAttemptId: source.paymentAttemptId,
        paymentId: source.paymentId,
        normalizedEvent: source.normalizedEvent,
      });
      try {
        await processMerchantWebhookEvent(replayAttempt.id);
      } catch (processingErr) {
        // Architect correction, Finding 2 — the existing Phase 2
        // `processMerchantWebhookEvent` never persists a FAILED status
        // itself (that responsibility belongs to the caller, exactly like
        // `lib/webhooks/service.ts`'s real-webhook orchestration already
        // does via this same helper). Without this, a failed
        // PAYCHAOS_REPLAY attempt would durably remain PENDING even though
        // the run itself is marked FAILED/ERROR below — misleading
        // evidence. Only THIS attempt's own ID is ever passed here — never
        // an earlier iteration's ID, so a prior SUCCEEDED replay attempt in
        // this same loop can never be touched. Best-effort: the existing
        // helper already never throws, but this call is defensively
        // isolated anyway so a future change to that contract could never
        // mask the ORIGINAL processing failure being rethrown below.
        const { code, message } =
          deriveSafeReplayProcessorFailure(processingErr);
        await markEventProcessingAttemptFailedIfNotFinal(
          replayAttempt.id,
          code,
          message,
        ).catch(() => {
          // Best-effort only — never mask the original processing failure
          // this iteration is about to rethrow.
        });
        throw processingErr;
      }
    }
  } catch (err) {
    logEvent("chaos_replay_execution_failed", {
      chaos_run_id: chaosRunId,
      error_name: err instanceof Error ? err.name : "UnknownError",
    });
    await failRunningC01RunExecution(
      chaosRunId,
      SAFE_EXECUTION_FAILURE_REASON,
    ).catch(() => {
      // Best-effort only — never mask the original execution failure this
      // function is about to report.
    });
    return { kind: "FAILED", chaosRunId, reasonCategory: "EXECUTION_FAILED" };
  }

  // Architect correction, Finding 1 — both replay attempts succeeded, but
  // the run's own final COMPLETED/UNKNOWN transition might itself fail to
  // persist (a null return) or throw. Either way, the durable chaos_runs
  // row must never be knowingly abandoned as RUNNING — a best-effort
  // FAILED/ERROR finalization is attempted before reporting failure.
  // COMPLETED/ERROR is deliberately NOT used here: that shape is reserved
  // for a later pipeline where the chaos mechanism itself durably completed
  // but a later deterministic evaluation stage fails — here the run's own
  // execution lifecycle could not be durably finalized at all.
  let completed: ChaosRunRow | null;
  try {
    completed = await completeRunningC01RunUnknown(chaosRunId);
  } catch (err) {
    logEvent("chaos_replay_completion_persistence_failed", {
      chaos_run_id: chaosRunId,
      error_name: err instanceof Error ? err.name : "UnknownError",
    });
    completed = null;
  }

  if (!completed) {
    await failRunningC01RunExecution(
      chaosRunId,
      SAFE_FINALIZATION_FAILURE_REASON,
    ).catch(() => {
      // Best-effort only — never mask the safe COMPLETION_PERSISTENCE_FAILED
      // result this function is about to return, and never fabricate a
      // database state if this best-effort call itself fails.
    });
    return {
      kind: "FAILED",
      chaosRunId,
      reasonCategory: "COMPLETION_PERSISTENCE_FAILED",
    };
  }

  return {
    kind: "COMPLETED",
    chaosRunId,
    replayAttemptCount: C01_REPLAY_ATTEMPT_COUNT,
  };
}
