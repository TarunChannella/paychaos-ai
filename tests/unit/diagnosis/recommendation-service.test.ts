import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Only the SERVER boundaries are mocked. The frozen pure recommendation
// catalogue runs for real, so these tests prove trusted orchestration rather
// than re-proving R1 catalogue semantics.
vi.mock("@/lib/diagnosis/root-cause-service", () => ({
  diagnoseFinding: vi.fn(),
}));
vi.mock("@/lib/diagnosis/evidence-pack-service", () => ({
  assembleDiagnosisEvidencePackForFinding: vi.fn(),
}));
vi.mock("@/lib/diagnosis/recommendation-repository", () => ({
  persistFindingRecommendation: vi.fn(),
}));

// Phase 4C's diagnosis WRITER must never be reached from here: Phase 4C owns
// diagnosis persistence, and reproducing it would be a second version of the
// truth. `classifyRootCause` and `extractDiagnosticSignals` are deliberately
// NOT spied — partially mocking those frozen pure modules creates an import
// cycle, so their absence is proven behaviourally below (the returned
// classification is the very object `diagnoseFinding` produced) and
// structurally by the Phase 4D-R2 static guard.
const persistFindingDiagnosis = vi.fn();
vi.mock("@/lib/diagnosis/root-cause-repository", () => ({
  persistFindingDiagnosis,
}));

const logEvent = vi.fn();
vi.mock("@/lib/security/logger", () => ({
  logEvent: (event: string, fields: unknown) => logEvent(event, fields),
}));

import { assembleDiagnosisEvidencePackForFinding } from "@/lib/diagnosis/evidence-pack-service";
import { persistFindingRecommendation } from "@/lib/diagnosis/recommendation-repository";
import { recommendFinding } from "@/lib/diagnosis/recommendation-service";
import { diagnoseFinding } from "@/lib/diagnosis/root-cause-service";
import { classifyRootCause as realClassify } from "@/lib/diagnosis/root-cause-classifier";
import {
  DIAGNOSTIC_SIGNAL_CODES,
  DIAGNOSTIC_SIGNAL_VERSION,
} from "@/lib/diagnosis/diagnostic-signals";
import type {
  DiagnosticSignalCode,
  DiagnosticSignalSetV1,
  DiagnosticSignalState,
} from "@/lib/diagnosis/diagnostic-signals";
import type { DiagnosisEvidencePackV1 } from "@/lib/diagnosis/evidence-pack";
import type { ChaosScenarioId } from "@/lib/chaos/types";
import type { InvariantResultInvariantId } from "@/lib/supabase/types";

/**
 * Phase 4D-R2 — trusted server orchestration for one Finding's
 * recommendation.
 *
 * The contract: derive the classification server-side through the frozen
 * Phase 4C service, build the recommendation from that exact trusted object,
 * persist only the three advisory fields, and never soften a failure.
 */

const diagnose = vi.mocked(diagnoseFinding);
const readPack = vi.mocked(assembleDiagnosisEvidencePackForFinding);
const persistRec = vi.mocked(persistFindingRecommendation);

const FINDING_ID = "55555555-5555-4555-8555-555555555555";
const RESULT_ID = "33333333-3333-4333-8333-333333333333";
const RUN_ID = "11111111-1111-4111-8111-111111111111";
const DIAGNOSED_AT = "2026-08-30T09:00:00.000Z";
const REC_UPDATED_AT = "2026-08-31T12:00:00.000Z";

function signals(
  overrides?: Partial<Record<DiagnosticSignalCode, DiagnosticSignalState>>,
): DiagnosticSignalSetV1 {
  return {
    version: DIAGNOSTIC_SIGNAL_VERSION,
    findingId: FINDING_ID,
    invariantResultId: RESULT_ID,
    signals: DIAGNOSTIC_SIGNAL_CODES.map((code) => ({
      code,
      state: overrides?.[code] ?? "UNKNOWN",
      blockingGapCodes:
        (overrides?.[code] ?? "UNKNOWN") === "UNKNOWN"
          ? (["CHAOS_EVIDENCE_UNAVAILABLE"] as const)
          : [],
    })),
  };
}

function pack(
  invariantId: InvariantResultInvariantId = "INV-005",
  scenarioId: ChaosScenarioId | null = "C03",
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
  };
}

