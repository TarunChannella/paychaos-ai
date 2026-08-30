import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

import {
  DIAGNOSIS_EVIDENCE_PACK_VERSION,
  EvidencePackError,
  buildDiagnosisEvidencePack,
} from "@/lib/diagnosis/evidence-pack";
import type {
  DiagnosisEvidencePackV1,
  EvidencePackBuildInputV1,
} from "@/lib/diagnosis/evidence-pack";
import type {
  ChaosRunEvidenceBundleV1,
  ProcessingAttemptEvidence,
  SafeWebhookEvidence,
} from "@/lib/evidence/chaos-run-evidence";
import type { FindingDetail } from "@/lib/findings/types";
import type { InvariantResultValue } from "@/lib/supabase/types";

/**
 * Phase 4A-R1 — the Diagnosis Evidence Pack builder.
 *
 * Every fixture here is hand-built in memory. There is no database, no
 * network, no Supabase client and no chaos execution anywhere in this file:
 * the builder under test is a pure function, so the tests are too.
 */

const RUN_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_RUN_ID = "22222222-2222-4222-8222-222222222222";
const RESULT_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_RESULT_ID = "44444444-4444-4444-8444-444444444444";
const FINDING_ID = "55555555-5555-4555-8555-555555555555";
const WEBHOOK_ID = "66666666-6666-4666-8666-666666666666";
const ORIGINAL_ATTEMPT_ID = "77777777-7777-4777-8777-777777777777";
const REPLAY_ATTEMPT_A = "88888888-8888-4888-8888-888888888888";
const REPLAY_ATTEMPT_B = "99999999-9999-4999-8999-999999999999";
const ORDER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PAYMENT_ATTEMPT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PAYMENT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const FULFILMENT_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const UNKNOWN_REF_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

function realWebhook(): SafeWebhookEvidence {
  return {
    id: WEBHOOK_ID,
    razorpayEventId: "evt_test_0001",
    eventType: "payment.captured",
    sourceKind: "REAL_RAZORPAY_WEBHOOK",
    signatureVerified: true,
    processingStatus: "PROCESSED",
    duplicateDeliveryCount: 0,
    receivedAt: "2026-08-01T10:00:00.000Z",
    paymentAttemptId: PAYMENT_ATTEMPT_ID,
    paymentId: PAYMENT_ID,
    razorpayPaymentId: "pay_test_0001",
    amountSubunits: 50000,
    currency: "INR",
  };
}

function attempt(
  overrides: Partial<ProcessingAttemptEvidence> & { readonly id: string },
): ProcessingAttemptEvidence {
  return {
    webhookEventId: WEBHOOK_ID,
    chaosRunId: null,
    sourceKind: "REAL_RAZORPAY_WEBHOOK",
    status: "SUCCEEDED",
    isDuplicateDelivery: false,
    paymentAttemptId: PAYMENT_ATTEMPT_ID,
    paymentId: PAYMENT_ID,
    errorCode: null,
    startedAt: "2026-08-01T10:00:01.000Z",
    finishedAt: "2026-08-01T10:00:02.000Z",
    stateBefore: { kind: "NOT_CAPTURED" },
    stateAfter: { kind: "NOT_CAPTURED" },
    ...overrides,
  };
}

function finding(overrides?: {
  readonly correlations?: Partial<FindingDetail["correlations"]>;
  readonly evidenceRefs?: FindingDetail["invariant"]["evidenceRefs"];
  readonly invariantResultId?: string;
}): FindingDetail {
  return {
    findingId: FINDING_ID,
    invariantResultId: overrides?.invariantResultId ?? RESULT_ID,
    status: "OPEN",
    title: "INV-002 — One Captured Payment, At Most One Fulfilment",
    createdAt: "2026-08-01T11:00:00.000Z",
    updatedAt: "2026-08-01T11:00:00.000Z",
    invariant: {
      invariantId: "INV-002",
      invariantVersion: "1",
      severity: "CRITICAL",
      expectedSummary: "fulfilment count <= 1",
      observedSummary: "fulfilment count = 2",
      reason: "Two fulfilment rows exist for one captured payment.",
      evaluatedAt: "2026-08-01T10:30:00.000Z",
      evidenceRefs: overrides?.evidenceRefs ?? [
        { kind: "CHAOS_RUN", id: RUN_ID },
        { kind: "EVENT_PROCESSING_ATTEMPT", id: REPLAY_ATTEMPT_A },
      ],
    },
    correlations: {
      chaosRunId: RUN_ID,
      orderId: ORDER_ID,
      paymentAttemptId: PAYMENT_ATTEMPT_ID,
      paymentId: PAYMENT_ID,
      ...overrides?.correlations,
    },
  };
}

function c01Bundle(
  overrides?: Partial<ChaosRunEvidenceBundleV1>,
): ChaosRunEvidenceBundleV1 {
  return {
    version: 1,
    run: {
      id: RUN_ID,
      scenarioId: "C01",
      status: "COMPLETED",
      outcome: "FAIL",
      faultType: "REPLAY_EVENT",
      dataClassification: "RECORDED_TEST_EVIDENCE",
      orderId: ORDER_ID,
      paymentAttemptId: PAYMENT_ATTEMPT_ID,
      paymentId: PAYMENT_ID,
      sourceWebhookEventId: WEBHOOK_ID,
      failedPrecheckId: null,
      executionBlockCode: null,
      startedAt: "2026-08-01T10:00:00.000Z",
      completedAt: "2026-08-01T10:05:00.000Z",
    },
    requiredInvariantIds: ["INV-001", "INV-002", "INV-006", "INV-007"],
    sourceWebhook: realWebhook(),
    originalProcessingAttempts: [attempt({ id: ORIGINAL_ATTEMPT_ID })],
    chaosProcessingAttempts: [
      attempt({
        id: REPLAY_ATTEMPT_A,
        chaosRunId: RUN_ID,
        sourceKind: "PAYCHAOS_REPLAY",
        startedAt: "2026-08-01T10:01:00.000Z",
      }),
      attempt({
        id: REPLAY_ATTEMPT_B,
        chaosRunId: RUN_ID,
        sourceKind: "PAYCHAOS_REPLAY",
        startedAt: "2026-08-01T10:02:00.000Z",
      }),
    ],
    canonicalSourceEventCount: 1,
    authoritativeCapture: { kind: "EXACTLY_ONE", webhook: realWebhook() },
    authoritativeCaptureWebhook: realWebhook(),
    scenarioEvidence: {
      scenarioId: "C01",
      expectedReplayAttemptCount: 2,
      observedReplayAttemptCount: 2,
      chaosLinkedProcessingAttemptCount: 2,
      originalProcessingAttemptCount: 1,
      authoritativeOriginalProcessingAttemptId: ORIGINAL_ATTEMPT_ID,
    },
    evidenceRefs: [{ kind: "CHAOS_RUN", id: RUN_ID }],
    gaps: [],
    ...overrides,
  };
}

