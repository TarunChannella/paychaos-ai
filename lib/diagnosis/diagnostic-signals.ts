/**
 * Phase 4B-R1 — deterministic diagnostic signal extraction.
 *
 * The frozen architecture is:
 *
 *   Finding -> DiagnosisEvidencePackV1 -> Deterministic Signals -> (Phase 4C)
 *
 * This module implements the third arrow and STOPS there. It contains no
 * root-cause classification, no `RC-` code, no evidence-strength judgement, no
 * recommendation, no regression logic, no score and no readiness rule. Those
 * belong to 4C and later (`docs/AI_DESIGN.md` Sections 14–40).
 *
 * ONE EVIDENCE SURFACE. The only input is a `DiagnosisEvidencePackV1`. This
 * module never queries `orders`, `payments`, `payment_attempts`, `fulfilments`
 * or `webhook_events`, and never builds a second evidence model. If a fact is
 * not in the pack, it is not available here.
 *
 * SIGNALS ARE ADVISORY OBSERVATIONS. They describe patterns in structured
 * evidence. They cannot change the authoritative invariant verdict, and a
 * signal that cannot be established is never a failure — it is `UNKNOWN`.
 *
 * PROSE IS NEVER EVIDENCE. Deterministic evaluator text is not machine-
 * readable fact. Nothing here reads the Finding title or the evaluator's
 * expected/observed/reason wording, so no phrasing — however confident,
 * however accurate — can make a signal `PRESENT`. `scenarioId` and
 * `invariantId` may gate whether a scenario-specific signal is applicable at
 * all, but neither can make one `PRESENT` on its own.
 *
 * MISSING EVIDENCE IS NEVER `ABSENT`. `ABSENT` is a positive claim that the
 * evidence was sufficient AND proved the pattern is not there. Anything
 * weaker is `UNKNOWN` (`docs/MONEY_INVARIANTS.md` Principle 3, MI-SAFE-009).
 *
 * A PROVEN PATTERN DOMINATES INCOMPLETENESS. If one trustworthy complete
 * observation proves a pattern, missing evidence elsewhere cannot downgrade
 * it — but the reverse never holds: one convenient complete observation may
 * not produce `ABSENT` while relevant evidence elsewhere is missing. Every
 * qualifying observation is examined for this reason; assembly order never
 * decides a signal.
 *
 * A MISSING CORRELATION IS NOT A WILDCARD. A `null` correlation on the
 * Finding is evidence ABSENCE. It narrows what can be claimed and must never
 * be read as "matches anything", so a signal asserting a fact about a
 * specific merchant subject requires that subject's identity and is
 * `UNKNOWN` without it.
 *
 * PURE. No database, no network, no environment, no filesystem, no clock, no
 * randomness, no AI provider, no write of any kind, and no mutation of the
 * supplied pack. The same pack always yields a deep-equal signal set.
 */

import type {
  DiagnosisEvidencePackV1,
  EvidencePackGapCode,
  EvidencePackProcessingAttempt,
} from "@/lib/diagnosis/evidence-pack";
import type {
  MerchantStateSnapshotFulfilmentV1,
  MerchantStateSnapshotOrderV1,
  MerchantStateSnapshotPaymentAttemptV1,
  MerchantStateSnapshotPaymentV1,
  MerchantStateSnapshotV1,
} from "@/lib/evidence/merchant-state-snapshot";

/**
 * Signal contract version. Bump ONLY when the emitted shape or the meaning of
 * a state changes in a way a later phase must branch on.
 */
export const DIAGNOSTIC_SIGNAL_VERSION = 1 as const;

// ============================================================================
// STATE MODEL
// ============================================================================

/**
 * The three semantic states. Deliberately not a boolean.
 *
 * `PRESENT`  structured evidence deterministically proves the pattern.
 * `ABSENT`   evidence is sufficient AND proves the pattern is not present.
 * `UNKNOWN`  required evidence is missing, incomplete, historically
 *            unavailable, or contradictory enough that neither can be
 *            established safely.
 *
 * `UNKNOWN` is not a verdict and not a failure. It is the honest answer.
 */
export type DiagnosticSignalState = "PRESENT" | "ABSENT" | "UNKNOWN";

// ============================================================================
// FROZEN P0 SIGNAL VOCABULARY
// ============================================================================

/** The frozen emission order. Signals always appear in exactly this sequence. */
const SIGNAL_CODES = Object.freeze([
  "DUPLICATE_EVENT_ATTEMPTS",
  "DUPLICATE_FULFILMENTS",
  "DIFFERENT_FULFILMENT_IDEMPOTENCY_KEYS",
  "SAME_LOGICAL_PAYMENT",
  "INVALID_SIGNATURE_MUTATED_STATE",
  "CLIENT_CONFIRMATION_MISSING",
  "PAYMENT_CAPTURED_VIA_WEBHOOK",
  "CAPTURE_EXISTS_ORDER_NOT_PAID",
  "FAILURE_EVENT_MARKED_PAID",
  "OUT_OF_ORDER_STATE_REGRESSION",
  "REPLAY_CHANGED_FINAL_STATE",
  "AMOUNT_MISMATCH",
  "CURRENCY_MISMATCH",
] as const);

export const DIAGNOSTIC_SIGNAL_CODES: readonly DiagnosticSignalCode[] =
  SIGNAL_CODES;

export type DiagnosticSignalCode = (typeof SIGNAL_CODES)[number];

