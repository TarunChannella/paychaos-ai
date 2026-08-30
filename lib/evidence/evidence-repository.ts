/**
 * Phase 3E-A — server-only persistence boundary for the
 * `event_processing_attempts.state_before` / `state_after` evidence
 * snapshots.
 *
 * `import "server-only"` for the same structural reason as every other
 * repository in this codebase: it performs Supabase I/O with the
 * service-role client and must never be reachable from a client bundle.
 *
 * This module is the ONLY place `state_before`/`state_after` are written. It
 * is deliberately narrow:
 *
 *   - it READS `event_processing_attempts`, `payment_attempts`, `orders`,
 *     `payments` and `fulfilments` through explicit column allowlists (never
 *     `select *`), purely to assemble a snapshot;
 *   - it WRITES exactly two columns on exactly one table:
 *     `event_processing_attempts.state_before` and
 *     `event_processing_attempts.state_after`. It never inserts, updates,
 *     deletes or upserts `orders`, `payment_attempts`, `payments`,
 *     `fulfilments`, `webhook_events` or `chaos_runs`, and it never touches
 *     any other column of `event_processing_attempts` (not `status`, not
 *     `finished_at`, not `error_code`);
 *   - its ONLY caller-supplied input is an internal processing-attempt UUID
 *     already resolved server-side. It accepts no URL, host, hostname, IP,
 *     webhook_url, callback_url, target_endpoint, table name, column name,
 *     order id, payment id, amount, currency, status or merchant state from
 *     a browser or any untrusted source. Every correlated fact is loaded
 *     from trusted persisted rows here.
 *
 * It performs no HTTP request of any kind, calls no Razorpay API, invokes no
 * RPC, and never touches an LLM. Money/business truth stays entirely inside
 * the frozen `process_webhook_payment_event` transaction; this module only
 * photographs the result.
 *
 * Errors never escape as raw Supabase/Postgres errors — `EvidenceRepositoryError`
 * carries a fixed safe `.code` and a fixed safe `.message`, matching the
 * established `ChaosRunRepositoryError`/`EventProcessingRepositoryError`
 * pattern.
 */
import "server-only";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { EventProcessingAttemptStatus } from "@/lib/supabase/types";
import {
  buildMerchantStateSnapshot,
  serializeMerchantStateSnapshot,
  type MerchantStateSnapshotV1,
  type MerchantStateSnapshotSourceFulfilmentRow,
  type MerchantStateSnapshotSourceOrderRow,
  type MerchantStateSnapshotSourcePaymentAttemptRow,
  type MerchantStateSnapshotSourcePaymentRow,
} from "@/lib/evidence/merchant-state-snapshot";

/** Deterministic domain error for this repository's I/O failures — never leaks the raw Supabase error. */
export class EvidenceRepositoryError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "EvidenceRepositoryError";
    this.code = code;
  }
}

/**
 * Explicit column allowlists. Written out as literal strings rather than
 * derived from the snapshot types so that adding a column to any of these
 * tables can never silently widen what gets read into evidence — and so a
 * reviewer can see the entire read surface of this module in one place.
 */
const ATTEMPT_COLUMNS = "id, payment_attempt_id, payment_id";
const PAYMENT_ATTEMPT_COLUMNS =
  "id, order_id, status, amount_subunits, currency, razorpay_order_id, razorpay_order_status";
const ORDER_COLUMNS =
  "id, payment_status, business_status, amount_subunits, currency";
const PAYMENT_COLUMNS =
  "id, payment_attempt_id, razorpay_payment_id, razorpay_payment_status, amount_subunits, currency, checkout_signature_verified, captured_at, failed_at";
const FULFILMENT_COLUMNS =
  "id, order_id, payment_id, trigger_processing_attempt_id, effect_type, applied_at, idempotency_key";

