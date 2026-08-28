/**
 * Phase 2F — merchant processor application boundary (this task's Section
 * 25).
 *
 * `import "server-only"` for the same structural reason as every other I/O
 * module in this codebase: it transitively performs Supabase I/O through
 * `lib/webhooks/event-processing-repository.ts` and must never be
 * reachable from a client bundle.
 *
 * This module is intentionally NOT an "agent" — it does no reasoning, no
 * AI, no business-rule evaluation of its own. It:
 *
 *   - invokes the single narrow, trusted `process_webhook_payment_event`
 *     Postgres RPC (via the repository) using ONLY an internal
 *     `event_processing_attempts.id` — never a browser-supplied order id,
 *     payment id, amount, currency, desired status, or fulfilment key;
 *   - validates the RPC's small trusted return shape;
 *   - translates any repository/database failure into one of a small,
 *     deterministic, safe `ProcessorFailureCode` — never forwarding a raw
 *     database error message, raw SQL text, a secret, the raw webhook
 *     body, or card/customer information.
 *
 * All actual money/business-state logic (payment.captured/failed/order.paid
 * handling, amount/currency consistency, fulfilment idempotency, atomicity)
 * lives in the single SQL transaction
 * (supabase/migrations/20260828000000_phase2f_merchant_processing.sql) —
 * this module is a thin, safe, typed boundary in front of it, not a
 * reimplementation of it.
 *
 * ============================================================================
 * Phase 3E-A — evidence snapshot instrumentation
 * ============================================================================
 *
 * This module now also captures `event_processing_attempts.state_before` /
 * `state_after` AROUND the existing merchant-processing call. It is
 * deliberately instrumentation, not a redesign:
 *
 *   - the frozen `process_webhook_payment_event` transaction remains the
 *     ONLY merchant-state authority. Nothing here participates in that
 *     transaction, and no capture/failure/currency/fulfilment rule is
 *     duplicated in TypeScript;
 *   - `processWebhookPaymentEvent` is still called exactly once, with
 *     exactly the same single argument, and its result is still returned
 *     unchanged;
 *   - snapshot capture can NEVER invent payment truth. `captureProcessingSnapshot`
 *     below cannot throw and cannot alter control flow: a capture or
 *     persistence failure leaves the column NULL and is logged safely, while
 *     the processing result/error semantics stay byte-for-byte what Phase 2F
 *     already established. A missing snapshot stays observable so a later
 *     Phase 3F evaluator can return UNKNOWN — the safe outcome — rather than
 *     reading a fabricated one;
 *   - because C01 and C11-B replays and every genuine
 *     `REAL_RAZORPAY_WEBHOOK` delivery already funnel through this single
 *     function, they all inherit snapshots automatically. No replay is
 *     added, no replay count changes, no provenance changes, and no
 *     canonical `webhook_events` row is ever touched here.
 *
 * ============================================================================
 * NO HISTORICAL BACKFILL (Phase 3E-A architect correction)
 * ============================================================================
 *
 * The frozen merchant-processing transaction is idempotent on re-entry: an
 * attempt that succeeded yesterday can be passed to this function again today
 * and returns `outcome = "already_processed"`. Set-once protects an existing
 * snapshot from being overwritten, but it does NOT stop a LATE FIRST WRITE
 * into a column that is still NULL — and every pre-Phase-3E row is NULL by
 * design, because
 * supabase/migrations/20260901000000_phase3e_evidence_snapshots.sql
 * deliberately performs no backfill (reconstructing the past from current
 * mutable state would be false evidence).
 *
 * This function therefore gates ALL snapshot work on a
 * processing-lifecycle eligibility read performed BEFORE the processor is
 * invoked. Snapshots are created only for an invocation that is genuinely
 * participating in a `PENDING` attempt's processing. Concretely:
 *
 *   - historical `SUCCEEDED`/`FAILED`/`HELD`/`SKIPPED_DUPLICATE`/`PROCESSING`
 *     re-entry: no `state_before`, no `state_after` — both stay NULL;
 *   - `outcome = "already_processed"`: no `state_after` for this re-entry;
 *   - a `PROCESSING_ATTEMPT_NOT_READY` failure: no late `state_after`;
 *   - an eligibility READ failure: no snapshots at all, merchant processing
 *     entirely unchanged.
 *
 * A NULL snapshot is authoritative evidence that none was captured. It is
 * strictly preferable to a reconstructed one, and a later Phase 3F evaluator
 * must map it to `UNKNOWN` rather than to a fabricated `PASS`.
 */
