import { describe, expect, it } from "vitest";

import {
  loadSelectedRunInvariantEvidence,
  loadUnresolvedFindings,
} from "@/lib/readiness/repository";
import { getCurrentGoLiveReadiness } from "@/lib/readiness/service";
import {
  READINESS_ATTENTION_REASONS,
  READINESS_BLOCKING_REASONS,
  READINESS_DISCLAIMER,
  READINESS_GATE_IDS,
  READINESS_GATE_STATES,
  READINESS_STATUSES,
} from "@/lib/readiness/types";

/**
 * Phase 4G — Go-Live Readiness against the live Supabase project.
 *
 * THIS SUITE IS READ-ONLY AND OWNS NOTHING. It creates, updates and deletes
 * zero rows, so it needs no fixture and no cleanup. It executes no chaos
 * scenario, makes no Razorpay call and fabricates no provider evidence:
 * readiness is a pure read, and this proves that against the real database
 * rather than against a fake.
 *
 * DELIBERATELY NOT PINNED TO TODAY'S VERDICT. Asserting `status === "NEEDS
 * ATTENTION"` would break on the next legitimate chaos run, which would be a
 * standing incentive to avoid running chaos. Every assertion below is instead
 * a deterministic PROPERTY that must hold whatever evidence exists: the
 * frozen vocabulary, precedence, internal consistency between the gates and
 * the reasons, and — above all — that READY is never reached on absent
 * evidence. The current live reading is reported separately as an architect
 * audit observation, not frozen into a test.
 */

describe("077 — the readiness repository reads real persisted evidence", () => {
  it("1: unresolved findings load with a valid severity each", async () => {
    const findings = await loadUnresolvedFindings();

    // Zero unresolved findings is a legitimate state; the SHAPE is asserted.
    for (const finding of findings) {
      expect(typeof finding.findingId).toBe("string");
      expect(["CRITICAL", "HIGH", "MEDIUM", "LOW"]).toContain(finding.severity);
    }
  });

  it("2: selected-run invariant evidence loads for exactly the ids asked for", async () => {
    const model = await getCurrentGoLiveReadiness();
    const ids = model.reliability.score.scenarioBreakdown
      .map((entry) => entry.selectedRunId)
      .filter((id): id is string => id !== null);

    const evidence = await loadSelectedRunInvariantEvidence(ids);

    expect(evidence.map((entry) => entry.chaosRunId)).toEqual(ids);
    for (const entry of evidence) {
      for (const row of entry.results) {
        expect(["PASS", "FAIL", "UNKNOWN"]).toContain(row.result);
        expect(typeof row.invariantId).toBe("string");
      }
    }
  });

  it("3: an empty id list issues no query and returns nothing", async () => {
    await expect(loadSelectedRunInvariantEvidence([])).resolves.toEqual([]);
  });
});

describe("077 — the live assessment obeys the frozen contract", () => {
  it("4: the assessment carries the frozen version and disclaimer", async () => {
    const { readiness } = await getCurrentGoLiveReadiness();

    expect(readiness.version).toBe("GO-LIVE-READINESS-V1");
    expect(readiness.disclaimer).toBe(READINESS_DISCLAIMER);
    expect(readiness.disclaimer).toContain("not Razorpay certification");
  });

  it("5: the status is one of the three frozen values", async () => {
    const { readiness } = await getCurrentGoLiveReadiness();
    expect(READINESS_STATUSES as readonly string[]).toContain(readiness.status);
  });

  it("6: the full frozen gate checklist is present, in order", async () => {
    const { readiness } = await getCurrentGoLiveReadiness();

    expect(readiness.gates.map((gate) => gate.gateId)).toEqual([
      ...READINESS_GATE_IDS,
    ]);
    for (const gate of readiness.gates) {
      expect(READINESS_GATE_STATES as readonly string[]).toContain(gate.state);
      expect(gate.detail.length).toBeGreaterThan(0);
    }
  });

  it("7: every reason code belongs to the frozen vocabulary", async () => {
    const { readiness } = await getCurrentGoLiveReadiness();

    for (const reason of readiness.blockingReasons) {
      expect(READINESS_BLOCKING_REASONS as readonly string[]).toContain(
        reason.code,
      );
      expect(reason.text.length).toBeGreaterThan(0);
    }
    for (const reason of readiness.attentionReasons) {
      expect(READINESS_ATTENTION_REASONS as readonly string[]).toContain(
        reason.code,
      );
    }
  });

  it("8: precedence holds — any blocking reason means NOT READY", async () => {
    const { readiness } = await getCurrentGoLiveReadiness();

    if (readiness.blockingReasons.length > 0) {
      expect(readiness.status).toBe("NOT READY");
    } else {
      expect(readiness.status).not.toBe("NOT READY");
    }
  });

  it("9: NEEDS ATTENTION and READY are exactly determined by the reasons", async () => {
    const { readiness } = await getCurrentGoLiveReadiness();

    if (readiness.status === "READY") {
      expect(readiness.blockingReasons).toEqual([]);
      expect(readiness.attentionReasons).toEqual([]);
    }
    if (
      readiness.blockingReasons.length === 0 &&
      readiness.attentionReasons.length > 0
    ) {
      expect(readiness.status).toBe("NEEDS ATTENTION");
    }
  });

  it("10: a status is never reported without a reason for it", async () => {
    const { readiness } = await getCurrentGoLiveReadiness();

    if (readiness.status !== "READY") {
      expect(
        readiness.blockingReasons.length + readiness.attentionReasons.length,
      ).toBeGreaterThan(0);
    }
  });
});

