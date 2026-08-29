import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  evaluateAllInvariants,
  evaluateInvariant,
} from "@/lib/invariants/evaluate";
import {
  evaluateInv001,
  evaluateInv002,
  evaluateInv003,
  evaluateInv004,
  evaluateInv005,
  evaluateInv006,
  evaluateInv007,
  evaluateInv008,
  evaluateInv009,
  evaluateInv010,
  evaluateInv011,
  evaluateInv012,
  INVARIANT_EVALUATORS,
} from "@/lib/invariants/evaluators";
import {
  compareMoney,
  evaluateOrderBusinessStatusTransition,
  evaluateOrderPaymentStatusTransition,
  evaluatePaymentAttemptStatusTransition,
  isSuccessfulProcessing,
} from "@/lib/invariants/evaluator-utils";
import {
  isPersistableEvaluation,
  MONEY_INVARIANT_IDS,
  type InvariantEvaluationEnvelope,
} from "@/lib/invariants/types";

import {
  ATTEMPT_ID,
  attempt,
  bundle,
  c01Scenario,
  c03Scenario,
  c03Side,
  CAPTURE_WEBHOOK_ID,
  fulfilment,
  FULFILMENT_B,
  ORDER_ID,
  PAYMENT_ID,
  PROC_A,
  PROC_B,
  snapshot,
  webhook,
} from "./fixtures";

/**
 * Phase 3F-B — behavioural tests for the twelve pure deterministic
 * evaluators.
 *
 * These prove the evaluators DETECT the actual deterministic violations, not
 * merely that enum plumbing compiles: every rule has a healthy fixture that
 * must PASS and a vulnerable fixture that must FAIL.
 *
 * Blocks marked ARCHITECT REGRESSION encode a case the FIRST implementation
 * got wrong. Each such fixture would have produced the wrong disposition
 * before the semantic correction round, and asserts the corrected one.
 */

/**
 * Narrows a result to the persistable branch so its summaries can be read.
 *
 * The discriminated union deliberately hides `expectedSummary`/`observedSummary`
 * on the NOT_APPLICABLE/ERROR branch, so this helper both narrows AND asserts
 * that the result really is persistable.
 */
function persistableOf(result: InvariantEvaluationEnvelope) {
  if (!isPersistableEvaluation(result)) {
    throw new Error(
      `expected a persistable evaluation, got ${result.disposition}`,
    );
  }
  return result;
}

const captured = (s = snapshot()) => ({
  kind: "CAPTURED" as const,
  snapshot: s,
});
const notCaptured = { kind: "NOT_CAPTURED" as const };

/**
 * The canonical shape after a genuine processor failure: the Phase 2F
 * transaction rolled back, so `processing_status` is still its `RECEIVED`
 * default and the ordinary retry path remains available.
 */
const retryableSource = webhook({ processingStatus: "RECEIVED" });

/**
 * A capture override where the resolution and the projection name the SAME
 * persisted row, so a test can isolate ONE authority condition instead of
 * accidentally tripping the resolution/projection consistency check.
 */
function captureOf(w: ReturnType<typeof webhook>) {
  return {
    authoritativeCapture: { kind: "EXACTLY_ONE" as const, webhook: w },
    authoritativeCaptureWebhook: w,
  };
}

/**
 * A FAILED attempt whose captured snapshots carry NO fulfilment at all, so
 * INV-009's condition 1 ("no protected fulfilment attributed to the failed
 * attempt") is genuinely satisfied rather than accidentally violated by the
 * default fixture, whose fulfilment names PROC_A as its trigger.
 */
const cleanFailedAttempt = (overrides = {}) =>
  attempt({
    status: "FAILED",
    stateBefore: captured(snapshot({ fulfilments: [] })),
    stateAfter: captured(snapshot({ fulfilments: [] })),
    ...overrides,
  });

// ============================================================================
// INV-001
// ============================================================================

describe("INV-001 — unique webhook protected logic once", () => {
  it("PASS: two processing attempts but only one fulfilment", () => {
    const result = evaluateInv001(
      bundle({
        originalProcessingAttempts: [
          attempt({ id: PROC_A }),
          attempt({ id: PROC_B, status: "SUCCEEDED" }),
        ],
      }),
    );
    expect(result.disposition).toBe("PASS");
    expect(persistableOf(result).observedSummary).toContain(
      "effects triggered by this event = 1",
    );
  });

  it("PASS: a replay attempt alone does not fail the rule — attempts are not effects", () => {
    const result = evaluateInv001(
      bundle({
        chaosProcessingAttempts: [
          attempt({
            id: PROC_B,
            sourceKind: "PAYCHAOS_REPLAY",
            chaosRunId: "run",
          }),
        ],
      }),
    );
    expect(result.disposition).toBe("PASS");
  });

  it("FAIL: the same logical event triggered the protected effect twice", () => {
    const two = snapshot({
      fulfilments: [
        fulfilment({ triggerProcessingAttemptId: PROC_A }),
        fulfilment({ id: FULFILMENT_B, triggerProcessingAttemptId: PROC_B }),
      ],
    });
    const result = evaluateInv001(
      bundle({
        originalProcessingAttempts: [
          attempt({ id: PROC_A, stateAfter: captured(two) }),
          attempt({ id: PROC_B, stateAfter: captured(two) }),
        ],
      }),
    );
    expect(result.disposition).toBe("FAIL");
  });

  it("UNKNOWN: a fulfilment carries no trigger correlation", () => {
    const orphan = snapshot({
      fulfilments: [fulfilment({ triggerProcessingAttemptId: null })],
    });
    expect(
      evaluateInv001(
        bundle({
          originalProcessingAttempts: [
            attempt({
              stateBefore: captured(orphan),
              stateAfter: captured(orphan),
            }),
          ],
        }),
      ).disposition,
    ).toBe("UNKNOWN");
  });

  // ---- ARCHITECT REGRESSION: preconditions were not enforced ----

  it("ARCHITECT REGRESSION — real source with an UNVERIFIED signature is UNKNOWN, never PASS", () => {
    // Old behaviour: evaluated purely because sourceWebhook !== null, so this
    // healthy-looking bundle produced an authoritative PASS from evidence that
    // never passed signature verification.
    const result = evaluateInv001(
      bundle({ sourceWebhook: webhook({ signatureVerified: false }) }),
    );
    expect(result.disposition).toBe("UNKNOWN");
    expect(persistableOf(result).observedSummary).toContain(
      "signature verified = false",
    );
  });

  it("ARCHITECT REGRESSION — a replayed (non-provider) source is UNKNOWN, never PASS", () => {
    expect(
      evaluateInv001(
        bundle({ sourceWebhook: webhook({ sourceKind: "PAYCHAOS_REPLAY" }) }),
      ).disposition,
    ).toBe("UNKNOWN");
  });

  it("ARCHITECT REGRESSION — missing merchant correlation on the event is UNKNOWN", () => {
    expect(
      evaluateInv001(
        bundle({
          sourceWebhook: webhook({ paymentId: null, paymentAttemptId: null }),
        }),
      ).disposition,
    ).toBe("UNKNOWN");
  });

  it("ARCHITECT REGRESSION — a proven canonical-uniqueness breach is FAIL, not UNKNOWN", () => {
    // The count is a trusted persisted fact, so >1 directly proves the
    // documented "must map to one canonical webhook record" clause is broken.
    const result = evaluateInv001(bundle({ canonicalSourceEventCount: 2 }));
    expect(result.disposition).toBe("FAIL");
    expect(persistableOf(result).observedSummary).toContain(
      "canonical webhook rows for the source event = 2",
    );
  });

  it("UNKNOWN: the canonical count could not be established at all", () => {
    expect(
      evaluateInv001(bundle({ canonicalSourceEventCount: null })).disposition,
    ).toBe("UNKNOWN");
  });
});

// ============================================================================
// INV-002
// ============================================================================

describe("INV-002 — one captured payment, at most one fulfilment", () => {
  it("PASS: complete correlation with zero fulfilments for the payment", () => {
    const result = evaluateInv002(
      bundle({
        originalProcessingAttempts: [
          attempt({
            stateBefore: captured(snapshot({ fulfilments: [] })),
            stateAfter: captured(snapshot({ fulfilments: [] })),
          }),
        ],
      }),
    );
    expect(result.disposition).toBe("PASS");
    expect(persistableOf(result).observedSummary).toContain("= 0");
  });

  it("PASS: complete correlation with exactly one fulfilment", () => {
    expect(evaluateInv002(bundle()).disposition).toBe("PASS");
  });

  it("FAIL: two fulfilments reference the same payment", () => {
    const two = snapshot({
      fulfilments: [fulfilment(), fulfilment({ id: FULFILMENT_B })],
    });
    expect(
      evaluateInv002(
        bundle({
          originalProcessingAttempts: [
            attempt({ stateBefore: captured(two), stateAfter: captured(two) }),
          ],
        }),
      ).disposition,
    ).toBe("FAIL");
  });

  it("UNKNOWN: the fulfilment collection was never captured", () => {
    const uncounted = snapshot({ fulfilments: null });
    expect(
      evaluateInv002(
        bundle({
          originalProcessingAttempts: [
            attempt({
              stateBefore: captured(uncounted),
              stateAfter: captured(uncounted),
            }),
          ],
        }),
      ).disposition,
    ).toBe("UNKNOWN");
  });

  it("NOT_APPLICABLE: no payment is correlated to the run", () => {
    expect(evaluateInv002(bundle({ paymentId: null })).disposition).toBe(
      "NOT_APPLICABLE",
    );
  });

  // ---- ARCHITECT REGRESSION: precondition was only "paymentId != null" ----

  it("ARCHITECT REGRESSION — a payment with no attempt/order correlation is UNKNOWN, never PASS", () => {
    // Old behaviour: a bare payment id plus a fulfilment count produced an
    // authoritative PASS even though the documented precondition ("correlated
    // to an internal payment attempt/order") was never established.
    const noAttempt = snapshot({ withPaymentAttempt: false });
    const result = evaluateInv002(
      bundle({
        originalProcessingAttempts: [
          attempt({
            stateBefore: captured(noAttempt),
            stateAfter: captured(noAttempt),
          }),
        ],
      }),
    );
    expect(result.disposition).toBe("UNKNOWN");
    expect(persistableOf(result).observedSummary).toContain(
      "correlation = not established",
    );
  });

  it("ARCHITECT REGRESSION — a payment whose attempt belongs to another order is UNKNOWN", () => {
    const base = snapshot();
    const brokenChain = {
      ...base,
      paymentAttempt: {
        ...base.paymentAttempt!,
        orderId: "77777777-7777-4777-8777-777777777777",
      },
    };
    expect(
      evaluateInv002(
        bundle({
          originalProcessingAttempts: [
            attempt({
              stateBefore: captured(brokenChain),
              stateAfter: captured(brokenChain),
            }),
          ],
        }),
      ).disposition,
    ).toBe("UNKNOWN");
  });
});

// ============================================================================
// INV-003
// ============================================================================

describe("INV-003 — failed payment never marks order paid", () => {
  const failureWebhook = webhook({ eventType: "payment.failed" });
  const failedState = (paymentStatus: string) =>
    snapshot({
      orderPaymentStatus: paymentStatus,
      orderBusinessStatus: "OPEN",
      paymentCapturedAt: null,
      paymentFailedAt: "2026-08-20T09:59:00.000Z",
      fulfilments: [],
    });

  it("NOT_APPLICABLE: no verified provider failure event exists", () => {
    expect(evaluateInv003(bundle()).disposition).toBe("NOT_APPLICABLE");
  });

  it("ARCHITECT RE-AUDIT — a merchant-side failed_at alone is NOT provider failure authority", () => {
    // The payment carries failedAt, but the canonical event is a capture.
    // failed_at is written by our own processor, so it can never establish the
    // precondition on its own.
    expect(
      evaluateInv003(
        bundle({
          originalProcessingAttempts: [
            attempt({
              stateBefore: captured(failedState("PENDING")),
              stateAfter: captured(failedState("PAID")),
            }),
          ],
        }),
      ).disposition,
    ).toBe("NOT_APPLICABLE");
  });

  it("PASS: verified failure-only evidence left the order non-paid", () => {
    expect(
      evaluateInv003(
        bundle({
          sourceWebhook: failureWebhook,
          authoritativeCapture: { kind: "NONE_OBSERVED" },
          authoritativeCaptureWebhook: null,
          originalProcessingAttempts: [
            attempt({
              stateBefore: captured(failedState("PENDING")),
              stateAfter: captured(failedState("FAILED_OBSERVED")),
            }),
          ],
        }),
      ).disposition,
    ).toBe("PASS");
  });

  it("FAIL: verified failure-only evidence left the order PAID", () => {
    expect(
      evaluateInv003(
        bundle({
          sourceWebhook: failureWebhook,
          authoritativeCapture: { kind: "NONE_OBSERVED" },
          authoritativeCaptureWebhook: null,
          originalProcessingAttempts: [
            attempt({
              stateBefore: captured(failedState("PENDING")),
              stateAfter: captured(failedState("PAID")),
            }),
          ],
        }),
      ).disposition,
    ).toBe("FAIL");
  });

  it("PASS: a later verified capture prevents a false failure-only conclusion", () => {
    const result = evaluateInv003(
      bundle({
        sourceWebhook: failureWebhook,
        originalProcessingAttempts: [
          attempt({
            stateBefore: captured(failedState("FAILED_OBSERVED")),
            stateAfter: captured(snapshot()),
          }),
        ],
      }),
    );
    expect(result.disposition).toBe("PASS");
    expect(result.reason).toContain("not the final provider truth");
  });

  it("UNKNOWN: the capture search was incomplete — never FAIL", () => {
    for (const kind of [
      "SEARCH_INCOMPLETE",
      "NO_SUBJECT",
      "AMBIGUOUS_SUBJECT",
    ] as const) {
      expect(
        evaluateInv003(
          bundle({
            sourceWebhook: failureWebhook,
            authoritativeCapture: { kind },
            authoritativeCaptureWebhook: null,
            originalProcessingAttempts: [
              attempt({
                stateBefore: captured(failedState("PENDING")),
                stateAfter: captured(failedState("PAID")),
              }),
            ],
          }),
        ).disposition,
      ).toBe("UNKNOWN");
    }
  });
});

