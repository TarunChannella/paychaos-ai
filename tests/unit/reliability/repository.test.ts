import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * Phase 4F-R2 — the SELECT-only reliability repository.
 *
 * A recording fake stands in for the Supabase client, so every assertion is
 * about the STATEMENT this module actually issues: which table, which
 * columns, which filters, and — critically — that no mutating verb is ever
 * reachable. The real client is never constructed and no network call is
 * made.
 *
 * Score arithmetic is deliberately NOT tested here; it belongs to the frozen
 * R1 engine and its own suite.
 */

interface Recorded {
  readonly table: string;
  readonly op: "select" | "insert" | "update" | "delete" | "upsert" | "rpc";
  projection?: string;
  readonly eq: Record<string, unknown>;
  readonly inFilters: Record<string, unknown>;
  readonly order: string[];
}

const calls: Recorded[] = [];
let responses: { data: unknown; error: unknown }[] = [];

function nextResponse(): { data: unknown; error: unknown } {
  return responses.shift() ?? { data: null, error: null };
}

function makeBuilder(record: Recorded) {
  const builder: Record<string, unknown> = {};
  const chain =
    (fn: (...args: never[]) => void) =>
    (...args: never[]) => {
      fn(...args);
      return builder;
    };

  builder.select = chain((projection: never) => {
    record.projection = projection as string;
  });
  builder.eq = chain((column: never, value: never) => {
    record.eq[column as string] = value;
  });
  builder.in = chain((column: never, value: never) => {
    record.inFilters[column as string] = value;
  });
  builder.order = chain((column: never) => {
    record.order.push(column as string);
  });
  builder.maybeSingle = () => Promise.resolve(nextResponse());
  builder.single = () => Promise.resolve(nextResponse());
  builder.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve(nextResponse()).then(resolve);

  // Every mutating verb is present on the fake so that a call would be
  // RECORDED rather than merely crashing — which lets the tests below assert
  // the absence of writes as a property, not as an accident.
  for (const op of ["insert", "update", "delete", "upsert"] as const) {
    builder[op] = chain(() => {
      (record as { op: string }).op = op;
    });
  }
  return builder;
}

const fakeClient = {
  from(table: string) {
    const record: Recorded = {
      table,
      op: "select",
      eq: {},
      inFilters: {},
      order: [],
    };
    calls.push(record);
    return makeBuilder(record);
  },
  rpc(name: string) {
    calls.push({
      table: `rpc:${name}`,
      op: "rpc",
      eq: {},
      inFilters: {},
      order: [],
    });
    return Promise.resolve(nextResponse());
  },
};

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: () => fakeClient,
}));

const {
  loadReliabilityCandidateRuns,
  loadReliabilityInvariantResults,
  ReliabilityRepositoryError,
} = await import("@/lib/reliability/repository");

const RUN_ROW = {
  id: "run-1",
  scenario_id: "C11",
  status: "COMPLETED",
  outcome: "PASS",
  data_classification: "RECORDED_TEST_EVIDENCE",
  created_at: "2026-09-01T00:00:00.000Z",
  completed_at: "2026-09-01T00:05:00.000Z",
};

const RESULT_ROW = {
  id: "res-1",
  chaos_run_id: "run-1",
  invariant_id: "INV-011",
  result: "FAIL",
  severity: "CRITICAL",
};

/** A PostgREST-shaped error, complete with the fields that must never leak. */
const RAW_ERROR = {
  message: 'relation "chaos_runs" does not exist',
  details: "internal detail 42",
  hint: "check the service role key",
  code: "PGRST205",
};

beforeEach(() => {
  calls.length = 0;
  responses = [];
});

