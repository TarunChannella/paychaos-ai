import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * Phase 4G — the SELECT-only readiness repository.
 *
 * A recording fake stands in for the Supabase client, so every assertion is
 * about the STATEMENT this module actually issues: which table, which columns,
 * which filters, and that no mutating verb is reachable. The real client is
 * never constructed and no network call is made.
 */

interface Recorded {
  readonly table: string;
  op: "select" | "insert" | "update" | "delete" | "upsert" | "rpc";
  projection?: string;
  readonly inFilters: Record<string, unknown>;
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
  builder.in = chain((column: never, value: never) => {
    record.inFilters[column as string] = value;
  });
  builder.eq = chain(() => {});
  builder.order = chain(() => {});
  builder.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve(nextResponse()).then(resolve);

  // Present so a mutating call would be RECORDED rather than crashing, which
  // lets "no writes" be asserted as a property rather than an accident.
  for (const op of ["insert", "update", "delete", "upsert"] as const) {
    builder[op] = chain(() => {
      record.op = op;
    });
  }
  return builder;
}

const fakeClient = {
  from(table: string) {
    const record: Recorded = { table, op: "select", inFilters: {} };
    calls.push(record);
    return makeBuilder(record);
  },
  rpc(name: string) {
    calls.push({ table: `rpc:${name}`, op: "rpc", inFilters: {} });
    return Promise.resolve(nextResponse());
  },
};

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: () => fakeClient,
}));

const {
  loadUnresolvedFindings,
  loadSelectedRunInvariantEvidence,
  ReadinessRepositoryError,
} = await import("@/lib/readiness/repository");

const RAW_ERROR = {
  message: 'relation "findings" does not exist',
  details: "internal detail 42",
  hint: "check the service role key",
  code: "PGRST205",
};

beforeEach(() => {
  calls.length = 0;
  responses = [];
});

describe("readiness repository — unresolved findings", () => {
  it("1: queries findings with SELECT only, filtered to unresolved statuses", async () => {
    responses = [{ data: [], error: null }];

    await loadUnresolvedFindings();

    expect(calls).toHaveLength(1);
    expect(calls[0]!.table).toBe("findings");
    expect(calls[0]!.op).toBe("select");
    expect(calls[0]!.inFilters["status"]).toEqual(["OPEN", "STILL_FAILING"]);
  });

  it("2: RESOLVED is never included in the unresolved filter", async () => {
    responses = [{ data: [], error: null }];
    await loadUnresolvedFindings();
    expect(calls[0]!.inFilters["status"]).not.toContain("RESOLVED");
  });

  it("3: only the narrow finding columns are projected", async () => {
    responses = [{ data: [], error: null }];

    await loadUnresolvedFindings();

    const projection = calls[0]!.projection ?? "";
    expect(
      projection
        .split(",")
        .map((c) => c.trim())
        .sort(),
    ).toEqual(["id", "invariant_result_id", "status"]);
    // Diagnosis and recommendation must never decide readiness severity.
    for (const forbidden of [
      "diagnosis_code",
      "diagnosis_strength",
      "diagnosis_summary",
      "recommendation_code",
      "recommendation_text",
      "title",
      "resolved_at",
    ]) {
      expect(projection, forbidden).not.toContain(forbidden);
    }
  });

  it("4: severity is taken from the linked invariant result", async () => {
    responses = [
      {
        data: [
          { id: "f-1", invariant_result_id: "res-1", status: "OPEN" },
          { id: "f-2", invariant_result_id: "res-2", status: "STILL_FAILING" },
        ],
        error: null,
      },
      {
        data: [
          { id: "res-1", severity: "CRITICAL" },
          { id: "res-2", severity: "MEDIUM" },
        ],
        error: null,
      },
    ];

    const findings = await loadUnresolvedFindings();

    expect(findings).toEqual([
      { findingId: "f-1", severity: "CRITICAL" },
      { findingId: "f-2", severity: "MEDIUM" },
    ]);
    expect(calls[1]!.table).toBe("invariant_results");
    expect(calls[1]!.projection).toBe("id, severity");
  });

  it("5: a finding whose severity cannot be resolved is treated as CRITICAL", async () => {
    // Fail closed: an unclassifiable unresolved failure must not slip past a
    // READY gate by being dropped or downgraded.
    responses = [
      {
        data: [{ id: "f-1", invariant_result_id: "missing", status: "OPEN" }],
        error: null,
      },
      { data: [], error: null },
    ];

    expect(await loadUnresolvedFindings()).toEqual([
      { findingId: "f-1", severity: "CRITICAL" },
    ]);
  });

  it("6: zero unresolved findings issues no second query and returns []", async () => {
    responses = [{ data: [], error: null }];

    expect(await loadUnresolvedFindings()).toEqual([]);
    // Genuinely empty — and only after the first query SUCCEEDED.
    expect(calls).toHaveLength(1);
  });
});

