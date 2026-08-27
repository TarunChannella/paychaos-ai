import { beforeEach, describe, expect, it, vi } from "vitest";

// Phase 3D-B (correction round) — `lib/chaos/c07-execution-service.ts`
// exercised against FULLY MOCKED dependencies: the run repository, the
// read-only c07-repository, the config validators, the reused Checkout
// signature verifier, and the logger. Deeper evidence-resolution shape
// nuances live in tests/unit/chaos/c07-repository.test.ts (that file mocks
// this module entirely).

vi.mock("server-only", () => ({}));

class FakeEnvValidationError extends Error {
  readonly variable: string;
  constructor(variable: string) {
    super(`${variable} is invalid`);
    this.name = "EnvValidationError";
    this.variable = variable;
  }
}

const getOrderBaselineMock = vi.fn();
vi.mock("@/lib/chaos/repository", () => ({
  getOrderBaseline: getOrderBaselineMock,
  isFreshBaseline: (baseline: {
    paymentStatus: string;
    businessStatus: string;
    fulfilmentCount: number;
  }) =>
    baseline.paymentStatus === "UNPAID" &&
    baseline.businessStatus === "OPEN" &&
    baseline.fulfilmentCount === 0,
}));

// Real (non-mocked) exact-shape validators — pure functions, safe to use
// for real so this file proves genuine integration with the actual
// Blocker-3 validator, not a re-implemented stand-in.
const resolveActiveArmedC07FaultForOrderMock = vi.fn();
const resolveC07ConvergenceEvidenceMock = vi.fn();
const resolveTrustedPaymentAttemptForC07Mock = vi.fn();
vi.mock("@/lib/chaos/c07-repository", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/chaos/c07-repository")>();
  return {
    ...actual,
    resolveActiveArmedC07FaultForOrder: resolveActiveArmedC07FaultForOrderMock,
    resolveC07ConvergenceEvidence: resolveC07ConvergenceEvidenceMock,
    resolveTrustedPaymentAttemptForC07: resolveTrustedPaymentAttemptForC07Mock,
  };
});

const getChaosRunByIdMock = vi.fn();
const blockPendingC07RunForPreSec007Mock = vi.fn();
const startPendingC07RunAtomicallyMock = vi.fn();
const consumeC07ClientConfirmationDropMock = vi.fn();
const completeRunningC07RunWithEvidenceMock = vi.fn();
const cancelRunningC07FaultRepoMock = vi.fn();
vi.mock("@/lib/chaos/run-repository", () => ({
  getChaosRunById: getChaosRunByIdMock,
  blockPendingC07RunForPreSec007: blockPendingC07RunForPreSec007Mock,
  startPendingC07RunAtomically: startPendingC07RunAtomicallyMock,
  consumeC07ClientConfirmationDrop: consumeC07ClientConfirmationDropMock,
  completeRunningC07RunWithEvidence: completeRunningC07RunWithEvidenceMock,
  cancelRunningC07Fault: cancelRunningC07FaultRepoMock,
}));

const getRazorpayEnvMock = vi.fn();
vi.mock("@/lib/config/razorpay-env", () => ({
  getRazorpayEnv: getRazorpayEnvMock,
}));

const getRazorpayWebhookSecretMock = vi.fn();
vi.mock("@/lib/config/razorpay-webhook-env", () => ({
  getRazorpayWebhookSecret: getRazorpayWebhookSecretMock,
}));

const verifyCheckoutSignatureMock = vi.fn();
vi.mock("@/lib/razorpay/checkout-verification", () => ({
  verifyCheckoutSignature: verifyCheckoutSignatureMock,
}));

const logEventMock = vi.fn();
vi.mock("@/lib/security/logger", () => ({ logEvent: logEventMock }));

const RUN_ID = "11111111-1111-1111-1111-111111111111";
const ORDER_ID = "22222222-2222-2222-2222-222222222222";
const ATTEMPT_ID = "33333333-3333-3333-3333-333333333333";
const TRUSTED_RAZORPAY_ORDER_ID = "order_trusted_abc123";

const VALID_CONFIRMATION_INPUT = {
  paymentAttemptId: ATTEMPT_ID,
  razorpayPaymentId: "pay_fake_xyz789",
  razorpayOrderId: TRUSTED_RAZORPAY_ORDER_ID,
  razorpaySignature: "a".repeat(64),
};