/**
 * The pack gaps that can block each signal.
 *
 * This map is what keeps gaps independent: a gap affects a signal only when
 * the missing fact is one that signal actually requires. A missing money
 * projection must never stop a fully-evidenced C07 fault observation from
 * being `PRESENT`.
 */
const RELEVANT_GAPS: Readonly<
  Record<DiagnosticSignalCode, readonly EvidencePackGapCode[]>
> = Object.freeze({
  DUPLICATE_EVENT_ATTEMPTS: ["CHAOS_EVIDENCE_UNAVAILABLE"],
  DUPLICATE_FULFILMENTS: ["CHAOS_EVIDENCE_UNAVAILABLE"],
  DIFFERENT_FULFILMENT_IDEMPOTENCY_KEYS: ["CHAOS_EVIDENCE_UNAVAILABLE"],
  SAME_LOGICAL_PAYMENT: ["CHAOS_EVIDENCE_UNAVAILABLE"],
  INVALID_SIGNATURE_MUTATED_STATE: [
    "CHAOS_EVIDENCE_UNAVAILABLE",
    "C03_VERIFICATION_CHECKS_UNAVAILABLE",
    "C03_MUTATION_FACTS_UNAVAILABLE",
  ],
  CLIENT_CONFIRMATION_MISSING: [
    "CHAOS_EVIDENCE_UNAVAILABLE",
    "C07_FAULT_FACTS_UNAVAILABLE",
  ],
  PAYMENT_CAPTURED_VIA_WEBHOOK: [
    "CHAOS_EVIDENCE_UNAVAILABLE",
    "SOURCE_WEBHOOK_UNAVAILABLE",
    "CAPTURE_CONTEXT_UNAVAILABLE",
  ],
  CAPTURE_EXISTS_ORDER_NOT_PAID: [
    "CHAOS_EVIDENCE_UNAVAILABLE",
    "CAPTURE_CONTEXT_UNAVAILABLE",
  ],
  FAILURE_EVENT_MARKED_PAID: [
    "CHAOS_EVIDENCE_UNAVAILABLE",
    "SOURCE_WEBHOOK_UNAVAILABLE",
    "CAPTURE_CONTEXT_UNAVAILABLE",
  ],
  OUT_OF_ORDER_STATE_REGRESSION: ["CHAOS_EVIDENCE_UNAVAILABLE"],
  REPLAY_CHANGED_FINAL_STATE: ["CHAOS_EVIDENCE_UNAVAILABLE"],
  AMOUNT_MISMATCH: ["CHAOS_EVIDENCE_UNAVAILABLE", "MONEY_CONTEXT_UNAVAILABLE"],
  CURRENCY_MISMATCH: [
    "CHAOS_EVIDENCE_UNAVAILABLE",
    "MONEY_CONTEXT_UNAVAILABLE",
  ],
});

// ============================================================================
// OUTPUT CONTRACT
// ============================================================================

/**
 * One derived observation.
 *
 * `blockingGapCodes` is narrow deterministic metadata: the pack gaps that are
 * both present and relevant to this signal, reported only when the state is
 * `UNKNOWN`. It is never free text, never a probability, never a diagnosis.
 */
export interface DiagnosticSignalObservationV1 {
  readonly code: DiagnosticSignalCode;
  readonly state: DiagnosticSignalState;
  readonly blockingGapCodes: readonly EvidencePackGapCode[];
}

export interface DiagnosticSignalSetV1 {
  readonly version: typeof DIAGNOSTIC_SIGNAL_VERSION;
  readonly findingId: string;
  readonly invariantResultId: string;
  readonly signals: readonly DiagnosticSignalObservationV1[];
}

// ============================================================================
// FROZEN VOCABULARY CONSTANTS
// ============================================================================

const FULFIL_ORDER = "FULFIL_ORDER";
const PAID = "PAID";
const FULFILLED = "FULFILLED";
const OPEN = "OPEN";
const REAL_RAZORPAY_WEBHOOK = "REAL_RAZORPAY_WEBHOOK";
const PAYCHAOS_REPLAY = "PAYCHAOS_REPLAY";
const EVENT_PAYMENT_CAPTURED = "payment.captured";
const EVENT_PAYMENT_FAILED = "payment.failed";

/** The weaker order payment states a `PAID` order must never regress to. */
const ORDER_STATES_WEAKER_THAN_PAID: readonly string[] = Object.freeze([
  "UNPAID",
  "PENDING",
  "FAILED_OBSERVED",
]);

/**
 * The frozen `payment_attempts.status` vocabulary
 * (`docs/MONEY_INVARIANTS.md` Section 13). `CAPTURED` is the strongest state;
 * every other known value is weaker, so a transition from `CAPTURED` to any of
 * them is a regression.
 */
const ATTEMPT_CAPTURED = "CAPTURED";
const ATTEMPT_STATES_WEAKER_THAN_CAPTURED: readonly string[] = Object.freeze([
  "CREATED",
  "ORDER_CREATED",
  "CHECKOUT_IN_PROGRESS",
  "FAILED_OBSERVED",
]);

function isKnownAttemptStatus(status: string): boolean {
  return (
    status === ATTEMPT_CAPTURED ||
    ATTEMPT_STATES_WEAKER_THAN_CAPTURED.includes(status)
  );
}

// ============================================================================
// AUTHORITATIVE CAPTURE
// ============================================================================

