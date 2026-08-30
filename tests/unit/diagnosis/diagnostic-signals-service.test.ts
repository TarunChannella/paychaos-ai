import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// The Phase 4A read boundary is the ONLY thing mocked here. The signal rules
// themselves are the real committed R1 extractor, so these tests prove
// orchestration and authority rather than re-proving frozen semantics — those
// are already pinned by the 107 R1 signal tests.
vi.mock("@/lib/diagnosis/evidence-pack-service", () => ({
  assembleDiagnosisEvidencePackForFinding: vi.fn(),
}));

import {
  DIAGNOSTIC_SIGNAL_CODES,
  DIAGNOSTIC_SIGNAL_VERSION,
  extractDiagnosticSignals,
} from "@/lib/diagnosis/diagnostic-signals";
import { assembleDiagnosticSignalsForFinding } from "@/lib/diagnosis/diagnostic-signals-service";
import { assembleDiagnosisEvidencePackForFinding } from "@/lib/diagnosis/evidence-pack-service";
import type { DiagnosisEvidencePackV1 } from "@/lib/diagnosis/evidence-pack";

/**
 * Phase 4B-R2 — server orchestration for diagnostic signals.
 *
 * The whole contract is: hand the finding id to the approved Phase 4A
 * evidence service, hand the exact pack it returns to the frozen R1
 * extractor, return that set unchanged, and never soften a read failure into
 * evidence.
 */

const readPack = vi.mocked(assembleDiagnosisEvidencePackForFinding);

const FINDING_ID = "55555555-5555-4555-8555-555555555555";
const RESULT_ID = "33333333-3333-4333-8333-333333333333";
const RUN_ID = "11111111-1111-4111-8111-111111111111";
const ORDER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ATTEMPT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PAYMENT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

/**
 * A minimal C03-shaped pack. Subject-free correlations are truthfully null,
 * exactly as the real subject-free scenario produces them.
 */
function pack(
  overrides?: Partial<DiagnosisEvidencePackV1>,
): DiagnosisEvidencePackV1 {
  return {
    version: 1,
    finding: {
      findingId: FINDING_ID,
      invariantResultId: RESULT_ID,
      status: "OPEN",
      title: "INV-005 — Invalid Signature Causes Zero Business Mutation",
      createdAt: "2026-08-01T11:00:00.000Z",
    },
    invariant: {
      invariantId: "INV-005",
      invariantVersion: "1",
      result: "FAIL",
      severity: "CRITICAL",
      expectedSummary: "zero business mutation",
      observedSummary: "test fixture",
      reason: "Deterministic evaluator prose.",
      evaluatedAt: "2026-08-01T10:30:00.000Z",
    },
    correlations: {
      chaosRunId: RUN_ID,
      orderId: null,
      paymentAttemptId: null,
      paymentId: null,
    },
    evidenceRefs: [{ kind: "CHAOS_RUN", id: RUN_ID }],
    scenario: {
      scenarioId: "C03",
      faultType: "INVALID_SIGNATURE_TEST",
      dataClassification: "SYNTHETIC_DEMO",
      status: "COMPLETED",
      outcome: "FAIL",
      startedAt: "2026-08-01T10:00:00.000Z",
      completedAt: "2026-08-01T10:05:00.000Z",
    },
    provenance: null,
    processing: [],
    counts: null,
    money: null,
    capture: null,
    scenarioEvidence: null,
    gaps: [],
    ...overrides,
  };
}

/** Mirrors the shape of a real Phase 4A service error closely enough to test propagation. */
class FakeEvidencePackServiceError extends Error {
  readonly code: string;
  constructor(code: string) {
    super("A fixed safe message.");
    this.name = "EvidencePackServiceError";
    this.code = code;
  }
}

beforeEach(() => {
  // `resetAllMocks`, not `clearAllMocks`: clearing wipes call history but
  // LEAVES the configured implementation in place, so a test that forgot to
  // configure the read boundary would silently inherit the previous test's
  // pack and appear to pass. Resetting removes the implementation too, making
  // every test below independent of execution order — an unconfigured read
  // resolves nothing rather than quietly borrowing evidence.
  vi.resetAllMocks();
});