function c03Bundle(): ChaosRunEvidenceBundleV1 {
  return {
    version: 1,
    run: {
      id: RUN_ID,
      scenarioId: "C03",
      status: "COMPLETED",
      outcome: "FAIL",
      faultType: "INVALID_SIGNATURE_TEST",
      dataClassification: "SYNTHETIC_DEMO",
      orderId: null,
      paymentAttemptId: null,
      paymentId: null,
      sourceWebhookEventId: null,
      failedPrecheckId: null,
      executionBlockCode: null,
      startedAt: "2026-08-01T12:00:00.000Z",
      completedAt: "2026-08-01T12:00:10.000Z",
    },
    requiredInvariantIds: ["INV-004", "INV-005"],
    sourceWebhook: null,
    originalProcessingAttempts: [],
    chaosProcessingAttempts: [],
    canonicalSourceEventCount: null,
    authoritativeCapture: { kind: "NO_SUBJECT" },
    authoritativeCaptureWebhook: null,
    scenarioEvidence: {
      scenarioId: "C03",
      verificationChecks: [
        { case: "WRONG_SIGNATURE", classification: "UNEXPECTED_ACCEPTANCE" },
        { case: "MISSING_SIGNATURE", classification: "REJECTED" },
      ],
      sourceWebhookLinked: false,
      orderLinked: false,
      paymentAttemptLinked: false,
      paymentLinked: false,
      chaosLinkedProcessingAttemptCount: 0,
      mutationEvidence: {
        before: {
          orders: { count: 1, rows: [], complete: false },
          paymentAttempts: null,
          payments: null,
          fulfilments: { count: 0, rows: [], complete: true },
          trustedWebhookEvents: { count: 16, ids: [], complete: false },
        },
        after: null,
      },
    },
    evidenceRefs: [{ kind: "CHAOS_RUN", id: RUN_ID }],
    gaps: [],
  };
}

function c07Bundle(): ChaosRunEvidenceBundleV1 {
  const base = c01Bundle();
  return {
    ...base,
    run: {
      ...base.run,
      scenarioId: "C07",
      faultType: "DROP_CLIENT_CONFIRMATION",
    },
    requiredInvariantIds: ["INV-002", "INV-004", "INV-011"],
    scenarioEvidence: {
      scenarioId: "C07",
      faultArmed: true,
      faultConsumed: true,
      expectedReplayAttemptCount: 0,
      observedReplayAttemptCount: 0,
      chaosLinkedProcessingAttemptCount: 0,
      originalProcessingAttemptCount: 1,
      authoritativeOriginalProcessingAttemptId: ORIGINAL_ATTEMPT_ID,
    },
  };
}

function c11Bundle(): ChaosRunEvidenceBundleV1 {
  const base = c01Bundle();
  return {
    ...base,
    run: { ...base.run, scenarioId: "C11", faultType: null },
    requiredInvariantIds: ["INV-003", "INV-004", "INV-011"],
    sourceWebhook: { ...realWebhook(), eventType: "payment.failed" },
    scenarioEvidence: {
      scenarioId: "C11",
      observedShape: "B_REPLAY",
      expectedReplayAttemptCount: 1,
      observedReplayAttemptCount: 1,
      chaosLinkedProcessingAttemptCount: 1,
      originalProcessingAttemptCount: 1,
      authoritativeOriginalProcessingAttemptId: ORIGINAL_ATTEMPT_ID,
      sourceEventTypeIsPaymentFailed: true,
    },
  };
}

function input(
  overrides?: Partial<EvidencePackBuildInputV1> & {
    readonly result?: InvariantResultValue;
  },
): EvidencePackBuildInputV1 {
  const detail = overrides?.finding ?? finding();
  return {
    finding: detail,
    invariantResult: overrides?.invariantResult ?? {
      id: detail.invariantResultId,
      result: overrides?.result ?? "FAIL",
    },
    chaosEvidence:
      overrides && "chaosEvidence" in overrides
        ? (overrides.chaosEvidence ?? null)
        : c01Bundle(),
  };
}

function gapCodes(pack: DiagnosisEvidencePackV1): readonly string[] {
  return pack.gaps.map((gap) => gap.code);
}

