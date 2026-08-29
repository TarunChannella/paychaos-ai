import type {
  ChaosRunEvidenceBundleV1,
  ProcessingAttemptEvidence,
  SafeWebhookEvidence,
} from "@/lib/evidence/chaos-run-evidence";
import type {
  MerchantStateSnapshotFulfilmentV1,
  MerchantStateSnapshotV1,
} from "@/lib/evidence/merchant-state-snapshot";

import { getInvariantDefinition } from "./registry";
import type {
  InvariantEvaluationEnvelope,
  InvariantEvidenceRef,
  MoneyInvariantId,
} from "./types";
import {
  allProcessingAttemptIds,
  collectCapturedSnapshots,
  collectMerchantPaths,
  collectSnapshotPairs,
  compareC03MutationSnapshots,
  correlationsFrom,
  countFulfilOrderForOrder,
  countFulfilOrderForPayment,
  evaluateOrderBusinessStatusTransition,
  evaluateOrderPaymentStatusTransition,
  evaluatePaymentAttemptStatusTransition,
  EVENT_TYPE_PAYMENT_FAILED,
  fulfilOrderRows,
  isPaymentCorrelatedToOrderPath,
  isSuccessfulProcessing,
  isSupportedBusinessEventType,
  isTrustedProviderEvent,
  nonPersistableEvaluation,
  ORDER_BUSINESS_STATUS_FULFILLED,
  ORDER_PAYMENT_STATUS_PAID,
  persistableEvaluation,
  PROCESSING_ATTEMPT_STATUS_FAILED,
  protectedBusinessState,
  protectedBusinessStateEquals,
  captureProcessingAttempts,
  isSnapshotComplete,
  missingRequiredEntities,
  refIf,
  repeatedTriggerEvidence,
  requiredEntitiesFromRun,
  resolveDistinctChains,
  validateAuthoritativeCaptureForPayment,
  validateFulfilmentRelation,
  validateMerchantMoneyConsistency,
  validateTrustedWebhookMoneyForPayment,
  type MerchantPath,
  type PathVerdict,
  type RequiredEntities,
  type SnapshotPair,
} from "./evaluator-utils";

/**
 * Phase 3F-B — the twelve pure deterministic Money Invariant evaluators
 * (INV-001…INV-012).
 *
 * PURE. Every evaluator is a total function of one immutable
 * `ChaosRunEvidenceBundleV1`. No Supabase, no `.from(`, no Razorpay, no
 * `fetch`, no filesystem, no `process.env`, no clock, no randomness, no LLM.
 * Given the same bundle these return byte-identical dispositions, severities,
 * summaries, reasons and evidence references, whatever order the bundle's
 * arrays happen to be in.
 *
 * NO PERSISTENCE. Nothing here names the invariant-result table or performs
 * any INSERT/UPDATE/UPSERT/DELETE. Building a result is not storing one —
 * persistence, orchestration and the repository are Phase 3F-C.
 *
 * DISPOSITION DISCIPLINE (docs/MONEY_INVARIANTS.md §32/§36/§37/§38):
 *
 *   PASS            the applicable condition is PROVEN satisfied
 *   FAIL            the applicable violation is PROVEN
 *   UNKNOWN         the rule applies but required evidence is missing,
 *                   invalid, incomplete or ambiguous
 *   NOT_APPLICABLE  the rule's precondition does not hold
 *
 * Missing evidence NEVER becomes `PASS`. `NOT_APPLICABLE` is never laundered
 * into `UNKNOWN` (or the reverse). A scenario ID alone never establishes
 * applicability and never produces `FAIL`.
 *
 * TRUSTED EVIDENCE ONLY. Where the source-of-truth requires verified provider
 * evidence, an unverified or replayed webhook can never yield an authoritative
 * `PASS` — it yields `UNKNOWN`.
 *
 * GAPS ARE NOT A BLANKET UNKNOWN. The bundle's factual gap list is
 * deliberately never consulted as "any gap -> UNKNOWN". Each evaluator checks
 * only the evidence ITS rule requires, so a missing historical `state_before`
 * can force INV-006 or INV-011 to `UNKNOWN` without poisoning a relational
 * rule that remains fully provable from independent complete evidence.
 *
 * EVIDENCE REFERENCES are per-invariant: each result names only the records
 * that rule actually used. A correlation is never attached merely because the
 * run happens to carry it. The chaos run itself is always referenced — it is
 * the record the evaluation is about, and for C03 it is the record the
 * mutation evidence physically lives on.
 *
 * HISTORICAL TRUTH. A `NOT_CAPTURED` snapshot is factual evidence absence.
 * These evaluators never reconstruct it from present-day rows and never
 * fabricate a webhook, a processing attempt or a merchant state.
 */

// ============================================================================
// SHARED SCAFFOLDING
// ============================================================================

/**
 * The canonical `webhook_events.processing_status` default.
 *
 * The Phase 2F transaction writes `PROCESSED` only alongside a SUCCEEDED
 * attempt and a committed merchant mutation; nothing in the codebase ever
 * writes `PROCESSING` or `FAILED`. `RECEIVED` after a failed attempt is
 * therefore positive evidence that the transaction rolled back.
 */
const WEBHOOK_PROCESSING_STATUS_RECEIVED = "RECEIVED";

function versionOf(invariantId: MoneyInvariantId): string {
  return getInvariantDefinition(invariantId)?.version ?? "1";
}

function severityOf(invariantId: MoneyInvariantId) {
  return getInvariantDefinition(invariantId)?.defaultSeverity ?? "CRITICAL";
}

/** The one reference every result carries — the run the evaluation is about. */
function runRef(
  bundle: ChaosRunEvidenceBundleV1,
): readonly InvariantEvidenceRef[] {
  return [{ kind: "CHAOS_RUN", id: bundle.run.id }];
}

function pass(
  bundle: ChaosRunEvidenceBundleV1,
  invariantId: MoneyInvariantId,
  expectedSummary: string,
  observedSummary: string,
  reason: string,
  refs: readonly InvariantEvidenceRef[] = [],
): InvariantEvaluationEnvelope {
  return persistableEvaluation({
    invariantId,
    invariantVersion: versionOf(invariantId),
    disposition: "PASS",
    severity: severityOf(invariantId),
    correlations: correlationsFrom(bundle),
    expectedSummary,
    observedSummary,
    reason,
    evidenceRefs: [...runRef(bundle), ...refs],
  });
}

function fail(
  bundle: ChaosRunEvidenceBundleV1,
  invariantId: MoneyInvariantId,
  expectedSummary: string,
  observedSummary: string,
  reason: string,
  refs: readonly InvariantEvidenceRef[] = [],
): InvariantEvaluationEnvelope {
  return persistableEvaluation({
    invariantId,
    invariantVersion: versionOf(invariantId),
    disposition: "FAIL",
    severity: severityOf(invariantId),
    correlations: correlationsFrom(bundle),
    expectedSummary,
    observedSummary,
    reason,
    evidenceRefs: [...runRef(bundle), ...refs],
  });
}

function unknown(
  bundle: ChaosRunEvidenceBundleV1,
  invariantId: MoneyInvariantId,
  expectedSummary: string,
  observedSummary: string,
  reason: string,
  refs: readonly InvariantEvidenceRef[] = [],
): InvariantEvaluationEnvelope {
  return persistableEvaluation({
    invariantId,
    invariantVersion: versionOf(invariantId),
    disposition: "UNKNOWN",
    severity: severityOf(invariantId),
    correlations: correlationsFrom(bundle),
    expectedSummary,
    observedSummary,
    reason,
    evidenceRefs: [...runRef(bundle), ...refs],
  });
}

function notApplicable(
  bundle: ChaosRunEvidenceBundleV1,
  invariantId: MoneyInvariantId,
  reason: string,
  refs: readonly InvariantEvidenceRef[] = [],
): InvariantEvaluationEnvelope {
  return nonPersistableEvaluation({
    invariantId,
    invariantVersion: versionOf(invariantId),
    disposition: "NOT_APPLICABLE",
    correlations: correlationsFrom(bundle),
    reason,
    evidenceRefs: [...runRef(bundle), ...refs],
  });
}

/** Snapshots whose fulfilment collection was actually captured. */
function snapshotsWithFulfilments(
  bundle: ChaosRunEvidenceBundleV1,
): readonly MerchantStateSnapshotV1[] {
  return collectCapturedSnapshots(bundle).filter(
    (s) => fulfilOrderRows(s) !== null,
  );
}

/** Every distinct `FULFIL_ORDER` row observed across all captured snapshots, sorted by id. */
function observedFulfilments(
  bundle: ChaosRunEvidenceBundleV1,
): readonly MerchantStateSnapshotFulfilmentV1[] {
  const byId = new Map<string, MerchantStateSnapshotFulfilmentV1>();
  for (const snapshot of snapshotsWithFulfilments(bundle)) {
    for (const row of fulfilOrderRows(snapshot)!) byId.set(row.id, row);
  }
  return [...byId.values()].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
}

function fulfilmentRefsOf(
  rows: readonly MerchantStateSnapshotFulfilmentV1[],
): readonly InvariantEvidenceRef[] {
  return rows.map((f) => ({ kind: "FULFILMENT" as const, id: f.id }));
}

function attemptRefs(
  bundle: ChaosRunEvidenceBundleV1,
): readonly InvariantEvidenceRef[] {
  return allProcessingAttemptIds(bundle).map((id) => ({
    kind: "EVENT_PROCESSING_ATTEMPT" as const,
    id,
  }));
}

function webhookRef(
  webhook: SafeWebhookEvidence | null,
): readonly InvariantEvidenceRef[] {
  return webhook ? [{ kind: "WEBHOOK_EVENT", id: webhook.id }] : [];
}

/** The order/attempt/payment references a relational rule actually consulted. */
function pathRefs(path: MerchantPath): readonly InvariantEvidenceRef[] {
  return [
    { kind: "ORDER", id: path.order.id },
    { kind: "PAYMENT_ATTEMPT", id: path.paymentAttempt.id },
    { kind: "PAYMENT", id: path.payment.id },
  ];
}