// ============================================================================
// INV-004 — the complete five-condition rule
// ============================================================================

describe("INV-004 — fulfilment requires verified successful payment", () => {
  it("NOT_APPLICABLE: no fulfilment exists", () => {
    const none = snapshot({ fulfilments: [] });
    expect(
      evaluateInv004(
        bundle({
          originalProcessingAttempts: [
            attempt({
              stateBefore: captured(none),
              stateAfter: captured(none),
            }),
          ],
        }),
      ).disposition,
    ).toBe("NOT_APPLICABLE");
  });

  it("A: fulfilment + exact verified capture + correct chain + equal money -> PASS", () => {
    const result = evaluateInv004(bundle());
    expect(result.disposition).toBe("PASS");
    expect(persistableOf(result).observedSummary).toContain(
      "every fulfilment resolves one valid chain",
    );
  });

  it("ARCHITECT REGRESSION B — fulfilment references the wrong payment -> FAIL", () => {
    // Old behaviour: PASS, because only the capture resolution was checked.
    const wrongPayment = snapshot({
      fulfilments: [
        fulfilment({ paymentId: "99999999-9999-4999-8999-999999999999" }),
      ],
    });
    expect(
      evaluateInv004(
        bundle({
          originalProcessingAttempts: [
            attempt({
              stateBefore: captured(wrongPayment),
              stateAfter: captured(wrongPayment),
            }),
          ],
        }),
      ).disposition,
    ).toBe("FAIL");
  });

  it("ARCHITECT REGRESSION C — payment.paymentAttemptId does not match the attempt -> FAIL", () => {
    const base = snapshot();
    const broken = {
      ...base,
      payment: {
        ...base.payment!,
        paymentAttemptId: "66666666-6666-4666-8666-666666666601",
      },
    };
    expect(
      evaluateInv004(
        bundle({
          originalProcessingAttempts: [
            attempt({
              stateBefore: captured(broken),
              stateAfter: captured(broken),
            }),
          ],
        }),
      ).disposition,
    ).toBe("FAIL");
  });

  it("ARCHITECT REGRESSION D — the payment attempt belongs to another order -> FAIL", () => {
    const base = snapshot();
    const broken = {
      ...base,
      paymentAttempt: {
        ...base.paymentAttempt!,
        orderId: "77777777-7777-4777-8777-777777777777",
      },
    };
    expect(
      evaluateInv004(
        bundle({
          originalProcessingAttempts: [
            attempt({
              stateBefore: captured(broken),
              stateAfter: captured(broken),
            }),
          ],
        }),
      ).disposition,
    ).toBe("FAIL");
  });

  it("ARCHITECT REGRESSION E — the fulfilment's order differs from the resolved order -> FAIL", () => {
    const wrongOrder = snapshot({
      fulfilments: [
        fulfilment({ orderId: "88888888-8888-4888-8888-888888888888" }),
      ],
    });
    expect(
      evaluateInv004(
        bundle({
          originalProcessingAttempts: [
            attempt({
              stateBefore: captured(wrongOrder),
              stateAfter: captured(wrongOrder),
            }),
          ],
        }),
      ).disposition,
    ).toBe("FAIL");
  });

  it("ARCHITECT REGRESSION F — exact capture but order/payment money differs by 1 subunit -> FAIL", () => {
    const oneOff = snapshot({ paymentAmountSubunits: 49999 });
    expect(
      evaluateInv004(
        bundle({
          originalProcessingAttempts: [
            attempt({
              stateBefore: captured(oneOff),
              stateAfter: captured(oneOff),
            }),
          ],
        }),
      ).disposition,
    ).toBe("FAIL");
  });

  it("ARCHITECT REGRESSION G — exact capture but currency differs -> FAIL", () => {
    const wrongCurrency = snapshot({ paymentCurrency: "USD" });
    expect(
      evaluateInv004(
        bundle({
          originalProcessingAttempts: [
            attempt({
              stateBefore: captured(wrongCurrency),
              stateAfter: captured(wrongCurrency),
            }),
          ],
        }),
      ).disposition,
    ).toBe("FAIL");
  });

  it("H: a required chain entity is missing, so no invalid path is proven -> UNKNOWN", () => {
    const noAttempt = snapshot({ withPaymentAttempt: false });
    const result = evaluateInv004(
      bundle({
        originalProcessingAttempts: [
          attempt({
            stateBefore: captured(noAttempt),
            stateAfter: captured(noAttempt),
          }),
        ],
      }),
    );
    expect(result.disposition).toBe("UNKNOWN");
    expect(persistableOf(result).observedSummary).toContain(
      "was not captured completely",
    );
  });

  it("H2: a NULL required money value is UNKNOWN, never FAIL and never PASS", () => {
    const base = snapshot();
    const nullAmount = {
      ...base,
      payment: {
        ...base.payment!,
        amountSubunits: null as unknown as number,
      },
    };
    expect(
      evaluateInv004(
        bundle({
          originalProcessingAttempts: [
            attempt({
              stateBefore: captured(nullAmount),
              stateAfter: captured(nullAmount),
            }),
          ],
        }),
      ).disposition,
    ).toBe("UNKNOWN");
  });

  it("I: incomplete capture correlation -> UNKNOWN", () => {
    for (const kind of [
      "SEARCH_INCOMPLETE",
      "NO_SUBJECT",
      "AMBIGUOUS_SUBJECT",
    ] as const) {
      expect(
        evaluateInv004(
          bundle({
            authoritativeCapture: { kind },
            authoritativeCaptureWebhook: null,
          }),
        ).disposition,
      ).toBe("UNKNOWN");
    }
  });

  it("FAIL: fulfilment exists although the completed search found no capture", () => {
    expect(
      evaluateInv004(
        bundle({
          authoritativeCapture: { kind: "NONE_OBSERVED" },
          authoritativeCaptureWebhook: null,
        }),
      ).disposition,
    ).toBe("FAIL");
  });

  it("J: captured_at alone never produces PASS", () => {
    const result = evaluateInv004(
      bundle({
        authoritativeCapture: { kind: "NONE_OBSERVED" },
        authoritativeCaptureWebhook: null,
        originalProcessingAttempts: [
          attempt({
            stateAfter: captured(
              snapshot({ paymentCapturedAt: "2026-08-20T09:59:00.000Z" }),
            ),
          }),
        ],
      }),
    );
    expect(result.disposition).not.toBe("PASS");
  });

  it("K: a verified Checkout signature alone never produces PASS", () => {
    // The fixture's payment has checkoutSignatureVerified === true.
    expect(
      evaluateInv004(
        bundle({
          authoritativeCapture: { kind: "SEARCH_INCOMPLETE" },
          authoritativeCaptureWebhook: null,
        }),
      ).disposition,
    ).toBe("UNKNOWN");
  });

  it("UNKNOWN: EXACTLY_ONE but the resolved capture webhook is not verified provider evidence", () => {
    const untrusted = webhook({ signatureVerified: false });
    expect(
      evaluateInv004(
        bundle({
          authoritativeCapture: { kind: "EXACTLY_ONE", webhook: untrusted },
          authoritativeCaptureWebhook: untrusted,
        }),
      ).disposition,
    ).toBe("UNKNOWN");
  });

  it("NARROW-02 — a fulfilment observed only in an incomplete snapshot is never silently skipped", () => {
    // Old behaviour: validation iterated merchant PATHS, so F1 — observed in a
    // snapshot with no payment/attempt evidence — was never validated at all,
    // and the complete path carrying F2 alone produced an authoritative PASS.
    const orphanSnapshot = snapshot({
      withPaymentAttempt: false,
      withPayment: false,
      fulfilments: [fulfilment({ id: FULFILMENT_B })],
    });
    const result = evaluateInv004(
      bundle({
        originalProcessingAttempts: [
          attempt({
            id: PROC_A,
            stateBefore: captured(orphanSnapshot),
            stateAfter: captured(orphanSnapshot),
          }),
          attempt({ id: PROC_B }),
        ],
      }),
    );
    expect(result.disposition).not.toBe("PASS");
    expect(result.disposition).toBe("UNKNOWN");
    expect(persistableOf(result).observedSummary).toContain(
      "was not captured completely",
    );
  });

  it("NARROW-03 A — EXACTLY_ONE but the capture webhook projection is null -> UNKNOWN, never PASS", () => {
    expect(
      evaluateInv004(
        bundle({
          authoritativeCapture: { kind: "EXACTLY_ONE", webhook: webhook() },
          authoritativeCaptureWebhook: null,
        }),
      ).disposition,
    ).toBe("UNKNOWN");
  });

  it("NARROW-03 B — EXACTLY_ONE with an unverified capture webhook -> UNKNOWN", () => {
    const untrusted = webhook({ signatureVerified: false });
    expect(
      evaluateInv004(
        bundle({
          authoritativeCapture: { kind: "EXACTLY_ONE", webhook: untrusted },
          authoritativeCaptureWebhook: untrusted,
        }),
      ).disposition,
    ).toBe("UNKNOWN");
  });

  it("NARROW-03 C — EXACTLY_ONE whose event type is payment.failed -> UNKNOWN", () => {
    const wrongType = webhook({ eventType: "payment.failed" });
    expect(
      evaluateInv004(
        bundle({
          authoritativeCapture: { kind: "EXACTLY_ONE", webhook: wrongType },
          authoritativeCaptureWebhook: wrongType,
        }),
      ).disposition,
    ).toBe("UNKNOWN");
  });

  it("NARROW-03 D — a capture for a DIFFERENT payment never authorises this fulfilment", () => {
    const otherPayment = webhook({
      id: "15151515-1515-4151-8151-151515151515",
      paymentId: "99999999-9999-4999-8999-999999999999",
      razorpayPaymentId: "pay_ANOTHERPAYMENT",
    });
    const result = evaluateInv004(
      bundle({
        authoritativeCapture: { kind: "EXACTLY_ONE", webhook: otherPayment },
        authoritativeCaptureWebhook: otherPayment,
      }),
    );
    expect(result.disposition).not.toBe("PASS");
    expect(result.disposition).toBe("UNKNOWN");
    expect(persistableOf(result).observedSummary).toContain(
      "internal payment identity contradicts",
    );
  });

  it("NARROW-03 E — an exact verified payment.captured for the resolved payment is valid authority", () => {
    expect(evaluateInv004(bundle()).disposition).toBe("PASS");
  });

  // ==========================================================================
  // BLOCKER 3F-C-01 — applicability is decided BEFORE evidence availability
  // ==========================================================================
  //
  // The original ordering asked "was a fulfilment collection captured?" before
  // asking "can a fulfilment exist for this run at all?". A C03 run has no
  // order, no payment attempt, no payment and no processing attempt by
  // construction, so it has zero captured snapshots and was reported UNKNOWN —
  // missing evidence — when its precondition was in fact provably false.
  //
  // The crucial distinction these tests lock in:
  //     NO SUBJECT                       -> NOT_APPLICABLE
  //     SUBJECT EXISTS, EVIDENCE ABSENT  -> UNKNOWN

  /** The approved C03 shape: no merchant correlation and no processing attempt. */
  const c03NoSubjectBundle = (
    scenarioOverrides: Parameters<typeof c03Scenario>[0] = {},
  ) =>
    bundle({
      scenarioId: "C03",
      orderId: null,
      paymentAttemptId: null,
      paymentId: null,
      sourceWebhook: null,
      originalProcessingAttempts: [],
      canonicalSourceEventCount: null,
      authoritativeCapture: { kind: "NO_SUBJECT" },
      authoritativeCaptureWebhook: null,
      scenarioEvidence: c03Scenario(scenarioOverrides),
    });

  it("3F-C-01 A — a C03 structural no-subject run is NOT_APPLICABLE, never UNKNOWN", () => {
    const result = evaluateInv004(
      c03NoSubjectBundle({
        mutationEvidence: { before: c03Side(), after: c03Side() },
      }),
    );
    expect(result.disposition).toBe("NOT_APPLICABLE");
    expect(result.reason).toContain("no merchant subject");
  });

  it("3F-C-01 B — the historical C03 shape (no subject, no snapshots) is also NOT_APPLICABLE", () => {
    // Historical snapshot absence must not turn a structurally inapplicable
    // rule into UNKNOWN.
    const result = evaluateInv004(c03NoSubjectBundle());
    expect(result.disposition).toBe("NOT_APPLICABLE");
    expect(result.disposition).not.toBe("UNKNOWN");
  });

  it("3F-C-01 C — a merchant subject WITH no captured fulfilment evidence stays UNKNOWN", () => {
    // This is the C07 / C11-B / C11-A historical shape: a real correlated
    // order exists, but Phase 3E snapshots predate the run.
    const result = evaluateInv004(
      bundle({
        originalProcessingAttempts: [
          attempt({ stateBefore: notCaptured, stateAfter: notCaptured }),
        ],
      }),
    );
    expect(result.disposition).toBe("UNKNOWN");
    expect(persistableOf(result).observedSummary).toContain(
      "merchant subject present",
    );
  });

  it("3F-C-01 C2 — a subject established only by a captured snapshot also stays UNKNOWN", () => {
    // No run-level correlation, but a captured snapshot resolved an order, so
    // a subject genuinely exists and its uncaptured fulfilment set is UNKNOWN.
    const orderOnly = snapshot({
      withPaymentAttempt: false,
      withPayment: false,
      fulfilments: null,
    });
    const result = evaluateInv004(
      bundle({
        orderId: null,
        paymentAttemptId: null,
        paymentId: null,
        originalProcessingAttempts: [
          attempt({
            stateBefore: captured(orderOnly),
            stateAfter: captured(orderOnly),
          }),
        ],
      }),
    );
    expect(result.disposition).toBe("UNKNOWN");
  });

  it("3F-C-01 D — a CAPTURED but empty fulfilment collection is NOT_APPLICABLE", () => {
    const none = snapshot({ fulfilments: [] });
    const result = evaluateInv004(
      bundle({
        originalProcessingAttempts: [
          attempt({ stateBefore: captured(none), stateAfter: captured(none) }),
        ],
      }),
    );
    expect(result.disposition).toBe("NOT_APPLICABLE");
    expect(result.reason).toContain("captured fulfilment collection is empty");
  });

  it("3F-C-01 E — a healthy fulfilment still runs the full five-condition path", () => {
    expect(evaluateInv004(bundle()).disposition).toBe("PASS");
  });

  it("3F-C-01 F — an invalid fulfilment path still FAILs; missing capture is still UNKNOWN", () => {
    const wrongPayment = snapshot({
      fulfilments: [
        fulfilment({ paymentId: "99999999-9999-4999-8999-999999999999" }),
      ],
    });
    expect(
      evaluateInv004(
        bundle({
          originalProcessingAttempts: [
            attempt({
              stateBefore: captured(wrongPayment),
              stateAfter: captured(wrongPayment),
            }),
          ],
        }),
      ).disposition,
    ).toBe("FAIL");
    expect(
      evaluateInv004(
        bundle({
          authoritativeCapture: { kind: "SEARCH_INCOMPLETE" },
          authoritativeCaptureWebhook: null,
        }),
      ).disposition,
    ).toBe("UNKNOWN");
  });

  it("3F-C-01 G — applicability is STRUCTURAL, not a scenario-name check", () => {
    // Same no-subject structure, labelled C11 rather than C03. The evaluator
    // must reach the identical disposition: it reads correlations and captured
    // entities, never the scenario id.
    const noSubjectC11 = bundle({
      scenarioId: "C11",
      orderId: null,
      paymentAttemptId: null,
      paymentId: null,
      sourceWebhook: null,
      originalProcessingAttempts: [],
      canonicalSourceEventCount: null,
      authoritativeCapture: { kind: "NO_SUBJECT" },
      authoritativeCaptureWebhook: null,
    });
    expect(evaluateInv004(noSubjectC11).disposition).toBe("NOT_APPLICABLE");
    expect(evaluateInv004(c03NoSubjectBundle()).disposition).toBe(
      "NOT_APPLICABLE",
    );
  });

  it("3F-C-01 — the C03 aggregate inputs are now the documented pair", () => {
    // Fresh C03: INV-004 NOT_APPLICABLE + INV-005 PASS.
    const fresh = c03NoSubjectBundle({
      mutationEvidence: { before: c03Side(), after: c03Side() },
    });
    expect(evaluateInv004(fresh).disposition).toBe("NOT_APPLICABLE");
    expect(evaluateInv005(fresh).disposition).toBe("PASS");

    // Historical C03: INV-004 NOT_APPLICABLE + INV-005 UNKNOWN.
    const historical = c03NoSubjectBundle();
    expect(evaluateInv004(historical).disposition).toBe("NOT_APPLICABLE");
    expect(evaluateInv005(historical).disposition).toBe("UNKNOWN");
  });
});

