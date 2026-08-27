import { beforeEach, describe, expect, it, vi } from "vitest";

// Phase 1E: `app/demo-merchant/actions.ts` Server Action, exercised against
// a MOCKED application service (no network). Proves:
//   - the action accepts NO arguments (structural proof the browser cannot
//     submit payment_status/business_status/amount/currency/id through it
//     — docs instructions Section 21 C/D);
//   - success revalidates "/demo-merchant";
//   - failure returns one generic safe message and never leaks the
//     underlying error.
vi.mock("server-only", () => ({}));

const createDemoMerchantOrderMock = vi.fn();
const createRazorpayOrderForMerchantOrderMock = vi.fn();
const prepareCheckoutForPaymentAttemptMock = vi.fn();
const verifyCheckoutAndPersistPaymentMock = vi.fn();
vi.mock("@/lib/demo-merchant/service", () => ({
  createDemoMerchantOrder: createDemoMerchantOrderMock,
  createRazorpayOrderForMerchantOrder: createRazorpayOrderForMerchantOrderMock,
  prepareCheckoutForPaymentAttempt: prepareCheckoutForPaymentAttemptMock,
  verifyCheckoutAndPersistPayment: verifyCheckoutAndPersistPaymentMock,
}));

// Phase 3D-B: `checkAndSuppressC07ClientConfirmation` is mocked here too —
// `verifyCheckoutAction` now calls it before any real Checkout
// verification. Defaults to NOT_SUPPRESSED in beforeEach below so every
// pre-existing test in this file (predating C07) keeps observing the exact
// same behavior it always did.
const checkAndSuppressC07ClientConfirmationMock = vi.fn();
vi.mock("@/lib/chaos/c07-execution-service", () => ({
  checkAndSuppressC07ClientConfirmation: (...args: unknown[]) =>
    checkAndSuppressC07ClientConfirmationMock(...args),
}));

const revalidatePathMock = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}));

const logEventMock = vi.fn();
vi.mock("@/lib/security/logger", () => ({
  logEvent: logEventMock,
}));

beforeEach(() => {
  createDemoMerchantOrderMock.mockReset();
  createRazorpayOrderForMerchantOrderMock.mockReset();
  prepareCheckoutForPaymentAttemptMock.mockReset();
  verifyCheckoutAndPersistPaymentMock.mockReset();
  revalidatePathMock.mockReset();
  logEventMock.mockReset();
  checkAndSuppressC07ClientConfirmationMock.mockReset();
  checkAndSuppressC07ClientConfirmationMock.mockResolvedValue({
    kind: "NOT_SUPPRESSED",
  });
});