function allAttempts(
  bundle: ChaosRunEvidenceBundleV1,
): readonly ProcessingAttemptEvidence[] {
  return [
    ...bundle.originalProcessingAttempts,
    ...bundle.chaosProcessingAttempts,
  ];
}

/**
 * The required-entity set for a protected-effect rule on THIS run.
 *
 * `{ kind: "CAPTURED" }` only means the JSON parsed — a nested `order`,
 * `payment` or `fulfilments` may still be `null`. Comparing two absent nested
 * values and finding them equal is NOT proof of "unchanged", so every rule
 * that claims zero/unchanged effect first checks that the entities it needs
 * were actually resolved.
 */
function requiredFor(
  bundle: ChaosRunEvidenceBundleV1,
  fulfilments: boolean,
): RequiredEntities {
  return requiredEntitiesFromRun(bundle, { fulfilments });
}

/** The pairs that are missing a side, or whose captured sides omit a required entity. */
function incompletePairs(
  pairs: readonly SnapshotPair[],
  required: RequiredEntities,
): readonly SnapshotPair[] {
  return pairs.filter(
    (p) =>
      p.before === null ||
      p.after === null ||
      !isSnapshotComplete(p.before, required) ||
      !isSnapshotComplete(p.after, required),
  );
}

/** A deterministic, sorted description of what a pair set is missing. */
function missingSummary(
  pairs: readonly SnapshotPair[],
  required: RequiredEntities,
): string {
  const missing = new Set<string>();
  for (const pair of pairs) {
    if (pair.before === null) missing.add("state_before");
    else
      for (const m of missingRequiredEntities(pair.before, required))
        missing.add(m);
    if (pair.after === null) missing.add("state_after");
    else
      for (const m of missingRequiredEntities(pair.after, required))
        missing.add(m);
  }
  return [...missing].sort().join(", ");
}

/**
 * Does THIS transition satisfy both conditions docs/MONEY_INVARIANTS.md §12
 * requires before `OPEN -> FULFILLED` is legal:
 *
 *   1. authoritative successful payment evidence exists;
 *   2. a valid fulfilment row IS BEING COMMITTED.
 *
 * Condition 2 is about THIS transition, not merely about the after-state
 * (architect blocker NARROW-04). A fulfilment that already existed BEFORE the
 * transition was committed by something else and cannot authorise this one.
 * "Newly committed by this attempt" is proven from persisted IDs only:
 *
 *   - the row appears in `after.fulfilments` and not in `before.fulfilments`;
 *   - its `triggerProcessingAttemptId` equals THIS pair's `attemptId`.
 *
 * No `appliedAt` timestamp is read and no ordering is inferred.
 */
function openToFulfilledAuthority(
  bundle: ChaosRunEvidenceBundleV1,
  pair: SnapshotPair,
): PathVerdict {
  const before = pair.before;
  const after = pair.after;
  if (before === null || after === null) {
    return {
      kind: "INDETERMINATE",
      detail: "the transition has no complete before/after snapshot pair",
    };
  }
  const beforeRows = fulfilOrderRows(before);
  const afterRows = fulfilOrderRows(after);
  if (beforeRows === null || afterRows === null) {
    return {
      kind: "INDETERMINATE",
      detail:
        "the fulfilment collection was not captured on both sides, so a newly committed row cannot be identified",
    };
  }

  const beforeIds = new Set(beforeRows.map((f) => f.id));
  const newRows = afterRows.filter((f) => !beforeIds.has(f.id));
  if (newRows.length === 0) {
    return {
      kind: "INVALID",
      detail:
        "no FULFIL_ORDER row was committed by this transition (every row already existed before it)",
    };
  }
  if (newRows.some((f) => f.triggerProcessingAttemptId === null)) {
    return {
      kind: "INDETERMINATE",
      detail:
        "a newly appearing FULFIL_ORDER row carries no trigger attribution, so it cannot be attributed to this attempt",
    };
  }

  const committedHere = newRows.filter(
    (f) => f.triggerProcessingAttemptId === pair.attemptId,
  );
  if (committedHere.length === 0) {
    return {
      kind: "INVALID",
      detail:
        "the newly appearing FULFIL_ORDER row was committed by a different processing attempt",
    };
  }

  // The committed row's relation must be valid against the AFTER state.
  if (
    after.order === null ||
    after.paymentAttempt === null ||
    after.payment === null
  ) {
    return {
      kind: "INDETERMINATE",
      detail: "the payment/attempt/order chain was not captured together",
    };
  }
  const path: MerchantPath = {
    order: after.order,
    paymentAttempt: after.paymentAttempt,
    payment: after.payment,
    fulfilments: afterRows,
  };
  for (const row of committedHere) {
    const relation = validateFulfilmentRelation(path, row);
    if (relation.kind !== "VALID") return relation;
  }

  // Condition 1 — exact capture authority for the committed row's payment.
  return validateAuthoritativeCaptureForPayment(bundle, path.payment);
}

/**
 * Does this run have a merchant/fulfilment SUBJECT at all?
 *
 * Structural, never a scenario-name check. A subject exists when the run
 * truthfully correlates to an order, a payment attempt or a payment, or when
 * any captured snapshot resolved one of those entities.
 *
 * This is the distinction blocker 3F-C-01 exposed. "No subject exists" and
 * "a subject exists but its evidence was not captured" are different facts:
 * the first makes a subject-scoped invariant INAPPLICABLE, the second makes it
 * UNPROVEN. Collapsing them turns C03 — which by construction has no order,
 * no payment attempt, no payment and no processing attempt — into a
 * permanently `UNKNOWN` fulfilment rule instead of an inapplicable one.
 */
function hasMerchantSubject(bundle: ChaosRunEvidenceBundleV1): boolean {
  if (
    bundle.run.orderId !== null ||
    bundle.run.paymentAttemptId !== null ||
    bundle.run.paymentId !== null
  ) {
    return true;
  }
  return collectCapturedSnapshots(bundle).some(
    (snapshot) =>
      snapshot.order !== null ||
      snapshot.paymentAttempt !== null ||
      snapshot.payment !== null,
  );
}

/**
 * The run's canonical source webhook when it is verified provider evidence.
 *
 * INV-001 §7 and INV-006 §7 both require it, and INV-012 needs it before an
 * authoritative "no effect" claim. An unverified signature or a
 * `PAYCHAOS_REPLAY` source is never authority.
 */
function trustedSource(
  bundle: ChaosRunEvidenceBundleV1,
): SafeWebhookEvidence | null {
  const source = bundle.sourceWebhook;
  return source !== null && isTrustedProviderEvent(source) ? source : null;
}

// ============================================================================
// INV-001 — Unique Webhook Protected Logic Once
// ============================================================================

/**
 * Preconditions (docs/MONEY_INVARIANTS.md §16 §7): event identity is known,
 * the signature is verified for real Razorpay evidence, and the event is
 * sufficiently correlated to the merchant path being evaluated. An unverified
 * or non-provider source yields `UNKNOWN` — never an authoritative `PASS`.
 *
 * The rule then counts protected `FULFIL_ORDER` effects caused by the
 * canonical event's processing attempts. Attempts are NOT effects: two
 * attempts, a replay attempt, or a retry after failure are all allowed.
 */
export function evaluateInv001(
  bundle: ChaosRunEvidenceBundleV1,
): InvariantEvaluationEnvelope {
  const id: MoneyInvariantId = "INV-001";
  const expected =
    "one canonical webhook record, and FULFIL_ORDER effects triggered by its processing attempts <= 1";

  const source = bundle.sourceWebhook;
  if (source === null) {
    return unknown(
      bundle,
      id,
      expected,
      "canonical source webhook = not resolved",
      "No canonical webhook event could be resolved for this run, so event identity is unknown and its protected effects cannot be counted.",
    );
  }
  if (!isTrustedProviderEvent(source)) {
    return unknown(
      bundle,
      id,
      expected,
      `source provenance = ${source.sourceKind}, signature verified = ${source.signatureVerified}`,
      "The canonical source is not verified provider evidence, so this invariant's precondition (verified signature for real Razorpay evidence) is not satisfied and no authoritative conclusion is drawn.",
      webhookRef(source),
    );
  }

  const refs = [...webhookRef(source), ...attemptRefs(bundle)];

  if (bundle.canonicalSourceEventCount === null) {
    return unknown(
      bundle,
      id,
      expected,
      "canonical webhook rows for the source event = not established",
      "The canonical row count for this Razorpay event id could not be established, so 'one logical event' is unproven.",
      refs,
    );
  }
  if (bundle.canonicalSourceEventCount > 1) {
    // A directly PROVEN breach of the documented canonical-uniqueness clause:
    // the same razorpay_event_id maps to more than one canonical record. The
    // count is a trusted persisted fact, so this is proof, not uncertainty.
    return fail(
      bundle,
      id,
      expected,
      `canonical webhook rows for the source event = ${bundle.canonicalSourceEventCount}`,
      "The canonical Razorpay event id maps to more than one canonical webhook record, breaching this invariant's one-canonical-record requirement.",
      refs,
    );
  }
  if (bundle.canonicalSourceEventCount < 1) {
    return unknown(
      bundle,
      id,
      expected,
      `canonical webhook rows for the source event = ${bundle.canonicalSourceEventCount}`,
      "The canonical row count contradicts the resolved source webhook, so the evidence is not internally consistent enough to decide.",
      refs,
    );
  }

  // Sufficient merchant correlation: the event must relate to the merchant
  // path whose protected effects are being counted.
  if (source.paymentId === null && source.paymentAttemptId === null) {
    return unknown(
      bundle,
      id,
      expected,
      "source webhook merchant correlation = absent",
      "The canonical event carries no internal payment or payment-attempt correlation, so its protected effects cannot be attributed to a merchant path.",
      refs,
    );
  }

  const attemptIds = new Set(allProcessingAttemptIds(bundle));
  const required = requiredFor(bundle, true);
  const pairs = collectSnapshotPairs(bundle);
  const fulfilments = observedFulfilments(bundle);

  // A PROVEN duplicate effect dominates incomplete evidence elsewhere.
  const provenDuplicate =
    fulfilments.filter(
      (f) =>
        f.triggerProcessingAttemptId !== null &&
        attemptIds.has(f.triggerProcessingAttemptId),
    ).length > 1;

  if (!provenDuplicate) {
    if (snapshotsWithFulfilments(bundle).length === 0) {
      return unknown(
        bundle,
        id,
        expected,
        "fulfilment evidence = not captured",
        "No captured snapshot carries the fulfilment collection, so the protected effects of this event cannot be counted.",
        refs,
      );
    }
    // Architect blocker FINAL-08: one relevant attempt without a usable
    // protected-effect snapshot means the count is not proven, even when
    // another attempt is complete.
    const incomplete = incompletePairs(pairs, required);
    if (incomplete.length > 0) {
      return unknown(
        bundle,
        id,
        expected,
        `relevant attempts without complete protected-effect evidence = ${incomplete.length} (missing: ${missingSummary(incomplete, required)})`,
        "At least one relevant processing attempt lacks the merchant evidence needed to count this event's protected effects, and no duplicate effect is independently proven.",
        refs,
      );
    }
  }

  const untraceable = fulfilments.filter(
    (f) => f.triggerProcessingAttemptId === null,
  );
  if (untraceable.length > 0) {
    return unknown(
      bundle,
      id,
      expected,
      `FULFIL_ORDER rows with no trigger correlation = ${untraceable.length}`,
      "A persisted FULFIL_ORDER row carries no trigger processing-attempt correlation, so it cannot be attributed to or excluded from this event.",
      [...refs, ...fulfilmentRefsOf(untraceable)],
    );
  }

  const triggered = fulfilments.filter(
    (f) =>
      f.triggerProcessingAttemptId !== null &&
      attemptIds.has(f.triggerProcessingAttemptId),
  );
  const withEffects = [...refs, ...fulfilmentRefsOf(triggered)];

  if (triggered.length > 1) {
    return fail(
      bundle,
      id,
      expected,
      `FULFIL_ORDER effects triggered by this event = ${triggered.length}`,
      "One canonical webhook event caused the protected FULFIL_ORDER effect more than once.",
      withEffects,
    );
  }
  return pass(
    bundle,
    id,
    expected,
    `canonical webhook rows = 1; FULFIL_ORDER effects triggered by this event = ${triggered.length}; processing attempts = ${attemptIds.size}`,
    "One verified canonical webhook event; its processing attempts caused the protected effect at most once.",
    withEffects,
  );
}