/**
 * How much the pack's capture search can be relied on for MERCHANT-STATE
 * authority.
 *
 * `AUTHORITATIVE`     exactly one verified provider capture, internally
 *                     correlated to this subject.
 * `COMPLETE_NEGATIVE` the search was genuinely capable of finding a capture
 *                     and found none.
 * `UNKNOWN`           everything else.
 *
 * `INCOMPLETE_INTERNAL_CORRELATION` deliberately lands in `UNKNOWN`. It is
 * real provider capture evidence whose internal correlation is absent or
 * mismatched, so it can prove a webhook EXISTS but cannot prove which merchant
 * subject it belongs to. Using it as merchant authority would let a capture
 * for one payment explain another payment's state.
 * `SEARCH_INCOMPLETE`, `AMBIGUOUS_SUBJECT`, `NO_SUBJECT` and `AMBIGUOUS` are
 * likewise never negatives: concluding "no capture exists" from a search that
 * could not have seen one is exactly the false-finding failure mode
 * `docs/MONEY_INVARIANTS.md` Section 5.2 forbids.
 */
type CaptureAuthority = "AUTHORITATIVE" | "COMPLETE_NEGATIVE" | "UNKNOWN";

function captureAuthority(pack: DiagnosisEvidencePackV1): CaptureAuthority {
  const capture = pack.capture;
  if (capture === null) return "UNKNOWN";

  if (capture.resolution === "NONE_OBSERVED") return "COMPLETE_NEGATIVE";

  if (capture.resolution !== "EXACTLY_ONE") return "UNKNOWN";

  const webhook = capture.webhook;
  if (webhook === null) return "UNKNOWN";
  if (
    webhook.sourceKind === REAL_RAZORPAY_WEBHOOK &&
    webhook.signatureVerified === true &&
    webhook.eventType === EVENT_PAYMENT_CAPTURED
  ) {
    return "AUTHORITATIVE";
  }
  return "UNKNOWN";
}

/**
 * Does a verified provider `payment.captured` webhook demonstrably EXIST?
 *
 * This is a weaker, purely factual question than `captureAuthority`. A capture
 * whose internal correlation is incomplete still proves the provider event
 * happened, which is all `PAYMENT_CAPTURED_VIA_WEBHOOK` claims. It is
 * deliberately NOT reused for merchant-state authority.
 */
function verifiedCaptureWebhookExists(pack: DiagnosisEvidencePackV1): boolean {
  const capture = pack.capture;
  if (
    capture !== null &&
    (capture.resolution === "EXACTLY_ONE" ||
      capture.resolution === "INCOMPLETE_INTERNAL_CORRELATION") &&
    capture.webhook !== null &&
    capture.webhook.sourceKind === REAL_RAZORPAY_WEBHOOK &&
    capture.webhook.signatureVerified === true &&
    capture.webhook.eventType === EVENT_PAYMENT_CAPTURED
  ) {
    return true;
  }
  return hasVerifiedSourceEvent(pack, EVENT_PAYMENT_CAPTURED);
}

/** Verified real provider evidence of the given event type on the source. */
function hasVerifiedSourceEvent(
  pack: DiagnosisEvidencePackV1,
  eventType: string,
): boolean {
  const provenance = pack.provenance;
  if (provenance === null) return false;
  return (
    provenance.sourceKind === REAL_RAZORPAY_WEBHOOK &&
    provenance.signatureVerified === true &&
    provenance.eventType === eventType
  );
}

// ============================================================================
// SNAPSHOT ACCESS
// ============================================================================

interface ComparablePair {
  readonly attempt: EvidencePackProcessingAttempt;
  readonly before: MerchantStateSnapshotV1;
  readonly after: MerchantStateSnapshotV1;
}

function comparablePairs(
  pack: DiagnosisEvidencePackV1,
): readonly ComparablePair[] {
  const pairs: ComparablePair[] = [];
  for (const attempt of pack.processing) {
    if (attempt.stateBefore.kind !== "CAPTURED") continue;
    if (attempt.stateAfter.kind !== "CAPTURED") continue;
    pairs.push({
      attempt,
      before: attempt.stateBefore.snapshot,
      after: attempt.stateAfter.snapshot,
    });
  }
  return pairs;
}

/** Every genuinely captured snapshot, either side, in deterministic order. */
function capturedSnapshots(
  pack: DiagnosisEvidencePackV1,
): readonly MerchantStateSnapshotV1[] {
  const snapshots: MerchantStateSnapshotV1[] = [];
  for (const attempt of pack.processing) {
    if (attempt.stateBefore.kind === "CAPTURED") {
      snapshots.push(attempt.stateBefore.snapshot);
    }
    if (attempt.stateAfter.kind === "CAPTURED") {
      snapshots.push(attempt.stateAfter.snapshot);
    }
  }
  return snapshots;
}

/** Only the AFTER side — the only side that can describe a resulting state. */
function capturedAfterSnapshots(
  pack: DiagnosisEvidencePackV1,
): readonly MerchantStateSnapshotV1[] {
  const snapshots: MerchantStateSnapshotV1[] = [];
  for (const attempt of pack.processing) {
    if (attempt.stateAfter.kind === "CAPTURED") {
      snapshots.push(attempt.stateAfter.snapshot);
    }
  }
  return snapshots;
}

