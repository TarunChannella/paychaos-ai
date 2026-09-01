import { describe, expect, it } from "vitest";

import { getCurrentReliabilityScore } from "@/lib/reliability/service";
import {
  RELIABILITY_PROVENANCE_LABEL,
  RELIABILITY_REQUIRED_CLASSIFICATION,
} from "@/lib/reliability/types";

/**
 * Phase 4F-R3 — the reliability read path against the live Supabase project.
 *
 * THIS SUITE IS READ-ONLY AND OWNS NOTHING. Zero inserts, zero updates, zero
 * deletes, zero mutating RPC — so no fixture and no cleanup. It runs no chaos
 * scenario, makes no Razorpay call and fabricates no provider evidence.
 *
 * WHAT IT EXERCISES. The real route handler over the real service, repository
 * and Supabase read path. The route is imported and invoked directly rather
 * than over HTTP: booting a server here would add a second access-gate
 * configuration and an arbitrary port to the integration suite for no extra
 * assurance, since the browser-level proof already exists in Playwright.
 *
 * DELIBERATELY NOT PINNED TO TODAY'S NUMBER. Asserting `score === 85` would
 * mean the next legitimate chaos run breaks this suite — a standing incentive
 * not to run chaos. Every assertion is a deterministic property that must hold
 * whatever evidence exists.
 */

/** The route under test, invoked with the gate disabled (the suite default). */
async function callRoute() {
  const { GET } = await import("@/app/api/reliability/route");
  const { NextRequest } = await import("next/server");
  const request = new NextRequest("http://localhost/api/reliability", {
    method: "GET",
  });
  return GET(request);
}

describe("076 — the route returns a real calculated score", () => {
  it("1: responds 200 with the frozen versions and four scenarios", async () => {
    const response = await callRoute();
    expect(response.status).toBe(200);

    const payload = await response.json();
    expect(payload.score.algorithmVersion).toBe("RELIABILITY-V1");
    expect(payload.score.selectionVersion).toBe("LATEST_SELECTION_V1");
    expect(
      payload.score.scenarioBreakdown.map(
        (e: { scenarioId: string }) => e.scenarioId,
      ),
    ).toEqual(["C01", "C03", "C07", "C11"]);
    expect(
      payload.selectionDiagnostics.map(
        (d: { scenarioId: string }) => d.scenarioId,
      ),
    ).toEqual(["C01", "C03", "C07", "C11"]);
  });

  it("2: the score is a clamped integer consistent with its own breakdown", async () => {
    const payload = await (await callRoute()).json();

    const summed = payload.score.scenarioBreakdown.reduce(
      (total: number, entry: { deduction: number }) => total + entry.deduction,
      0,
    );
    expect(payload.score.totalDeduction).toBe(summed);
    expect(payload.score.score).toBe(Math.max(0, 100 - summed));
    expect(payload.score.score).toBeGreaterThanOrEqual(0);
    expect(payload.score.score).toBeLessThanOrEqual(100);
    expect(Number.isInteger(payload.score.score)).toBe(true);
  });

  it("3: the route body equals the service read model exactly", async () => {
    // The route adds no DTO of its own, so a caller sees the trusted model.
    const payload = await (await callRoute()).json();
    const model = await getCurrentReliabilityScore();

    // Compare the deterministic shape rather than requiring the two reads to
    // observe identical evidence — the same-snapshot equality proof lives in
    // 075, where it can be made without a second SELECT cycle.
    expect(Object.keys(payload).sort()).toEqual(Object.keys(model).sort());
    expect(Object.keys(payload.score).sort()).toEqual(
      Object.keys(model.score).sort(),
    );
  });

  it("4: no secret, credential or raw database field is exposed", async () => {
    const text = await (await callRoute()).text();

    for (const forbidden of [
      "SUPABASE",
      "supabase.co",
      "service_role",
      "PAYCHAOS_ACCESS_TOKEN",
      "PAYCHAOS_SESSION_SECRET",
      "rzp_",
      "PGRST",
      "fault_config",
      "fault_state",
      "raw_body_sha256",
    ]) {
      expect(text, forbidden).not.toContain(forbidden);
    }
  });
});