// ============================================================================
// INV-002 — One Captured Payment, At Most One Fulfilment
// ============================================================================

/**
 * Precondition (§17 §7): a specific Razorpay Payment is correlated to an
 * internal payment attempt/order. A bare payment id does NOT satisfy that —
 * the chain must actually resolve in captured evidence, otherwise the result
 * is `UNKNOWN` rather than a false authoritative `PASS`.
 *
 * `0` fulfilments is a PASS for this specific at-most-one rule: whether a
 * fulfilment SHOULD exist, and whether the payment authorises it, are
 * INV-004's and INV-010's concerns and are deliberately not merged in here.
 */
export function evaluateInv002(
  bundle: ChaosRunEvidenceBundleV1,
): InvariantEvaluationEnvelope {
  const id: MoneyInvariantId = "INV-002";
  const expected = "FULFIL_ORDER fulfilments per correlated payment <= 1";

  const paymentId = bundle.run.paymentId;
  if (paymentId === null) {
    return notApplicable(
      bundle,
      id,
      "No Razorpay payment is correlated to this run, so there is no payment whose fulfilment count could be evaluated.",
    );
  }

  const correlated = collectMerchantPaths(bundle).filter(
    (p) => p.payment.id === paymentId && isPaymentCorrelatedToOrderPath(p),
  );
  if (correlated.length === 0) {
    return unknown(
      bundle,
      id,
      expected,
      "payment -> payment attempt -> order correlation = not established",
      "The payment could not be resolved to an internal payment attempt and order in captured evidence, so this invariant's precondition is unproven and no authoritative count is reported.",
      [...refIf("PAYMENT", paymentId), ...attemptRefs(bundle)],
    );
  }

  const refs = [...pathRefs(correlated[0]!), ...attemptRefs(bundle)];
  if (correlated.every((p) => p.fulfilments === null)) {
    return unknown(
      bundle,
      id,
      expected,
      "fulfilment evidence = not captured",
      "No captured snapshot on the correlated path carries the fulfilment collection, so fulfilments for this payment cannot be counted.",
      refs,
    );
  }

  let maxObserved = 0;
  for (const snapshot of snapshotsWithFulfilments(bundle)) {
    const count = countFulfilOrderForPayment(snapshot, paymentId);
    if (count !== null && count > maxObserved) maxObserved = count;
  }

  const forPayment = observedFulfilments(bundle).filter(
    (f) => f.paymentId === paymentId,
  );
  const withRows = [...refs, ...fulfilmentRefsOf(forPayment)];

  if (maxObserved > 1) {
    return fail(
      bundle,
      id,
      expected,
      `FULFIL_ORDER fulfilments for the payment = ${maxObserved}`,
      "Two or more persisted FULFIL_ORDER fulfilment records reference the same payment.",
      withRows,
    );
  }
  return pass(
    bundle,
    id,
    expected,
    `FULFIL_ORDER fulfilments for the payment = ${maxObserved}`,
    "The payment resolves to one internal payment attempt and order, and at most one FULFIL_ORDER fulfilment record references it.",
    withRows,
  );
}

// ============================================================================
// INV-003 — Failed Payment Never Marks Order Paid
// ============================================================================

/**
 * Precondition (§18 §7): the evaluated payment has VERIFIED failure evidence.
 * Without it this rule does not apply at all — `NOT_APPLICABLE`, never a
 * manufactured `UNKNOWN`.
 *
 * Verified failure authority is a trusted provider `payment.failed` event.
 * `payments.failed_at` alone is merchant-side bookkeeping written by our own
 * processor, so it is supporting evidence only and can never by itself
 * establish the precondition — exactly as `captured_at` can never establish
 * provider success.
 *
 * `payment.failed` is a failure OBSERVATION, not permanent terminal truth. A
 * later verified `payment.captured` legitimately converges the order to
 * `PAID`, so the "failure-only" conclusion is only available when the capture
 * search factually established that no capture exists. An incomplete or
 * ambiguous search is `UNKNOWN` — never `FAIL`, because reporting "no capture
 * exists" from a search that could not have seen one is a false payment
 * finding.
 */
export function evaluateInv003(
  bundle: ChaosRunEvidenceBundleV1,
): InvariantEvaluationEnvelope {
  const id: MoneyInvariantId = "INV-003";
  const expected = "failure-only evidence => orders.payment_status != PAID";

  const source = bundle.sourceWebhook;
  const verifiedFailureEvent =
    source !== null &&
    isTrustedProviderEvent(source) &&
    source.eventType === EVENT_TYPE_PAYMENT_FAILED
      ? source
      : null;

  if (verifiedFailureEvent === null) {
    return notApplicable(
      bundle,
      id,
      "No VERIFIED provider failure event exists for the evaluated payment. A merchant-side failed_at alone is supporting evidence, not provider failure authority, so this invariant's precondition does not hold.",
      webhookRef(source),
    );
  }

  const capture = bundle.authoritativeCapture;
  const refs = [
    ...webhookRef(verifiedFailureEvent),
    ...webhookRef(bundle.authoritativeCaptureWebhook),
    ...attemptRefs(bundle),
  ];

  // A capture that exists — even with incomplete internal correlation — means
  // the failure-only premise is false, so no violation can be concluded here.
  if (
    capture.kind === "EXACTLY_ONE" ||
    capture.kind === "INCOMPLETE_INTERNAL_CORRELATION"
  ) {
    return pass(
      bundle,
      id,
      expected,
      `authoritative capture = ${capture.kind}`,
      "Verified provider capture evidence exists for this payment, so the failure observation is not the final provider truth and no failure-only violation can be concluded.",
      refs,
    );
  }
  if (capture.kind !== "NONE_OBSERVED") {
    return unknown(
      bundle,
      id,
      expected,
      `authoritative capture = ${capture.kind}`,
      "The authoritative capture search was incomplete or ambiguous, so 'no capture exists' was not established and a failure-only conclusion would be a false finding.",
      refs,
    );
  }

  const withOrder = collectCapturedSnapshots(bundle).filter(
    (s) => s.order !== null,
  );
  if (withOrder.length === 0) {
    return unknown(
      bundle,
      id,
      expected,
      "merchant order state = not captured",
      "No captured snapshot carries the order, so the merchant's paid status under failure-only evidence cannot be established.",
      refs,
    );
  }

  const orderRefs = [
    ...refs,
    { kind: "ORDER" as const, id: withOrder[0]!.order!.id },
  ];
  const paidSnapshot = withOrder.find(
    (s) => s.order!.paymentStatus === ORDER_PAYMENT_STATUS_PAID,
  );
  if (paidSnapshot) {
    return fail(
      bundle,
      id,
      expected,
      `orders.payment_status = ${ORDER_PAYMENT_STATUS_PAID} with no authoritative capture`,
      "Verified failure-only evidence left the order marked PAID although no authoritative captured-payment evidence exists.",
      orderRefs,
    );
  }
  return pass(
    bundle,
    id,
    expected,
    `orders.payment_status = ${withOrder[0]!.order!.paymentStatus}; authoritative capture = NONE_OBSERVED`,
    "Verified failure-only evidence left the order in a non-paid state.",
    orderRefs,
  );
}

// ============================================================================
// INV-004 — Fulfilment Requires Verified Successful Payment
// ============================================================================

/**
 * Precondition (§19 §7): one or more fulfilment records exist. C03, which
 * produces no fulfilment at all, is therefore `NOT_APPLICABLE`.
 *
 * PASS requires the COMPLETE five-condition rule of §19 §8, for EVERY
 * fulfilment:
 *
 *   1. the linked payment exists;
 *   2. the payment belongs to the order through its payment attempt;
 *   3. authoritative captured-payment evidence exists;
 *   4. that evidence is verified server-side;
 *   5. payment/order amount and currency satisfy INV-008.
 *
 * Conditions 1, 2 and 5 come from `validateFulfilmentPath` — the same helper
 * INV-010 uses, so the two rules cannot drift apart. Conditions 3 and 4 come
 * from the bundle's capture resolution plus a re-confirmation that the
 * resolved webhook really is verified provider evidence.
 *
 * `payments.captured_at` alone is NOT provider authority (the merchant RPC
 * sets it, so it is circular), and a verified Checkout signature alone does
 * not satisfy condition 3 either — §19 §8 states this explicitly.
 */