/**
 * The resulting merchant order state, when the after-state evidence is
 * sufficient and non-contradictory.
 *
 * A MISSING CORRELATION IS NEVER A WILDCARD. A Finding that does not record
 * an `orderId` has told us less, not more: it cannot license reading an
 * arbitrary snapshot order as "the" subject order. Any signal that makes a
 * factual claim ABOUT a specific merchant order therefore requires
 * `correlations.orderId`, and a pack without one resolves to `UNKNOWN`. This
 * is the same false-finding failure mode `docs/MONEY_INVARIANTS.md`
 * Section 5.2 forbids, reached by a different route.
 *
 * There is deliberately no "latest wins" here either: no timestamp is
 * consulted, no array position is treated as authority, and `stateBefore` is
 * never a candidate for a FINAL state. Two relevant after-states that
 * disagree about the protected fields resolve to `UNKNOWN` rather than one of
 * them being arbitrarily preferred.
 */
type ResolvedOrderState =
  | { readonly kind: "RESOLVED"; readonly order: MerchantStateSnapshotOrderV1 }
  | { readonly kind: "UNKNOWN" };

function resolveFinalOrderState(
  pack: DiagnosisEvidencePackV1,
): ResolvedOrderState {
  const correlatedOrderId = pack.correlations.orderId;
  if (correlatedOrderId === null) return { kind: "UNKNOWN" };

  const candidates: MerchantStateSnapshotOrderV1[] = [];
  for (const snapshot of capturedAfterSnapshots(pack)) {
    const order = snapshot.order;
    if (order === null) continue;
    // Exact subject identity only. No fallback order is ever selected.
    if (order.id !== correlatedOrderId) continue;
    candidates.push(order);
  }

  const first = candidates[0];
  if (first === undefined) return { kind: "UNKNOWN" };

  for (const candidate of candidates) {
    if (
      candidate.paymentStatus !== first.paymentStatus ||
      candidate.businessStatus !== first.businessStatus
    ) {
      return { kind: "UNKNOWN" };
    }
  }
  return { kind: "RESOLVED", order: first };
}

// ============================================================================
// FULFILMENT OBSERVATION
// ============================================================================

/**
 * The relevant `FULFIL_ORDER` rows in one snapshot, or `null` when the
 * collection was not captured at all.
 *
 * A `null` collection means "the owning order was not resolved", which is a
 * different fact from an empty array and must never be read as "zero".
 */
function relevantFulfilments(
  snapshot: MerchantStateSnapshotV1,
  pack: DiagnosisEvidencePackV1,
): readonly MerchantStateSnapshotFulfilmentV1[] | null {
  if (snapshot.fulfilments === null) return null;
  const { orderId, paymentId } = pack.correlations;
  return snapshot.fulfilments.filter((row) => {
    if (row.effectType !== FULFIL_ORDER) return false;
    if (orderId !== null && row.orderId !== orderId) return false;
    if (paymentId !== null && row.paymentId !== paymentId) return false;
    return true;
  });
}

/**
 * What the pack can say about the protected business-effect count.
 *
 * TWO DIFFERENT QUESTIONS, TWO DIFFERENT SIDES.
 *
 * A duplicate that already exists is a directly observable fact, and a
 * trustworthy complete collection on EITHER side demonstrates it: if the
 * before-state already held two relevant effects, the duplicate is real
 * whatever happened next.
 *
 * Proving the opposite is strictly harder. "At most one effect remains" is a
 * claim about a RESULTING state, so only a usable `stateAfter` can support
 * it. A `stateBefore` showing one effect says nothing about what the attempt
 * then did, and an attempt whose after-state is `NOT_CAPTURED`, `INVALID`, or
 * captured with a `null` fulfilment collection leaves its own outcome
 * unestablished. `ABSENT` therefore requires a usable after-state for EVERY
 * relevant processing attempt.
 *
 * EVERY duplicate observation is retained, never just the first. Which
 * snapshot happens to appear first in `pack.processing` is an artefact of
 * assembly order, and letting it decide a signal would hide stronger evidence
 * sitting in a later observation.
 */
interface FulfilmentObservations {
  /**
   * Every trustworthy complete collection that independently proves two or
   * more relevant `FULFIL_ORDER` effects, in deterministic pack order.
   */
  readonly duplicateObservations: readonly (readonly MerchantStateSnapshotFulfilmentV1[])[];
  /** At least one attempt has a usable, complete AFTER-state count. */
  readonly afterComplete: boolean;
  /** Some attempt has no usable AFTER-state count at all. */
  readonly afterIncomplete: boolean;
}

function observeFulfilments(
  pack: DiagnosisEvidencePackV1,
): FulfilmentObservations {
  const duplicateObservations: (readonly MerchantStateSnapshotFulfilmentV1[])[] =
    [];
  let afterComplete = false;
  let afterIncomplete = false;

  for (const attempt of pack.processing) {
    // Direct observation of an existing duplicate — either side will do.
    for (const side of [attempt.stateBefore, attempt.stateAfter]) {
      if (side.kind !== "CAPTURED") continue;
      const rows = relevantFulfilments(side.snapshot, pack);
      if (rows === null) continue;
      if (rows.length >= 2) duplicateObservations.push(rows);
    }

    // Only the after-state can establish the count this attempt LEFT behind.
    const after = attempt.stateAfter;
    const afterRows =
      after.kind === "CAPTURED"
        ? relevantFulfilments(after.snapshot, pack)
        : null;
    if (afterRows === null) afterIncomplete = true;
    else afterComplete = true;
  }

  return { duplicateObservations, afterComplete, afterIncomplete };
}

// ============================================================================
// MONEY
// ============================================================================

/**
 * One complete, relationally-consistent merchant money path found inside a
 * SINGLE captured snapshot.
 *
 * All three entities must be present, must join to each other, and must match
 * whichever pack correlations are non-null. Two observations of the same order
 * are not a comparison, and an order plus a provider amount with no attempt or
 * payment is not a complete path — neither may ever produce `ABSENT`.
 */
