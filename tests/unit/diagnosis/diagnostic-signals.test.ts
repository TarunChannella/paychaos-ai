import { describe, expect, it, vi } from "vitest";

// The signal module itself is pure and type-only. These tests additionally
// exercise the real snapshot builder/parser for the historical-compatibility
// cases, and those modules carry the standard `server-only` marker that every
// server module in this codebase needs stubbed under Vitest.
vi.mock("server-only", () => ({}));

import {
  DIAGNOSTIC_SIGNAL_CODES,
  DIAGNOSTIC_SIGNAL_VERSION,
  extractDiagnosticSignals,
} from "@/lib/diagnosis/diagnostic-signals";
import type {
  DiagnosticSignalCode,
  DiagnosticSignalSetV1,
  DiagnosticSignalState,
} from "@/lib/diagnosis/diagnostic-signals";
import type {
  DiagnosisEvidencePackV1,
  EvidencePackCaptureContext,
  EvidencePackProcessingAttempt,
  EvidencePackSourceProvenance,
} from "@/lib/diagnosis/evidence-pack";
import { parseMerchantStateSnapshotV1 } from "@/lib/evidence/chaos-run-evidence";
import {
  buildMerchantStateSnapshot,
  serializeMerchantStateSnapshot,
} from "@/lib/evidence/merchant-state-snapshot";
import type {
  MerchantStateSnapshotFulfilmentV1,
  MerchantStateSnapshotOrderV1,
  MerchantStateSnapshotPaymentAttemptV1,
  MerchantStateSnapshotPaymentV1,
  MerchantStateSnapshotV1,
} from "@/lib/evidence/merchant-state-snapshot";

/**
 * Phase 4B-R1 — deterministic diagnostic signal extraction.
 *
 * Every fixture is an in-memory Evidence Pack. There is no database, no
 * network and no Supabase client: the unit under test is a pure function.
 *
 * The architect-correction blocks at the end (A–G) are regression coverage
 * for signal semantics that previously claimed more than the evidence
 * supported.
 */

const FINDING_ID = "55555555-5555-4555-8555-555555555555";
const RESULT_ID = "33333333-3333-4333-8333-333333333333";
const RUN_ID = "11111111-1111-4111-8111-111111111111";
const ORDER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ATTEMPT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PAYMENT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PROC_A = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const PROC_B = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const FULFIL_A = "f1111111-1111-4111-8111-111111111111";
const FULFIL_B = "f2222222-2222-4222-8222-222222222222";
const WEBHOOK_ID = "f3333333-3333-4333-8333-333333333333";
// A different subject, used to prove no fallback identity is ever selected.
const OTHER_ORDER_ID = "a9999999-9999-4999-8999-999999999999";
const OTHER_PAYMENT_ID = "c9999999-9999-4999-8999-999999999999";

// ---------------------------------------------------------------- fixtures

function order(
  overrides?: Partial<MerchantStateSnapshotOrderV1>,
): MerchantStateSnapshotOrderV1 {
  return {
    id: ORDER_ID,
    paymentStatus: "PAID",
    businessStatus: "FULFILLED",
    amountSubunits: 50000,
    currency: "INR",
    ...overrides,
  };
}

function paymentAttempt(
  overrides?: Partial<MerchantStateSnapshotPaymentAttemptV1>,
): MerchantStateSnapshotPaymentAttemptV1 {
  return {
    id: ATTEMPT_ID,
    orderId: ORDER_ID,
    status: "CAPTURED",
    amountSubunits: 50000,
    currency: "INR",
    razorpayOrderId: "order_test_0001",
    razorpayOrderStatus: "paid",
    ...overrides,
  };
}

function payment(
  overrides?: Partial<MerchantStateSnapshotPaymentV1>,
): MerchantStateSnapshotPaymentV1 {
  return {
    id: PAYMENT_ID,
    paymentAttemptId: ATTEMPT_ID,
    razorpayPaymentId: "pay_test_0001",
    razorpayPaymentStatus: "captured",
    amountSubunits: 50000,
    currency: "INR",
    checkoutSignatureVerified: true,
    capturedAt: "2026-08-01T10:00:02.000Z",
    failedAt: null,
    ...overrides,
  };
}

function fulfilment(
  id: string,
  overrides?: Partial<MerchantStateSnapshotFulfilmentV1>,
): MerchantStateSnapshotFulfilmentV1 {
  return {
    id,
    orderId: ORDER_ID,
    paymentId: PAYMENT_ID,
    triggerProcessingAttemptId: PROC_A,
    effectType: "FULFIL_ORDER",
    appliedAt: "2026-08-01T10:00:02.000Z",
    idempotencyKey: `FULFIL_ORDER:${ORDER_ID}`,
    ...overrides,
  };
}

/** A fully populated, relationally consistent snapshot. */
function snapshot(
  overrides?: Partial<MerchantStateSnapshotV1>,
): MerchantStateSnapshotV1 {
  return {
    version: 1,
    order: order(),
    paymentAttempt: paymentAttempt(),
    payment: payment(),
    fulfilments: [],
    ...overrides,
  };
}

/** Order only — deliberately NOT a complete correlated money path. */
function orderOnlySnapshot(
  overrides?: Partial<MerchantStateSnapshotV1>,
): MerchantStateSnapshotV1 {
  return {
    version: 1,
    order: order(),
    paymentAttempt: null,
    payment: null,
    fulfilments: [],
    ...overrides,
  };
}

function attempt(
  overrides: Partial<EvidencePackProcessingAttempt> & {
    readonly attemptId: string;
  },
): EvidencePackProcessingAttempt {
  return {
    role: "CHAOS",
    sourceKind: "PAYCHAOS_REPLAY",
    status: "SUCCEEDED",
    isDuplicateDelivery: false,
    errorCode: null,
    startedAt: "2026-08-01T10:00:01.000Z",
    finishedAt: "2026-08-01T10:00:02.000Z",
    stateBefore: { kind: "NOT_CAPTURED" },
    stateAfter: { kind: "NOT_CAPTURED" },
    ...overrides,
  };
}

function pack(
  overrides?: Partial<DiagnosisEvidencePackV1>,
): DiagnosisEvidencePackV1 {
  return {
    version: 1,
    finding: {
      findingId: FINDING_ID,
      invariantResultId: RESULT_ID,
      status: "OPEN",
      title: "INV-002 — One Captured Payment, At Most One Fulfilment",
      createdAt: "2026-08-01T11:00:00.000Z",
    },
    invariant: {
      invariantId: "INV-002",
      invariantVersion: "1",
      result: "FAIL",
      severity: "CRITICAL",
      expectedSummary: "fulfilment count <= 1",
      observedSummary: "fulfilment count = 2",
      reason: "Deterministic evaluator prose.",
      evaluatedAt: "2026-08-01T10:30:00.000Z",
    },
    correlations: {
      chaosRunId: RUN_ID,
      orderId: ORDER_ID,
      paymentAttemptId: ATTEMPT_ID,
      paymentId: PAYMENT_ID,
    },
    evidenceRefs: [{ kind: "CHAOS_RUN", id: RUN_ID }],
    scenario: {
      scenarioId: "C01",
      faultType: "REPLAY_EVENT",
      dataClassification: "RECORDED_TEST_EVIDENCE",
      status: "COMPLETED",
      outcome: "FAIL",
      startedAt: "2026-08-01T10:00:00.000Z",
      completedAt: "2026-08-01T10:05:00.000Z",
    },
    provenance: null,
    processing: [],
    counts: {
      canonicalSourceEventCount: 1,
      originalAttemptCount: 1,
      chaosAttemptCount: 0,
    },
    money: null,
    capture: null,
    scenarioEvidence: {
      scenarioId: "C01",
      expectedReplayAttemptCount: 2,
      observedReplayAttemptCount: 2,
      chaosLinkedProcessingAttemptCount: 2,
      originalProcessingAttemptCount: 1,
      authoritativeOriginalProcessingAttemptId: PROC_A,
    },
    gaps: [],
    ...overrides,
  };
}

function stateOf(
  set: DiagnosticSignalSetV1,
  code: DiagnosticSignalCode,
): DiagnosticSignalState {
  const found = set.signals.find((signal) => signal.code === code);
  if (!found) throw new Error(`missing signal ${code}`);
  return found.state;
}

const verifiedCaptureWebhook: EvidencePackSourceProvenance = {
  webhookEventId: WEBHOOK_ID,
  sourceKind: "REAL_RAZORPAY_WEBHOOK",
  signatureVerified: true,
  eventType: "payment.captured",
  razorpayEventId: "evt_test_0001",
  receivedAt: "2026-08-01T10:00:00.000Z",
  duplicateDeliveryCount: 0,
};

const verifiedFailureWebhook: EvidencePackSourceProvenance = {
  ...verifiedCaptureWebhook,
  eventType: "payment.failed",
};

function capture(
  resolution: EvidencePackCaptureContext["resolution"],
  withWebhook = true,
): EvidencePackCaptureContext {
  return {
    resolution,
    webhook:
      withWebhook &&
      (resolution === "EXACTLY_ONE" ||
        resolution === "INCOMPLETE_INTERNAL_CORRELATION")
        ? verifiedCaptureWebhook
        : null,
    candidateCount: resolution === "AMBIGUOUS" ? 2 : null,
  };
}

/** One attempt whose after-state carries the given snapshot. */
function afterState(
  snap: MerchantStateSnapshotV1,
  attemptId = PROC_A,
): EvidencePackProcessingAttempt {
  return attempt({
    attemptId,
    stateAfter: { kind: "CAPTURED", snapshot: snap },
  });
}

// ============================================================================