describe("reliability repository — chaos run projection", () => {
  it("A: issues a SELECT against chaos_runs and no mutating verb", async () => {
    responses = [{ data: [RUN_ROW], error: null }];

    await loadReliabilityCandidateRuns();

    expect(calls).toHaveLength(1);
    expect(calls[0]!.table).toBe("chaos_runs");
    expect(calls[0]!.op).toBe("select");
  });

  it("B: restricts the query to exactly the four mandatory scenarios", async () => {
    responses = [{ data: [], error: null }];

    await loadReliabilityCandidateRuns();

    // The filter is applied in the QUERY, so a P1 scenario's run can never be
    // loaded, let alone scored.
    expect(calls[0]!.inFilters["scenario_id"]).toEqual([
      "C01",
      "C03",
      "C07",
      "C11",
    ]);
  });

  it("C: projects only the columns the score contract needs", async () => {
    responses = [{ data: [], error: null }];

    await loadReliabilityCandidateRuns();

    const projection = calls[0]!.projection ?? "";
    expect(
      projection
        .split(",")
        .map((c) => c.trim())
        .sort(),
    ).toEqual([
      "completed_at",
      "created_at",
      "data_classification",
      "id",
      "outcome",
      "scenario_id",
      "status",
    ]);
    // Evidence the score has no business reading is never requested.
    for (const forbidden of [
      "fault_config",
      "fault_state",
      "error_message_redacted",
      "order_id",
      "payment_id",
      "payment_attempt_id",
      "source_webhook_event_id",
    ]) {
      expect(projection, forbidden).not.toContain(forbidden);
    }
  });

  it("D: maps snake_case rows exactly into the camelCase contract", async () => {
    responses = [
      {
        data: [RUN_ROW, { ...RUN_ROW, id: "run-2", completed_at: null }],
        error: null,
      },
    ];

    const runs = await loadReliabilityCandidateRuns();

    expect(runs).toEqual([
      {
        id: "run-1",
        scenarioId: "C11",
        status: "COMPLETED",
        outcome: "PASS",
        dataClassification: "RECORDED_TEST_EVIDENCE",
        createdAt: "2026-09-01T00:00:00.000Z",
        completedAt: "2026-09-01T00:05:00.000Z",
      },
      {
        id: "run-2",
        scenarioId: "C11",
        status: "COMPLETED",
        outcome: "PASS",
        dataClassification: "RECORDED_TEST_EVIDENCE",
        createdAt: "2026-09-01T00:00:00.000Z",
        completedAt: null,
      },
    ]);
  });

  it("D2: requests no ordering — latest selection belongs to the engine", async () => {
    responses = [{ data: [], error: null }];

    await loadReliabilityCandidateRuns();

    // Ordering here would be a second, drift-prone LATEST_SELECTION_V1.
    expect(calls[0]!.order).toEqual([]);
  });

  it("D3: a null data array is an empty result, not a crash", async () => {
    responses = [{ data: null, error: null }];
    await expect(loadReliabilityCandidateRuns()).resolves.toEqual([]);
  });
});

describe("reliability repository — invariant result projection", () => {
  it("E: loads results only for the supplied run ids", async () => {
    responses = [{ data: [RESULT_ROW], error: null }];

    await loadReliabilityInvariantResults(["run-1", "run-2"]);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.table).toBe("invariant_results");
    expect(calls[0]!.op).toBe("select");
    expect(calls[0]!.inFilters["chaos_run_id"]).toEqual(["run-1", "run-2"]);
  });

  it("F: projects only the columns the score contract needs", async () => {
    responses = [{ data: [], error: null }];

    await loadReliabilityInvariantResults(["run-1"]);

    const projection = calls[0]!.projection ?? "";
    expect(
      projection
        .split(",")
        .map((c) => c.trim())
        .sort(),
    ).toEqual(["chaos_run_id", "id", "invariant_id", "result", "severity"]);
    // A score must never be derived from prose.
    for (const forbidden of [
      "expected_summary",
      "observed_summary",
      "reason",
      "evidence_refs",
      "invariant_version",
    ]) {
      expect(projection, forbidden).not.toContain(forbidden);
    }
  });

  it("G: an empty id list returns [] and issues NO query at all", async () => {
    const results = await loadReliabilityInvariantResults([]);

    expect(results).toEqual([]);
    // PostgREST's `.in()` with an empty array is a malformed filter.
    expect(calls).toHaveLength(0);
  });

  it("G2: a baseline result with a null chaos_run_id is excluded", async () => {
    responses = [
      {
        data: [RESULT_ROW, { ...RESULT_ROW, id: "res-2", chaos_run_id: null }],
        error: null,
      },
    ];

    const results = await loadReliabilityInvariantResults(["run-1"]);

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      id: "res-1",
      chaosRunId: "run-1",
      invariantId: "INV-011",
      result: "FAIL",
      severity: "CRITICAL",
    });
  });
});