interface MoneyPath {
  readonly order: MerchantStateSnapshotOrderV1;
  readonly paymentAttempt: MerchantStateSnapshotPaymentAttemptV1;
  readonly payment: MerchantStateSnapshotPaymentV1;
}

function completeMoneyPaths(
  pack: DiagnosisEvidencePackV1,
): readonly MoneyPath[] {
  const paths: MoneyPath[] = [];
  const { orderId, paymentAttemptId, paymentId } = pack.correlations;

  for (const snapshot of capturedSnapshots(pack)) {
    const { order, paymentAttempt, payment } = snapshot;
    if (order === null || paymentAttempt === null || payment === null) continue;
    if (payment.paymentAttemptId !== paymentAttempt.id) continue;
    if (paymentAttempt.orderId !== order.id) continue;
    if (orderId !== null && order.id !== orderId) continue;
    if (paymentAttemptId !== null && paymentAttempt.id !== paymentAttemptId) {
      continue;
    }
    if (paymentId !== null && payment.id !== paymentId) continue;
    paths.push({ order, paymentAttempt, payment });
  }
  return paths;
}

/**
 * Compares one money dimension across every complete merchant path, then
 * against the trusted provider value when one is available.
 *
 * Exact equality only — integers for amounts, exact strings for currency. No
 * parsing, no tolerance, no guessed default.
 */
function compareMoneyDimension<T extends string | number>(
  pack: DiagnosisEvidencePackV1,
  fromPath: (path: MoneyPath) => readonly T[],
  providerValue: T | null,
  providerFieldPresent: boolean,
): DiagnosticSignalState {
  const paths = completeMoneyPaths(pack);
  if (paths.length === 0) return "UNKNOWN";

  let merchantAgreedValue: T | null = null;
  for (const path of paths) {
    const values = fromPath(path);
    const first = values[0];
    if (first === undefined) return "UNKNOWN";
    for (const value of values) {
      // A proven mismatch dominates every later uncertainty.
      if (value !== first) return "PRESENT";
    }
    if (merchantAgreedValue === null) {
      merchantAgreedValue = first;
    } else if (merchantAgreedValue !== first) {
      return "PRESENT";
    }
  }
  if (merchantAgreedValue === null) return "UNKNOWN";

  if (!providerFieldPresent) return "ABSENT";
  // The provider projection exists but this dimension was never established,
  // so the comparison it would have contributed is unavailable.
  if (providerValue === null) return "UNKNOWN";
  return providerValue === merchantAgreedValue ? "ABSENT" : "PRESENT";
}

// ============================================================================
// REPLAY PROTECTED TUPLE
// ============================================================================

/**
 * The protected business-state tuple `docs/MONEY_INVARIANTS.md` INV-006
 * defines, expressed locally as a pure comparison.
 *
 * Restated here rather than imported from the invariant engine, for the same
 * reason the Phase 3 assembler restates its own constants: a pure module must
 * not depend on the evaluation surface, and this module keeps zero runtime
 * imports. This computes no verdict — it only reports whether the tuple is
 * identical.
 */
interface ProtectedTuple {
  readonly orderPaymentStatus: string;
  readonly orderBusinessStatus: string;
  readonly orderAmountSubunits: number;
  readonly orderCurrency: string;
  readonly paymentCapturedAt: string | null;
  readonly paymentFailedAt: string | null;
  readonly paymentRazorpayStatus: string | null;
  readonly paymentAmountSubunits: number;
  readonly paymentCurrency: string;
  readonly paymentAttemptStatus: string;
  readonly fulfilmentCount: number;
  readonly fulfilmentIds: readonly string[];
}

function protectedTuple(
  snapshot: MerchantStateSnapshotV1,
  pack: DiagnosisEvidencePackV1,
): ProtectedTuple | null {
  const { order, paymentAttempt, payment } = snapshot;
  if (order === null || paymentAttempt === null || payment === null) {
    return null;
  }
  const fulfilments = relevantFulfilments(snapshot, pack);
  if (fulfilments === null) return null;

  const ids = [...new Set(fulfilments.map((row) => row.id))].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );

  return {
    orderPaymentStatus: order.paymentStatus,
    orderBusinessStatus: order.businessStatus,
    orderAmountSubunits: order.amountSubunits,
    orderCurrency: order.currency,
    paymentCapturedAt: payment.capturedAt,
    paymentFailedAt: payment.failedAt,
    paymentRazorpayStatus: payment.razorpayPaymentStatus,
    paymentAmountSubunits: payment.amountSubunits,
    paymentCurrency: payment.currency,
    paymentAttemptStatus: paymentAttempt.status,
    fulfilmentCount: fulfilments.length,
    fulfilmentIds: ids,
  };
}

function sameProtectedTuple(a: ProtectedTuple, b: ProtectedTuple): boolean {
  return (
    a.orderPaymentStatus === b.orderPaymentStatus &&
    a.orderBusinessStatus === b.orderBusinessStatus &&
    a.orderAmountSubunits === b.orderAmountSubunits &&
    a.orderCurrency === b.orderCurrency &&
    a.paymentCapturedAt === b.paymentCapturedAt &&
    a.paymentFailedAt === b.paymentFailedAt &&
    a.paymentRazorpayStatus === b.paymentRazorpayStatus &&
    a.paymentAmountSubunits === b.paymentAmountSubunits &&
    a.paymentCurrency === b.paymentCurrency &&
    a.paymentAttemptStatus === b.paymentAttemptStatus &&
    a.fulfilmentCount === b.fulfilmentCount &&
    a.fulfilmentIds.length === b.fulfilmentIds.length &&
    a.fulfilmentIds.every((id, index) => id === b.fulfilmentIds[index])
  );
}

