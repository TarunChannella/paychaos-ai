/**
 * Phase 3F evidence-compatibility correction — the PURE, deterministic C03
 * mutation-snapshot contract.
 *
 * `import "server-only"` for the same structural reason as
 * `lib/evidence/merchant-state-snapshot.ts`: a merchant-state projection is
 * server-side truth assembled from service-role reads and must never be
 * reachable from a client bundle, even though this particular file performs
 * no I/O of its own.
 *
 * ============================================================================
 * WHY THIS MODULE EXISTS
 * ============================================================================
 *
 * docs/MONEY_INVARIANTS.md INV-005 ("Invalid Webhook Signature Causes Zero
 * Mutation") states its rule as three deltas measured across a controlled
 * invalid-signature test:
 *
 *     trusted canonical webhook rows created = 0
 *     payment/business state delta            = 0
 *     fulfilment delta                        = 0
 *
 * and its §6 requires "Before/after snapshots of orders, payment_attempts,
 * payments, fulfilments, webhook_events plus the controlled verification
 * outcome". docs/CHAOS_SCENARIOS.md §15.7 ("Capture merchant/payment state
 * before test") and §15.13 ("state before/after; trusted webhook row count
 * before/after") say the same thing from the scenario side.
 *
 * C03 is deliberately verification-only: it calls the real
 * `verifyWebhookSignature` primitive directly and creates NO `webhook_events`
 * row, NO `event_processing_attempts` row and NO merchant mutation. That is
 * the correct architecture and it is preserved. But it also means C03 has no
 * `event_processing_attempts.state_before`/`state_after` pair — those columns
 * only exist on a processing attempt, and C03 correctly never creates one.
 * Without this module INV-005 therefore had NO before/after input anywhere in
 * the durable record and could only ever have evaluated UNKNOWN.
 *
 * The snapshot is captured at EXECUTION time, inside the same C03 run, and
 * persisted onto the existing `chaos_runs.fault_state` JSONB column. It is
 * never reconstructed later from present-day merchant state: `orders`,
 * `payment_attempts`, `payments` and `fulfilments` are all mutable, so a
 * "before" read taken after the fact would be a false claim about the past
 * (docs/MONEY_INVARIANTS.md §43 "Evidence Snapshot Rule").
 *
 * ============================================================================
 * WHAT THIS MODULE IS, AND IS NOT
 * ============================================================================
 *
 * IS: a pure function from already-read, trusted rows to one versioned,
 * deterministically ordered `C03MutationSnapshotV1`, plus its explicit JSON
 * serializer. No Supabase client, no `fetch`, no Razorpay call, no LLM call,
 * no randomness, no clock read. The same rows always produce a deep-equal
 * object.
 *
 * IS NOT: a Money Invariant evaluator. Nothing here compares `before` against
 * `after`, and nothing here assigns `PASS`, `FAIL`, `UNKNOWN`,
 * `NOT_APPLICABLE` or `ERROR`. Comparing the two snapshots IS INV-005's
 * decision and belongs to Phase 3F alone. Phase 3E records what the facts
 * ARE; Phase 3F decides what they MEAN.
 *
 * ============================================================================
 * SCOPE: THE WHOLE DEMO MERCHANT, BECAUSE THERE IS NO TENANT COLUMN
 * ============================================================================
 *
 * C03 has no correlated order, payment attempt, payment or webhook event — all
 * four of its `chaos_runs` foreign keys are NULL by design, and that is
 * enforced today by the `UNEXPECTED_C03_PROVIDER_LINK` evidence gap. There is
 * therefore no correlation key to scope a snapshot by.
 *
 * There is also NO `merchant_id`/tenant column anywhere in this schema — not
 * on `orders`, `payment_attempts`, `payments`, `fulfilments`,
 * `webhook_events`, `event_processing_attempts` or `chaos_runs` (verified
 * against the applied migrations). The single controlled Demo Merchant IS the
 * database. One is not invented here to manufacture a narrower scope.
 *
 * The snapshot therefore covers the whole Demo Merchant dataset across the
 * five tables INV-005 §6 names. That is also the only scope that can support
 * INV-005's actual claim, which is "zero mutation anywhere", not "zero
 * mutation to some subset".
 *
 * CONCURRENCY, STATED PLAINLY: an unrelated legitimate payment, webhook
 * delivery or chaos run occurring between the two captures WILL change the
 * snapshot, and this evidence cannot distinguish that from a mutation C03
 * caused. Nothing in this design closes that hole. The approved P0 control
 * (ARCH-3F-014) is an operator rule, not a lock: C03 must be run in the
 * controlled Demo Merchant sandbox with no concurrent payment flow in
 * progress. No advisory lock, distributed lock, queue, worker, extra table or
 * extra precheck is introduced for this.
 *
 * ============================================================================
 * STATE MUTATION, NOT JUST ROW-COUNT MUTATION
 * ============================================================================
 *
 * The four business collections carry FULL ROW-STATE PROJECTIONS, not counts.
 * An order can move `UNPAID -> PAID`, an attempt `CREATED -> CAPTURED`, a
 * payment can gain a `captured_at`, and a fulfilment can be repointed at a
 * different payment — every one of those while the row COUNT stays byte-for-
 * byte identical. A count-only snapshot would miss all of them, so INV-005
 * would report "unchanged" for a merchant whose money state had in fact moved.
 *
 * `trustedWebhookEvents` is the deliberate exception and carries internal
 * UUIDs plus an exact count, and nothing else. INV-005's webhook clause is an
 * INSERTION test ("trusted canonical webhook rows created = 0"), and
 * docs/CHAOS_SCENARIOS.md §15.13 asks literally for the "trusted webhook row
 * count before/after". Recording the sorted id SET alongside the count is
 * strictly stronger than the count alone, because it also detects a
 * delete-then-insert that preserves cardinality. No provider payload, no
 * `razorpay_event_id`, no `event_type`, no `raw_payload_redacted`, no
 * `raw_body_sha256` — none of those are needed to prove a row set changed.
 *
 * ============================================================================
 * COMPLETENESS IS AN EXPLICIT FACT, NEVER AN ASSUMPTION
 * ============================================================================
 *
 * Every collection carries `complete`. A bounded read that hit
 * `C03_MUTATION_SNAPSHOT_MAX_ROWS` yields `complete: false`, and a truncated
 * collection is NOT complete evidence: a later evaluator must never compare
 * two prefixes and call the result "unchanged". `complete: false` is a factual
 * incompleteness that Phase 3F is expected to turn into UNKNOWN.
 *
 * A collection that is `null` means the READ FAILED. It is never conflated
 * with `{ count: 0, rows: [], complete: true }`, which is the positive claim
 * "this table was read successfully and genuinely holds zero rows". This is
 * the same distinction `lib/evidence/merchant-state-snapshot.ts` already draws
 * between `fulfilments: null` and `fulfilments: []`, and for the same reason:
 * an infrastructure failure must never be able to masquerade as evidence of
 * absence.
 *
 * Nothing here is ever defaulted to `[]`, `0` or a fabricated object to keep a
 * run looking green.
 *
 * ============================================================================
 * FIELD VOCABULARY
 * ============================================================================
 *
 * The four business row projections reuse the EXACT frozen field vocabulary of
 * `lib/evidence/merchant-state-snapshot.ts` via a TYPE-ONLY import. Type-only
 * means the import is erased at compile time, so this module takes on no
 * runtime dependency on the Phase 3E-A evidence surface — but the field lists
 * can never silently drift apart either, which duplicating twenty-five field
 * names by hand would eventually allow.
 *
 * Consequently this module inherits that module's safety properties exactly.
 * It never contains: a raw Razorpay webhook body, a `raw_payload_redacted`
 * copy, a `normalized_event` blob, a webhook or Checkout signature, any
 * secret, any session token, a card number, a CVV, an OTP, an email, a phone
 * number, a customer name, `fulfilments.idempotency_key`, an LLM explanation,
 * a diagnosis, a recommendation or a confidence score. None of those are
 * inputs to any function here, and none appear in any output type — every
 * projection is a fixed field list, never a spread of a source row.
 */