function makePendingRun(overrides: Record<string, unknown> = {}) {
  return {
    id: RUN_ID,
    scenario_id: "C07",
    order_id: ORDER_ID,
    payment_attempt_id: null,
    payment_id: null,
    source_webhook_event_id: null,
    status: "PENDING",
    outcome: null,
    fault_type: "DROP_CLIENT_CONFIRMATION",
    failed_precheck_id: null,
    execution_block_code: null,
    fault_config: {},
    fault_state: {},
    data_classification: "RECORDED_TEST_EVIDENCE",
    error_message_redacted: null,
    started_at: null,
    completed_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeRunningArmedRun(
  overrides: Record<string, unknown> = {},
  faultState: Record<string, unknown> = { armed: true, consumed: false },
) {
  return makePendingRun({
    status: "RUNNING",
    started_at: "2026-01-01T00:01:00.000Z",
    fault_state: faultState,
    ...overrides,
  });
}

function makeFreshBaseline() {
  return {
    orderId: ORDER_ID,
    paymentStatus: "UNPAID",
    businessStatus: "OPEN",
    fulfilmentCount: 0,
  };
}

function makeTrustedAttempt(overrides: Record<string, unknown> = {}) {
  return {
    id: ATTEMPT_ID,
    order_id: ORDER_ID,
    razorpay_order_id: TRUSTED_RAZORPAY_ORDER_ID,
    ...overrides,
  };
}

beforeEach(() => {
  getOrderBaselineMock.mockReset();
  resolveActiveArmedC07FaultForOrderMock.mockReset();
  resolveC07ConvergenceEvidenceMock.mockReset();
  resolveTrustedPaymentAttemptForC07Mock.mockReset();
  getChaosRunByIdMock.mockReset();
  blockPendingC07RunForPreSec007Mock.mockReset();
  startPendingC07RunAtomicallyMock.mockReset();
  consumeC07ClientConfirmationDropMock.mockReset();
  completeRunningC07RunWithEvidenceMock.mockReset();
  cancelRunningC07FaultRepoMock.mockReset();
  getRazorpayEnvMock.mockReset();
  getRazorpayWebhookSecretMock.mockReset();
  verifyCheckoutSignatureMock.mockReset();
  logEventMock.mockReset();
});

async function importService() {
  return import("@/lib/chaos/c07-execution-service");
}

function passPreSec007() {
  getRazorpayEnvMock.mockReturnValue({
    mode: "test",
    keyId: "rzp_test_fake",
    keySecret: "fake",
  });
  getRazorpayWebhookSecretMock.mockReturnValue("fake-secret-not-real");
}

function failPreSec007() {
  getRazorpayEnvMock.mockImplementation(() => {
    throw new FakeEnvValidationError("RAZORPAY_KEY_SECRET");
  });
}

describe("armC07ClientConfirmationDrop", () => {
  it("1: an eligible PENDING C07 run with a fresh order arms successfully", async () => {
    getChaosRunByIdMock.mockResolvedValue(makePendingRun());
    getOrderBaselineMock.mockResolvedValue(makeFreshBaseline());
    passPreSec007();
    startPendingC07RunAtomicallyMock.mockResolvedValue({
      kind: "STARTED",
      run: makeRunningArmedRun(),
    });

    const { armC07ClientConfirmationDrop } = await importService();
    const result = await armC07ClientConfirmationDrop(RUN_ID);

    expect(result).toEqual({ kind: "ARMED", chaosRunId: RUN_ID });
  }, 20_000);

  it("2: wrong scenario is rejected", async () => {
    getChaosRunByIdMock.mockResolvedValue(
      makePendingRun({ scenario_id: "C03" }),
    );

    const { armC07ClientConfirmationDrop } = await importService();
    const result = await armC07ClientConfirmationDrop(RUN_ID);

    expect(result).toEqual({
      kind: "NOT_STARTABLE",
      reasonCategory: "RUN_NOT_ELIGIBLE",
    });
  });

  it("7: a PRE-SEC-007 config failure durably BLOCKs the same row", async () => {
    getChaosRunByIdMock.mockResolvedValue(makePendingRun());
    getOrderBaselineMock.mockResolvedValue(makeFreshBaseline());
    failPreSec007();
    blockPendingC07RunForPreSec007Mock.mockResolvedValue(
      makePendingRun({
        status: "COMPLETED",
        outcome: "BLOCKED",
        execution_block_code: "PRE-SEC-007",
        completed_at: "2026-01-01T00:02:00.000Z",
      }),
    );

    const { armC07ClientConfirmationDrop } = await importService();
    const result = await armC07ClientConfirmationDrop(RUN_ID);

    expect(result).toEqual({ kind: "BLOCKED_PRE_SEC_007", chaosRunId: RUN_ID });
    expect(startPendingC07RunAtomicallyMock).not.toHaveBeenCalled();
  });

  it("8: BLOCK repository returns an unexpected shape never claims BLOCKED", async () => {
    getChaosRunByIdMock.mockResolvedValue(makePendingRun());
    getOrderBaselineMock.mockResolvedValue(makeFreshBaseline());
    failPreSec007();
    blockPendingC07RunForPreSec007Mock.mockResolvedValue(makePendingRun());

    const { armC07ClientConfirmationDrop } = await importService();
    const result = await armC07ClientConfirmationDrop(RUN_ID);

    expect(result).toEqual({
      kind: "BLOCK_PERSISTENCE_FAILED",
      chaosRunId: RUN_ID,
    });
  });

  it("9: losing the atomic arm-claim race prevents any fault", async () => {
    getChaosRunByIdMock.mockResolvedValue(makePendingRun());
    getOrderBaselineMock.mockResolvedValue(makeFreshBaseline());
    passPreSec007();
    startPendingC07RunAtomicallyMock.mockResolvedValue({
      kind: "NOT_ELIGIBLE",
    });

    const { armC07ClientConfirmationDrop } = await importService();
    const result = await armC07ClientConfirmationDrop(RUN_ID);

    expect(result).toEqual({
      kind: "NOT_STARTABLE",
      reasonCategory: "ALREADY_STARTED_OR_NOT_PENDING",
    });
  });

  it("10: a same-order unique-index conflict maps to ALREADY_ARMED_FOR_ORDER", async () => {
    getChaosRunByIdMock.mockResolvedValue(makePendingRun());
    getOrderBaselineMock.mockResolvedValue(makeFreshBaseline());
    passPreSec007();
    startPendingC07RunAtomicallyMock.mockResolvedValue({
      kind: "ALREADY_ARMED_FOR_ORDER",
    });

    const { armC07ClientConfirmationDrop } = await importService();
    const result = await armC07ClientConfirmationDrop(RUN_ID);

    expect(result).toEqual({
      kind: "NOT_STARTABLE",
      reasonCategory: "ALREADY_ARMED_FOR_ORDER",
    });
  });

  it("11: ARMED is only ever claimed with the exact fixed fault_state shape", async () => {
    getChaosRunByIdMock.mockResolvedValue(makePendingRun());
    getOrderBaselineMock.mockResolvedValue(makeFreshBaseline());
    passPreSec007();
    startPendingC07RunAtomicallyMock.mockResolvedValue({
      kind: "STARTED",
      run: makeRunningArmedRun({}, { armed: true, consumed: true }),
    });

    const { armC07ClientConfirmationDrop } = await importService();
    const result = await armC07ClientConfirmationDrop(RUN_ID);

    expect(result).toEqual({
      kind: "NOT_STARTABLE",
      reasonCategory: "ARM_PERSISTENCE_UNVERIFIED",
    });
  });

  it("11b: an extra-key fault_state on the returned row is rejected as unverified", async () => {
    getChaosRunByIdMock.mockResolvedValue(makePendingRun());
    getOrderBaselineMock.mockResolvedValue(makeFreshBaseline());
    passPreSec007();
    startPendingC07RunAtomicallyMock.mockResolvedValue({
      kind: "STARTED",
      run: makeRunningArmedRun(
        {},
        { armed: true, consumed: false, extra: "x" },
      ),
    });

    const { armC07ClientConfirmationDrop } = await importService();
    const result = await armC07ClientConfirmationDrop(RUN_ID);

    expect(result).toEqual({
      kind: "NOT_STARTABLE",
      reasonCategory: "ARM_PERSISTENCE_UNVERIFIED",
    });
  });

  it("12: no caller-supplied fault_state/config — the exported function accepts only chaosRunId", async () => {
    const { armC07ClientConfirmationDrop } = await importService();
    expect(armC07ClientConfirmationDrop.length).toBe(1);
  });
});

describe("checkAndSuppressC07ClientConfirmation — authenticated first consume (Blocker 1)", () => {
  it("13: no active C07 fault leaves normal verification possible", async () => {
    resolveTrustedPaymentAttemptForC07Mock.mockResolvedValue(
      makeTrustedAttempt(),
    );
    resolveActiveArmedC07FaultForOrderMock.mockResolvedValue(null);

    const { checkAndSuppressC07ClientConfirmation } = await importService();
    const result = await checkAndSuppressC07ClientConfirmation(
      VALID_CONFIRMATION_INPUT,
    );

    expect(result).toEqual({ kind: "NOT_SUPPRESSED" });
    expect(verifyCheckoutSignatureMock).not.toHaveBeenCalled();
  });

  it("1: active/unconsumed C07 + valid Checkout signature consumes exactly once", async () => {
    resolveTrustedPaymentAttemptForC07Mock.mockResolvedValue(
      makeTrustedAttempt(),
    );
    resolveActiveArmedC07FaultForOrderMock.mockResolvedValue(
      makeRunningArmedRun(),
    );
    verifyCheckoutSignatureMock.mockReturnValue(true);
    consumeC07ClientConfirmationDropMock.mockResolvedValue(
      makeRunningArmedRun({}, { armed: true, consumed: true }),
    );

    const { checkAndSuppressC07ClientConfirmation } = await importService();
    const result = await checkAndSuppressC07ClientConfirmation(
      VALID_CONFIRMATION_INPUT,
    );

    expect(result).toEqual({ kind: "SUPPRESSED", chaosRunId: RUN_ID });
    expect(consumeC07ClientConfirmationDropMock).toHaveBeenCalledTimes(1);
    expect(consumeC07ClientConfirmationDropMock).toHaveBeenCalledWith(RUN_ID);
  });

  it("2: the verifier receives the TRUSTED persisted razorpay_order_id, never the browser value, as trustedRazorpayOrderId", async () => {
    resolveTrustedPaymentAttemptForC07Mock.mockResolvedValue(
      makeTrustedAttempt({ razorpay_order_id: "order_trusted_real" }),
    );
    resolveActiveArmedC07FaultForOrderMock.mockResolvedValue(
      makeRunningArmedRun(),
    );
    verifyCheckoutSignatureMock.mockReturnValue(true);
    consumeC07ClientConfirmationDropMock.mockResolvedValue(
      makeRunningArmedRun({}, { armed: true, consumed: true }),
    );

    const { checkAndSuppressC07ClientConfirmation } = await importService();
    await checkAndSuppressC07ClientConfirmation({
      ...VALID_CONFIRMATION_INPUT,
      razorpayOrderId: "order_trusted_real",
    });

    expect(verifyCheckoutSignatureMock).toHaveBeenCalledWith({
      trustedRazorpayOrderId: "order_trusted_real",
      razorpayPaymentId: VALID_CONFIRMATION_INPUT.razorpayPaymentId,
      razorpaySignature: VALID_CONFIRMATION_INPUT.razorpaySignature,
    });
  });

  it("3: a browser order-id mismatch never calls the verifier or consume", async () => {
    resolveTrustedPaymentAttemptForC07Mock.mockResolvedValue(
      makeTrustedAttempt({ razorpay_order_id: "order_trusted_real" }),
    );
    resolveActiveArmedC07FaultForOrderMock.mockResolvedValue(
      makeRunningArmedRun(),
    );

    const { checkAndSuppressC07ClientConfirmation } = await importService();
    const result = await checkAndSuppressC07ClientConfirmation({
      ...VALID_CONFIRMATION_INPUT,
      razorpayOrderId: "order_attacker_controlled",
    });

    expect(result).toEqual({
      kind: "REJECTED_INVALID_CONFIRMATION",
      reasonCategory: "ORDER_MISMATCH",
    });
    expect(verifyCheckoutSignatureMock).not.toHaveBeenCalled();
    expect(consumeC07ClientConfirmationDropMock).not.toHaveBeenCalled();
  });

  it("missing trusted razorpay_order_id on the attempt is rejected before any signature check", async () => {
    resolveTrustedPaymentAttemptForC07Mock.mockResolvedValue(
      makeTrustedAttempt({ razorpay_order_id: null }),
    );
    resolveActiveArmedC07FaultForOrderMock.mockResolvedValue(
      makeRunningArmedRun(),
    );

    const { checkAndSuppressC07ClientConfirmation } = await importService();
    const result = await checkAndSuppressC07ClientConfirmation(
      VALID_CONFIRMATION_INPUT,
    );

    expect(result).toEqual({
      kind: "REJECTED_INVALID_CONFIRMATION",
      reasonCategory: "TRUSTED_RAZORPAY_ORDER_MISSING",
    });
    expect(verifyCheckoutSignatureMock).not.toHaveBeenCalled();
  });

  it("4/5: an invalid signature never consumes and never calls verifyCheckoutAndPersistPayment (proven by consume never being invoked)", async () => {
    resolveTrustedPaymentAttemptForC07Mock.mockResolvedValue(
      makeTrustedAttempt(),
    );
    resolveActiveArmedC07FaultForOrderMock.mockResolvedValue(
      makeRunningArmedRun(),
    );
    verifyCheckoutSignatureMock.mockReturnValue(false);

    const { checkAndSuppressC07ClientConfirmation } = await importService();
    const result = await checkAndSuppressC07ClientConfirmation(
      VALID_CONFIRMATION_INPUT,
    );

    expect(result).toEqual({
      kind: "REJECTED_INVALID_CONFIRMATION",
      reasonCategory: "SIGNATURE_INVALID",
    });
    expect(consumeC07ClientConfirmationDropMock).not.toHaveBeenCalled();
  });

  it("a verifier configuration failure is reported as VERIFICATION_UNAVAILABLE, never consumes", async () => {
    resolveTrustedPaymentAttemptForC07Mock.mockResolvedValue(
      makeTrustedAttempt(),
    );
    resolveActiveArmedC07FaultForOrderMock.mockResolvedValue(
      makeRunningArmedRun(),
    );
    verifyCheckoutSignatureMock.mockImplementation(() => {
      throw new FakeEnvValidationError("RAZORPAY_KEY_SECRET");
    });

    const { checkAndSuppressC07ClientConfirmation } = await importService();
    const result = await checkAndSuppressC07ClientConfirmation(
      VALID_CONFIRMATION_INPUT,
    );

    expect(result).toEqual({
      kind: "REJECTED_INVALID_CONFIRMATION",
      reasonCategory: "VERIFICATION_UNAVAILABLE",
    });
    expect(consumeC07ClientConfirmationDropMock).not.toHaveBeenCalled();
  });

  it("6: active consumed=true retry still suppresses without re-verification", async () => {
    resolveTrustedPaymentAttemptForC07Mock.mockResolvedValue(
      makeTrustedAttempt(),
    );
    resolveActiveArmedC07FaultForOrderMock.mockResolvedValue(
      makeRunningArmedRun({}, { armed: true, consumed: true }),
    );

    const { checkAndSuppressC07ClientConfirmation } = await importService();
    const result = await checkAndSuppressC07ClientConfirmation(
      VALID_CONFIRMATION_INPUT,
    );

    expect(result).toEqual({ kind: "SUPPRESSED", chaosRunId: RUN_ID });
    expect(verifyCheckoutSignatureMock).not.toHaveBeenCalled();
    expect(consumeC07ClientConfirmationDropMock).not.toHaveBeenCalled();
  });

  it("a concurrent consume race — the loser re-reads and still suppresses", async () => {
    resolveTrustedPaymentAttemptForC07Mock.mockResolvedValue(
      makeTrustedAttempt(),
    );
    resolveActiveArmedC07FaultForOrderMock
      .mockResolvedValueOnce(makeRunningArmedRun())
      .mockResolvedValueOnce(
        makeRunningArmedRun({}, { armed: true, consumed: true }),
      );
    verifyCheckoutSignatureMock.mockReturnValue(true);
    consumeC07ClientConfirmationDropMock.mockResolvedValue(null);

    const { checkAndSuppressC07ClientConfirmation } = await importService();
    const result = await checkAndSuppressC07ClientConfirmation(
      VALID_CONFIRMATION_INPUT,
    );

    expect(result).toEqual({ kind: "SUPPRESSED", chaosRunId: RUN_ID });
  });

  it("cancelled between lookup and consume — the re-read finds no active fault, normal verification may proceed", async () => {
    resolveTrustedPaymentAttemptForC07Mock.mockResolvedValue(
      makeTrustedAttempt(),
    );
    resolveActiveArmedC07FaultForOrderMock
      .mockResolvedValueOnce(makeRunningArmedRun())
      .mockResolvedValueOnce(null);
    verifyCheckoutSignatureMock.mockReturnValue(true);
    consumeC07ClientConfirmationDropMock.mockResolvedValue(null);

    const { checkAndSuppressC07ClientConfirmation } = await importService();
    const result = await checkAndSuppressC07ClientConfirmation(
      VALID_CONFIRMATION_INPUT,
    );

    expect(result).toEqual({ kind: "NOT_SUPPRESSED" });
  });

  it("an unrelated order is never suppressed", async () => {
    resolveTrustedPaymentAttemptForC07Mock.mockResolvedValue(
      makeTrustedAttempt({ order_id: "99999999-9999-9999-9999-999999999999" }),
    );
    resolveActiveArmedC07FaultForOrderMock.mockResolvedValue(null);

    const { checkAndSuppressC07ClientConfirmation } = await importService();
    const result = await checkAndSuppressC07ClientConfirmation(
      VALID_CONFIRMATION_INPUT,
    );

    expect(result).toEqual({ kind: "NOT_SUPPRESSED" });
  });

  it("no caller-supplied chaosRunId/fault/scenario field — the input type carries only the four Checkout fields", async () => {
    const source = (await import("node:fs")).readFileSync(
      (await import("node:path")).resolve(
        import.meta.dirname,
        "../../../lib/chaos/c07-execution-service.ts",
      ),
      "utf-8",
    );
    const match = source.match(
      /export interface C07CheckoutConfirmationInput \{([\s\S]*?)\}/,
    );
    expect(match).not.toBeNull();
    const body = match![1]!;
    expect(body).toMatch(/paymentAttemptId/);
    expect(body).toMatch(/razorpayPaymentId/);
    expect(body).toMatch(/razorpayOrderId/);
    expect(body).toMatch(/razorpaySignature/);
    expect(body).not.toMatch(/chaosRunId/i);
    expect(body).not.toMatch(/scenario/i);
    expect(body).not.toMatch(/fault/i);
    expect(body).not.toMatch(/authorized/i);
  });
});

describe("reconcileC07ClientConfirmationDrop", () => {
  it("20: consumed=false returns FAULT_NOT_CONSUMED and never completes", async () => {
    getChaosRunByIdMock.mockResolvedValue(
      makeRunningArmedRun({}, { armed: true, consumed: false }),
    );

    const { reconcileC07ClientConfirmationDrop } = await importService();
    const result = await reconcileC07ClientConfirmationDrop(RUN_ID);

    expect(result).toEqual({ kind: "FAULT_NOT_CONSUMED", chaosRunId: RUN_ID });
    expect(resolveC07ConvergenceEvidenceMock).not.toHaveBeenCalled();
    expect(completeRunningC07RunWithEvidenceMock).not.toHaveBeenCalled();
  });

  it("21: consumed=true but no convergence evidence yet returns NOT_YET_CONVERGED", async () => {
    getChaosRunByIdMock.mockResolvedValue(
      makeRunningArmedRun({}, { armed: true, consumed: true }),
    );
    resolveC07ConvergenceEvidenceMock.mockResolvedValue(null);

    const { reconcileC07ClientConfirmationDrop } = await importService();
    const result = await reconcileC07ClientConfirmationDrop(RUN_ID);

    expect(result).toEqual({ kind: "NOT_YET_CONVERGED", chaosRunId: RUN_ID });
  });

  it("7/10: a malformed fault_state on the run fails closed as NOT_RECONCILABLE, never as FAULT_NOT_CONSUMED or NOT_YET_CONVERGED", async () => {
    getChaosRunByIdMock.mockResolvedValue(
      makeRunningArmedRun({}, { armed: true, consumed: false, extra: "x" }),
    );

    const { reconcileC07ClientConfirmationDrop } = await importService();
    const result = await reconcileC07ClientConfirmationDrop(RUN_ID);

    expect(result).toEqual({
      kind: "NOT_RECONCILABLE",
      reasonCategory: "RUN_NOT_ELIGIBLE",
    });
    expect(resolveC07ConvergenceEvidenceMock).not.toHaveBeenCalled();
  });

  const GENUINE_EVIDENCE = {
    paymentAttemptId: ATTEMPT_ID,
    paymentId: "44444444-4444-4444-4444-444444444444",
    webhookEventId: "55555555-5555-5555-5555-555555555555",
  };

  function makeValidCompletedRow(overrides: Record<string, unknown> = {}) {
    return makePendingRun({
      status: "COMPLETED",
      outcome: "UNKNOWN",
      payment_attempt_id: GENUINE_EVIDENCE.paymentAttemptId,
      payment_id: GENUINE_EVIDENCE.paymentId,
      source_webhook_event_id: GENUINE_EVIDENCE.webhookEventId,
      fault_state: { armed: true, consumed: true },
      started_at: "2026-01-01T00:01:00.000Z",
      completed_at: "2026-01-01T00:10:00.000Z",
      ...overrides,
    });
  }

  it("13: genuine correlated evidence completes to COMPLETED/UNKNOWN, populating the resolved evidence FKs", async () => {
    getChaosRunByIdMock.mockResolvedValue(
      makeRunningArmedRun({}, { armed: true, consumed: true }),
    );
    resolveC07ConvergenceEvidenceMock.mockResolvedValue(GENUINE_EVIDENCE);
    completeRunningC07RunWithEvidenceMock.mockResolvedValue(
      makeValidCompletedRow(),
    );

    const { reconcileC07ClientConfirmationDrop } = await importService();
    const result = await reconcileC07ClientConfirmationDrop(RUN_ID);

    expect(result).toEqual({ kind: "COMPLETED", chaosRunId: RUN_ID });
    expect(completeRunningC07RunWithEvidenceMock).toHaveBeenCalledWith(
      RUN_ID,
      ORDER_ID,
      {
        paymentAttemptId: GENUINE_EVIDENCE.paymentAttemptId,
        paymentId: GENUINE_EVIDENCE.paymentId,
        sourceWebhookEventId: GENUINE_EVIDENCE.webhookEventId,
      },
    );
  });

  it("13: a wrong returned status never claims COMPLETED", async () => {
    getChaosRunByIdMock.mockResolvedValue(
      makeRunningArmedRun({}, { armed: true, consumed: true }),
    );
    resolveC07ConvergenceEvidenceMock.mockResolvedValue(GENUINE_EVIDENCE);
    completeRunningC07RunWithEvidenceMock.mockResolvedValue(
      makeValidCompletedRow({ status: "RUNNING" }),
    );

    const { reconcileC07ClientConfirmationDrop } = await importService();
    const result = await reconcileC07ClientConfirmationDrop(RUN_ID);

    expect(result).toEqual({
      kind: "COMPLETION_PERSISTENCE_FAILED",
      chaosRunId: RUN_ID,
    });
  });

  it("14: a wrong evidence FK on the returned row never claims COMPLETED", async () => {
    getChaosRunByIdMock.mockResolvedValue(
      makeRunningArmedRun({}, { armed: true, consumed: true }),
    );
    resolveC07ConvergenceEvidenceMock.mockResolvedValue(GENUINE_EVIDENCE);
    completeRunningC07RunWithEvidenceMock.mockResolvedValue(
      makePendingRun({
        status: "COMPLETED",
        outcome: "UNKNOWN",
        payment_attempt_id: "wrong-attempt-id",
        payment_id: GENUINE_EVIDENCE.paymentId,
        source_webhook_event_id: GENUINE_EVIDENCE.webhookEventId,
        fault_state: { armed: true, consumed: true },
        started_at: "2026-01-01T00:01:00.000Z",
        completed_at: "2026-01-01T00:10:00.000Z",
      }),
    );

    const { reconcileC07ClientConfirmationDrop } = await importService();
    const result = await reconcileC07ClientConfirmationDrop(RUN_ID);

    expect(result).toEqual({
      kind: "COMPLETION_PERSISTENCE_FAILED",
      chaosRunId: RUN_ID,
    });
  });

  it("15: a malformed returned fault_state never claims COMPLETED", async () => {
    getChaosRunByIdMock.mockResolvedValue(
      makeRunningArmedRun({}, { armed: true, consumed: true }),
    );
    resolveC07ConvergenceEvidenceMock.mockResolvedValue(GENUINE_EVIDENCE);
    completeRunningC07RunWithEvidenceMock.mockResolvedValue(
      makeValidCompletedRow({
        fault_state: { armed: true, consumed: true, extra: "x" },
      }),
    );

    const { reconcileC07ClientConfirmationDrop } = await importService();
    const result = await reconcileC07ClientConfirmationDrop(RUN_ID);

    expect(result).toEqual({
      kind: "COMPLETION_PERSISTENCE_FAILED",
      chaosRunId: RUN_ID,
    });
  });

  it("16: completion persistence returning null maps safely", async () => {
    getChaosRunByIdMock.mockResolvedValue(
      makeRunningArmedRun({}, { armed: true, consumed: true }),
    );
    resolveC07ConvergenceEvidenceMock.mockResolvedValue(GENUINE_EVIDENCE);
    completeRunningC07RunWithEvidenceMock.mockResolvedValue(null);

    const { reconcileC07ClientConfirmationDrop } = await importService();
    const result = await reconcileC07ClientConfirmationDrop(RUN_ID);

    expect(result).toEqual({
      kind: "COMPLETION_PERSISTENCE_FAILED",
      chaosRunId: RUN_ID,
    });
  });

  it("Blocker B (4): a completion repository throw maps to COMPLETION_PERSISTENCE_FAILED, never propagates, never re-mutates", async () => {
    getChaosRunByIdMock.mockResolvedValue(
      makeRunningArmedRun({}, { armed: true, consumed: true }),
    );
    resolveC07ConvergenceEvidenceMock.mockResolvedValue(GENUINE_EVIDENCE);
    completeRunningC07RunWithEvidenceMock.mockRejectedValue(
      new Error("connection reset"),
    );

    const { reconcileC07ClientConfirmationDrop } = await importService();
    const result = await reconcileC07ClientConfirmationDrop(RUN_ID);

    expect(result).toEqual({
      kind: "COMPLETION_PERSISTENCE_FAILED",
      chaosRunId: RUN_ID,
    });
    expect(completeRunningC07RunWithEvidenceMock).toHaveBeenCalledTimes(1);
    const loggedCalls = logEventMock.mock.calls.filter(
      ([event]) =>
        event === "chaos_c07_reconcile_completion_persistence_failed",
    );
    expect(loggedCalls.length).toBeGreaterThan(0);
    for (const [, payload] of loggedCalls) {
      expect(JSON.stringify(payload)).not.toContain("connection reset");
    }
  });

  it("a transient reconciliation read error propagates and never disables the fault", async () => {
    getChaosRunByIdMock.mockResolvedValue(
      makeRunningArmedRun({}, { armed: true, consumed: true }),
    );
    resolveC07ConvergenceEvidenceMock.mockRejectedValue(
      new Error("transient read failure"),
    );

    const { reconcileC07ClientConfirmationDrop } = await importService();

    await expect(reconcileC07ClientConfirmationDrop(RUN_ID)).rejects.toThrow();
    expect(completeRunningC07RunWithEvidenceMock).not.toHaveBeenCalled();
    expect(cancelRunningC07FaultRepoMock).not.toHaveBeenCalled();
  });

  it("reconciliation is safe to call repeatedly before convergence", async () => {
    getChaosRunByIdMock.mockResolvedValue(
      makeRunningArmedRun({}, { armed: true, consumed: true }),
    );
    resolveC07ConvergenceEvidenceMock.mockResolvedValue(null);

    const { reconcileC07ClientConfirmationDrop } = await importService();
    const first = await reconcileC07ClientConfirmationDrop(RUN_ID);
    const second = await reconcileC07ClientConfirmationDrop(RUN_ID);

    expect(first).toEqual({ kind: "NOT_YET_CONVERGED", chaosRunId: RUN_ID });
    expect(second).toEqual({ kind: "NOT_YET_CONVERGED", chaosRunId: RUN_ID });
  });
});

describe("cancelRunningC07Fault", () => {
  it("a RUNNING C07 run with valid exact fault_state cancels to FAILED/ERROR", async () => {
    getChaosRunByIdMock.mockResolvedValue(
      makeRunningArmedRun({}, { armed: true, consumed: false }),
    );
    cancelRunningC07FaultRepoMock.mockResolvedValue(
      makePendingRun({
        status: "FAILED",
        outcome: "ERROR",
        started_at: "2026-01-01T00:01:00.000Z",
        completed_at: "2026-01-01T00:05:00.000Z",
        error_message_redacted: "cancelled",
        fault_state: { armed: true, consumed: false },
      }),
    );

    const { cancelRunningC07Fault } = await importService();
    const result = await cancelRunningC07Fault(RUN_ID);

    expect(result).toEqual({ kind: "CANCELLED", chaosRunId: RUN_ID });
    expect(cancelRunningC07FaultRepoMock).toHaveBeenCalledWith(
      RUN_ID,
      ORDER_ID,
      false,
      expect.any(String),
    );
  });

  it("Blocker A (1): a preState of consumed=false forwards expectedConsumed=false to the repository — never a raw fault_state object", async () => {
    getChaosRunByIdMock.mockResolvedValue(
      makeRunningArmedRun({}, { armed: true, consumed: false }),
    );
    cancelRunningC07FaultRepoMock.mockResolvedValue(
      makePendingRun({
        status: "FAILED",
        outcome: "ERROR",
        started_at: "2026-01-01T00:01:00.000Z",
        completed_at: "2026-01-01T00:05:00.000Z",
        error_message_redacted: "cancelled",
        fault_state: { armed: true, consumed: false },
      }),
    );

    const { cancelRunningC07Fault } = await importService();
    await cancelRunningC07Fault(RUN_ID);

    expect(cancelRunningC07FaultRepoMock).toHaveBeenCalledWith(
      RUN_ID,
      ORDER_ID,
      false,
      expect.any(String),
    );
  });

  it("Blocker A (2): a preState of consumed=true forwards expectedConsumed=true to the repository — never a raw fault_state object", async () => {
    getChaosRunByIdMock.mockResolvedValue(
      makeRunningArmedRun({}, { armed: true, consumed: true }),
    );
    cancelRunningC07FaultRepoMock.mockResolvedValue(
      makePendingRun({
        status: "FAILED",
        outcome: "ERROR",
        started_at: "2026-01-01T00:01:00.000Z",
        completed_at: "2026-01-01T00:05:00.000Z",
        error_message_redacted: "cancelled",
        fault_state: { armed: true, consumed: true },
      }),
    );

    const { cancelRunningC07Fault } = await importService();
    await cancelRunningC07Fault(RUN_ID);

    expect(cancelRunningC07FaultRepoMock).toHaveBeenCalledWith(
      RUN_ID,
      ORDER_ID,
      true,
      expect.any(String),
    );
  });

  it("Blocker B (3): a cancellation repository throw maps to CANCEL_PERSISTENCE_FAILED, never propagates, never re-mutates", async () => {
    getChaosRunByIdMock.mockResolvedValue(
      makeRunningArmedRun({}, { armed: true, consumed: false }),
    );
    cancelRunningC07FaultRepoMock.mockRejectedValue(
      new Error("connection reset"),
    );

    const { cancelRunningC07Fault } = await importService();
    const result = await cancelRunningC07Fault(RUN_ID);

    expect(result).toEqual({
      kind: "CANCEL_PERSISTENCE_FAILED",
      chaosRunId: RUN_ID,
    });
    expect(cancelRunningC07FaultRepoMock).toHaveBeenCalledTimes(1);
    // The safe log never leaks the raw error message.
    const loggedCalls = logEventMock.mock.calls.filter(
      ([event]) =>
        event === "chaos_c07_cancel_persistence_failed_or_unverified",
    );
    expect(loggedCalls.length).toBeGreaterThan(0);
    for (const [, payload] of loggedCalls) {
      expect(JSON.stringify(payload)).not.toContain("connection reset");
    }
  });

  it("17: a wrong returned status never claims CANCELLED", async () => {
    getChaosRunByIdMock.mockResolvedValue(
      makeRunningArmedRun({}, { armed: true, consumed: false }),
    );
    cancelRunningC07FaultRepoMock.mockResolvedValue(
      makeRunningArmedRun({}, { armed: true, consumed: false }),
    );

    const { cancelRunningC07Fault } = await importService();
    const result = await cancelRunningC07Fault(RUN_ID);

    expect(result).toEqual({
      kind: "CANCEL_PERSISTENCE_FAILED",
      chaosRunId: RUN_ID,
    });
  });

  it("18: a modified fault_state on the returned row (vs. the pre-cancel snapshot) never claims CANCELLED", async () => {
    getChaosRunByIdMock.mockResolvedValue(
      makeRunningArmedRun({}, { armed: true, consumed: false }),
    );
    // A concurrent consume raced in between the read and the cancel
    // mutation — the returned row's fault_state now disagrees with the
    // verified pre-cancel snapshot.
    cancelRunningC07FaultRepoMock.mockResolvedValue(
      makePendingRun({
        status: "FAILED",
        outcome: "ERROR",
        started_at: "2026-01-01T00:01:00.000Z",
        completed_at: "2026-01-01T00:05:00.000Z",
        error_message_redacted: "cancelled",
        fault_state: { armed: true, consumed: true },
      }),
    );

    const { cancelRunningC07Fault } = await importService();
    const result = await cancelRunningC07Fault(RUN_ID);

    expect(result).toEqual({
      kind: "CANCEL_PERSISTENCE_FAILED",
      chaosRunId: RUN_ID,
    });
  });

  it("19: cancellation persistence returning null maps safely", async () => {
    getChaosRunByIdMock.mockResolvedValue(
      makeRunningArmedRun({}, { armed: true, consumed: false }),
    );
    cancelRunningC07FaultRepoMock.mockResolvedValue(null);

    const { cancelRunningC07Fault } = await importService();
    const result = await cancelRunningC07Fault(RUN_ID);

    expect(result).toEqual({
      kind: "CANCEL_PERSISTENCE_FAILED",
      chaosRunId: RUN_ID,
    });
  });

  it("a PENDING run cannot be cancelled by this function", async () => {
    getChaosRunByIdMock.mockResolvedValue(makePendingRun());

    const { cancelRunningC07Fault } = await importService();
    const result = await cancelRunningC07Fault(RUN_ID);

    expect(result).toEqual({
      kind: "NOT_CANCELLABLE",
      reasonCategory: "RUN_NOT_RUNNING",
    });
    expect(cancelRunningC07FaultRepoMock).not.toHaveBeenCalled();
  });

  it("a COMPLETED run cannot be cancelled", async () => {
    getChaosRunByIdMock.mockResolvedValue(
      makePendingRun({ status: "COMPLETED", outcome: "UNKNOWN" }),
    );

    const { cancelRunningC07Fault } = await importService();
    const result = await cancelRunningC07Fault(RUN_ID);

    expect(result).toEqual({
      kind: "NOT_CANCELLABLE",
      reasonCategory: "RUN_NOT_RUNNING",
    });
  });

  it("a malformed pre-cancel fault_state is rejected before any mutation attempt", async () => {
    getChaosRunByIdMock.mockResolvedValue(
      makeRunningArmedRun({}, { armed: true, consumed: false, extra: "x" }),
    );

    const { cancelRunningC07Fault } = await importService();
    const result = await cancelRunningC07Fault(RUN_ID);

    expect(result).toEqual({
      kind: "NOT_CANCELLABLE",
      reasonCategory: "RUN_NOT_ELIGIBLE",
    });
    expect(cancelRunningC07FaultRepoMock).not.toHaveBeenCalled();
  });
});