// ============================================================================
// SIGNAL RULES
// ============================================================================

function duplicateEventAttempts(
  pack: DiagnosisEvidencePackV1,
): DiagnosticSignalState {
  const counts = pack.counts;
  if (counts === null) return "UNKNOWN";
  const total = counts.originalAttemptCount + counts.chaosAttemptCount;
  // More than one attempt proves repeated PROCESSING. It says nothing about
  // whether a business effect was repeated — that is a separate signal.
  return total > 1 ? "PRESENT" : "ABSENT";
}

function duplicateFulfilments(
  pack: DiagnosisEvidencePackV1,
): DiagnosticSignalState {
  const observed = observeFulfilments(pack);
  // A directly observed duplicate dominates missing evidence elsewhere.
  if (observed.duplicateObservations.length > 0) return "PRESENT";
  // The reverse never holds: one convenient after-state cannot speak for a
  // processing path whose own outcome was never captured.
  if (observed.afterIncomplete) return "UNKNOWN";
  if (!observed.afterComplete) return "UNKNOWN";
  return "ABSENT";
}

function differentFulfilmentIdempotencyKeys(
  pack: DiagnosisEvidencePackV1,
): DiagnosticSignalState {
  const observed = observeFulfilments(pack);
  let sameKeyProof = false;
  let keyUnavailable = false;

  // EVERY duplicate observation is examined. A later observation carrying
  // two distinct keys is the stronger evidence and must not be hidden by an
  // earlier one that happened to carry matching keys.
  for (const rows of observed.duplicateObservations) {
    const keys: string[] = [];
    let keysComplete = true;
    for (const row of rows) {
      const key = row.idempotencyKey;
      // A snapshot captured before this field was projected carries no key.
      // It is never reconstructed, so this observation cannot be compared.
      if (typeof key !== "string") {
        keysComplete = false;
        break;
      }
      keys.push(key);
    }
    if (!keysComplete) {
      keyUnavailable = true;
      continue;
    }
    if (new Set(keys).size > 1) return "PRESENT";
    sameKeyProof = true;
  }

  if (observed.duplicateObservations.length === 0) return "UNKNOWN";
  if (keyUnavailable) return "UNKNOWN";
  if (observed.afterIncomplete) return "UNKNOWN";
  if (!sameKeyProof) return "UNKNOWN";
  return "ABSENT";
}

function sameLogicalPayment(
  pack: DiagnosisEvidencePackV1,
): DiagnosticSignalState {
  // This signal claims the duplicated effects sit on ONE specific order and
  // payment path. Without the subject order identity the relevant rows were
  // never narrowed to this Finding's subject at all, so a single observed
  // order id would be an artefact of an unfiltered collection rather than
  // proof about the subject.
  if (pack.correlations.orderId === null) return "UNKNOWN";

  const observed = observeFulfilments(pack);
  for (const rows of observed.duplicateObservations) {
    const orderIds = new Set(rows.map((row) => row.orderId));
    const paymentIds = new Set(rows.map((row) => row.paymentId));
    // A direct proof dominates unrelated incompleteness.
    if (orderIds.size === 1 && paymentIds.size === 1) return "PRESENT";
  }

  if (observed.duplicateObservations.length === 0) return "UNKNOWN";
  if (observed.afterIncomplete) return "UNKNOWN";
  // Every duplicate observation spans more than one order/payment path.
  return "ABSENT";
}

function invalidSignatureMutatedState(
  pack: DiagnosisEvidencePackV1,
): DiagnosticSignalState {
  const evidence = pack.scenarioEvidence;
  if (evidence === null || evidence.scenarioId !== "C03") return "UNKNOWN";

  const checks = evidence.verificationChecks;
  const facts = evidence.merchantFacts;
  if (checks === null || checks.length === 0) return "UNKNOWN";
  if (facts === null || facts.before === null || facts.after === null) {
    return "UNKNOWN";
  }

  const accepted = checks.some(
    (check) => check.classification === "UNEXPECTED_ACCEPTANCE",
  );

  // Compare only collections completely captured on BOTH sides. Two truncated
  // prefixes must never be compared and called "unchanged".
  const before = facts.before;
  const after = facts.after;
  const collections = [
    [before.orders, after.orders],
    [before.paymentAttempts, after.paymentAttempts],
    [before.payments, after.payments],
    [before.fulfilments, after.fulfilments],
  ] as const;

  let comparable = false;
  let mutated = false;
  for (const [lhs, rhs] of collections) {
    if (lhs === null || rhs === null) continue;
    if (!lhs.complete || !rhs.complete) continue;
    comparable = true;
    if (
      lhs.count !== rhs.count ||
      JSON.stringify(lhs.rows) !== JSON.stringify(rhs.rows)
    ) {
      mutated = true;
    }
  }

  const beforeEvents = before.trustedWebhookEvents;
  const afterEvents = after.trustedWebhookEvents;
  if (
    beforeEvents !== null &&
    afterEvents !== null &&
    beforeEvents.complete &&
    afterEvents.complete
  ) {
    comparable = true;
    // Both the cardinality and the exact identity set are compared: a swap
    // that preserved the count would otherwise read as "unchanged".
    const beforeIds = [...beforeEvents.ids].sort();
    const afterIds = [...afterEvents.ids].sort();
    if (
      beforeEvents.count !== afterEvents.count ||
      beforeIds.length !== afterIds.length ||
      beforeIds.some((id, index) => id !== afterIds[index])
    ) {
      mutated = true;
    }
  }

  if (!comparable) return "UNKNOWN";
  if (accepted && mutated) return "PRESENT";
  if (!accepted && !mutated) return "ABSENT";
  // Rejected but mutated, or accepted with no mutation: neither the pattern
  // nor its absence is established from this evidence alone.
  return "UNKNOWN";
}