describe("readiness repository — selected-run invariant evidence", () => {
  it("7: loads results only for the supplied run ids", async () => {
    responses = [
      {
        data: [
          {
            id: "r-1",
            chaos_run_id: "run-a",
            invariant_id: "INV-005",
            result: "PASS",
            severity: "CRITICAL",
          },
        ],
        error: null,
      },
    ];

    const evidence = await loadSelectedRunInvariantEvidence(["run-a", "run-b"]);

    expect(calls[0]!.table).toBe("invariant_results");
    expect(calls[0]!.inFilters["chaos_run_id"]).toEqual(["run-a", "run-b"]);
    expect(evidence).toEqual([
      {
        chaosRunId: "run-a",
        results: [{ invariantId: "INV-005", result: "PASS" }],
      },
      { chaosRunId: "run-b", results: [] },
    ]);
  });

  it("8: only the narrow invariant columns are projected", async () => {
    responses = [{ data: [], error: null }];

    await loadSelectedRunInvariantEvidence(["run-a"]);

    const projection = calls[0]!.projection ?? "";
    for (const forbidden of [
      "expected_summary",
      "observed_summary",
      "reason",
      "evidence_refs",
    ]) {
      expect(projection, forbidden).not.toContain(forbidden);
    }
  });

  it("9: an empty id list returns [] and issues NO query", async () => {
    expect(await loadSelectedRunInvariantEvidence([])).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

describe("readiness repository — READ FAILURE IS NOT A CLEAN STATE", () => {
  it("10: a findings read error raises a typed failure, never an empty array", async () => {
    responses = [{ data: null, error: RAW_ERROR }];

    await expect(loadUnresolvedFindings()).rejects.toMatchObject({
      code: "FINDING_READ_FAILED",
    });
    await expect(
      (async () => {
        responses = [{ data: null, error: RAW_ERROR }];
        return loadUnresolvedFindings();
      })(),
    ).rejects.toBeInstanceOf(ReadinessRepositoryError);
  });

  it("11: a severity read error raises its own typed failure", async () => {
    responses = [
      {
        data: [{ id: "f-1", invariant_result_id: "res-1", status: "OPEN" }],
        error: null,
      },
      { data: null, error: RAW_ERROR },
    ];

    await expect(loadUnresolvedFindings()).rejects.toMatchObject({
      code: "INVARIANT_RESULT_READ_FAILED",
    });
  });

  it("12: an invariant-evidence read error raises a typed failure", async () => {
    responses = [{ data: null, error: RAW_ERROR }];

    await expect(
      loadSelectedRunInvariantEvidence(["run-a"]),
    ).rejects.toMatchObject({ code: "INVARIANT_RESULT_READ_FAILED" });
  });

  it("13: a failed read NEVER resolves to zero unresolved findings", async () => {
    // The most dangerous possible bug in this phase: an outage reported as a
    // clean bill of health would manufacture a false READY.
    responses = [{ data: null, error: RAW_ERROR }];

    let resolved: unknown = "not-called";
    await loadUnresolvedFindings()
      .then((value) => {
        resolved = value;
      })
      .catch(() => {});

    expect(resolved).toBe("not-called");
  });

  it("14: no raw database message, detail, hint or code escapes", async () => {
    for (const load of [
      () => loadUnresolvedFindings(),
      () => loadSelectedRunInvariantEvidence(["run-a"]),
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
      ]) {
        expect(serialized, leaked).not.toContain(leaked);
      }
    }
  });
});

describe("readiness repository — no write surface, no forbidden dependency", () => {
  it("15: every statement is a read, against exactly two tables", async () => {
    responses = [
      {
        data: [{ id: "f-1", invariant_result_id: "res-1", status: "OPEN" }],
        error: null,
      },
      { data: [{ id: "res-1", severity: "LOW" }], error: null },
      { data: [], error: null },
    ];

    await loadUnresolvedFindings();
    await loadSelectedRunInvariantEvidence(["run-a"]);

    expect(calls.every((c) => c.op === "select")).toBe(true);
    expect([...new Set(calls.map((c) => c.table))].sort()).toEqual([
      "findings",
      "invariant_results",
    ]);
  });

  it("16: regression_runs and chaos_runs are never queried", async () => {
    responses = [
      { data: [], error: null },
      { data: [], error: null },
    ];

    await loadUnresolvedFindings();
    await loadSelectedRunInvariantEvidence(["run-a"]);

    for (const table of [
      "regression_runs",
      "chaos_runs",
      "orders",
      "payments",
      "webhook_events",
    ]) {
      expect(
        calls.map((c) => c.table),
        table,
      ).not.toContain(table);
    }
  });

  it("17: the caller's id array is never mutated", async () => {
    responses = [{ data: [], error: null }];
    const ids = ["run-a", "run-b"];

    await loadSelectedRunInvariantEvidence(ids);

    expect(ids).toEqual(["run-a", "run-b"]);
  });
});