import "server-only";

import type {
  MerchantStateSnapshotFulfilmentV1,
  MerchantStateSnapshotOrderV1,
  MerchantStateSnapshotPaymentAttemptV1,
  MerchantStateSnapshotPaymentV1,
  MerchantStateSnapshotSourceFulfilmentRow,
  MerchantStateSnapshotSourceOrderRow,
  MerchantStateSnapshotSourcePaymentAttemptRow,
  MerchantStateSnapshotSourcePaymentRow,
} from "@/lib/evidence/merchant-state-snapshot";

/**
 * Snapshot envelope version. Bump ONLY when the persisted shape changes in a
 * way a Phase 3F evaluator must branch on — never for a cosmetic edit.
 * Persisted inside every snapshot so a historical `fault_state` always states
 * which contract produced it, rather than a future reader having to guess.
 */
export const C03_MUTATION_SNAPSHOT_VERSION = 1 as const;

/**
 * Hard per-collection row cap.
 *
 * The controlled Demo Merchant is a single-operator demo dataset, so in
 * practice every collection is far below this. The cap exists so that an
 * unexpectedly large table can never silently produce an enormous
 * `fault_state` blob — and, more importantly, so that hitting it is REPORTED
 * (`complete: false`) rather than silently truncating the evidence into a
 * prefix that a later comparison would misread as "unchanged".
 */
