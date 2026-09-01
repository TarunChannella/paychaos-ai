import type {
  ChaosRunEvidenceBundleV1,
  C03MutationSnapshotEvidence,
  ParsedProcessingSnapshot,
  ProcessingAttemptEvidence,
  SafeWebhookEvidence,
} from "@/lib/evidence/chaos-run-evidence";
import type {
  MerchantStateSnapshotFulfilmentV1,
  MerchantStateSnapshotOrderV1,
  MerchantStateSnapshotPaymentAttemptV1,
  MerchantStateSnapshotPaymentV1,
  MerchantStateSnapshotV1,
} from "@/lib/evidence/merchant-state-snapshot";

import type {
  InvariantCorrelations,
  InvariantEvidenceRef,
  InvariantSeverity,
  MoneyInvariantId,
  NonPersistableInvariantEvaluation,
  PersistableInvariantEvaluation,
  PersistedInvariantResult,
} from "./types";

/**
 * Phase 3F-B — pure helpers shared by the twelve deterministic Money
 * Invariant evaluators.
 *
 * ABSOLUTELY PURE. No Supabase, no `.from(`, no Razorpay, no `fetch`, no
 * filesystem, no `process.env`, no `Date.now()`, no `new Date()`, no
 * `Math.random()`, no `randomUUID`, no LLM. Nothing here reads a clock or a
 * mutable data source, so `same evidence -> same output` holds by
 * construction rather than by convention.
 *
 * NO PERSISTENCE. This module never names `invariant_results` and performs
 * no INSERT/UPDATE/UPSERT/DELETE. Persistence is Phase 3F-C.
 *
 * WHERE THE FACTS COME FROM. Every input is the already-frozen Phase 3E
 * evidence contract (`ChaosRunEvidenceBundleV1`). This module builds no
 * second evidence model, copies no raw database payload, and never
 * reconstructs historical merchant state from present-day rows — a
 * `NOT_CAPTURED` snapshot stays factual evidence ABSENCE, which the
 * evaluators turn into `UNKNOWN`, never into `PASS`.
 *
 * THE "PROVEN OVER CAPTURED SNAPSHOTS" READING RULE. A chaos run may carry
 * several processing attempts, each with its own before/after merchant
 * snapshot. This module deliberately does NOT pick a single "final" snapshot
 * by timestamp — "latest wins" is exactly what docs/MONEY_INVARIANTS.md
 * forbids as financial truth. Instead:
 *
 *   - a violation is FAIL when ANY captured snapshot proves it (a snapshot
 *     showing two fulfilments for one payment proves the violation whichever
 *     snapshot is "last");
 *   - PASS requires the evidence an invariant needs to be present AND no
 *     captured snapshot to show a violation;
 *   - absent/invalid required evidence is UNKNOWN.
 *
 * That reading is order-independent, clock-free and monotone, so shuffling
 * the attempt array cannot change any result.
 */

// ============================================================================
// FROZEN VOCABULARY (mirrors the database CHECK constraints exactly)
// ============================================================================

/** The only protected P0 business effect (docs/MONEY_INVARIANTS.md §16 §8). */
export const FULFIL_ORDER_EFFECT = "FULFIL_ORDER";

export const ORDER_PAYMENT_STATUS_UNPAID = "UNPAID";
export const ORDER_PAYMENT_STATUS_PENDING = "PENDING";
export const ORDER_PAYMENT_STATUS_FAILED_OBSERVED = "FAILED_OBSERVED";
export const ORDER_PAYMENT_STATUS_PAID = "PAID";

export const ORDER_BUSINESS_STATUS_OPEN = "OPEN";
export const ORDER_BUSINESS_STATUS_FULFILLED = "FULFILLED";

export const PAYMENT_ATTEMPT_STATUS_CAPTURED = "CAPTURED";
export const PAYMENT_ATTEMPT_STATUS_FAILED_OBSERVED = "FAILED_OBSERVED";

export const PROCESSING_ATTEMPT_STATUS_FAILED = "FAILED";
export const PROCESSING_ATTEMPT_STATUS_SUCCEEDED = "SUCCEEDED";

export const REAL_RAZORPAY_WEBHOOK = "REAL_RAZORPAY_WEBHOOK";

export const EVENT_TYPE_PAYMENT_CAPTURED = "payment.captured";
export const EVENT_TYPE_PAYMENT_FAILED = "payment.failed";
export const EVENT_TYPE_ORDER_PAID = "order.paid";

/**
 * The supported P0 business-processing event types
 * (docs/MONEY_INVARIANTS.md §27 §7). Anything else is "unsupported" for
 * INV-012's precondition.
 */
export const SUPPORTED_BUSINESS_EVENT_TYPES: readonly string[] = Object.freeze([
  EVENT_TYPE_ORDER_PAID,
  EVENT_TYPE_PAYMENT_CAPTURED,
  EVENT_TYPE_PAYMENT_FAILED,
] as const);

export function isSupportedBusinessEventType(eventType: string): boolean {
  return SUPPORTED_BUSINESS_EVENT_TYPES.includes(eventType);
}

// ============================================================================
// STATE LEGALITY (docs/MONEY_INVARIANTS.md §26 §8 Rules A/B/D/E)
// ============================================================================

/**
 * A transition verdict.
 *
 * `UNRECOGNISED` is deliberately distinct from `ILLEGAL`: a status value this
 * matrix does not know is missing evidence about legality, not proof of a
 * violation. Collapsing the two would let an unfamiliar string manufacture a
 * false FAIL.
 *
 * `NO_TRANSITION` (architect blocker 3F-B-05) is equally distinct from
 * `LEGAL`. The legal set in docs/MONEY_INVARIANTS.md §26 §8 Rule A contains
 * EIGHT members under INV-011/v2 and `PAID -> PAID` is the only
 * self-transition among them. `UNPAID -> UNPAID`, `PENDING -> PENDING` and
 * `FAILED_OBSERVED -> FAILED_OBSERVED` are NOT members, and silently adding
 * them would widen the contract to model no-op processing. Idempotent
 * re-processing that leaves a status where it was is simply NOT A TRANSITION:
 * there is nothing for Rule A to judge. Callers must treat `NO_TRANSITION` as
 * "no observation", never as a legality claim.
 */
export type TransitionVerdict =
  | "LEGAL"
  | "ILLEGAL"
  | "UNRECOGNISED"
  | "NO_TRANSITION"
  /**
   * `OPEN -> FULFILLED` (architect blocker FINAL-06). docs/MONEY_INVARIANTS.md
   * §12 lists it among the INVALID transitions "unless the order has
   * authoritative successful payment evidence and a valid fulfilment row is
   * being committed". Its legality therefore cannot be decided from the two
   * status strings alone, and this helper refuses to guess: the caller must
   * check those two conditions against the frozen evidence.
   */
  | "REQUIRES_FULFILMENT_AUTHORITY";

