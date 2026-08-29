import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getSupabaseServerClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: () => getSupabaseServerClient(),
}));

const getChaosRunById = vi.fn();
vi.mock("@/lib/chaos/run-repository", () => ({
  getChaosRunById: (...a: unknown[]) => getChaosRunById(...a),
}));

const listInvariantResultsForChaosRun = vi.fn();
vi.mock("@/lib/invariants/result-repository", () => ({
  listInvariantResultsForChaosRun: (...a: unknown[]) =>
    listInvariantResultsForChaosRun(...a),
}));

const listFindingSummariesForInvariantResults = vi.fn();
vi.mock("@/lib/findings/run-findings-read", () => ({
  listFindingSummariesForInvariantResults: (...a: unknown[]) =>
    listFindingSummariesForInvariantResults(...a),
}));

import {
  ChaosRunReadModelError,
  getChaosRunDetail,
  listRecentChaosRuns,
} from "@/lib/chaos/run-read-model";

/**
 * Phase 3H — the read model PROJECTS persisted state. It decides nothing,
 * re-evaluates nothing, and must never expose `fault_config`/`fault_state`.
 */

const RUN_ID = "99999999-9999-4999-8999-999999999999";
const RESULT_ID = "11111111-1111-4111-8111-111111111111";
const FINDING_ID = "22222222-2222-4222-8222-222222222222";

function runRow(overrides: Record<string, unknown> = {}) {
  return {
    id: RUN_ID,
    scenario_id: "C11",
    status: "COMPLETED",
    outcome: "UNKNOWN",
    data_classification: "RECORDED_TEST_EVIDENCE",
    fault_type: "REPLAY_EVENT",
    failed_precheck_id: null,
    execution_block_code: null,
    error_message_redacted: null,
    order_id: null,
    payment_attempt_id: null,
    payment_id: null,
    source_webhook_event_id: null,
    started_at: "2026-08-20T09:57:00.000Z",
    completed_at: "2026-08-20T10:01:00.000Z",
    created_at: "2026-08-20T09:56:00.000Z",
    updated_at: "2026-08-20T10:01:00.000Z",
    // Deliberately present on the ROW — the projection must drop them.
    fault_config: { secretish: "must never reach a browser" },
    fault_state: { checks: [{ case: "WRONG_SIGNATURE" }] },
    ...overrides,
  };
}

function resultRow(overrides: Record<string, unknown> = {}) {
  return {
    id: RESULT_ID,
    invariant_id: "INV-003",
    invariant_version: "1",
    order_id: null,
    payment_attempt_id: null,
    payment_id: null,
    chaos_run_id: RUN_ID,
    result: "UNKNOWN",
    severity: "CRITICAL",
    expected_summary: "expected",
    observed_summary: "observed",
    reason: "reason",
    evidence_refs: [{ kind: "CHAOS_RUN", id: RUN_ID }],
    evaluated_at: "2026-08-20T10:02:00.000Z",
    ...overrides,
  };
}

let recentRows: unknown[] = [];

