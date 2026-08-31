import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Only the two SERVER boundaries are mocked. The frozen pure layers — the
// Phase 4B signal extractor and the Phase 4C-R1 classifier — run for real, so
// these tests prove orchestration and authority rather than re-proving R1
// classification semantics.
vi.mock("@/lib/diagnosis/evidence-pack-service", () => ({
  assembleDiagnosisEvidencePackForFinding: vi.fn(),
}));
vi.mock("@/lib/diagnosis/root-cause-repository", () => ({
  persistFindingDiagnosis: vi.fn(),
}));
// The signal service must NOT be reachable from the diagnosis service: a
// second call would assemble a second Evidence Pack for one operation.
const assembleDiagnosticSignalsForFinding = vi.fn();
vi.mock("@/lib/diagnosis/diagnostic-signals-service", () => ({
  assembleDiagnosticSignalsForFinding: () =>
    assembleDiagnosticSignalsForFinding(),
}));

const logEvent = vi.fn();
vi.mock("@/lib/security/logger", () => ({
  logEvent: (event: string, fields: unknown) => logEvent(event, fields),
}));

import { extractDiagnosticSignals } from "@/lib/diagnosis/diagnostic-signals";
import { assembleDiagnosisEvidencePackForFinding } from "@/lib/diagnosis/evidence-pack-service";
import { classifyRootCause } from "@/lib/diagnosis/root-cause-classifier";
import { persistFindingDiagnosis } from "@/lib/diagnosis/root-cause-repository";
import { diagnoseFinding } from "@/lib/diagnosis/root-cause-service";
import type { DiagnosisEvidencePackV1 } from "@/lib/diagnosis/evidence-pack";
import type { ChaosScenarioId } from "@/lib/chaos/types";
import type { InvariantResultInvariantId } from "@/lib/supabase/types";

/**
 * Phase 4C-R2 — server orchestration for one Finding's diagnosis.
 *
 * The contract: assemble the Evidence Pack ONCE, derive signals and a
 * classification from that exact pack with the frozen pure layers, persist
 * only the selected result, and never soften a failure into a diagnosis.
 */

const readPack = vi.mocked(assembleDiagnosisEvidencePackForFinding);
const persist = vi.mocked(persistFindingDiagnosis);

const FINDING_ID = "55555555-5555-4555-8555-555555555555";
const RESULT_ID = "33333333-3333-4333-8333-333333333333";
const RUN_ID = "11111111-1111-4111-8111-111111111111";
const DIAGNOSED_AT = "2026-08-31T12:00:00.000Z";
const ORIGINAL_AT = "2026-08-30T09:00:00.000Z";