export function evaluateInv004(
  bundle: ChaosRunEvidenceBundleV1,
): InvariantEvaluationEnvelope {
  const id: MoneyInvariantId = "INV-004";
  const expected =
    "every FULFIL_ORDER fulfilment satisfies all five conditions: linked payment exists, belongs to the order via its attempt, authoritative capture evidence exists, is verified server-side, and amounts/currency match";

  // --- APPLICABILITY FIRST (blocker 3F-C-01). ---
  //
  // §19 §7's precondition is "one or more fulfilment records exist for the
  // order". Establishing whether that CAN be true is a question about the
  // subject, and it must be answered before asking whether the evidence was
  // captured. The original ordering asked about snapshots first, so a run with
  // no merchant subject at all reported UNKNOWN — missing evidence — when the
  // precondition was in fact provably false.
  const fulfilments = observedFulfilments(bundle);
  if (fulfilments.length === 0) {
    // CASE A — no merchant/fulfilment subject exists. The rule cannot apply,
    // and no amount of snapshot evidence would change that.
    if (!hasMerchantSubject(bundle)) {
      return notApplicable(
        bundle,
        id,
        "This run has no correlated order, payment attempt or payment, so there is no merchant subject from which a fulfilment could exist and this invariant's precondition cannot hold.",
        attemptRefs(bundle),
      );
    }
    // CASE B — a merchant subject DOES exist, but its fulfilment evidence was
    // never captured. The precondition is unproven, not false.
    if (snapshotsWithFulfilments(bundle).length === 0) {
      return unknown(
        bundle,
        id,
        expected,
        "merchant subject present; fulfilment evidence = not captured",
        "A merchant subject exists for this run, but no captured snapshot carries the fulfilment collection, so it cannot be established whether any fulfilment requires a capture basis.",
        attemptRefs(bundle),
      );
    }
    // CASE C — the collection WAS captured and is empty, so the precondition
    // is proven false.
    return notApplicable(
      bundle,
      id,
      "The captured fulfilment collection is empty, so no FULFIL_ORDER fulfilment exists whose payment basis could be required.",
      attemptRefs(bundle),
    );
  }

  // CASE D — one or more fulfilments exist: the five-condition rule applies.

  const captureWebhook = bundle.authoritativeCaptureWebhook;
  const baseRefs = [
    ...attemptRefs(bundle),
    ...fulfilmentRefsOf(fulfilments),
    ...webhookRef(captureWebhook),
  ];

  // --- Every OBSERVED fulfilment is validated independently (NARROW-02). ---
  // Iterating merchant paths and validating only the fulfilments they happen
  // to carry can silently skip a fulfilment observed in a snapshot whose
  // payment/attempt evidence was missing, and then PASS. The rule says "for
  // EVERY P0 fulfilment row".
  const paths = collectMerchantPaths(bundle);
  let indeterminate: string | null = null;

  for (const fulfilment of fulfilments) {
    const fulfilmentRef = [{ kind: "FULFILMENT" as const, id: fulfilment.id }];
    const chains = resolveDistinctChains(paths, fulfilment);

    if (chains.validPaths.length === 0) {
      if (chains.invalidDetail !== null) {
        return fail(
          bundle,
          id,
          expected,
          `fulfilment path invalid: ${chains.invalidDetail}`,
          "A fulfilment does not satisfy the required payment/attempt/order relational conditions, so it has no valid successful-payment basis.",
          [...baseRefs, ...fulfilmentRef],
        );
      }
      indeterminate =
        "a fulfilment's payment/attempt/order chain was not captured completely";
      continue;
    }
    if (chains.validPaths.length > 1) {
      indeterminate =
        "a fulfilment resolves through more than one distinct chain, so no single path can be validated";
      continue;
    }

    // Exactly one resolved path — conditions 3, 4 and 5 are judged on THAT
    // path, never on an unrelated merchant path.
    const path = chains.validPaths[0]!;
    const pathRef = [...baseRefs, ...fulfilmentRef, ...pathRefs(path)];

    // Condition 5a — INV-008's merchant-row money clause.
    const merchantMoney = validateMerchantMoneyConsistency(path);
    if (merchantMoney.kind === "INVALID") {
      return fail(
        bundle,
        id,
        expected,
        `condition 5 unsatisfied: ${merchantMoney.detail}`,
        "A fulfilment exists on a path whose order, payment attempt and payment money terms do not match, so INV-008's condition is not satisfied.",
        pathRef,
      );
    }
    if (merchantMoney.kind === "INDETERMINATE")
      indeterminate = merchantMoney.detail;

    // Condition 5b — INV-008's TRUSTED WEBHOOK money clause. A verified
    // capture webhook whose amount disagrees with the canonical payment must
    // never yield a fulfilment PASS.
    const webhookMoney = validateTrustedWebhookMoneyForPayment(
      bundle,
      path.payment,
    );
    if (webhookMoney.kind === "INVALID") {
      return fail(
        bundle,
        id,
        expected,
        `condition 5 unsatisfied: ${webhookMoney.detail}`,
        "A fulfilment exists although a relevant trusted webhook's money terms disagree with the canonical payment, so INV-008's condition is not satisfied.",
        pathRef,
      );
    }
    if (webhookMoney.kind === "INDETERMINATE")
      indeterminate = webhookMoney.detail;

    // Conditions 3 and 4 — authoritative, server-verified capture FOR THIS
    // FULFILMENT'S OWN PAYMENT (NARROW-03), not merely for the run.
    const captureAuthority = validateAuthoritativeCaptureForPayment(
      bundle,
      path.payment,
    );
    if (captureAuthority.kind === "INVALID") {
      return fail(
        bundle,
        id,
        expected,
        `FULFIL_ORDER fulfilments = ${fulfilments.length}; ${captureAuthority.detail}`,
        "A fulfilment exists although the completed authoritative capture search established no verified captured-payment evidence for its linked payment.",
        pathRef,
      );
    }
    if (captureAuthority.kind === "INDETERMINATE") {
      indeterminate = captureAuthority.detail;
    }
  }

  if (indeterminate !== null) {
    return unknown(
      bundle,
      id,
      expected,
      `FULFIL_ORDER fulfilments = ${fulfilments.length}; ${indeterminate}`,
      "A condition of the rule could not be established for at least one observed fulfilment, so no conclusion is drawn. Missing evidence is never PASS.",
      baseRefs,
    );
  }

  return pass(
    bundle,
    id,
    expected,
    `FULFIL_ORDER fulfilments = ${fulfilments.length}; every fulfilment resolves one valid chain with matching merchant and trusted-webhook money and exact verified capture authority for its own payment`,
    "Every observed fulfilment independently satisfies all five conditions of the rule.",
    baseRefs,
  );
}

// ============================================================================
// INV-005 — Invalid Webhook Signature Causes Zero Mutation
// ============================================================================

/**
 * Precondition: an intentionally invalid webhook-signature test was performed,
 * i.e. this is a C03 run.
 *
 * ARCH-3F-013 — an `UNEXPECTED_ACCEPTANCE` on either frozen case is a FAIL
 * regardless of a zero state delta. C03's mechanism is verification-only and
 * invokes nothing downstream, so an acceptance CANNOT produce a mutation:
 * reading the deltas alone would report "unchanged" for a merchant whose
 * webhook authentication is broken.
 *
 * The historical C03 run carries no mutation evidence and therefore stays
 * `UNKNOWN` permanently. It is never backfilled and no snapshot is
 * reconstructed for it. This rule's evidence lives on the chaos run itself,
 * which is why the run reference is its factual source.
 */
export function evaluateInv005(
  bundle: ChaosRunEvidenceBundleV1,
): InvariantEvaluationEnvelope {
  const id: MoneyInvariantId = "INV-005";
  const expected =
    "both invalid-signature cases REJECTED and zero trusted payment/business/fulfilment/webhook mutation";

  const scenario = bundle.scenarioEvidence;
  if (scenario.scenarioId !== "C03") {
    return notApplicable(
      bundle,
      id,
      "This run performed no intentionally invalid webhook-signature test, so this invariant's precondition does not hold.",
    );
  }

  const checks = scenario.verificationChecks;
  if (checks === null || checks.length === 0) {
    return unknown(
      bundle,
      id,
      expected,
      "verification checks = not recorded in the frozen shape",
      "The run's persisted verification checks are absent or not the frozen two-check shape, so the authentication boundary's behaviour cannot be established.",
    );
  }

  const accepted = checks
    .filter((c) => c.classification === "UNEXPECTED_ACCEPTANCE")
    .map((c) => c.case)
    .sort();
  if (accepted.length > 0) {
    return fail(
      bundle,
      id,
      expected,
      `unexpected acceptance = ${accepted.join(", ")}`,
      "An intentionally invalid webhook signature was accepted by the verification boundary, which is itself a breach of the trusted authentication boundary regardless of any state delta.",
    );
  }

  const mutation = scenario.mutationEvidence;
  if (mutation === null) {
    return unknown(
      bundle,
      id,
      expected,
      "both cases REJECTED; before/after mutation evidence = not captured",
      "This run predates execution-time mutation evidence, or its persisted value failed validation. A snapshot taken today would be a false claim about a past execution, so no delta conclusion is drawn.",
    );
  }

  const comparison = compareC03MutationSnapshots(
    mutation.before,
    mutation.after,
  );
  if (comparison === "INCOMPLETE") {
    return unknown(
      bundle,
      id,
      expected,
      "both cases REJECTED; mutation evidence = incomplete or truncated",
      "A required before/after collection is missing or truncated, and two truncated prefixes must never be compared and called unchanged.",
    );
  }
  if (comparison === "MUTATED") {
    return fail(
      bundle,
      id,
      expected,
      "both cases REJECTED; merchant/payment/fulfilment/trusted-webhook state = changed",
      "An intentionally invalid webhook signature was followed by a factual change in trusted merchant, payment, fulfilment or canonical webhook state.",
    );
  }
  return pass(
    bundle,
    id,
    expected,
    "both cases REJECTED; all five approved projections unchanged",
    "Both intentionally invalid signatures were rejected and complete before/after evidence shows zero trusted mutation.",
  );
}