describe("Phase 4B-R1 — diagnostic signal extraction", () => {
  it("1: the same pack always produces a deep-equal signal set", () => {
    const input = pack();
    expect(extractDiagnosticSignals(input)).toEqual(
      extractDiagnosticSignals(input),
    );
    expect(extractDiagnosticSignals(pack())).toEqual(
      extractDiagnosticSignals(pack()),
    );
  });

  it("2: signals are emitted in the frozen vocabulary order", () => {
    const set = extractDiagnosticSignals(pack());
    expect(set.signals.map((signal) => signal.code)).toEqual([
      ...DIAGNOSTIC_SIGNAL_CODES,
    ]);
    expect(set.version).toBe(DIAGNOSTIC_SIGNAL_VERSION);
    expect(set.findingId).toBe(FINDING_ID);
    expect(set.invariantResultId).toBe(RESULT_ID);
  });

  it("3: the caller's pack is never mutated", () => {
    const input = pack({
      processing: [attempt({ attemptId: PROC_A })],
      gaps: [{ code: "MONEY_CONTEXT_UNAVAILABLE", subjectId: RUN_ID }],
    });
    const before = JSON.stringify(input);
    const processingRef = input.processing;
    const gapsRef = input.gaps;

    extractDiagnosticSignals(input);

    expect(JSON.stringify(input)).toBe(before);
    expect(input.processing).toBe(processingRef);
    expect(input.gaps).toBe(gapsRef);
  });

  it("4: missing evidence becomes UNKNOWN, never a fabricated ABSENT", () => {
    const set = extractDiagnosticSignals(
      pack({
        counts: null,
        processing: [],
        provenance: null,
        capture: null,
        money: null,
        scenarioEvidence: null,
        scenario: null,
        gaps: [{ code: "CHAOS_EVIDENCE_UNAVAILABLE", subjectId: RUN_ID }],
      }),
    );
    for (const signal of set.signals) {
      expect(signal.state, signal.code).toBe("UNKNOWN");
    }
  });

  it("5: an unrelated gap does not poison an independent signal", () => {
    const set = extractDiagnosticSignals(
      pack({
        scenarioEvidence: {
          scenarioId: "C07",
          faultArmed: true,
          faultConsumed: true,
          expectedReplayAttemptCount: 0,
          observedReplayAttemptCount: 0,
          chaosLinkedProcessingAttemptCount: 0,
          originalProcessingAttemptCount: 1,
          authoritativeOriginalProcessingAttemptId: PROC_A,
        },
        money: null,
        gaps: [{ code: "MONEY_CONTEXT_UNAVAILABLE", subjectId: RUN_ID }],
      }),
    );

    expect(stateOf(set, "CLIENT_CONFIRMATION_MISSING")).toBe("PRESENT");
    expect(stateOf(set, "AMOUNT_MISMATCH")).toBe("UNKNOWN");
    expect(
      set.signals.find((s) => s.code === "AMOUNT_MISMATCH")?.blockingGapCodes,
    ).toContain("MONEY_CONTEXT_UNAVAILABLE");
    expect(
      set.signals.find((s) => s.code === "CLIENT_CONFIRMATION_MISSING")
        ?.blockingGapCodes,
    ).toEqual([]);
  });

  it("6: deceptive evaluator prose cannot create a signal", () => {
    const set = extractDiagnosticSignals(
      pack({
        finding: {
          findingId: FINDING_ID,
          invariantResultId: RESULT_ID,
          status: "OPEN",
          title: "two fulfilments with different idempotency keys",
          createdAt: "2026-08-01T11:00:00.000Z",
        },
        invariant: {
          invariantId: "INV-002",
          invariantVersion: "1",
          result: "FAIL",
          severity: "CRITICAL",
          expectedSummary: "duplicate fulfilments detected",
          observedSummary: "two fulfilments with different keys",
          reason: "DUPLICATE_FULFILMENTS PRESENT",
          evaluatedAt: "2026-08-01T10:30:00.000Z",
        },
        processing: [],
        counts: null,
      }),
    );
    expect(stateOf(set, "DUPLICATE_FULFILMENTS")).toBe("UNKNOWN");
    expect(stateOf(set, "DIFFERENT_FULFILMENT_IDEMPOTENCY_KEYS")).toBe(
      "UNKNOWN",
    );
    expect(stateOf(set, "SAME_LOGICAL_PAYMENT")).toBe("UNKNOWN");
  });

  // ---------------------------------------------------------------- C01

  it("7: more than one processing attempt proves DUPLICATE_EVENT_ATTEMPTS", () => {
    const set = extractDiagnosticSignals(
      pack({
        counts: {
          canonicalSourceEventCount: 1,
          originalAttemptCount: 1,
          chaosAttemptCount: 2,
        },
      }),
    );
    expect(stateOf(set, "DUPLICATE_EVENT_ATTEMPTS")).toBe("PRESENT");
  });

  it("8: exactly one complete attempt proves DUPLICATE_EVENT_ATTEMPTS ABSENT", () => {
    expect(
      stateOf(extractDiagnosticSignals(pack()), "DUPLICATE_EVENT_ATTEMPTS"),
    ).toBe("ABSENT");
  });

  it("9: absent attempt counts make DUPLICATE_EVENT_ATTEMPTS UNKNOWN", () => {
    expect(
      stateOf(
        extractDiagnosticSignals(pack({ counts: null })),
        "DUPLICATE_EVENT_ATTEMPTS",
      ),
    ).toBe("UNKNOWN");
  });

  it("10: two fulfilments in one complete snapshot prove DUPLICATE_FULFILMENTS", () => {
    const set = extractDiagnosticSignals(
      pack({
        processing: [
          afterState(
            snapshot({
              fulfilments: [fulfilment(FULFIL_A), fulfilment(FULFIL_B)],
            }),
          ),
        ],
      }),
    );
    expect(stateOf(set, "DUPLICATE_FULFILMENTS")).toBe("PRESENT");
  });

  it("11: one fulfilment in a complete snapshot proves DUPLICATE_FULFILMENTS ABSENT", () => {
    const set = extractDiagnosticSignals(
      pack({
        processing: [
          afterState(snapshot({ fulfilments: [fulfilment(FULFIL_A)] })),
        ],
      }),
    );
    expect(stateOf(set, "DUPLICATE_FULFILMENTS")).toBe("ABSENT");
  });

  it("12: an uncaptured fulfilment collection makes DUPLICATE_FULFILMENTS UNKNOWN", () => {
    const set = extractDiagnosticSignals(
      pack({
        processing: [afterState(snapshot({ order: null, fulfilments: null }))],
      }),
    );
    expect(stateOf(set, "DUPLICATE_FULFILMENTS")).toBe("UNKNOWN");
  });

  it("12b: the same fulfilment seen in before and after is one effect, not two", () => {
    const rows = [fulfilment(FULFIL_A)];
    const set = extractDiagnosticSignals(
      pack({
        processing: [
          attempt({
            attemptId: PROC_A,
            stateBefore: {
              kind: "CAPTURED",
              snapshot: snapshot({ fulfilments: rows }),
            },
            stateAfter: {
              kind: "CAPTURED",
              snapshot: snapshot({ fulfilments: rows }),
            },
          }),
        ],
      }),
    );
    expect(stateOf(set, "DUPLICATE_FULFILMENTS")).toBe("ABSENT");
  });

  it("13: two different real idempotency keys prove the key signal PRESENT", () => {
    const set = extractDiagnosticSignals(
      pack({
        processing: [
          afterState(
            snapshot({
              fulfilments: [
                fulfilment(FULFIL_A, {
                  idempotencyKey: `FULFIL_ORDER:${PROC_A}`,
                }),
                fulfilment(FULFIL_B, {
                  idempotencyKey: `FULFIL_ORDER:${PROC_B}`,
                }),
              ],
            }),
          ),
        ],
      }),
    );
    expect(stateOf(set, "DIFFERENT_FULFILMENT_IDEMPOTENCY_KEYS")).toBe(
      "PRESENT",
    );
  });

  it("14: identical keys on established duplicates prove the key signal ABSENT", () => {
    const key = `FULFIL_ORDER:${ORDER_ID}`;
    const set = extractDiagnosticSignals(
      pack({
        processing: [
          afterState(
            snapshot({
              fulfilments: [
                fulfilment(FULFIL_A, { idempotencyKey: key }),
                fulfilment(FULFIL_B, { idempotencyKey: key }),
              ],
            }),
          ),
        ],
      }),
    );
    expect(stateOf(set, "DUPLICATE_FULFILMENTS")).toBe("PRESENT");
    expect(stateOf(set, "DIFFERENT_FULFILMENT_IDEMPOTENCY_KEYS")).toBe(
      "ABSENT",
    );
  });

  it("15: a historically unavailable key makes the key signal UNKNOWN, never false", () => {
    const set = extractDiagnosticSignals(
      pack({
        processing: [
          afterState(
            snapshot({
              fulfilments: [
                fulfilment(FULFIL_A, { idempotencyKey: null }),
                fulfilment(FULFIL_B, { idempotencyKey: null }),
              ],
            }),
          ),
        ],
      }),
    );
    expect(stateOf(set, "DUPLICATE_FULFILMENTS")).toBe("PRESENT");
    expect(stateOf(set, "DIFFERENT_FULFILMENT_IDEMPOTENCY_KEYS")).toBe(
      "UNKNOWN",
    );
  });

  it("16: duplicates on one order and payment prove SAME_LOGICAL_PAYMENT", () => {
    const set = extractDiagnosticSignals(
      pack({
        processing: [
          afterState(
            snapshot({
              fulfilments: [fulfilment(FULFIL_A), fulfilment(FULFIL_B)],
            }),
          ),
        ],
      }),
    );
    expect(stateOf(set, "SAME_LOGICAL_PAYMENT")).toBe("PRESENT");
  });

  // ---------------------------------------------------------------- C03

  type C03Check = {
    case: "WRONG_SIGNATURE" | "MISSING_SIGNATURE";
    classification: "REJECTED" | "UNEXPECTED_ACCEPTANCE";
  };

  function c03Pack(
    checks: readonly C03Check[] | null,
    mutated: boolean,
    facts: "COMPLETE" | "ABSENT" = "COMPLETE",
    eventIds: { before: string[]; after: string[] } = {
      before: ["e1"],
      after: ["e1"],
    },
  ): DiagnosisEvidencePackV1 {
    const beforeOrders = {
      count: 1,
      rows: [order({ paymentStatus: "UNPAID", businessStatus: "OPEN" })],
      complete: true,
    };
    const afterOrders = mutated
      ? { count: 1, rows: [order()], complete: true }
      : beforeOrders;

    return pack({
      correlations: {
        chaosRunId: RUN_ID,
        orderId: null,
        paymentAttemptId: null,
        paymentId: null,
      },
      scenario: {
        scenarioId: "C03",
        faultType: "INVALID_SIGNATURE_TEST",
        dataClassification: "SYNTHETIC_DEMO",
        status: "COMPLETED",
        outcome: "FAIL",
        startedAt: null,
        completedAt: null,
      },
      scenarioEvidence: {
        scenarioId: "C03",
        verificationChecks: checks,
        sourceWebhookLinked: false,
        orderLinked: false,
        paymentAttemptLinked: false,
        paymentLinked: false,
        chaosLinkedProcessingAttemptCount: 0,
        merchantFacts:
          facts === "ABSENT"
            ? null
            : {
                before: {
                  orders: beforeOrders,
                  paymentAttempts: null,
                  payments: null,
                  fulfilments: { count: 0, rows: [], complete: true },
                  trustedWebhookEvents: {
                    count: eventIds.before.length,
                    ids: eventIds.before,
                    complete: true,
                  },
                },
                after: {
                  orders: afterOrders,
                  paymentAttempts: null,
                  payments: null,
                  fulfilments: { count: 0, rows: [], complete: true },
                  trustedWebhookEvents: {
                    count: eventIds.after.length,
                    ids: eventIds.after,
                    complete: true,
                  },
                },
              },
      },
      counts: null,
    });
  }

  it("17: accepted invalid signature plus proven mutation is PRESENT", () => {
    const set = extractDiagnosticSignals(
      c03Pack(
        [
          { case: "WRONG_SIGNATURE", classification: "UNEXPECTED_ACCEPTANCE" },
          { case: "MISSING_SIGNATURE", classification: "REJECTED" },
        ],
        true,
      ),
    );
    expect(stateOf(set, "INVALID_SIGNATURE_MUTATED_STATE")).toBe("PRESENT");
  });

  it("18: rejection plus proven zero mutation is ABSENT", () => {
    const set = extractDiagnosticSignals(
      c03Pack(
        [
          { case: "WRONG_SIGNATURE", classification: "REJECTED" },
          { case: "MISSING_SIGNATURE", classification: "REJECTED" },
        ],
        false,
      ),
    );
    expect(stateOf(set, "INVALID_SIGNATURE_MUTATED_STATE")).toBe("ABSENT");
  });

  it("19: absent evidence is UNKNOWN, and an INV-005 FAIL alone proves nothing", () => {
    expect(
      stateOf(
        extractDiagnosticSignals(c03Pack(null, false)),
        "INVALID_SIGNATURE_MUTATED_STATE",
      ),
    ).toBe("UNKNOWN");
    expect(
      stateOf(
        extractDiagnosticSignals(
          c03Pack(
            [
              {
                case: "WRONG_SIGNATURE",
                classification: "UNEXPECTED_ACCEPTANCE",
              },
            ],
            false,
            "ABSENT",
          ),
        ),
        "INVALID_SIGNATURE_MUTATED_STATE",
      ),
    ).toBe("UNKNOWN");

    const failingButUnevidenced = extractDiagnosticSignals(
      pack({
        invariant: {
          invariantId: "INV-005",
          invariantVersion: "1",
          result: "FAIL",
          severity: "CRITICAL",
          expectedSummary: "zero trusted mutation",
          observedSummary: "an invalid signature was accepted",
          reason: "UNEXPECTED_ACCEPTANCE",
          evaluatedAt: "2026-08-01T10:30:00.000Z",
        },
        scenarioEvidence: null,
      }),
    );
    expect(
      stateOf(failingButUnevidenced, "INVALID_SIGNATURE_MUTATED_STATE"),
    ).toBe("UNKNOWN");
  });

  it("19b: a trusted-event identity swap at equal count still counts as mutation", () => {
    const set = extractDiagnosticSignals(
      c03Pack(
        [{ case: "WRONG_SIGNATURE", classification: "UNEXPECTED_ACCEPTANCE" }],
        false,
        "COMPLETE",
        { before: ["e1"], after: ["e2"] },
      ),
    );
    expect(stateOf(set, "INVALID_SIGNATURE_MUTATED_STATE")).toBe("PRESENT");
  });

  // ---------------------------------------------------------------- C07

  it("20: an armed and consumed client-drop fault is PRESENT", () => {
    const set = extractDiagnosticSignals(
      pack({
        scenarioEvidence: {
          scenarioId: "C07",
          faultArmed: true,
          faultConsumed: true,
          expectedReplayAttemptCount: 0,
          observedReplayAttemptCount: 0,
          chaosLinkedProcessingAttemptCount: 0,
          originalProcessingAttemptCount: 1,
          authoritativeOriginalProcessingAttemptId: PROC_A,
        },
      }),
    );
    expect(stateOf(set, "CLIENT_CONFIRMATION_MISSING")).toBe("PRESENT");
  });

  it("20b: an unconsumed fault is ABSENT and an unavailable one is UNKNOWN", () => {
    const base = {
      scenarioId: "C07" as const,
      expectedReplayAttemptCount: 0,
      observedReplayAttemptCount: 0,
      chaosLinkedProcessingAttemptCount: 0,
      originalProcessingAttemptCount: 1,
      authoritativeOriginalProcessingAttemptId: null,
    };
    expect(
      stateOf(
        extractDiagnosticSignals(
          pack({
            scenarioEvidence: {
              ...base,
              faultArmed: true,
              faultConsumed: false,
            },
          }),
        ),
        "CLIENT_CONFIRMATION_MISSING",
      ),
    ).toBe("ABSENT");
    expect(
      stateOf(
        extractDiagnosticSignals(
          pack({
            scenarioEvidence: {
              ...base,
              faultArmed: null,
              faultConsumed: null,
            },
          }),
        ),
        "CLIENT_CONFIRMATION_MISSING",
      ),
    ).toBe("UNKNOWN");
  });

  it("21: a verified real payment.captured webhook proves PAYMENT_CAPTURED_VIA_WEBHOOK", () => {
    expect(
      stateOf(
        extractDiagnosticSignals(pack({ provenance: verifiedCaptureWebhook })),
        "PAYMENT_CAPTURED_VIA_WEBHOOK",
      ),
    ).toBe("PRESENT");
  });

  it("21b: a PAYCHAOS_REPLAY attempt never satisfies PAYMENT_CAPTURED_VIA_WEBHOOK", () => {
    const set = extractDiagnosticSignals(
      pack({
        provenance: null,
        capture: null,
        processing: [
          attempt({ attemptId: PROC_A, sourceKind: "PAYCHAOS_REPLAY" }),
          attempt({ attemptId: PROC_B, sourceKind: "PAYCHAOS_REPLAY" }),
        ],
      }),
    );
    expect(stateOf(set, "PAYMENT_CAPTURED_VIA_WEBHOOK")).toBe("UNKNOWN");
  });

  it("22: authoritative capture with a non-PAID order proves CAPTURE_EXISTS_ORDER_NOT_PAID", () => {
    const set = extractDiagnosticSignals(
      pack({
        capture: capture("EXACTLY_ONE"),
        processing: [
          afterState(
            snapshot({
              order: order({
                paymentStatus: "PENDING",
                businessStatus: "OPEN",
              }),
            }),
          ),
        ],
      }),
    );
    expect(stateOf(set, "CAPTURE_EXISTS_ORDER_NOT_PAID")).toBe("PRESENT");
  });

  it("23: authoritative capture with a PAID order proves the signal ABSENT", () => {
    const set = extractDiagnosticSignals(
      pack({
        capture: capture("EXACTLY_ONE"),
        processing: [afterState(snapshot())],
      }),
    );
    expect(stateOf(set, "CAPTURE_EXISTS_ORDER_NOT_PAID")).toBe("ABSENT");
  });

  it("24: a missing order snapshot is UNKNOWN, never treated as unpaid", () => {
    const set = extractDiagnosticSignals(
      pack({
        capture: capture("EXACTLY_ONE"),
        processing: [attempt({ attemptId: PROC_A })],
      }),
    );
    expect(stateOf(set, "CAPTURE_EXISTS_ORDER_NOT_PAID")).toBe("UNKNOWN");
  });

  // ------------------------------------------------------ regression / replay

  it("28: a PAID order regressing to a weaker state proves OUT_OF_ORDER_STATE_REGRESSION", () => {
    const set = extractDiagnosticSignals(
      pack({
        processing: [
          attempt({
            attemptId: PROC_A,
            stateBefore: { kind: "CAPTURED", snapshot: snapshot() },
            stateAfter: {
              kind: "CAPTURED",
              snapshot: snapshot({
                order: order({
                  paymentStatus: "FAILED_OBSERVED",
                  businessStatus: "OPEN",
                }),
              }),
            },
          }),
        ],
      }),
    );
    expect(stateOf(set, "OUT_OF_ORDER_STATE_REGRESSION")).toBe("PRESENT");
  });

  it("28b: a legal unchanged transition proves the regression signal ABSENT", () => {
    const set = extractDiagnosticSignals(
      pack({
        processing: [
          attempt({
            attemptId: PROC_A,
            stateBefore: { kind: "CAPTURED", snapshot: snapshot() },
            stateAfter: { kind: "CAPTURED", snapshot: snapshot() },
          }),
        ],
      }),
    );
    expect(stateOf(set, "OUT_OF_ORDER_STATE_REGRESSION")).toBe("ABSENT");
  });

  it("31: incomplete replay snapshots make REPLAY_CHANGED_FINAL_STATE UNKNOWN", () => {
    const set = extractDiagnosticSignals(
      pack({
        processing: [
          attempt({
            attemptId: PROC_A,
            sourceKind: "PAYCHAOS_REPLAY",
            stateBefore: { kind: "NOT_CAPTURED" },
            stateAfter: { kind: "INVALID" },
          }),
        ],
      }),
    );
    expect(stateOf(set, "REPLAY_CHANGED_FINAL_STATE")).toBe("UNKNOWN");
  });

  it("38: no signal ever carries a root cause, strength or recommendation", () => {
    const serialized = JSON.stringify(extractDiagnosticSignals(pack()));
    for (const forbidden of [
      "RC-0",
      "STRONG_EVIDENCE",
      "PARTIAL_EVIDENCE",
      "INSUFFICIENT_EVIDENCE",
      "recommendation",
      "diagnosis",
      "reliabilityScore",
      "readiness",
      "confidence",
      "probability",
    ]) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
  });
});

