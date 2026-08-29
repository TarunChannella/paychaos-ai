import type {
  AuthoritativeCaptureResolution,
  ChaosRunEvidenceBundleV1,
  C03MutationSnapshotEvidence,
  ProcessingAttemptEvidence,
  SafeWebhookEvidence,
  ScenarioEvidence,
} from "@/lib/evidence/chaos-run-evidence";
import type {
  MerchantStateSnapshotFulfilmentV1,
  MerchantStateSnapshotV1,
} from "@/lib/evidence/merchant-state-snapshot";

/**
 * Phase 3F-B — SYNTHETIC unit-test fixtures for the pure evaluators.
 *
 * These are hand-written TEST FIXTURES. They are never inserted into
 * Supabase, never labelled `RECORDED_TEST_EVIDENCE` or
 * `REAL_RAZORPAY_WEBHOOK` as a provenance claim about real traffic, and never
 * presented as genuine merchant or Razorpay evidence. Where a fixture sets
 * `sourceKind: "REAL_RAZORPAY_WEBHOOK"` it is exercising the evaluator's
 * trust check against that string — not asserting that a real provider event
 * occurred.
 *
 * Every id below is a fixed, obviously-synthetic UUID so that determinism
 * tests can compare byte-identical output. No `randomUUID`, no clock.
 */

export const RUN_ID = "11111111-1111-4111-8111-111111111111";
export const ORDER_ID = "22222222-2222-4222-8222-222222222222";
export const ATTEMPT_ID = "33333333-3333-4333-8333-333333333333";
export const PAYMENT_ID = "44444444-4444-4444-8444-444444444444";
export const WEBHOOK_ID = "55555555-5555-4555-8555-555555555555";
export const CAPTURE_WEBHOOK_ID = "66666666-6666-4666-8666-666666666666";
export const PROC_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
export const PROC_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
export const FULFILMENT_A = "ffffffff-ffff-4fff-8fff-fffffffffff1";
export const FULFILMENT_B = "ffffffff-ffff-4fff-8fff-fffffffffff2";

export function fulfilment(
  overrides: Partial<MerchantStateSnapshotFulfilmentV1> = {},
): MerchantStateSnapshotFulfilmentV1 {
  return {
    id: FULFILMENT_A,
    orderId: ORDER_ID,
    paymentId: PAYMENT_ID,
    triggerProcessingAttemptId: PROC_A,
    effectType: "FULFIL_ORDER",
    appliedAt: "2026-08-20T10:00:00.000Z",
    ...overrides,
  };
}

export interface SnapshotOptions {
  readonly orderPaymentStatus?: string;
  readonly orderBusinessStatus?: string;
  readonly orderAmountSubunits?: number;
  readonly orderCurrency?: string;
  readonly attemptStatus?: string;
  readonly paymentAmountSubunits?: number;
  readonly paymentCurrency?: string;
  readonly paymentCapturedAt?: string | null;
  readonly paymentFailedAt?: string | null;
  readonly fulfilments?: readonly MerchantStateSnapshotFulfilmentV1[] | null;
  readonly withOrder?: boolean;
  readonly withPaymentAttempt?: boolean;
  readonly withPayment?: boolean;
}

export function snapshot(
  options: SnapshotOptions = {},
): MerchantStateSnapshotV1 {
  const {
    orderPaymentStatus = "PAID",
    orderBusinessStatus = "FULFILLED",
    orderAmountSubunits = 50000,
    orderCurrency = "INR",
    attemptStatus = "CAPTURED",
    paymentAmountSubunits = 50000,
    paymentCurrency = "INR",
    paymentCapturedAt = "2026-08-20T09:59:00.000Z",
    paymentFailedAt = null,
    fulfilments = [fulfilment()],
    withOrder = true,
    withPaymentAttempt = true,
    withPayment = true,
  } = options;

  return {
    version: 1,
    order: withOrder
      ? {
          id: ORDER_ID,
          paymentStatus: orderPaymentStatus,
          businessStatus: orderBusinessStatus,
          amountSubunits: orderAmountSubunits,
          currency: orderCurrency,
        }
      : null,
    paymentAttempt: withPaymentAttempt
      ? {
          id: ATTEMPT_ID,
          orderId: ORDER_ID,
          status: attemptStatus,
          amountSubunits: orderAmountSubunits,
          currency: orderCurrency,
          razorpayOrderId: "order_TESTFIXTURE0001",
          razorpayOrderStatus: "paid",
        }
      : null,
    payment: withPayment
      ? {
          id: PAYMENT_ID,
          paymentAttemptId: ATTEMPT_ID,
          razorpayPaymentId: "pay_TESTFIXTURE0001",
          razorpayPaymentStatus: "captured",
          amountSubunits: paymentAmountSubunits,
          currency: paymentCurrency,
          checkoutSignatureVerified: true,
          capturedAt: paymentCapturedAt,
          failedAt: paymentFailedAt,
        }
      : null,
    fulfilments: fulfilments === null ? null : [...fulfilments],
  };
}