/**
 * Captures the correlated merchant state for one trusted processing attempt.
 *
 * `processingAttemptId` is the ONLY input — an internal PayChaos UUID
 * already resolved server-side by `lib/events/processor.ts`'s own caller,
 * never a value read directly from an HTTP request body or browser state.
 * Correlation is resolved strictly through the durably persisted trusted
 * columns of the attempt itself:
 *
 *   attempt.payment_attempt_id -> payment_attempts -> .order_id -> orders
 *   attempt.payment_id         -> payments
 *   resolved order id          -> fulfilments (all rows for that order)
 *
 * It never guesses a correlation the attempt row does not itself assert —
 * e.g. it does not go looking for "some payment belonging to this payment
 * attempt" when `attempt.payment_id` is NULL. A NULL correlation legitimately
 * produces a NULL entity in the snapshot (this task's Section 10: an event
 * processed before its canonical `payments` row existed genuinely had no
 * payment at that moment, and pretending otherwise would invent evidence).
 *
 * A genuinely ABSENT row (the query succeeded and matched nothing) becomes
 * `null`. A genuine READ FAILURE is never converted to `null` — that would
 * silently claim "this entity does not exist" on the strength of an
 * infrastructure error — and instead throws `EvidenceRepositoryError`, which
 * the caller treats as "no snapshot was captured" and leaves the column NULL.
 */
export async function captureMerchantStateSnapshotForProcessingAttempt(
  processingAttemptId: string,
): Promise<MerchantStateSnapshotV1> {
  const client = getSupabaseServerClient();

  const { data: attempt, error: attemptError } = await client
    .from("event_processing_attempts")
    .select(ATTEMPT_COLUMNS)
    .eq("id", processingAttemptId)
    .maybeSingle();

  if (attemptError) {
    throw new EvidenceRepositoryError(
      "EVIDENCE_PROCESSING_ATTEMPT_LOOKUP_FAILED",
      "Failed to load the processing attempt for evidence capture.",
    );
  }
  if (!attempt) {
    throw new EvidenceRepositoryError(
      "EVIDENCE_PROCESSING_ATTEMPT_NOT_FOUND",
      "The processing attempt to snapshot could not be found.",
    );
  }

  let paymentAttempt: MerchantStateSnapshotSourcePaymentAttemptRow | null =
    null;
  if (attempt.payment_attempt_id) {
    const { data, error } = await client
      .from("payment_attempts")
      .select(PAYMENT_ATTEMPT_COLUMNS)
      .eq("id", attempt.payment_attempt_id)
      .maybeSingle();
    if (error) {
      throw new EvidenceRepositoryError(
        "EVIDENCE_PAYMENT_ATTEMPT_LOOKUP_FAILED",
        "Failed to load the correlated payment attempt for evidence capture.",
      );
    }
    paymentAttempt = data;
  }

  let order: MerchantStateSnapshotSourceOrderRow | null = null;
  if (paymentAttempt) {
    const { data, error } = await client
      .from("orders")
      .select(ORDER_COLUMNS)
      .eq("id", paymentAttempt.order_id)
      .maybeSingle();
    if (error) {
      throw new EvidenceRepositoryError(
        "EVIDENCE_ORDER_LOOKUP_FAILED",
        "Failed to load the correlated order for evidence capture.",
      );
    }
    order = data;
  }

  let payment: MerchantStateSnapshotSourcePaymentRow | null = null;
  if (attempt.payment_id) {
    const { data, error } = await client
      .from("payments")
      .select(PAYMENT_COLUMNS)
      .eq("id", attempt.payment_id)
      .maybeSingle();
    if (error) {
      throw new EvidenceRepositoryError(
        "EVIDENCE_PAYMENT_LOOKUP_FAILED",
        "Failed to load the correlated payment for evidence capture.",
      );
    }
    payment = data;
  }

  // `null` (not `[]`) whenever no order was resolved: `[]` would be a
  // positive claim that the order had zero fulfilments, and there is no
  // order here to make that claim about.
  let fulfilments: readonly MerchantStateSnapshotSourceFulfilmentRow[] | null =
    null;
  if (order) {
    const { data, error } = await client
      .from("fulfilments")
      .select(FULFILMENT_COLUMNS)
      .eq("order_id", order.id);
    if (error) {
      throw new EvidenceRepositoryError(
        "EVIDENCE_FULFILMENT_LOOKUP_FAILED",
        "Failed to load the correlated fulfilments for evidence capture.",
      );
    }
    // Deterministic ordering is applied by `buildMerchantStateSnapshot`, not
    // relied upon from the database's return order.
    fulfilments = data ?? [];
  }

  return buildMerchantStateSnapshot({
    order,
    paymentAttempt,
    payment,
    fulfilments,
  });
}