// ============================================================================
// BLOCKER A — authoritative capture resolution
// ============================================================================

describe("Phase 4B-R1 correction A — authoritative capture", () => {
  it("A1: INCOMPLETE_INTERNAL_CORRELATION cannot satisfy merchant capture authority", () => {
    const set = extractDiagnosticSignals(
      pack({
        capture: capture("INCOMPLETE_INTERNAL_CORRELATION"),
        processing: [
          afterState(
            snapshot({
              order: order({
                paymentStatus: "PENDING",
                businessStatus: "OPEN",
              }),
            }),
          ),
        ],
      }),
    );
    // Previously this produced PRESENT by treating the incomplete correlation
    // as authoritative merchant capture.
    expect(stateOf(set, "CAPTURE_EXISTS_ORDER_NOT_PAID")).toBe("UNKNOWN");
  });

  it("A2: EXACTLY_ONE verified capture does satisfy merchant capture authority", () => {
    const set = extractDiagnosticSignals(
      pack({
        capture: capture("EXACTLY_ONE"),
        processing: [
          afterState(
            snapshot({
              order: order({
                paymentStatus: "PENDING",
                businessStatus: "OPEN",
              }),
            }),
          ),
        ],
      }),
    );
    expect(stateOf(set, "CAPTURE_EXISTS_ORDER_NOT_PAID")).toBe("PRESENT");
  });

  it("A3: provider-webhook fact and merchant authority stay distinguishable", () => {
    const set = extractDiagnosticSignals(
      pack({
        capture: capture("INCOMPLETE_INTERNAL_CORRELATION"),
        processing: [
          afterState(
            snapshot({
              order: order({
                paymentStatus: "PENDING",
                businessStatus: "OPEN",
              }),
            }),
          ),
        ],
      }),
    );
    // The provider event demonstrably exists...
    expect(stateOf(set, "PAYMENT_CAPTURED_VIA_WEBHOOK")).toBe("PRESENT");
    // ...but it cannot be tied to this merchant subject.
    expect(stateOf(set, "CAPTURE_EXISTS_ORDER_NOT_PAID")).toBe("UNKNOWN");
  });

  it("A4: an incomplete or ambiguous search is never a capture negative", () => {
    for (const resolution of [
      "SEARCH_INCOMPLETE",
      "AMBIGUOUS_SUBJECT",
      "NO_SUBJECT",
      "AMBIGUOUS",
    ] as const) {
      const set = extractDiagnosticSignals(
        pack({ capture: capture(resolution), provenance: null }),
      );
      expect(stateOf(set, "PAYMENT_CAPTURED_VIA_WEBHOOK"), resolution).toBe(
        "UNKNOWN",
      );
    }
    // Only a complete negative may say the capture is absent.
    expect(
      stateOf(
        extractDiagnosticSignals(
          pack({ capture: capture("NONE_OBSERVED"), provenance: null }),
        ),
        "PAYMENT_CAPTURED_VIA_WEBHOOK",
      ),
    ).toBe("ABSENT");
  });
});