import "server-only";

import {
  captureMerchantStateSnapshotForProcessingAttempt,
  getProcessingSnapshotEligibility,
  persistProcessingStateAfter,
  persistProcessingStateBefore,
} from "@/lib/evidence/evidence-repository";
import { logEvent } from "@/lib/security/logger";
import {
  EventProcessingRepositoryError,
  processWebhookPaymentEvent,
} from "@/lib/webhooks/event-processing-repository";

export type ProcessorFailureCode =
  | "PROCESSING_ATTEMPT_NOT_FOUND"
  | "PROCESSING_ATTEMPT_NOT_READY"
  | "PROCESSING_SOURCE_INVALID"
  | "PROCESSING_EVENT_INVALID"
  | "PROCESSING_CORRELATION_INVALID"
  | "PROCESSING_PAYMENT_REQUIRED"
  | "PROCESSING_AMOUNT_MISMATCH"
  | "PROCESSING_CURRENCY_MISMATCH"
  | "PROCESSING_FULFILMENT_CONFLICT"
  | "PROCESSING_TRANSACTION_FAILED";

const PROCESSOR_FAILURE_CODES: ReadonlySet<string> =
  new Set<ProcessorFailureCode>([
    "PROCESSING_ATTEMPT_NOT_FOUND",
    "PROCESSING_ATTEMPT_NOT_READY",
    "PROCESSING_SOURCE_INVALID",
    "PROCESSING_EVENT_INVALID",
    "PROCESSING_CORRELATION_INVALID",
    "PROCESSING_PAYMENT_REQUIRED",
    "PROCESSING_AMOUNT_MISMATCH",
    "PROCESSING_CURRENCY_MISMATCH",
    "PROCESSING_FULFILMENT_CONFLICT",
    "PROCESSING_TRANSACTION_FAILED",
  ]);

function isProcessorFailureCode(value: string): value is ProcessorFailureCode {
  return PROCESSOR_FAILURE_CODES.has(value);
}

/** Fixed, safe messages only — never derived from a raw database error. */
const SAFE_MESSAGES: Record<ProcessorFailureCode, string> = {
  PROCESSING_ATTEMPT_NOT_FOUND: "The processing attempt could not be found.",
  PROCESSING_ATTEMPT_NOT_READY:
    "The processing attempt is not in a state that can be processed.",
  PROCESSING_SOURCE_INVALID:
    "The processing attempt does not carry valid webhook evidence.",
  PROCESSING_EVENT_INVALID:
    "The processing attempt's normalized event is missing, malformed, or unsupported.",
  PROCESSING_CORRELATION_INVALID:
    "The processing attempt's correlated records do not agree.",
  PROCESSING_PAYMENT_REQUIRED:
    "This event requires a correlated payment, but none was found.",
  PROCESSING_AMOUNT_MISMATCH:
    "The event's amount does not match the correlated records.",
  PROCESSING_CURRENCY_MISMATCH:
    "The event's currency does not match the correlated records.",
  PROCESSING_FULFILMENT_CONFLICT:
    "An existing fulfilment for this order does not agree with this payment.",
  PROCESSING_TRANSACTION_FAILED: "Merchant processing failed.",
};

/**
 * The processor's own error type — deliberately distinct from
 * `EventProcessingRepositoryError` (this task's Section 25: "translates
 * database failures into deterministic safe application errors"). Its
 * `.message` is always one of the fixed `SAFE_MESSAGES` strings above,
 * never raw database error text.
 */
export class MerchantProcessingError extends Error {
  readonly code: ProcessorFailureCode;

  constructor(code: ProcessorFailureCode) {
    super(SAFE_MESSAGES[code]);
    this.name = "MerchantProcessingError";
    this.code = code;
  }
}

export interface MerchantProcessingResult {
  readonly outcome: "processed" | "already_processed";
  readonly eventType: string;
  readonly orderId: string;
  readonly paymentId: string | null;
  readonly fulfilmentId: string | null;
}