/**
 * The legal set, transcribed EXACTLY from docs/MONEY_INVARIANTS.md §26 §8
 * Rule A under INV-011/v2 — eight members, no additions:
 *
 *   UNPAID -> PENDING            UNPAID -> PAID
 *   UNPAID -> FAILED_OBSERVED    [ADDED IN v2]
 *   PENDING -> FAILED_OBSERVED   PENDING -> PAID
 *   FAILED_OBSERVED -> PENDING   FAILED_OBSERVED -> PAID
 *   PAID -> PAID
 *
 * WHY v2 ADDED `UNPAID -> FAILED_OBSERVED`. Genuine Razorpay Test Mode
 * evidence (the Phase 4E-R3-B C11-A regression) produced exactly this
 * transition: the frozen Phase 2F processing path sets
 * `orders.payment_status = FAILED_OBSERVED` on a verified `payment.failed`,
 * and nothing in the real flow ever moves the ORDER to `PENDING` merely
 * because Checkout opened. The v1 seven-member set therefore modelled a
 * `PENDING` waypoint the implementation deliberately does not create, and
 * failed a run in which no money-safety guarantee was broken.
 *
 * WHAT THIS DOES NOT CHANGE. `PAID` monotonicity (Rule B) is untouched — the
 * only legal successor of `PAID` is still `PAID`. Nothing here permits a
 * fulfilment on failure, and nothing here makes a browser/client-reported
 * failure authoritative: only verified provider processing writes
 * `FAILED_OBSERVED` in the first place.
 */
const LEGAL_ORDER_PAYMENT_STATUS_TRANSITIONS: ReadonlyMap<
  string,
  ReadonlySet<string>
> = new Map([
  [
    ORDER_PAYMENT_STATUS_UNPAID,
    new Set([
      ORDER_PAYMENT_STATUS_PENDING,
      ORDER_PAYMENT_STATUS_FAILED_OBSERVED,
      ORDER_PAYMENT_STATUS_PAID,
    ]),
  ],
  [
    ORDER_PAYMENT_STATUS_PENDING,
    new Set([ORDER_PAYMENT_STATUS_FAILED_OBSERVED, ORDER_PAYMENT_STATUS_PAID]),
  ],
  [
    ORDER_PAYMENT_STATUS_FAILED_OBSERVED,
    new Set([ORDER_PAYMENT_STATUS_PENDING, ORDER_PAYMENT_STATUS_PAID]),
  ],
  // Rule B — PAID is monotonic. The ONLY legal successor of PAID is PAID, and
  // this is the one self-transition the frozen set actually contains.
  [ORDER_PAYMENT_STATUS_PAID, new Set([ORDER_PAYMENT_STATUS_PAID])],
]);

const KNOWN_ORDER_PAYMENT_STATUSES: ReadonlySet<string> = new Set([
  ORDER_PAYMENT_STATUS_UNPAID,
  ORDER_PAYMENT_STATUS_PENDING,
  ORDER_PAYMENT_STATUS_FAILED_OBSERVED,
  ORDER_PAYMENT_STATUS_PAID,
]);

/**
 * Rule A + Rule B, implemented against the eight-member v2 set exactly.
 *
 * `PAID -> PAID` is `LEGAL` because the source-of-truth lists it. Every OTHER
 * self-transition returns `NO_TRANSITION` — the status did not move, so no
 * transition was observed for Rule A to judge. It is deliberately NOT reported
 * as `LEGAL`, which would amount to adding three members to a frozen set.
 */
export function evaluateOrderPaymentStatusTransition(
  from: string,
  to: string,
): TransitionVerdict {
  if (
    !KNOWN_ORDER_PAYMENT_STATUSES.has(from) ||
    !KNOWN_ORDER_PAYMENT_STATUSES.has(to)
  ) {
    return "UNRECOGNISED";
  }
  if (LEGAL_ORDER_PAYMENT_STATUS_TRANSITIONS.get(from)!.has(to)) {
    return "LEGAL";
  }
  if (from === to) return "NO_TRANSITION";
  return "ILLEGAL";
}

const KNOWN_ORDER_BUSINESS_STATUSES: ReadonlySet<string> = new Set([
  ORDER_BUSINESS_STATUS_OPEN,
  ORDER_BUSINESS_STATUS_FULFILLED,
]);

/**
 * `FULFILLED -> OPEN` is the always-illegal business-status regression. A
 * self-transition is no transition. `OPEN -> FULFILLED` is CONDITIONAL
 * (docs/MONEY_INVARIANTS.md §12) and returns
 * `REQUIRES_FULFILMENT_AUTHORITY` — never a bare `LEGAL`.
 */
export function evaluateOrderBusinessStatusTransition(
  from: string,
  to: string,
): TransitionVerdict {
  if (
    !KNOWN_ORDER_BUSINESS_STATUSES.has(from) ||
    !KNOWN_ORDER_BUSINESS_STATUSES.has(to)
  ) {
    return "UNRECOGNISED";
  }
  if (from === to) return "NO_TRANSITION";
  if (
    from === ORDER_BUSINESS_STATUS_FULFILLED &&
    to === ORDER_BUSINESS_STATUS_OPEN
  ) {
    return "ILLEGAL";
  }
  if (
    from === ORDER_BUSINESS_STATUS_OPEN &&
    to === ORDER_BUSINESS_STATUS_FULFILLED
  ) {
    return "REQUIRES_FULFILMENT_AUTHORITY";
  }
  return "LEGAL";
}

const KNOWN_PAYMENT_ATTEMPT_STATUSES: ReadonlySet<string> = new Set([
  "CREATED",
  "ORDER_CREATED",
  "CHECKOUT_IN_PROGRESS",
  PAYMENT_ATTEMPT_STATUS_FAILED_OBSERVED,
  PAYMENT_ATTEMPT_STATUS_CAPTURED,
]);

/**
 * Rule E — a payment attempt already known `CAPTURED` must not later become
 * `FAILED_OBSERVED` because of a stale event. A self-transition is no
 * transition, `CAPTURED -> CAPTURED` included.
 */
export function evaluatePaymentAttemptStatusTransition(
  from: string,
  to: string,
): TransitionVerdict {
  if (
    !KNOWN_PAYMENT_ATTEMPT_STATUSES.has(from) ||
    !KNOWN_PAYMENT_ATTEMPT_STATUSES.has(to)
  ) {
    return "UNRECOGNISED";
  }
  if (from === to) return "NO_TRANSITION";
  if (from === PAYMENT_ATTEMPT_STATUS_CAPTURED) return "ILLEGAL";
  return "LEGAL";
}