// ============================================================================
// BLOCKER B — FAILURE_EVENT_MARKED_PAID
// ============================================================================

describe("Phase 4B-R1 correction B — failure event marked paid", () => {
  function failurePack(
    captureContext: EvidencePackCaptureContext | null,
    orderStatus = "PAID",
  ): DiagnosisEvidencePackV1 {
    return pack({
      provenance: verifiedFailureWebhook,
      capture: captureContext,
      processing: [
        afterState(
          snapshot({
            order: order({
              paymentStatus: orderStatus,
              businessStatus: orderStatus === "PAID" ? "FULFILLED" : "OPEN",
            }),
          }),
        ),
      ],
    });
  }

  it("B1: failure + PAID + NONE_OBSERVED is PRESENT", () => {
    expect(
      stateOf(
        extractDiagnosticSignals(failurePack(capture("NONE_OBSERVED"))),
        "FAILURE_EVENT_MARKED_PAID",
      ),
    ).toBe("PRESENT");
  });

  it("B2: failure + PAID + EXACTLY_ONE verified capture is ABSENT", () => {
    expect(
      stateOf(
        extractDiagnosticSignals(failurePack(capture("EXACTLY_ONE"))),
        "FAILURE_EVENT_MARKED_PAID",
      ),
    ).toBe("ABSENT");
  });

  it("B3-B6: an incomplete or ambiguous capture search is UNKNOWN, never a negative", () => {
    for (const resolution of [
      "SEARCH_INCOMPLETE",
      "AMBIGUOUS_SUBJECT",
      "NO_SUBJECT",
      "INCOMPLETE_INTERNAL_CORRELATION",
    ] as const) {
      expect(
        stateOf(
          extractDiagnosticSignals(failurePack(capture(resolution))),
          "FAILURE_EVENT_MARKED_PAID",
        ),
        resolution,
      ).toBe("UNKNOWN");
    }
  });

  it("B7: failure + PAID + null capture is UNKNOWN", () => {
    expect(
      stateOf(
        extractDiagnosticSignals(failurePack(null)),
        "FAILURE_EVENT_MARKED_PAID",
      ),
    ).toBe("UNKNOWN");
  });

  it("B8: a non-PAID order is ABSENT regardless of capture state", () => {
    expect(
      stateOf(
        extractDiagnosticSignals(failurePack(null, "FAILED_OBSERVED")),
        "FAILURE_EVENT_MARKED_PAID",
      ),
    ).toBe("ABSENT");
  });

  it("B9: without verified provider failure evidence the signal is UNKNOWN", () => {
    expect(
      stateOf(
        extractDiagnosticSignals(
          pack({ provenance: null, processing: [afterState(snapshot())] }),
        ),
        "FAILURE_EVENT_MARKED_PAID",
      ),
    ).toBe("UNKNOWN");
  });
});

// ============================================================================
// BLOCKER C — final merchant-state resolution
// ============================================================================

describe("Phase 4B-R1 correction C — final merchant state", () => {
  it("C-A: stateBefore can never masquerade as the final state", () => {
    const set = extractDiagnosticSignals(
      pack({
        capture: capture("EXACTLY_ONE"),
        processing: [
          attempt({
            attemptId: PROC_A,
            // PAID before...
            stateBefore: { kind: "CAPTURED", snapshot: snapshot() },
            // ...PENDING after. The consumer must use PENDING.
            stateAfter: {
              kind: "CAPTURED",
              snapshot: snapshot({
                order: order({
                  paymentStatus: "PENDING",
                  businessStatus: "OPEN",
                }),
              }),
            },
          }),
        ],
      }),
    );
    expect(stateOf(set, "CAPTURE_EXISTS_ORDER_NOT_PAID")).toBe("PRESENT");
  });

  it("C-B: two conflicting after-states resolve to UNKNOWN", () => {
    const set = extractDiagnosticSignals(
      pack({
        capture: capture("EXACTLY_ONE"),
        processing: [
          afterState(snapshot(), PROC_A),
          afterState(
            snapshot({
              order: order({
                paymentStatus: "PENDING",
                businessStatus: "OPEN",
              }),
            }),
            PROC_B,
          ),
        ],
      }),
    );
    expect(stateOf(set, "CAPTURE_EXISTS_ORDER_NOT_PAID")).toBe("UNKNOWN");
  });

  it("C-C: two consistent after-states resolve deterministically", () => {
    const set = extractDiagnosticSignals(
      pack({
        capture: capture("EXACTLY_ONE"),
        processing: [
          afterState(snapshot(), PROC_A),
          afterState(snapshot(), PROC_B),
        ],
      }),
    );
    expect(stateOf(set, "CAPTURE_EXISTS_ORDER_NOT_PAID")).toBe("ABSENT");
  });

  it("C-D: no usable after order state is UNKNOWN", () => {
    const set = extractDiagnosticSignals(
      pack({
        capture: capture("EXACTLY_ONE"),
        processing: [
          attempt({
            attemptId: PROC_A,
            stateBefore: { kind: "CAPTURED", snapshot: snapshot() },
            stateAfter: { kind: "NOT_CAPTURED" },
          }),
        ],
      }),
    );
    expect(stateOf(set, "CAPTURE_EXISTS_ORDER_NOT_PAID")).toBe("UNKNOWN");
  });
});

// ============================================================================
// BLOCKER D — money completeness
// ============================================================================

