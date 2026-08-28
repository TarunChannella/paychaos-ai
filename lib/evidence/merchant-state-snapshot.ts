/**
 * Phase 3E-A — deterministic merchant-state snapshot contract.
 *
 * `import "server-only"` for the same structural reason as every other
 * evidence/domain module on this path: a merchant-state snapshot is
 * server-side truth assembled from service-role database reads and must
 * never be reachable from a client bundle, even though this particular file
 * performs no I/O of its own.
 *
 * This module is PURE. It contains no Supabase client, no `fetch`, no
 * Razorpay call, no LLM call, no randomness, and no clock read. Given the
 * same input rows it always produces the same object — that determinism is
 * the whole point: docs/MONEY_INVARIANTS.md Principle 1 requires that the
 * same evidence snapshot plus the same invariant version always yields the
 * same result, and Phase 3F cannot honour that if the snapshot itself
 * wobbles.
 *
 * ============================================================================
 * What a snapshot is, and is not
 * ============================================================================
 *
 * IS: an explicit allowlist projection of persisted server-side columns —
 * internal record ids, internal/provider states, integer
 * `amount_subunits`, `currency`, a checkout-verification boolean, and
 * persisted historical timestamps that already live on the entities.
 *
 * IS NOT: a raw Razorpay webhook body, a `raw_payload_redacted` copy, a
 * webhook/Checkout signature, any secret, any session token, a card number,
 * a CVV, an OTP, an email, a phone number, a customer name, an LLM
 * explanation, a diagnosis, a recommendation, or a confidence score. None of
 * those are inputs to any function here, and none appear in any output type
 * — the projection is a fixed field list, never a spread of a source row and
 * never a `select *`.
 *
 * It also carries no PASS/FAIL/UNKNOWN judgment. Phase 3E only records
 * facts; deciding what those facts mean is Phase 3F's job.
 */
import "server-only";

/**
 * Snapshot envelope version. Bump ONLY when the persisted shape changes in
 * a way a Phase 3F evaluator must branch on — never for a cosmetic edit.
 * Persisted inside every snapshot so a historical row always states which
 * contract produced it, rather than a future reader having to guess.
 */
export const MERCHANT_STATE_SNAPSHOT_VERSION = 1 as const;

/** Projection of `orders` — never the whole row. */
export interface MerchantStateSnapshotOrderV1 {
  readonly id: string;
  readonly paymentStatus: string;
  readonly businessStatus: string;
  readonly amountSubunits: number;
  readonly currency: string;
}

/** Projection of `payment_attempts` — never the whole row. */
export interface MerchantStateSnapshotPaymentAttemptV1 {
  readonly id: string;
  readonly orderId: string;
  readonly status: string;
  readonly amountSubunits: number;
  readonly currency: string;
  readonly razorpayOrderId: string | null;
  readonly razorpayOrderStatus: string | null;
}

/**
 * Projection of `payments` — never the whole row. Deliberately excludes
 * `checkout_verified_at`'s sibling error/description columns and every
 * provider free-text field: an invariant needs the money terms, the
 * captured/failed facts and the verification boolean, not prose.
 */
export interface MerchantStateSnapshotPaymentV1 {
  readonly id: string;
  readonly paymentAttemptId: string;
  readonly razorpayPaymentId: string;
  readonly razorpayPaymentStatus: string | null;
  readonly amountSubunits: number;
  readonly currency: string;
  readonly checkoutSignatureVerified: boolean;
  readonly capturedAt: string | null;
  readonly failedAt: string | null;
}

/**
 * Projection of one `fulfilments` row — never the whole row. Deliberately
 * excludes `idempotency_key`: it is a uniqueness token whose protection
 * belongs in the database's own UNIQUE constraint, and copying it into
 * evidence JSON adds nothing an invariant can act on that `orderId` +
 * `paymentId` + `effectType` do not already carry.
 */
export interface MerchantStateSnapshotFulfilmentV1 {
  readonly id: string;
  readonly orderId: string;
  readonly paymentId: string;
  readonly triggerProcessingAttemptId: string | null;
  readonly effectType: string;
  readonly appliedAt: string;
}