export function attempt(
  overrides: Partial<ProcessingAttemptEvidence> = {},
): ProcessingAttemptEvidence {
  return {
    id: PROC_A,
    webhookEventId: WEBHOOK_ID,
    chaosRunId: null,
    sourceKind: "REAL_RAZORPAY_WEBHOOK",
    status: "SUCCEEDED",
    isDuplicateDelivery: false,
    paymentAttemptId: ATTEMPT_ID,
    paymentId: PAYMENT_ID,
    errorCode: null,
    startedAt: "2026-08-20T09:58:00.000Z",
    finishedAt: "2026-08-20T10:00:00.000Z",
    stateBefore: { kind: "CAPTURED", snapshot: snapshot() },
    stateAfter: { kind: "CAPTURED", snapshot: snapshot() },
    ...overrides,
  };
}

export function webhook(
  overrides: Partial<SafeWebhookEvidence> = {},
): SafeWebhookEvidence {
  return {
    id: WEBHOOK_ID,
    razorpayEventId: "evt_TESTFIXTURE0001",
    eventType: "payment.captured",
    sourceKind: "REAL_RAZORPAY_WEBHOOK",
    signatureVerified: true,
    processingStatus: "PROCESSED",
    duplicateDeliveryCount: 0,
    receivedAt: "2026-08-20T09:57:00.000Z",
    paymentAttemptId: ATTEMPT_ID,
    paymentId: PAYMENT_ID,
    razorpayPaymentId: "pay_TESTFIXTURE0001",
    amountSubunits: 50000,
    currency: "INR",
    ...overrides,
  };
}

export function c11Scenario(
  overrides: Partial<Extract<ScenarioEvidence, { scenarioId: "C11" }>> = {},
): ScenarioEvidence {
  return {
    scenarioId: "C11",
    observedShape: "A_OBSERVATION",
    expectedReplayAttemptCount: 0,
    observedReplayAttemptCount: 0,
    chaosLinkedProcessingAttemptCount: 0,
    originalProcessingAttemptCount: 1,
    authoritativeOriginalProcessingAttemptId: PROC_A,
    sourceEventTypeIsPaymentFailed: false,
    ...overrides,
  };
}

export function c01Scenario(
  overrides: Partial<Extract<ScenarioEvidence, { scenarioId: "C01" }>> = {},
): ScenarioEvidence {
  return {
    scenarioId: "C01",
    expectedReplayAttemptCount: 2,
    observedReplayAttemptCount: 1,
    chaosLinkedProcessingAttemptCount: 1,
    originalProcessingAttemptCount: 1,
    authoritativeOriginalProcessingAttemptId: PROC_A,
    ...overrides,
  };
}

export function c03Scenario(
  overrides: Partial<Extract<ScenarioEvidence, { scenarioId: "C03" }>> = {},
): ScenarioEvidence {
  return {
    scenarioId: "C03",
    verificationChecks: [
      { case: "WRONG_SIGNATURE", classification: "REJECTED" },
      { case: "MISSING_SIGNATURE", classification: "REJECTED" },
    ],
    sourceWebhookLinked: false,
    orderLinked: false,
    paymentAttemptLinked: false,
    paymentLinked: false,
    chaosLinkedProcessingAttemptCount: 0,
    mutationEvidence: null,
    ...overrides,
  };
}

/** A complete, unchanged C03 mutation snapshot side. */
export function c03Side(
  overrides: Partial<C03MutationSnapshotEvidence> = {},
): C03MutationSnapshotEvidence {
  return {
    orders: { count: 1, rows: [snapshot().order!], complete: true },
    paymentAttempts: {
      count: 1,
      rows: [snapshot().paymentAttempt!],
      complete: true,
    },
    payments: { count: 1, rows: [snapshot().payment!], complete: true },
    fulfilments: { count: 1, rows: [fulfilment()], complete: true },
    trustedWebhookEvents: { count: 1, ids: [WEBHOOK_ID], complete: true },
    ...overrides,
  };
}