/**
 * ============================================================================
 * PROCESSING-LIFECYCLE ELIGIBILITY (Phase 3E-A architect correction)
 * ============================================================================
 *
 * Set-once alone is NOT enough to protect historical truth. It prevents an
 * OVERWRITE of a non-null value; it does nothing about a LATE FIRST WRITE
 * into a column that is still NULL.
 *
 * The frozen merchant-processing transaction is idempotent on re-entry: a
 * processing attempt that already succeeded yesterday can be passed to
 * `processMerchantWebhookEvent` again today and will return
 * `outcome = "already_processed"`. Without a lifecycle gate, that re-entry
 * would read TODAY's merchant state and persist it into a still-NULL
 * `state_before`, producing evidence that claims to describe the state
 * around YESTERDAY's processing. That is fabricated history — precisely what
 * `20260901000000_phase3e_evidence_snapshots.sql` promises never happens when
 * it deliberately leaves every pre-Phase-3E row NULL instead of backfilling.
 *
 * The governing rule is therefore: a snapshot may be created only when the
 * CURRENT invocation is legitimately participating in that attempt's
 * processing lifecycle. `status = 'PENDING'` is that condition — the attempt
 * has not been processed yet, so "the state right now" genuinely is "the
 * state before this processing".
 *
 * `PROCESSING` is deliberately NOT eligible even though the frozen RPC admits
 * it (`status not in ('PENDING', 'PROCESSING')` raises
 * `PROCESSING_ATTEMPT_NOT_READY` —
 * supabase/migrations/20260828000000_phase2f_merchant_processing.sql, kept
 * verbatim by the Phase 3C revision). `PROCESSING` means an earlier
 * invocation already began this attempt's lifecycle; a later invocation
 * arriving at that point is a recovery re-entry, not the fresh execution
 * whose "before" state this column is supposed to describe.
 *
 * `HELD`, `SUCCEEDED`, `FAILED` and `SKIPPED_DUPLICATE` are the remaining
 * literals of `event_processing_attempts_status_valid`
 * (supabase/migrations/20260827000000_phase2e_webhook_dedup.sql) — all
 * terminal or non-runnable, all ineligible.
 */
export type ProcessingSnapshotEligibility =
  | { readonly kind: "ELIGIBLE_PENDING"; readonly status: "PENDING" }
  | {
      readonly kind: "NOT_ELIGIBLE_TERMINAL";
      readonly status: EventProcessingAttemptStatus;
    }
  | { readonly kind: "ATTEMPT_NOT_FOUND" }
  | { readonly kind: "READ_FAILED" };

/**
 * Trusted read of one processing attempt's snapshot eligibility.
 *
 * Its ONLY input is an internal processing-attempt UUID; it accepts no
 * merchant state, no status and no eligibility claim from any caller — the
 * status is loaded from the durably persisted row every time.
 *
 * Deliberately NEVER THROWS, and deliberately never lets a raw Supabase error
 * escape: an infrastructure failure is reported as the explicit `READ_FAILED`
 * value so the caller can fall back to "capture nothing" while merchant
 * processing continues unchanged. Fail-closed for evidence, transparent for
 * payments — NULL is safer than invention.
 */
export async function getProcessingSnapshotEligibility(
  processingAttemptId: string,
): Promise<ProcessingSnapshotEligibility> {
  try {
    const client = getSupabaseServerClient();
    const { data, error } = await client
      .from("event_processing_attempts")
      .select("id, status")
      .eq("id", processingAttemptId)
      .maybeSingle();

    if (error) return { kind: "READ_FAILED" };
    if (!data) return { kind: "ATTEMPT_NOT_FOUND" };
    if (data.status === "PENDING") {
      return { kind: "ELIGIBLE_PENDING", status: "PENDING" };
    }
    return { kind: "NOT_ELIGIBLE_TERMINAL", status: data.status };
  } catch {
    return { kind: "READ_FAILED" };
  }
}

/**
 * What a set-once snapshot write actually did.
 *
 * `CAPTURED` — this call wrote the snapshot, and the write was independently
 * verified from the returned row (a call that merely "did not throw" is
 * never reported as success; see `verifyPersistedSnapshot` below).
 *
 * `ALREADY_CAPTURED` — a snapshot was already present, so this call wrote
 * nothing and the pre-existing historical evidence is returned unchanged. A
 * retry must never rewrite historical evidence (docs/DATABASE.md Principle 7).
 *
 * `NOT_ELIGIBLE` — the attempt exists and its snapshot column is still NULL,
 * but the row is no longer at `status = 'PENDING'`, so this invocation is too
 * late to describe the state "before" its processing. NULL is kept, and that
 * NULL is authoritative historical truth ("never captured") — NOT a
 * persistence fault to be repaired.
 *
 * `ATTEMPT_NOT_FOUND` — no such processing attempt exists. Nothing was
 * written and nothing is claimed.
 */