describe("077 — READY is never reached on absent or unverified evidence", () => {
  it("11: an UNKNOWN gate makes READY impossible", async () => {
    // The core safety property, checked against whatever the live database
    // currently holds.
    const { readiness } = await getCurrentGoLiveReadiness();

    const unknownGates = readiness.gates.filter(
      (gate) => gate.state === "UNKNOWN",
    );
    if (unknownGates.length > 0) {
      expect(readiness.status).not.toBe("READY");
    }
  });

  it("12: a FAILED gate makes READY impossible", async () => {
    const { readiness } = await getCurrentGoLiveReadiness();

    if (readiness.gates.some((gate) => gate.state === "FAIL")) {
      expect(readiness.status).not.toBe("READY");
    }
  });

  it("13: an unresolved CRITICAL or HIGH finding always blocks", async () => {
    const findings = await loadUnresolvedFindings();
    const { readiness } = await getCurrentGoLiveReadiness();

    const highRisk = findings.filter(
      (finding) =>
        finding.severity === "CRITICAL" || finding.severity === "HIGH",
    );
    if (highRisk.length > 0) {
      expect(readiness.status).toBe("NOT READY");
      expect(readiness.blockingReasons.map((r) => r.code)).toContain(
        "NR_UNRESOLVED_HIGH_RISK_FINDING",
      );
    }
  });

  it("14: a score below 100 always prevents READY", async () => {
    const model = await getCurrentGoLiveReadiness();

    if (model.reliability.score.score < 100) {
      expect(model.readiness.status).not.toBe("READY");
    }
  });
});

describe("077 — the assessment is derived, deterministic and unstored", () => {
  it("15: the frozen 4F read model is carried through unmodified", async () => {
    const model = await getCurrentGoLiveReadiness();

    expect(model.reliability.score.algorithmVersion).toBe("RELIABILITY-V1");
    expect(model.reliability.score.selectionVersion).toBe(
      "LATEST_SELECTION_V1",
    );
    expect(model.reliability.score.scenarioBreakdown).toHaveLength(4);
  });

  it("16: two consecutive reads of unchanged evidence agree", async () => {
    const first = await getCurrentGoLiveReadiness();
    const second = await getCurrentGoLiveReadiness();

    // Same evidence, same verdict: no clock, no randomness, no accumulator.
    expect(second.readiness).toEqual(first.readiness);
  });

  it("17: no readiness row is created by assessing readiness", async () => {
    const before = await loadUnresolvedFindings();
    await getCurrentGoLiveReadiness();
    const after = await loadUnresolvedFindings();

    // Readiness is derived on demand and stored nowhere; assessing it must
    // not disturb the evidence it read.
    expect(after).toEqual(before);
  });

  it("18: no secret or provider credential appears in the assessment", async () => {
    const model = await getCurrentGoLiveReadiness();
    const serialized = JSON.stringify(model);

    for (const forbidden of [
      "rzp_live",
      "rzp_test_",
      "key_secret",
      "keySecret",
      "webhook_secret",
      "webhookSecret",
      "service_role",
      "eyJ",
    ]) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
  });
});