describe("reliability repository — READ FAILURE IS NOT ABSENCE", () => {
  it("H: a chaos-run read error raises a typed failure, never an empty array", async () => {
    responses = [{ data: null, error: RAW_ERROR }];

    await expect(loadReliabilityCandidateRuns()).rejects.toMatchObject({
      code: "CHAOS_RUN_READ_FAILED",
    });
  });

  it("H2: the failure is the repository's own error type", async () => {
    responses = [{ data: null, error: RAW_ERROR }];

    await expect(loadReliabilityCandidateRuns()).rejects.toBeInstanceOf(
      ReliabilityRepositoryError,
    );
  });

  it("H3: a failed read never resolves to a scoreable empty result", async () => {
    // The whole point: an outage must not become four NOT_RUN scenarios and a
    // confident score of 40.
    responses = [{ data: null, error: RAW_ERROR }];

    let resolved = false;
    await loadReliabilityCandidateRuns()
      .then(() => {
        resolved = true;
      })
      .catch(() => {});

    expect(resolved).toBe(false);
  });

  it("I: an invariant-result read error raises its own typed failure", async () => {
    responses = [{ data: null, error: RAW_ERROR }];

    await expect(
      loadReliabilityInvariantResults(["run-1"]),
    ).rejects.toMatchObject({ code: "INVARIANT_RESULT_READ_FAILED" });
  });

  it("J: no raw database message, detail, hint or SQL escapes", async () => {
    for (const load of [
      () => loadReliabilityCandidateRuns(),
      () => loadReliabilityInvariantResults(["run-1"]),
    ]) {
      responses = [{ data: null, error: RAW_ERROR }];
      const error = await load().catch((e: unknown) => e);
      const serialized = `${(error as Error).name} ${(error as Error).message} ${
        (error as { code?: string }).code ?? ""
      }`;

      for (const leaked of [
        "relation",
        "does not exist",
        "internal detail 42",
        "service role key",
        "PGRST205",
        'chaos_runs"',
      ]) {
        expect(serialized, leaked).not.toContain(leaked);
      }
      // And the safe wording is operator-facing, not a stack trace.
      expect((error as Error).message.length).toBeGreaterThan(0);
    }
  });
});

describe("reliability repository — no write surface exists", () => {
  it("K: neither loader mutates anything, and the caller's array is untouched", async () => {
    responses = [
      { data: [RUN_ROW], error: null },
      { data: [RESULT_ROW], error: null },
    ];

    const ids = ["run-1"];
    await loadReliabilityCandidateRuns();
    await loadReliabilityInvariantResults(ids);

    expect(ids).toEqual(["run-1"]);
    // Every recorded statement is a read, against exactly the two allowed
    // tables. An insert/update/upsert/delete/rpc would have been recorded.
    expect(calls.every((c) => c.op === "select")).toBe(true);
    expect([...new Set(calls.map((c) => c.table))].sort()).toEqual([
      "chaos_runs",
      "invariant_results",
    ]);
  });

  it("K2: findings and regression_runs are never queried", async () => {
    responses = [
      { data: [RUN_ROW], error: null },
      { data: [RESULT_ROW], error: null },
    ];

    await loadReliabilityCandidateRuns();
    await loadReliabilityInvariantResults(["run-1"]);

    for (const table of [
      "findings",
      "regression_runs",
      "orders",
      "payments",
      "payment_attempts",
      "webhook_events",
      "event_processing_attempts",
      "fulfilments",
    ]) {
      expect(
        calls.map((c) => c.table),
        table,
      ).not.toContain(table);
    }
  });
});