export type PersistSnapshotOutcome =
  "CAPTURED" | "ALREADY_CAPTURED" | "NOT_ELIGIBLE" | "ATTEMPT_NOT_FOUND";

export interface PersistSnapshotResult {
  readonly outcome: PersistSnapshotOutcome;
  /** The value now durably in the column, read back from the database — `null` for `NOT_ELIGIBLE` and `ATTEMPT_NOT_FOUND`. */
  readonly snapshot: Record<string, unknown> | null;
}

/**
 * "Verified persisted state is authoritative" (the Phase 3D-E architect
 * correction, applied here too): a write is only reported as successful when
 * the row the database actually returned carries a JSON OBJECT in the target
 * column. A returned row whose column is missing, `null`, a scalar or an
 * array means the durable state is not what this module intended, and that
 * must surface as an error rather than as a false "snapshot captured".
 */
function verifyPersistedSnapshot(
  value: unknown,
  code: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new EvidenceRepositoryError(
      code,
      "The evidence snapshot write could not be verified as durably persisted.",
    );
  }
  return value as Record<string, unknown>;
}

/**
 * Persists `state_before` for one processing attempt, SET-ONCE **and**
 * LIFECYCLE-GUARDED.
 *
 * The write is a single atomic conditional UPDATE carrying BOTH predicates:
 *
 *   `.update({ state_before: value })`
 *     `.eq("id", processingAttemptId)`
 *     `.eq("status", "PENDING")`      <- lifecycle guard: no late first write
 *     `.is("state_before", null)`     <- set-once guard: no overwrite
 *
 * Postgres evaluates both as part of the UPDATE itself, so this is race-safe
 * in a way a separate eligibility read can never be on its own. It closes the
 * exact window the architect correction identified: eligibility read says
 * PENDING -> another caller processes the attempt to SUCCEEDED -> the stale
 * caller writes a "before" snapshot describing state from AFTER processing.
 * The stale caller now matches zero rows instead.
 *
 * Zero matched rows is deliberately NOT treated as failure. A follow-up read
 * of `id`/`status`/`state_before` distinguishes truthfully between:
 *
 *   - the attempt is absent            -> `ATTEMPT_NOT_FOUND`
 *   - a snapshot already exists        -> `ALREADY_CAPTURED` (preserved, returned)
 *   - still NULL but no longer PENDING -> `NOT_ELIGIBLE` (NULL is correct history)
 *   - still NULL and still PENDING     -> a genuine persistence inconsistency,
 *                                         raised as an error rather than
 *                                         silently reported as success
 *
 * `NOT_ELIGIBLE` deliberately does NOT go through `verifyPersistedSnapshot`:
 * a NULL column on a non-PENDING row is valid historical truth ("this
 * snapshot was never captured"), not persistence corruption.
 *
 * Deliberately duplicated rather than parameterized over the column name:
 * a literal column keeps the Supabase client's own generated types checking
 * this write, and keeps the update payload structurally incapable of
 * naming any other column — including any column of any other table.
 */