function clientConfirmationMissing(
  pack: DiagnosisEvidencePackV1,
): DiagnosticSignalState {
  const evidence = pack.scenarioEvidence;
  if (evidence === null || evidence.scenarioId !== "C07") return "UNKNOWN";
  if (evidence.faultArmed === null || evidence.faultConsumed === null) {
    return "UNKNOWN";
  }
  if (evidence.faultArmed && evidence.faultConsumed) return "PRESENT";
  return "ABSENT";
}

function paymentCapturedViaWebhook(
  pack: DiagnosisEvidencePackV1,
): DiagnosticSignalState {
  // This signal asks only whether the provider event demonstrably exists, so
  // an incomplete internal correlation still counts. A replay is processing
  // activity and can never satisfy it.
  if (verifiedCaptureWebhookExists(pack)) return "PRESENT";
  if (captureAuthority(pack) === "COMPLETE_NEGATIVE") return "ABSENT";
  return "UNKNOWN";
}

function captureExistsOrderNotPaid(
  pack: DiagnosisEvidencePackV1,
): DiagnosticSignalState {
  // Merchant-state authority, not mere existence: a capture that cannot be
  // tied to this subject cannot say anything about this order.
  if (captureAuthority(pack) !== "AUTHORITATIVE") return "UNKNOWN";
  const resolved = resolveFinalOrderState(pack);
  // A missing order snapshot is not an unpaid order.
  if (resolved.kind !== "RESOLVED") return "UNKNOWN";
  return resolved.order.paymentStatus !== PAID ? "PRESENT" : "ABSENT";
}

function failureEventMarkedPaid(
  pack: DiagnosisEvidencePackV1,
): DiagnosticSignalState {
  if (!hasVerifiedSourceEvent(pack, EVENT_PAYMENT_FAILED)) return "UNKNOWN";

  const resolved = resolveFinalOrderState(pack);
  if (resolved.kind !== "RESOLVED") return "UNKNOWN";
  if (resolved.order.paymentStatus !== PAID) return "ABSENT";

  const authority = captureAuthority(pack);
  // A later legitimate capture explains PAID; this is not a failure event
  // being mistaken for success.
  if (authority === "AUTHORITATIVE") return "ABSENT";
  // Only a complete negative can prove nothing legitimises PAID.
  if (authority === "COMPLETE_NEGATIVE") return "PRESENT";
  return "UNKNOWN";
}

/**
 * Was a protected state transition observed running backwards?
 *
 * EVERY processing attempt is examined, not only those that happen to carry a
 * complete pair. An attempt whose transition was never observed —
 * `NOT_CAPTURED` or `INVALID` on either side, or two captured snapshots that
 * share no comparable protected subject — has an UNKNOWN transition, and a
 * different attempt's clean pair cannot speak for it. Silently dropping such
 * an attempt and then reporting `ABSENT` from a convenient neighbour is
 * exactly the "missing evidence became a negative" failure this contract
 * forbids.
 *
 * A protected subject is whichever of the two is genuinely comparable across
 * the pair — the SAME order, the SAME payment attempt, or both. Only one is
 * required, so a snapshot pair carrying just an order is still sufficient
 * transition evidence, but a subject is never borrowed from another attempt.
 *
 * As everywhere else, a proven regression dominates incompleteness; the
 * reverse never holds. No timestamp, no array position, no last-state-wins.
 */
function outOfOrderStateRegression(
  pack: DiagnosisEvidencePackV1,
): DiagnosticSignalState {
  let regressed = false;
  let anyComparable = false;
  let anyIncomplete = false;

  for (const attempt of pack.processing) {
    const before = attempt.stateBefore;
    const after = attempt.stateAfter;
    if (before.kind !== "CAPTURED" || after.kind !== "CAPTURED") {
      // This attempt's transition was never observed at all.
      anyIncomplete = true;
      continue;
    }

    let subjectComparable = false;

    const beforeOrder = before.snapshot.order;
    const afterOrder = after.snapshot.order;
    if (
      beforeOrder !== null &&
      afterOrder !== null &&
      beforeOrder.id === afterOrder.id
    ) {
      subjectComparable = true;
      if (
        beforeOrder.paymentStatus === PAID &&
        ORDER_STATES_WEAKER_THAN_PAID.includes(afterOrder.paymentStatus)
      ) {
        regressed = true;
      }
      if (
        beforeOrder.businessStatus === FULFILLED &&
        afterOrder.businessStatus === OPEN
      ) {
        regressed = true;
      }
    }

    const beforeAttempt = before.snapshot.paymentAttempt;
    const afterAttempt = after.snapshot.paymentAttempt;
    if (
      beforeAttempt !== null &&
      afterAttempt !== null &&
      beforeAttempt.id === afterAttempt.id
    ) {
      if (
        !isKnownAttemptStatus(beforeAttempt.status) ||
        !isKnownAttemptStatus(afterAttempt.status)
      ) {
        // An observed applicable transition that cannot be classified leaves
        // this attempt unresolved even if its order side was comparable.
        anyIncomplete = true;
      } else {
        subjectComparable = true;
        if (
          beforeAttempt.status === ATTEMPT_CAPTURED &&
          ATTEMPT_STATES_WEAKER_THAN_CAPTURED.includes(afterAttempt.status)
        ) {
          regressed = true;
        }
      }
    }

    // Two captured snapshots are not automatically transition evidence: with
    // no shared protected subject there is nothing to compare.
    if (subjectComparable) anyComparable = true;
    else anyIncomplete = true;
  }

  if (regressed) return "PRESENT";
  if (anyIncomplete) return "UNKNOWN";
  if (!anyComparable) return "UNKNOWN";
  return "ABSENT";
}