/** A trusted Phase 4C result, built with the REAL frozen classifier. */
function trustedDiagnosis(
  evidencePack: DiagnosisEvidencePackV1,
  states?: Partial<Record<DiagnosticSignalCode, DiagnosticSignalState>>,
  persistenceOverrides: Record<string, unknown> = {},
) {
  const classification = realClassify(evidencePack, signals(states));
  return {
    classification,
    persistence: {
      kind: "DIAGNOSED" as const,
      diagnosisCode: classification.selected.code,
      diagnosisStrength: classification.selected.strength,
      diagnosedAt: DIAGNOSED_AT,
      updatedAt: DIAGNOSED_AT,
      ...persistenceOverrides,
    },
  };
}

function recommended(overrides: Record<string, unknown> = {}) {
  return {
    kind: "RECOMMENDED" as const,
    diagnosisSummary: "generated",
    recommendationCode: "INVESTIGATE-EVIDENCE-GAP" as const,
    recommendationText: "generated",
    updatedAt: REC_UPDATED_AT,
    ...overrides,
  };
}

class FakeServiceError extends Error {
  readonly code: string;
  constructor(code: string, name = "EvidencePackServiceError") {
    super("A fixed safe message.");
    this.name = name;
    this.code = code;
  }
}

/** Wires the happy path and returns the objects it used. */
function happyPath(
  states?: Partial<Record<DiagnosticSignalCode, DiagnosticSignalState>>,
  persistenceOverrides: Record<string, unknown> = {},
) {
  const evidencePack = pack();
  const diagnosis = trustedDiagnosis(evidencePack, states);
  diagnose.mockResolvedValue(diagnosis);
  readPack.mockResolvedValue(evidencePack);
  persistRec.mockResolvedValue(recommended(persistenceOverrides));
  return { evidencePack, diagnosis };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("Phase 4D-R2 — trusted orchestration", () => {
  it("1/2: the only input is a finding id, and diagnoseFinding is called once", async () => {
    happyPath();

    await recommendFinding(FINDING_ID);

    expect(diagnose).toHaveBeenCalledTimes(1);
    expect(diagnose).toHaveBeenCalledWith(FINDING_ID);
    expect(recommendFinding.length).toBe(1);
  });

  it("3/4/5: the service never re-runs or re-persists the diagnosis", async () => {
    const { diagnosis } = happyPath();

    const result = await recommendFinding(FINDING_ID);

    // Phase 4C's diagnosis writer is never reached from here.
    expect(persistFindingDiagnosis).not.toHaveBeenCalled();
    // And the classification is the very object diagnoseFinding produced —
    // reference identity, so no second classification was computed. A
    // re-classification would necessarily yield a different object.
    expect(result.diagnosis).toBe(diagnosis);
    expect(result.diagnosis.classification).toBe(diagnosis.classification);
    expect(result.diagnosis.classification.selected).toBe(
      diagnosis.classification.selected,
    );
  });

  it("6: exactly one recommendation Evidence Pack is assembled", async () => {
    happyPath();

    await recommendFinding(FINDING_ID);

    expect(readPack).toHaveBeenCalledTimes(1);
    expect(readPack).toHaveBeenCalledWith(FINDING_ID);
  });

  it("7/8: the recommendation is built from the EXACT trusted classification", async () => {
    const { diagnosis } = happyPath();

    const result = await recommendFinding(FINDING_ID);

    expect(result.diagnosis.classification).toBe(diagnosis.classification);
    expect(result.recommendation.diagnosis.rootCauseCode).toBe(
      diagnosis.classification.selected.code,
    );
    expect(result.recommendation.diagnosis.strength).toBe(
      diagnosis.classification.selected.strength,
    );
    expect(result.recommendation.findingId).toBe(FINDING_ID);
    expect(result.recommendation.invariantResultId).toBe(RESULT_ID);
  });

  it("9/10: the generated values are persisted and the diagnosis is only a guard", async () => {
    happyPath();

    const result = await recommendFinding(FINDING_ID);

    expect(persistRec).toHaveBeenCalledTimes(1);
    const call = persistRec.mock.calls[0]![0]!;

    expect(call.diagnosisSummary).toBe(
      result.recommendation.explanation.diagnosisSummary,
    );
    expect(call.recommendationCode).toBe(
      result.recommendation.recommendation.code,
    );
    expect(call.recommendationText).toBe(
      result.recommendation.recommendation.text,
    );

    // Phase 4C's fields travel under `expected*` names — preconditions only.
    expect(call.expectedDiagnosisCode).toBe("RC-016");
    expect(call.expectedDiagnosisStrength).toBe("INSUFFICIENT_EVIDENCE");
    expect(call.expectedDiagnosedAt).toBe(DIAGNOSED_AT);
    expect(Object.keys(call).sort()).toEqual([
      "attemptedAt",
      "diagnosisSummary",
      "expectedDiagnosedAt",
      "expectedDiagnosisCode",
      "expectedDiagnosisStrength",
      "findingId",
      "invariantResultId",
      "recommendationCode",
      "recommendationText",
    ]);
  });

  it("11/12: the RECOMMENDED path returns diagnosis, recommendation and persistence", async () => {
    happyPath();

    const result = await recommendFinding(FINDING_ID);

    expect(result.diagnosis.persistence.kind).toBe("DIAGNOSED");
    expect(result.persistence.kind).toBe("RECOMMENDED");
    expect(result.persistence.updatedAt).toBe(REC_UPDATED_AT);
    expect(result.recommendation.version).toBe(1);
  });

  it("13/14: ALREADY_RECOMMENDED preserves the original updated_at", async () => {
    happyPath(undefined, {
      kind: "ALREADY_RECOMMENDED",
      updatedAt: DIAGNOSED_AT,
    });

    const result = await recommendFinding(FINDING_ID);

    expect(result.persistence.kind).toBe("ALREADY_RECOMMENDED");
    expect(result.persistence.updatedAt).toBe(DIAGNOSED_AT);
    const attemptedAt = persistRec.mock.calls[0]![0]!.attemptedAt;
    expect(result.persistence.updatedAt).not.toBe(attemptedAt);
  });

  it("15: an RC-016 diagnosis yields INVESTIGATE-EVIDENCE-GAP", async () => {
    happyPath();

    const result = await recommendFinding(FINDING_ID);

    expect(result.recommendation.diagnosis.rootCauseCode).toBe("RC-016");
    expect(result.recommendation.recommendation.code).toBe(
      "INVESTIGATE-EVIDENCE-GAP",
    );
  });

  it("16/17/18: provenance versions are exposed end to end", async () => {
    happyPath();

    const result = await recommendFinding(FINDING_ID);

    expect(result.recommendation.templateVersion).toBe("TEMPLATE-V1");
    expect(result.recommendation.catalogueVersion).toBe(
      "RECOMMENDATION-CATALOGUE-V1",
    );
    expect(result.recommendation.outputSource).toBe("DETERMINISTIC_CATALOGUE");
    // The embedded trusted diagnosis keeps its own provenance.
    expect(result.diagnosis.classification.ruleVersion).toBe("DIAG-RULES-V1");
    expect(result.diagnosis.classification.outputSource).toBe(
      "DETERMINISTIC_RULES",
    );
  });

  it("19: a caller cannot supply a classification, pack or recommendation", async () => {
    happyPath();

    // The public signature takes one string. Extra arguments are ignored by
    // the runtime, and the trusted diagnosis is still derived server-side.
    const forged = { selected: { code: "RC-003" } };
    const result = await (
      recommendFinding as unknown as (
        id: string,
        extra?: unknown,
      ) => Promise<Awaited<ReturnType<typeof recommendFinding>>>
    )(FINDING_ID, forged);

    expect(result.recommendation.diagnosis.rootCauseCode).toBe("RC-016");
    expect(result.recommendation.recommendation.code).toBe(
      "INVESTIGATE-EVIDENCE-GAP",
    );
    expect(JSON.stringify(result)).not.toContain("FIX-WEBHOOK-AUTH");
    expect(diagnose).toHaveBeenCalledWith(FINDING_ID);
  });
});

describe("Phase 4D-R2 — error propagation", () => {
  it("20: a Phase 4C diagnosis error propagates unchanged", async () => {
    const thrown = new FakeServiceError("EVIDENCE_PACK_FINDING_NOT_FOUND");
    diagnose.mockRejectedValue(thrown);

    await expect(recommendFinding(FINDING_ID)).rejects.toBe(thrown);
    expect(readPack).not.toHaveBeenCalled();
    expect(persistRec).not.toHaveBeenCalled();
    expect(logEvent).not.toHaveBeenCalled();
  });

  it("21: a second Evidence Pack error propagates unchanged", async () => {
    const evidencePack = pack();
    diagnose.mockResolvedValue(trustedDiagnosis(evidencePack));
    const thrown = new FakeServiceError("EVIDENCE_PACK_READ_FAILED");
    readPack.mockRejectedValue(thrown);

    await expect(recommendFinding(FINDING_ID)).rejects.toBe(thrown);
    expect(persistRec).not.toHaveBeenCalled();
    expect(logEvent).not.toHaveBeenCalled();
  });

  it("22: a RecommendationError propagates unchanged", async () => {
    // A pack for a DIFFERENT finding makes the pure catalogue fail closed.
    const evidencePack = pack();
    diagnose.mockResolvedValue(trustedDiagnosis(evidencePack));
    const foreign = {
      ...evidencePack,
      finding: { ...evidencePack.finding, findingId: RUN_ID },
    } as unknown as DiagnosisEvidencePackV1;
    readPack.mockResolvedValue(foreign);

    await expect(recommendFinding(FINDING_ID)).rejects.toMatchObject({
      name: "RecommendationError",
      code: "RECOMMENDATION_INPUT_IDENTITY_MISMATCH",
    });
    expect(persistRec).not.toHaveBeenCalled();
    expect(logEvent).not.toHaveBeenCalled();
  });

  it("23/28: a recommendation persistence error propagates and prevents logging", async () => {
    const evidencePack = pack();
    diagnose.mockResolvedValue(trustedDiagnosis(evidencePack));
    readPack.mockResolvedValue(evidencePack);
    const thrown = new FakeServiceError(
      "RECOMMENDATION_PERSIST_INTEGRITY_CONFLICT",
      "RecommendationRepositoryError",
    );
    persistRec.mockRejectedValue(thrown);

    await expect(recommendFinding(FINDING_ID)).rejects.toBe(thrown);
    expect(logEvent).not.toHaveBeenCalled();
  });

  it("23b: no error is ever converted into RC-016 or an abstention", async () => {
    for (const setup of [
      () =>
        diagnose.mockRejectedValue(
          new FakeServiceError("EVIDENCE_PACK_READ_FAILED"),
        ),
      () => {
        const evidencePack = pack();
        diagnose.mockResolvedValue(trustedDiagnosis(evidencePack));
        readPack.mockResolvedValue(evidencePack);
        persistRec.mockRejectedValue(
          new FakeServiceError("RECOMMENDATION_PERSIST_UPDATE_FAILED"),
        );
      },
    ]) {
      vi.resetAllMocks();
      setup();

      let outcome: unknown = "did-not-resolve";
      try {
        outcome = await recommendFinding(FINDING_ID);
      } catch {
        outcome = "threw";
      }
      expect(outcome).toBe("threw");
    }
  });
});

describe("Phase 4D-R2 — two-stage durability", () => {
  it("24: a recommendation write failure does NOT roll back or retry the diagnosis", async () => {
    const evidencePack = pack();
    diagnose.mockResolvedValue(trustedDiagnosis(evidencePack));
    readPack.mockResolvedValue(evidencePack);
    persistRec.mockRejectedValue(
      new FakeServiceError("RECOMMENDATION_PERSIST_UPDATE_FAILED"),
    );

    await expect(recommendFinding(FINDING_ID)).rejects.toBeInstanceOf(Error);

    // The already-valid Phase 4C diagnosis stays persisted: no rollback, no
    // clearing, no second diagnosis attempt.
    expect(diagnose).toHaveBeenCalledTimes(1);
    expect(persistFindingDiagnosis).not.toHaveBeenCalled();
    expect(persistRec).toHaveBeenCalledTimes(1);
  });

  it("25: a later retry reuses ALREADY_DIAGNOSED and completes the recommendation", async () => {
    const evidencePack = pack();
    diagnose.mockResolvedValue(
      trustedDiagnosis(evidencePack, undefined, {
        kind: "ALREADY_DIAGNOSED",
      }),
    );
    readPack.mockResolvedValue(evidencePack);
    persistRec.mockResolvedValue(recommended());

    const result = await recommendFinding(FINDING_ID);

    expect(result.diagnosis.persistence.kind).toBe("ALREADY_DIAGNOSED");
    expect(result.persistence.kind).toBe("RECOMMENDED");
    // The original diagnosis timestamp is still the precondition.
    expect(persistRec.mock.calls[0]![0]!.expectedDiagnosedAt).toBe(
      DIAGNOSED_AT,
    );
  });
});

describe("Phase 4D-R2 — audit logging and side effects", () => {
  it("26: a logger failure after RECOMMENDED does not escape", async () => {
    happyPath();
    logEvent.mockImplementation(() => {
      throw new Error("synthetic logger failure");
    });

    const result = await recommendFinding(FINDING_ID);

    expect(result.persistence.kind).toBe("RECOMMENDED");
    expect(persistRec).toHaveBeenCalledTimes(1);
    expect(logEvent).toHaveBeenCalledTimes(1);
  });

  it("27: a logger failure after ALREADY_RECOMMENDED does not escape", async () => {
    happyPath(undefined, {
      kind: "ALREADY_RECOMMENDED",
      updatedAt: DIAGNOSED_AT,
    });
    logEvent.mockImplementation(() => {
      throw new Error("synthetic logger failure");
    });

    const result = await recommendFinding(FINDING_ID);

    expect(result.persistence.kind).toBe("ALREADY_RECOMMENDED");
    expect(result.persistence.updatedAt).toBe(DIAGNOSED_AT);
  });

  it("27b: the audit line carries no generated prose or secret", async () => {
    happyPath();

    const result = await recommendFinding(FINDING_ID);

    expect(logEvent).toHaveBeenCalledTimes(1);
    const [event, fields] = logEvent.mock.calls[0]!;
    expect(event).toBe("diagnosis.recommendation.persisted");

    const serialized = JSON.stringify(fields);
    // The long derived text is deliberately not duplicated into the log.
    expect(serialized).not.toContain(
      result.recommendation.explanation.diagnosisSummary,
    );
    expect(serialized).not.toContain(result.recommendation.recommendation.text);
    for (const forbidden of [
      "diagnosis_summary",
      "recommendation_text",
      "observedEvidence",
      "fault_config",
      "fault_state",
      "raw_payload_redacted",
      "RAZORPAY_KEY_SECRET",
      "SUPABASE_SERVICE_ROLE_KEY",
      "signature",
    ]) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
    for (const value of Object.values(fields as Record<string, unknown>)) {
      expect(["string", "number", "boolean"]).toContain(typeof value);
    }
    expect(fields).toMatchObject({
      finding_id: FINDING_ID,
      diagnosis_code: "RC-016",
      recommendation_code: "INVESTIGATE-EVIDENCE-GAP",
      diagnosis_rule_version: "DIAG-RULES-V1",
      recommendation_catalogue_version: "RECOMMENDATION-CATALOGUE-V1",
      template_version: "TEMPLATE-V1",
      recommendation_output_source: "DETERMINISTIC_CATALOGUE",
      persistence_kind: "RECOMMENDED",
    });
  });

  it("29/30: no regression execution and no payment, invariant or status mutation", async () => {
    happyPath();

    const result = await recommendFinding(FINDING_ID);
    const serialized = JSON.stringify(result);

    for (const forbidden of [
      "regression_runs",
      "regressionRunId",
      "executeScenario",
      "resolved_at",
      "resolvedAt",
      "STILL_FAILING",
      "reliabilityScore",
      "readiness",
      "goLive",
    ]) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
    // The advisory regression recommendation is present but inert.
    expect(result.recommendation.regressionRecommendation.scenarioId).toBe(
      "C03",
    );
    expect(
      result.recommendation.regressionRecommendation.hasApprovedScenario,
    ).toBe(true);
  });

  it("30b: neither supplied object is mutated", async () => {
    const { evidencePack, diagnosis } = happyPath();
    const packJson = JSON.stringify(evidencePack);
    const diagnosisJson = JSON.stringify(diagnosis);

    await recommendFinding(FINDING_ID);

    expect(JSON.stringify(evidencePack)).toBe(packJson);
    expect(JSON.stringify(diagnosis)).toBe(diagnosisJson);
  });
});
