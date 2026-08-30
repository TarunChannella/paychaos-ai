import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChaosRunEvidenceBundleV1 } from "@/lib/evidence/chaos-run-evidence";
import type { FindingDetail } from "@/lib/findings/types";

/**
 * Phase 4A-R2 — the server-only Evidence Pack orchestration service.
 *
 * Mocks sit ONLY at the three server-read boundaries. The real R1 pure builder
 * runs unmocked, because the properties under test — the FAIL-only gate, the
 * gap vocabulary, provenance preservation — are exactly what it owns, and
 * stubbing it would prove nothing about the assembled result.
 *
 * No database, no network, no Supabase client.
 */

const findFindingById = vi.fn();
const findInvariantResultById = vi.fn();
const getFindingDetailByInvariantResultId = vi.fn();
const assembleChaosRunEvidence = vi.fn();

vi.mock("server-only", () => ({}));

vi.mock("@/lib/findings/repository", () => ({
  findFindingById: (...args: unknown[]) => findFindingById(...args),
  findInvariantResultById: (...args: unknown[]) =>
    findInvariantResultById(...args),
}));

vi.mock("@/lib/findings/service", () => ({
  getFindingDetailByInvariantResultId: (...args: unknown[]) =>
    getFindingDetailByInvariantResultId(...args),
}));

vi.mock("@/lib/evidence/chaos-evidence-service", () => ({
  assembleChaosRunEvidence: (...args: unknown[]) =>
    assembleChaosRunEvidence(...args),
}));

const { EvidencePackServiceError, assembleDiagnosisEvidencePackForFinding } =
  await import("@/lib/diagnosis/evidence-pack-service");
const { EvidencePackError } = await import("@/lib/diagnosis/evidence-pack");

const FINDING_ID = "55555555-5555-4555-8555-555555555555";
const RESULT_ID = "33333333-3333-4333-8333-333333333333";
const RUN_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_FINDING_ID = "66666666-6666-4666-8666-666666666666";
const WEBHOOK_ID = "77777777-7777-4777-8777-777777777777";
const REPLAY_ATTEMPT_ID = "88888888-8888-4888-8888-888888888888";

/** A frozen-shaped error carrying only a stable code, as the real modules do. */
class CodedError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

function findingRow(overrides?: { readonly id?: string }) {
  return {
    id: overrides?.id ?? FINDING_ID,
    invariantResultId: RESULT_ID,
    status: "OPEN" as const,
    title: "INV-005 — Invalid Webhook Signature Causes Zero Mutation",
    createdAt: "2026-08-01T11:00:00.000Z",
    updatedAt: "2026-08-01T11:00:00.000Z",
  };
}

function resultRow(result: string) {
  return {
    id: RESULT_ID,
    invariant_id: "INV-005",
    invariant_version: "1",
    order_id: null,
    payment_attempt_id: null,
    payment_id: null,
    chaos_run_id: RUN_ID,
    result,
    severity: "CRITICAL",
    expected_summary: "zero trusted mutation",
    observed_summary: "an intentionally invalid signature was accepted",
    reason: "UNEXPECTED_ACCEPTANCE on the wrong-signature check.",
    evidence_refs: [{ kind: "CHAOS_RUN", id: RUN_ID }],
    evaluated_at: "2026-08-01T10:30:00.000Z",
  };
}