describe("Phase 4A-R1 — diagnosis evidence pack builder", () => {
  it("1: a valid FAIL finding with a compatible C01 bundle builds a deterministic pack", () => {
    const pack = buildDiagnosisEvidencePack(input());

    expect(pack.version).toBe(DIAGNOSIS_EVIDENCE_PACK_VERSION);
    expect(pack.finding.findingId).toBe(FINDING_ID);
    expect(pack.finding.invariantResultId).toBe(RESULT_ID);
    expect(pack.invariant.result).toBe("FAIL");
    expect(pack.invariant.invariantId).toBe("INV-002");
    expect(pack.invariant.severity).toBe("CRITICAL");
    expect(pack.invariant.expectedSummary).toBe("fulfilment count <= 1");
    expect(pack.invariant.observedSummary).toBe("fulfilment count = 2");
    expect(pack.scenario?.scenarioId).toBe("C01");
    expect(pack.counts).toEqual({
      canonicalSourceEventCount: 1,
      originalAttemptCount: 1,
      chaosAttemptCount: 2,
    });
    expect(pack.money).toEqual({ amountSubunits: 50000, currency: "INR" });

    const again = buildDiagnosisEvidencePack(input());
    expect(again).toEqual(pack);
  });

  it("2: a C03 pack retains the safe validated verification checks and merchant facts", () => {
    const detail = finding({
      correlations: { orderId: null, paymentAttemptId: null, paymentId: null },
      evidenceRefs: [{ kind: "CHAOS_RUN", id: RUN_ID }],
    });
    const pack = buildDiagnosisEvidencePack({
      finding: detail,
      invariantResult: { id: RESULT_ID, result: "FAIL" },
      chaosEvidence: c03Bundle(),
    });

    const scenarioEvidence = pack.scenarioEvidence;
    expect(scenarioEvidence?.scenarioId).toBe("C03");
    if (scenarioEvidence?.scenarioId !== "C03") throw new Error("expected C03");

    expect(scenarioEvidence.verificationChecks).toEqual([
      { case: "WRONG_SIGNATURE", classification: "UNEXPECTED_ACCEPTANCE" },
      { case: "MISSING_SIGNATURE", classification: "REJECTED" },
    ]);
    expect(scenarioEvidence.sourceWebhookLinked).toBe(false);
    expect(scenarioEvidence.orderLinked).toBe(false);
    expect(scenarioEvidence.merchantFacts?.before?.orders).toEqual({
      count: 1,
      rows: [],
      complete: false,
    });
    // A truncated prefix stays truthfully truncated, and an unread table stays
    // null rather than becoming an empty collection.
    expect(scenarioEvidence.merchantFacts?.before?.paymentAttempts).toBeNull();
    expect(scenarioEvidence.merchantFacts?.after).toBeNull();
    // The builder states facts only; it never compares before against after.
    expect(Object.keys(scenarioEvidence)).not.toContain("mutated");
  });

  it("3: a C07 pack preserves the validated client-confirmation-loss facts", () => {
    const pack = buildDiagnosisEvidencePack({
      finding: finding(),
      invariantResult: { id: RESULT_ID, result: "FAIL" },
      chaosEvidence: c07Bundle(),
    });

    const evidence = pack.scenarioEvidence;
    if (evidence?.scenarioId !== "C07") throw new Error("expected C07");
    expect(evidence.faultArmed).toBe(true);
    expect(evidence.faultConsumed).toBe(true);
    expect(evidence.authoritativeOriginalProcessingAttemptId).toBe(
      ORIGINAL_ATTEMPT_ID,
    );
    expect(gapCodes(pack)).not.toContain("C07_FAULT_FACTS_UNAVAILABLE");
  });

  it("4: a C11 pack preserves the validated observation-shape facts", () => {
    const pack = buildDiagnosisEvidencePack({
      finding: finding(),
      invariantResult: { id: RESULT_ID, result: "FAIL" },
      chaosEvidence: c11Bundle(),
    });

    const evidence = pack.scenarioEvidence;
    if (evidence?.scenarioId !== "C11") throw new Error("expected C11");
    expect(evidence.observedShape).toBe("B_REPLAY");
    expect(evidence.expectedReplayAttemptCount).toBe(1);
    expect(evidence.sourceEventTypeIsPaymentFailed).toBe(true);
    expect(pack.provenance?.eventType).toBe("payment.failed");
  });

  it("5: a PASS result is rejected", () => {
    expect(() => buildDiagnosisEvidencePack(input({ result: "PASS" }))).toThrow(
      EvidencePackError,
    );
    try {
      buildDiagnosisEvidencePack(input({ result: "PASS" }));
    } catch (error) {
      expect((error as EvidencePackError).code).toBe(
        "EVIDENCE_PACK_SOURCE_NOT_FAIL",
      );
    }
  });

  it("6: an UNKNOWN result is rejected and never upgraded to a diagnosis input", () => {
    try {
      buildDiagnosisEvidencePack(input({ result: "UNKNOWN" }));
      throw new Error("expected a rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(EvidencePackError);
      expect((error as EvidencePackError).code).toBe(
        "EVIDENCE_PACK_SOURCE_NOT_FAIL",
      );
    }
  });

  it("7: an invariant-result identity mismatch is rejected", () => {
    try {
      buildDiagnosisEvidencePack({
        finding: finding(),
        invariantResult: { id: OTHER_RESULT_ID, result: "FAIL" },
        chaosEvidence: c01Bundle(),
      });
      throw new Error("expected a rejection");
    } catch (error) {
      expect((error as EvidencePackError).code).toBe(
        "EVIDENCE_PACK_INVARIANT_RESULT_MISMATCH",
      );
    }
  });

  it("8: chaos evidence from a different run is rejected rather than combined", () => {
    const foreign = c01Bundle();
    const mismatched: ChaosRunEvidenceBundleV1 = {
      ...foreign,
      run: { ...foreign.run, id: OTHER_RUN_ID },
    };
    try {
      buildDiagnosisEvidencePack({
        finding: finding(),
        invariantResult: { id: RESULT_ID, result: "FAIL" },
        chaosEvidence: mismatched,
      });
      throw new Error("expected a rejection");
    } catch (error) {
      expect((error as EvidencePackError).code).toBe(
        "EVIDENCE_PACK_CHAOS_RUN_MISMATCH",
      );
    }
  });

  it("9: a null chaos correlation is represented honestly with no invented context", () => {
    const pack = buildDiagnosisEvidencePack({
      finding: finding({ correlations: { chaosRunId: null } }),
      invariantResult: { id: RESULT_ID, result: "FAIL" },
      chaosEvidence: null,
    });

    expect(pack.correlations.chaosRunId).toBeNull();
    expect(pack.scenario).toBeNull();
    expect(pack.provenance).toBeNull();
    expect(pack.scenarioEvidence).toBeNull();
    expect(pack.counts).toBeNull();
    expect(pack.processing).toEqual([]);
    expect(gapCodes(pack)).toContain("NO_CHAOS_RUN_CORRELATION");
    // Absence must never be reported as an observed zero.
    expect(pack.counts).not.toEqual({
      canonicalSourceEventCount: 0,
      originalAttemptCount: 0,
      chaosAttemptCount: 0,
    });
  });

  it("10: a chaos correlation with no supplied bundle produces an explicit gap", () => {
    const pack = buildDiagnosisEvidencePack({
      finding: finding(),
      invariantResult: { id: RESULT_ID, result: "FAIL" },
      chaosEvidence: null,
    });

    expect(pack.correlations.chaosRunId).toBe(RUN_ID);
    expect(pack.scenario).toBeNull();
    expect(gapCodes(pack)).toContain("CHAOS_EVIDENCE_UNAVAILABLE");
    expect(
      pack.gaps.find((gap) => gap.code === "CHAOS_EVIDENCE_UNAVAILABLE")
        ?.subjectId,
    ).toBe(RUN_ID);
    // Evidence refs survive even when the bundle does not.
    expect(pack.evidenceRefs).toHaveLength(2);
  });

  it("11: a missing source webhook never fabricates provenance", () => {
    const base = c01Bundle();
    const pack = buildDiagnosisEvidencePack({
      finding: finding(),
      invariantResult: { id: RESULT_ID, result: "FAIL" },
      chaosEvidence: { ...base, sourceWebhook: null },
    });

    expect(pack.provenance).toBeNull();
    expect(pack.money).toBeNull();
    expect(gapCodes(pack)).toContain("SOURCE_WEBHOOK_UNAVAILABLE");
    expect(gapCodes(pack)).toContain("MONEY_CONTEXT_UNAVAILABLE");
    // The rest of the run is still reported truthfully.
    expect(pack.scenario?.scenarioId).toBe("C01");
    expect(pack.counts?.chaosAttemptCount).toBe(2);
  });

  it("12: C03 with null order/payment correlations remains a valid pack", () => {
    const pack = buildDiagnosisEvidencePack({
      finding: finding({
        correlations: {
          orderId: null,
          paymentAttemptId: null,
          paymentId: null,
        },
        evidenceRefs: [{ kind: "CHAOS_RUN", id: RUN_ID }],
      }),
      invariantResult: { id: RESULT_ID, result: "FAIL" },
      chaosEvidence: c03Bundle(),
    });

    expect(pack.correlations.orderId).toBeNull();
    expect(pack.correlations.paymentAttemptId).toBeNull();
    expect(pack.correlations.paymentId).toBeNull();
    expect(pack.correlations.chaosRunId).toBe(RUN_ID);
    expect(pack.scenario?.dataClassification).toBe("SYNTHETIC_DEMO");
    expect(pack.scenarioEvidence?.scenarioId).toBe("C03");
  });

  it("13: persisted evidence references are preserved verbatim", () => {
    const refs = [
      { kind: "CHAOS_RUN", id: RUN_ID },
      { kind: "EVENT_PROCESSING_ATTEMPT", id: REPLAY_ATTEMPT_A },
      { kind: "FULFILMENT", id: FULFILMENT_ID },
    ];
    const pack = buildDiagnosisEvidencePack({
      finding: finding({ evidenceRefs: refs }),
      invariantResult: { id: RESULT_ID, result: "FAIL" },
      chaosEvidence: c01Bundle(),
    });

    expect(pack.evidenceRefs).toEqual(refs);
  });

  it("14: the persisted EVENT_PROCESSING_ATTEMPT spelling is preserved", () => {
    const pack = buildDiagnosisEvidencePack(input());
    const kinds = pack.evidenceRefs.map((ref) => ref.kind);
    expect(kinds).toContain("EVENT_PROCESSING_ATTEMPT");
  });

  it("15: the bundle-internal PROCESSING_ATTEMPT spelling never leaks into evidence refs", () => {
    const bundle = c01Bundle();
    const withBundleSpelling: ChaosRunEvidenceBundleV1 = {
      ...bundle,
      // The frozen bundle legitimately uses the shorter historical spelling
      // for its own internal list. It must never reach the persisted refs.
      evidenceRefs: [
        { kind: "PROCESSING_ATTEMPT", id: REPLAY_ATTEMPT_A },
        { kind: "CHAOS_RUN", id: RUN_ID },
      ],
    };
    const pack = buildDiagnosisEvidencePack({
      finding: finding(),
      invariantResult: { id: RESULT_ID, result: "FAIL" },
      chaosEvidence: withBundleSpelling,
    });

    const kinds = pack.evidenceRefs.map((ref) => ref.kind);
    expect(kinds).not.toContain("PROCESSING_ATTEMPT");
    expect(kinds).toContain("EVENT_PROCESSING_ATTEMPT");
    // Processing facts carry no evidence-kind string at all, so neither
    // vocabulary can be emitted in the other's place.
    for (const entry of pack.processing) {
      expect(Object.keys(entry)).not.toContain("kind");
    }
  });

  it("16: duplicate gaps are deterministically deduplicated", () => {
    const base = c01Bundle();
    const refs = [
      { kind: "ORDER", id: UNKNOWN_REF_ID },
      { kind: "PAYMENT", id: UNKNOWN_REF_ID },
    ];
    const pack = buildDiagnosisEvidencePack({
      finding: finding({ evidenceRefs: refs }),
      invariantResult: { id: RESULT_ID, result: "FAIL" },
      chaosEvidence: base,
    });

    const unresolved = pack.gaps.filter(
      (gap) => gap.code === "EVIDENCE_REF_UNRESOLVED",
    );
    // Two refs, one unknown id — a single deduplicated gap.
    expect(unresolved).toEqual([
      { code: "EVIDENCE_REF_UNRESOLVED", subjectId: UNKNOWN_REF_ID },
    ]);
  });

  it("17: gap ordering is deterministic and total", () => {
    const pack = buildDiagnosisEvidencePack({
      finding: finding({ correlations: { chaosRunId: null } }),
      invariantResult: { id: RESULT_ID, result: "FAIL" },
      chaosEvidence: null,
    });

    expect(gapCodes(pack)).toEqual([
      "NO_CHAOS_RUN_CORRELATION",
      "SCENARIO_CONTEXT_UNAVAILABLE",
      "MONEY_CONTEXT_UNAVAILABLE",
      "CAPTURE_CONTEXT_UNAVAILABLE",
    ]);
  });

  it("18: processing attempts are ordered deterministically", () => {
    const pack = buildDiagnosisEvidencePack(input());

    expect(pack.processing.map((entry) => entry.attemptId)).toEqual([
      ORIGINAL_ATTEMPT_ID,
      REPLAY_ATTEMPT_A,
      REPLAY_ATTEMPT_B,
    ]);
    expect(pack.processing.map((entry) => entry.role)).toEqual([
      "ORIGINAL",
      "CHAOS",
      "CHAOS",
    ]);
  });

  it("19: the same evidence supplied in a different array order produces identical output", () => {
    const forward = c01Bundle();
    const reversed: ChaosRunEvidenceBundleV1 = {
      ...forward,
      chaosProcessingAttempts: [...forward.chaosProcessingAttempts].reverse(),
    };

    const a = buildDiagnosisEvidencePack({
      finding: finding(),
      invariantResult: { id: RESULT_ID, result: "FAIL" },
      chaosEvidence: forward,
    });
    const b = buildDiagnosisEvidencePack({
      finding: finding(),
      invariantResult: { id: RESULT_ID, result: "FAIL" },
      chaosEvidence: reversed,
    });

    expect(b).toEqual(a);
  });

  it("20: NOT_CAPTURED remains NOT_CAPTURED", () => {
    const pack = buildDiagnosisEvidencePack(input());
    for (const entry of pack.processing) {
      expect(entry.stateBefore).toEqual({ kind: "NOT_CAPTURED" });
      expect(entry.stateAfter).toEqual({ kind: "NOT_CAPTURED" });
    }
  });

  it("21: INVALID remains INVALID", () => {
    const base = c01Bundle();
    const withInvalid: ChaosRunEvidenceBundleV1 = {
      ...base,
      chaosProcessingAttempts: [
        attempt({
          id: REPLAY_ATTEMPT_A,
          chaosRunId: RUN_ID,
          sourceKind: "PAYCHAOS_REPLAY",
          stateBefore: { kind: "INVALID" },
          stateAfter: { kind: "NOT_CAPTURED" },
        }),
      ],
    };
    const pack = buildDiagnosisEvidencePack({
      finding: finding(),
      invariantResult: { id: RESULT_ID, result: "FAIL" },
      chaosEvidence: withInvalid,
    });

    const replay = pack.processing.find(
      (entry) => entry.attemptId === REPLAY_ATTEMPT_A,
    );
    expect(replay?.stateBefore).toEqual({ kind: "INVALID" });
    expect(replay?.stateAfter).toEqual({ kind: "NOT_CAPTURED" });
  });

  it("22: a missing historical snapshot is never reconstructed from later state", () => {
    const base = c01Bundle();
    const captured = attempt({
      id: ORIGINAL_ATTEMPT_ID,
      stateAfter: {
        kind: "CAPTURED",
        snapshot: {
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
              id: FULFILMENT_ID,
              orderId: ORDER_ID,
              paymentId: PAYMENT_ID,
              triggerProcessingAttemptId: ORIGINAL_ATTEMPT_ID,
              effectType: "FULFIL_ORDER",
              appliedAt: "2026-08-01T10:00:02.000Z",
            },
          ],
        },
      },
    });

    const pack = buildDiagnosisEvidencePack({
      finding: finding(),
      invariantResult: { id: RESULT_ID, result: "FAIL" },
      chaosEvidence: { ...base, originalProcessingAttempts: [captured] },
    });

    const original = pack.processing.find(
      (entry) => entry.attemptId === ORIGINAL_ATTEMPT_ID,
    );
    // The "after" side was captured; the "before" side was not, and stays
    // absent rather than being back-filled from the later snapshot.
    expect(original?.stateAfter.kind).toBe("CAPTURED");
    expect(original?.stateBefore).toEqual({ kind: "NOT_CAPTURED" });
  });

  it("23: SYNTHETIC_DEMO classification is preserved", () => {
    const pack = buildDiagnosisEvidencePack({
      finding: finding({
        correlations: {
          orderId: null,
          paymentAttemptId: null,
          paymentId: null,
        },
        evidenceRefs: [{ kind: "CHAOS_RUN", id: RUN_ID }],
      }),
      invariantResult: { id: RESULT_ID, result: "FAIL" },
      chaosEvidence: c03Bundle(),
    });
    expect(pack.scenario?.dataClassification).toBe("SYNTHETIC_DEMO");
  });

  it("24: RECORDED_TEST_EVIDENCE classification is preserved", () => {
    const pack = buildDiagnosisEvidencePack(input());
    expect(pack.scenario?.dataClassification).toBe("RECORDED_TEST_EVIDENCE");
  });

  it("25: REAL_RAZORPAY_WEBHOOK provenance is preserved", () => {
    const pack = buildDiagnosisEvidencePack(input());
    expect(pack.provenance?.sourceKind).toBe("REAL_RAZORPAY_WEBHOOK");
    expect(pack.provenance?.signatureVerified).toBe(true);

    const original = pack.processing.find(
      (entry) => entry.attemptId === ORIGINAL_ATTEMPT_ID,
    );
    expect(original?.sourceKind).toBe("REAL_RAZORPAY_WEBHOOK");
  });

  it("26: PAYCHAOS_REPLAY provenance is preserved on replay attempts", () => {
    const pack = buildDiagnosisEvidencePack(input());
    const replays = pack.processing.filter((entry) => entry.role === "CHAOS");
    expect(replays).toHaveLength(2);
    for (const replay of replays) {
      expect(replay.sourceKind).toBe("PAYCHAOS_REPLAY");
    }
  });

  it("27: a replay is never relabelled as a new provider delivery", () => {
    const pack = buildDiagnosisEvidencePack(input());

    // The single real source event and the two replays stay on separate axes:
    // one real canonical webhook, two PayChaos replay processing attempts.
    expect(pack.counts?.canonicalSourceEventCount).toBe(1);
    expect(pack.provenance?.sourceKind).toBe("REAL_RAZORPAY_WEBHOOK");
    for (const replay of pack.processing.filter((e) => e.role === "CHAOS")) {
      expect(replay.sourceKind).not.toBe("REAL_RAZORPAY_WEBHOOK");
    }
  });

  it("28: the pack exposes no diagnosis fields", () => {
    const pack = buildDiagnosisEvidencePack(input());
    const serialized = JSON.stringify(pack);
    for (const forbidden of [
      "diagnosisCode",
      "diagnosis_code",
      "diagnosisStrength",
      "diagnosis_strength",
      "diagnosisSummary",
      "rootCause",
      "STRONG_EVIDENCE",
      "PARTIAL_EVIDENCE",
      "INSUFFICIENT_EVIDENCE",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("29: the pack exposes no recommendation fields", () => {
    const pack = buildDiagnosisEvidencePack(input());
    const serialized = JSON.stringify(pack);
    for (const forbidden of [
      "recommendationCode",
      "recommendation_code",
      "recommendationText",
      "FIX-IDEMPOTENCY",
      "FIX-BUSINESS-IDEMPOTENCY",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("30: the pack exposes no score or readiness fields", () => {
    const pack = buildDiagnosisEvidencePack(input());
    const serialized = JSON.stringify(pack);
    for (const forbidden of [
      "reliabilityScore",
      "readiness",
      "goLive",
      "NOT READY",
      "NEEDS ATTENTION",
      "RELIABILITY-V1",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("31: the supplied finding and bundle are not mutated", () => {
    const detail = finding();
    const bundle = c01Bundle();
    const findingSnapshot = JSON.stringify(detail);
    const bundleSnapshot = JSON.stringify(bundle);
    const refsBefore = detail.invariant.evidenceRefs;
    const chaosAttemptsBefore = bundle.chaosProcessingAttempts;

    buildDiagnosisEvidencePack({
      finding: detail,
      invariantResult: { id: RESULT_ID, result: "FAIL" },
      chaosEvidence: bundle,
    });

    expect(JSON.stringify(detail)).toBe(findingSnapshot);
    expect(JSON.stringify(bundle)).toBe(bundleSnapshot);
    // Caller-owned arrays are never sorted in place.
    expect(detail.invariant.evidenceRefs).toBe(refsBefore);
    expect(bundle.chaosProcessingAttempts).toBe(chaosAttemptsBefore);
  });

  it("32: an unresolvable evidence reference is preserved rather than dropped", () => {
    const refs = [
      { kind: "CHAOS_RUN", id: RUN_ID },
      { kind: "FULFILMENT", id: UNKNOWN_REF_ID },
    ];
    const pack = buildDiagnosisEvidencePack({
      finding: finding({ evidenceRefs: refs }),
      invariantResult: { id: RESULT_ID, result: "FAIL" },
      chaosEvidence: c01Bundle(),
    });

    expect(pack.evidenceRefs).toEqual(refs);
    expect(pack.gaps).toContainEqual({
      code: "EVIDENCE_REF_UNRESOLVED",
      subjectId: UNKNOWN_REF_ID,
    });
  });

  it("33: a structurally unusable input is rejected with a stable code", () => {
    try {
      buildDiagnosisEvidencePack(null as unknown as EvidencePackBuildInputV1);
      throw new Error("expected a rejection");
    } catch (error) {
      expect((error as EvidencePackError).code).toBe(
        "EVIDENCE_PACK_INPUT_INVALID",
      );
    }
  });

  it("34: an ambiguous capture resolution reports candidates without naming a winner", () => {
    const base = c01Bundle();
    const pack = buildDiagnosisEvidencePack({
      finding: finding(),
      invariantResult: { id: RESULT_ID, result: "FAIL" },
      chaosEvidence: {
        ...base,
        authoritativeCapture: {
          kind: "AMBIGUOUS",
          candidates: [realWebhook(), { ...realWebhook(), id: OTHER_RUN_ID }],
        },
        authoritativeCaptureWebhook: null,
      },
    });

    expect(pack.capture?.resolution).toBe("AMBIGUOUS");
    expect(pack.capture?.candidateCount).toBe(2);
    expect(pack.capture?.webhook).toBeNull();
  });

  it("35: a negative capture resolution is preserved and never softened", () => {
    const base = c01Bundle();
    for (const kind of [
      "NO_SUBJECT",
      "AMBIGUOUS_SUBJECT",
      "SEARCH_INCOMPLETE",
      "NONE_OBSERVED",
    ] as const) {
      const pack = buildDiagnosisEvidencePack({
        finding: finding(),
        invariantResult: { id: RESULT_ID, result: "FAIL" },
        chaosEvidence: {
          ...base,
          authoritativeCapture: { kind },
          authoritativeCaptureWebhook: null,
        },
      });
      expect(pack.capture?.resolution).toBe(kind);
      expect(pack.capture?.webhook).toBeNull();
    }
  });

  it("36: a C03 run with unavailable validated facts reports gaps instead of guesses", () => {
    const base = c03Bundle();
    const pack = buildDiagnosisEvidencePack({
      finding: finding({
        correlations: {
          orderId: null,
          paymentAttemptId: null,
          paymentId: null,
        },
        evidenceRefs: [{ kind: "CHAOS_RUN", id: RUN_ID }],
      }),
      invariantResult: { id: RESULT_ID, result: "FAIL" },
      chaosEvidence: {
        ...base,
        scenarioEvidence: {
          scenarioId: "C03",
          verificationChecks: null,
          sourceWebhookLinked: false,
          orderLinked: false,
          paymentAttemptLinked: false,
          paymentLinked: false,
          chaosLinkedProcessingAttemptCount: 0,
          mutationEvidence: null,
        },
      },
    });

    const evidence = pack.scenarioEvidence;
    if (evidence?.scenarioId !== "C03") throw new Error("expected C03");
    expect(evidence.verificationChecks).toBeNull();
    expect(evidence.merchantFacts).toBeNull();
    expect(gapCodes(pack)).toContain("C03_VERIFICATION_CHECKS_UNAVAILABLE");
    expect(gapCodes(pack)).toContain("C03_MUTATION_FACTS_UNAVAILABLE");
  });

  it("37: money values stay integer subunits and a null is never defaulted", () => {
    const base = c01Bundle();
    const pack = buildDiagnosisEvidencePack({
      finding: finding(),
      invariantResult: { id: RESULT_ID, result: "FAIL" },
      chaosEvidence: {
        ...base,
        sourceWebhook: {
          ...realWebhook(),
          amountSubunits: null,
          currency: null,
        },
      },
    });

    expect(pack.money).toEqual({ amountSubunits: null, currency: null });
    expect(pack.money?.amountSubunits).not.toBe(0);
    expect(pack.money?.currency).not.toBe("INR");
    expect(gapCodes(pack)).toContain("MONEY_CONTEXT_UNAVAILABLE");
  });

  // --------------------------------------------------------------------
  // Evidence-reference resolution.
  //
  // A correlation is not evidence. These pin the rule that a reference is
  // resolved only by an actual supplied projection of the entity it names.
  // --------------------------------------------------------------------

  it("R1: an ORDER correlation on the finding does not resolve an ORDER reference", () => {
    const refs = [{ kind: "ORDER", id: ORDER_ID }];
    const pack = buildDiagnosisEvidencePack({
      // The finding genuinely correlates to this order...
      finding: finding({ evidenceRefs: refs }),
      invariantResult: { id: RESULT_ID, result: "FAIL" },
      // ...but the bundle carries no CAPTURED snapshot of it.
      chaosEvidence: c01Bundle(),
    });

    expect(pack.correlations.orderId).toBe(ORDER_ID);
    expect(pack.evidenceRefs).toEqual(refs);
    expect(pack.gaps).toContainEqual({
      code: "EVIDENCE_REF_UNRESOLVED",
      subjectId: ORDER_ID,
    });
  });

  it("R2: a PAYMENT correlation does not resolve a PAYMENT reference without evidence", () => {
    const base = c01Bundle();
    const refs = [{ kind: "PAYMENT", id: PAYMENT_ID }];
    const pack = buildDiagnosisEvidencePack({
      finding: finding({ evidenceRefs: refs }),
      invariantResult: { id: RESULT_ID, result: "FAIL" },
      chaosEvidence: {
        ...base,
        // No attempt carries the payment correlation and no snapshot is captured.
        originalProcessingAttempts: [
          attempt({
            id: ORIGINAL_ATTEMPT_ID,
            paymentId: null,
            paymentAttemptId: null,
          }),
        ],
        chaosProcessingAttempts: [],
      },
    });

    expect(pack.correlations.paymentId).toBe(PAYMENT_ID);
    expect(pack.evidenceRefs).toEqual(refs);
    expect(pack.gaps).toContainEqual({
      code: "EVIDENCE_REF_UNRESOLVED",
      subjectId: PAYMENT_ID,
    });
  });

  it("R3: a PAYMENT_ATTEMPT correlation does not resolve a reference without evidence", () => {
    const base = c01Bundle();
    const refs = [{ kind: "PAYMENT_ATTEMPT", id: PAYMENT_ATTEMPT_ID }];
    const pack = buildDiagnosisEvidencePack({
      finding: finding({ evidenceRefs: refs }),
      invariantResult: { id: RESULT_ID, result: "FAIL" },
      chaosEvidence: {
        ...base,
        originalProcessingAttempts: [
          attempt({
            id: ORIGINAL_ATTEMPT_ID,
            paymentAttemptId: null,
            paymentId: null,
          }),
        ],
        chaosProcessingAttempts: [],
      },
    });

    expect(pack.correlations.paymentAttemptId).toBe(PAYMENT_ATTEMPT_ID);
    expect(pack.gaps).toContainEqual({
      code: "EVIDENCE_REF_UNRESOLVED",
      subjectId: PAYMENT_ATTEMPT_ID,
    });
  });

  it("R4: a real CAPTURED snapshot resolves order, payment attempt and payment references", () => {
    const base = c01Bundle();
    const captured = attempt({
      id: ORIGINAL_ATTEMPT_ID,
      paymentAttemptId: null,
      paymentId: null,
      stateAfter: {
        kind: "CAPTURED",
        snapshot: {
          version: 1,
          order: {
            id: ORDER_ID,
            paymentStatus: "PAID",
            businessStatus: "FULFILLED",
            amountSubunits: 50000,
            currency: "INR",
          },
          paymentAttempt: {
            id: PAYMENT_ATTEMPT_ID,
            orderId: ORDER_ID,
            status: "CAPTURED",
            amountSubunits: 50000,
            currency: "INR",
            razorpayOrderId: "order_test_0001",
            razorpayOrderStatus: "paid",
          },
          payment: {
            id: PAYMENT_ID,
            paymentAttemptId: PAYMENT_ATTEMPT_ID,
            razorpayPaymentId: "pay_test_0001",
            razorpayPaymentStatus: "captured",
            amountSubunits: 50000,
            currency: "INR",
            checkoutSignatureVerified: true,
            capturedAt: "2026-08-01T10:00:02.000Z",
            failedAt: null,
          },
          fulfilments: [],
        },
      },
    });

    const refs = [
      { kind: "ORDER", id: ORDER_ID },
      { kind: "PAYMENT_ATTEMPT", id: PAYMENT_ATTEMPT_ID },
      { kind: "PAYMENT", id: PAYMENT_ID },
    ];
    const pack = buildDiagnosisEvidencePack({
      finding: finding({ evidenceRefs: refs }),
      invariantResult: { id: RESULT_ID, result: "FAIL" },
      chaosEvidence: {
        ...base,
        originalProcessingAttempts: [captured],
        chaosProcessingAttempts: [],
      },
    });

    expect(pack.evidenceRefs).toEqual(refs);
    const unresolved = pack.gaps
      .filter((gap) => gap.code === "EVIDENCE_REF_UNRESOLVED")
      .map((gap) => gap.subjectId);
    expect(unresolved).not.toContain(ORDER_ID);
    expect(unresolved).not.toContain(PAYMENT_ATTEMPT_ID);
    expect(unresolved).not.toContain(PAYMENT_ID);
  });

  it("R5: a FULFILMENT reference resolves only from an actual snapshot fulfilment row", () => {
    const base = c01Bundle();
    const refs = [{ kind: "FULFILMENT", id: FULFILMENT_ID }];

    const withoutRow = buildDiagnosisEvidencePack({
      finding: finding({ evidenceRefs: refs }),
      invariantResult: { id: RESULT_ID, result: "FAIL" },
      chaosEvidence: base,
    });
    expect(withoutRow.gaps).toContainEqual({
      code: "EVIDENCE_REF_UNRESOLVED",
      subjectId: FULFILMENT_ID,
    });

    const captured = attempt({
      id: ORIGINAL_ATTEMPT_ID,
      stateAfter: {
        kind: "CAPTURED",
        snapshot: {
          version: 1,
          order: null,
          paymentAttempt: null,
          payment: null,
          fulfilments: [
            {
              id: FULFILMENT_ID,
              orderId: ORDER_ID,
              paymentId: PAYMENT_ID,
              triggerProcessingAttemptId: ORIGINAL_ATTEMPT_ID,
              effectType: "FULFIL_ORDER",
              appliedAt: "2026-08-01T10:00:02.000Z",
            },
          ],
        },
      },
    });
    const withRow = buildDiagnosisEvidencePack({
      finding: finding({ evidenceRefs: refs }),
      invariantResult: { id: RESULT_ID, result: "FAIL" },
      chaosEvidence: {
        ...base,
        originalProcessingAttempts: [captured],
        chaosProcessingAttempts: [],
      },
    });
    expect(
      withRow.gaps.filter((gap) => gap.code === "EVIDENCE_REF_UNRESOLVED"),
    ).toEqual([]);
  });

  it("R6: an EVENT_PROCESSING_ATTEMPT reference resolves from an actual attempt id", () => {
    const resolved = buildDiagnosisEvidencePack({
      finding: finding({
        evidenceRefs: [
          { kind: "EVENT_PROCESSING_ATTEMPT", id: REPLAY_ATTEMPT_A },
        ],
      }),
      invariantResult: { id: RESULT_ID, result: "FAIL" },
      chaosEvidence: c01Bundle(),
    });
    expect(
      resolved.gaps.filter((gap) => gap.code === "EVIDENCE_REF_UNRESOLVED"),
    ).toEqual([]);

    const unresolved = buildDiagnosisEvidencePack({
      finding: finding({
        evidenceRefs: [
          { kind: "EVENT_PROCESSING_ATTEMPT", id: UNKNOWN_REF_ID },
        ],
      }),
      invariantResult: { id: RESULT_ID, result: "FAIL" },
      chaosEvidence: c01Bundle(),
    });
    expect(unresolved.gaps).toContainEqual({
      code: "EVIDENCE_REF_UNRESOLVED",
      subjectId: UNKNOWN_REF_ID,
    });
  });

  it("R7: a WEBHOOK_EVENT reference needs a real projection, not a run pointer", () => {
    const base = c01Bundle();
    const refs = [{ kind: "WEBHOOK_EVENT", id: WEBHOOK_ID }];

    // The run still points at the webhook, but no safe projection was loaded.
    const pointerOnly = buildDiagnosisEvidencePack({
      finding: finding({ evidenceRefs: refs }),
      invariantResult: { id: RESULT_ID, result: "FAIL" },
      chaosEvidence: {
        ...base,
        sourceWebhook: null,
        authoritativeCapture: { kind: "NO_SUBJECT" },
        authoritativeCaptureWebhook: null,
      },
    });
    expect(pointerOnly.scenario?.scenarioId).toBe("C01");
    expect(pointerOnly.gaps).toContainEqual({
      code: "EVIDENCE_REF_UNRESOLVED",
      subjectId: WEBHOOK_ID,
    });

    const withProjection = buildDiagnosisEvidencePack({
      finding: finding({ evidenceRefs: refs }),
      invariantResult: { id: RESULT_ID, result: "FAIL" },
      chaosEvidence: base,
    });
    expect(
      withProjection.gaps.filter(
        (gap) => gap.code === "EVIDENCE_REF_UNRESOLVED",
      ),
    ).toEqual([]);
  });

  it("R8: a CHAOS_RUN reference resolves from the supplied bundle, never from the correlation alone", () => {
    const refs = [{ kind: "CHAOS_RUN", id: RUN_ID }];

    const withBundle = buildDiagnosisEvidencePack({
      finding: finding({ evidenceRefs: refs }),
      invariantResult: { id: RESULT_ID, result: "FAIL" },
      chaosEvidence: c01Bundle(),
    });
    expect(
      withBundle.gaps.filter((gap) => gap.code === "EVIDENCE_REF_UNRESOLVED"),
    ).toEqual([]);

    // With no bundle the correlation alone proves nothing. Per-reference gaps
    // are deliberately suppressed here: the reason is identical for every
    // pointer and is already stated once at pack level.
    const withoutBundle = buildDiagnosisEvidencePack({
      finding: finding({ evidenceRefs: refs }),
      invariantResult: { id: RESULT_ID, result: "FAIL" },
      chaosEvidence: null,
    });
    expect(withoutBundle.evidenceRefs).toEqual(refs);
    expect(gapCodes(withoutBundle)).toContain("CHAOS_EVIDENCE_UNAVAILABLE");
    expect(
      withoutBundle.gaps.filter(
        (gap) => gap.code === "EVIDENCE_REF_UNRESOLVED",
      ),
    ).toEqual([]);
  });

  it("R9: evidence references are identical whether resolved or unresolved", () => {
    const refs = [
      { kind: "CHAOS_RUN", id: RUN_ID },
      { kind: "ORDER", id: ORDER_ID },
      { kind: "FULFILMENT", id: FULFILMENT_ID },
      { kind: "EVENT_PROCESSING_ATTEMPT", id: REPLAY_ATTEMPT_A },
    ];
    const original = refs.map((ref) => ({ ...ref }));

    const pack = buildDiagnosisEvidencePack({
      finding: finding({ evidenceRefs: refs }),
      invariantResult: { id: RESULT_ID, result: "FAIL" },
      chaosEvidence: c01Bundle(),
    });

    expect(pack.evidenceRefs).toEqual(original);
    // Some resolved, some not — the list itself is untouched either way.
    const unresolved = pack.gaps.filter(
      (gap) => gap.code === "EVIDENCE_REF_UNRESOLVED",
    );
    expect(unresolved.length).toBeGreaterThan(0);
    expect(pack.evidenceRefs).toHaveLength(4);
  });

  it("R10: an unapproved evidence kind is preserved and reported, never thrown on", () => {
    const refs = [{ kind: "INVARIANT_RESULT", id: RESULT_ID }];
    const pack = buildDiagnosisEvidencePack({
      finding: finding({ evidenceRefs: refs }),
      invariantResult: { id: RESULT_ID, result: "FAIL" },
      chaosEvidence: c01Bundle(),
    });

    // The invariant result is a first-class pack field, not an evidence kind.
    expect(pack.finding.invariantResultId).toBe(RESULT_ID);
    expect(pack.evidenceRefs).toEqual(refs);
    expect(pack.gaps).toContainEqual({
      code: "EVIDENCE_REF_UNRESOLVED",
      subjectId: RESULT_ID,
    });
  });

  it("R11: the seven approved persisted evidence kinds are the ones this pack resolves", () => {
    // The persisted vocabulary is enforced on write by the frozen
    // `canonicalizeEvidenceRefs`. It is pinned here because the pack keeps
    // `kind` as `string` rather than narrowing it at runtime.
    const approved = [
      "ORDER",
      "PAYMENT_ATTEMPT",
      "PAYMENT",
      "FULFILMENT",
      "WEBHOOK_EVENT",
      "EVENT_PROCESSING_ATTEMPT",
      "CHAOS_RUN",
    ] as const;

    const source = fs.readFileSync(
      path.join(import.meta.dirname, "../../../lib/diagnosis/evidence-pack.ts"),
      "utf-8",
    );
    for (const kind of approved) {
      expect(source, kind).toContain(`case "${kind}":`);
    }
    // The retired bundle-internal spelling is never a resolution case.
    expect(source).not.toContain('case "PROCESSING_ATTEMPT":');
    expect(source).not.toContain('case "INVARIANT_RESULT":');
  });

  it("38: chaos evidence supplied for a baseline finding is rejected", () => {
    try {
      buildDiagnosisEvidencePack({
        finding: finding({ correlations: { chaosRunId: null } }),
        invariantResult: { id: RESULT_ID, result: "FAIL" },
        chaosEvidence: c01Bundle(),
      });
      throw new Error("expected a rejection");
    } catch (error) {
      expect((error as EvidencePackError).code).toBe(
        "EVIDENCE_PACK_CHAOS_RUN_MISMATCH",
      );
    }
  });
});