export interface BundleOptions {
  readonly scenarioId?: "C01" | "C03" | "C07" | "C11";
  readonly orderId?: string | null;
  readonly paymentAttemptId?: string | null;
  readonly paymentId?: string | null;
  readonly sourceWebhook?: SafeWebhookEvidence | null;
  readonly originalProcessingAttempts?: readonly ProcessingAttemptEvidence[];
  readonly chaosProcessingAttempts?: readonly ProcessingAttemptEvidence[];
  readonly canonicalSourceEventCount?: number | null;
  readonly authoritativeCapture?: AuthoritativeCaptureResolution;
  readonly authoritativeCaptureWebhook?: SafeWebhookEvidence | null;
  readonly scenarioEvidence?: ScenarioEvidence;
}

export function bundle(options: BundleOptions = {}): ChaosRunEvidenceBundleV1 {
  const {
    scenarioId = "C11",
    orderId = ORDER_ID,
    paymentAttemptId = ATTEMPT_ID,
    paymentId = PAYMENT_ID,
    sourceWebhook = webhook(),
    originalProcessingAttempts = [attempt()],
    chaosProcessingAttempts = [],
    canonicalSourceEventCount = 1,
    // The healthy default is the documented one-row-two-roles case: the
    // canonical source event IS the verified capture, so the same trusted row
    // legitimately appears as both `sourceWebhook` and
    // `authoritativeCaptureWebhook`, and the default processing attempt
    // (whose `webhookEventId` is WEBHOOK_ID) really is the capture processor.
    // A test that needs a SEPARATE capture event overrides both explicitly.
    authoritativeCapture = {
      kind: "EXACTLY_ONE",
      webhook: webhook(),
    } as AuthoritativeCaptureResolution,
    authoritativeCaptureWebhook = webhook(),
    scenarioEvidence = c11Scenario(),
  } = options;

  return {
    version: 1,
    run: {
      id: RUN_ID,
      scenarioId,
      status: "COMPLETED",
      outcome: "UNKNOWN",
      faultType: null,
      dataClassification: "SYNTHETIC_DEMO",
      orderId,
      paymentAttemptId,
      paymentId,
      sourceWebhookEventId: sourceWebhook?.id ?? null,
      failedPrecheckId: null,
      executionBlockCode: null,
      startedAt: "2026-08-20T09:57:00.000Z",
      completedAt: "2026-08-20T10:01:00.000Z",
    },
    requiredInvariantIds: [],
    sourceWebhook,
    originalProcessingAttempts: [...originalProcessingAttempts],
    chaosProcessingAttempts: [...chaosProcessingAttempts],
    canonicalSourceEventCount,
    authoritativeCapture,
    authoritativeCaptureWebhook,
    scenarioEvidence,
    evidenceRefs: [],
    gaps: [],
  };
}

/** Returns a bundle with every order-independent array reversed. */
export function shuffled(
  input: ChaosRunEvidenceBundleV1,
): ChaosRunEvidenceBundleV1 {
  const reverseSnapshotFulfilments = (
    attemptEvidence: ProcessingAttemptEvidence,
  ): ProcessingAttemptEvidence => {
    const flip = (parsed: ProcessingAttemptEvidence["stateBefore"]) =>
      parsed.kind === "CAPTURED" && parsed.snapshot.fulfilments !== null
        ? {
            kind: "CAPTURED" as const,
            snapshot: {
              ...parsed.snapshot,
              fulfilments: [...parsed.snapshot.fulfilments].reverse(),
            },
          }
        : parsed;
    return {
      ...attemptEvidence,
      stateBefore: flip(attemptEvidence.stateBefore),
      stateAfter: flip(attemptEvidence.stateAfter),
    };
  };

  return {
    ...input,
    originalProcessingAttempts: [...input.originalProcessingAttempts]
      .reverse()
      .map(reverseSnapshotFulfilments),
    chaosProcessingAttempts: [...input.chaosProcessingAttempts]
      .reverse()
      .map(reverseSnapshotFulfilments),
  };
}