// ============================================================================
// MONEY (docs/MONEY_INVARIANTS.md §3 Principle 7, §23)
// ============================================================================

export interface MoneyTerms {
  readonly amountSubunits: number | null;
  readonly currency: string | null;
}

/**
 * `INDETERMINATE` means a required side could not be established — `null` is
 * preserved as `null` and is NEVER defaulted to `0` or `"INR"`. Integer
 * smallest-subunit equality only: no `parseFloat`, no epsilon, no rounding.
 * Amount AND currency must both match.
 */
export type MoneyComparison = "MATCH" | "MISMATCH" | "INDETERMINATE";

export function compareMoney(a: MoneyTerms, b: MoneyTerms): MoneyComparison {
  if (
    a.amountSubunits === null ||
    b.amountSubunits === null ||
    a.currency === null ||
    b.currency === null
  ) {
    return "INDETERMINATE";
  }
  if (
    !Number.isInteger(a.amountSubunits) ||
    !Number.isInteger(b.amountSubunits)
  ) {
    return "INDETERMINATE";
  }
  return a.amountSubunits === b.amountSubunits && a.currency === b.currency
    ? "MATCH"
    : "MISMATCH";
}

// ============================================================================
// SNAPSHOT ACCESS
// ============================================================================

/** The validated snapshot, or `null` for `NOT_CAPTURED`/`INVALID`. */
export function capturedSnapshot(
  parsed: ParsedProcessingSnapshot,
): MerchantStateSnapshotV1 | null {
  return parsed.kind === "CAPTURED" ? parsed.snapshot : null;
}

/** One attempt's observed before/after pair. Either side may be `null`. */
export interface SnapshotPair {
  readonly attemptId: string;
  readonly status: string;
  readonly sourceKind: string;
  readonly isChaosLinked: boolean;
  readonly before: MerchantStateSnapshotV1 | null;
  readonly after: MerchantStateSnapshotV1 | null;
}

/**
 * Every processing attempt in the bundle, chaos-linked and original alike,
 * with its validated snapshots — sorted by `attemptId` so the output is
 * byte-identical whatever order the caller's arrays arrived in.
 */
export function collectSnapshotPairs(
  bundle: ChaosRunEvidenceBundleV1,
): readonly SnapshotPair[] {
  const toPair = (
    attempt: ProcessingAttemptEvidence,
    isChaosLinked: boolean,
  ): SnapshotPair => ({
    attemptId: attempt.id,
    status: attempt.status,
    sourceKind: attempt.sourceKind,
    isChaosLinked,
    before: capturedSnapshot(attempt.stateBefore),
    after: capturedSnapshot(attempt.stateAfter),
  });

  return [
    ...bundle.originalProcessingAttempts.map((a) => toPair(a, false)),
    ...bundle.chaosProcessingAttempts.map((a) => toPair(a, true)),
  ].sort((x, y) =>
    x.attemptId < y.attemptId ? -1 : x.attemptId > y.attemptId ? 1 : 0,
  );
}

/** Every captured snapshot (before and after, from every attempt), deterministically ordered. */
export function collectCapturedSnapshots(
  bundle: ChaosRunEvidenceBundleV1,
): readonly MerchantStateSnapshotV1[] {
  const out: MerchantStateSnapshotV1[] = [];
  for (const pair of collectSnapshotPairs(bundle)) {
    if (pair.before) out.push(pair.before);
    if (pair.after) out.push(pair.after);
  }
  return out;
}

/** Every attempt id in the bundle, deterministically ordered. */
export function allProcessingAttemptIds(
  bundle: ChaosRunEvidenceBundleV1,
): readonly string[] {
  return collectSnapshotPairs(bundle).map((p) => p.attemptId);
}

// ============================================================================
// FULFILMENT COUNTING (docs/MONEY_INVARIANTS.md §15 "Business Effect Rule")
// ============================================================================

/**
 * The persisted `FULFIL_ORDER` rows in one snapshot, or `null` when the
 * snapshot did not capture the fulfilment collection at all.
 *
 * `null` is NEVER conflated with an empty array: "we did not read that table"
 * and "that table was empty" are different facts, and only the second one can
 * support a PASS.
 */
export function fulfilOrderRows(
  snapshot: MerchantStateSnapshotV1,
): readonly MerchantStateSnapshotFulfilmentV1[] | null {
  if (snapshot.fulfilments === null) return null;
  return snapshot.fulfilments.filter(
    (f) => f.effectType === FULFIL_ORDER_EFFECT,
  );
}

/** Distinct `FULFIL_ORDER` fulfilment ids referencing `paymentId`, or `null` if uncounted. */
export function countFulfilOrderForPayment(
  snapshot: MerchantStateSnapshotV1,
  paymentId: string,
): number | null {
  const rows = fulfilOrderRows(snapshot);
  if (rows === null) return null;
  return new Set(rows.filter((f) => f.paymentId === paymentId).map((f) => f.id))
    .size;
}

/** Distinct `FULFIL_ORDER` fulfilment ids referencing `orderId`, or `null` if uncounted. */
export function countFulfilOrderForOrder(
  snapshot: MerchantStateSnapshotV1,
  orderId: string,
): number | null {
  const rows = fulfilOrderRows(snapshot);
  if (rows === null) return null;
  return new Set(rows.filter((f) => f.orderId === orderId).map((f) => f.id))
    .size;
}

// ============================================================================
// PROTECTED BUSINESS-STATE TUPLE (docs/MONEY_INVARIANTS.md §21 §8)
// ============================================================================

/**
 * The protected tuple INV-006/INV-009/INV-012 compare across a before/after
 * pair: order payment status, order business status, payment captured/failure
 * state, and fulfilment count.
 *
 * Deliberately NOT the whole snapshot — a new processing-attempt row, a chaos
 * run record or a replay timestamp is allowed audit evidence and must not
 * count as business-state change.
 */
export interface ProtectedBusinessState {
  readonly orderPaymentStatus: string | null;
  readonly orderBusinessStatus: string | null;
  readonly orderAmountSubunits: number | null;
  readonly orderCurrency: string | null;
  readonly paymentCapturedAt: string | null;
  readonly paymentFailedAt: string | null;
  readonly paymentRazorpayStatus: string | null;
  readonly paymentAmountSubunits: number | null;
  readonly paymentCurrency: string | null;
  readonly paymentAttemptStatus: string | null;
  /** `null` when the snapshot did not capture the fulfilment collection. */
  readonly fulfilOrderCount: number | null;
  /** Sorted distinct `FULFIL_ORDER` ids, or `null` when uncaptured. */
  readonly fulfilOrderIds: readonly string[] | null;
}