describe("Phase 4B-R1 correction D — money signal completeness", () => {
  it("D1: two repeated order-only snapshots are UNKNOWN, not ABSENT", () => {
    const set = extractDiagnosticSignals(
      pack({
        money: null,
        processing: [
          afterState(orderOnlySnapshot(), PROC_A),
          afterState(orderOnlySnapshot(), PROC_B),
        ],
      }),
    );
    expect(stateOf(set, "AMOUNT_MISMATCH")).toBe("UNKNOWN");
    expect(stateOf(set, "CURRENCY_MISMATCH")).toBe("UNKNOWN");
  });

  it("D2: order plus provider money with no attempt/payment is UNKNOWN", () => {
    const set = extractDiagnosticSignals(
      pack({
        money: { amountSubunits: 50000, currency: "INR" },
        processing: [afterState(orderOnlySnapshot())],
      }),
    );
    expect(stateOf(set, "AMOUNT_MISMATCH")).toBe("UNKNOWN");
    expect(stateOf(set, "CURRENCY_MISMATCH")).toBe("UNKNOWN");
  });

  it("D3: a complete path with exact integer equality is ABSENT", () => {
    const set = extractDiagnosticSignals(
      pack({ money: null, processing: [afterState(snapshot())] }),
    );
    expect(stateOf(set, "AMOUNT_MISMATCH")).toBe("ABSENT");
  });

  it("D4: an order/attempt amount mismatch is PRESENT", () => {
    const set = extractDiagnosticSignals(
      pack({
        money: null,
        processing: [
          afterState(
            snapshot({
              paymentAttempt: paymentAttempt({ amountSubunits: 49900 }),
            }),
          ),
        ],
      }),
    );
    expect(stateOf(set, "AMOUNT_MISMATCH")).toBe("PRESENT");
  });

  it("D5: an attempt/payment amount mismatch is PRESENT", () => {
    const set = extractDiagnosticSignals(
      pack({
        money: null,
        processing: [
          afterState(snapshot({ payment: payment({ amountSubunits: 1 }) })),
        ],
      }),
    );
    expect(stateOf(set, "AMOUNT_MISMATCH")).toBe("PRESENT");
  });

  it("D6: a complete path with exact currency equality is ABSENT", () => {
    const set = extractDiagnosticSignals(
      pack({ money: null, processing: [afterState(snapshot())] }),
    );
    expect(stateOf(set, "CURRENCY_MISMATCH")).toBe("ABSENT");
  });

  it("D7: each merchant currency mismatch is PRESENT", () => {
    const attemptMismatch = extractDiagnosticSignals(
      pack({
        money: null,
        processing: [
          afterState(
            snapshot({ paymentAttempt: paymentAttempt({ currency: "USD" }) }),
          ),
        ],
      }),
    );
    expect(stateOf(attemptMismatch, "CURRENCY_MISMATCH")).toBe("PRESENT");

    const paymentMismatch = extractDiagnosticSignals(
      pack({
        money: null,
        processing: [
          afterState(snapshot({ payment: payment({ currency: "USD" }) })),
        ],
      }),
    );
    expect(stateOf(paymentMismatch, "CURRENCY_MISMATCH")).toBe("PRESENT");
  });

  it("D8: a provider money mismatch against an agreeing merchant path is PRESENT", () => {
    const set = extractDiagnosticSignals(
      pack({
        money: { amountSubunits: 49900, currency: "USD" },
        processing: [afterState(snapshot())],
      }),
    );
    expect(stateOf(set, "AMOUNT_MISMATCH")).toBe("PRESENT");
    expect(stateOf(set, "CURRENCY_MISMATCH")).toBe("PRESENT");
  });

  it("D9: a null provider field is UNKNOWN when merchant terms otherwise agree", () => {
    const set = extractDiagnosticSignals(
      pack({
        money: { amountSubunits: null, currency: null },
        processing: [afterState(snapshot())],
      }),
    );
    expect(stateOf(set, "AMOUNT_MISMATCH")).toBe("UNKNOWN");
    expect(stateOf(set, "CURRENCY_MISMATCH")).toBe("UNKNOWN");
  });

  it("D10: an already-proven mismatch dominates a later missing money fact", () => {
    const set = extractDiagnosticSignals(
      pack({
        money: { amountSubunits: null, currency: null },
        processing: [
          afterState(
            snapshot({
              payment: payment({ amountSubunits: 1, currency: "USD" }),
            }),
          ),
        ],
      }),
    );
    expect(stateOf(set, "AMOUNT_MISMATCH")).toBe("PRESENT");
    expect(stateOf(set, "CURRENCY_MISMATCH")).toBe("PRESENT");
  });

  it("D11: a path whose ids do not match the pack correlations is not a path", () => {
    const set = extractDiagnosticSignals(
      pack({
        money: null,
        processing: [
          afterState(
            snapshot({
              order: order({ id: "99999999-9999-4999-8999-999999999999" }),
              paymentAttempt: paymentAttempt({
                orderId: "99999999-9999-4999-8999-999999999999",
              }),
            }),
          ),
        ],
      }),
    );
    expect(stateOf(set, "AMOUNT_MISMATCH")).toBe("UNKNOWN");
  });
});

// ============================================================================
// BLOCKER E — payment-attempt regression
// ============================================================================

describe("Phase 4B-R1 correction E — payment-attempt regression", () => {
  function regressionPack(afterStatus: string): DiagnosisEvidencePackV1 {
    return pack({
      processing: [
        attempt({
          attemptId: PROC_A,
          stateBefore: {
            kind: "CAPTURED",
            snapshot: snapshot({
              paymentAttempt: paymentAttempt({ status: "CAPTURED" }),
            }),
          },
          stateAfter: {
            kind: "CAPTURED",
            snapshot: snapshot({
              paymentAttempt: paymentAttempt({ status: afterStatus }),
            }),
          },
        }),
      ],
    });
  }

  it("E1-E4: CAPTURED regressing to any weaker known attempt state is PRESENT", () => {
    for (const weaker of [
      "CREATED",
      "ORDER_CREATED",
      "CHECKOUT_IN_PROGRESS",
      "FAILED_OBSERVED",
    ]) {
      expect(
        stateOf(
          extractDiagnosticSignals(regressionPack(weaker)),
          "OUT_OF_ORDER_STATE_REGRESSION",
        ),
        weaker,
      ).toBe("PRESENT");
    }
  });

  it("E5: CAPTURED to CAPTURED does not prove a regression", () => {
    expect(
      stateOf(
        extractDiagnosticSignals(regressionPack("CAPTURED")),
        "OUT_OF_ORDER_STATE_REGRESSION",
      ),
    ).toBe("ABSENT");
  });

  it("E6: an unrecognised attempt status is UNKNOWN, not silently ABSENT", () => {
    expect(
      stateOf(
        extractDiagnosticSignals(regressionPack("SOMETHING_NEW")),
        "OUT_OF_ORDER_STATE_REGRESSION",
      ),
    ).toBe("UNKNOWN");
  });

  it("E7: a proven order regression dominates an unclassifiable attempt status", () => {
    const set = extractDiagnosticSignals(
      pack({
        processing: [
          attempt({
            attemptId: PROC_A,
            stateBefore: { kind: "CAPTURED", snapshot: snapshot() },
            stateAfter: {
              kind: "CAPTURED",
              snapshot: snapshot({
                order: order({
                  paymentStatus: "UNPAID",
                  businessStatus: "OPEN",
                }),
                paymentAttempt: paymentAttempt({ status: "SOMETHING_NEW" }),
              }),
            },
          }),
        ],
      }),
    );
    expect(stateOf(set, "OUT_OF_ORDER_STATE_REGRESSION")).toBe("PRESENT");
  });

  it("E8: FULFILLED regressing to OPEN is PRESENT", () => {
    const set = extractDiagnosticSignals(
      pack({
        processing: [
          attempt({
            attemptId: PROC_A,
            stateBefore: { kind: "CAPTURED", snapshot: snapshot() },
            stateAfter: {
              kind: "CAPTURED",
              snapshot: snapshot({
                order: order({ paymentStatus: "PAID", businessStatus: "OPEN" }),
              }),
            },
          }),
        ],
      }),
    );
    expect(stateOf(set, "OUT_OF_ORDER_STATE_REGRESSION")).toBe("PRESENT");
  });
});

// ============================================================================
// BLOCKER F — replay protected tuple
// ============================================================================

describe("Phase 4B-R1 correction F — replay protected tuple", () => {
  function replayPack(
    afterSnapshot: MerchantStateSnapshotV1,
    beforeSnapshot: MerchantStateSnapshotV1 = snapshot({
      fulfilments: [fulfilment(FULFIL_A)],
    }),
  ): DiagnosisEvidencePackV1 {
    return pack({
      processing: [
        attempt({
          attemptId: PROC_A,
          sourceKind: "PAYCHAOS_REPLAY",
          stateBefore: { kind: "CAPTURED", snapshot: beforeSnapshot },
          stateAfter: { kind: "CAPTURED", snapshot: afterSnapshot },
        }),
      ],
    });
  }

  const base = () => snapshot({ fulfilments: [fulfilment(FULFIL_A)] });

  const changes: readonly (readonly [string, MerchantStateSnapshotV1])[] = [
    [
      "1 order payment status",
      snapshot({
        order: order({ paymentStatus: "UNPAID" }),
        fulfilments: [fulfilment(FULFIL_A)],
      }),
    ],
    [
      "2 order business status",
      snapshot({
        order: order({ businessStatus: "OPEN" }),
        fulfilments: [fulfilment(FULFIL_A)],
      }),
    ],
    [
      "3 order amount",
      snapshot({
        order: order({ amountSubunits: 49900 }),
        fulfilments: [fulfilment(FULFIL_A)],
      }),
    ],
    [
      "4 order currency",
      snapshot({
        order: order({ currency: "USD" }),
        fulfilments: [fulfilment(FULFIL_A)],
      }),
    ],
    [
      "5 payment capturedAt",
      snapshot({
        payment: payment({ capturedAt: "2026-08-02T00:00:00.000Z" }),
        fulfilments: [fulfilment(FULFIL_A)],
      }),
    ],
    [
      "6 payment failedAt",
      snapshot({
        payment: payment({ failedAt: "2026-08-02T00:00:00.000Z" }),
        fulfilments: [fulfilment(FULFIL_A)],
      }),
    ],
    [
      "7 payment razorpay status",
      snapshot({
        payment: payment({ razorpayPaymentStatus: "failed" }),
        fulfilments: [fulfilment(FULFIL_A)],
      }),
    ],
    [
      "8 payment amount",
      snapshot({
        payment: payment({ amountSubunits: 1 }),
        fulfilments: [fulfilment(FULFIL_A)],
      }),
    ],
    [
      "9 payment currency",
      snapshot({
        payment: payment({ currency: "USD" }),
        fulfilments: [fulfilment(FULFIL_A)],
      }),
    ],
    [
      "10 payment-attempt status",
      snapshot({
        paymentAttempt: paymentAttempt({ status: "FAILED_OBSERVED" }),
        fulfilments: [fulfilment(FULFIL_A)],
      }),
    ],
    [
      "11 fulfilment count",
      snapshot({ fulfilments: [fulfilment(FULFIL_A), fulfilment(FULFIL_B)] }),
    ],
    [
      "12 fulfilment identity at equal count",
      snapshot({ fulfilments: [fulfilment(FULFIL_B)] }),
    ],
  ];

  it("F1-F12: every protected tuple field change proves REPLAY_CHANGED_FINAL_STATE", () => {
    for (const [label, after] of changes) {
      expect(
        stateOf(
          extractDiagnosticSignals(replayPack(after)),
          "REPLAY_CHANGED_FINAL_STATE",
        ),
        label,
      ).toBe("PRESENT");
    }
  });

  it("F13: a completely unchanged protected tuple is ABSENT", () => {
    expect(
      stateOf(
        extractDiagnosticSignals(replayPack(base())),
        "REPLAY_CHANGED_FINAL_STATE",
      ),
    ).toBe("ABSENT");
  });

  it("F14: missing required nested replay state is UNKNOWN, never ABSENT", () => {
    expect(
      stateOf(
        extractDiagnosticSignals(
          replayPack(
            snapshot({ payment: null, fulfilments: [fulfilment(FULFIL_A)] }),
          ),
        ),
        "REPLAY_CHANGED_FINAL_STATE",
      ),
    ).toBe("UNKNOWN");
  });

  it("F15: one proven change dominates another incomplete replay pair", () => {
    const set = extractDiagnosticSignals(
      pack({
        processing: [
          attempt({
            attemptId: PROC_A,
            sourceKind: "PAYCHAOS_REPLAY",
            stateBefore: { kind: "CAPTURED", snapshot: base() },
            stateAfter: {
              kind: "CAPTURED",
              snapshot: snapshot({
                fulfilments: [fulfilment(FULFIL_A), fulfilment(FULFIL_B)],
              }),
            },
          }),
          attempt({
            attemptId: PROC_B,
            sourceKind: "PAYCHAOS_REPLAY",
            stateBefore: { kind: "NOT_CAPTURED" },
            stateAfter: { kind: "NOT_CAPTURED" },
          }),
        ],
      }),
    );
    expect(stateOf(set, "REPLAY_CHANGED_FINAL_STATE")).toBe("PRESENT");
  });
});