// ============================================================================
// INV-006 — Processed Event Replay Preserves Final Business State
// ============================================================================

/**
 * Preconditions (§21 §7): the source webhook was previously verified, the
 * event was already successfully processed, and the merchant has a known
 * final state.
 *
 * A chaos-linked processing attempt is NOT automatically proof of that. This
 * evaluator requires `PAYCHAOS_REPLAY` provenance for the replay itself, a
 * verified provider source, and a `SUCCEEDED` original processing attempt.
 * Any of those missing is `UNKNOWN`, not a replay `PASS`.
 *
 * Replay provenance is factual evidence, not a PASS. The rule then compares
 * the protected business tuple across the replay attempt's own before/after
 * pair; a new processing-attempt row, a chaos-run record and replay timestamps
 * are allowed audit additions and are excluded from the tuple.
 */
export function evaluateInv006(
  bundle: ChaosRunEvidenceBundleV1,
): InvariantEvaluationEnvelope {
  const id: MoneyInvariantId = "INV-006";
  const expected =
    "protected business tuple after replay == protected business tuple before replay";

  const replayAttempts = bundle.chaosProcessingAttempts.filter(
    (a) => a.sourceKind === "PAYCHAOS_REPLAY",
  );
  if (replayAttempts.length === 0) {
    return notApplicable(
      bundle,
      id,
      "This run replayed no already-processed event through the controlled replay path, so this invariant's precondition does not hold.",
      attemptRefs(bundle),
    );
  }

  const refs = attemptRefs(bundle);
  const source = trustedSource(bundle);
  if (source === null) {
    return unknown(
      bundle,
      id,
      expected,
      "source webhook = not verified provider evidence",
      "The replayed event's source could not be established as previously verified provider evidence, so this invariant's precondition is unproven.",
      [...refs, ...webhookRef(bundle.sourceWebhook)],
    );
  }

  const previouslySucceeded = bundle.originalProcessingAttempts.some((a) =>
    isSuccessfulProcessing(a.status),
  );
  if (!previouslySucceeded) {
    return unknown(
      bundle,
      id,
      expected,
      "original processing attempt with status SUCCEEDED = none",
      "No original processing attempt is recorded as SUCCEEDED, so 'the event was already successfully processed' is unproven and a replay comparison would not be against a known good final state.",
      [...refs, ...webhookRef(source)],
    );
  }

  const withSource = [...refs, ...webhookRef(source)];
  const replayIds = new Set(replayAttempts.map((a) => a.id));
  const replayPairs = collectSnapshotPairs(bundle).filter((p) =>
    replayIds.has(p.attemptId),
  );
  const required = requiredFor(bundle, true);

  // A PROVEN change dominates incomplete evidence elsewhere.
  const changed = replayPairs.filter(
    (p) =>
      p.before !== null &&
      p.after !== null &&
      !protectedBusinessStateEquals(
        protectedBusinessState(p.before),
        protectedBusinessState(p.after),
      ),
  );
  if (changed.length > 0) {
    return fail(
      bundle,
      id,
      expected,
      `replay attempts whose protected business tuple changed = ${changed.length}`,
      "Replaying an already-processed event changed the protected business state (payment status, business status, capture/failure state, amount, currency or fulfilment set).",
      withSource,
    );
  }

  // Architect blocker FINAL-08: two snapshots whose required nested entities
  // are BOTH absent compare equal, but that equality proves nothing.
  const incomplete = incompletePairs(replayPairs, required);
  if (incomplete.length > 0) {
    return unknown(
      bundle,
      id,
      expected,
      `replay attempts without complete protected-state evidence = ${incomplete.length} (missing: ${missingSummary(incomplete, required)})`,
      "A replay attempt lacks the merchant evidence this run requires, so 'unchanged' is not proven. Historical NULL snapshots are authoritative evidence absence and are never reconstructed from present-day state.",
      withSource,
    );
  }
  return pass(
    bundle,
    id,
    expected,
    `verified source; original SUCCEEDED attempt present; replay attempts compared = ${replayPairs.length}; protected business tuple unchanged`,
    "Every replay of the previously-processed verified event left the protected business state exactly as it was, on complete evidence.",
    withSource,
  );
}

// ============================================================================
// INV-007 — Duplicate Delivery Creates No Duplicate Business Record
// ============================================================================

/**
 * Precondition (§22 §7): the same logical merchant action was triggered MORE
 * THAN ONCE — duplicate webhook delivery, different related success events, or
 * repeated internal processing.
 *
 * A normal order processed exactly once must NOT receive a persisted PASS for
 * a duplicate-delivery invariant whose precondition never occurred. The
 * repeated-trigger fact is established from approved evidence only
 * (`is_duplicate_delivery`, chaos replay attempts, the canonical event's
 * duplicate delivery count, or more than one processing attempt) — never from
 * a scenario ID.
 *
 * A duplicate processing attempt is NOT automatically a duplicate business
 * effect. The rule counts persisted business records, never attempt rows.
 */
export function evaluateInv007(
  bundle: ChaosRunEvidenceBundleV1,
): InvariantEvaluationEnvelope {
  const id: MoneyInvariantId = "INV-007";
  const expected = "FULFIL_ORDER fulfilments per order <= 1";

  const repeated = repeatedTriggerEvidence(bundle);
  if (!repeated.repeated) {
    return notApplicable(
      bundle,
      id,
      "The same logical merchant action was not triggered more than once: there is no duplicate-flagged delivery, no replay attempt, no reported duplicate delivery count and no second processing attempt. This invariant's precondition does not hold.",
      attemptRefs(bundle),
    );
  }

  const orderId = bundle.run.orderId;
  if (orderId === null) {
    return unknown(
      bundle,
      id,
      expected,
      "repeated trigger observed but no merchant order is correlated",
      "Repeated triggering was observed, but no correlated order identifies the protected business record set, so duplicate records cannot be counted.",
      attemptRefs(bundle),
    );
  }

  const refs = [
    { kind: "ORDER" as const, id: orderId },
    ...attemptRefs(bundle),
  ];
  const snapshots = snapshotsWithFulfilments(bundle);
  if (snapshots.length === 0) {
    return unknown(
      bundle,
      id,
      expected,
      "fulfilment evidence = not captured",
      "No captured snapshot carries the fulfilment collection, so duplicate business records cannot be counted.",
      refs,
    );
  }

  let maxObserved = 0;
  for (const snapshot of snapshots) {
    const count = countFulfilOrderForOrder(snapshot, orderId);
    if (count !== null && count > maxObserved) maxObserved = count;
  }

  const forOrder = observedFulfilments(bundle).filter(
    (f) => f.orderId === orderId,
  );
  const withRows = [...refs, ...fulfilmentRefsOf(forOrder)];

  // Architect blocker FINAL-08: a relevant attempt with no usable fulfilment
  // evidence means "at most one record" is not proven — unless a duplicate is
  // already independently proven, in which case FAIL dominates.
  if (maxObserved <= 1) {
    const required = requiredFor(bundle, true);
    const incomplete = incompletePairs(collectSnapshotPairs(bundle), required);
    if (incomplete.length > 0) {
      return unknown(
        bundle,
        id,
        expected,
        `relevant attempts without complete business-record evidence = ${incomplete.length} (missing: ${missingSummary(incomplete, required)})`,
        "At least one relevant attempt lacks the merchant evidence needed to count protected business records for this order.",
        withRows,
      );
    }
  }

  if (maxObserved > 1) {
    return fail(
      bundle,
      id,
      expected,
      `FULFIL_ORDER fulfilments for the order = ${maxObserved}`,
      "Duplicate delivery or repeated processing produced more than one protected FULFIL_ORDER business record for the same order.",
      withRows,
    );
  }
  return pass(
    bundle,
    id,
    expected,
    `repeated triggers observed (duplicate-flagged = ${repeated.duplicateFlaggedAttempts}, replay = ${repeated.replayAttempts}, delivery count = ${repeated.duplicateDeliveryCount}, attempts = ${repeated.totalProcessingAttempts}); FULFIL_ORDER fulfilments for the order = ${maxObserved}`,
    "Repeated delivery or processing did not create a second protected business record for this order.",
    withRows,
  );
}

// ============================================================================
// INV-008 — Order / Attempt / Payment Amount and Currency Consistency
// ============================================================================

/**
 * Precondition (§23 §7): a captured payment has been correlated to an internal
 * payment attempt/order. Three merchant numbers merely existing on an
 * unestablished payment path is NOT that precondition and must not produce an
 * authoritative PASS.
 *
 * Exact integer smallest-subunit equality with currency compared alongside.
 * Trusted normalized webhook money terms must match the canonical payment
 * where such a webhook is part of the authoritative evidence — and if a
 * RELEVANT trusted webhook is missing EITHER money component, that is missing
 * required evidence (`UNKNOWN`), never a silently skipped comparison. `NULL`
 * is never defaulted to `0` or `"INR"`.
 *
 * A proven mismatch always dominates an indeterminate one: FAIL is reported
 * even when some other required value could not be established.
 */