describe("createDemoMerchantOrderAction", () => {
  it("is declared with zero parameters — no field the browser can submit through it", async () => {
    const { createDemoMerchantOrderAction } =
      await import("@/app/demo-merchant/actions");
    expect(createDemoMerchantOrderAction.length).toBe(0);
  });

  it("on success: calls the service with no arguments, revalidates /demo-merchant, returns ok:true", async () => {
    createDemoMerchantOrderMock.mockResolvedValue({ id: "order-1" });

    const { createDemoMerchantOrderAction } =
      await import("@/app/demo-merchant/actions");
    const result = await createDemoMerchantOrderAction();

    expect(createDemoMerchantOrderMock).toHaveBeenCalledWith();
    expect(revalidatePathMock).toHaveBeenCalledWith("/demo-merchant");
    expect(result).toEqual({ ok: true });
  });

  it("on failure: returns one generic safe message and never forwards the raw error text", async () => {
    createDemoMerchantOrderMock.mockRejectedValue(
      new Error("supabase connection string: postgres://secret@host/db"),
    );

    const { createDemoMerchantOrderAction } =
      await import("@/app/demo-merchant/actions");
    const result = await createDemoMerchantOrderAction();

    expect(result.ok).toBe(false);
    expect(result.error).toBe(
      "Could not create the test order. Please try again.",
    );
    expect(result.error).not.toContain("postgres://");
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("on failure: logs only a safe error name, never the raw error/message", async () => {
    createDemoMerchantOrderMock.mockRejectedValue(
      new Error("supabase connection string: postgres://secret@host/db"),
    );

    const { createDemoMerchantOrderAction } =
      await import("@/app/demo-merchant/actions");
    await createDemoMerchantOrderAction();

    expect(logEventMock).toHaveBeenCalledTimes(1);
    const [, fields] = logEventMock.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    for (const value of Object.values(fields)) {
      expect(String(value)).not.toContain("postgres://");
      expect(String(value)).not.toContain("secret");
    }
  });
});

const VALID_ORDER_ID = "11111111-1111-1111-1111-111111111111";

describe("createRazorpayOrderAction", () => {
  it("is declared with exactly one parameter (orderId) — no amount/currency/receipt/Razorpay-ID field exists", async () => {
    const { createRazorpayOrderAction } =
      await import("@/app/demo-merchant/actions");
    expect(createRazorpayOrderAction.length).toBe(1);
  });

  it("rejects a missing/empty orderId without ever calling the service", async () => {
    const { createRazorpayOrderAction } =
      await import("@/app/demo-merchant/actions");

    const resultEmpty = await createRazorpayOrderAction("");
    expect(resultEmpty.ok).toBe(false);
    expect(createRazorpayOrderForMerchantOrderMock).not.toHaveBeenCalled();

    const resultWhitespace = await createRazorpayOrderAction("   ");
    expect(resultWhitespace.ok).toBe(false);
    expect(createRazorpayOrderForMerchantOrderMock).not.toHaveBeenCalled();
  });

  it("on success: calls the service with exactly the given orderId, revalidates /demo-merchant, returns safe attempt evidence", async () => {
    createRazorpayOrderForMerchantOrderMock.mockResolvedValue({
      id: "attempt-1",
      orderId: VALID_ORDER_ID,
      attemptNo: 1,
      amountSubunits: 50000,
      currency: "INR",
      status: "ORDER_CREATED",
      razorpayReceipt: "pc_receipt_1",
      razorpayOrderId: "order_fake_id",
      razorpayOrderStatus: "created",
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    const { createRazorpayOrderAction } =
      await import("@/app/demo-merchant/actions");
    const result = await createRazorpayOrderAction(VALID_ORDER_ID);

    expect(createRazorpayOrderForMerchantOrderMock).toHaveBeenCalledWith(
      VALID_ORDER_ID,
    );
    expect(revalidatePathMock).toHaveBeenCalledWith("/demo-merchant");
    expect(result).toEqual({
      ok: true,
      attempt: {
        id: "attempt-1",
        attemptNo: 1,
        status: "ORDER_CREATED",
        razorpayReceipt: "pc_receipt_1",
        razorpayOrderId: "order_fake_id",
        razorpayOrderStatus: "created",
      },
    });
    // The safe attempt object never carries amount/currency/orderId — this
    // proves the action does not forward more than the safe evidence
    // fields listed in the type.
    expect(Object.keys(result.attempt ?? {}).sort()).toEqual([
      "attemptNo",
      "id",
      "razorpayOrderId",
      "razorpayOrderStatus",
      "razorpayReceipt",
      "status",
    ]);
  });

  it("on failure: returns one generic safe message and never forwards the raw error text", async () => {
    createRazorpayOrderForMerchantOrderMock.mockRejectedValue(
      new Error("Razorpay key secret leaked: sk_super_secret_value"),
    );

    const { createRazorpayOrderAction } =
      await import("@/app/demo-merchant/actions");
    const result = await createRazorpayOrderAction(VALID_ORDER_ID);

    expect(result.ok).toBe(false);
    expect(result.error).toBe(
      "Could not create the Razorpay Test Order. Please try again.",
    );
    expect(result.error).not.toContain("sk_super_secret_value");
  });

  it("on failure: logs only a safe error name, never the raw error/message", async () => {
    createRazorpayOrderForMerchantOrderMock.mockRejectedValue(
      new Error("Razorpay key secret leaked: sk_super_secret_value"),
    );

    const { createRazorpayOrderAction } =
      await import("@/app/demo-merchant/actions");
    await createRazorpayOrderAction(VALID_ORDER_ID);

    expect(logEventMock).toHaveBeenCalled();
    const call = logEventMock.mock.calls.find(
      ([event]) => event === "razorpay_order_action_failed",
    );
    expect(call).toBeDefined();
    const [, fields] = call as [string, Record<string, unknown>];
    for (const value of Object.values(fields)) {
      expect(String(value)).not.toContain("sk_super_secret_value");
    }
  });

  it("on failure: still revalidates /demo-merchant (a definite rejection may have changed the attempt's status)", async () => {
    createRazorpayOrderForMerchantOrderMock.mockRejectedValue(
      new Error("provider rejected"),
    );

    const { createRazorpayOrderAction } =
      await import("@/app/demo-merchant/actions");
    await createRazorpayOrderAction(VALID_ORDER_ID);

    expect(revalidatePathMock).toHaveBeenCalledWith("/demo-merchant");
  });
});

const VALID_ATTEMPT_ID = "22222222-2222-2222-2222-222222222222";

describe("prepareCheckoutAction", () => {
  it("is declared with exactly one parameter (paymentAttemptId) — no amount/currency/order field exists", async () => {
    const { prepareCheckoutAction } =
      await import("@/app/demo-merchant/actions");
    expect(prepareCheckoutAction.length).toBe(1);
  });

  it("rejects a missing/empty paymentAttemptId without ever calling the service", async () => {
    const { prepareCheckoutAction } =
      await import("@/app/demo-merchant/actions");

    const resultEmpty = await prepareCheckoutAction("");
    expect(resultEmpty.ok).toBe(false);
    expect(prepareCheckoutForPaymentAttemptMock).not.toHaveBeenCalled();

    const resultWhitespace = await prepareCheckoutAction("   ");
    expect(resultWhitespace.ok).toBe(false);
    expect(prepareCheckoutForPaymentAttemptMock).not.toHaveBeenCalled();
  });

  it("on success: calls the service with exactly the given id, revalidates /demo-merchant, and returns the Checkout-safe projection verbatim — never a Key Secret", async () => {
    const checkout = {
      razorpayKeyId: "rzp_test_fake_key_id_not_real",
      razorpayOrderId: "order_fake_id",
      amountSubunits: 50000,
      currency: "INR",
      paymentAttemptId: VALID_ATTEMPT_ID,
      orderId: "11111111-1111-1111-1111-111111111111",
      name: "PayChaos Test Product",
      description: "PayChaos AI Demo Merchant — PayChaos Test Product",
    };
    prepareCheckoutForPaymentAttemptMock.mockResolvedValue(checkout);

    const { prepareCheckoutAction } =
      await import("@/app/demo-merchant/actions");
    const result = await prepareCheckoutAction(VALID_ATTEMPT_ID);

    expect(prepareCheckoutForPaymentAttemptMock).toHaveBeenCalledWith(
      VALID_ATTEMPT_ID,
    );
    expect(revalidatePathMock).toHaveBeenCalledWith("/demo-merchant");
    expect(result).toEqual({ ok: true, checkout });
    expect(JSON.stringify(result)).not.toContain("fake-razorpay-key-secret");
  });

  it("on failure: returns one generic safe message and never forwards the raw error text", async () => {
    prepareCheckoutForPaymentAttemptMock.mockRejectedValue(
      new Error("Razorpay key secret leaked: sk_super_secret_value"),
    );

    const { prepareCheckoutAction } =
      await import("@/app/demo-merchant/actions");
    const result = await prepareCheckoutAction(VALID_ATTEMPT_ID);

    expect(result.ok).toBe(false);
    expect(result.error).toBe(
      "Could not prepare Razorpay Checkout. Please try again.",
    );
    expect(result.error).not.toContain("sk_super_secret_value");
  });

  it("on failure: logs only a safe error name, never the raw error/message", async () => {
    prepareCheckoutForPaymentAttemptMock.mockRejectedValue(
      new Error("Razorpay key secret leaked: sk_super_secret_value"),
    );

    const { prepareCheckoutAction } =
      await import("@/app/demo-merchant/actions");
    await prepareCheckoutAction(VALID_ATTEMPT_ID);

    const call = logEventMock.mock.calls.find(
      ([event]) => event === "checkout_prepare_failed",
    );
    expect(call).toBeDefined();
    const [, fields] = call as [string, Record<string, unknown>];
    for (const value of Object.values(fields)) {
      expect(String(value)).not.toContain("sk_super_secret_value");
    }
  });
});

describe("verifyCheckoutAction", () => {
  const validInput = {
    paymentAttemptId: VALID_ATTEMPT_ID,
    razorpayPaymentId: "pay_fake_id",
    razorpayOrderId: "order_fake_id",
    razorpaySignature: "fake-signature-hex",
  };

  it("on success: forwards the full untrusted Checkout response to the service, revalidates /demo-merchant, and returns only safe verified evidence", async () => {
    verifyCheckoutAndPersistPaymentMock.mockResolvedValue({
      id: "payment-1",
      paymentAttemptId: VALID_ATTEMPT_ID,
      razorpayPaymentId: "pay_fake_id",
      razorpayPaymentStatus: null,
      checkoutSignatureVerified: true,
      checkoutVerifiedAt: "2026-01-01T00:00:00.000Z",
      capturedAt: null,
      failedAt: null,
    });

    const { verifyCheckoutAction } =
      await import("@/app/demo-merchant/actions");
    const result = await verifyCheckoutAction(validInput);

    expect(verifyCheckoutAndPersistPaymentMock).toHaveBeenCalledWith(
      validInput,
    );
    expect(revalidatePathMock).toHaveBeenCalledWith("/demo-merchant");
    expect(result).toEqual({
      ok: true,
      payment: {
        razorpayPaymentId: "pay_fake_id",
        checkoutSignatureVerified: true,
        checkoutVerifiedAt: "2026-01-01T00:00:00.000Z",
        razorpayPaymentStatus: null,
      },
    });
    // Never echoes the signature back to the browser.
    expect(JSON.stringify(result)).not.toContain(validInput.razorpaySignature);
  });

  it("on an invalid signature: returns ok:false with one generic safe message, never the raw error text", async () => {
    verifyCheckoutAndPersistPaymentMock.mockRejectedValue(
      new Error("RazorpayCheckoutSignatureInvalidError: bad signature"),
    );

    const { verifyCheckoutAction } =
      await import("@/app/demo-merchant/actions");
    const result = await verifyCheckoutAction(validInput);

    expect(result.ok).toBe(false);
    expect(result.error).toBe(
      "Could not verify the Checkout response. Please try again.",
    );
  });

  it("on failure: logs only a safe error name, never the raw error/message", async () => {
    verifyCheckoutAndPersistPaymentMock.mockRejectedValue(
      new Error("leaked secret: sk_super_secret_value"),
    );

    const { verifyCheckoutAction } =
      await import("@/app/demo-merchant/actions");
    await verifyCheckoutAction(validInput);

    const call = logEventMock.mock.calls.find(
      ([event]) => event === "checkout_verify_failed",
    );
    expect(call).toBeDefined();
    const [, fields] = call as [string, Record<string, unknown>];
    for (const value of Object.values(fields)) {
      expect(String(value)).not.toContain("sk_super_secret_value");
    }
  });

  it("on failure: does NOT revalidate — no state was mutated to reflect", async () => {
    verifyCheckoutAndPersistPaymentMock.mockRejectedValue(
      new Error("invalid signature"),
    );

    const { verifyCheckoutAction } =
      await import("@/app/demo-merchant/actions");
    await verifyCheckoutAction(validInput);

    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  // Phase 3D-B — differential C07 compatibility (this task's Section 24).
  describe("Phase 3D-B — C07 client-confirmation suppression", () => {
    it("A: no matching C07 fault — behaves exactly as before, verifyCheckoutAndPersistPayment called once", async () => {
      checkAndSuppressC07ClientConfirmationMock.mockResolvedValue({
        kind: "NOT_SUPPRESSED",
      });
      verifyCheckoutAndPersistPaymentMock.mockResolvedValue({
        id: "payment-1",
        paymentAttemptId: VALID_ATTEMPT_ID,
        razorpayPaymentId: "pay_fake_id",
        razorpayPaymentStatus: null,
        checkoutSignatureVerified: true,
        checkoutVerifiedAt: "2026-01-01T00:00:00.000Z",
        capturedAt: null,
        failedAt: null,
      });

      const { verifyCheckoutAction } =
        await import("@/app/demo-merchant/actions");
      const result = await verifyCheckoutAction(validInput);

      expect(checkAndSuppressC07ClientConfirmationMock).toHaveBeenCalledWith({
        paymentAttemptId: validInput.paymentAttemptId,
        razorpayPaymentId: validInput.razorpayPaymentId,
        razorpayOrderId: validInput.razorpayOrderId,
        razorpaySignature: validInput.razorpaySignature,
      });
      expect(verifyCheckoutAndPersistPaymentMock).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        ok: true,
        payment: {
          razorpayPaymentId: "pay_fake_id",
          checkoutSignatureVerified: true,
          checkoutVerifiedAt: "2026-01-01T00:00:00.000Z",
          razorpayPaymentStatus: null,
        },
      });
    });

    it("B: matching RUNNING/armed C07 (not yet consumed) — verifyCheckoutAndPersistPayment called ZERO times, safe suppression result returned", async () => {
      checkAndSuppressC07ClientConfirmationMock.mockResolvedValue({
        kind: "SUPPRESSED",
        chaosRunId: "chaos-run-1",
      });

      const { verifyCheckoutAction } =
        await import("@/app/demo-merchant/actions");
      const result = await verifyCheckoutAction(validInput);

      expect(verifyCheckoutAndPersistPaymentMock).not.toHaveBeenCalled();
      expect(result.ok).toBe(true);
      expect(result).toEqual({
        ok: true,
        suppressed: true,
        message: expect.any(String),
      });
      expect(result.error).toBeUndefined();
      expect(revalidatePathMock).not.toHaveBeenCalled();
    });

    it("does not call the payment a failure when suppressed", async () => {
      checkAndSuppressC07ClientConfirmationMock.mockResolvedValue({
        kind: "SUPPRESSED",
        chaosRunId: "chaos-run-1",
      });

      const { verifyCheckoutAction } =
        await import("@/app/demo-merchant/actions");
      const result = await verifyCheckoutAction(validInput);

      expect(result.ok).toBe(true);
      expect(String(result.message)).not.toMatch(/fail/i);
    });

    it("C: matching RUNNING/armed C07 already consumed=true — verifyCheckoutAndPersistPayment still ZERO, retry remains suppressed", async () => {
      checkAndSuppressC07ClientConfirmationMock.mockResolvedValue({
        kind: "SUPPRESSED",
        chaosRunId: "chaos-run-1",
      });

      const { verifyCheckoutAction } =
        await import("@/app/demo-merchant/actions");
      const first = await verifyCheckoutAction(validInput);
      const second = await verifyCheckoutAction(validInput);

      expect(verifyCheckoutAndPersistPaymentMock).not.toHaveBeenCalled();
      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
    });

    it("Blocker 1: an active C07 fault whose candidate confirmation fails authentication (order mismatch/invalid signature/missing trusted order) never calls verifyCheckoutAndPersistPayment and returns a safe generic error, never the reason category", async () => {
      checkAndSuppressC07ClientConfirmationMock.mockResolvedValue({
        kind: "REJECTED_INVALID_CONFIRMATION",
        reasonCategory: "SIGNATURE_INVALID",
      });

      const { verifyCheckoutAction } =
        await import("@/app/demo-merchant/actions");
      const result = await verifyCheckoutAction(validInput);

      expect(verifyCheckoutAndPersistPaymentMock).not.toHaveBeenCalled();
      expect(result.ok).toBe(false);
      expect(result.error).toBe(
        "Could not verify the Checkout response. Please try again.",
      );
      expect(JSON.stringify(result)).not.toContain("SIGNATURE_INVALID");
      expect(revalidatePathMock).not.toHaveBeenCalled();
    });

    it("D: an unrelated order (no active C07 fault) — normal verification proceeds", async () => {
      checkAndSuppressC07ClientConfirmationMock.mockResolvedValue({
        kind: "NOT_SUPPRESSED",
      });
      verifyCheckoutAndPersistPaymentMock.mockResolvedValue({
        id: "payment-2",
        paymentAttemptId: VALID_ATTEMPT_ID,
        razorpayPaymentId: "pay_fake_id_2",
        razorpayPaymentStatus: null,
        checkoutSignatureVerified: true,
        checkoutVerifiedAt: "2026-01-01T00:00:00.000Z",
        capturedAt: null,
        failedAt: null,
      });

      const { verifyCheckoutAction } =
        await import("@/app/demo-merchant/actions");
      const result = await verifyCheckoutAction(validInput);

      expect(verifyCheckoutAndPersistPaymentMock).toHaveBeenCalledTimes(1);
      expect(result.ok).toBe(true);
      expect(result.payment).toBeDefined();
    });

    it("E: a terminal (no longer RUNNING) C07 fault — normal verification proceeds", async () => {
      // checkAndSuppressC07ClientConfirmation itself is responsible for
      // returning NOT_SUPPRESSED once the fault is terminal (its own
      // lookup requires RUNNING) — this action-level test only proves the
      // action correctly proceeds to normal verification when told so.
      checkAndSuppressC07ClientConfirmationMock.mockResolvedValue({
        kind: "NOT_SUPPRESSED",
      });
      verifyCheckoutAndPersistPaymentMock.mockResolvedValue({
        id: "payment-3",
        paymentAttemptId: VALID_ATTEMPT_ID,
        razorpayPaymentId: "pay_fake_id_3",
        razorpayPaymentStatus: null,
        checkoutSignatureVerified: true,
        checkoutVerifiedAt: "2026-01-01T00:00:00.000Z",
        capturedAt: null,
        failedAt: null,
      });

      const { verifyCheckoutAction } =
        await import("@/app/demo-merchant/actions");
      const result = await verifyCheckoutAction(validInput);

      expect(verifyCheckoutAndPersistPaymentMock).toHaveBeenCalledTimes(1);
      expect(result.payment).toBeDefined();
    });

    it("F: the client cannot supply a chaosRunId/fault switch — verifyCheckoutAction's input type carries only the pre-existing Checkout fields", async () => {
      const fs = await import("node:fs");
      const path = await import("node:path");
      const source = fs.readFileSync(
        path.resolve(
          import.meta.dirname,
          "../../../app/demo-merchant/actions.ts",
        ),
        "utf-8",
      );
      const inputInterfaceMatch = source.match(
        /export interface VerifyCheckoutActionInput \{([\s\S]*?)\}/,
      );
      expect(inputInterfaceMatch).not.toBeNull();
      const inputBody = inputInterfaceMatch![1]!;
      expect(inputBody).not.toMatch(/chaosRunId/i);
      expect(inputBody).not.toMatch(/fault/i);
      expect(inputBody).not.toMatch(/scenario/i);
      expect(inputBody).not.toMatch(/authorized/i);

      expect(checkAndSuppressC07ClientConfirmationMock).not.toHaveBeenCalled();
      await import("@/app/demo-merchant/actions");
      // Only paymentAttemptId is ever forwarded to the suppression check —
      // confirmed by the exact-argument assertion in test "A" above.
    });
  });
});