// ============================================================================
// BLOCKER G — duplicate-effect completeness
// ============================================================================

describe("Phase 4B-R1 correction G — duplicate-effect completeness", () => {
  it("G-A: one complete single-fulfilment state plus an uncaptured path is UNKNOWN", () => {
    const set = extractDiagnosticSignals(
      pack({
        processing: [
          afterState(snapshot({ fulfilments: [fulfilment(FULFIL_A)] }), PROC_A),
          attempt({ attemptId: PROC_B }),
        ],
      }),
    );
    // Previously this produced ABSENT from the one convenient snapshot.
    expect(stateOf(set, "DUPLICATE_FULFILMENTS")).toBe("UNKNOWN");
  });

  it("G-B: a complete duplicate proof dominates another incomplete attempt", () => {
    const set = extractDiagnosticSignals(
      pack({
        processing: [
          afterState(
            snapshot({
              fulfilments: [fulfilment(FULFIL_A), fulfilment(FULFIL_B)],
            }),
            PROC_A,
          ),
          attempt({ attemptId: PROC_B }),
        ],
      }),
    );
    expect(stateOf(set, "DUPLICATE_FULFILMENTS")).toBe("PRESENT");
  });

  it("G-C: every relevant complete observation proving <= 1 is ABSENT", () => {
    const set = extractDiagnosticSignals(
      pack({
        processing: [
          afterState(snapshot({ fulfilments: [fulfilment(FULFIL_A)] }), PROC_A),
          afterState(snapshot({ fulfilments: [fulfilment(FULFIL_A)] }), PROC_B),
        ],
      }),
    );
    expect(stateOf(set, "DUPLICATE_FULFILMENTS")).toBe("ABSENT");
  });

  it("G-D: duplicates proven but one key unavailable keeps the key signal UNKNOWN", () => {
    const set = extractDiagnosticSignals(
      pack({
        processing: [
          afterState(
            snapshot({
              fulfilments: [
                fulfilment(FULFIL_A),
                fulfilment(FULFIL_B, { idempotencyKey: null }),
              ],
            }),
          ),
        ],
      }),
    );
    expect(stateOf(set, "DUPLICATE_FULFILMENTS")).toBe("PRESENT");
    expect(stateOf(set, "DIFFERENT_FULFILMENT_IDEMPOTENCY_KEYS")).toBe(
      "UNKNOWN",
    );
  });

  it("G-E: different keys proven in a complete observation survive unrelated incompleteness", () => {
    const set = extractDiagnosticSignals(
      pack({
        processing: [
          afterState(
            snapshot({
              fulfilments: [
                fulfilment(FULFIL_A, {
                  idempotencyKey: `FULFIL_ORDER:${PROC_A}`,
                }),
                fulfilment(FULFIL_B, {
                  idempotencyKey: `FULFIL_ORDER:${PROC_B}`,
                }),
              ],
            }),
            PROC_A,
          ),
          attempt({ attemptId: PROC_B }),
        ],
      }),
    );
    expect(stateOf(set, "DIFFERENT_FULFILMENT_IDEMPOTENCY_KEYS")).toBe(
      "PRESENT",
    );
    expect(stateOf(set, "SAME_LOGICAL_PAYMENT")).toBe("PRESENT");
  });
});

// ============================================================================
// Historical fulfilment idempotency-key compatibility
// ============================================================================

describe("Phase 4B-R1 — fulfilment idempotency-key compatibility", () => {
  const HISTORICAL_SNAPSHOT = {
    version: 1,
    order: {
      id: ORDER_ID,
      paymentStatus: "PAID",
      businessStatus: "FULFILLED",
      amountSubunits: 50000,
      currency: "INR",
    },
    paymentAttempt: null,
    payment: null,
    fulfilments: [
      {
        id: FULFIL_A,
        orderId: ORDER_ID,
        paymentId: PAYMENT_ID,
        triggerProcessingAttemptId: PROC_A,
        effectType: "FULFIL_ORDER",
        appliedAt: "2026-08-01T10:00:02.000Z",
        // Deliberately no `idempotencyKey` — this is the pre-4B shape.
      },
    ],
  };

  it("A: an old persisted snapshot without idempotencyKey still parses as valid evidence", () => {
    expect(parseMerchantStateSnapshotV1(HISTORICAL_SNAPSHOT).kind).toBe(
      "CAPTURED",
    );
  });

  it("B: its normalized projection exposes the key as unavailable", () => {
    const parsed = parseMerchantStateSnapshotV1(HISTORICAL_SNAPSHOT);
    if (parsed.kind !== "CAPTURED") throw new Error("expected CAPTURED");
    expect(parsed.snapshot.fulfilments?.[0]?.idempotencyKey).toBeNull();
  });

  it("C: the key is never reconstructed from the order id", () => {
    const parsed = parseMerchantStateSnapshotV1(HISTORICAL_SNAPSHOT);
    if (parsed.kind !== "CAPTURED") throw new Error("expected CAPTURED");
    expect(JSON.stringify(parsed.snapshot)).not.toContain("FULFIL_ORDER:");
  });

  it("D: a newly captured snapshot carries the exact persisted key", () => {
    const built = buildMerchantStateSnapshot({
      order: {
        id: ORDER_ID,
        payment_status: "PAID",
        business_status: "FULFILLED",
        amount_subunits: 50000,
        currency: "INR",
      },
      paymentAttempt: null,
      payment: null,
      fulfilments: [
        {
          id: FULFIL_A,
          order_id: ORDER_ID,
          payment_id: PAYMENT_ID,
          trigger_processing_attempt_id: PROC_A,
          effect_type: "FULFIL_ORDER",
          applied_at: "2026-08-01T10:00:02.000Z",
          idempotency_key: `FULFIL_ORDER:${ORDER_ID}`,
        },
      ],
    });
    expect(built.fulfilments?.[0]?.idempotencyKey).toBe(
      `FULFIL_ORDER:${ORDER_ID}`,
    );

    const roundTripped = parseMerchantStateSnapshotV1(
      JSON.parse(JSON.stringify(serializeMerchantStateSnapshot(built))),
    );
    if (roundTripped.kind !== "CAPTURED") throw new Error("expected CAPTURED");
    expect(roundTripped.snapshot.fulfilments?.[0]?.idempotencyKey).toBe(
      `FULFIL_ORDER:${ORDER_ID}`,
    );
  });

  it("E: the 4B key signal is UNKNOWN for historical unavailable-key evidence", () => {
    const historicalDuplicate = {
      ...HISTORICAL_SNAPSHOT,
      fulfilments: [
        HISTORICAL_SNAPSHOT.fulfilments[0],
        { ...HISTORICAL_SNAPSHOT.fulfilments[0], id: FULFIL_B },
      ],
    };
    const parsed = parseMerchantStateSnapshotV1(historicalDuplicate);
    if (parsed.kind !== "CAPTURED") throw new Error("expected CAPTURED");

    const set = extractDiagnosticSignals(
      pack({ processing: [afterState(parsed.snapshot)] }),
    );
    expect(stateOf(set, "DUPLICATE_FULFILMENTS")).toBe("PRESENT");
    expect(stateOf(set, "DIFFERENT_FULFILMENT_IDEMPOTENCY_KEYS")).toBe(
      "UNKNOWN",
    );
  });

  it("F: no old evidence becomes INVALID merely because the field did not exist", () => {
    for (const fixture of [
      HISTORICAL_SNAPSHOT,
      { ...HISTORICAL_SNAPSHOT, fulfilments: [] },
      { ...HISTORICAL_SNAPSHOT, order: null, fulfilments: null },
    ]) {
      expect(parseMerchantStateSnapshotV1(fixture).kind).not.toBe("INVALID");
    }
    expect(
      parseMerchantStateSnapshotV1({
        ...HISTORICAL_SNAPSHOT,
        fulfilments: [
          { ...HISTORICAL_SNAPSHOT.fulfilments[0], idempotencyKey: 42 },
        ],
      }).kind,
    ).toBe("INVALID");
  });
});

// ============================================================================
// BLOCKER H — a null correlation is never a wildcard
// ============================================================================