export async function persistProcessingStateBefore(
  processingAttemptId: string,
  snapshot: MerchantStateSnapshotV1,
): Promise<PersistSnapshotResult> {
  const client = getSupabaseServerClient();
  const value = serializeMerchantStateSnapshot(snapshot);

  const { data: written, error: writeError } = await client
    .from("event_processing_attempts")
    .update({ state_before: value })
    .eq("id", processingAttemptId)
    .eq("status", "PENDING")
    .is("state_before", null)
    .select("id, status, state_before")
    .maybeSingle();

  if (writeError) {
    throw new EvidenceRepositoryError(
      "EVIDENCE_STATE_BEFORE_WRITE_FAILED",
      "Failed to persist the evidence snapshot.",
    );
  }

  if (written) {
    return {
      outcome: "CAPTURED",
      snapshot: verifyPersistedSnapshot(
        written.state_before,
        "EVIDENCE_STATE_BEFORE_NOT_VERIFIED",
      ),
    };
  }

  const { data: existing, error: readError } = await client
    .from("event_processing_attempts")
    .select("id, status, state_before")
    .eq("id", processingAttemptId)
    .maybeSingle();

  if (readError) {
    throw new EvidenceRepositoryError(
      "EVIDENCE_STATE_BEFORE_READBACK_FAILED",
      "Failed to read back the existing evidence snapshot.",
    );
  }

  if (!existing) {
    return { outcome: "ATTEMPT_NOT_FOUND", snapshot: null };
  }

  if (existing.state_before !== null) {
    return {
      outcome: "ALREADY_CAPTURED",
      snapshot: verifyPersistedSnapshot(
        existing.state_before,
        "EVIDENCE_STATE_BEFORE_NOT_VERIFIED",
      ),
    };
  }

  if (existing.status !== "PENDING") {
    // Still NULL, and this invocation is too late to describe the state
    // before processing. Leave it NULL — that is the correct history.
    return { outcome: "NOT_ELIGIBLE", snapshot: null };
  }

  // Still PENDING and still NULL, yet the guarded UPDATE matched nothing.
  // Neither guard should have rejected this row, so the durable state does
  // not agree with what was just observed. Surface it rather than inventing
  // a CAPTURED result.
  throw new EvidenceRepositoryError(
    "EVIDENCE_STATE_BEFORE_UPDATE_INCONSISTENT",
    "The evidence snapshot write matched no row despite the attempt being eligible.",
  );
}

/**
 * Persists `state_after` for one processing attempt, SET-ONCE. Same set-once
 * mechanics as `persistProcessingStateBefore` — see that function's doc
 * comment, including why the two are written out separately instead of being
 * parameterized over a column name.
 *
 * IMPORTANT — why this one carries NO `status` predicate, and where its
 * lifecycle guard actually lives:
 *
 * By the time an "after" snapshot is taken, the frozen merchant-processing
 * transaction has already advanced the row to `SUCCEEDED` (or the caller has
 * marked it `FAILED`). A `status = 'PENDING'` predicate here would therefore
 * reject every legitimate write. The lifecycle condition for `state_after` is
 * consequently NOT a column predicate but a property of the invocation:
 * "this invocation began from a genuinely eligible PENDING attempt and just
 * performed that attempt's processing".
 *
 * `lib/events/processor.ts` is the sole production caller and enforces
 * exactly that: it resolves eligibility BEFORE calling the processor, and
 * skips this function entirely for a terminal/non-runnable re-entry, for an
 * `already_processed` result, and for a `PROCESSING_ATTEMPT_NOT_READY`
 * failure. This function must never be called from a path that has not
 * established that condition — doing so would backfill a historical row with
 * present-day state, which is precisely what the Phase 3E-A migration
 * promises never happens.
 */
export async function persistProcessingStateAfter(
  processingAttemptId: string,
  snapshot: MerchantStateSnapshotV1,
): Promise<PersistSnapshotResult> {
  const client = getSupabaseServerClient();
  const value = serializeMerchantStateSnapshot(snapshot);

  const { data: written, error: writeError } = await client
    .from("event_processing_attempts")
    .update({ state_after: value })
    .eq("id", processingAttemptId)
    .is("state_after", null)
    .select("id, state_after")
    .maybeSingle();

  if (writeError) {
    throw new EvidenceRepositoryError(
      "EVIDENCE_STATE_AFTER_WRITE_FAILED",
      "Failed to persist the evidence snapshot.",
    );
  }

  if (written) {
    return {
      outcome: "CAPTURED",
      snapshot: verifyPersistedSnapshot(
        written.state_after,
        "EVIDENCE_STATE_AFTER_NOT_VERIFIED",
      ),
    };
  }

  const { data: existing, error: readError } = await client
    .from("event_processing_attempts")
    .select("id, state_after")
    .eq("id", processingAttemptId)
    .maybeSingle();

  if (readError) {
    throw new EvidenceRepositoryError(
      "EVIDENCE_STATE_AFTER_READBACK_FAILED",
      "Failed to read back the existing evidence snapshot.",
    );
  }

  if (!existing) {
    return { outcome: "ATTEMPT_NOT_FOUND", snapshot: null };
  }

  return {
    outcome: "ALREADY_CAPTURED",
    snapshot: verifyPersistedSnapshot(
      existing.state_after,
      "EVIDENCE_STATE_AFTER_NOT_VERIFIED",
    ),
  };
}