export function evaluateInv008(
  bundle: ChaosRunEvidenceBundleV1,
): InvariantEvaluationEnvelope {
  const id: MoneyInvariantId = "INV-008";
  const expected =
    "orders.amount_subunits == payment_attempts.amount_subunits == payments.amount_subunits, with identical currency, and every relevant trusted webhook's money terms matching the canonical payment";

  // --- Step 1: establish the relational subject. ---
  const paths = collectMerchantPaths(bundle).filter(
    isPaymentCorrelatedToOrderPath,
  );
  if (paths.length === 0) {
    return unknown(
      bundle,
      id,
      expected,
      "payment correlated to a payment attempt and order = not established",
      "No captured snapshot resolves a payment to its internal payment attempt and order, so the rule has no subject and no authoritative money conclusion is reported.",
      attemptRefs(bundle),
    );
  }

  const refs = [...pathRefs(paths[0]!), ...attemptRefs(bundle)];

  // --- Step 2: APPLICABILITY, strictly before any money comparison. ---
  //
  // Architect blocker NARROW-01. §23 §7's precondition is a CAPTURED payment.
  // A payment that is definitively not captured cannot FAIL this rule for a
  // money mismatch — the rule does not apply to it at all. Evaluating money
  // first would let the rule's own result establish its applicability.
  const captureAuthority = validateAuthoritativeCaptureForPayment(
    bundle,
    paths[0]!.payment,
  );
  if (captureAuthority.kind === "INVALID") {
    return notApplicable(
      bundle,
      id,
      "A complete authoritative capture search established that this payment is not captured, so INV-008's documented precondition ('a captured payment has been correlated to an internal payment attempt/order') is proven false. No money comparison is performed.",
      refs,
    );
  }
  if (captureAuthority.kind === "INDETERMINATE") {
    return unknown(
      bundle,
      id,
      expected,
      captureAuthority.detail,
      "Whether this payment is an authoritatively captured one could not be established, so the documented precondition is neither satisfied nor disproven and no money conclusion is drawn.",
      refs,
    );
  }

  // --- Step 3: only now, the deterministic money rule. ---
  let indeterminate: string | null = null;
  for (const path of paths) {
    const merchantMoney = validateMerchantMoneyConsistency(path);
    if (merchantMoney.kind === "INVALID") {
      return fail(
        bundle,
        id,
        expected,
        merchantMoney.detail,
        "An authoritative required amount or currency differs between the order, payment attempt and payment.",
        refs,
      );
    }
    if (merchantMoney.kind === "INDETERMINATE") {
      indeterminate = merchantMoney.detail;
    }

    // Both safe trusted webhook surfaces, deduped by id, restricted to those
    // genuinely about this payment. A RELEVANT trusted webhook with a NULL
    // amount or NULL currency is MISSING REQUIRED EVIDENCE — never silently
    // skipped, never defaulted to 0 / INR.
    const webhookMoney = validateTrustedWebhookMoneyForPayment(
      bundle,
      path.payment,
    );
    if (webhookMoney.kind === "INVALID") {
      return fail(
        bundle,
        id,
        expected,
        webhookMoney.detail,
        "A trusted normalized webhook amount or currency differs from the canonical payment values.",
        refs,
      );
    }
    if (webhookMoney.kind === "INDETERMINATE") {
      indeterminate = webhookMoney.detail;
    }
  }

  if (indeterminate !== null) {
    return unknown(
      bundle,
      id,
      expected,
      indeterminate,
      "A required money value is NULL or non-integer. It is never defaulted to 0 or INR, so no equality conclusion is drawn.",
      refs,
    );
  }
  return pass(
    bundle,
    id,
    expected,
    "authoritative capture = EXACTLY_ONE for this payment; every compared amount and currency matches exactly",
    "The authoritatively captured payment resolves to its payment attempt and order, all three carry identical integer smallest-subunit amounts and identical currencies, and every relevant trusted webhook's money terms agree.",
    refs,
  );
}

// ============================================================================
// INV-009 — Failed Processing Is Atomic or Safely Retryable
// ============================================================================

/**
 * Precondition (§24 §7): a processing attempt ended `FAILED`.
 *
 * A processor may fail SAFELY — "a processor error occurred" is never itself a
 * violation. All four conditions of §24 §8 are checked:
 *
 *   1. no protected fulfilment is durably attributed to the failed attempt;
 *   2. no partial business/payment mutation owned by it survives;
 *   3. the canonical event is not falsely marked fully PROCESSED because of it;
 *   4. retry remains possible unless an earlier independent successful attempt
 *      already completed the same logical effect.
 *
 * Condition 4 is only reported satisfied when the evidence proves it. Where
 * retry-safety cannot be established from the frozen evidence the result is
 * `UNKNOWN` — no "retryable" fact is invented.
 */
export function evaluateInv009(
  bundle: ChaosRunEvidenceBundleV1,
): InvariantEvaluationEnvelope {
  const id: MoneyInvariantId = "INV-009";
  const expected =
    "a FAILED processing attempt attributes no protected fulfilment, leaves no surviving partial mutation, does not falsely mark the canonical event PROCESSED, and remains retryable";

  const failedAttempts = allAttempts(bundle).filter(
    (a) => a.status === PROCESSING_ATTEMPT_STATUS_FAILED,
  );
  if (failedAttempts.length === 0) {
    return notApplicable(
      bundle,
      id,
      "No processing attempt for this run ended FAILED, so this invariant's precondition does not hold.",
      attemptRefs(bundle),
    );
  }

  const refs = [...attemptRefs(bundle), ...webhookRef(bundle.sourceWebhook)];
  const failedIds = new Set(failedAttempts.map((a) => a.id));
  const independentSuccess = allAttempts(bundle).filter(
    (a) => !failedIds.has(a.id) && isSuccessfulProcessing(a.status),
  );

  // --- Condition 1 — no protected fulfilment attributed to a failed attempt. ---
  const attributed = observedFulfilments(bundle).filter(
    (f) =>
      f.triggerProcessingAttemptId !== null &&
      failedIds.has(f.triggerProcessingAttemptId),
  );
  if (attributed.length > 0) {
    return fail(
      bundle,
      id,
      expected,
      `protected FULFIL_ORDER records attributed to a FAILED attempt = ${attributed.length}`,
      "A durable protected fulfilment record is attributed to a processing attempt that ended FAILED, which is an impossible partial commit.",
      [...refs, ...fulfilmentRefsOf(attributed)],
    );
  }

  // --- Condition 2 — no surviving partial mutation. ---
  const failedPairs = collectSnapshotPairs(bundle).filter((p) =>
    failedIds.has(p.attemptId),
  );
  const required = requiredFor(bundle, true);
  const partial = failedPairs.filter(
    (p) =>
      p.before !== null &&
      p.after !== null &&
      !protectedBusinessStateEquals(
        protectedBusinessState(p.before),
        protectedBusinessState(p.after),
      ),
  );
  // Architect blocker FINAL-08: a snapshot whose required nested entities are
  // absent on BOTH sides compares equal, and that equality is not a rollback
  // proof.
  const incomplete = incompletePairs(failedPairs, required);
  if (partial.length > 0) {
    return fail(
      bundle,
      id,
      expected,
      `FAILED attempts whose protected business state changed = ${partial.length}`,
      "A processing attempt that ended FAILED left a surviving protected business-state change, which is an impossible partial commit.",
      refs,
    );
  }

  // --- Condition 3 — the canonical event must not be falsely PROCESSED. ---
  const source = bundle.sourceWebhook;
  if (source === null) {
    return unknown(
      bundle,
      id,
      expected,
      "canonical source webhook = not resolved",
      "The canonical event's processing status cannot be read, so it is unproven whether the failed attempt left it falsely marked fully processed.",
      refs,
    );
  }
  if (
    source.processingStatus === "PROCESSED" &&
    independentSuccess.length === 0
  ) {
    return fail(
      bundle,
      id,
      expected,
      "canonical event processing_status = PROCESSED with no independent SUCCEEDED attempt",
      "The canonical event is marked fully processed although every processing attempt for it ended FAILED, so it was falsely marked processed by a failed attempt.",
      refs,
    );
  }

  // --- Condition 2's evidence completeness. ---
  if (incomplete.length > 0) {
    return unknown(
      bundle,
      id,
      expected,
      `FAILED attempts without complete protected-state evidence = ${incomplete.length} (missing: ${missingSummary(incomplete, required)})`,
      "A FAILED attempt lacks the merchant evidence this run requires, so a clean rollback is not proven. Two absent nested entities comparing equal is not a rollback proof, and historical NULL snapshots are never reinterpreted.",
      refs,
    );
  }

  // --- Condition 4 — retryability, ONLY where the evidence proves it. ---
  //
  // Architect blocker FINAL-07. "Not PROCESSED" is a negative fact and does
  // not universally prove a retry can succeed. What the CURRENT frozen
  // architecture does prove is narrower and specific:
  //
  //   supabase/migrations/20260828000000_phase2f_merchant_processing.sql
  //   writes `webhook_events.processing_status = 'PROCESSED'` (lines ~655-662)
  //   ONLY inside the same transaction that marks the processing attempt
  //   SUCCEEDED and commits the merchant mutation. No migration and no
  //   application module ever writes 'PROCESSING' or 'FAILED' to that column.
  //
  // Therefore a canonical event still at its `RECEIVED` default after a failed
  // attempt is positive evidence that the whole transaction rolled back and the
  // ordinary retry path — a fresh PENDING attempt on a later delivery — remains
  // available. `PROCESSING` and `FAILED` are outside what the current
  // architecture produces at all, so observing one is unexplained evidence and
  // yields UNKNOWN rather than an invented retryability claim.
  if (independentSuccess.length > 0) {
    return pass(
      bundle,
      id,
      expected,
      `FAILED attempts = ${failedAttempts.length}; no attributed fulfilment; no partial mutation; independent SUCCEEDED attempts = ${independentSuccess.length}`,
      "The failed attempts committed nothing, and an earlier independent successful idempotent attempt already completed the same logical effect, so no retry is owed.",
      refs,
    );
  }
  if (source.processingStatus !== WEBHOOK_PROCESSING_STATUS_RECEIVED) {
    return unknown(
      bundle,
      id,
      expected,
      `canonical event processing_status = ${source.processingStatus}; no independent SUCCEEDED attempt`,
      "The canonical event is in a processing state the current architecture never writes, so whether the ordinary retry path remains available cannot be established. Retryability is never inferred from a negative fact.",
      refs,
    );
  }
  return pass(
    bundle,
    id,
    expected,
    `FAILED attempts = ${failedAttempts.length}; no attributed fulfilment; no partial mutation; canonical event processing_status = RECEIVED (transaction rolled back, so retry remains possible)`,
    "Every failed processing attempt rolled back cleanly, attributed no protected record, and left the canonical event at its RECEIVED default — which the Phase 2F transaction proves means the merchant mutation did not commit and a fresh retry attempt is still possible.",
    refs,
  );
}