/**
 * Phase 3E-A — best-effort evidence snapshot capture for one processing
 * attempt.
 *
 * STRUCTURALLY INCAPABLE of affecting merchant processing: it returns
 * `Promise<void>`, swallows every error internally, and is additionally
 * called with a defensive `.catch(() => {})` at each call site (the same
 * doubled best-effort discipline `lib/chaos/replay-service.ts` already
 * applies to `markEventProcessingAttemptFailedIfNotFinal`). There is no code
 * path by which a failed snapshot can change a processing outcome, mark an
 * order PAID/FAILED_OBSERVED, create or suppress a fulfilment, or convert a
 * processing error into a success.
 *
 * It equally never claims a snapshot that does not exist: `ATTEMPT_NOT_FOUND`
 * and every thrown `EvidenceRepositoryError` are logged as a NON-capture, and
 * the column is simply left NULL. `ALREADY_CAPTURED` is a normal, expected
 * outcome (a retried attempt) and is not an error — the pre-existing
 * historical snapshot is preserved untouched.
 *
 * Logged fields are fixed, non-sensitive, and pass through the existing
 * redacting `logEvent`: an internal attempt id, the phase, and an error
 * NAME (never an error message, never raw database text, never a snapshot
 * payload).
 */
/**
 * Phase 3E-A architect correction — the processing-lifecycle gate.
 *
 * Resolves, from the trusted persisted row alone, whether THIS invocation may
 * create snapshots for this attempt. Returns `true` only for a genuinely
 * `PENDING` attempt.
 *
 * Never throws and never alters merchant processing: a terminal/non-runnable
 * row, a missing row, or an infrastructure read failure all resolve to
 * `false`, meaning "capture nothing this time" while the processor call
 * proceeds exactly as it always has. Choosing `false` on a read failure is
 * deliberate — an unverified eligibility claim could produce a fabricated
 * historical snapshot, and NULL is safer than invention.
 */
async function isEligibleForSnapshotCapture(
  processingAttemptId: string,
): Promise<boolean> {
  try {
    const eligibility =
      await getProcessingSnapshotEligibility(processingAttemptId);
    if (eligibility.kind === "ELIGIBLE_PENDING") return true;

    logEvent("evidence_snapshot_skipped", {
      processing_attempt_id: processingAttemptId,
      reason: eligibility.kind,
    });
    return false;
  } catch (err) {
    logEvent("evidence_snapshot_capture_failed", {
      processing_attempt_id: processingAttemptId,
      snapshot_phase: "eligibility",
      error_name: err instanceof Error ? err.name : "UnknownError",
    });
    return false;
  }
}

async function captureProcessingSnapshot(
  processingAttemptId: string,
  phase: "before" | "after",
): Promise<void> {
  try {
    const snapshot =
      await captureMerchantStateSnapshotForProcessingAttempt(
        processingAttemptId,
      );
    const result =
      phase === "before"
        ? await persistProcessingStateBefore(processingAttemptId, snapshot)
        : await persistProcessingStateAfter(processingAttemptId, snapshot);

    if (
      result.outcome === "ATTEMPT_NOT_FOUND" ||
      result.outcome === "NOT_ELIGIBLE"
    ) {
      logEvent("evidence_snapshot_not_captured", {
        processing_attempt_id: processingAttemptId,
        snapshot_phase: phase,
        reason: result.outcome,
      });
    }
  } catch (err) {
    logEvent("evidence_snapshot_capture_failed", {
      processing_attempt_id: processingAttemptId,
      snapshot_phase: phase,
      error_name: err instanceof Error ? err.name : "UnknownError",
    });
  }
}