// ============================================================================
// INV-005 (semantics preserved exactly)
// ============================================================================

describe("INV-005 — invalid webhook signature causes zero mutation", () => {
  const c03 = (scenarioOverrides = {}) =>
    bundle({
      scenarioId: "C03",
      orderId: null,
      paymentAttemptId: null,
      paymentId: null,
      sourceWebhook: null,
      originalProcessingAttempts: [],
      canonicalSourceEventCount: null,
      authoritativeCapture: { kind: "NO_SUBJECT" },
      authoritativeCaptureWebhook: null,
      scenarioEvidence: c03Scenario(scenarioOverrides),
    });

  it("NOT_APPLICABLE: this run performed no invalid-signature test", () => {
    expect(evaluateInv005(bundle()).disposition).toBe("NOT_APPLICABLE");
  });

  it("UNKNOWN: historical legacy C03 run carries no mutation evidence", () => {
    const result = evaluateInv005(c03());
    expect(result.disposition).toBe("UNKNOWN");
    expect(result.reason).toContain("false claim about a past execution");
  });

  it("PASS: both cases REJECTED and complete unchanged state", () => {
    expect(
      evaluateInv005(
        c03({ mutationEvidence: { before: c03Side(), after: c03Side() } }),
      ).disposition,
    ).toBe("PASS");
  });

  it("FAIL: WRONG_SIGNATURE unexpected acceptance, even with a zero delta", () => {
    const result = evaluateInv005(
      c03({
        verificationChecks: [
          { case: "WRONG_SIGNATURE", classification: "UNEXPECTED_ACCEPTANCE" },
          { case: "MISSING_SIGNATURE", classification: "REJECTED" },
        ],
        mutationEvidence: { before: c03Side(), after: c03Side() },
      }),
    );
    expect(result.disposition).toBe("FAIL");
    expect(persistableOf(result).observedSummary).toContain("WRONG_SIGNATURE");
  });

  it("FAIL: MISSING_SIGNATURE unexpected acceptance, even with a zero delta", () => {
    const result = evaluateInv005(
      c03({
        verificationChecks: [
          { case: "WRONG_SIGNATURE", classification: "REJECTED" },
          {
            case: "MISSING_SIGNATURE",
            classification: "UNEXPECTED_ACCEPTANCE",
          },
        ],
        mutationEvidence: { before: c03Side(), after: c03Side() },
      }),
    );
    expect(result.disposition).toBe("FAIL");
    expect(persistableOf(result).observedSummary).toContain(
      "MISSING_SIGNATURE",
    );
  });

  it("FAIL: a trusted webhook row was inserted", () => {
    expect(
      evaluateInv005(
        c03({
          mutationEvidence: {
            before: c03Side(),
            after: c03Side({
              trustedWebhookEvents: {
                count: 2,
                ids: ["a", "b"],
                complete: true,
              },
            }),
          },
        }),
      ).disposition,
    ).toBe("FAIL");
  });

  it("FAIL: an order state delta", () => {
    expect(
      evaluateInv005(
        c03({
          mutationEvidence: {
            before: c03Side(),
            after: c03Side({
              orders: {
                count: 1,
                rows: [snapshot({ orderPaymentStatus: "UNPAID" }).order!],
                complete: true,
              },
            }),
          },
        }),
      ).disposition,
    ).toBe("FAIL");
  });

  it("FAIL: a payment-attempt delta", () => {
    expect(
      evaluateInv005(
        c03({
          mutationEvidence: {
            before: c03Side(),
            after: c03Side({
              paymentAttempts: {
                count: 1,
                rows: [
                  snapshot({ attemptStatus: "FAILED_OBSERVED" })
                    .paymentAttempt!,
                ],
                complete: true,
              },
            }),
          },
        }),
      ).disposition,
    ).toBe("FAIL");
  });

  it("FAIL: a payment delta", () => {
    expect(
      evaluateInv005(
        c03({
          mutationEvidence: {
            before: c03Side(),
            after: c03Side({
              payments: {
                count: 1,
                rows: [snapshot({ paymentAmountSubunits: 49999 }).payment!],
                complete: true,
              },
            }),
          },
        }),
      ).disposition,
    ).toBe("FAIL");
  });

  it("FAIL: a fulfilment delta", () => {
    expect(
      evaluateInv005(
        c03({
          mutationEvidence: {
            before: c03Side(),
            after: c03Side({
              fulfilments: {
                count: 2,
                rows: [fulfilment(), fulfilment({ id: FULFILMENT_B })],
                complete: true,
              },
            }),
          },
        }),
      ).disposition,
    ).toBe("FAIL");
  });

  it("UNKNOWN: a truncated collection is never compared and called unchanged", () => {
    expect(
      evaluateInv005(
        c03({
          mutationEvidence: {
            before: c03Side({
              orders: { count: 9, rows: [snapshot().order!], complete: false },
            }),
            after: c03Side({
              orders: { count: 9, rows: [snapshot().order!], complete: false },
            }),
          },
        }),
      ).disposition,
    ).toBe("UNKNOWN");
  });

  it("UNKNOWN: one side of the mutation evidence is null", () => {
    expect(
      evaluateInv005(
        c03({ mutationEvidence: { before: c03Side(), after: null } }),
      ).disposition,
    ).toBe("UNKNOWN");
  });

  it("UNKNOWN: the verification checks are absent", () => {
    expect(evaluateInv005(c03({ verificationChecks: null })).disposition).toBe(
      "UNKNOWN",
    );
  });
});

// ============================================================================
// INV-006
// ============================================================================

describe("INV-006 — processed event replay preserves final business state", () => {
  const replay = (before = snapshot(), after = snapshot()) =>
    attempt({
      id: PROC_B,
      sourceKind: "PAYCHAOS_REPLAY",
      chaosRunId: "run",
      stateBefore: captured(before),
      stateAfter: captured(after),
    });

  it("NOT_APPLICABLE: this run replayed nothing", () => {
    expect(evaluateInv006(bundle()).disposition).toBe("NOT_APPLICABLE");
  });

  it("PASS: verified source, prior SUCCEEDED processing, replay left the tuple unchanged", () => {
    expect(
      evaluateInv006(bundle({ chaosProcessingAttempts: [replay()] }))
        .disposition,
    ).toBe("PASS");
  });

  it("FAIL: replay created a duplicate fulfilment", () => {
    const after = snapshot({
      fulfilments: [fulfilment(), fulfilment({ id: FULFILMENT_B })],
    });
    expect(
      evaluateInv006(
        bundle({ chaosProcessingAttempts: [replay(snapshot(), after)] }),
      ).disposition,
    ).toBe("FAIL");
  });

  it("FAIL: replay regressed the payment state", () => {
    const after = snapshot({ orderPaymentStatus: "PENDING" });
    expect(
      evaluateInv006(
        bundle({ chaosProcessingAttempts: [replay(snapshot(), after)] }),
      ).disposition,
    ).toBe("FAIL");
  });

  it("UNKNOWN: historical replay attempt has no captured snapshots", () => {
    const result = evaluateInv006(
      bundle({
        chaosProcessingAttempts: [
          attempt({
            id: PROC_B,
            sourceKind: "PAYCHAOS_REPLAY",
            chaosRunId: "run",
            stateBefore: notCaptured,
            stateAfter: notCaptured,
          }),
        ],
      }),
    );
    expect(result.disposition).toBe("UNKNOWN");
    expect(result.reason).toContain("never reconstructed");
  });

  // ---- ARCHITECT RE-AUDIT: preconditions were not enforced ----

  it("ARCHITECT REGRESSION — an arbitrary chaos-linked attempt is not a replay -> NOT_APPLICABLE", () => {
    // Old behaviour: ANY chaos-linked attempt counted as a replay, so a
    // non-replay chaos attempt could produce an authoritative replay PASS.
    expect(
      evaluateInv006(
        bundle({
          chaosProcessingAttempts: [
            attempt({
              id: PROC_B,
              sourceKind: "REAL_RAZORPAY_WEBHOOK",
              chaosRunId: "run",
            }),
          ],
        }),
      ).disposition,
    ).toBe("NOT_APPLICABLE");
  });

  it("ARCHITECT REGRESSION — an unverified source is UNKNOWN, never a replay PASS", () => {
    expect(
      evaluateInv006(
        bundle({
          sourceWebhook: webhook({ signatureVerified: false }),
          chaosProcessingAttempts: [replay()],
        }),
      ).disposition,
    ).toBe("UNKNOWN");
  });

  it("ARCHITECT REGRESSION — no prior SUCCEEDED processing is UNKNOWN, never a replay PASS", () => {
    const result = evaluateInv006(
      bundle({
        originalProcessingAttempts: [attempt({ status: "FAILED" })],
        chaosProcessingAttempts: [replay()],
      }),
    );
    expect(result.disposition).toBe("UNKNOWN");
    expect(persistableOf(result).observedSummary).toContain("SUCCEEDED = none");
  });
});