export const C03_MUTATION_SNAPSHOT_MAX_ROWS = 200;

/**
 * One bounded, explicitly complete-or-not collection of projected rows.
 *
 * `count` is the EXACT total number of matching rows in the table, taken from
 * the database's own count rather than from `rows.length` — so a truncated
 * collection still reports the true cardinality it was truncated from.
 * `complete` is `true` only when `rows` holds every one of those rows.
 */
export interface C03SnapshotCollection<TRow> {
  readonly count: number;
  readonly rows: readonly TRow[];
  readonly complete: boolean;
}

/**
 * The trusted canonical `webhook_events` row set, as internal UUIDs plus an
 * exact count. See the module doc comment for why this collection is
 * identifiers-only while the four business collections are full row-state
 * projections.
 */
export interface C03WebhookEventIdCollection {
  readonly count: number;
  readonly ids: readonly string[];
  readonly complete: boolean;
}

/**
 * One deterministic snapshot of the whole controlled Demo Merchant state, as
 * observed at one instant during a C03 run.
 *
 * Every collection is independently nullable, and that is a feature rather
 * than a defect to be smoothed over: `null` means "this table could not be
 * read", which is a different and weaker fact than "this table is empty".
 */
export interface C03MutationSnapshotV1 {
  readonly version: typeof C03_MUTATION_SNAPSHOT_VERSION;
  readonly orders: C03SnapshotCollection<MerchantStateSnapshotOrderV1> | null;
  readonly paymentAttempts: C03SnapshotCollection<MerchantStateSnapshotPaymentAttemptV1> | null;
  readonly payments: C03SnapshotCollection<MerchantStateSnapshotPaymentV1> | null;
  readonly fulfilments: C03SnapshotCollection<MerchantStateSnapshotFulfilmentV1> | null;
  readonly trustedWebhookEvents: C03WebhookEventIdCollection | null;
}

/**
 * The `mutationEvidence` envelope persisted under `chaos_runs.fault_state`.
 *
 * `before` and `after` are independently nullable: a capture failure must
 * leave the corresponding side NULL and must never fail the C03 run or
 * fabricate a substitute snapshot.
 */
export interface C03MutationEvidenceV1 {
  readonly version: typeof C03_MUTATION_SNAPSHOT_VERSION;
  readonly before: C03MutationSnapshotV1 | null;
  readonly after: C03MutationSnapshotV1 | null;
}

// ============================================================================
// SOURCE ROWS (the repository's explicit allowlist SELECT results)
// ============================================================================