function pack(
  invariantId: InvariantResultInvariantId = "INV-005",
  scenarioId: ChaosScenarioId | null = "C03",
  overrides?: Partial<DiagnosisEvidencePackV1>,
): DiagnosisEvidencePackV1 {
  return {
    version: 1,
    finding: {
      findingId: FINDING_ID,
      invariantResultId: RESULT_ID,
      status: "OPEN",
      title: `${invariantId} — deterministic evaluator title`,
      createdAt: "2026-08-01T11:00:00.000Z",
    },
    invariant: {
      invariantId,
      invariantVersion: "1",
      result: "FAIL",
      severity: "CRITICAL",
      expectedSummary: "expected wording",
      observedSummary: "observed wording",
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
    scenario:
      scenarioId === null
        ? null
        : {
            scenarioId,
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

function diagnosed(overrides: Record<string, unknown> = {}) {
  return {
    kind: "DIAGNOSED" as const,
    diagnosisCode: "RC-016" as const,
    diagnosisStrength: "INSUFFICIENT_EVIDENCE" as const,
    diagnosedAt: DIAGNOSED_AT,
    updatedAt: DIAGNOSED_AT,
    ...overrides,
  };
}

class FakeServiceError extends Error {
  readonly code: string;
  constructor(code: string) {
    super("A fixed safe message.");
    this.name = "EvidencePackServiceError";
    this.code = code;
  }
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("Phase 4C-R2 — diagnosis orchestration", () => {
  it("1: the Evidence Pack is assembled EXACTLY ONCE per diagnosis", async () => {
    readPack.mockResolvedValue(pack());
    persist.mockResolvedValue(diagnosed());

    await diagnoseFinding(FINDING_ID);

    expect(readPack).toHaveBeenCalledTimes(1);
    expect(readPack).toHaveBeenCalledWith(FINDING_ID);
    // The Phase 4B server service would assemble a SECOND pack for the same
    // operation, so it must never be reached from here.
    expect(assembleDiagnosticSignalsForFinding).not.toHaveBeenCalled();
  });

  it("2/3: the exact pack drives both frozen pure layers", async () => {
    const input = pack();
    readPack.mockResolvedValue(input);
    persist.mockResolvedValue(diagnosed());

    const result = await diagnoseFinding(FINDING_ID);

    // Composing the three approved units by hand must give the same answer.
    const expected = classifyRootCause(input, extractDiagnosticSignals(input));
    expect(result.classification).toEqual(expected);
  });

  it("4: the selected code and strength are what gets persisted", async () => {
    const input = pack();
    readPack.mockResolvedValue(input);
    persist.mockResolvedValue(diagnosed());

    const result = await diagnoseFinding(FINDING_ID);

    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledWith({
      findingId: FINDING_ID,
      invariantResultId: RESULT_ID,
      diagnosisCode: result.classification.selected.code,
      diagnosisStrength: result.classification.selected.strength,
      attemptedAt: expect.any(String),
    });
  });

  it("5: RC-016 is persisted normally, not treated as an error", async () => {
    readPack.mockResolvedValue(pack());
    persist.mockResolvedValue(diagnosed());

    const result = await diagnoseFinding(FINDING_ID);

    // A minimal C03 pack genuinely cannot support a specific cause.
    expect(result.classification.selected.code).toBe("RC-016");
    expect(result.classification.selected.strength).toBe(
      "INSUFFICIENT_EVIDENCE",
    );
    expect(persist).toHaveBeenCalledTimes(1);
    expect(result.persistence.kind).toBe("DIAGNOSED");
    expect(result.persistence.diagnosedAt).toBe(DIAGNOSED_AT);
  });

  it("6/7/8: the full classification is returned with its frozen provenance", async () => {
    readPack.mockResolvedValue(pack());
    persist.mockResolvedValue(diagnosed());

    const { classification } = await diagnoseFinding(FINDING_ID);

    expect(classification.outputSource).toBe("DETERMINISTIC_RULES");
    expect(classification.ruleVersion).toBe("DIAG-RULES-V1");
    expect(classification.findingId).toBe(FINDING_ID);
    expect(classification.invariantResultId).toBe(RESULT_ID);
    expect(classification.evidenceRefs).toEqual([
      { kind: "CHAOS_RUN", id: RUN_ID },
    ]);
    expect(classification.rankedCandidates.length).toBeGreaterThan(0);
    expect(classification.selected.blockingGapCodes).toBeDefined();
  });

  it("9: the server generates the timestamp, and only for the write attempt", async () => {
    readPack.mockResolvedValue(pack());
    persist.mockResolvedValue(diagnosed());

    const before = Date.now();
    await diagnoseFinding(FINDING_ID);
    const after = Date.now();

    const attemptedAt = persist.mock.calls[0]![0]!.attemptedAt;
    const parsed = Date.parse(attemptedAt);
    expect(Number.isNaN(parsed)).toBe(false);
    expect(parsed).toBeGreaterThanOrEqual(before);
    expect(parsed).toBeLessThanOrEqual(after);
    // The classification itself stays timeless.
    expect(JSON.stringify(await readPack.mock.results[0]!.value)).not.toContain(
      attemptedAt,
    );
  });

  it("10: a DIAGNOSED response returns the persisted timestamp", async () => {
    readPack.mockResolvedValue(pack());
    persist.mockResolvedValue(diagnosed());

    const result = await diagnoseFinding(FINDING_ID);

    expect(result.persistence.kind).toBe("DIAGNOSED");
    expect(result.persistence.diagnosedAt).toBe(DIAGNOSED_AT);
    expect(result.persistence.updatedAt).toBe(DIAGNOSED_AT);
  });

  it("11: ALREADY_DIAGNOSED preserves the ORIGINAL timestamp", async () => {
    readPack.mockResolvedValue(pack());
    persist.mockResolvedValue(
      diagnosed({
        kind: "ALREADY_DIAGNOSED",
        diagnosedAt: ORIGINAL_AT,
        updatedAt: ORIGINAL_AT,
      }),
    );

    const result = await diagnoseFinding(FINDING_ID);

    expect(result.persistence.kind).toBe("ALREADY_DIAGNOSED");
    expect(result.persistence.diagnosedAt).toBe(ORIGINAL_AT);
    // The freshly generated attempt timestamp is discarded, not returned.
    const attemptedAt = persist.mock.calls[0]![0]!.attemptedAt;
    expect(result.persistence.diagnosedAt).not.toBe(attemptedAt);
  });

  it("12: a repeated call over unchanged evidence is semantically idempotent", async () => {
    readPack.mockResolvedValue(pack());
    persist.mockResolvedValue(diagnosed());
    const first = await diagnoseFinding(FINDING_ID);

    readPack.mockResolvedValue(pack());
    persist.mockResolvedValue(
      diagnosed({ kind: "ALREADY_DIAGNOSED", updatedAt: DIAGNOSED_AT }),
    );
    const second = await diagnoseFinding(FINDING_ID);

    expect(second.classification).toEqual(first.classification);
    expect(second.persistence.diagnosisCode).toBe(
      first.persistence.diagnosisCode,
    );
    expect(second.persistence.diagnosedAt).toBe(first.persistence.diagnosedAt);
  });
});

describe("Phase 4C-R2 — error propagation", () => {
  const packErrors = [
    "EVIDENCE_PACK_FINDING_ID_INVALID",
    "EVIDENCE_PACK_FINDING_NOT_FOUND",
    "EVIDENCE_PACK_INVARIANT_RESULT_NOT_FOUND",
    "EVIDENCE_PACK_INTEGRITY_CONFLICT",
    "EVIDENCE_PACK_READ_FAILED",
  ] as const;

  it("13: every Phase 4A evidence error propagates unchanged", async () => {
    for (const code of packErrors) {
      vi.resetAllMocks();
      const thrown = new FakeServiceError(code);
      readPack.mockRejectedValue(thrown);

      await expect(diagnoseFinding(FINDING_ID), code).rejects.toBe(thrown);
      // Nothing was persisted for a failed evidence read, and nothing was
      // logged as if a diagnosis had happened.
      expect(persist, code).not.toHaveBeenCalled();
      expect(logEvent, code).not.toHaveBeenCalled();
    }
  });

  it("14: a classification error propagates unchanged and persists nothing", async () => {
    // Identity mismatch between the pack and its own finding id would be a
    // broken input contract, which R1 fails closed on.
    // The pack type pins `result` to the literal "FAIL", so this state is
    // only reachable through an unsafe cast — which is why R1 still checks it
    // at runtime rather than trusting the type.
    const base = pack();
    const broken = {
      ...base,
      invariant: { ...base.invariant, result: "PASS" },
    } as unknown as DiagnosisEvidencePackV1;
    readPack.mockResolvedValue(broken);

    await expect(diagnoseFinding(FINDING_ID)).rejects.toMatchObject({
      name: "RootCauseClassificationError",
      code: "DIAGNOSIS_INPUT_NOT_FAIL",
    });
    expect(persist).not.toHaveBeenCalled();
  });

  it("15: a persistence error propagates unchanged and is never swallowed", async () => {
    readPack.mockResolvedValue(pack());
    const thrown = new FakeServiceError("DIAGNOSIS_PERSIST_INTEGRITY_CONFLICT");
    persist.mockRejectedValue(thrown);

    await expect(diagnoseFinding(FINDING_ID)).rejects.toBe(thrown);
    // The best-effort logging catch must not extend over persistence: a
    // database failure still fails the operation, and nothing is logged as
    // though a diagnosis had been committed.
    expect(logEvent).not.toHaveBeenCalled();
  });

  it("16: NO error is ever converted into an RC-016 diagnosis", async () => {
    for (const setup of [
      () =>
        readPack.mockRejectedValue(
          new FakeServiceError("EVIDENCE_PACK_READ_FAILED"),
        ),
      () => {
        readPack.mockResolvedValue(pack());
        persist.mockRejectedValue(
          new FakeServiceError("DIAGNOSIS_PERSIST_UPDATE_FAILED"),
        );
      },
    ]) {
      vi.resetAllMocks();
      setup();

      let outcome: unknown = "did-not-resolve";
      try {
        outcome = await diagnoseFinding(FINDING_ID);
      } catch {
        outcome = "threw";
      }
      // An infrastructure failure must never look like an honest diagnosis.
      expect(outcome).toBe("threw");
    }
  });
});

describe("Phase 4C-R2 — authority and side effects", () => {
  it("17: neither input object is mutated", async () => {
    const input = pack();
    const serialized = JSON.stringify(input);
    const refs = input.evidenceRefs;
    readPack.mockResolvedValue(input);
    persist.mockResolvedValue(diagnosed());

    await diagnoseFinding(FINDING_ID);

    expect(JSON.stringify(input)).toBe(serialized);
    expect(input.evidenceRefs).toBe(refs);
  });

  it("18: no recommendation, summary, regression, score or readiness appears", async () => {
    readPack.mockResolvedValue(pack());
    persist.mockResolvedValue(diagnosed());

    const result = await diagnoseFinding(FINDING_ID);
    const serialized = JSON.stringify(result);

    for (const forbidden of [
      "diagnosis_summary",
      "diagnosisSummary",
      "recommendation",
      "FIX-",
      "regression_runs",
      "regressionRun",
      "retest",
      "reliabilityScore",
      "RELIABILITY-V1",
      "readiness",
      "goLive",
      "resolved_at",
      "resolvedAt",
      "STILL_FAILING",
      "RESOLVED",
    ]) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }

    // The persistence call carries only the four approved inputs.
    expect(Object.keys(persist.mock.calls[0]![0]!).sort()).toEqual([
      "attemptedAt",
      "diagnosisCode",
      "diagnosisStrength",
      "findingId",
      "invariantResultId",
    ]);
  });

  it("19: the audit event is safe — identifiers, vocabulary and counts only", async () => {
    readPack.mockResolvedValue(pack());
    persist.mockResolvedValue(diagnosed());

    await diagnoseFinding(FINDING_ID);

    expect(logEvent).toHaveBeenCalledTimes(1);
    const [event, fields] = logEvent.mock.calls[0]!;
    expect(event).toBe("diagnosis.root_cause.persisted");

    const serialized = JSON.stringify(fields);
    for (const forbidden of [
      "expectedSummary",
      "observedSummary",
      "reason",
      "title",
      "fault_config",
      "fault_state",
      "raw_payload_redacted",
      "raw_body_sha256",
      "RAZORPAY_KEY_SECRET",
      "RAZORPAY_WEBHOOK_SECRET",
      "SUPABASE_SERVICE_ROLE_KEY",
      "signature",
      "evidenceRefs",
    ]) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
    // Every value is a primitive: no object or evidence dump.
    for (const value of Object.values(fields as Record<string, unknown>)) {
      expect(["string", "number", "boolean"]).toContain(typeof value);
    }
    expect(fields).toMatchObject({
      finding_id: FINDING_ID,
      diagnosis_code: "RC-016",
      diagnosis_strength: "INSUFFICIENT_EVIDENCE",
      output_source: "DETERMINISTIC_RULES",
      source_version: "DIAG-RULES-V1",
      persistence_kind: "DIAGNOSED",
      fallback_used: true,
    });
  });

  it("20: no audit event is emitted when the operation failed", async () => {
    readPack.mockRejectedValue(
      new FakeServiceError("EVIDENCE_PACK_READ_FAILED"),
    );

    await expect(diagnoseFinding(FINDING_ID)).rejects.toBeInstanceOf(Error);

    expect(logEvent).not.toHaveBeenCalled();
  });
});

// ============================================================================
// AUDIT LOGGING IS SUPPLEMENTAL — a logging fault never rewrites the result
// ============================================================================

describe("Phase 4C-R2 — best-effort audit logging", () => {
  const loggerFailure = new Error("synthetic logger failure");

  it("L-A: a logger failure after DIAGNOSED does not fail the operation", async () => {
    readPack.mockResolvedValue(pack());
    persist.mockResolvedValue(diagnosed());
    logEvent.mockImplementation(() => {
      throw loggerFailure;
    });

    // PostgreSQL has already committed the diagnosis: reporting failure here
    // would hand the caller an ambiguous partial success.
    const result = await diagnoseFinding(FINDING_ID);

    expect(result.persistence.kind).toBe("DIAGNOSED");
    expect(result.persistence.diagnosedAt).toBe(DIAGNOSED_AT);
    expect(result.classification.selected.code).toBe("RC-016");
    expect(result.classification.outputSource).toBe("DETERMINISTIC_RULES");

    // Exactly one of each: no retry, no second assembly, no second write.
    expect(readPack).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(logEvent).toHaveBeenCalledTimes(1);
  });

  it("L-A2: the logger's own error never escapes the service", async () => {
    readPack.mockResolvedValue(pack());
    persist.mockResolvedValue(diagnosed());
    logEvent.mockImplementation(() => {
      throw loggerFailure;
    });

    let escaped: unknown = null;
    try {
      await diagnoseFinding(FINDING_ID);
    } catch (error) {
      escaped = error;
    }
    expect(escaped).toBeNull();
  });

  it("L-B: a logger failure after ALREADY_DIAGNOSED preserves the original timestamps", async () => {
    readPack.mockResolvedValue(pack());
    persist.mockResolvedValue(
      diagnosed({
        kind: "ALREADY_DIAGNOSED",
        diagnosedAt: ORIGINAL_AT,
        updatedAt: ORIGINAL_AT,
      }),
    );
    logEvent.mockImplementation(() => {
      throw loggerFailure;
    });

    const result = await diagnoseFinding(FINDING_ID);

    expect(result.persistence.kind).toBe("ALREADY_DIAGNOSED");
    expect(result.persistence.diagnosedAt).toBe(ORIGINAL_AT);
    expect(result.persistence.updatedAt).toBe(ORIGINAL_AT);
    // No additional persistence attempt was made to "recover" from logging.
    expect(persist).toHaveBeenCalledTimes(1);
    expect(readPack).toHaveBeenCalledTimes(1);
  });

  it("L-C: a logger failure never downgrades the diagnosis to a fallback claim", async () => {
    readPack.mockResolvedValue(pack());
    persist.mockResolvedValue(
      diagnosed({
        diagnosisCode: "RC-016",
        diagnosisStrength: "INSUFFICIENT_EVIDENCE",
      }),
    );
    logEvent.mockImplementation(() => {
      throw loggerFailure;
    });

    const withLoggerFailure = await diagnoseFinding(FINDING_ID);

    vi.resetAllMocks();
    readPack.mockResolvedValue(pack());
    persist.mockResolvedValue(diagnosed());
    const withWorkingLogger = await diagnoseFinding(FINDING_ID);

    // The returned result is identical either way: logging is supplemental.
    expect(withLoggerFailure).toEqual(withWorkingLogger);
  });

  it("L-D: the catch is scoped to logging only — a classification error still escapes", async () => {
    const base = pack();
    const broken = {
      ...base,
      invariant: { ...base.invariant, result: "PASS" },
    } as unknown as DiagnosisEvidencePackV1;
    readPack.mockResolvedValue(broken);
    logEvent.mockImplementation(() => {
      throw loggerFailure;
    });

    await expect(diagnoseFinding(FINDING_ID)).rejects.toMatchObject({
      name: "RootCauseClassificationError",
    });
    expect(persist).not.toHaveBeenCalled();
    expect(logEvent).not.toHaveBeenCalled();
  });

  it("L-E: a logging failure is not re-reported through another logger", async () => {
    readPack.mockResolvedValue(pack());
    persist.mockResolvedValue(diagnosed());
    logEvent.mockImplementation(() => {
      throw loggerFailure;
    });

    await diagnoseFinding(FINDING_ID);

    // One attempt only. The failing logger is not called again to report its
    // own failure, and its uncontrolled message is never re-emitted.
    expect(logEvent).toHaveBeenCalledTimes(1);
  });
});