function replayChangedFinalState(
  pack: DiagnosisEvidencePackV1,
): DiagnosticSignalState {
  let anyComplete = false;
  let anyIncomplete = false;
  let changed = false;

  for (const pair of comparablePairs(pack)) {
    if (pair.attempt.sourceKind !== PAYCHAOS_REPLAY) continue;

    const before = protectedTuple(pair.before, pack);
    const after = protectedTuple(pair.after, pack);
    if (before === null || after === null) {
      anyIncomplete = true;
      continue;
    }
    anyComplete = true;
    if (!sameProtectedTuple(before, after)) changed = true;
  }

  // Also treat a replay attempt with no comparable pair at all as incomplete.
  for (const attempt of pack.processing) {
    if (attempt.sourceKind !== PAYCHAOS_REPLAY) continue;
    if (
      attempt.stateBefore.kind !== "CAPTURED" ||
      attempt.stateAfter.kind !== "CAPTURED"
    ) {
      anyIncomplete = true;
    }
  }

  // A proven protected-state change dominates incompleteness elsewhere.
  if (changed) return "PRESENT";
  if (anyIncomplete) return "UNKNOWN";
  if (!anyComplete) return "UNKNOWN";
  return "ABSENT";
}

function amountMismatch(pack: DiagnosisEvidencePackV1): DiagnosticSignalState {
  return compareMoneyDimension<number>(
    pack,
    (path) => [
      path.order.amountSubunits,
      path.paymentAttempt.amountSubunits,
      path.payment.amountSubunits,
    ],
    pack.money === null ? null : pack.money.amountSubunits,
    pack.money !== null,
  );
}

function currencyMismatch(
  pack: DiagnosisEvidencePackV1,
): DiagnosticSignalState {
  return compareMoneyDimension<string>(
    pack,
    (path) => [
      path.order.currency,
      path.paymentAttempt.currency,
      path.payment.currency,
    ],
    pack.money === null ? null : pack.money.currency,
    pack.money !== null,
  );
}

const RULES: Readonly<
  Record<
    DiagnosticSignalCode,
    (pack: DiagnosisEvidencePackV1) => DiagnosticSignalState
  >
> = Object.freeze({
  DUPLICATE_EVENT_ATTEMPTS: duplicateEventAttempts,
  DUPLICATE_FULFILMENTS: duplicateFulfilments,
  DIFFERENT_FULFILMENT_IDEMPOTENCY_KEYS: differentFulfilmentIdempotencyKeys,
  SAME_LOGICAL_PAYMENT: sameLogicalPayment,
  INVALID_SIGNATURE_MUTATED_STATE: invalidSignatureMutatedState,
  CLIENT_CONFIRMATION_MISSING: clientConfirmationMissing,
  PAYMENT_CAPTURED_VIA_WEBHOOK: paymentCapturedViaWebhook,
  CAPTURE_EXISTS_ORDER_NOT_PAID: captureExistsOrderNotPaid,
  FAILURE_EVENT_MARKED_PAID: failureEventMarkedPaid,
  OUT_OF_ORDER_STATE_REGRESSION: outOfOrderStateRegression,
  REPLAY_CHANGED_FINAL_STATE: replayChangedFinalState,
  AMOUNT_MISMATCH: amountMismatch,
  CURRENCY_MISMATCH: currencyMismatch,
});

// ============================================================================
// EXTRACTION
// ============================================================================

/**
 * Derives the deterministic signal set for one Evidence Pack.
 *
 * Pure and total: it throws nothing, reads no clock, and never mutates the
 * supplied pack. Signals are emitted in the frozen vocabulary order, so the
 * same pack always produces a deep-equal set.
 */
export function extractDiagnosticSignals(
  pack: DiagnosisEvidencePackV1,
): DiagnosticSignalSetV1 {
  const packGaps = new Set<EvidencePackGapCode>(
    pack.gaps.map((gap) => gap.code),
  );

  const signals: DiagnosticSignalObservationV1[] = SIGNAL_CODES.map((code) => {
    const state = RULES[code](pack);
    // Gap metadata is reported only for an unestablished signal, and only for
    // gaps that this signal's own evidence depends on.
    const blockingGapCodes =
      state === "UNKNOWN"
        ? RELEVANT_GAPS[code].filter((gap) => packGaps.has(gap))
        : [];
    return { code, state, blockingGapCodes };
  });

  return {
    version: DIAGNOSTIC_SIGNAL_VERSION,
    findingId: pack.finding.findingId,
    invariantResultId: pack.finding.invariantResultId,
    signals,
  };
}
