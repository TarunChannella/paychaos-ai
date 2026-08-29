import { describe, expect, it } from "vitest";

import {
  buildEvidenceTimeline,
  toProvenance,
} from "@/lib/evidence/timeline-model";
import type { ChaosRunEvidenceBundleV1 } from "@/lib/evidence/chaos-run-evidence";
import type { SafeInvariantResultView } from "@/lib/chaos/run-read-model";

/**
 * Phase 3H — the timeline is PURE and FACTUAL.
 *
 * An item exists only when a persisted row supports it. A gap stays a gap.
 * No inferred provider delivery, no invented timestamp, no assumed state.
 */

const RUN_ID = "99999999-9999-4999-8999-999999999999";
const WEBHOOK_ID = "11111111-1111-4111-8111-111111111111";
const CAPTURE_WEBHOOK_ID = "11111111-1111-4111-8111-111111111112";
const ATTEMPT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const REPLAY_ATTEMPT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";

function webhook(overrides: Record<string, unknown> = {}) {
  return {
    id: WEBHOOK_ID,
    razorpayEventId: "evt_test_1",
    eventType: "payment.captured",
    sourceKind: "REAL_RAZORPAY_WEBHOOK",
    signatureVerified: true,
    processingStatus: "PROCESSED",
    duplicateDeliveryCount: 0,
    receivedAt: "2026-08-20T09:58:00.000Z",
    paymentAttemptId: null,
    paymentId: null,
    razorpayPaymentId: null,
    amountSubunits: null,
    currency: null,
    ...overrides,
  } as never;
}

function attempt(overrides: Record<string, unknown> = {}) {
  return {
    id: ATTEMPT_ID,
    webhookEventId: WEBHOOK_ID,
    chaosRunId: null,
    sourceKind: "REAL_RAZORPAY_WEBHOOK",
    status: "SUCCEEDED",
    isDuplicateDelivery: false,
    paymentAttemptId: null,
    paymentId: null,
    errorCode: null,
    startedAt: "2026-08-20T09:59:00.000Z",
    finishedAt: "2026-08-20T09:59:01.000Z",
    stateBefore: { kind: "NOT_CAPTURED" },
    stateAfter: { kind: "NOT_CAPTURED" },
    ...overrides,
  } as never;
}

function bundle(
  overrides: Record<string, unknown> = {},
): ChaosRunEvidenceBundleV1 {
  return {
    version: 1,
    run: {
      id: RUN_ID,
      scenarioId: "C01",
      status: "COMPLETED",
      outcome: "UNKNOWN",
      faultType: "REPLAY_EVENT",
      dataClassification: "RECORDED_TEST_EVIDENCE",
      orderId: null,
      paymentAttemptId: null,
      paymentId: null,
      sourceWebhookEventId: WEBHOOK_ID,
      failedPrecheckId: null,
      executionBlockCode: null,
      startedAt: "2026-08-20T09:57:00.000Z",
      completedAt: "2026-08-20T10:01:00.000Z",
    },
    requiredInvariantIds: [],
    sourceWebhook: webhook(),
    originalProcessingAttempts: [],
    chaosProcessingAttempts: [],
    canonicalSourceEventCount: 1,
    authoritativeCapture: { kind: "NONE_OBSERVED" },
    authoritativeCaptureWebhook: null,
    scenarioEvidence: { kind: "C01" },
    evidenceRefs: [],
    gaps: [],
    ...overrides,
  } as unknown as ChaosRunEvidenceBundleV1;
}

function result(
  overrides: Partial<SafeInvariantResultView> = {},
): SafeInvariantResultView {
  return {
    id: "res-1",
    invariantId: "INV-001",
    invariantVersion: "1",
    invariantName: "Unique Webhook Protected Logic Once",
    result: "UNKNOWN",
    severity: "CRITICAL",
    expectedSummary: "expected",
    observedSummary: "observed",
    reason: "reason",
    evidenceRefs: [],
    evaluatedAt: "2026-08-20T10:02:00.000Z",
    finding: null,
    ...overrides,
  };
}