describe("076 — deterministic semantics hold against real data", () => {
  it("5: UNKNOWN, if present, deducts 15 and is never PASS", async () => {
    const payload = await (await callRoute()).json();

    for (const entry of payload.score.scenarioBreakdown) {
      if (entry.state === "UNKNOWN") {
        expect(entry.deduction, entry.scenarioId).toBe(15);
        expect(entry.state, entry.scenarioId).not.toBe("PASS");
      }
      if (entry.state === "PASS") {
        expect(entry.deduction, entry.scenarioId).toBe(0);
      }
      if (["BLOCKED", "ERROR", "NOT_RUN"].includes(entry.state)) {
        expect(entry.deduction, entry.scenarioId).toBe(15);
      }
      if (entry.state === "FAIL") {
        expect(entry.deduction, entry.scenarioId).toBeGreaterThan(0);
        expect(
          entry.supportingFailedInvariantResultId,
          entry.scenarioId,
        ).not.toBeNull();
      }
    }
  });

  it("6: a selected C03 run is a controlled simulation, never real evidence", async () => {
    const payload = await (await callRoute()).json();
    const c03 = payload.score.scenarioBreakdown.find(
      (e: { scenarioId: string }) => e.scenarioId === "C03",
    );

    if (c03.selectedRunId === null) return; // Legitimately possible.

    expect(c03.selectedDataClassification).toBe("SYNTHETIC_DEMO");
    expect(c03.provenanceLabel).toBe(
      RELIABILITY_PROVENANCE_LABEL.SYNTHETIC_DEMO,
    );
    expect(c03.provenanceLabel).toBe("Controlled PayChaos security simulation");
  });

  it("7: a selected C01/C07/C11 run is recorded test evidence", async () => {
    const payload = await (await callRoute()).json();

    for (const scenarioId of ["C01", "C07", "C11"]) {
      const entry = payload.score.scenarioBreakdown.find(
        (e: { scenarioId: string }) => e.scenarioId === scenarioId,
      );
      if (entry.selectedRunId === null) continue;

      expect(entry.selectedDataClassification, scenarioId).toBe(
        "RECORDED_TEST_EVIDENCE",
      );
      expect(entry.provenanceLabel, scenarioId).toBe(
        RELIABILITY_PROVENANCE_LABEL.RECORDED_TEST_EVIDENCE,
      );
    }
  });

  it("8: every selected run matches its scenario's required classification", async () => {
    const payload = await (await callRoute()).json();

    for (const entry of payload.score.scenarioBreakdown) {
      if (entry.selectedRunId === null) continue;
      expect(entry.selectedDataClassification, entry.scenarioId).toBe(
        RELIABILITY_REQUIRED_CLASSIFICATION[
          entry.scenarioId as keyof typeof RELIABILITY_REQUIRED_CLASSIFICATION
        ],
      );
    }
  });

  it("9: diagnostic count arithmetic is exact and consistent with selection", async () => {
    const payload = await (await callRoute()).json();

    for (const d of payload.selectionDiagnostics) {
      const entry = payload.score.scenarioBreakdown.find(
        (e: { scenarioId: string }) => e.scenarioId === d.scenarioId,
      );

      expect(d.ineligibleCandidateCount, d.scenarioId).toBe(
        d.totalCandidateCount - d.eligibleCandidateCount,
      );
      expect(d.eligibleCandidateCount, d.scenarioId).toBe(
        entry.eligibleCandidateCount,
      );

      if (entry.selectedRunId !== null) {
        expect(d.selectionReason, d.scenarioId).toBe("LATEST_ELIGIBLE_RUN");
      } else if (d.totalCandidateCount === 0) {
        expect(d.selectionReason, d.scenarioId).toBe("NO_CANDIDATES");
      } else {
        expect(d.selectionReason, d.scenarioId).toBe("NO_ELIGIBLE_CANDIDATES");
      }
    }
  });

  it("10: no readiness verdict leaks into the API response", async () => {
    // Go-Live Readiness is Phase 4G and must not appear early.
    const text = await (await callRoute()).text();

    for (const forbidden of [
      "NOT_READY",
      "NEEDS_ATTENTION",
      "NOT READY",
      "NEEDS ATTENTION",
      "readiness",
      "certified",
    ]) {
      expect(text, forbidden).not.toContain(forbidden);
    }
  });
});