describe("Phase 4B-R1 correction H — null correlation is not a wildcard", () => {
  const noOrderCorrelation = {
    chaosRunId: RUN_ID,
    orderId: null,
    paymentAttemptId: ATTEMPT_ID,
    paymentId: PAYMENT_ID,
  };

  it("H1: an authoritative capture with no order correlation cannot judge an arbitrary order", () => {
    const set = extractDiagnosticSignals(
      pack({
        correlations: noOrderCorrelation,
        capture: capture("EXACTLY_ONE"),
        processing: [
          afterState(snapshot({ order: order({ paymentStatus: "PENDING" }) })),
        ],
      }),
    );
    // Previously the missing correlation matched every snapshot order and
    // this produced PRESENT from an order never shown to be the subject.
    expect(stateOf(set, "CAPTURE_EXISTS_ORDER_NOT_PAID")).toBe("UNKNOWN");
  });

  it("H2: a verified failure with no order correlation cannot judge an arbitrary PAID order", () => {
    const set = extractDiagnosticSignals(
      pack({
        correlations: noOrderCorrelation,
        provenance: verifiedFailureWebhook,
        capture: capture("NONE_OBSERVED"),
        processing: [
          afterState(snapshot({ order: order({ paymentStatus: "PAID" }) })),
        ],
      }),
    );
    expect(stateOf(set, "FAILURE_EVENT_MARKED_PAID")).toBe("UNKNOWN");
  });

  it("H3: a non-null matching order correlation still resolves both signals", () => {
    const notPaid = extractDiagnosticSignals(
      pack({
        capture: capture("EXACTLY_ONE"),
        processing: [
          afterState(snapshot({ order: order({ paymentStatus: "PENDING" }) })),
        ],
      }),
    );
    expect(stateOf(notPaid, "CAPTURE_EXISTS_ORDER_NOT_PAID")).toBe("PRESENT");

    const markedPaid = extractDiagnosticSignals(
      pack({
        provenance: verifiedFailureWebhook,
        capture: capture("NONE_OBSERVED"),
        processing: [
          afterState(snapshot({ order: order({ paymentStatus: "PAID" }) })),
        ],
      }),
    );
    expect(stateOf(markedPaid, "FAILURE_EVENT_MARKED_PAID")).toBe("PRESENT");
  });

  it("H4: a non-null correlation naming a different order selects no fallback", () => {
    const notPaid = extractDiagnosticSignals(
      pack({
        capture: capture("EXACTLY_ONE"),
        processing: [
          afterState(
            snapshot({
              order: order({ id: OTHER_ORDER_ID, paymentStatus: "PENDING" }),
            }),
          ),
        ],
      }),
    );
    expect(stateOf(notPaid, "CAPTURE_EXISTS_ORDER_NOT_PAID")).toBe("UNKNOWN");

    const markedPaid = extractDiagnosticSignals(
      pack({
        provenance: verifiedFailureWebhook,
        capture: capture("NONE_OBSERVED"),
        processing: [
          afterState(snapshot({ order: order({ id: OTHER_ORDER_ID }) })),
        ],
      }),
    );
    expect(stateOf(markedPaid, "FAILURE_EVENT_MARKED_PAID")).toBe("UNKNOWN");
  });

  it("H5: SAME_LOGICAL_PAYMENT is UNKNOWN without the subject order identity", () => {
    const set = extractDiagnosticSignals(
      pack({
        correlations: noOrderCorrelation,
        processing: [
          afterState(
            snapshot({
              fulfilments: [fulfilment(FULFIL_A), fulfilment(FULFIL_B)],
            }),
          ),
        ],
      }),
    );
    // The duplicate itself is still directly observable.
    expect(stateOf(set, "DUPLICATE_FULFILMENTS")).toBe("PRESENT");
    // But "one logical payment" would be manufactured from unfiltered rows.
    expect(stateOf(set, "SAME_LOGICAL_PAYMENT")).toBe("UNKNOWN");
  });

  it("H6: duplicates spanning two payments on the subject order are ABSENT", () => {
    const set = extractDiagnosticSignals(
      pack({
        correlations: {
          chaosRunId: RUN_ID,
          orderId: ORDER_ID,
          paymentAttemptId: ATTEMPT_ID,
          paymentId: null,
        },
        processing: [
          afterState(
            snapshot({
              fulfilments: [
                fulfilment(FULFIL_A),
                fulfilment(FULFIL_B, { paymentId: OTHER_PAYMENT_ID }),
              ],
            }),
          ),
        ],
      }),
    );
    expect(stateOf(set, "DUPLICATE_FULFILMENTS")).toBe("PRESENT");
    expect(stateOf(set, "SAME_LOGICAL_PAYMENT")).toBe("ABSENT");
  });
});

// ============================================================================
// BLOCKER I — duplicate-effect ABSENCE requires after-state completeness
// ============================================================================

describe("Phase 4B-R1 correction I — after-state completeness", () => {
  it("I1: a before-state alone can never establish DUPLICATE_FULFILMENTS ABSENT", () => {
    const set = extractDiagnosticSignals(
      pack({
        processing: [
          attempt({
            attemptId: PROC_A,
            stateBefore: {
              kind: "CAPTURED",
              snapshot: snapshot({ fulfilments: [fulfilment(FULFIL_A)] }),
            },
            stateAfter: { kind: "NOT_CAPTURED" },
          }),
        ],
      }),
    );
    // Previously the complete before-state produced ABSENT even though what
    // the attempt then did was never captured.
    expect(stateOf(set, "DUPLICATE_FULFILMENTS")).toBe("UNKNOWN");
  });

  it("I2: a duplicate already present in the before-state is directly proven", () => {
    const set = extractDiagnosticSignals(
      pack({
        processing: [
          attempt({
            attemptId: PROC_A,
            stateBefore: {
              kind: "CAPTURED",
              snapshot: snapshot({
                fulfilments: [fulfilment(FULFIL_A), fulfilment(FULFIL_B)],
              }),
            },
            stateAfter: { kind: "NOT_CAPTURED" },
          }),
        ],
      }),
    );
    expect(stateOf(set, "DUPLICATE_FULFILMENTS")).toBe("PRESENT");
  });

  it("I3: every relevant attempt with a complete after-state proving <= 1 is ABSENT", () => {
    const set = extractDiagnosticSignals(
      pack({
        processing: [
          afterState(snapshot({ fulfilments: [fulfilment(FULFIL_A)] }), PROC_A),
          afterState(snapshot({ fulfilments: [fulfilment(FULFIL_A)] }), PROC_B),
        ],
      }),
    );
    expect(stateOf(set, "DUPLICATE_FULFILMENTS")).toBe("ABSENT");
  });

  it("I4: one complete after-state plus one INVALID after-state is UNKNOWN", () => {
    const set = extractDiagnosticSignals(
      pack({
        processing: [
          afterState(snapshot({ fulfilments: [fulfilment(FULFIL_A)] }), PROC_A),
          attempt({
            attemptId: PROC_B,
            stateAfter: { kind: "INVALID" },
          }),
        ],
      }),
    );
    expect(stateOf(set, "DUPLICATE_FULFILMENTS")).toBe("UNKNOWN");
  });

  it("I5: a complete duplicate proof dominates an INVALID after-state", () => {
    const set = extractDiagnosticSignals(
      pack({
        processing: [
          afterState(
            snapshot({
              fulfilments: [fulfilment(FULFIL_A), fulfilment(FULFIL_B)],
            }),
            PROC_A,
          ),
          attempt({
            attemptId: PROC_B,
            stateAfter: { kind: "INVALID" },
          }),
        ],
      }),
    );
    expect(stateOf(set, "DUPLICATE_FULFILMENTS")).toBe("PRESENT");
  });

  it("I6: an empty before-state with a complete single-effect after-state is ABSENT", () => {
    const set = extractDiagnosticSignals(
      pack({
        processing: [
          attempt({
            attemptId: PROC_A,
            stateBefore: {
              kind: "CAPTURED",
              snapshot: snapshot({ fulfilments: [] }),
            },
            stateAfter: {
              kind: "CAPTURED",
              snapshot: snapshot({ fulfilments: [fulfilment(FULFIL_A)] }),
            },
          }),
        ],
      }),
    );
    expect(stateOf(set, "DUPLICATE_FULFILMENTS")).toBe("ABSENT");
  });

  it("I7: a captured after-state with a null fulfilment collection is not completeness", () => {
    const set = extractDiagnosticSignals(
      pack({
        processing: [
          afterState(snapshot({ fulfilments: [fulfilment(FULFIL_A)] }), PROC_A),
          afterState(snapshot({ order: null, fulfilments: null }), PROC_B),
        ],
      }),
    );
    expect(stateOf(set, "DUPLICATE_FULFILMENTS")).toBe("UNKNOWN");
  });
});

// ============================================================================
// BLOCKER J — every duplicate observation is evaluated, not just the first
// ============================================================================