describe("Phase 3H timeline — provenance is read, never decided", () => {
  it("1: every implemented stored value maps to itself", () => {
    for (const value of [
      "REAL_RAZORPAY_WEBHOOK",
      "PAYCHAOS_REPLAY",
      "RECORDED_TEST_EVIDENCE",
      "SYNTHETIC_DEMO",
    ] as const) {
      expect(toProvenance(value)).toBe(value);
    }
  });

  it("2: PAYCHAOS_SIMULATION is NOT a recognised provenance — no schema stores it", () => {
    expect(toProvenance("PAYCHAOS_SIMULATION")).toBe("UNRECOGNISED");
  });

  it("3: TEST_FIXTURE is not evidence provenance either", () => {
    expect(toProvenance("TEST_FIXTURE")).toBe("UNRECOGNISED");
  });

  it("4: an unknown value is flagged, never silently mapped to a real one", () => {
    for (const value of ["", "real", "RAZORPAY", "anything"]) {
      expect(toProvenance(value)).toBe("UNRECOGNISED");
    }
  });

  it("5: no timeline ever emits PAYCHAOS_SIMULATION", () => {
    const timeline = buildEvidenceTimeline(
      bundle({
        originalProcessingAttempts: [attempt()],
        chaosProcessingAttempts: [
          attempt({ id: REPLAY_ATTEMPT_ID, sourceKind: "PAYCHAOS_REPLAY" }),
        ],
      }),
      [result()],
    );
    expect(JSON.stringify(timeline)).not.toContain("PAYCHAOS_SIMULATION");
  });
});

describe("Phase 3H timeline — real, replay and classification are distinct", () => {
  it("6: a real webhook and a replay attempt carry different provenance", () => {
    const timeline = buildEvidenceTimeline(
      bundle({
        originalProcessingAttempts: [attempt()],
        chaosProcessingAttempts: [
          attempt({
            id: REPLAY_ATTEMPT_ID,
            sourceKind: "PAYCHAOS_REPLAY",
            chaosRunId: RUN_ID,
          }),
        ],
      }),
      [],
    );

    const source = timeline.items.find((i) => i.kind === "SOURCE_WEBHOOK")!;
    const original = timeline.items.find(
      (i) => i.kind === "ORIGINAL_PROCESSING_ATTEMPT",
    )!;
    const replay = timeline.items.find(
      (i) => i.kind === "PAYCHAOS_REPLAY_ATTEMPT",
    )!;

    expect(source.provenance).toBe("REAL_RAZORPAY_WEBHOOK");
    expect(original.provenance).toBe("REAL_RAZORPAY_WEBHOOK");
    expect(replay.provenance).toBe("PAYCHAOS_REPLAY");
    expect(replay.provenance).not.toBe(source.provenance);
  });

  it("7: RECORDED_TEST_EVIDENCE and SYNTHETIC_DEMO runs are distinguishable", () => {
    const recorded = buildEvidenceTimeline(bundle(), []);
    const synthetic = buildEvidenceTimeline(
      bundle({
        run: { ...bundle().run, dataClassification: "SYNTHETIC_DEMO" },
      }),
      [],
    );

    const runItem = (t: ReturnType<typeof buildEvidenceTimeline>) =>
      t.items.find((i) => i.kind === "SCENARIO_EVIDENCE")!;

    expect(runItem(recorded).provenance).toBe("RECORDED_TEST_EVIDENCE");
    expect(runItem(synthetic).provenance).toBe("SYNTHETIC_DEMO");
  });
});