function detail(overrides?: {
  readonly findingId?: string;
  readonly chaosRunId?: string | null;
}): FindingDetail {
  return {
    findingId: overrides?.findingId ?? FINDING_ID,
    invariantResultId: RESULT_ID,
    status: "OPEN",
    title: "INV-005 — Invalid Webhook Signature Causes Zero Mutation",
    createdAt: "2026-08-01T11:00:00.000Z",
    updatedAt: "2026-08-01T11:00:00.000Z",
    invariant: {
      invariantId: "INV-005",
      invariantVersion: "1",
      severity: "CRITICAL",
      expectedSummary: "zero trusted mutation",
      observedSummary: "an intentionally invalid signature was accepted",
      reason: "UNEXPECTED_ACCEPTANCE on the wrong-signature check.",
      evaluatedAt: "2026-08-01T10:30:00.000Z",
      evidenceRefs: [{ kind: "CHAOS_RUN", id: RUN_ID }],
    },
    correlations: {
      chaosRunId:
        overrides && "chaosRunId" in overrides ? overrides.chaosRunId! : RUN_ID,
      orderId: null,
      paymentAttemptId: null,
      paymentId: null,
    },
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

/** A C01-shaped bundle carrying real + replay provenance on separate axes. */
function c01Bundle(): ChaosRunEvidenceBundleV1 {
  const webhook = {
    id: WEBHOOK_ID,
    razorpayEventId: "evt_test_0001",
    eventType: "payment.captured",
    sourceKind: "REAL_RAZORPAY_WEBHOOK",
    signatureVerified: true,
    processingStatus: "PROCESSED",
    duplicateDeliveryCount: 0,
    receivedAt: "2026-08-01T10:00:00.000Z",
    paymentAttemptId: null,
    paymentId: null,
    razorpayPaymentId: "pay_test_0001",
    amountSubunits: 50000,
    currency: "INR",
  };
  return {
    ...c03Bundle(),
    run: {
      ...c03Bundle().run,
      scenarioId: "C01",
      faultType: "REPLAY_EVENT",
      dataClassification: "RECORDED_TEST_EVIDENCE",
      sourceWebhookEventId: WEBHOOK_ID,
    },
    requiredInvariantIds: ["INV-001", "INV-002", "INV-006", "INV-007"],
    sourceWebhook: webhook,
    chaosProcessingAttempts: [
      {
        id: REPLAY_ATTEMPT_ID,
        webhookEventId: WEBHOOK_ID,
        chaosRunId: RUN_ID,
        sourceKind: "PAYCHAOS_REPLAY",
        status: "SUCCEEDED",
        isDuplicateDelivery: false,
        paymentAttemptId: null,
        paymentId: null,
        errorCode: null,
        startedAt: "2026-08-01T10:01:00.000Z",
        finishedAt: "2026-08-01T10:01:01.000Z",
        stateBefore: { kind: "NOT_CAPTURED" },
        stateAfter: { kind: "NOT_CAPTURED" },
      },
    ],
    canonicalSourceEventCount: 1,
    scenarioEvidence: {
      scenarioId: "C01",
      expectedReplayAttemptCount: 2,
      observedReplayAttemptCount: 1,
      chaosLinkedProcessingAttemptCount: 1,
      originalProcessingAttemptCount: 0,
      authoritativeOriginalProcessingAttemptId: null,
    },
  };
}

/** Wires the happy path: FAIL finding, C03 run, compatible bundle. */
function arrangeHappyPath(): void {
  findFindingById.mockResolvedValue(findingRow());
  findInvariantResultById.mockResolvedValue(resultRow("FAIL"));
  getFindingDetailByInvariantResultId.mockResolvedValue(detail());
  assembleChaosRunEvidence.mockResolvedValue(c03Bundle());
}

beforeEach(() => {
  findFindingById.mockReset();
  findInvariantResultById.mockReset();
  getFindingDetailByInvariantResultId.mockReset();
  assembleChaosRunEvidence.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("Phase 4A-R2 — evidence pack service", () => {
  it("1: an existing persisted FAIL finding produces a pack", async () => {
    arrangeHappyPath();

    const pack = await assembleDiagnosisEvidencePackForFinding(FINDING_ID);

    expect(pack.version).toBe(1);
    expect(pack.finding.findingId).toBe(FINDING_ID);
    expect(pack.invariant.result).toBe("FAIL");
    expect(pack.invariant.invariantId).toBe("INV-005");
    expect(pack.scenario?.scenarioId).toBe("C03");
  });

  it("2: the finding is the entry boundary — it is read by its own id first", async () => {
    arrangeHappyPath();

    await assembleDiagnosisEvidencePackForFinding(FINDING_ID);

    expect(findFindingById).toHaveBeenCalledWith(FINDING_ID);
    expect(findFindingById).toHaveBeenCalledTimes(1);
    // The invariant result is resolved THROUGH the finding, never scanned for.
    expect(findInvariantResultById).toHaveBeenCalledWith(RESULT_ID);
  });

  it("3: a genuinely absent finding produces a stable service error", async () => {
    findFindingById.mockResolvedValue(null);

    await expect(
      assembleDiagnosisEvidencePackForFinding(FINDING_ID),
    ).rejects.toMatchObject({ code: "EVIDENCE_PACK_FINDING_NOT_FOUND" });
    expect(findInvariantResultById).not.toHaveBeenCalled();
  });

  it("4: an unresolvable invariant result produces a stable service error", async () => {
    findFindingById.mockResolvedValue(findingRow());
    findInvariantResultById.mockResolvedValue(null);

    await expect(
      assembleDiagnosisEvidencePackForFinding(FINDING_ID),
    ).rejects.toMatchObject({
      code: "EVIDENCE_PACK_INVARIANT_RESULT_NOT_FOUND",
    });
  });

  it("5: a persisted PASS cannot become a diagnosis input", async () => {
    arrangeHappyPath();
    findInvariantResultById.mockResolvedValue(resultRow("PASS"));

    const call = assembleDiagnosisEvidencePackForFinding(FINDING_ID);
    await expect(call).rejects.toBeInstanceOf(EvidencePackError);
    await expect(call).rejects.toMatchObject({
      code: "EVIDENCE_PACK_SOURCE_NOT_FAIL",
    });
  });

  it("6: a persisted UNKNOWN cannot become a diagnosis input", async () => {
    arrangeHappyPath();
    findInvariantResultById.mockResolvedValue(resultRow("UNKNOWN"));

    await expect(
      assembleDiagnosisEvidencePackForFinding(FINDING_ID),
    ).rejects.toMatchObject({ code: "EVIDENCE_PACK_SOURCE_NOT_FAIL" });
  });

  it("7: a null chaosRunId skips chaos assembly and returns a truthful partial pack", async () => {
    findFindingById.mockResolvedValue(findingRow());
    findInvariantResultById.mockResolvedValue({
      ...resultRow("FAIL"),
      chaos_run_id: null,
    });
    getFindingDetailByInvariantResultId.mockResolvedValue(
      detail({ chaosRunId: null }),
    );

    const pack = await assembleDiagnosisEvidencePackForFinding(FINDING_ID);

    expect(assembleChaosRunEvidence).not.toHaveBeenCalled();
    expect(pack.correlations.chaosRunId).toBeNull();
    expect(pack.scenario).toBeNull();
    expect(pack.provenance).toBeNull();
    expect(pack.scenarioEvidence).toBeNull();
    expect(pack.gaps.map((gap) => gap.code)).toContain(
      "NO_CHAOS_RUN_CORRELATION",
    );
  });

  it("8: a present chaosRunId assembles that exact run and feeds it to the builder", async () => {
    arrangeHappyPath();

    const pack = await assembleDiagnosisEvidencePackForFinding(FINDING_ID);

    expect(assembleChaosRunEvidence).toHaveBeenCalledWith(RUN_ID);
    expect(assembleChaosRunEvidence).toHaveBeenCalledTimes(1);
    // The bundle's facts reached the pack.
    const evidence = pack.scenarioEvidence;
    if (evidence?.scenarioId !== "C03") throw new Error("expected C03");
    expect(evidence.verificationChecks).toEqual([
      { case: "WRONG_SIGNATURE", classification: "UNEXPECTED_ACCEPTANCE" },
      { case: "MISSING_SIGNATURE", classification: "REJECTED" },
    ]);
  });

  it("9: an evidence read failure is never converted into a fake empty pack", async () => {
    findFindingById.mockResolvedValue(findingRow());
    findInvariantResultById.mockResolvedValue(resultRow("FAIL"));
    getFindingDetailByInvariantResultId.mockResolvedValue(detail());
    assembleChaosRunEvidence.mockRejectedValue(
      new CodedError(
        "CHAOS_EVIDENCE_READ_FAILED",
        "relation chaos_runs does not exist",
      ),
    );

    await expect(
      assembleDiagnosisEvidencePackForFinding(FINDING_ID),
    ).rejects.toMatchObject({ code: "EVIDENCE_PACK_READ_FAILED" });
  });

  it("9b: a finding read failure is not reported as the finding being absent", async () => {
    findFindingById.mockRejectedValue(
      new CodedError("FINDING_READ_FAILED", "connection terminated"),
    );

    const call = assembleDiagnosisEvidencePackForFinding(FINDING_ID);
    await expect(call).rejects.toMatchObject({
      code: "EVIDENCE_PACK_READ_FAILED",
    });
    await expect(call).rejects.not.toMatchObject({
      code: "EVIDENCE_PACK_FINDING_NOT_FOUND",
    });
  });

  it("9c: an absent chaos run behind a live correlation is an integrity conflict", async () => {
    arrangeHappyPath();
    assembleChaosRunEvidence.mockResolvedValue(null);

    await expect(
      assembleDiagnosisEvidencePackForFinding(FINDING_ID),
    ).rejects.toMatchObject({ code: "EVIDENCE_PACK_INTEGRITY_CONFLICT" });
  });

  it("10: raw database error text never reaches the caller", async () => {
    const secretish =
      'relation "findings" does not exist at postgres://user:pw@host/db';
    findFindingById.mockRejectedValue(
      new CodedError("FINDING_READ_FAILED", secretish),
    );

    try {
      await assembleDiagnosisEvidencePackForFinding(FINDING_ID);
      throw new Error("expected a rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(EvidencePackServiceError);
      const message = (error as Error).message;
      expect(message).not.toContain("postgres://");
      expect(message).not.toContain("does not exist");
      expect(message).not.toContain("user:pw");
      expect(message).toBe("The finding could not be read.");
    }
  });

  it("11: the same reads produce an identical pack", async () => {
    arrangeHappyPath();
    const first = await assembleDiagnosisEvidencePackForFinding(FINDING_ID);

    arrangeHappyPath();
    const second = await assembleDiagnosisEvidencePackForFinding(FINDING_ID);

    expect(second).toEqual(first);
  });

  it("12: R1 builder errors stay fail-closed and are not softened", async () => {
    arrangeHappyPath();
    // The detail names a different run than the assembled bundle.
    getFindingDetailByInvariantResultId.mockResolvedValue({
      ...detail(),
      correlations: {
        ...detail().correlations,
        chaosRunId: "99999999-9999-4999-8999-999999999999",
      },
    });
    assembleChaosRunEvidence.mockResolvedValue(c03Bundle());

    await expect(
      assembleDiagnosisEvidencePackForFinding(FINDING_ID),
    ).rejects.toMatchObject({ code: "EVIDENCE_PACK_CHAOS_RUN_MISMATCH" });
  });

  it("12b: a finding/invariant identity mismatch is an integrity conflict", async () => {
    findFindingById.mockResolvedValue(findingRow());
    findInvariantResultById.mockResolvedValue(resultRow("FAIL"));
    // The result resolves to a different finding than the one requested.
    getFindingDetailByInvariantResultId.mockResolvedValue(
      detail({ findingId: OTHER_FINDING_ID }),
    );

    await expect(
      assembleDiagnosisEvidencePackForFinding(FINDING_ID),
    ).rejects.toMatchObject({ code: "EVIDENCE_PACK_INTEGRITY_CONFLICT" });
  });

  it("13: no mutation operation is invoked anywhere in the read path", async () => {
    arrangeHappyPath();
    await assembleDiagnosisEvidencePackForFinding(FINDING_ID);

    // Only the three approved read boundaries were touched.
    expect(findFindingById).toHaveBeenCalledTimes(1);
    expect(findInvariantResultById).toHaveBeenCalledTimes(1);
    expect(getFindingDetailByInvariantResultId).toHaveBeenCalledTimes(1);
    expect(assembleChaosRunEvidence).toHaveBeenCalledTimes(1);

    const repository = await import("@/lib/findings/repository");
    const findings = await import("@/lib/findings/service");
    // The mocked read modules expose no write function to this service at all.
    expect(Object.keys(repository).sort()).toEqual([
      "findFindingById",
      "findInvariantResultById",
    ]);
    expect(Object.keys(findings)).toEqual([
      "getFindingDetailByInvariantResultId",
    ]);
  });

  it("14: provenance axes stay separate and unchanged through orchestration", async () => {
    findFindingById.mockResolvedValue(findingRow());
    findInvariantResultById.mockResolvedValue(resultRow("FAIL"));
    getFindingDetailByInvariantResultId.mockResolvedValue(detail());
    assembleChaosRunEvidence.mockResolvedValue(c01Bundle());

    const pack = await assembleDiagnosisEvidencePackForFinding(FINDING_ID);

    expect(pack.provenance?.sourceKind).toBe("REAL_RAZORPAY_WEBHOOK");
    expect(pack.scenario?.dataClassification).toBe("RECORDED_TEST_EVIDENCE");
    const replay = pack.processing.find((entry) => entry.role === "CHAOS");
    expect(replay?.sourceKind).toBe("PAYCHAOS_REPLAY");
    // A replay is never relabelled as a new provider delivery.
    expect(replay?.sourceKind).not.toBe("REAL_RAZORPAY_WEBHOOK");
    expect(pack.counts?.canonicalSourceEventCount).toBe(1);
  });

  it("15: a subject-free C03 finding is fully supported", async () => {
    arrangeHappyPath();

    const pack = await assembleDiagnosisEvidencePackForFinding(FINDING_ID);

    expect(pack.correlations.orderId).toBeNull();
    expect(pack.correlations.paymentAttemptId).toBeNull();
    expect(pack.correlations.paymentId).toBeNull();
    expect(pack.correlations.chaosRunId).toBe(RUN_ID);
    expect(pack.scenario?.dataClassification).toBe("SYNTHETIC_DEMO");
    expect(pack.provenance).toBeNull();
    expect(pack.gaps.map((gap) => gap.code)).toContain(
      "SOURCE_WEBHOOK_UNAVAILABLE",
    );
  });

  it("16: an invalid finding identifier is rejected before any evidence read", async () => {
    findFindingById.mockRejectedValue(
      new CodedError(
        "FINDING_INVARIANT_RESULT_ID_INVALID",
        "not a uuid: <script>",
      ),
    );

    await expect(
      assembleDiagnosisEvidencePackForFinding("not-a-uuid"),
    ).rejects.toMatchObject({ code: "EVIDENCE_PACK_FINDING_ID_INVALID" });
    expect(assembleChaosRunEvidence).not.toHaveBeenCalled();
  });

  it("17: the pack carries no diagnosis, recommendation, score or readiness field", async () => {
    arrangeHappyPath();
    const pack = await assembleDiagnosisEvidencePackForFinding(FINDING_ID);
    const serialized = JSON.stringify(pack);

    for (const forbidden of [
      "diagnosisCode",
      "diagnosisStrength",
      "diagnosis_strength",
      "recommendationCode",
      "recommendationText",
      "STRONG_EVIDENCE",
      "INSUFFICIENT_EVIDENCE",
      "reliabilityScore",
      "readiness",
      "rootCause",
    ]) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
  });
});