// ============================================================================
// INV-010 — Fulfilment Has Exactly One Valid Payment Path
// ============================================================================

/**
 * Precondition (§25 §7): a fulfilment exists.
 *
 * The relational chain fulfilment -> payment -> payment attempt -> order must
 * resolve to exactly one valid path, and the linked payment must carry
 * authoritative successful payment evidence. `captured_at` alone is never
 * treated as provider success.
 *
 * Shares `validateFulfilmentPath` with INV-004 so the two rules cannot drift.
 * INV-010 is NOT weakened by that sharing — it keeps its own relational
 * requirement that the joined valid path resolves for every fulfilment.
 */
export function evaluateInv010(
  bundle: ChaosRunEvidenceBundleV1,
): InvariantEvaluationEnvelope {
  const id: MoneyInvariantId = "INV-010";
  const expected =
    "each FULFIL_ORDER fulfilment resolves to exactly one valid payment -> attempt -> order path backed by authoritative capture evidence";

  if (snapshotsWithFulfilments(bundle).length === 0) {
    return unknown(
      bundle,
      id,
      expected,
      "fulfilment evidence = not captured",
      "No captured snapshot carries the fulfilment collection, so no fulfilment path can be resolved.",
      attemptRefs(bundle),
    );
  }

  const fulfilments = observedFulfilments(bundle);
  if (fulfilments.length === 0) {
    return notApplicable(
      bundle,
      id,
      "No FULFIL_ORDER fulfilment exists for this run, so there is no payment path to validate.",
      attemptRefs(bundle),
    );
  }

  const baseRefs = [
    ...attemptRefs(bundle),
    ...fulfilmentRefsOf(fulfilments),
    ...webhookRef(bundle.authoritativeCaptureWebhook),
  ];

  const paths = collectMerchantPaths(bundle);
  if (paths.length === 0) {
    return unknown(
      bundle,
      id,
      expected,
      `FULFIL_ORDER fulfilments = ${fulfilments.length}; payment/attempt/order chain = not captured together`,
      "No captured snapshot carries the payment, payment attempt and order together, so the fulfilment's relational path cannot be resolved.",
      baseRefs,
    );
  }

  const refs = [...baseRefs, ...pathRefs(paths[0]!)];

  // The joined valid path count must be EXACTLY ONE per fulfilment. Repeated
  // before/after observations of the SAME chain are one chain, not several —
  // `resolveDistinctChains` dedupes by (payment, attempt, order) identity.
  //
  // Deliberately RELATION + CAPTURE ONLY (architect blocker FINAL-03): INV-010
  // §8 has no amount/currency clause at all. A money mismatch is INV-008's
  // finding, and failing INV-010 for it would double-report one defect under
  // two rules.
  let indeterminate: string | null = null;

  for (const fulfilment of fulfilments) {
    const fulfilmentRef = [{ kind: "FULFILMENT" as const, id: fulfilment.id }];
    const chains = resolveDistinctChains(paths, fulfilment);

    if (chains.validPaths.length > 1) {
      return fail(
        bundle,
        id,
        expected,
        `distinct valid payment paths for one fulfilment = ${chains.validPaths.length}`,
        "A fulfilment resolves through more than one distinct valid payment/attempt/order chain, so its payment path is ambiguous rather than exactly one.",
        [...baseRefs, ...fulfilmentRef],
      );
    }
    if (chains.validPaths.length === 0) {
      if (chains.invalidDetail !== null) {
        return fail(
          bundle,
          id,
          expected,
          `fulfilment path invalid: ${chains.invalidDetail}`,
          "A fulfilment does not resolve to a valid payment/attempt/order chain.",
          [...baseRefs, ...fulfilmentRef],
        );
      }
      indeterminate =
        "no captured snapshot resolves a relational chain for a fulfilment";
      continue;
    }

    // Authoritative successful payment evidence for THE LINKED PAYMENT
    // (architect blocker NARROW-03) — never merely a run-level EXACTLY_ONE.
    const path = chains.validPaths[0]!;
    const captureAuthority = validateAuthoritativeCaptureForPayment(
      bundle,
      path.payment,
    );
    if (captureAuthority.kind === "INVALID") {
      return fail(
        bundle,
        id,
        expected,
        `FULFIL_ORDER fulfilments = ${fulfilments.length}; ${captureAuthority.detail}`,
        "The relational path resolves, but the completed capture search established no authoritative successful payment evidence for its linked payment.",
        [...baseRefs, ...fulfilmentRef, ...pathRefs(path)],
      );
    }
    if (captureAuthority.kind === "INDETERMINATE") {
      indeterminate = captureAuthority.detail;
    }
  }

  if (indeterminate !== null) {
    return unknown(
      bundle,
      id,
      expected,
      `relational chains resolved; ${indeterminate}`,
      "The fulfilment's payment path or its capture authority could not be established, so the path's payment authority is undetermined.",
      refs,
    );
  }
  return pass(
    bundle,
    id,
    expected,
    `FULFIL_ORDER fulfilments = ${fulfilments.length}; distinct valid payment paths per fulfilment = 1; exact verified capture authority for each linked payment`,
    "Every fulfilment resolves to exactly one distinct valid payment/attempt/order chain backed by verified provider capture evidence for that chain's own payment. Money consistency is INV-008's rule and is deliberately not judged here.",
    refs,
  );
}

// ============================================================================
// INV-011 — Payment State Is Legal, Monotonic and Convergent
// ============================================================================

/**
 * Rule A (legal transitions), Rule B (PAID is monotonic), Rule C (capture
 * convergence), Rule D (FULFILLED implies PAID) and Rule E (a CAPTURED attempt
 * does not regress).
 *
 * Transitions come from each attempt's OWN before/after pair — a genuine
 * observed transition — never from event arrival order and never from "latest
 * timestamp wins". A self-transition other than `PAID -> PAID` returns
 * `NO_TRANSITION` and counts as no observation at all, rather than being
 * claimed as a member of the frozen seven-member legal set.
 *
 * Rule C uses EXACT successful-processing semantics: only `SUCCEEDED` is
 * first-party success. `PENDING`, `HELD` and `PROCESSING` are in flight and
 * prove nothing; `SKIPPED_DUPLICATE` did no work and is not merchant-success
 * authority by itself.
 */