describe("Phase 3H timeline — factual items only", () => {
  it("8: a run with no source webhook emits no source item", () => {
    const timeline = buildEvidenceTimeline(bundle({ sourceWebhook: null }), []);
    expect(timeline.items.some((i) => i.kind === "SOURCE_WEBHOOK")).toBe(false);
  });

  it("9: one row filling two roles is NOT emitted twice", () => {
    // The canonical source event IS the verified capture — one delivery.
    const timeline = buildEvidenceTimeline(
      bundle({
        sourceWebhook: webhook(),
        authoritativeCaptureWebhook: webhook(),
      }),
      [],
    );
    expect(
      timeline.items.filter((i) => i.kind === "SOURCE_WEBHOOK"),
    ).toHaveLength(1);
  });

  it("10: a genuinely separate capture event IS emitted", () => {
    const timeline = buildEvidenceTimeline(
      bundle({
        sourceWebhook: webhook(),
        authoritativeCaptureWebhook: webhook({ id: CAPTURE_WEBHOOK_ID }),
      }),
      [],
    );
    expect(
      timeline.items.filter((i) => i.kind === "SOURCE_WEBHOOK"),
    ).toHaveLength(2);
  });

  it("11: one item per persisted invariant result, and no more", () => {
    const timeline = buildEvidenceTimeline(bundle(), [
      result({ id: "a", invariantId: "INV-001" }),
      result({ id: "b", invariantId: "INV-002", result: "PASS" }),
    ]);
    const evaluated = timeline.items.filter(
      (i) => i.kind === "INVARIANT_EVALUATED",
    );
    expect(evaluated).toHaveLength(2);
    expect(evaluated[0]!.label).toContain("UNKNOWN");
    expect(evaluated[1]!.label).toContain("PASS");
  });

  it("12: no Finding item exists when no Finding was created", () => {
    const timeline = buildEvidenceTimeline(bundle(), [result()], []);
    expect(timeline.items.some((i) => i.kind === "FINDING_CREATED")).toBe(
      false,
    );
  });

  it("13: a Finding item appears only for a real persisted Finding", () => {
    const timeline = buildEvidenceTimeline(
      bundle(),
      [result({ result: "FAIL" })],
      [
        {
          findingId: "f-1",
          invariantResultId: "res-1",
          status: "OPEN",
          title: "INV-001 — Unique Webhook Protected Logic Once",
          createdAt: "2026-08-20T10:03:00.000Z",
        },
      ],
    );
    const finding = timeline.items.find((i) => i.kind === "FINDING_CREATED")!;
    expect(finding.subjectId).toBe("f-1");
    expect(finding.occurredAt).toBe("2026-08-20T10:03:00.000Z");
  });
});

describe("Phase 3H timeline — gaps stay gaps", () => {
  it("14: a NOT_CAPTURED snapshot becomes a gap note, never a state item", () => {
    const timeline = buildEvidenceTimeline(
      bundle({ originalProcessingAttempts: [attempt()] }),
      [],
    );

    expect(timeline.items.some((i) => i.kind === "STATE_SNAPSHOT")).toBe(false);
    expect(timeline.gaps.filter((g) => g.kind === "NOT_CAPTURED")).toHaveLength(
      2,
    );
    expect(timeline.gaps[0]!.label).toContain("never captured");
  });

  it("15: a CAPTURED snapshot becomes a real item", () => {
    const timeline = buildEvidenceTimeline(
      bundle({
        originalProcessingAttempts: [
          attempt({
            stateBefore: { kind: "CAPTURED", snapshot: { version: 1 } },
            stateAfter: { kind: "CAPTURED", snapshot: { version: 1 } },
          }),
        ],
      }),
      [],
    );
    expect(
      timeline.items.filter((i) => i.kind === "STATE_SNAPSHOT"),
    ).toHaveLength(2);
    expect(timeline.gaps).toHaveLength(0);
  });

  it("16: an INVALID snapshot is reported as invalid, not as captured", () => {
    const timeline = buildEvidenceTimeline(
      bundle({
        originalProcessingAttempts: [
          attempt({ stateBefore: { kind: "INVALID" } }),
        ],
      }),
      [],
    );
    expect(timeline.gaps.some((g) => g.kind === "INVALID")).toBe(true);
    expect(
      timeline.items.filter((i) => i.kind === "STATE_SNAPSHOT"),
    ).toHaveLength(0);
  });

  it("17: assembler gap codes are classified, and their code is preserved", () => {
    const timeline = buildEvidenceTimeline(
      bundle({
        gaps: [
          { code: "MISSING_STATE_BEFORE", subjectId: ATTEMPT_ID },
          { code: "MISSING_ORDER_REFERENCE", subjectId: null },
          {
            code: "AMBIGUOUS_AUTHORITATIVE_ORIGINAL_PROCESSING_ATTEMPT",
            subjectId: null,
          },
        ],
      }),
      [],
    );

    const byCode = new Map(timeline.gaps.map((g) => [g.code, g.kind]));
    expect(byCode.get("MISSING_STATE_BEFORE")).toBe("NOT_CAPTURED");
    expect(byCode.get("MISSING_ORDER_REFERENCE")).toBe("NO_SUBJECT");
    expect(
      byCode.get("AMBIGUOUS_AUTHORITATIVE_ORIGINAL_PROCESSING_ATTEMPT"),
    ).toBe("SEARCH_INCOMPLETE");
  });
});