/**
 * The persisted `event_processing_attempts.state_before` /
 * `state_after` shape.
 *
 * Every entity is independently nullable, and that is a feature rather than
 * a defect to be smoothed over (this task's Section 10):
 *
 *   - BEFORE a `payment.captured` attempt the canonical `payments` row may
 *     legitimately not exist yet;
 *   - a processing attempt with no correlated payment attempt legitimately
 *     resolves no order;
 *   - an unsupported/malformed event legitimately resolves nothing at all.
 *
 * `fulfilments` is `null` (NOT `[]`) whenever the owning order could not be
 * resolved, because `[]` is a positive claim that the order had zero
 * fulfilments — which is exactly the kind of invented fact
 * docs/MONEY_INVARIANTS.md forbids. `[]` therefore means, and only means,
 * "the order WAS resolved and genuinely had no fulfilment rows".
 */
export interface MerchantStateSnapshotV1 {
  readonly version: typeof MERCHANT_STATE_SNAPSHOT_VERSION;
  readonly order: MerchantStateSnapshotOrderV1 | null;
  readonly paymentAttempt: MerchantStateSnapshotPaymentAttemptV1 | null;
  readonly payment: MerchantStateSnapshotPaymentV1 | null;
  readonly fulfilments: readonly MerchantStateSnapshotFulfilmentV1[] | null;
}

/**
 * The exact source columns `buildMerchantStateSnapshot` accepts. These are
 * the raw database column names, deliberately typed as narrow structural
 * shapes rather than `Database[...]["Row"]`, so this pure module stays
 * independent of the generated Supabase types and so a caller cannot smuggle
 * an unrelated object through by widening.
 */
export interface MerchantStateSnapshotSourceOrderRow {
  readonly id: string;
  readonly payment_status: string;
  readonly business_status: string;
  readonly amount_subunits: number;
  readonly currency: string;
}

export interface MerchantStateSnapshotSourcePaymentAttemptRow {
  readonly id: string;
  readonly order_id: string;
  readonly status: string;
  readonly amount_subunits: number;
  readonly currency: string;
  readonly razorpay_order_id: string | null;
  readonly razorpay_order_status: string | null;
}

export interface MerchantStateSnapshotSourcePaymentRow {
  readonly id: string;
  readonly payment_attempt_id: string;
  readonly razorpay_payment_id: string;
  readonly razorpay_payment_status: string | null;
  readonly amount_subunits: number;
  readonly currency: string;
  readonly checkout_signature_verified: boolean;
  readonly captured_at: string | null;
  readonly failed_at: string | null;
}

export interface MerchantStateSnapshotSourceFulfilmentRow {
  readonly id: string;
  readonly order_id: string;
  readonly payment_id: string;
  readonly trigger_processing_attempt_id: string | null;
  readonly effect_type: string;
  readonly applied_at: string;
}

export interface MerchantStateSnapshotSource {
  readonly order: MerchantStateSnapshotSourceOrderRow | null;
  readonly paymentAttempt: MerchantStateSnapshotSourcePaymentAttemptRow | null;
  readonly payment: MerchantStateSnapshotSourcePaymentRow | null;
  /** `null` means "the owning order was not resolved, so fulfilments were not read". */
  readonly fulfilments:
    readonly MerchantStateSnapshotSourceFulfilmentRow[] | null;
}

/**
 * Total, deterministic ordering for the fulfilment array. `id` is a UUID
 * primary key, so this comparison is a strict total order over any set of
 * real rows: the same set always serializes in the same sequence regardless
 * of the order Postgres happened to return it in. Sorting by `applied_at`
 * instead would NOT be total — two fulfilments can share a timestamp.
 */