describe("Phase 4B-R2 — diagnostic signals service", () => {
  it("1: the finding id is passed unchanged to the approved evidence service", async () => {
    readPack.mockResolvedValue(pack());

    await assembleDiagnosticSignalsForFinding(FINDING_ID);

    expect(readPack).toHaveBeenCalledTimes(1);
    expect(readPack).toHaveBeenCalledWith(FINDING_ID);
  });

  it("2: the returned pack is passed through the real deterministic extractor", async () => {
    const input = pack();
    readPack.mockResolvedValue(input);

    const set = await assembleDiagnosticSignalsForFinding(FINDING_ID);

    // The service composes; it does not reimplement. Composing the two
    // approved units by hand must give exactly the same answer.
    expect(set).toEqual(extractDiagnosticSignals(input));
  });

  it("3: the service returns the exact signal set for that pack", async () => {
    readPack.mockResolvedValue(pack());

    const set = await assembleDiagnosticSignalsForFinding(FINDING_ID);

    expect(set.version).toBe(DIAGNOSTIC_SIGNAL_VERSION);
    expect(set.findingId).toBe(FINDING_ID);
    expect(set.invariantResultId).toBe(RESULT_ID);
    expect(set.signals).toHaveLength(13);
  });

  it("4: the same evidence input produces a deep-equal output", async () => {
    readPack.mockResolvedValue(pack());
    const first = await assembleDiagnosticSignalsForFinding(FINDING_ID);

    readPack.mockResolvedValue(pack());
    const second = await assembleDiagnosticSignalsForFinding(FINDING_ID);

    expect(second).toEqual(first);
  });

  it("5: the evidence pack is never mutated by the service", async () => {
    const input = pack({
      correlations: {
        chaosRunId: RUN_ID,
        orderId: ORDER_ID,
        paymentAttemptId: ATTEMPT_ID,
        paymentId: PAYMENT_ID,
      },
      gaps: [{ code: "MONEY_CONTEXT_UNAVAILABLE", subjectId: RUN_ID }],
    });
    const serialized = JSON.stringify(input);
    const processingRef = input.processing;
    const gapsRef = input.gaps;

    readPack.mockResolvedValue(input);

    await assembleDiagnosticSignalsForFinding(FINDING_ID);

    expect(JSON.stringify(input)).toBe(serialized);
    expect(input.processing).toBe(processingRef);
    expect(input.gaps).toBe(gapsRef);
  });

  // -------------------------------------------------------- error propagation

  const PROPAGATED_CODES = [
    "EVIDENCE_PACK_FINDING_ID_INVALID",
    "EVIDENCE_PACK_FINDING_NOT_FOUND",
    "EVIDENCE_PACK_INVARIANT_RESULT_NOT_FOUND",
    "EVIDENCE_PACK_INTEGRITY_CONFLICT",
    "EVIDENCE_PACK_READ_FAILED",
  ] as const;

  it("6-10: every Phase 4A service error propagates unchanged", async () => {
    for (const code of PROPAGATED_CODES) {
      const thrown = new FakeEvidencePackServiceError(code);
      readPack.mockRejectedValueOnce(thrown);

      // The identical error instance escapes: not wrapped, not re-coded, not
      // replaced with a second broad error vocabulary.
      await expect(
        assembleDiagnosticSignalsForFinding(FINDING_ID),
        code,
      ).rejects.toBe(thrown);
    }
  });

  it("11: a read failure is NEVER converted into thirteen UNKNOWN signals", async () => {
    readPack.mockRejectedValue(
      new FakeEvidencePackServiceError("EVIDENCE_PACK_READ_FAILED"),
    );

    let resolvedValue: unknown = "did-not-resolve";
    try {
      resolvedValue = await assembleDiagnosticSignalsForFinding(FINDING_ID);
    } catch {
      resolvedValue = "threw";
    }

    // An infrastructure failure must not masquerade as an honest observation.
    expect(resolvedValue).toBe("threw");
    expect(resolvedValue).not.toEqual(
      expect.objectContaining({ signals: expect.anything() }),
    );
  });

  it("11b: an error that is not a service error also propagates unchanged", async () => {
    const raw = new Error("some unexpected failure");
    readPack.mockRejectedValue(raw);

    await expect(assembleDiagnosticSignalsForFinding(FINDING_ID)).rejects.toBe(
      raw,
    );
  });

  it("11c: no null, empty set or fake pack is ever substituted for a failure", async () => {
    for (const code of PROPAGATED_CODES) {
      readPack.mockRejectedValueOnce(new FakeEvidencePackServiceError(code));
      await expect(
        assembleDiagnosticSignalsForFinding(FINDING_ID),
        code,
      ).rejects.toBeInstanceOf(Error);
    }
    // Five failures in, the service has still never resolved.
    expect(readPack).toHaveBeenCalledTimes(PROPAGATED_CODES.length);
  });

  // ------------------------------------------------------------- output shape

  it("12: UNKNOWN states in a valid pack are preserved exactly", async () => {
    // This subject-free C03 pack genuinely cannot establish most signals.
    const input = pack();
    readPack.mockResolvedValue(input);

    const set = await assembleDiagnosticSignalsForFinding(FINDING_ID);
    const direct = extractDiagnosticSignals(input);

    expect(set.signals.map((signal) => signal.state)).toEqual(
      direct.signals.map((signal) => signal.state),
    );
    // Not softened, not upgraded, not dropped.
    expect(set.signals.some((signal) => signal.state === "UNKNOWN")).toBe(true);
    for (const signal of set.signals) {
      expect(["PRESENT", "ABSENT", "UNKNOWN"]).toContain(signal.state);
    }
  });

  it("13: the frozen thirteen-code order is preserved end to end", async () => {
    readPack.mockResolvedValue(pack());

    const set = await assembleDiagnosticSignalsForFinding(FINDING_ID);

    expect(set.signals.map((signal) => signal.code)).toEqual([
      ...DIAGNOSTIC_SIGNAL_CODES,
    ]);
    expect(DIAGNOSTIC_SIGNAL_CODES).toHaveLength(13);
  });

  it("14: no diagnosis, root cause, strength, recommendation, score or readiness field appears", async () => {
    readPack.mockResolvedValue(pack());

    const serialized = JSON.stringify(
      await assembleDiagnosticSignalsForFinding(FINDING_ID),
    );

    for (const forbidden of [
      "RC-0",
      "rootCause",
      "root_cause",
      "diagnosisCode",
      "diagnosis_code",
      "diagnosisStrength",
      "diagnosis_strength",
      "diagnosisSummary",
      "STRONG_EVIDENCE",
      "PARTIAL_EVIDENCE",
      "INSUFFICIENT_EVIDENCE",
      "evidenceStrength",
      "recommendation",
      "regression",
      "reliabilityScore",
      "readiness",
      "goLive",
      "confidence",
      "probability",
    ]) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
  });

  it("15: no mutation service is invoked — the read boundary is the only call", async () => {
    readPack.mockResolvedValue(pack());

    await assembleDiagnosticSignalsForFinding(FINDING_ID);

    // The Phase 4A read is the module's entire outward surface. If any write
    // path had been reached it would need a second dependency, and this
    // module has exactly one.
    expect(readPack).toHaveBeenCalledTimes(1);
    expect(readPack).toHaveBeenCalledWith(FINDING_ID);
  });

  it("16: no secret, raw payload or signature value can reach the output", async () => {
    readPack.mockResolvedValue(pack());

    const serialized = JSON.stringify(
      await assembleDiagnosticSignalsForFinding(FINDING_ID),
    );

    for (const forbidden of [
      "RAZORPAY_KEY_SECRET",
      "RAZORPAY_WEBHOOK_SECRET",
      "SUPABASE_SERVICE_ROLE_KEY",
      "service_role",
      "raw_payload_redacted",
      "raw_body_sha256",
      "fault_config",
      "fault_state",
      "x-razorpay-signature",
      "razorpay_signature",
      "eyJ",
    ]) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
    expect(serialized).not.toMatch(/[A-Fa-f0-9]{40,}/);
  });
});