/** One bounded read result, before projection. `count` is the database's own exact count. */
export interface C03MutationSnapshotSourceCollection<TRow> {
  readonly count: number;
  readonly rows: readonly TRow[];
  readonly complete: boolean;
}

export interface C03MutationSnapshotSource {
  readonly orders: C03MutationSnapshotSourceCollection<MerchantStateSnapshotSourceOrderRow> | null;
  readonly paymentAttempts: C03MutationSnapshotSourceCollection<MerchantStateSnapshotSourcePaymentAttemptRow> | null;
  readonly payments: C03MutationSnapshotSourceCollection<MerchantStateSnapshotSourcePaymentRow> | null;
  readonly fulfilments: C03MutationSnapshotSourceCollection<MerchantStateSnapshotSourceFulfilmentRow> | null;
  readonly trustedWebhookEvents: C03WebhookEventIdCollection | null;
}

// ============================================================================
// DETERMINISTIC ORDERING
// ============================================================================

/**
 * Total, deterministic ordering by internal UUID primary key.
 *
 * `id` is a UUID primary key, so this is a strict total order over any set of
 * real rows: the same set always serializes in the same sequence regardless of
 * the order Postgres happened to return it in. Sorting by a timestamp instead
 * would NOT be total — two rows can share `created_at`/`applied_at` — and
 * timestamp-as-identity is explicitly forbidden here.
 */