export function protectedBusinessState(
  snapshot: MerchantStateSnapshotV1,
): ProtectedBusinessState {
  const rows = fulfilOrderRows(snapshot);
  const ids = rows === null ? null : [...new Set(rows.map((f) => f.id))].sort();
  return {
    orderPaymentStatus: snapshot.order?.paymentStatus ?? null,
    orderBusinessStatus: snapshot.order?.businessStatus ?? null,
    orderAmountSubunits: snapshot.order?.amountSubunits ?? null,
    orderCurrency: snapshot.order?.currency ?? null,
    paymentCapturedAt: snapshot.payment?.capturedAt ?? null,
    paymentFailedAt: snapshot.payment?.failedAt ?? null,
    paymentRazorpayStatus: snapshot.payment?.razorpayPaymentStatus ?? null,
    paymentAmountSubunits: snapshot.payment?.amountSubunits ?? null,
    paymentCurrency: snapshot.payment?.currency ?? null,
    paymentAttemptStatus: snapshot.paymentAttempt?.status ?? null,
    fulfilOrderCount: ids === null ? null : ids.length,
    fulfilOrderIds: ids,
  };
}

/** Field-wise equality of the protected tuple. Explicit, never a generic deep-equal. */
export function protectedBusinessStateEquals(
  a: ProtectedBusinessState,
  b: ProtectedBusinessState,
): boolean {
  if (a.orderPaymentStatus !== b.orderPaymentStatus) return false;
  if (a.orderBusinessStatus !== b.orderBusinessStatus) return false;
  if (a.orderAmountSubunits !== b.orderAmountSubunits) return false;
  if (a.orderCurrency !== b.orderCurrency) return false;
  if (a.paymentCapturedAt !== b.paymentCapturedAt) return false;
  if (a.paymentFailedAt !== b.paymentFailedAt) return false;
  if (a.paymentRazorpayStatus !== b.paymentRazorpayStatus) return false;
  if (a.paymentAmountSubunits !== b.paymentAmountSubunits) return false;
  if (a.paymentCurrency !== b.paymentCurrency) return false;
  if (a.paymentAttemptStatus !== b.paymentAttemptStatus) return false;
  if (a.fulfilOrderCount !== b.fulfilOrderCount) return false;
  if (a.fulfilOrderIds === null || b.fulfilOrderIds === null) {
    return a.fulfilOrderIds === b.fulfilOrderIds;
  }
  if (a.fulfilOrderIds.length !== b.fulfilOrderIds.length) return false;
  return a.fulfilOrderIds.every((id, i) => id === b.fulfilOrderIds![i]);
}

// ============================================================================
// C03 MUTATION COMPARISON (INV-005)
// ============================================================================

export type C03MutationComparison = "UNCHANGED" | "MUTATED" | "INCOMPLETE";

function orderRowEquals(
  a: MerchantStateSnapshotOrderV1,
  b: MerchantStateSnapshotOrderV1,
): boolean {
  return (
    a.id === b.id &&
    a.paymentStatus === b.paymentStatus &&
    a.businessStatus === b.businessStatus &&
    a.amountSubunits === b.amountSubunits &&
    a.currency === b.currency
  );
}

function paymentAttemptRowEquals(
  a: MerchantStateSnapshotPaymentAttemptV1,
  b: MerchantStateSnapshotPaymentAttemptV1,
): boolean {
  return (
    a.id === b.id &&
    a.orderId === b.orderId &&
    a.status === b.status &&
    a.amountSubunits === b.amountSubunits &&
    a.currency === b.currency &&
    a.razorpayOrderId === b.razorpayOrderId &&
    a.razorpayOrderStatus === b.razorpayOrderStatus
  );
}

function paymentRowEquals(
  a: MerchantStateSnapshotPaymentV1,
  b: MerchantStateSnapshotPaymentV1,
): boolean {
  return (
    a.id === b.id &&
    a.paymentAttemptId === b.paymentAttemptId &&
    a.razorpayPaymentId === b.razorpayPaymentId &&
    a.razorpayPaymentStatus === b.razorpayPaymentStatus &&
    a.amountSubunits === b.amountSubunits &&
    a.currency === b.currency &&
    a.checkoutSignatureVerified === b.checkoutSignatureVerified &&
    a.capturedAt === b.capturedAt &&
    a.failedAt === b.failedAt
  );
}

function fulfilmentRowEquals(
  a: MerchantStateSnapshotFulfilmentV1,
  b: MerchantStateSnapshotFulfilmentV1,
): boolean {
  return (
    a.id === b.id &&
    a.orderId === b.orderId &&
    a.paymentId === b.paymentId &&
    a.triggerProcessingAttemptId === b.triggerProcessingAttemptId &&
    a.effectType === b.effectType &&
    a.appliedAt === b.appliedAt
  );
}

function collectionEquals<TRow extends { readonly id: string }>(
  before: {
    readonly count: number;
    readonly rows: readonly TRow[];
    readonly complete: boolean;
  } | null,
  after: {
    readonly count: number;
    readonly rows: readonly TRow[];
    readonly complete: boolean;
  } | null,
  rowEquals: (a: TRow, b: TRow) => boolean,
): C03MutationComparison {
  // A `null` collection is "that table could not be read"; a truncated prefix
  // (`complete: false`) must NEVER be compared against another prefix and
  // called unchanged.
  if (before === null || after === null) return "INCOMPLETE";
  if (!before.complete || !after.complete) return "INCOMPLETE";
  if (before.count !== after.count) return "MUTATED";
  if (before.rows.length !== after.rows.length) return "MUTATED";

  const sortById = (rows: readonly TRow[]): readonly TRow[] =>
    [...rows].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  const b = sortById(before.rows);
  const a = sortById(after.rows);
  for (let i = 0; i < b.length; i += 1) {
    if (!rowEquals(b[i]!, a[i]!)) return "MUTATED";
  }
  return "UNCHANGED";
}

/**
 * Compares C03's before/after mutation evidence across ALL FIVE approved
 * collections.
 *
 * `INCOMPLETE` wins over `UNCHANGED`: if any required collection is missing
 * or truncated, the comparison cannot support a PASS and the caller must
 * report `UNKNOWN`. `MUTATED` wins over `INCOMPLETE`, because a proven
 * mutation is a proven violation regardless of what else was unreadable.
 */