// ============================================================================
// INV-007 — applicability is repeated triggering
// ============================================================================

describe("INV-007 — duplicate delivery creates no duplicate business record", () => {
  const duplicateAttempts = [
    attempt({ id: PROC_A }),
    attempt({
      id: PROC_B,
      isDuplicateDelivery: true,
      status: "SKIPPED_DUPLICATE",
    }),
  ];

  it("ARCHITECT REGRESSION — a single normal processing is NOT_APPLICABLE, never a persisted PASS", () => {
    // Old behaviour: applicability was merely "an order is correlated", so a
    // perfectly ordinary one-shot order received an authoritative PASS for a
    // duplicate-delivery invariant whose precondition never occurred.
    const result = evaluateInv007(bundle());
    expect(result.disposition).toBe("NOT_APPLICABLE");
    expect(result.reason).toContain("not triggered more than once");
  });

  it("PASS: duplicate-flagged delivery with exactly one business record", () => {
    const result = evaluateInv007(
      bundle({ originalProcessingAttempts: duplicateAttempts }),
    );
    expect(result.disposition).toBe("PASS");
    expect(persistableOf(result).observedSummary).toContain(
      "duplicate-flagged = 1",
    );
  });

  it("PASS: a replay attempt establishes repeated triggering", () => {
    expect(
      evaluateInv007(
        bundle({
          chaosProcessingAttempts: [
            attempt({
              id: PROC_B,
              sourceKind: "PAYCHAOS_REPLAY",
              chaosRunId: "run",
            }),
          ],
        }),
      ).disposition,
    ).toBe("PASS");
  });

  it("PASS: a reported duplicate delivery count establishes repeated triggering", () => {
    expect(
      evaluateInv007(
        bundle({ sourceWebhook: webhook({ duplicateDeliveryCount: 1 }) }),
      ).disposition,
    ).toBe("PASS");
  });

  it("FAIL: repeated triggering produced a second FULFIL_ORDER for the order", () => {
    const two = snapshot({
      fulfilments: [fulfilment(), fulfilment({ id: FULFILMENT_B })],
    });
    expect(
      evaluateInv007(
        bundle({
          originalProcessingAttempts: [
            attempt({
              id: PROC_A,
              stateBefore: captured(two),
              stateAfter: captured(two),
            }),
            attempt({
              id: PROC_B,
              isDuplicateDelivery: true,
              stateBefore: captured(two),
              stateAfter: captured(two),
            }),
          ],
        }),
      ).disposition,
    ).toBe("FAIL");
  });

  it("UNKNOWN: repeated triggering with incomplete fulfilment evidence", () => {
    const uncounted = snapshot({ fulfilments: null });
    expect(
      evaluateInv007(
        bundle({
          originalProcessingAttempts: [
            attempt({
              id: PROC_A,
              stateBefore: captured(uncounted),
              stateAfter: captured(uncounted),
            }),
            attempt({
              id: PROC_B,
              isDuplicateDelivery: true,
              stateBefore: captured(uncounted),
              stateAfter: captured(uncounted),
            }),
          ],
        }),
      ).disposition,
    ).toBe("UNKNOWN");
  });

  it("UNKNOWN: repeated triggering observed but no correlated order to count against", () => {
    const result = evaluateInv007(
      bundle({ orderId: null, originalProcessingAttempts: duplicateAttempts }),
    );
    expect(result.disposition).toBe("UNKNOWN");
    expect(persistableOf(result).observedSummary).toContain(
      "no merchant order is correlated",
    );
  });
});

// ============================================================================
// INV-008 — money, with trusted-webhook NULL handling
// ============================================================================