function compareById(a: { readonly id: string }, b: { readonly id: string }) {
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Projects and deterministically sorts one bounded collection.
 *
 * `project` copies field by explicit name — there is no object spread of a
 * source row anywhere in this module, so a column added to any of these tables
 * by a future migration can never leak into persisted evidence without this
 * file being edited on purpose.
 */
function projectCollection<
  TSource extends { readonly id: string },
  TRow extends { readonly id: string },
>(
  source: C03MutationSnapshotSourceCollection<TSource> | null,
  project: (row: TSource) => TRow,
): C03SnapshotCollection<TRow> | null {
  if (!source) return null;
  return {
    count: source.count,
    rows: source.rows.map(project).sort(compareById),
    complete: source.complete,
  };
}

// ============================================================================
// THE BUILDER
// ============================================================================

/**
 * Builds one deterministic `C03MutationSnapshotV1` from already-read source
 * rows.
 *
 * Pure: no I/O, no clock, no randomness, no mutation of the input. A `null`
 * source collection stays `null` in the output. Nothing is defaulted, guessed
 * or back-filled, and no comparison between snapshots is performed here.
 */
export function buildC03MutationSnapshot(
  source: C03MutationSnapshotSource,
): C03MutationSnapshotV1 {
  return {
    version: C03_MUTATION_SNAPSHOT_VERSION,
    orders: projectCollection(source.orders, (row) => ({
      id: row.id,
      paymentStatus: row.payment_status,
      businessStatus: row.business_status,
      amountSubunits: row.amount_subunits,
      currency: row.currency,
    })),
    paymentAttempts: projectCollection(source.paymentAttempts, (row) => ({
      id: row.id,
      orderId: row.order_id,
      status: row.status,
      amountSubunits: row.amount_subunits,
      currency: row.currency,
      razorpayOrderId: row.razorpay_order_id,
      razorpayOrderStatus: row.razorpay_order_status,
    })),
    payments: projectCollection(source.payments, (row) => ({
      id: row.id,
      paymentAttemptId: row.payment_attempt_id,
      razorpayPaymentId: row.razorpay_payment_id,
      razorpayPaymentStatus: row.razorpay_payment_status,
      amountSubunits: row.amount_subunits,
      currency: row.currency,
      checkoutSignatureVerified: row.checkout_signature_verified,
      capturedAt: row.captured_at,
      failedAt: row.failed_at,
    })),
    fulfilments: projectCollection(source.fulfilments, (row) => ({
      id: row.id,
      orderId: row.order_id,
      paymentId: row.payment_id,
      triggerProcessingAttemptId: row.trigger_processing_attempt_id,
      effectType: row.effect_type,
      appliedAt: row.applied_at,
    })),
    trustedWebhookEvents: source.trustedWebhookEvents
      ? {
          count: source.trustedWebhookEvents.count,
          ids: [...source.trustedWebhookEvents.ids].sort(compareStrings),
          complete: source.trustedWebhookEvents.complete,
        }
      : null,
  };
}

// ============================================================================
// SERIALIZATION
// ============================================================================

/**
 * Converts one snapshot into the plain JSON object shape the `jsonb` column
 * accepts.
 *
 * Deliberately NOT `JSON.parse(JSON.stringify(...))`: that would silently drop
 * an `undefined` rather than failing loudly, and would let a future non-JSON
 * value (a `Date`, a `Map`) pass through transformed instead of rejected. This
 * builds the object explicitly, field by field, so the persisted evidence is
 * exactly the declared contract and nothing else — the same rule
 * `serializeMerchantStateSnapshot` already follows.
 */
export function serializeC03MutationSnapshot(
  snapshot: C03MutationSnapshotV1,
): Record<string, unknown> {
  return {
    version: snapshot.version,
    orders: snapshot.orders
      ? {
          count: snapshot.orders.count,
          complete: snapshot.orders.complete,
          rows: snapshot.orders.rows.map((row) => ({
            id: row.id,
            paymentStatus: row.paymentStatus,
            businessStatus: row.businessStatus,
            amountSubunits: row.amountSubunits,
            currency: row.currency,
          })),
        }
      : null,
    paymentAttempts: snapshot.paymentAttempts
      ? {
          count: snapshot.paymentAttempts.count,
          complete: snapshot.paymentAttempts.complete,
          rows: snapshot.paymentAttempts.rows.map((row) => ({
            id: row.id,
            orderId: row.orderId,
            status: row.status,
            amountSubunits: row.amountSubunits,
            currency: row.currency,
            razorpayOrderId: row.razorpayOrderId,
            razorpayOrderStatus: row.razorpayOrderStatus,
          })),
        }
      : null,
    payments: snapshot.payments
      ? {
          count: snapshot.payments.count,
          complete: snapshot.payments.complete,
          rows: snapshot.payments.rows.map((row) => ({
            id: row.id,
            paymentAttemptId: row.paymentAttemptId,
            razorpayPaymentId: row.razorpayPaymentId,
            razorpayPaymentStatus: row.razorpayPaymentStatus,
            amountSubunits: row.amountSubunits,
            currency: row.currency,
            checkoutSignatureVerified: row.checkoutSignatureVerified,
            capturedAt: row.capturedAt,
            failedAt: row.failedAt,
          })),
        }
      : null,
    fulfilments: snapshot.fulfilments
      ? {
          count: snapshot.fulfilments.count,
          complete: snapshot.fulfilments.complete,
          rows: snapshot.fulfilments.rows.map((row) => ({
            id: row.id,
            orderId: row.orderId,
            paymentId: row.paymentId,
            triggerProcessingAttemptId: row.triggerProcessingAttemptId,
            effectType: row.effectType,
            appliedAt: row.appliedAt,
          })),
        }
      : null,
    trustedWebhookEvents: snapshot.trustedWebhookEvents
      ? {
          count: snapshot.trustedWebhookEvents.count,
          complete: snapshot.trustedWebhookEvents.complete,
          ids: [...snapshot.trustedWebhookEvents.ids],
        }
      : null,
  };
}

/**
 * Converts the `mutationEvidence` envelope into its persisted JSON shape.
 *
 * A `null` side stays `null` — never replaced with an empty snapshot, which
 * would falsely claim the merchant state was successfully observed and found
 * empty.
 */
export function serializeC03MutationEvidence(
  evidence: C03MutationEvidenceV1,
): Record<string, unknown> {
  return {
    version: evidence.version,
    before: evidence.before
      ? serializeC03MutationSnapshot(evidence.before)
      : null,
    after: evidence.after ? serializeC03MutationSnapshot(evidence.after) : null,
  };
}