export function compareC03MutationSnapshots(
  before: C03MutationSnapshotEvidence | null,
  after: C03MutationSnapshotEvidence | null,
): C03MutationComparison {
  if (before === null || after === null) return "INCOMPLETE";

  const results: C03MutationComparison[] = [
    collectionEquals(before.orders, after.orders, orderRowEquals),
    collectionEquals(
      before.paymentAttempts,
      after.paymentAttempts,
      paymentAttemptRowEquals,
    ),
    collectionEquals(before.payments, after.payments, paymentRowEquals),
    collectionEquals(
      before.fulfilments,
      after.fulfilments,
      fulfilmentRowEquals,
    ),
  ];

  // The trusted canonical webhook set carries ids + an exact count only.
  const bw = before.trustedWebhookEvents;
  const aw = after.trustedWebhookEvents;
  if (bw === null || aw === null || !bw.complete || !aw.complete) {
    results.push("INCOMPLETE");
  } else if (bw.count !== aw.count) {
    results.push("MUTATED");
  } else {
    const bIds = [...bw.ids].sort();
    const aIds = [...aw.ids].sort();
    results.push(
      bIds.length === aIds.length && bIds.every((id, i) => id === aIds[i])
        ? "UNCHANGED"
        : "MUTATED",
    );
  }

  if (results.includes("MUTATED")) return "MUTATED";
  if (results.includes("INCOMPLETE")) return "INCOMPLETE";
  return "UNCHANGED";
}

// ============================================================================
// EVIDENCE REFERENCES
// ============================================================================

const EVIDENCE_REF_KIND_ORDER: readonly string[] = Object.freeze([
  "ORDER",
  "PAYMENT_ATTEMPT",
  "PAYMENT",
  "FULFILMENT",
  "WEBHOOK_EVENT",
  "EVENT_PROCESSING_ATTEMPT",
  "CHAOS_RUN",
] as const);

/**
 * Deterministic dedupe + sort. The same references supplied in any order
 * produce a byte-identical array: kind first (in the frozen catalogue order),
 * then UUID lexicographically.
 */