describe("INV-008 — amount and currency consistency", () => {
  it("PASS: every amount and currency matches exactly", () => {
    expect(evaluateInv008(bundle()).disposition).toBe("PASS");
  });

  it("E: a trusted webhook 1-subunit mismatch -> FAIL", () => {
    expect(
      evaluateInv008(
        bundle({
          sourceWebhook: webhook({
            id: "14141414-1414-4141-8141-141414141414",
            amountSubunits: 49999,
          }),
        }),
      ).disposition,
    ).toBe("FAIL");
  });

  it("F: a trusted webhook currency mismatch -> FAIL", () => {
    expect(
      evaluateInv008(
        bundle({
          sourceWebhook: webhook({
            id: "14141414-1414-4141-8141-141414141414",
            currency: "USD",
          }),
        }),
      ).disposition,
    ).toBe("FAIL");
  });

  it("FAIL: a one-subunit merchant mismatch", () => {
    const mismatched = snapshot({ paymentAmountSubunits: 49999 });
    expect(
      evaluateInv008(
        bundle({
          sourceWebhook: null,
          originalProcessingAttempts: [
            attempt({
              stateBefore: captured(mismatched),
              stateAfter: captured(mismatched),
            }),
          ],
        }),
      ).disposition,
    ).toBe("FAIL");
  });

  it("FAIL: a merchant currency mismatch at an identical integer amount", () => {
    const mismatched = snapshot({ paymentCurrency: "USD" });
    expect(
      evaluateInv008(
        bundle({
          sourceWebhook: null,
          originalProcessingAttempts: [
            attempt({
              stateBefore: captured(mismatched),
              stateAfter: captured(mismatched),
            }),
          ],
        }),
      ).disposition,
    ).toBe("FAIL");
  });

  // ---- ARCHITECT REGRESSION: a NULL webhook money component was skipped ----

  it("ARCHITECT REGRESSION A — source webhook amount NULL is UNKNOWN, never a silent PASS", () => {
    // Old behaviour: the webhook comparison ran only when BOTH components
    // were non-null, so a trusted webhook with a NULL amount was silently
    // skipped and the evaluator returned an authoritative PASS.
    const result = evaluateInv008(
      bundle({
        sourceWebhook: webhook({
          id: "14141414-1414-4141-8141-141414141414",
          amountSubunits: null,
        }),
      }),
    );
    expect(result.disposition).toBe("UNKNOWN");
    expect(persistableOf(result).observedSummary).toContain(
      "no usable amount or currency",
    );
  });

  it("ARCHITECT REGRESSION B — source webhook currency NULL is UNKNOWN, never a silent PASS", () => {
    expect(
      evaluateInv008(
        bundle({
          sourceWebhook: webhook({
            id: "14141414-1414-4141-8141-141414141414",
            currency: null,
          }),
        }),
      ).disposition,
    ).toBe("UNKNOWN");
  });

  it("ARCHITECT REGRESSION C — authoritative capture webhook amount NULL is UNKNOWN", () => {
    // Old behaviour: the capture webhook was never consulted for money at all.
    // The resolution and projection name the same row so this isolates the
    // money-NULL rule rather than the consistency check.
    expect(
      evaluateInv008(
        bundle({
          sourceWebhook: null,
          ...captureOf(
            webhook({ id: CAPTURE_WEBHOOK_ID, amountSubunits: null }),
          ),
        }),
      ).disposition,
    ).toBe("UNKNOWN");
  });

  it("ARCHITECT REGRESSION D — authoritative capture webhook currency NULL is UNKNOWN", () => {
    expect(
      evaluateInv008(
        bundle({
          sourceWebhook: null,
          ...captureOf(webhook({ id: CAPTURE_WEBHOOK_ID, currency: null })),
        }),
      ).disposition,
    ).toBe("UNKNOWN");
  });

  it("ARCHITECT REGRESSION — the capture webhook's money mismatch is now caught -> FAIL", () => {
    expect(
      evaluateInv008(
        bundle({
          sourceWebhook: null,
          ...captureOf(
            webhook({ id: CAPTURE_WEBHOOK_ID, amountSubunits: 49999 }),
          ),
        }),
      ).disposition,
    ).toBe("FAIL");
  });

  it("G: the same webhook in both roles is deduped and stays deterministic", () => {
    const shared = webhook();
    const once = evaluateInv008(
      bundle({ sourceWebhook: shared, authoritativeCaptureWebhook: shared }),
    );
    const again = evaluateInv008(
      bundle({ sourceWebhook: shared, authoritativeCaptureWebhook: shared }),
    );
    expect(once.disposition).toBe("PASS");
    expect(JSON.stringify(again)).toBe(JSON.stringify(once));
    const ids = once.evidenceRefs.map((r) => `${r.kind}::${r.id}`);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("H: an unrelated trusted webhook never becomes money authority", () => {
    // A different payment entirely: its mismatched money must be ignored. The
    // authoritative capture stays intact so the precondition still holds.
    expect(
      evaluateInv008(
        bundle({
          sourceWebhook: webhook({
            id: "12121212-1212-4121-8121-121212121212",
            paymentId: "99999999-9999-4999-8999-999999999999",
            razorpayPaymentId: "pay_SOMETHINGELSE",
            amountSubunits: 1,
          }),
        }),
      ).disposition,
    ).toBe("PASS");
  });

  it("H2: an UNTRUSTED webhook never becomes money authority", () => {
    expect(
      evaluateInv008(
        bundle({
          sourceWebhook: webhook({
            id: "13131313-1313-4131-8131-131313131313",
            signatureVerified: false,
            amountSubunits: 1,
          }),
        }),
      ).disposition,
    ).toBe("PASS");
  });

  it("ARCHITECT REGRESSION — an unestablished payment path is UNKNOWN, never PASS", () => {
    // Old behaviour: three merchant numbers merely existing produced an
    // authoritative PASS without the documented correlation precondition.
    const noAttempt = snapshot({ withPaymentAttempt: false });
    const result = evaluateInv008(
      bundle({
        originalProcessingAttempts: [
          attempt({
            stateBefore: captured(noAttempt),
            stateAfter: captured(noAttempt),
          }),
        ],
      }),
    );
    expect(result.disposition).toBe("UNKNOWN");
    expect(persistableOf(result).observedSummary).toContain("not established");
  });

  it("UNKNOWN: a required merchant amount is NULL — never defaulted to 0", () => {
    const base = snapshot();
    const nullAmount = {
      ...base,
      payment: { ...base.payment!, amountSubunits: null as unknown as number },
    };
    expect(
      evaluateInv008(
        bundle({
          sourceWebhook: null,
          originalProcessingAttempts: [
            attempt({
              stateBefore: captured(nullAmount),
              stateAfter: captured(nullAmount),
            }),
          ],
        }),
      ).disposition,
    ).toBe("UNKNOWN");
  });

  it("UNKNOWN: a required merchant currency is NULL — never defaulted to INR", () => {
    const base = snapshot();
    const nullCurrency = {
      ...base,
      payment: { ...base.payment!, currency: null as unknown as string },
    };
    expect(
      evaluateInv008(
        bundle({
          sourceWebhook: null,
          originalProcessingAttempts: [
            attempt({
              stateBefore: captured(nullCurrency),
              stateAfter: captured(nullCurrency),
            }),
          ],
        }),
      ).disposition,
    ).toBe("UNKNOWN");
  });

  // ---- ARCHITECT NARROW-01: applicability is decided BEFORE money ----

  it("NARROW-01 A — NONE_OBSERVED + a merchant amount mismatch is NOT_APPLICABLE, never FAIL", () => {
    // Old behaviour: money was compared first, so a definitively-uncaptured
    // payment could FAIL a rule whose precondition it never satisfied.
    const mismatched = snapshot({ paymentAmountSubunits: 49999 });
    const result = evaluateInv008(
      bundle({
        sourceWebhook: null,
        authoritativeCapture: { kind: "NONE_OBSERVED" },
        authoritativeCaptureWebhook: null,
        originalProcessingAttempts: [
          attempt({
            stateBefore: captured(mismatched),
            stateAfter: captured(mismatched),
          }),
        ],
      }),
    );
    expect(result.disposition).toBe("NOT_APPLICABLE");
    expect(result.reason).toContain("No money comparison is performed");
  });

  it("NARROW-01 B — NONE_OBSERVED + a currency mismatch is NOT_APPLICABLE", () => {
    const mismatched = snapshot({ paymentCurrency: "USD" });
    expect(
      evaluateInv008(
        bundle({
          sourceWebhook: null,
          authoritativeCapture: { kind: "NONE_OBSERVED" },
          authoritativeCaptureWebhook: null,
          originalProcessingAttempts: [
            attempt({
              stateBefore: captured(mismatched),
              stateAfter: captured(mismatched),
            }),
          ],
        }),
      ).disposition,
    ).toBe("NOT_APPLICABLE");
  });

  it.each(["SEARCH_INCOMPLETE", "NO_SUBJECT", "AMBIGUOUS_SUBJECT"] as const)(
    "NARROW-01 C — %s + a proven merchant mismatch is UNKNOWN, never FAIL",
    (kind) => {
      const mismatched = snapshot({ paymentAmountSubunits: 49999 });
      expect(
        evaluateInv008(
          bundle({
            sourceWebhook: null,
            authoritativeCapture: { kind },
            authoritativeCaptureWebhook: null,
            originalProcessingAttempts: [
              attempt({
                stateBefore: captured(mismatched),
                stateAfter: captured(mismatched),
              }),
            ],
          }),
        ).disposition,
      ).toBe("UNKNOWN");
    },
  );

  it("NARROW-01 D — INCOMPLETE_INTERNAL_CORRELATION + a money mismatch is UNKNOWN, never FAIL", () => {
    const mismatched = snapshot({ paymentAmountSubunits: 49999 });
    expect(
      evaluateInv008(
        bundle({
          sourceWebhook: null,
          authoritativeCapture: {
            kind: "INCOMPLETE_INTERNAL_CORRELATION",
            webhook: webhook(),
          },
          authoritativeCaptureWebhook: webhook(),
          originalProcessingAttempts: [
            attempt({
              stateBefore: captured(mismatched),
              stateAfter: captured(mismatched),
            }),
          ],
        }),
      ).disposition,
    ).toBe("UNKNOWN");
  });

  it("NARROW-01 E/F/G — with EXACTLY_ONE trusted capture the money rule applies normally", () => {
    const oneOff = snapshot({ paymentAmountSubunits: 49999 });
    expect(
      evaluateInv008(
        bundle({
          sourceWebhook: null,
          originalProcessingAttempts: [
            attempt({
              stateBefore: captured(oneOff),
              stateAfter: captured(oneOff),
            }),
          ],
        }),
      ).disposition,
    ).toBe("FAIL");

    const wrongCurrency = snapshot({ paymentCurrency: "USD" });
    expect(
      evaluateInv008(
        bundle({
          sourceWebhook: null,
          originalProcessingAttempts: [
            attempt({
              stateBefore: captured(wrongCurrency),
              stateAfter: captured(wrongCurrency),
            }),
          ],
        }),
      ).disposition,
    ).toBe("FAIL");

    expect(evaluateInv008(bundle()).disposition).toBe("PASS");
  });

  it("a proven mismatch dominates an indeterminate value", () => {
    const base = snapshot({ paymentAmountSubunits: 49999 });
    expect(
      evaluateInv008(
        bundle({
          sourceWebhook: webhook({
            id: "14141414-1414-4141-8141-141414141414",
            currency: null,
          }),
          originalProcessingAttempts: [
            attempt({
              stateBefore: captured(base),
              stateAfter: captured(base),
            }),
          ],
        }),
      ).disposition,
    ).toBe("FAIL");
  });
});

// ============================================================================
// INV-009 — all four conditions
// ============================================================================

describe("INV-009 — failed processing is atomic or safely retryable", () => {
  it("NOT_APPLICABLE: no attempt ended FAILED", () => {
    expect(evaluateInv009(bundle()).disposition).toBe("NOT_APPLICABLE");
  });

  it("A: FAILED + unchanged state + canonical event not fully processed -> PASS", () => {
    const result = evaluateInv009(
      bundle({
        sourceWebhook: retryableSource,
        originalProcessingAttempts: [cleanFailedAttempt()],
      }),
    );
    expect(result.disposition).toBe("PASS");
    expect(persistableOf(result).observedSummary).toContain(
      "retry remains possible",
    );
  });

  it("ARCHITECT REGRESSION B — FAILED + unchanged state BUT canonical event falsely PROCESSED -> FAIL", () => {
    // Old behaviour: PASS. Only the before/after tuple was compared, so an
    // event left falsely marked fully processed by a failed attempt slipped
    // through as an authoritative PASS.
    const result = evaluateInv009(
      bundle({
        sourceWebhook: webhook({ processingStatus: "PROCESSED" }),
        originalProcessingAttempts: [cleanFailedAttempt()],
      }),
    );
    expect(result.disposition).toBe("FAIL");
    expect(persistableOf(result).observedSummary).toContain(
      "no independent SUCCEEDED attempt",
    );
  });

  it("ARCHITECT REGRESSION C — a protected fulfilment attributed to the FAILED attempt -> FAIL", () => {
    // Old behaviour: PASS whenever before == after, even though a durable
    // fulfilment named the failed attempt as its trigger.
    const withAttributed = snapshot({
      fulfilments: [fulfilment({ triggerProcessingAttemptId: PROC_A })],
    });
    const result = evaluateInv009(
      bundle({
        sourceWebhook: retryableSource,
        originalProcessingAttempts: [
          attempt({
            id: PROC_A,
            status: "FAILED",
            stateBefore: captured(withAttributed),
            stateAfter: captured(withAttributed),
          }),
        ],
      }),
    );
    expect(result.disposition).toBe("FAIL");
    expect(persistableOf(result).observedSummary).toContain(
      "attributed to a FAILED attempt",
    );
  });

  it("D: FAILED + a surviving partial merchant mutation -> FAIL", () => {
    expect(
      evaluateInv009(
        bundle({
          sourceWebhook: retryableSource,
          originalProcessingAttempts: [
            attempt({
              status: "FAILED",
              stateBefore: captured(
                snapshot({ orderPaymentStatus: "PENDING", fulfilments: [] }),
              ),
              stateAfter: captured(
                snapshot({
                  orderPaymentStatus: "PENDING",
                  fulfilments: [
                    fulfilment({ triggerProcessingAttemptId: PROC_B }),
                  ],
                }),
              ),
            }),
          ],
        }),
      ).disposition,
    ).toBe("FAIL");
  });

  it("E: FAILED after an independent SUCCEEDED idempotent attempt -> PASS", () => {
    const result = evaluateInv009(
      bundle({
        sourceWebhook: webhook({ processingStatus: "PROCESSED" }),
        originalProcessingAttempts: [
          attempt({ id: PROC_A, status: "SUCCEEDED" }),
          cleanFailedAttempt({ id: PROC_B }),
        ],
      }),
    );
    expect(result.disposition).toBe("PASS");
    expect(persistableOf(result).observedSummary).toContain(
      "independent SUCCEEDED attempts = 1",
    );
  });

  it("F: the canonical source is unresolvable, so retry-safety is UNKNOWN", () => {
    expect(
      evaluateInv009(
        bundle({
          sourceWebhook: null,
          originalProcessingAttempts: [cleanFailedAttempt()],
        }),
      ).disposition,
    ).toBe("UNKNOWN");
  });

  it("G: missing before/after evidence -> UNKNOWN", () => {
    expect(
      evaluateInv009(
        bundle({
          sourceWebhook: retryableSource,
          originalProcessingAttempts: [
            attempt({
              status: "FAILED",
              stateBefore: notCaptured,
              stateAfter: notCaptured,
            }),
          ],
        }),
      ).disposition,
    ).toBe("UNKNOWN");
  });

  it("a processor error alone is never itself a FAIL", () => {
    expect(
      evaluateInv009(
        bundle({
          sourceWebhook: retryableSource,
          originalProcessingAttempts: [
            cleanFailedAttempt({ errorCode: "PROCESSOR_TIMEOUT" }),
          ],
        }),
      ).disposition,
    ).toBe("PASS");
  });
});

// ============================================================================
// INV-010
// ============================================================================

describe("INV-010 — fulfilment has exactly one valid payment path", () => {
  it("NOT_APPLICABLE: no fulfilment exists", () => {
    const none = snapshot({ fulfilments: [] });
    expect(
      evaluateInv010(
        bundle({
          originalProcessingAttempts: [
            attempt({
              stateBefore: captured(none),
              stateAfter: captured(none),
            }),
          ],
        }),
      ).disposition,
    ).toBe("NOT_APPLICABLE");
  });

  it("PASS: one valid payment -> attempt -> order chain with authoritative capture", () => {
    expect(evaluateInv010(bundle()).disposition).toBe("PASS");
  });

  it("FAIL: the fulfilment references a payment outside the captured path", () => {
    const wrong = snapshot({
      fulfilments: [
        fulfilment({ paymentId: "99999999-9999-4999-8999-999999999999" }),
      ],
    });
    expect(
      evaluateInv010(
        bundle({
          originalProcessingAttempts: [
            attempt({
              stateBefore: captured(wrong),
              stateAfter: captured(wrong),
            }),
          ],
        }),
      ).disposition,
    ).toBe("FAIL");
  });

  it("FAIL: the fulfilment belongs to another order", () => {
    const wrong = snapshot({
      fulfilments: [
        fulfilment({ orderId: "88888888-8888-4888-8888-888888888888" }),
      ],
    });
    expect(
      evaluateInv010(
        bundle({
          originalProcessingAttempts: [
            attempt({
              stateBefore: captured(wrong),
              stateAfter: captured(wrong),
            }),
          ],
        }),
      ).disposition,
    ).toBe("FAIL");
  });

  it("FAIL: the payment attempt belongs to another order — shared helper, not weakened", () => {
    const base = snapshot();
    const broken = {
      ...base,
      paymentAttempt: {
        ...base.paymentAttempt!,
        orderId: "77777777-7777-4777-8777-777777777777",
      },
    };
    expect(
      evaluateInv010(
        bundle({
          originalProcessingAttempts: [
            attempt({
              stateBefore: captured(broken),
              stateAfter: captured(broken),
            }),
          ],
        }),
      ).disposition,
    ).toBe("FAIL");
  });

  it("FAIL: valid chain but the completed search found no authoritative capture", () => {
    expect(
      evaluateInv010(
        bundle({
          authoritativeCapture: { kind: "NONE_OBSERVED" },
          authoritativeCaptureWebhook: null,
        }),
      ).disposition,
    ).toBe("FAIL");
  });

  it("UNKNOWN: ambiguous or incomplete capture evidence", () => {
    for (const kind of ["SEARCH_INCOMPLETE", "AMBIGUOUS_SUBJECT"] as const) {
      expect(
        evaluateInv010(
          bundle({
            authoritativeCapture: { kind },
            authoritativeCaptureWebhook: null,
          }),
        ).disposition,
      ).toBe("UNKNOWN");
    }
  });

  it("ARCHITECT REGRESSION C — a money mismatch alone does NOT fail INV-010", () => {
    // Old behaviour: the shared helper carried INV-008's money clause, so a
    // 1-subunit mismatch failed INV-010 as well. INV-010 §8 has no
    // amount/currency condition at all — money is INV-008's rule, and
    // double-reporting one defect under two rules is wrong.
    const mismatched = snapshot({ paymentAmountSubunits: 49999 });
    const mismatchedBundle = bundle({
      sourceWebhook: null,
      originalProcessingAttempts: [
        attempt({
          stateBefore: captured(mismatched),
          stateAfter: captured(mismatched),
        }),
      ],
    });
    expect(evaluateInv010(mismatchedBundle).disposition).toBe("PASS");
    // ...while INV-008 correctly reports the very same evidence as FAIL.
    expect(evaluateInv008(mismatchedBundle).disposition).toBe("FAIL");
  });

  it("ARCHITECT REGRESSION A — the same valid chain repeated across snapshots is still exactly one path", () => {
    const same = snapshot();
    const result = evaluateInv010(
      bundle({
        originalProcessingAttempts: [
          attempt({
            id: PROC_A,
            stateBefore: captured(same),
            stateAfter: captured(same),
          }),
          attempt({
            id: PROC_B,
            stateBefore: captured(same),
            stateAfter: captured(same),
          }),
        ],
      }),
    );
    expect(result.disposition).toBe("PASS");
    expect(persistableOf(result).observedSummary).toContain(
      "distinct valid payment paths per fulfilment = 1",
    );
  });

  it.each([
    ["A — capture webhook null"],
    ["B — capture webhook unverified"],
    ["C — capture event type is payment.failed"],
    ["D — capture is for a different payment"],
  ])("NARROW-03 %s -> UNKNOWN, never PASS", (label) => {
    const variant = label.startsWith("A")
      ? { capture: webhook(), hook: null }
      : label.startsWith("B")
        ? (() => {
            const w = webhook({ signatureVerified: false });
            return { capture: w, hook: w };
          })()
        : label.startsWith("C")
          ? (() => {
              const w = webhook({ eventType: "payment.failed" });
              return { capture: w, hook: w };
            })()
          : (() => {
              const w = webhook({
                id: "16161616-1616-4161-8161-161616161616",
                paymentId: "99999999-9999-4999-8999-999999999999",
                razorpayPaymentId: "pay_ANOTHERPAYMENT",
              });
              return { capture: w, hook: w };
            })();
    const result = evaluateInv010(
      bundle({
        authoritativeCapture: { kind: "EXACTLY_ONE", webhook: variant.capture },
        authoritativeCaptureWebhook: variant.hook,
      }),
    );
    expect(result.disposition).not.toBe("PASS");
    expect(result.disposition).toBe("UNKNOWN");
  });

  it("NARROW-03 F — money mismatch still does not affect INV-010", () => {
    const mismatched = snapshot({ paymentAmountSubunits: 49999 });
    expect(
      evaluateInv010(
        bundle({
          sourceWebhook: null,
          originalProcessingAttempts: [
            attempt({
              stateBefore: captured(mismatched),
              stateAfter: captured(mismatched),
            }),
          ],
        }),
      ).disposition,
    ).toBe("PASS");
  });

  it("ARCHITECT REGRESSION B — two DISTINCT valid chains for one fulfilment -> FAIL as ambiguous", () => {
    // The same fulfilment resolves through two different payment-attempt
    // identities across two captured snapshots. The joined valid path count is
    // 2, not 1, so the relation is ambiguous.
    const base = snapshot();
    const secondAttemptId = "31313131-3131-4131-8131-313131313131";
    const alternate = {
      ...base,
      paymentAttempt: { ...base.paymentAttempt!, id: secondAttemptId },
      payment: { ...base.payment!, paymentAttemptId: secondAttemptId },
    };
    const result = evaluateInv010(
      bundle({
        originalProcessingAttempts: [
          attempt({
            id: PROC_A,
            stateBefore: captured(base),
            stateAfter: captured(base),
          }),
          attempt({
            id: PROC_B,
            stateBefore: captured(alternate),
            stateAfter: captured(alternate),
          }),
        ],
      }),
    );
    expect(result.disposition).toBe("FAIL");
    expect(persistableOf(result).observedSummary).toContain(
      "distinct valid payment paths for one fulfilment = 2",
    );
  });
});

// ============================================================================
// INV-011
// ============================================================================

describe("INV-011 — payment state is legal, monotonic and convergent", () => {
  const transition = (from: string, to: string) =>
    bundle({
      originalProcessingAttempts: [
        attempt({
          stateBefore: captured(
            snapshot({
              orderPaymentStatus: from,
              orderBusinessStatus: "OPEN",
              fulfilments: [],
            }),
          ),
          stateAfter: captured(
            snapshot({
              orderPaymentStatus: to,
              orderBusinessStatus: "OPEN",
              fulfilments: [],
            }),
          ),
        }),
      ],
      authoritativeCapture: { kind: "NONE_OBSERVED" },
      authoritativeCaptureWebhook: null,
    });

  it.each([
    ["UNPAID", "PENDING"],
    ["UNPAID", "PAID"],
    ["PENDING", "FAILED_OBSERVED"],
    ["PENDING", "PAID"],
    ["FAILED_OBSERVED", "PENDING"],
    ["FAILED_OBSERVED", "PAID"],
    ["PAID", "PAID"],
  ])("PASS: %s -> %s is legal", (from, to) => {
    expect(evaluateInv011(transition(from, to)).disposition).toBe("PASS");
  });

  it.each([
    ["PAID", "PENDING"],
    ["PAID", "FAILED_OBSERVED"],
    ["PAID", "UNPAID"],
  ])("FAIL: %s -> %s is an illegal PAID regression", (from, to) => {
    expect(evaluateInv011(transition(from, to)).disposition).toBe("FAIL");
  });

  it.each([
    ["UNPAID", "UNPAID"],
    ["PENDING", "PENDING"],
    ["FAILED_OBSERVED", "FAILED_OBSERVED"],
  ])(
    "ARCHITECT REGRESSION — %s -> %s is NO TRANSITION, not a member of the legal set",
    (from, to) => {
      // Old behaviour: these three were silently added to the frozen legal set
      // and reported as LEGAL. They are not in the source-of-truth matrix.
      expect(evaluateOrderPaymentStatusTransition(from, to)).toBe(
        "NO_TRANSITION",
      );
      // The evaluator still passes — nothing illegal was observed — but it
      // counts zero legal payment-status transitions, not one.
      const result = evaluateInv011(transition(from, to));
      expect(result.disposition).toBe("PASS");
      expect(persistableOf(result).observedSummary).toContain(
        "legal transitions observed = 0",
      );
    },
  );

  it("PAID -> PAID remains explicitly LEGAL and is counted as a transition", () => {
    expect(evaluateOrderPaymentStatusTransition("PAID", "PAID")).toBe("LEGAL");
    const result = evaluateInv011(transition("PAID", "PAID"));
    expect(persistableOf(result).observedSummary).toContain(
      "legal transitions observed = 1",
    );
  });

  it("FAIL: FULFILLED -> OPEN business-status regression", () => {
    expect(
      evaluateInv011(
        bundle({
          originalProcessingAttempts: [
            attempt({
              stateBefore: captured(
                snapshot({ orderBusinessStatus: "FULFILLED" }),
              ),
              stateAfter: captured(
                snapshot({
                  orderBusinessStatus: "OPEN",
                  orderPaymentStatus: "PAID",
                }),
              ),
            }),
          ],
        }),
      ).disposition,
    ).toBe("FAIL");
  });

  // ---- ARCHITECT NARROW-04: OPEN -> FULFILLED must COMMIT the fulfilment ----

  const openState = (fulfilments: ReturnType<typeof fulfilment>[]) =>
    snapshot({
      orderPaymentStatus: "PAID",
      orderBusinessStatus: "OPEN",
      fulfilments,
    });
  const fulfilledState = (fulfilments: ReturnType<typeof fulfilment>[]) =>
    snapshot({
      orderPaymentStatus: "PAID",
      orderBusinessStatus: "FULFILLED",
      fulfilments,
    });

  it("NARROW-04 — OPEN -> FULFILLED committing a new fulfilment attributed to this attempt is legal", () => {
    expect(
      evaluateInv011(
        bundle({
          originalProcessingAttempts: [
            attempt({
              id: PROC_A,
              stateBefore: captured(openState([])),
              stateAfter: captured(
                fulfilledState([
                  fulfilment({ triggerProcessingAttemptId: PROC_A }),
                ]),
              ),
            }),
          ],
        }),
      ).disposition,
    ).toBe("PASS");
  });

  it("NARROW-04 — OPEN -> FULFILLED with a PRE-EXISTING fulfilment row -> FAIL", () => {
    // The row already existed before the transition, so this transition did
    // not commit the fulfilment §12 requires.
    const existing = [fulfilment({ triggerProcessingAttemptId: PROC_A })];
    const result = evaluateInv011(
      bundle({
        originalProcessingAttempts: [
          attempt({
            id: PROC_A,
            stateBefore: captured(openState(existing)),
            stateAfter: captured(fulfilledState(existing)),
          }),
        ],
      }),
    );
    expect(result.disposition).toBe("FAIL");
    expect(persistableOf(result).observedSummary).toContain(
      "every row already existed before it",
    );
  });

  it("NARROW-04 — OPEN -> FULFILLED whose new row belongs to ANOTHER attempt -> FAIL", () => {
    const result = evaluateInv011(
      bundle({
        originalProcessingAttempts: [
          attempt({
            id: PROC_A,
            stateBefore: captured(openState([])),
            stateAfter: captured(
              fulfilledState([
                fulfilment({ triggerProcessingAttemptId: PROC_B }),
              ]),
            ),
          }),
        ],
      }),
    );
    expect(result.disposition).toBe("FAIL");
    expect(persistableOf(result).observedSummary).toContain(
      "committed by a different processing attempt",
    );
  });

  it("NARROW-04 — a new row with no trigger attribution -> UNKNOWN", () => {
    expect(
      evaluateInv011(
        bundle({
          originalProcessingAttempts: [
            attempt({
              id: PROC_A,
              stateBefore: captured(openState([])),
              stateAfter: captured(
                fulfilledState([
                  fulfilment({ triggerProcessingAttemptId: null }),
                ]),
              ),
            }),
          ],
        }),
      ).disposition,
    ).toBe("UNKNOWN");
  });

  it("NARROW-04 — an uncaptured before/after fulfilment collection -> UNKNOWN", () => {
    expect(
      evaluateInv011(
        bundle({
          originalProcessingAttempts: [
            attempt({
              id: PROC_A,
              stateBefore: captured(
                snapshot({
                  orderPaymentStatus: "PAID",
                  orderBusinessStatus: "OPEN",
                  fulfilments: null,
                }),
              ),
              stateAfter: captured(
                snapshot({
                  orderPaymentStatus: "PAID",
                  orderBusinessStatus: "FULFILLED",
                  fulfilments: null,
                }),
              ),
            }),
          ],
        }),
      ).disposition,
    ).toBe("UNKNOWN");
  });

  it("NARROW-04 — OPEN -> FULFILLED with a proven absent capture -> FAIL", () => {
    expect(
      evaluateInv011(
        bundle({
          authoritativeCapture: { kind: "NONE_OBSERVED" },
          authoritativeCaptureWebhook: null,
          originalProcessingAttempts: [
            attempt({
              id: PROC_A,
              stateBefore: captured(openState([])),
              stateAfter: captured(
                fulfilledState([
                  fulfilment({ triggerProcessingAttemptId: PROC_A }),
                ]),
              ),
            }),
          ],
        }),
      ).disposition,
    ).toBe("FAIL");
  });

  it("NARROW-04 — OPEN -> FULFILLED with incomplete capture evidence -> UNKNOWN", () => {
    expect(
      evaluateInv011(
        bundle({
          authoritativeCapture: { kind: "SEARCH_INCOMPLETE" },
          authoritativeCaptureWebhook: null,
          originalProcessingAttempts: [
            attempt({
              id: PROC_A,
              stateBefore: captured(openState([])),
              stateAfter: captured(
                fulfilledState([
                  fulfilment({ triggerProcessingAttemptId: PROC_A }),
                ]),
              ),
            }),
          ],
        }),
      ).disposition,
    ).toBe("UNKNOWN");
  });

  it("FAIL: an order marked FULFILLED while not PAID", () => {
    const bad = snapshot({
      orderBusinessStatus: "FULFILLED",
      orderPaymentStatus: "PENDING",
    });
    expect(
      evaluateInv011(
        bundle({
          originalProcessingAttempts: [
            attempt({ stateBefore: captured(bad), stateAfter: captured(bad) }),
          ],
        }),
      ).disposition,
    ).toBe("FAIL");
  });

  it("FAIL: a CAPTURED payment attempt regressed to FAILED_OBSERVED on a stale event", () => {
    expect(
      evaluateInv011(
        bundle({
          authoritativeCapture: { kind: "NONE_OBSERVED" },
          authoritativeCaptureWebhook: null,
          originalProcessingAttempts: [
            attempt({
              stateBefore: captured(
                snapshot({
                  attemptStatus: "CAPTURED",
                  orderPaymentStatus: "PAID",
                }),
              ),
              stateAfter: captured(
                snapshot({
                  attemptStatus: "FAILED_OBSERVED",
                  orderPaymentStatus: "PAID",
                }),
              ),
            }),
          ],
        }),
      ).disposition,
    ).toBe("FAIL");
  });

  it("A: capture + SUCCEEDED + PAID -> PASS", () => {
    expect(evaluateInv011(bundle()).disposition).toBe("PASS");
  });

  it("B: capture + SUCCEEDED + non-PAID -> FAIL", () => {
    const stuck = snapshot({
      orderPaymentStatus: "PENDING",
      orderBusinessStatus: "OPEN",
      fulfilments: [],
    });
    expect(
      evaluateInv011(
        bundle({
          originalProcessingAttempts: [
            attempt({
              status: "SUCCEEDED",
              stateBefore: captured(stuck),
              stateAfter: captured(stuck),
            }),
          ],
        }),
      ).disposition,
    ).toBe("FAIL");
  });

  it.each(["PENDING", "PROCESSING", "HELD", "SKIPPED_DUPLICATE"])(
    "ARCHITECT REGRESSION C-F — capture + %s + non-PAID is neither a false FAIL nor a false PASS",
    (status) => {
      // First round: `status !== FAILED` counted as success, producing a false
      // convergence FAIL. Second round over-corrected to PASS. Neither is
      // right: in-flight processing has not completed successfully and
      // SKIPPED_DUPLICATE did no work, so Rule C's precondition is unmet and
      // convergence is simply UNPROVEN.
      const stuck = snapshot({
        orderPaymentStatus: "PENDING",
        orderBusinessStatus: "OPEN",
        fulfilments: [],
      });
      const result = evaluateInv011(
        bundle({
          originalProcessingAttempts: [
            attempt({
              status,
              stateBefore: captured(stuck),
              stateAfter: captured(stuck),
            }),
          ],
        }),
      );
      expect(result.disposition).not.toBe("FAIL");
      expect(result.disposition).not.toBe("PASS");
      expect(result.disposition).toBe("UNKNOWN");
      expect(persistableOf(result).observedSummary).toContain(
        "no SUCCEEDED capture processing",
      );
    },
  );

  it("G: capture + skipped duplicate + a proven independent SUCCEEDED path is evaluated from that path", () => {
    expect(
      evaluateInv011(
        bundle({
          originalProcessingAttempts: [
            attempt({ id: PROC_A, status: "SUCCEEDED" }),
            attempt({ id: PROC_B, status: "SKIPPED_DUPLICATE" }),
          ],
        }),
      ).disposition,
    ).toBe("PASS");
  });

  it("ARCHITECT REGRESSION — capture exists but the after-state order is unavailable -> UNKNOWN", () => {
    const noOrder = snapshot({ withOrder: false });
    const result = evaluateInv011(
      bundle({
        originalProcessingAttempts: [
          attempt({
            status: "SUCCEEDED",
            stateBefore: captured(noOrder),
            stateAfter: captured(noOrder),
          }),
        ],
      }),
    );
    expect(result.disposition).toBe("UNKNOWN");
    expect(persistableOf(result).observedSummary).toContain(
      "after-state order is unavailable",
    );
  });

  it("PASS: failure observation followed by authoritative capture converges to PAID", () => {
    expect(
      evaluateInv011(
        bundle({
          sourceWebhook: webhook({ eventType: "payment.failed" }),
          originalProcessingAttempts: [
            attempt({
              stateBefore: captured(
                snapshot({
                  orderPaymentStatus: "FAILED_OBSERVED",
                  orderBusinessStatus: "OPEN",
                  fulfilments: [],
                }),
              ),
              stateAfter: captured(snapshot()),
            }),
          ],
        }),
      ).disposition,
    ).toBe("PASS");
  });

  it("UNKNOWN: no attempt carries a complete before/after pair", () => {
    expect(
      evaluateInv011(
        bundle({
          originalProcessingAttempts: [
            attempt({ stateBefore: notCaptured, stateAfter: notCaptured }),
          ],
        }),
      ).disposition,
    ).toBe("UNKNOWN");
  });

  it("UNKNOWN: an unrecognised status value is missing evidence, not a violation", () => {
    expect(
      evaluateInv011(transition("UNPAID", "SOMETHING_ELSE")).disposition,
    ).toBe("UNKNOWN");
  });
});

// ============================================================================
// INV-012
// ============================================================================

describe("INV-012 — unsupported event causes no business effect", () => {
  const unsupported = webhook({ eventType: "refund.created" });

  it.each(["payment.captured", "payment.failed", "order.paid"])(
    "NOT_APPLICABLE: %s is a supported P0 business event",
    (eventType) => {
      expect(
        evaluateInv012(bundle({ sourceWebhook: webhook({ eventType }) }))
          .disposition,
      ).toBe("NOT_APPLICABLE");
    },
  );

  it("PASS: unsupported verified event with zero protected business effect", () => {
    expect(
      evaluateInv012(bundle({ sourceWebhook: unsupported })).disposition,
    ).toBe("PASS");
  });

  it("FAIL: unsupported event mutated the protected business state", () => {
    expect(
      evaluateInv012(
        bundle({
          sourceWebhook: unsupported,
          originalProcessingAttempts: [
            attempt({
              stateBefore: captured(
                snapshot({
                  orderPaymentStatus: "PENDING",
                  orderBusinessStatus: "OPEN",
                }),
              ),
              stateAfter: captured(snapshot()),
            }),
          ],
        }),
      ).disposition,
    ).toBe("FAIL");
  });

  it("ARCHITECT REGRESSION — one incomplete attempt is UNKNOWN even when another is complete", () => {
    // Old behaviour: complete pairs were filtered first, so an incomplete
    // attempt was silently ignored once any complete pair existed, and the
    // evaluator returned an authoritative PASS on partial evidence.
    const result = evaluateInv012(
      bundle({
        sourceWebhook: unsupported,
        originalProcessingAttempts: [
          attempt({ id: PROC_A }),
          attempt({
            id: PROC_B,
            stateBefore: notCaptured,
            stateAfter: notCaptured,
          }),
        ],
      }),
    );
    expect(result.disposition).toBe("UNKNOWN");
    expect(persistableOf(result).observedSummary).toContain(
      "without complete protected-state evidence = 1",
    );
  });

  it("ARCHITECT REGRESSION — a proven mutation still dominates an incomplete attempt -> FAIL", () => {
    expect(
      evaluateInv012(
        bundle({
          sourceWebhook: unsupported,
          originalProcessingAttempts: [
            attempt({
              id: PROC_A,
              stateBefore: captured(
                snapshot({ orderPaymentStatus: "PENDING" }),
              ),
              stateAfter: captured(snapshot()),
            }),
            attempt({
              id: PROC_B,
              stateBefore: notCaptured,
              stateAfter: notCaptured,
            }),
          ],
        }),
      ).disposition,
    ).toBe("FAIL");
  });

  it("ARCHITECT REGRESSION — untrusted evidence never manufactures an authoritative PASS", () => {
    const result = evaluateInv012(
      bundle({
        sourceWebhook: webhook({
          eventType: "refund.created",
          signatureVerified: false,
        }),
      }),
    );
    expect(result.disposition).toBe("UNKNOWN");
    expect(persistableOf(result).observedSummary).toContain(
      "signature verified = false",
    );
  });

  it("UNKNOWN: no processing attempt evidence exists at all", () => {
    expect(
      evaluateInv012(
        bundle({ sourceWebhook: unsupported, originalProcessingAttempts: [] }),
      ).disposition,
    ).toBe("UNKNOWN");
  });

  it("UNKNOWN: no canonical webhook was resolved", () => {
    expect(evaluateInv012(bundle({ sourceWebhook: null })).disposition).toBe(
      "UNKNOWN",
    );
  });
});

// ============================================================================
// CAPTURE AUTHORITY — internal AND provider identity (architect FINAL round)
// ============================================================================

describe("authoritative capture authority requires BOTH identities to agree", () => {
  /** Provider id matches, internal id contradicts. */
  const providerOnly = webhook({
    paymentId: "99999999-9999-4999-8999-999999999999",
    razorpayPaymentId: "pay_TESTFIXTURE0001",
  });
  /** Internal id matches, provider id contradicts. */
  const internalOnly = webhook({
    paymentId: PAYMENT_ID,
    razorpayPaymentId: "pay_SOMEOTHERPAYMENT",
  });
  const internalNull = webhook({
    paymentId: null,
    razorpayPaymentId: "pay_TESTFIXTURE0001",
  });
  const providerNull = webhook({
    paymentId: PAYMENT_ID,
    razorpayPaymentId: null,
  });

  it("A — both identities exact: healthy INV-004 / INV-008 / INV-010 remain eligible PASS", () => {
    const healthy = bundle();
    expect(evaluateInv004(healthy).disposition).toBe("PASS");
    expect(evaluateInv008(healthy).disposition).toBe("PASS");
    expect(evaluateInv010(healthy).disposition).toBe("PASS");
  });

  it("B — provider-only match is UNKNOWN for INV-004 and INV-010, never PASS", () => {
    // The OLD `internal OR provider` rule granted authority here, letting a
    // capture whose internal correlation names a DIFFERENT payment authorise
    // this fulfilment.
    const b = bundle(captureOf(providerOnly));
    for (const result of [evaluateInv004(b), evaluateInv010(b)]) {
      expect(result.disposition).not.toBe("PASS");
      expect(result.disposition).toBe("UNKNOWN");
    }
    const inv008 = evaluateInv008(b);
    expect(inv008.disposition).toBe("UNKNOWN");
    expect(persistableOf(inv008).observedSummary).toContain(
      "internal payment identity contradicts",
    );
  });

  it("C — internal-only match is UNKNOWN for INV-004 and INV-010, never PASS", () => {
    const b = bundle(captureOf(internalOnly));
    for (const result of [evaluateInv004(b), evaluateInv010(b)]) {
      expect(result.disposition).not.toBe("PASS");
      expect(result.disposition).toBe("UNKNOWN");
    }
    const inv008 = evaluateInv008(b);
    expect(inv008.disposition).toBe("UNKNOWN");
    expect(persistableOf(inv008).observedSummary).toContain(
      "provider payment identity contradicts",
    );
  });

  it("D — a NULL internal payment id is UNKNOWN", () => {
    const b = bundle(captureOf(internalNull));
    expect(evaluateInv004(b).disposition).toBe("UNKNOWN");
    expect(evaluateInv010(b).disposition).toBe("UNKNOWN");
    expect(evaluateInv008(b).disposition).toBe("UNKNOWN");
  });

  it("E — a NULL provider Razorpay Payment id is UNKNOWN", () => {
    const b = bundle(captureOf(providerNull));
    expect(evaluateInv004(b).disposition).toBe("UNKNOWN");
    expect(evaluateInv010(b).disposition).toBe("UNKNOWN");
    expect(evaluateInv008(b).disposition).toBe("UNKNOWN");
  });

  it("F — EXACTLY_ONE with a null capture webhook projection is UNKNOWN", () => {
    const b = bundle({
      authoritativeCapture: { kind: "EXACTLY_ONE", webhook: webhook() },
      authoritativeCaptureWebhook: null,
    });
    expect(evaluateInv004(b).disposition).toBe("UNKNOWN");
    expect(evaluateInv010(b).disposition).toBe("UNKNOWN");
    expect(evaluateInv008(b).disposition).toBe("UNKNOWN");
  });

  it("G — a resolution/projection row-id disagreement is UNKNOWN, never arbitrarily resolved", () => {
    const b = bundle({
      authoritativeCapture: { kind: "EXACTLY_ONE", webhook: webhook() },
      authoritativeCaptureWebhook: webhook({ id: CAPTURE_WEBHOOK_ID }),
    });
    const inv008 = evaluateInv008(b);
    expect(inv008.disposition).toBe("UNKNOWN");
    expect(persistableOf(inv008).observedSummary).toContain(
      "identify different persisted rows",
    );
    expect(evaluateInv004(b).disposition).toBe("UNKNOWN");
    expect(evaluateInv010(b).disposition).toBe("UNKNOWN");
  });

  it("H — unverified, replayed or wrong-typed capture evidence is UNKNOWN", () => {
    const variants = [
      webhook({ signatureVerified: false }),
      webhook({ sourceKind: "PAYCHAOS_REPLAY" }),
      webhook({ eventType: "payment.failed" }),
    ];
    for (const variant of variants) {
      const b = bundle(captureOf(variant));
      expect(evaluateInv004(b).disposition).toBe("UNKNOWN");
      expect(evaluateInv010(b).disposition).toBe("UNKNOWN");
      expect(evaluateInv008(b).disposition).toBe("UNKNOWN");
    }
  });

  it("I — INCOMPLETE_INTERNAL_CORRELATION is never promoted to authority by a provider match", () => {
    const b = bundle({
      authoritativeCapture: {
        kind: "INCOMPLETE_INTERNAL_CORRELATION",
        webhook: webhook(),
      },
      authoritativeCaptureWebhook: webhook(),
    });
    expect(evaluateInv004(b).disposition).toBe("UNKNOWN");
    expect(evaluateInv010(b).disposition).toBe("UNKNOWN");
    expect(evaluateInv008(b).disposition).toBe("UNKNOWN");
  });

  it("J — INV-011 OPEN -> FULFILLED needs exact dual identity even with a valid same-attempt commit", () => {
    const openState = snapshot({
      orderPaymentStatus: "PAID",
      orderBusinessStatus: "OPEN",
      fulfilments: [],
    });
    const fulfilledState = snapshot({
      orderPaymentStatus: "PAID",
      orderBusinessStatus: "FULFILLED",
      fulfilments: [fulfilment({ triggerProcessingAttemptId: PROC_A })],
    });
    const commit = attempt({
      id: PROC_A,
      stateBefore: captured(openState),
      stateAfter: captured(fulfilledState),
    });

    for (const variant of [providerOnly, internalOnly]) {
      expect(
        evaluateInv011(
          bundle({
            originalProcessingAttempts: [commit],
            ...captureOf(variant),
          }),
        ).disposition,
      ).toBe("UNKNOWN");
    }

    // Exact dual identity plus the same-attempt commit remains legal.
    expect(
      evaluateInv011(bundle({ originalProcessingAttempts: [commit] }))
        .disposition,
    ).toBe("PASS");
  });
});

// ============================================================================
// STATE LEGALITY HELPER
// ============================================================================

describe("state legality helper — the frozen seven-member transition set", () => {
  it.each([
    ["UNPAID", "PENDING"],
    ["UNPAID", "PAID"],
    ["PENDING", "FAILED_OBSERVED"],
    ["PENDING", "PAID"],
    ["FAILED_OBSERVED", "PENDING"],
    ["FAILED_OBSERVED", "PAID"],
    ["PAID", "PAID"],
  ])("%s -> %s is LEGAL", (from, to) => {
    expect(evaluateOrderPaymentStatusTransition(from, to)).toBe("LEGAL");
  });

  it.each([
    ["PAID", "PENDING"],
    ["PAID", "FAILED_OBSERVED"],
    ["PAID", "UNPAID"],
  ])("%s -> %s is ILLEGAL", (from, to) => {
    expect(evaluateOrderPaymentStatusTransition(from, to)).toBe("ILLEGAL");
  });

  it.each([
    ["UNPAID", "UNPAID"],
    ["PENDING", "PENDING"],
    ["FAILED_OBSERVED", "FAILED_OBSERVED"],
  ])("%s -> %s is NO_TRANSITION, never claimed LEGAL", (from, to) => {
    expect(evaluateOrderPaymentStatusTransition(from, to)).toBe(
      "NO_TRANSITION",
    );
  });

  it("the legal set has exactly seven members and no others", () => {
    const statuses = ["UNPAID", "PENDING", "FAILED_OBSERVED", "PAID"];
    const legal: string[] = [];
    for (const from of statuses) {
      for (const to of statuses) {
        if (evaluateOrderPaymentStatusTransition(from, to) === "LEGAL") {
          legal.push(`${from}->${to}`);
        }
      }
    }
    expect(legal.sort()).toEqual([
      "FAILED_OBSERVED->PAID",
      "FAILED_OBSERVED->PENDING",
      "PAID->PAID",
      "PENDING->FAILED_OBSERVED",
      "PENDING->PAID",
      "UNPAID->PAID",
      "UNPAID->PENDING",
    ]);
    expect(legal).toHaveLength(7);
  });

  it("ARCHITECT REGRESSION — FULFILLED -> OPEN is always ILLEGAL; OPEN -> FULFILLED is CONDITIONAL, never a bare LEGAL", () => {
    // Old behaviour: OPEN -> FULFILLED was reported LEGAL from the two status
    // strings alone. docs/MONEY_INVARIANTS.md §12 lists it among the INVALID
    // transitions unless authoritative successful payment evidence AND a valid
    // fulfilment row exist, so the helper must not decide it by itself.
    expect(evaluateOrderBusinessStatusTransition("FULFILLED", "OPEN")).toBe(
      "ILLEGAL",
    );
    expect(evaluateOrderBusinessStatusTransition("OPEN", "FULFILLED")).toBe(
      "REQUIRES_FULFILMENT_AUTHORITY",
    );
    expect(evaluateOrderBusinessStatusTransition("OPEN", "OPEN")).toBe(
      "NO_TRANSITION",
    );
  });

  it("CAPTURED -> FAILED_OBSERVED is ILLEGAL; CAPTURED -> CAPTURED is NO_TRANSITION", () => {
    expect(
      evaluatePaymentAttemptStatusTransition("CAPTURED", "FAILED_OBSERVED"),
    ).toBe("ILLEGAL");
    expect(evaluatePaymentAttemptStatusTransition("CAPTURED", "CAPTURED")).toBe(
      "NO_TRANSITION",
    );
  });

  it("an unknown status is UNRECOGNISED, never ILLEGAL", () => {
    expect(evaluateOrderPaymentStatusTransition("MYSTERY", "PAID")).toBe(
      "UNRECOGNISED",
    );
    expect(evaluateOrderBusinessStatusTransition("OPEN", "MYSTERY")).toBe(
      "UNRECOGNISED",
    );
    expect(evaluatePaymentAttemptStatusTransition("MYSTERY", "CAPTURED")).toBe(
      "UNRECOGNISED",
    );
  });
});

// ============================================================================
// PROCESSING-STATUS SEMANTICS
// ============================================================================

describe("processing-status semantics — only SUCCEEDED is success", () => {
  it("SUCCEEDED is successful processing", () => {
    expect(isSuccessfulProcessing("SUCCEEDED")).toBe(true);
  });

  it.each(["PENDING", "HELD", "PROCESSING", "FAILED", "SKIPPED_DUPLICATE"])(
    "%s is NOT successful processing",
    (status) => {
      expect(isSuccessfulProcessing(status)).toBe(false);
    },
  );
});

// ============================================================================
// MONEY HELPER
// ============================================================================

describe("money comparison — integer subunits only", () => {
  it("50000 INR vs 50000 INR is a MATCH", () => {
    expect(
      compareMoney(
        { amountSubunits: 50000, currency: "INR" },
        { amountSubunits: 50000, currency: "INR" },
      ),
    ).toBe("MATCH");
  });

  it("50000 INR vs 49999 INR is a MISMATCH", () => {
    expect(
      compareMoney(
        { amountSubunits: 50000, currency: "INR" },
        { amountSubunits: 49999, currency: "INR" },
      ),
    ).toBe("MISMATCH");
  });

  it("50000 INR vs 50000 USD is a MISMATCH", () => {
    expect(
      compareMoney(
        { amountSubunits: 50000, currency: "INR" },
        { amountSubunits: 50000, currency: "USD" },
      ),
    ).toBe("MISMATCH");
  });

  it("a NULL amount or currency is INDETERMINATE — never 0, never INR", () => {
    expect(
      compareMoney(
        { amountSubunits: null, currency: "INR" },
        { amountSubunits: 0, currency: "INR" },
      ),
    ).toBe("INDETERMINATE");
    expect(
      compareMoney(
        { amountSubunits: 50000, currency: null },
        { amountSubunits: 50000, currency: "INR" },
      ),
    ).toBe("INDETERMINATE");
  });

  it("a non-integer amount is INDETERMINATE, never rounded", () => {
    expect(
      compareMoney(
        { amountSubunits: 500.5, currency: "INR" },
        { amountSubunits: 500, currency: "INR" },
      ),
    ).toBe("INDETERMINATE");
  });
});

// ============================================================================
// DISPATCHER
// ============================================================================

describe("the pure dispatcher", () => {
  it("registers exactly the twelve catalogued evaluators", () => {
    expect(Object.keys(INVARIANT_EVALUATORS).sort()).toEqual([
      ...MONEY_INVARIANT_IDS,
    ]);
  });

  it("evaluateAllInvariants returns all twelve envelopes in catalogue order", () => {
    const results = evaluateAllInvariants(bundle());
    expect(results).toHaveLength(12);
    expect(results.map((r) => r.invariantId)).toEqual([...MONEY_INVARIANT_IDS]);
  });

  it("every envelope carries the run's truthful correlations and version 1", () => {
    for (const result of evaluateAllInvariants(bundle())) {
      expect(result.invariantVersion).toBe("1");
      expect(result.correlations.chaosRunId).not.toBeNull();
      expect(result.correlations.orderId).toBe(ORDER_ID);
      expect(result.correlations.paymentAttemptId).toBe(ATTEMPT_ID);
      expect(result.correlations.paymentId).toBe(PAYMENT_ID);
    }
  });

  it("a C03 bundle keeps all three merchant correlations NULL — never fabricated", () => {
    const results = evaluateAllInvariants(
      bundle({
        scenarioId: "C03",
        orderId: null,
        paymentAttemptId: null,
        paymentId: null,
        sourceWebhook: null,
        originalProcessingAttempts: [],
        canonicalSourceEventCount: null,
        authoritativeCapture: { kind: "NO_SUBJECT" },
        authoritativeCaptureWebhook: null,
        scenarioEvidence: c03Scenario(),
      }),
    );
    for (const result of results) {
      expect(result.correlations.orderId).toBeNull();
      expect(result.correlations.paymentAttemptId).toBeNull();
      expect(result.correlations.paymentId).toBeNull();
      expect(result.correlations.chaosRunId).not.toBeNull();
    }
  });

  it("ERROR is returned only for an impossible internal contract, and is never persistable", () => {
    const unregistered = "INV-999" as never;
    const result = evaluateInvariant(unregistered, bundle());
    expect(result.disposition).toBe("ERROR");
    expect("severity" in result).toBe(false);
  });

  it("no envelope ever carries a diagnosis, recommendation, confidence or score field", () => {
    for (const result of evaluateAllInvariants(bundle())) {
      const serialized = JSON.stringify(result).toLowerCase();
      for (const forbidden of [
        "diagnosis",
        "recommendation",
        "confidence",
        "rootcause",
        "reliabilityscore",
      ]) {
        expect(serialized).not.toContain(forbidden);
      }
    }
  });
});

// ============================================================================
// CROSS-CUTTING CONTRACTS
// ============================================================================

describe("cross-cutting result contracts", () => {
  it("a C01 bundle still evaluates every invariant without touching the chaos registry", () => {
    const results = evaluateAllInvariants(
      bundle({ scenarioId: "C01", scenarioEvidence: c01Scenario() }),
    );
    expect(results).toHaveLength(12);
  });

  it("NOT_APPLICABLE envelopes are structurally non-persistable", () => {
    const na = evaluateAllInvariants(bundle()).filter(
      (r) => r.disposition === "NOT_APPLICABLE",
    );
    expect(na.length).toBeGreaterThan(0);
    for (const result of na) {
      expect("severity" in result).toBe(false);
      expect("expectedSummary" in result).toBe(false);
      expect("observedSummary" in result).toBe(false);
    }
  });

  it("PASS/FAIL/UNKNOWN envelopes always carry severity and both summaries", () => {
    for (const result of evaluateAllInvariants(bundle())) {
      if (
        result.disposition === "PASS" ||
        result.disposition === "FAIL" ||
        result.disposition === "UNKNOWN"
      ) {
        expect(result.severity).toBeTruthy();
        expect(result.expectedSummary.length).toBeGreaterThan(0);
        expect(result.observedSummary.length).toBeGreaterThan(0);
        expect(result.reason.length).toBeGreaterThan(0);
      }
    }
  });

  it("evidence refs are deduped, sorted and contain only internal UUIDs", () => {
    for (const result of evaluateAllInvariants(bundle())) {
      const keys = result.evidenceRefs.map((r) => `${r.kind}::${r.id}`);
      expect(new Set(keys).size).toBe(keys.length);
      for (const ref of result.evidenceRefs) {
        expect(ref.id).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
        );
        expect(Object.keys(ref).sort()).toEqual(["id", "kind"]);
      }
    }
  });

  it("ARCHITECT RE-AUDIT — a result references only evidence its rule actually used", () => {
    // INV-002 is NOT_APPLICABLE without a payment, so it must not attach the
    // run's order/attempt correlations it never consulted. The chaos run stays
    // — it is the record the evaluation is about.
    const result = evaluateInv002(bundle({ paymentId: null }));
    expect(result.disposition).toBe("NOT_APPLICABLE");
    expect(result.evidenceRefs.map((r) => r.kind)).toEqual(["CHAOS_RUN"]);
  });

  it("ARCHITECT RE-AUDIT — INV-005 references only the chaos run its evidence lives on", () => {
    const result = evaluateInv005(
      bundle({
        scenarioId: "C03",
        orderId: null,
        paymentAttemptId: null,
        paymentId: null,
        sourceWebhook: null,
        originalProcessingAttempts: [],
        canonicalSourceEventCount: null,
        authoritativeCapture: { kind: "NO_SUBJECT" },
        authoritativeCaptureWebhook: null,
        scenarioEvidence: c03Scenario({
          mutationEvidence: { before: c03Side(), after: c03Side() },
        }),
      }),
    );
    expect(result.disposition).toBe("PASS");
    expect(result.evidenceRefs.map((r) => r.kind)).toEqual(["CHAOS_RUN"]);
  });

  it("no summary or reason leaks a secret, signature or raw payload", () => {
    for (const result of evaluateAllInvariants(bundle())) {
      const text = JSON.stringify(result);
      for (const forbidden of [
        "RAZORPAY_KEY_SECRET",
        "RAZORPAY_WEBHOOK_SECRET",
        "SUPABASE_SERVICE_ROLE_KEY",
        "PAYCHAOS_ACCESS_TOKEN",
        "PAYCHAOS_SESSION_SECRET",
        "raw_body_sha256",
        "raw_payload_redacted",
        "normalized_event",
        "x-razorpay-signature",
      ]) {
        expect(text).not.toContain(forbidden);
      }
    }
  });
});