function compareFulfilmentsById(
  a: MerchantStateSnapshotFulfilmentV1,
  b: MerchantStateSnapshotFulfilmentV1,
): number {
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

/**
 * Builds one deterministic `MerchantStateSnapshotV1` from already-read
 * source rows.
 *
 * Pure: no I/O, no clock, no randomness, no mutation of the input. Every
 * field is copied by explicit name — there is no object spread of a source
 * row anywhere in this function, so a column added to `orders`/`payments`/
 * `payment_attempts`/`fulfilments` by some future migration can never leak
 * into persisted evidence without this file being edited on purpose.
 *
 * A `null` source entity stays `null` in the output. Nothing is defaulted,
 * guessed, or back-filled.
 */
export function buildMerchantStateSnapshot(
  source: MerchantStateSnapshotSource,
): MerchantStateSnapshotV1 {
  const order: MerchantStateSnapshotOrderV1 | null = source.order
    ? {
        id: source.order.id,
        paymentStatus: source.order.payment_status,
        businessStatus: source.order.business_status,
        amountSubunits: source.order.amount_subunits,
        currency: source.order.currency,
      }
    : null;

  const paymentAttempt: MerchantStateSnapshotPaymentAttemptV1 | null =
    source.paymentAttempt
      ? {
          id: source.paymentAttempt.id,
          orderId: source.paymentAttempt.order_id,
          status: source.paymentAttempt.status,
          amountSubunits: source.paymentAttempt.amount_subunits,
          currency: source.paymentAttempt.currency,
          razorpayOrderId: source.paymentAttempt.razorpay_order_id,
          razorpayOrderStatus: source.paymentAttempt.razorpay_order_status,
        }
      : null;

  const payment: MerchantStateSnapshotPaymentV1 | null = source.payment
    ? {
        id: source.payment.id,
        paymentAttemptId: source.payment.payment_attempt_id,
        razorpayPaymentId: source.payment.razorpay_payment_id,
        razorpayPaymentStatus: source.payment.razorpay_payment_status,
        amountSubunits: source.payment.amount_subunits,
        currency: source.payment.currency,
        checkoutSignatureVerified: source.payment.checkout_signature_verified,
        capturedAt: source.payment.captured_at,
        failedAt: source.payment.failed_at,
      }
    : null;

  const fulfilments: readonly MerchantStateSnapshotFulfilmentV1[] | null =
    source.fulfilments
      ? source.fulfilments
          .map((row) => ({
            id: row.id,
            orderId: row.order_id,
            paymentId: row.payment_id,
            triggerProcessingAttemptId: row.trigger_processing_attempt_id,
            effectType: row.effect_type,
            appliedAt: row.applied_at,
          }))
          .sort(compareFulfilmentsById)
      : null;

  return {
    version: MERCHANT_STATE_SNAPSHOT_VERSION,
    order,
    paymentAttempt,
    payment,
    fulfilments,
  };
}

/**
 * Converts a snapshot into the plain JSON object shape the `jsonb` column
 * accepts.
 *
 * Deliberately NOT `JSON.parse(JSON.stringify(...))`: that would silently
 * drop an `undefined` rather than failing loudly, and would let a future
 * non-JSON value (a `Date`, a `Map`) pass through transformed instead of
 * rejected. This builds the object explicitly, field by field, so the
 * persisted evidence is exactly the declared contract and nothing else.
 *
 * The result satisfies the database's
 * `event_processing_attempts_state_before_is_object` /
 * `..._state_after_is_object` CHECK constraints by construction: it is
 * always a JSON object, never a scalar and never an array.
 */
export function serializeMerchantStateSnapshot(
  snapshot: MerchantStateSnapshotV1,
): Record<string, unknown> {
  return {
    version: snapshot.version,
    order: snapshot.order
      ? {
          id: snapshot.order.id,
          paymentStatus: snapshot.order.paymentStatus,
          businessStatus: snapshot.order.businessStatus,
          amountSubunits: snapshot.order.amountSubunits,
          currency: snapshot.order.currency,
        }
      : null,
    paymentAttempt: snapshot.paymentAttempt
      ? {
          id: snapshot.paymentAttempt.id,
          orderId: snapshot.paymentAttempt.orderId,
          status: snapshot.paymentAttempt.status,
          amountSubunits: snapshot.paymentAttempt.amountSubunits,
          currency: snapshot.paymentAttempt.currency,
          razorpayOrderId: snapshot.paymentAttempt.razorpayOrderId,
          razorpayOrderStatus: snapshot.paymentAttempt.razorpayOrderStatus,
        }
      : null,
    payment: snapshot.payment
      ? {
          id: snapshot.payment.id,
          paymentAttemptId: snapshot.payment.paymentAttemptId,
          razorpayPaymentId: snapshot.payment.razorpayPaymentId,
          razorpayPaymentStatus: snapshot.payment.razorpayPaymentStatus,
          amountSubunits: snapshot.payment.amountSubunits,
          currency: snapshot.payment.currency,
          checkoutSignatureVerified: snapshot.payment.checkoutSignatureVerified,
          capturedAt: snapshot.payment.capturedAt,
          failedAt: snapshot.payment.failedAt,
        }
      : null,
    fulfilments: snapshot.fulfilments
      ? snapshot.fulfilments.map((fulfilment) => ({
          id: fulfilment.id,
          orderId: fulfilment.orderId,
          paymentId: fulfilment.paymentId,
          triggerProcessingAttemptId: fulfilment.triggerProcessingAttemptId,
          effectType: fulfilment.effectType,
          appliedAt: fulfilment.appliedAt,
        }))
      : null,
  };
}