export function dedupeAndSortInvariantEvidenceRefs(
  refs: readonly InvariantEvidenceRef[],
): readonly InvariantEvidenceRef[] {
  const seen = new Map<string, InvariantEvidenceRef>();
  for (const ref of refs) {
    seen.set(`${ref.kind}::${ref.id}`, ref);
  }
  return [...seen.values()].sort((a, b) => {
    const ka = EVIDENCE_REF_KIND_ORDER.indexOf(a.kind);
    const kb = EVIDENCE_REF_KIND_ORDER.indexOf(b.kind);
    if (ka !== kb) return ka - kb;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** Builds a reference only when the id is actually present — never a placeholder. */
export function refIf(
  kind: InvariantEvidenceRef["kind"],
  id: string | null | undefined,
): readonly InvariantEvidenceRef[] {
  return id ? [{ kind, id }] : [];
}

// ============================================================================
// CORRELATIONS AND RESULT CONSTRUCTION
// ============================================================================

/**
 * The run's truthful correlations. Never fabricated: a C03 run legitimately
 * reports `orderId`/`paymentAttemptId`/`paymentId` as `null` and carries only
 * its `chaosRunId`.
 */
export function correlationsFrom(
  bundle: ChaosRunEvidenceBundleV1,
): InvariantCorrelations {
  return {
    orderId: bundle.run.orderId,
    paymentAttemptId: bundle.run.paymentAttemptId,
    paymentId: bundle.run.paymentId,
    chaosRunId: bundle.run.id,
  };
}

export function persistableEvaluation(input: {
  readonly invariantId: MoneyInvariantId;
  readonly invariantVersion: string;
  readonly disposition: PersistedInvariantResult;
  readonly severity: InvariantSeverity;
  readonly correlations: InvariantCorrelations;
  readonly expectedSummary: string;
  readonly observedSummary: string;
  readonly reason: string;
  readonly evidenceRefs: readonly InvariantEvidenceRef[];
}): PersistableInvariantEvaluation {
  return {
    invariantId: input.invariantId,
    invariantVersion: input.invariantVersion,
    disposition: input.disposition,
    severity: input.severity,
    correlations: input.correlations,
    expectedSummary: input.expectedSummary,
    observedSummary: input.observedSummary,
    reason: input.reason,
    evidenceRefs: dedupeAndSortInvariantEvidenceRefs(input.evidenceRefs),
  };
}

export function nonPersistableEvaluation(input: {
  readonly invariantId: MoneyInvariantId;
  readonly invariantVersion: string;
  readonly disposition: "NOT_APPLICABLE" | "ERROR";
  readonly correlations: InvariantCorrelations;
  readonly reason: string;
  readonly evidenceRefs: readonly InvariantEvidenceRef[];
}): NonPersistableInvariantEvaluation {
  return {
    invariantId: input.invariantId,
    invariantVersion: input.invariantVersion,
    disposition: input.disposition,
    correlations: input.correlations,
    reason: input.reason,
    evidenceRefs: dedupeAndSortInvariantEvidenceRefs(input.evidenceRefs),
  };
}

// ============================================================================
// PROCESSING-STATUS SEMANTICS (architect blocker 3F-B-06)
// ============================================================================

export const PROCESSING_ATTEMPT_STATUS_PENDING = "PENDING";
export const PROCESSING_ATTEMPT_STATUS_HELD = "HELD";
export const PROCESSING_ATTEMPT_STATUS_PROCESSING = "PROCESSING";
export const PROCESSING_ATTEMPT_STATUS_SKIPPED_DUPLICATE = "SKIPPED_DUPLICATE";

/**
 * The frozen `event_processing_attempts.status` vocabulary.
 *
 * ONLY `SUCCEEDED` is first-party successful processing. `PENDING`, `HELD` and
 * `PROCESSING` are in flight and prove nothing yet. `SKIPPED_DUPLICATE` means
 * this attempt deliberately did no work: it may be perfectly safe because an
 * independent earlier attempt already completed the logical effect, but it is
 * NOT itself merchant-success authority. `status !== FAILED` is therefore NOT
 * a success test, and is never used as one.
 */
export function isSuccessfulProcessing(status: string): boolean {
  return status === PROCESSING_ATTEMPT_STATUS_SUCCEEDED;
}

/** Still in flight — proves neither success nor failure. */
export function isInFlightProcessing(status: string): boolean {
  return (
    status === PROCESSING_ATTEMPT_STATUS_PENDING ||
    status === PROCESSING_ATTEMPT_STATUS_HELD ||
    status === PROCESSING_ATTEMPT_STATUS_PROCESSING
  );
}

// ============================================================================
// TRUSTED PROVIDER EVIDENCE
// ============================================================================

/**
 * Is this webhook trusted, verified provider evidence?
 *
 * A `PAYCHAOS_REPLAY` row and an unverified row are both excluded — internal
 * reprocessing is never provider authority, and an unverified signature is
 * never authoritative regardless of its `source_kind`.
 */
export function isTrustedProviderEvent(webhook: SafeWebhookEvidence): boolean {
  return (
    webhook.sourceKind === REAL_RAZORPAY_WEBHOOK && webhook.signatureVerified
  );
}

/**
 * The trusted webhooks that are genuinely ABOUT this payment, deduped by id
 * and deterministically ordered.
 *
 * Both safe trusted surfaces are considered — `sourceWebhook` and
 * `authoritativeCaptureWebhook` — because either can legitimately carry the
 * normalized money terms INV-008 §8 requires. Relevance is exact identity
 * only: the webhook's internal `paymentId` must equal the evaluated payment,
 * or its trusted `razorpayPaymentId` must equal the payment's provider id. An
 * untrusted or unrelated webhook never becomes money authority.
 */
export function trustedWebhooksForPayment(
  bundle: ChaosRunEvidenceBundleV1,
  payment: MerchantStateSnapshotPaymentV1,
): readonly SafeWebhookEvidence[] {
  const byId = new Map<string, SafeWebhookEvidence>();
  for (const candidate of [
    bundle.sourceWebhook,
    bundle.authoritativeCaptureWebhook,
  ]) {
    if (candidate === null) continue;
    if (!isTrustedProviderEvent(candidate)) continue;
    const relevant =
      candidate.paymentId === payment.id ||
      (candidate.razorpayPaymentId !== null &&
        candidate.razorpayPaymentId === payment.razorpayPaymentId);
    if (relevant) byId.set(candidate.id, candidate);
  }
  return [...byId.values()].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
}

// ============================================================================
// THE MERCHANT PATH (INV-002 / INV-004 / INV-008 / INV-010)
// ============================================================================

/**
 * One captured snapshot that carries the complete order -> payment attempt ->
 * payment chain, so relational and money conditions can be judged from it.
 */
export interface MerchantPath {
  readonly order: MerchantStateSnapshotOrderV1;
  readonly paymentAttempt: MerchantStateSnapshotPaymentAttemptV1;
  readonly payment: MerchantStateSnapshotPaymentV1;
  readonly fulfilments: readonly MerchantStateSnapshotFulfilmentV1[] | null;
}

/** Every captured snapshot carrying the full chain, deterministically ordered. */
export function collectMerchantPaths(
  bundle: ChaosRunEvidenceBundleV1,
): readonly MerchantPath[] {
  const paths: MerchantPath[] = [];
  for (const snapshot of collectCapturedSnapshots(bundle)) {
    if (
      snapshot.order !== null &&
      snapshot.paymentAttempt !== null &&
      snapshot.payment !== null
    ) {
      paths.push({
        order: snapshot.order,
        paymentAttempt: snapshot.paymentAttempt,
        payment: snapshot.payment,
        fulfilments: fulfilOrderRows(snapshot),
      });
    }
  }
  return paths;
}

/**
 * Is the payment correlated to an internal payment attempt AND order?
 *
 * This is INV-002's and INV-008's documented precondition. A payment id alone
 * does not satisfy it — the chain must actually resolve.
 */
export function isPaymentCorrelatedToOrderPath(path: MerchantPath): boolean {
  return (
    path.payment.paymentAttemptId === path.paymentAttempt.id &&
    path.paymentAttempt.orderId === path.order.id
  );
}

export type PathVerdict =
  | { readonly kind: "VALID" }
  | { readonly kind: "INVALID"; readonly detail: string }
  | { readonly kind: "INDETERMINATE"; readonly detail: string };

/**
 * RELATION ONLY — conditions 1 and 2 of docs/MONEY_INVARIANTS.md INV-004 §8,
 * and the whole of INV-010 §8's chain rule:
 *
 *   1. the linked payment exists (and is this path's payment);
 *   2. the payment belongs to the order through its payment attempt, and the
 *      fulfilment's own order agrees.
 *
 * Deliberately carries NO money clause (architect blocker FINAL-03). INV-010
 * has no amount/currency condition at all — money consistency is INV-008's
 * rule, and INV-004 pulls it in separately via
 * `validateMerchantMoneyConsistency` + `validateTrustedWebhookMoneyForPayment`.
 * Conditions 3 and 4 (authoritative captured-payment evidence, verified
 * server-side) live on the bundle's capture resolution, not inside a snapshot.
 */
export function validateFulfilmentRelation(
  path: MerchantPath,
  fulfilment: MerchantStateSnapshotFulfilmentV1,
): PathVerdict {
  if (fulfilment.paymentId !== path.payment.id) {
    return {
      kind: "INVALID",
      detail: "fulfilment references a payment outside the captured path",
    };
  }
  if (path.payment.paymentAttemptId !== path.paymentAttempt.id) {
    return {
      kind: "INVALID",
      detail: "payment does not resolve to the captured payment attempt",
    };
  }
  if (path.paymentAttempt.orderId !== path.order.id) {
    return {
      kind: "INVALID",
      detail: "payment attempt belongs to a different order",
    };
  }
  if (fulfilment.orderId !== path.order.id) {
    return {
      kind: "INVALID",
      detail: "fulfilment order differs from the resolved order",
    };
  }
  return { kind: "VALID" };
}

/** INV-008's merchant-row money clause: order == attempt == payment, exactly. */
export function validateMerchantMoneyConsistency(
  path: MerchantPath,
): PathVerdict {
  const comparisons: readonly [string, MoneyComparison][] = [
    ["order vs payment_attempt", compareMoney(path.order, path.paymentAttempt)],
    [
      "payment_attempt vs payment",
      compareMoney(path.paymentAttempt, path.payment),
    ],
    ["order vs payment", compareMoney(path.order, path.payment)],
  ];
  for (const [label, comparison] of comparisons) {
    if (comparison === "MISMATCH") {
      return { kind: "INVALID", detail: `${label} money mismatch` };
    }
  }
  for (const [label, comparison] of comparisons) {
    if (comparison === "INDETERMINATE") {
      return {
        kind: "INDETERMINATE",
        detail: `${label} could not be established`,
      };
    }
  }
  return { kind: "VALID" };
}

/**
 * INV-008's trusted-webhook money clause: "If trusted normalized webhook
 * evidence contains amount/currency, it must match the canonical payment
 * values as well."
 *
 * A RELEVANT trusted webhook missing either component is missing required
 * evidence (`INDETERMINATE`), never a silently skipped comparison. `NULL` is
 * never defaulted to `0` or `"INR"`. A proven mismatch dominates.
 */
export function validateTrustedWebhookMoneyForPayment(
  bundle: ChaosRunEvidenceBundleV1,
  payment: MerchantStateSnapshotPaymentV1,
): PathVerdict {
  let indeterminate: string | null = null;
  for (const trusted of trustedWebhooksForPayment(bundle, payment)) {
    const comparison = compareMoney(trusted, payment);
    if (comparison === "MISMATCH") {
      return {
        kind: "INVALID",
        detail: "trusted webhook money terms vs payment mismatch",
      };
    }
    if (comparison === "INDETERMINATE") {
      indeterminate =
        "a relevant trusted webhook carries no usable amount or currency";
    }
  }
  return indeterminate === null
    ? { kind: "VALID" }
    : { kind: "INDETERMINATE", detail: indeterminate };
}

/**
 * A relational chain identity: which payment, attempt and order a fulfilment
 * resolves through. Two snapshots observing the SAME chain are one chain, not
 * two — INV-010's "joined valid path count = 1" counts DISTINCT chains.
 */
export function chainKey(path: MerchantPath): string {
  return `${path.payment.id}|${path.paymentAttempt.id}|${path.order.id}`;
}

export interface DistinctChainResolution {
  readonly validKeys: readonly string[];
  /** One representative captured path per distinct valid chain, in `validKeys` order. */
  readonly validPaths: readonly MerchantPath[];
  readonly invalidDetail: string | null;
  readonly observedAnyPath: boolean;
}

/**
 * Resolves the DISTINCT valid relational chains for one fulfilment across
 * every captured merchant path, deduping repeated before/after observations
 * of the same chain.
 *
 * A path is EVIDENCE ABOUT this fulfilment only when the fulfilment actually
 * appears in that path's own captured collection. `path.fulfilments` is the
 * fulfilment set observed alongside that path's order/attempt/payment, so a
 * disagreement inside it is a DIRECTLY OBSERVED wrong relation and proves
 * `INVALID`. A path for some other payment is simply not evidence about this
 * fulfilment, and must not be read as proof that its relation is wrong — that
 * would manufacture a FAIL from unrelated evidence. A fulfilment no captured
 * path carries therefore resolves to zero chains and zero proof, which the
 * caller must report as `UNKNOWN` rather than skipping it silently.
 */
export function resolveDistinctChains(
  paths: readonly MerchantPath[],
  fulfilment: MerchantStateSnapshotFulfilmentV1,
): DistinctChainResolution {
  const valid = new Map<string, MerchantPath>();
  let invalidDetail: string | null = null;
  let observedAnyPath = false;
  for (const path of paths) {
    if (
      path.fulfilments === null ||
      !path.fulfilments.some((f) => f.id === fulfilment.id)
    ) {
      continue;
    }
    observedAnyPath = true;
    const verdict = validateFulfilmentRelation(path, fulfilment);
    if (verdict.kind === "VALID") {
      const key = chainKey(path);
      if (!valid.has(key)) valid.set(key, path);
    } else if (verdict.kind === "INVALID" && invalidDetail === null) {
      invalidDetail = verdict.detail;
    }
  }
  const validKeys = [...valid.keys()].sort();
  return {
    validKeys,
    validPaths: validKeys.map((k) => valid.get(k)!),
    invalidDetail,
    observedAnyPath,
  };
}

// ============================================================================
// EXACT CAPTURE-TO-PAYMENT AUTHORITY (architect blocker NARROW-03)
// ============================================================================

/**
 * Is there authoritative successful-payment evidence for THIS EXACT payment?
 *
 * A run-level `authoritativeCapture.kind === "EXACTLY_ONE"` is NOT sufficient
 * on its own: the resolved capture must actually be about the payment the
 * fulfilment path points at. A capture for payment A can never authorise a
 * fulfilment whose chain resolves to payment B.
 *
 * Every one of the following must hold for `VALID`:
 *
 *   - `authoritativeCapture.kind === "EXACTLY_ONE"`;
 *   - the resolution's own webhook and `authoritativeCaptureWebhook` both
 *     exist AND identify the SAME persisted row (`id` equality) — a
 *     disagreement between the two is inconsistent evidence, and picking one
 *     would be an arbitrary choice;
 *   - `sourceKind === REAL_RAZORPAY_WEBHOOK` (never `PAYCHAOS_REPLAY`);
 *   - `signatureVerified === true`;
 *   - `eventType === "payment.captured"`;
 *   - EXACT INTERNAL identity: `paymentId` non-null AND equal to `payment.id`;
 *   - EXACT PROVIDER identity: `razorpayPaymentId` non-null AND equal to
 *     `payment.razorpayPaymentId`.
 *
 * BOTH identities are required — `AND`, never `OR`. A provider-only match
 * with a contradicting internal id (or the reverse) is precisely what the
 * frozen contract classifies as `INCOMPLETE_INTERNAL_CORRELATION`, and an
 * `EXACTLY_ONE` code path must not quietly recreate that weaker state as
 * authority. The merchant-processing success contract likewise requires every
 * payment relationship to agree before fulfilment.
 *
 * Exact equality only. Never a substring, prefix, fuzzy match, timestamp
 * preference or "latest". `checkoutSignatureVerified` and `capturedAt` are
 * merchant-side facts and are never capture authority.
 *
 * `INVALID` is reserved for the one case the evidence PROVES: a completed
 * search established that no capture exists. Everything else — an incomplete
 * search, an unverified or wrong-typed webhook, or a capture about a different
 * payment — is `INDETERMINATE`, because none of those prove a business
 * violation.
 */
export function validateAuthoritativeCaptureForPayment(
  bundle: ChaosRunEvidenceBundleV1,
  payment: MerchantStateSnapshotPaymentV1,
): PathVerdict {
  const capture = bundle.authoritativeCapture;
  if (capture.kind === "NONE_OBSERVED") {
    return {
      kind: "INVALID",
      detail: "a complete authoritative capture search established no capture",
    };
  }
  if (capture.kind !== "EXACTLY_ONE") {
    return {
      kind: "INDETERMINATE",
      detail: `authoritative capture = ${capture.kind}`,
    };
  }

  const webhook = bundle.authoritativeCaptureWebhook;
  if (webhook === null) {
    return {
      kind: "INDETERMINATE",
      detail: "the resolved capture webhook projection is unavailable",
    };
  }
  // The resolution and the projection must name the SAME persisted row.
  // Disagreement is internally inconsistent evidence; choosing one would be
  // arbitrary, and "latest" is never authority.
  if (capture.webhook.id !== webhook.id) {
    return {
      kind: "INDETERMINATE",
      detail:
        "the capture resolution and the projected capture webhook identify different persisted rows",
    };
  }
  if (!isTrustedProviderEvent(webhook)) {
    return {
      kind: "INDETERMINATE",
      detail: `the resolved capture is not verified provider evidence (source ${webhook.sourceKind}, signature verified ${webhook.signatureVerified})`,
    };
  }
  if (webhook.eventType !== EVENT_TYPE_PAYMENT_CAPTURED) {
    return {
      kind: "INDETERMINATE",
      detail: `the resolved capture event type is ${webhook.eventType}, not ${EVENT_TYPE_PAYMENT_CAPTURED}`,
    };
  }

  // EXACT INTERNAL identity — required.
  if (webhook.paymentId === null) {
    return {
      kind: "INDETERMINATE",
      detail:
        "the resolved capture carries no internal payment correlation, so internal identity cannot be confirmed",
    };
  }
  if (webhook.paymentId !== payment.id) {
    return {
      kind: "INDETERMINATE",
      detail:
        "the resolved capture's internal payment identity contradicts the evaluated payment",
    };
  }

  // EXACT PROVIDER identity — also required. Both must agree.
  if (webhook.razorpayPaymentId === null) {
    return {
      kind: "INDETERMINATE",
      detail:
        "the resolved capture carries no provider payment identity, so provider identity cannot be confirmed",
    };
  }
  if (webhook.razorpayPaymentId !== payment.razorpayPaymentId) {
    return {
      kind: "INDETERMINATE",
      detail:
        "the resolved capture's provider payment identity contradicts the evaluated payment",
    };
  }
  return { kind: "VALID" };
}

// ============================================================================
// NESTED SNAPSHOT COMPLETENESS (architect blocker FINAL-08)
// ============================================================================

/**
 * `{ kind: "CAPTURED" }` only means the JSON shape parsed. It does NOT mean
 * every nested merchant entity was resolved: `MerchantStateSnapshotV1`
 * legitimately permits `order`, `paymentAttempt`, `payment` and `fulfilments`
 * to be `null`.
 *
 * Two missing nested values comparing equal is therefore NOT positive proof of
 * "unchanged". This is the smallest helper that says which entities a rule
 * needs, driven by the run's own truthful correlations — deliberately not a
 * new generic evidence framework.
 */
export interface RequiredEntities {
  readonly order: boolean;
  readonly paymentAttempt: boolean;
  readonly payment: boolean;
  readonly fulfilments: boolean;
}

/**
 * What a protected-effect rule must be able to see for THIS run: whichever
 * merchant entities the run actually correlates to, plus (when the rule counts
 * business effects) the fulfilment collection.
 */
export function requiredEntitiesFromRun(
  bundle: ChaosRunEvidenceBundleV1,
  options: { readonly fulfilments: boolean },
): RequiredEntities {
  return {
    order: bundle.run.orderId !== null,
    paymentAttempt: bundle.run.paymentAttemptId !== null,
    payment: bundle.run.paymentId !== null,
    fulfilments: options.fulfilments,
  };
}

/** The required entities this snapshot did NOT resolve, deterministically ordered. */
export function missingRequiredEntities(
  snapshot: MerchantStateSnapshotV1,
  required: RequiredEntities,
): readonly string[] {
  const missing: string[] = [];
  if (required.order && snapshot.order === null) missing.push("order");
  if (required.paymentAttempt && snapshot.paymentAttempt === null) {
    missing.push("paymentAttempt");
  }
  if (required.payment && snapshot.payment === null) missing.push("payment");
  if (required.fulfilments && snapshot.fulfilments === null) {
    missing.push("fulfilments");
  }
  return missing;
}

/** Does this snapshot resolve everything the rule requires? */
export function isSnapshotComplete(
  snapshot: MerchantStateSnapshotV1,
  required: RequiredEntities,
): boolean {
  return missingRequiredEntities(snapshot, required).length === 0;
}

// ============================================================================
// CAPTURE-EVENT PROCESSING CORRELATION (architect blocker FINAL-05)
// ============================================================================

/**
 * The processing attempts that actually processed the AUTHORITATIVE CAPTURE
 * event, correlated by exact `webhookEventId` identity.
 *
 * INV-011 Rule C asks whether the merchant converged to PAID after the CAPTURE
 * was processed successfully. A `SUCCEEDED` attempt that processed a
 * `payment.failed` event is not the capture processor, and treating it as one
 * produces a false FAIL for the perfectly legitimate
 * failure-then-later-capture sequence. Exact id equality only — never a
 * timestamp preference, never "latest wins".
 */
export function captureProcessingAttempts(
  bundle: ChaosRunEvidenceBundleV1,
): readonly ProcessingAttemptEvidence[] {
  const captureWebhookId = bundle.authoritativeCaptureWebhook?.id ?? null;
  if (captureWebhookId === null) return [];
  return [
    ...bundle.originalProcessingAttempts,
    ...bundle.chaosProcessingAttempts,
  ]
    .filter((a) => a.webhookEventId === captureWebhookId)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// ============================================================================
// REPEATED-TRIGGER EVIDENCE (INV-007 applicability, blocker 3F-B-04)
// ============================================================================

/**
 * Was the same logical merchant action triggered MORE THAN ONCE?
 *
 * That is INV-007's documented precondition (§22 §7): duplicate webhook
 * delivery, different related success events, or repeated internal
 * processing. A normal order processed exactly once must NOT receive a
 * persisted PASS for a duplicate-delivery invariant whose precondition never
 * occurred.
 *
 * Established ONLY from approved factual evidence — never from a scenario ID.
 */
export interface RepeatedTriggerEvidence {
  readonly repeated: boolean;
  readonly duplicateFlaggedAttempts: number;
  readonly replayAttempts: number;
  readonly totalProcessingAttempts: number;
  readonly duplicateDeliveryCount: number;
}

export function repeatedTriggerEvidence(
  bundle: ChaosRunEvidenceBundleV1,
): RepeatedTriggerEvidence {
  const all = [
    ...bundle.originalProcessingAttempts,
    ...bundle.chaosProcessingAttempts,
  ];
  const duplicateFlaggedAttempts = all.filter(
    (a) => a.isDuplicateDelivery,
  ).length;
  const replayAttempts = bundle.chaosProcessingAttempts.length;
  const duplicateDeliveryCount =
    bundle.sourceWebhook?.duplicateDeliveryCount ?? 0;
  return {
    repeated:
      duplicateFlaggedAttempts > 0 ||
      replayAttempts > 0 ||
      duplicateDeliveryCount > 0 ||
      all.length > 1,
    duplicateFlaggedAttempts,
    replayAttempts,
    totalProcessingAttempts: all.length,
    duplicateDeliveryCount,
  };
}