describe("Phase 4B-R1 correction J — all duplicate proofs are evaluated", () => {
  const sameKeyRows = [
    fulfilment(FULFIL_A, { idempotencyKey: "FULFIL_ORDER:same" }),
    fulfilment(FULFIL_B, { idempotencyKey: "FULFIL_ORDER:same" }),
  ];
  const differentKeyRows = [
    fulfilment(FULFIL_A, { idempotencyKey: "FULFIL_ORDER:a" }),
    fulfilment(FULFIL_B, { idempotencyKey: "FULFIL_ORDER:b" }),
  ];
  const unavailableKeyRows = [
    fulfilment(FULFIL_A, { idempotencyKey: null }),
    fulfilment(FULFIL_B, { idempotencyKey: null }),
  ];

  it("J1: a later different-key duplicate proof is not hidden by an earlier same-key one", () => {
    const set = extractDiagnosticSignals(
      pack({
        processing: [
          afterState(snapshot({ fulfilments: sameKeyRows }), PROC_A),
          afterState(snapshot({ fulfilments: differentKeyRows }), PROC_B),
        ],
      }),
    );
    expect(stateOf(set, "DIFFERENT_FULFILMENT_IDEMPOTENCY_KEYS")).toBe(
      "PRESENT",
    );
  });

  it("J2: the same evidence in the reverse order yields the same result", () => {
    const set = extractDiagnosticSignals(
      pack({
        processing: [
          afterState(snapshot({ fulfilments: differentKeyRows }), PROC_B),
          afterState(snapshot({ fulfilments: sameKeyRows }), PROC_A),
        ],
      }),
    );
    expect(stateOf(set, "DIFFERENT_FULFILMENT_IDEMPOTENCY_KEYS")).toBe(
      "PRESENT",
    );
  });

  it("J3: same keys with a missing relevant after-state is UNKNOWN, never ABSENT", () => {
    const set = extractDiagnosticSignals(
      pack({
        processing: [
          afterState(snapshot({ fulfilments: sameKeyRows }), PROC_A),
          attempt({ attemptId: PROC_B }),
        ],
      }),
    );
    expect(stateOf(set, "DIFFERENT_FULFILMENT_IDEMPOTENCY_KEYS")).toBe(
      "UNKNOWN",
    );
  });

  it("J4: complete after evidence with one semantic key everywhere is ABSENT", () => {
    const set = extractDiagnosticSignals(
      pack({
        processing: [
          afterState(snapshot({ fulfilments: sameKeyRows }), PROC_A),
          afterState(snapshot({ fulfilments: sameKeyRows }), PROC_B),
        ],
      }),
    );
    expect(stateOf(set, "DIFFERENT_FULFILMENT_IDEMPOTENCY_KEYS")).toBe(
      "ABSENT",
    );
  });

  it("J5: a different-key proof dominates another observation with an unavailable key", () => {
    const set = extractDiagnosticSignals(
      pack({
        processing: [
          afterState(snapshot({ fulfilments: unavailableKeyRows }), PROC_A),
          afterState(snapshot({ fulfilments: differentKeyRows }), PROC_B),
        ],
      }),
    );
    expect(stateOf(set, "DIFFERENT_FULFILMENT_IDEMPOTENCY_KEYS")).toBe(
      "PRESENT",
    );
  });

  it("J6: SAME_LOGICAL_PAYMENT is not decided by the first duplicate observation", () => {
    const crossPathRows = [
      fulfilment(FULFIL_A),
      fulfilment(FULFIL_B, { paymentId: OTHER_PAYMENT_ID }),
    ];
    const samePathRows = [fulfilment(FULFIL_A), fulfilment(FULFIL_B)];
    const correlations = {
      chaosRunId: RUN_ID,
      orderId: ORDER_ID,
      paymentAttemptId: ATTEMPT_ID,
      paymentId: null,
    };
    const forward = extractDiagnosticSignals(
      pack({
        correlations,
        processing: [
          afterState(snapshot({ fulfilments: crossPathRows }), PROC_A),
          afterState(snapshot({ fulfilments: samePathRows }), PROC_B),
        ],
      }),
    );
    const reversed = extractDiagnosticSignals(
      pack({
        correlations,
        processing: [
          afterState(snapshot({ fulfilments: samePathRows }), PROC_B),
          afterState(snapshot({ fulfilments: crossPathRows }), PROC_A),
        ],
      }),
    );
    expect(stateOf(forward, "SAME_LOGICAL_PAYMENT")).toBe("PRESENT");
    expect(stateOf(reversed, "SAME_LOGICAL_PAYMENT")).toBe("PRESENT");
  });

  it("J7: a cross-path duplicate with incomplete evidence elsewhere is UNKNOWN", () => {
    const set = extractDiagnosticSignals(
      pack({
        correlations: {
          chaosRunId: RUN_ID,
          orderId: ORDER_ID,
          paymentAttemptId: ATTEMPT_ID,
          paymentId: null,
        },
        processing: [
          afterState(
            snapshot({
              fulfilments: [
                fulfilment(FULFIL_A),
                fulfilment(FULFIL_B, { paymentId: OTHER_PAYMENT_ID }),
              ],
            }),
            PROC_A,
          ),
          attempt({ attemptId: PROC_B }),
        ],
      }),
    );
    expect(stateOf(set, "SAME_LOGICAL_PAYMENT")).toBe("UNKNOWN");
  });
});

// ============================================================================
// BLOCKER K — transition completeness
// ============================================================================

describe("Phase 4B-R1 correction K — transition completeness", () => {
  /** One attempt whose protected transition is legal and unchanged. */
  function legalTransition(attemptId: string): EvidencePackProcessingAttempt {
    return attempt({
      attemptId,
      stateBefore: { kind: "CAPTURED", snapshot: snapshot() },
      stateAfter: { kind: "CAPTURED", snapshot: snapshot() },
    });
  }

  /** One attempt proving a PAID -> PENDING order regression. */
  function regressingTransition(
    attemptId: string,
  ): EvidencePackProcessingAttempt {
    return attempt({
      attemptId,
      stateBefore: { kind: "CAPTURED", snapshot: snapshot() },
      stateAfter: {
        kind: "CAPTURED",
        snapshot: snapshot({ order: order({ paymentStatus: "PENDING" }) }),
      },
    });
  }

  /** One attempt whose transition was never observed on either side. */
  function unobservedTransition(
    attemptId: string,
  ): EvidencePackProcessingAttempt {
    return attempt({
      attemptId,
      stateBefore: { kind: "NOT_CAPTURED" },
      stateAfter: { kind: "NOT_CAPTURED" },
    });
  }

  it("K1: one legal transition cannot speak for a completely unobserved one", () => {
    const set = extractDiagnosticSignals(
      pack({
        processing: [legalTransition(PROC_A), unobservedTransition(PROC_B)],
      }),
    );
    // Previously the unobserved attempt was silently dropped and the single
    // clean pair produced ABSENT.
    expect(stateOf(set, "OUT_OF_ORDER_STATE_REGRESSION")).toBe("UNKNOWN");
  });

  it("K2: a proven regression dominates an unobserved transition", () => {
    const set = extractDiagnosticSignals(
      pack({
        processing: [
          regressingTransition(PROC_A),
          unobservedTransition(PROC_B),
        ],
      }),
    );
    expect(stateOf(set, "OUT_OF_ORDER_STATE_REGRESSION")).toBe("PRESENT");
  });

  it("K3: two complete comparable non-regressing transitions are ABSENT", () => {
    const set = extractDiagnosticSignals(
      pack({
        processing: [legalTransition(PROC_A), legalTransition(PROC_B)],
      }),
    );
    expect(stateOf(set, "OUT_OF_ORDER_STATE_REGRESSION")).toBe("ABSENT");
  });

  it("K4: two captured snapshots with no comparable protected subject are not evidence", () => {
    const subjectless = {
      version: 1,
      order: null,
      paymentAttempt: null,
      payment: null,
      fulfilments: null,
    } as const;
    const set = extractDiagnosticSignals(
      pack({
        processing: [
          legalTransition(PROC_A),
          attempt({
            attemptId: PROC_B,
            stateBefore: { kind: "CAPTURED", snapshot: subjectless },
            stateAfter: { kind: "CAPTURED", snapshot: subjectless },
          }),
        ],
      }),
    );
    // A JSON snapshot existing is not the required transition evidence.
    expect(stateOf(set, "OUT_OF_ORDER_STATE_REGRESSION")).toBe("UNKNOWN");
  });

  it("K5: an unrecognised required status in another attempt is UNKNOWN", () => {
    const set = extractDiagnosticSignals(
      pack({
        processing: [
          legalTransition(PROC_A),
          attempt({
            attemptId: PROC_B,
            stateBefore: { kind: "CAPTURED", snapshot: snapshot() },
            stateAfter: {
              kind: "CAPTURED",
              snapshot: snapshot({
                paymentAttempt: paymentAttempt({ status: "SOMETHING_NEW" }),
              }),
            },
          }),
        ],
      }),
    );
    expect(stateOf(set, "OUT_OF_ORDER_STATE_REGRESSION")).toBe("UNKNOWN");
  });

  it("K6: K1 in the reverse processing order yields the same result", () => {
    const set = extractDiagnosticSignals(
      pack({
        processing: [unobservedTransition(PROC_B), legalTransition(PROC_A)],
      }),
    );
    expect(stateOf(set, "OUT_OF_ORDER_STATE_REGRESSION")).toBe("UNKNOWN");
  });

  it("K7: K2 in the reverse processing order yields the same result", () => {
    const set = extractDiagnosticSignals(
      pack({
        processing: [
          unobservedTransition(PROC_B),
          regressingTransition(PROC_A),
        ],
      }),
    );
    expect(stateOf(set, "OUT_OF_ORDER_STATE_REGRESSION")).toBe("PRESENT");
  });

  it("K8: a single complete legal transition is still ABSENT", () => {
    const set = extractDiagnosticSignals(
      pack({ processing: [legalTransition(PROC_A)] }),
    );
    expect(stateOf(set, "OUT_OF_ORDER_STATE_REGRESSION")).toBe("ABSENT");
  });

  it("K9: an INVALID side is incomplete transition evidence, not a negative", () => {
    const set = extractDiagnosticSignals(
      pack({
        processing: [
          legalTransition(PROC_A),
          attempt({
            attemptId: PROC_B,
            stateBefore: { kind: "CAPTURED", snapshot: snapshot() },
            stateAfter: { kind: "INVALID" },
          }),
        ],
      }),
    );
    expect(stateOf(set, "OUT_OF_ORDER_STATE_REGRESSION")).toBe("UNKNOWN");
  });

  it("K10: an order-only pair is sufficient transition evidence on its own", () => {
    const orderOnly = orderOnlySnapshot({ fulfilments: null });
    const set = extractDiagnosticSignals(
      pack({
        processing: [
          attempt({
            attemptId: PROC_A,
            stateBefore: { kind: "CAPTURED", snapshot: orderOnly },
            stateAfter: { kind: "CAPTURED", snapshot: orderOnly },
          }),
        ],
      }),
    );
    // Neither snapshot carries a payment attempt, and that is fine: one
    // comparable protected subject is enough.
    expect(stateOf(set, "OUT_OF_ORDER_STATE_REGRESSION")).toBe("ABSENT");
  });
});