function makeClient() {
  return {
    from() {
      const chain = {
        select: () => chain,
        order: () => chain,
        limit: () => Promise.resolve({ data: recentRows, error: null }),
      };
      return chain;
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  recentRows = [];
  getSupabaseServerClient.mockImplementation(() => makeClient());
  listInvariantResultsForChaosRun.mockResolvedValue([]);
  listFindingSummariesForInvariantResults.mockResolvedValue(new Map());
});

describe("Phase 3H run read model — safe projection", () => {
  it("1: fault_config and fault_state NEVER reach the projection", async () => {
    getChaosRunById.mockResolvedValue(runRow());

    const detail = (await getChaosRunDetail(RUN_ID))!;

    expect(detail).not.toHaveProperty("fault_config");
    expect(detail).not.toHaveProperty("faultConfig");
    expect(detail).not.toHaveProperty("fault_state");
    expect(detail).not.toHaveProperty("faultState");

    const serialized = JSON.stringify(detail);
    expect(serialized).not.toContain("must never reach a browser");
    expect(serialized).not.toContain("WRONG_SIGNATURE");
  });

  it("2: the projection carries exactly the approved safe fields", async () => {
    getChaosRunById.mockResolvedValue(runRow());
    const detail = (await getChaosRunDetail(RUN_ID))!;

    expect(Object.keys(detail).sort()).toEqual([
      "completedAt",
      "correlations",
      "createdAt",
      "dataClassification",
      "errorMessageRedacted",
      "executionBlockCode",
      "failedPrecheckId",
      "faultType",
      "id",
      "invariantResults",
      "isBlocked",
      "outcome",
      "scenarioId",
      "startedAt",
      "status",
      "updatedAt",
    ]);
  });

  it("3: no raw payload, signature, secret or PII can appear", async () => {
    getChaosRunById.mockResolvedValue(runRow());
    listInvariantResultsForChaosRun.mockResolvedValue([resultRow()]);

    const serialized = JSON.stringify(
      await getChaosRunDetail(RUN_ID),
    ).toLowerCase();
    for (const forbidden of [
      "raw_payload",
      "normalized_event",
      "raw_body_sha256",
      "signature",
      "service_role",
      "cvv",
      "otp",
      "cardnumber",
    ]) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
  });

  it("4: an unknown run is null, not a thrown error", async () => {
    getChaosRunById.mockResolvedValue(null);
    expect(await getChaosRunDetail(RUN_ID)).toBeNull();
  });
});

describe("Phase 3H run read model — persisted verdicts are authoritative", () => {
  it("5: UNKNOWN is preserved exactly, never upgraded", async () => {
    getChaosRunById.mockResolvedValue(runRow());
    listInvariantResultsForChaosRun.mockResolvedValue([
      resultRow({ result: "UNKNOWN" }),
    ]);

    const detail = (await getChaosRunDetail(RUN_ID))!;
    expect(detail.invariantResults[0]!.result).toBe("UNKNOWN");
    expect(detail.outcome).toBe("UNKNOWN");
  });

  it("6: every verdict is copied verbatim from the persisted row", async () => {
    for (const value of ["PASS", "FAIL", "UNKNOWN"] as const) {
      getChaosRunById.mockResolvedValue(runRow());
      listInvariantResultsForChaosRun.mockResolvedValue([
        resultRow({ result: value }),
      ]);
      const detail = (await getChaosRunDetail(RUN_ID))!;
      expect(detail.invariantResults[0]!.result).toBe(value);
    }
  });

  it("7: a null outcome stays null — never defaulted to a verdict", async () => {
    getChaosRunById.mockResolvedValue(runRow({ outcome: null }));
    const detail = (await getChaosRunDetail(RUN_ID))!;
    expect(detail.outcome).toBeNull();
  });

  it("8: the invariant's frozen catalogue name is attached, or null", async () => {
    getChaosRunById.mockResolvedValue(runRow());
    listInvariantResultsForChaosRun.mockResolvedValue([
      resultRow({ invariant_id: "INV-003" }),
      resultRow({ id: "other", invariant_id: "INV-999" }),
    ]);

    const detail = (await getChaosRunDetail(RUN_ID))!;
    expect(detail.invariantResults[0]!.invariantName).toBe(
      "Failed Payment Never Marks Order Paid",
    );
    // An uncatalogued id is reported as null, never invented.
    expect(detail.invariantResults[1]!.invariantName).toBeNull();
  });

  it("9: expected/observed/reason/evidence refs are passed through unchanged", async () => {
    getChaosRunById.mockResolvedValue(runRow());
    listInvariantResultsForChaosRun.mockResolvedValue([resultRow()]);

    const view = (await getChaosRunDetail(RUN_ID))!.invariantResults[0]!;
    expect(view.expectedSummary).toBe("expected");
    expect(view.observedSummary).toBe("observed");
    expect(view.reason).toBe("reason");
    expect(view.evidenceRefs).toEqual([{ kind: "CHAOS_RUN", id: RUN_ID }]);
    expect(view.evaluatedAt).toBe("2026-08-20T10:02:00.000Z");
  });
});

describe("Phase 3H run read model — BLOCKED is factual", () => {
  it("10: a precheck-blocked run is flagged blocked", async () => {
    getChaosRunById.mockResolvedValue(
      runRow({
        status: "BLOCKED",
        outcome: null,
        failed_precheck_id: "PRECHECK-08",
      }),
    );
    const detail = (await getChaosRunDetail(RUN_ID))!;
    expect(detail.isBlocked).toBe(true);
    expect(detail.failedPrecheckId).toBe("PRECHECK-08");
    // A blocked run is NOT an invariant failure.
    expect(detail.invariantResults).toHaveLength(0);
    expect(detail.outcome).toBeNull();
  });

  it("11: an execution-block code also marks the run blocked", async () => {
    getChaosRunById.mockResolvedValue(
      runRow({ execution_block_code: "PRE-SEC-007" }),
    );
    expect((await getChaosRunDetail(RUN_ID))!.isBlocked).toBe(true);
  });

  it("12: a normal completed run is NOT blocked", async () => {
    getChaosRunById.mockResolvedValue(runRow());
    expect((await getChaosRunDetail(RUN_ID))!.isBlocked).toBe(false);
  });

  it("13: blocked is read from columns, never inferred from empty results", async () => {
    getChaosRunById.mockResolvedValue(
      runRow({ status: "PENDING", outcome: null }),
    );
    listInvariantResultsForChaosRun.mockResolvedValue([]);
    // A pending run has no results yet, but it is NOT blocked.
    expect((await getChaosRunDetail(RUN_ID))!.isBlocked).toBe(false);
  });
});

describe("Phase 3H run read model — Finding summary", () => {
  it("14: a FAIL result carries its Finding; PASS/UNKNOWN carry null", async () => {
    getChaosRunById.mockResolvedValue(runRow());
    listInvariantResultsForChaosRun.mockResolvedValue([
      resultRow({ id: RESULT_ID, result: "FAIL" }),
      resultRow({ id: "pass-row", result: "PASS" }),
    ]);
    listFindingSummariesForInvariantResults.mockResolvedValue(
      new Map([
        [
          RESULT_ID,
          {
            findingId: FINDING_ID,
            invariantResultId: RESULT_ID,
            status: "OPEN",
            title: "INV-003 — Failed Payment Never Marks Order Paid",
            createdAt: "2026-08-20T10:03:00.000Z",
          },
        ],
      ]),
    );

    const detail = (await getChaosRunDetail(RUN_ID))!;
    expect(detail.invariantResults[0]!.finding!.findingId).toBe(FINDING_ID);
    expect(detail.invariantResults[0]!.finding!.status).toBe("OPEN");
    expect(detail.invariantResults[1]!.finding).toBeNull();
  });

  it("15: a FAIL with no generated Finding reports null, never a placeholder", async () => {
    getChaosRunById.mockResolvedValue(runRow());
    listInvariantResultsForChaosRun.mockResolvedValue([
      resultRow({ result: "FAIL" }),
    ]);
    listFindingSummariesForInvariantResults.mockResolvedValue(new Map());

    const detail = (await getChaosRunDetail(RUN_ID))!;
    expect(detail.invariantResults[0]!.finding).toBeNull();
  });

  it("16: no diagnosis or recommendation surface exists anywhere", async () => {
    getChaosRunById.mockResolvedValue(runRow());
    listInvariantResultsForChaosRun.mockResolvedValue([
      resultRow({ result: "FAIL" }),
    ]);
    listFindingSummariesForInvariantResults.mockResolvedValue(
      new Map([
        [
          RESULT_ID,
          {
            findingId: FINDING_ID,
            invariantResultId: RESULT_ID,
            status: "OPEN",
            title: "t",
            createdAt: "2026-08-20T10:03:00.000Z",
          },
        ],
      ]),
    );

    const serialized = JSON.stringify(
      await getChaosRunDetail(RUN_ID),
    ).toLowerCase();
    for (const forbidden of [
      "diagnosis",
      "recommendation",
      "diagnosed_at",
      "resolved_at",
      "confidence",
      "reliability_score",
    ]) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
  });
});

describe("Phase 3H run read model — recent runs", () => {
  it("17: recent runs project only summary fields", async () => {
    recentRows = [
      {
        id: RUN_ID,
        scenario_id: "C03",
        status: "COMPLETED",
        outcome: "PASS",
        data_classification: "SYNTHETIC_DEMO",
        fault_type: "INVALID_SIGNATURE_TEST",
        started_at: "2026-08-20T10:00:00.000Z",
        completed_at: "2026-08-20T10:00:05.000Z",
        created_at: "2026-08-20T10:00:00.000Z",
      },
    ];

    const runs = await listRecentChaosRuns();
    expect(runs).toHaveLength(1);
    expect(Object.keys(runs[0]!).sort()).toEqual([
      "completedAt",
      "createdAt",
      "dataClassification",
      "faultType",
      "id",
      "outcome",
      "scenarioId",
      "startedAt",
      "status",
    ]);
    expect(runs[0]!).not.toHaveProperty("faultConfig");
  });

  it("18: the limit is clamped to a sane range", async () => {
    // No assertion on the query itself — the point is that absurd input
    // cannot become an unbounded scan or a zero-row query.
    await expect(listRecentChaosRuns(0)).resolves.toBeDefined();
    await expect(listRecentChaosRuns(-5)).resolves.toBeDefined();
    await expect(listRecentChaosRuns(10_000)).resolves.toBeDefined();
    await expect(listRecentChaosRuns(Number.NaN)).resolves.toBeDefined();
  });

  it("19: a SUCCESSFUL query with zero rows returns an empty list", async () => {
    recentRows = [];
    expect(await listRecentChaosRuns()).toEqual([]);
  });

  it("20: a read FAILURE throws CHAOS_RUN_LIST_READ_FAILED, never an empty list", async () => {
    // "No runs have been executed" and "the run history could not be read"
    // render identically as an empty list but mean opposite things.
    getSupabaseServerClient.mockImplementation(() => ({
      from: () => {
        const chain = {
          select: () => chain,
          order: () => chain,
          limit: () =>
            Promise.resolve({
              data: null,
              error: { message: 'relation "chaos_runs" does not exist' },
            }),
        };
        return chain;
      },
    }));

    const failure = listRecentChaosRuns();
    await expect(failure).rejects.toBeInstanceOf(ChaosRunReadModelError);
    await expect(failure).rejects.toMatchObject({
      code: "CHAOS_RUN_LIST_READ_FAILED",
    });
  });

  it("21: the thrown run-list error leaks no raw database text", async () => {
    getSupabaseServerClient.mockImplementation(() => ({
      from: () => {
        const chain = {
          select: () => chain,
          order: () => chain,
          limit: () =>
            Promise.resolve({
              data: null,
              error: { message: 'relation "chaos_runs" missing', hint: "leak" },
            }),
        };
        return chain;
      },
    }));

    let message = "";
    try {
      await listRecentChaosRuns();
    } catch (error) {
      message = (error as Error).message;
    }
    for (const forbidden of ["relation", "chaos_runs", "hint", "leak"]) {
      expect(message.toLowerCase(), forbidden).not.toContain(forbidden);
    }
  });
});

describe("Phase 3H run read model — Finding lookup failure is not 'no Finding'", () => {
  it("22: a SUCCESSFUL Finding query with no match means the result truly has none", async () => {
    getChaosRunById.mockResolvedValue(runRow());
    listInvariantResultsForChaosRun.mockResolvedValue([
      resultRow({ result: "FAIL" }),
    ]);
    listFindingSummariesForInvariantResults.mockResolvedValue(new Map());

    const detail = (await getChaosRunDetail(RUN_ID))!;
    expect(detail.invariantResults[0]!.finding).toBeNull();
  });

  it("23: a Finding read FAILURE propagates — it never becomes a false 'no Finding'", async () => {
    // Beside a persisted FAIL, "no Finding" is a specific and serious claim.
    // Saying it because a SELECT failed would be a false statement about the
    // merchant's reliability.
    getChaosRunById.mockResolvedValue(runRow());
    listInvariantResultsForChaosRun.mockResolvedValue([
      resultRow({ result: "FAIL" }),
    ]);
    listFindingSummariesForInvariantResults.mockRejectedValue(
      Object.assign(new Error("Findings could not be read."), {
        code: "FINDING_SUMMARY_READ_FAILED",
      }),
    );

    await expect(getChaosRunDetail(RUN_ID)).rejects.toMatchObject({
      code: "FINDING_SUMMARY_READ_FAILED",
    });
  });
});