/**
 * Processes one durable, normalized, correlated `event_processing_attempts`
 * row through the trusted Phase 2F merchant-processing transaction.
 *
 * `processingAttemptId` is the ONLY input — an internal PayChaos UUID
 * already resolved server-side by `lib/webhooks/service.ts` from its own
 * trusted persistence, never a value read directly from an incoming HTTP
 * request body or browser state.
 *
 * Throws `MerchantProcessingError` with a deterministic safe `.code` on any
 * failure — never a raw database error, never a raw webhook body, never a
 * secret.
 *
 * Phase 3E-A wraps the (unchanged) processing call in best-effort
 * `state_before`/`state_after` evidence capture, gated by a
 * processing-lifecycle eligibility read taken BEFORE the processor runs (see
 * the module doc comment's "NO HISTORICAL BACKFILL" section). Snapshots are
 * created only for an invocation genuinely participating in a `PENDING`
 * attempt's processing; a terminal re-entry leaves both columns NULL.
 *
 * For an eligible invocation the `state_after` capture is attempted on BOTH
 * the success and the failure path — a failed attempt's resulting merchant
 * state is itself factual evidence a later evaluator needs
 * (docs/MONEY_INVARIANTS.md INV-009) — except where the result is
 * `already_processed` or the failure is `PROCESSING_ATTEMPT_NOT_READY`, both
 * of which mean this invocation did not perform the processing. Attempting or
 * skipping a snapshot changes nothing about the result returned or the error
 * rethrown.
 */
export async function processMerchantWebhookEvent(
  processingAttemptId: string,
): Promise<MerchantProcessingResult> {
  // Resolved ONCE, before the processor runs, from the trusted persisted row.
  // This single boolean governs BOTH snapshot phases: `state_after` is
  // permitted because this invocation legitimately began a PENDING attempt's
  // processing, NOT because `state_before` happened to persist successfully.
  // A failed `state_before` therefore never suppresses a valid `state_after`
  // from the same genuine processing invocation.
  const eligibleForSnapshots =
    await isEligibleForSnapshotCapture(processingAttemptId);

  if (eligibleForSnapshots) {
    await captureProcessingSnapshot(processingAttemptId, "before").catch(() => {
      // Best-effort only — `captureProcessingSnapshot` already never throws;
      // this guard exists so a future change to that contract could still
      // never affect merchant processing.
    });
  }

  try {
    const result = await processWebhookPaymentEvent(processingAttemptId);

    // `already_processed` means the frozen transaction found this attempt's
    // business effect already applied — this invocation did not perform the
    // processing whose resulting state an "after" snapshot would describe.
    // Capturing here would stamp present-day state onto historical evidence.
    if (eligibleForSnapshots && result.outcome === "already_processed") {
      logEvent("evidence_snapshot_skipped", {
        processing_attempt_id: processingAttemptId,
        snapshot_phase: "after",
        reason: "ALREADY_PROCESSED_REENTRY",
      });
    } else if (eligibleForSnapshots) {
      await captureProcessingSnapshot(processingAttemptId, "after").catch(
        () => {},
      );
    }

    return {
      outcome: result.outcome,
      eventType: result.eventType,
      orderId: result.orderId,
      paymentId: result.paymentId,
      fulfilmentId: result.fulfilmentId,
    };
  } catch (err) {
    // A genuine FIRST processing failure's resulting state is real evidence a
    // later INV-009 evaluation needs, so an "after" snapshot is still
    // attempted. `PROCESSING_ATTEMPT_NOT_READY` is the frozen transaction's
    // own "this attempt is not in a runnable state" rejection — a
    // terminal/non-runnable re-entry — and must never produce a late
    // "after". The raw repository code is read here, BEFORE it is mapped to
    // `MerchantProcessingError`, so the decision stays deterministic. Nothing
    // about the error ultimately thrown to existing callers changes.
    const repositoryCode =
      err instanceof EventProcessingRepositoryError ? err.code : null;

    if (
      eligibleForSnapshots &&
      repositoryCode !== "PROCESSING_ATTEMPT_NOT_READY"
    ) {
      await captureProcessingSnapshot(processingAttemptId, "after").catch(
        () => {},
      );
    } else if (eligibleForSnapshots) {
      logEvent("evidence_snapshot_skipped", {
        processing_attempt_id: processingAttemptId,
        snapshot_phase: "after",
        reason: "PROCESSING_ATTEMPT_NOT_READY",
      });
    }

    if (
      err instanceof EventProcessingRepositoryError &&
      isProcessorFailureCode(err.code)
    ) {
      throw new MerchantProcessingError(err.code);
    }
    throw new MerchantProcessingError("PROCESSING_TRANSACTION_FAILED");
  }
}