describe("Phase 3H timeline — no invented timestamps", () => {
  it("18: every item's timestamp comes from a persisted field", () => {
    const timeline = buildEvidenceTimeline(
      bundle({ originalProcessingAttempts: [attempt()] }),
      [result()],
    );
    const known = new Set([
      "2026-08-20T09:57:00.000Z", // run.startedAt
      "2026-08-20T09:58:00.000Z", // webhook.receivedAt
      "2026-08-20T09:59:00.000Z", // attempt.startedAt
      "2026-08-20T10:02:00.000Z", // result.evaluatedAt
    ]);
    for (const item of timeline.items) {
      if (item.occurredAt === null) continue;
      expect(known.has(item.occurredAt), item.occurredAt).toBe(true);
    }
  });

  it("19: a null timestamp stays null and sorts last, never substituted", () => {
    const timeline = buildEvidenceTimeline(
      bundle({ run: { ...bundle().run, startedAt: null } }),
      [],
    );
    const runItem = timeline.items.find((i) => i.kind === "SCENARIO_EVIDENCE")!;
    expect(runItem.occurredAt).toBeNull();
    expect(timeline.items[timeline.items.length - 1]!.occurredAt).toBeNull();
  });

  it("19a: a run WITH a startedAt is labelled as having started", () => {
    const timeline = buildEvidenceTimeline(bundle(), []);
    const runItem = timeline.items.find((i) => i.kind === "SCENARIO_EVIDENCE")!;
    expect(runItem.label).toContain("Chaos run started");
    expect(runItem.occurredAt).toBe("2026-08-20T09:57:00.000Z");
  });

  it("19b: a BLOCKED run with NULL startedAt never claims it started", () => {
    // A precheck-blocked run was never executed. Saying "started" would be an
    // invented event — exactly what this model exists to prevent.
    const timeline = buildEvidenceTimeline(
      bundle({
        run: {
          ...bundle().run,
          status: "BLOCKED",
          outcome: null,
          startedAt: null,
          completedAt: null,
          failedPrecheckId: "PRECHECK-08",
        },
      }),
      [],
    );
    const runItem = timeline.items.find((i) => i.kind === "SCENARIO_EVIDENCE")!;

    expect(runItem.label).not.toContain("run started");
    expect(runItem.label.toLowerCase()).not.toContain("started");
    // Still shown as the factual audit record it is.
    expect(runItem.label).toContain("Chaos run record");
    expect(runItem.label).toContain("never executed");
    expect(runItem.occurredAt).toBeNull();
  });

  it("19c: a blocked run's timeline claims no execution anywhere", () => {
    const timeline = buildEvidenceTimeline(
      bundle({
        run: {
          ...bundle().run,
          status: "BLOCKED",
          outcome: null,
          startedAt: null,
          completedAt: null,
        },
        sourceWebhook: null,
        originalProcessingAttempts: [],
        chaosProcessingAttempts: [],
      }),
      [],
    );

    // No processing attempt, no snapshot, no evaluation — only the record.
    expect(timeline.items).toHaveLength(1);
    expect(timeline.items[0]!.kind).toBe("SCENARIO_EVIDENCE");
    expect(JSON.stringify(timeline)).not.toContain("run started");
    // And no timestamp was invented to fill the gap.
    expect(timeline.items[0]!.occurredAt).toBeNull();
  });

  it("20: items are ordered by their persisted timestamps", () => {
    const timeline = buildEvidenceTimeline(
      bundle({ originalProcessingAttempts: [attempt()] }),
      [result()],
    );
    const stamps = timeline.items
      .map((i) => i.occurredAt)
      .filter((t): t is string => t !== null);
    expect([...stamps].sort()).toEqual(stamps);
  });

  it("21: the model is pure — the same input yields an identical timeline", () => {
    const input = bundle({ originalProcessingAttempts: [attempt()] });
    const first = buildEvidenceTimeline(input, [result()]);
    const second = buildEvidenceTimeline(input, [result()]);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("22: no raw payload, signature or PII reaches a timeline item", () => {
    const serialized = JSON.stringify(
      buildEvidenceTimeline(
        bundle({ originalProcessingAttempts: [attempt()] }),
        [result()],
      ),
    ).toLowerCase();
    for (const forbidden of [
      "raw_payload",
      "normalized_event",
      "raw_body_sha256",
      "signature:",
      "cvv",
      "otp",
      "fault_config",
    ]) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
  });
});