export function evaluateInv011(
  bundle: ChaosRunEvidenceBundleV1,
): InvariantEvaluationEnvelope {
  const id: MoneyInvariantId = "INV-011";
  const expected =
    "every observed payment-state transition is legal, PAID never regresses, FULFILLED implies PAID, and verified capture converges to PAID after successful processing";

  const pairs = collectSnapshotPairs(bundle);
  const complete = pairs.filter((p) => p.before !== null && p.after !== null);
  const refs = [
    ...attemptRefs(bundle),
    ...webhookRef(bundle.authoritativeCaptureWebhook),
  ];

  // --- Rule D is checkable from any single captured snapshot. ---
  for (const snapshot of collectCapturedSnapshots(bundle)) {
    const order = snapshot.order;
    if (
      order !== null &&
      order.businessStatus === ORDER_BUSINESS_STATUS_FULFILLED &&
      order.paymentStatus !== ORDER_PAYMENT_STATUS_PAID
    ) {
      return fail(
        bundle,
        id,
        expected,
        `orders.business_status = FULFILLED with orders.payment_status = ${order.paymentStatus}`,
        "An order is marked FULFILLED while its payment status is not PAID.",
        [...refs, { kind: "ORDER" as const, id: order.id }],
      );
    }
  }

  if (complete.length === 0) {
    return unknown(
      bundle,
      id,
      expected,
      `processing attempts with a complete before/after snapshot pair = 0 (of ${pairs.length})`,
      "No attempt carries both a captured before and a captured after snapshot, so no state transition can be observed. Historical NULL snapshots are authoritative evidence absence.",
      refs,
    );
  }

  let unrecognised = 0;
  let legalTransitions = 0;
  let noTransitions = 0;
  for (const pair of complete) {
    const before = pair.before!;
    const after = pair.after!;

    if (before.order !== null && after.order !== null) {
      const paymentVerdict = evaluateOrderPaymentStatusTransition(
        before.order.paymentStatus,
        after.order.paymentStatus,
      );
      if (paymentVerdict === "ILLEGAL") {
        return fail(
          bundle,
          id,
          expected,
          `illegal order payment-status transition ${before.order.paymentStatus} -> ${after.order.paymentStatus}`,
          "An observed order payment-status transition is outside the frozen legal transition set (this includes any regression away from PAID).",
          [...refs, { kind: "ORDER" as const, id: after.order.id }],
        );
      }
      if (paymentVerdict === "UNRECOGNISED") unrecognised += 1;
      if (paymentVerdict === "LEGAL") legalTransitions += 1;
      if (paymentVerdict === "NO_TRANSITION") noTransitions += 1;

      const businessVerdict = evaluateOrderBusinessStatusTransition(
        before.order.businessStatus,
        after.order.businessStatus,
      );
      if (businessVerdict === "ILLEGAL") {
        return fail(
          bundle,
          id,
          expected,
          `illegal order business-status transition ${before.order.businessStatus} -> ${after.order.businessStatus}`,
          "An observed order business-status transition regressed from FULFILLED.",
          [...refs, { kind: "ORDER" as const, id: after.order.id }],
        );
      }
      if (businessVerdict === "REQUIRES_FULFILMENT_AUTHORITY") {
        // docs/MONEY_INVARIANTS.md §12: OPEN -> FULFILLED is INVALID unless
        // the order has authoritative successful payment evidence AND a valid
        // fulfilment row is being committed. Both are checked from the frozen
        // evidence rather than assumed (architect blocker FINAL-06).
        const authority = openToFulfilledAuthority(bundle, pair);
        if (authority.kind === "INVALID") {
          return fail(
            bundle,
            id,
            expected,
            `OPEN -> FULFILLED without fulfilment authority: ${authority.detail}`,
            "An order became FULFILLED although the evidence proves it lacks the authoritative successful payment and valid fulfilment row that transition requires.",
            [...refs, { kind: "ORDER" as const, id: after.order.id }],
          );
        }
        if (authority.kind === "INDETERMINATE") {
          return unknown(
            bundle,
            id,
            expected,
            `OPEN -> FULFILLED; fulfilment authority unproven: ${authority.detail}`,
            "An order became FULFILLED, but the authoritative capture or fulfilment evidence that transition requires could not be established either way.",
            [...refs, { kind: "ORDER" as const, id: after.order.id }],
          );
        }
        legalTransitions += 1;
      }
      if (businessVerdict === "UNRECOGNISED") unrecognised += 1;
      if (businessVerdict === "LEGAL") legalTransitions += 1;
      if (businessVerdict === "NO_TRANSITION") noTransitions += 1;
    }

    if (before.paymentAttempt !== null && after.paymentAttempt !== null) {
      const attemptVerdict = evaluatePaymentAttemptStatusTransition(
        before.paymentAttempt.status,
        after.paymentAttempt.status,
      );
      if (attemptVerdict === "ILLEGAL") {
        return fail(
          bundle,
          id,
          expected,
          `illegal payment-attempt transition ${before.paymentAttempt.status} -> ${after.paymentAttempt.status}`,
          "A payment attempt already known CAPTURED regressed to a weaker status.",
          [
            ...refs,
            { kind: "PAYMENT_ATTEMPT" as const, id: after.paymentAttempt.id },
          ],
        );
      }
      if (attemptVerdict === "UNRECOGNISED") unrecognised += 1;
      if (attemptVerdict === "LEGAL") legalTransitions += 1;
      if (attemptVerdict === "NO_TRANSITION") noTransitions += 1;
    }
  }

  if (unrecognised > 0) {
    return unknown(
      bundle,
      id,
      expected,
      `observed status pairs with an unrecognised value = ${unrecognised}`,
      "An observed status value is outside the frozen state vocabulary, so its legality cannot be decided. An unfamiliar value is missing evidence, never proof of a violation.",
      refs,
    );
  }

  // --- Rule C — capture convergence. ---
  //
  // Architect blocker FINAL-05: convergence must be judged from the processing
  // of the CAPTURE EVENT ITSELF, correlated by exact `webhookEventId` identity.
  // A SUCCEEDED attempt that processed `payment.failed` is not the capture
  // processor; treating it as one produces a false FAIL for the entirely
  // legitimate failure-then-later-capture sequence. No timestamp ordering is
  // used anywhere.
  //
  // Architect blocker FINAL-04: where the capture's own processing has not
  // completed successfully, Rule C's precondition is unmet and convergence is
  // simply unproven — UNKNOWN, not PASS and not FAIL.
  const capture = bundle.authoritativeCapture;
  if (capture.kind === "EXACTLY_ONE") {
    const captureAttempts = captureProcessingAttempts(bundle);
    if (captureAttempts.length === 0) {
      return unknown(
        bundle,
        id,
        expected,
        "authoritative capture = EXACTLY_ONE but no processing attempt is correlated to the capture event",
        "Genuine capture evidence exists, but no processing attempt for that capture event was recorded, so merchant convergence to PAID cannot be established.",
        refs,
      );
    }

    const captureIds = new Set(captureAttempts.map((a) => a.id));
    const capturePairs = complete.filter((p) => captureIds.has(p.attemptId));
    const succeededCapturePairs = capturePairs.filter((p) =>
      isSuccessfulProcessing(p.status),
    );

    if (succeededCapturePairs.length === 0) {
      const statuses = [
        ...new Set(captureAttempts.map((a) => a.status)),
      ].sort();
      return unknown(
        bundle,
        id,
        expected,
        `authoritative capture = EXACTLY_ONE; capture-event processing status(es) = ${statuses.join(", ")}; no SUCCEEDED capture processing with a complete snapshot pair`,
        "The capture event's own processing has not completed successfully with usable evidence, so Rule C's 'processing has completed successfully' precondition is unmet and convergence is unproven. In-flight and skipped-duplicate processing is neither success nor violation.",
        refs,
      );
    }

    if (succeededCapturePairs.some((p) => p.after!.order === null)) {
      return unknown(
        bundle,
        id,
        expected,
        "authoritative capture = EXACTLY_ONE but the capture attempt's after-state order is unavailable",
        "Verified capture evidence exists and its processing succeeded, but the merchant after-state needed to prove convergence to PAID was not captured.",
        refs,
      );
    }
    const notConverged = succeededCapturePairs.filter(
      (p) => p.after!.order!.paymentStatus !== ORDER_PAYMENT_STATUS_PAID,
    );
    if (notConverged.length > 0) {
      return fail(
        bundle,
        id,
        expected,
        `authoritative capture = EXACTLY_ONE but ${notConverged.length} SUCCEEDED capture-processing attempt(s) left orders.payment_status != PAID`,
        "The capture event was processed successfully, but the merchant order did not converge to PAID.",
        refs,
      );
    }
  }

  return pass(
    bundle,
    id,
    expected,
    `legal transitions observed = ${legalTransitions}; no-op status pairs = ${noTransitions}; illegal = 0; authoritative capture = ${capture.kind}`,
    "Every observed payment-state transition is legal and monotonic, and the merchant state is consistent with the authoritative capture evidence.",
    refs,
  );
}

// ============================================================================
// INV-012 — Unsupported Event Causes No Business Effect
// ============================================================================

/**
 * Precondition (§27 §7): the canonical event type is NOT one of the supported
 * P0 business-processing events (`payment.captured`, `payment.failed`,
 * `order.paid`). A supported event is `NOT_APPLICABLE`.
 *
 * Disposition priority is strict:
 *
 *   1. a proven protected mutation ANYWHERE -> FAIL;
 *   2. otherwise ANY relevant attempt missing required before/after evidence
 *      -> UNKNOWN (a complete pair elsewhere never excuses an incomplete one);
 *   3. otherwise complete zero mutation, from verified provider evidence
 *      -> PASS.
 *
 * Untrusted evidence can never manufacture an authoritative PASS.
 */
export function evaluateInv012(
  bundle: ChaosRunEvidenceBundleV1,
): InvariantEvaluationEnvelope {
  const id: MoneyInvariantId = "INV-012";
  const expected =
    "an unsupported event produces zero order/payment/fulfilment protected effect";

  const webhook = bundle.sourceWebhook;
  if (webhook === null) {
    return unknown(
      bundle,
      id,
      expected,
      "canonical source webhook = not resolved",
      "No canonical webhook event could be resolved, so it cannot be established whether an unsupported event was processed.",
    );
  }
  if (isSupportedBusinessEventType(webhook.eventType)) {
    return notApplicable(
      bundle,
      id,
      "The canonical event type is a supported P0 business-processing event, so this invariant's precondition does not hold.",
      webhookRef(webhook),
    );
  }

  const refs = [...webhookRef(webhook), ...attemptRefs(bundle)];
  const pairs = collectSnapshotPairs(bundle);

  // --- Priority 1: a proven mutation anywhere is a FAIL. ---
  const changed = pairs.filter(
    (p) =>
      p.before !== null &&
      p.after !== null &&
      !protectedBusinessStateEquals(
        protectedBusinessState(p.before),
        protectedBusinessState(p.after),
      ),
  );
  if (changed.length > 0) {
    return fail(
      bundle,
      id,
      expected,
      `unsupported event ${webhook.eventType} changed the protected business state in ${changed.length} attempt(s)`,
      "An unsupported event produced a protected order, payment or fulfilment state change.",
      refs,
    );
  }

  // --- Priority 2: ANY relevant attempt missing evidence is UNKNOWN. ---
  if (pairs.length === 0) {
    return unknown(
      bundle,
      id,
      expected,
      "processing attempts = 0",
      "No processing attempt evidence exists for this event, so zero protected effect cannot be proven.",
      refs,
    );
  }
  const required = requiredFor(bundle, true);
  const incomplete = incompletePairs(pairs, required);
  if (incomplete.length > 0) {
    return unknown(
      bundle,
      id,
      expected,
      `attempts without complete protected-state evidence = ${incomplete.length} (of ${pairs.length}; missing: ${missingSummary(incomplete, required)})`,
      "At least one relevant attempt lacks the merchant evidence needed to prove zero protected effect. A complete pair elsewhere does not excuse an incomplete one, and two absent nested entities comparing equal is not proof of no effect.",
      refs,
    );
  }
  if (!isTrustedProviderEvent(webhook)) {
    return unknown(
      bundle,
      id,
      expected,
      `source provenance = ${webhook.sourceKind}, signature verified = ${webhook.signatureVerified}; protected business state unchanged across ${pairs.length} attempt(s)`,
      "The observed state is unchanged, but the source is not verified provider evidence, so an authoritative zero-effect conclusion is not drawn from untrusted evidence.",
      refs,
    );
  }

  // --- Priority 3: complete, trusted, zero mutation. ---
  return pass(
    bundle,
    id,
    expected,
    `unsupported event ${webhook.eventType}; protected business state unchanged across all ${pairs.length} attempt(s)`,
    "The unsupported verified event produced no protected business or payment effect, proven across every relevant attempt.",
    refs,
  );
}

// ============================================================================
// THE FROZEN EVALUATOR TABLE
// ============================================================================

/**
 * Exactly twelve entries, keyed by the frozen catalogue IDs. No INV-013, no
 * INV-014, no P1 evaluator. `lib/invariants/evaluate.ts` dispatches through
 * this table.
 */
export const INVARIANT_EVALUATORS: Readonly<
  Record<
    MoneyInvariantId,
    (bundle: ChaosRunEvidenceBundleV1) => InvariantEvaluationEnvelope
  >
> = Object.freeze({
  "INV-001": evaluateInv001,
  "INV-002": evaluateInv002,
  "INV-003": evaluateInv003,
  "INV-004": evaluateInv004,
  "INV-005": evaluateInv005,
  "INV-006": evaluateInv006,
  "INV-007": evaluateInv007,
  "INV-008": evaluateInv008,
  "INV-009": evaluateInv009,
  "INV-010": evaluateInv010,
  "INV-011": evaluateInv011,
  "INV-012": evaluateInv012,
});
