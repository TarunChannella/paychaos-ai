import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * Phase 5B — the Finding casefile read model.
 *
 * The property that matters most here is the difference between "this finding
 * has not been diagnosed" and "we could not read whether it was diagnosed".
 * The first is a fact about the merchant's integration; the second is an
 * outage. Reporting the second as the first would tell an operator PayChaos
 * found no root cause for a real money-invariant failure.
 */

interface Recorded {
  readonly table: string;
  op: string;
  projection?: string;
}

const calls: Recorded[] = [];
let responses: { data: unknown; error: unknown }[] = [];

function makeBuilder(record: Recorded) {
  const builder: Record<string, unknown> = {};
  const chain =
    (fn: (...a: never[]) => void) =>
    (...args: never[]) => {
      fn(...args);
      return builder;
    };
  builder.select = chain((p: never) => {
    record.projection = p as string;
  });
  builder.eq = chain(() => {});
  builder.in = chain(() => {});
  builder.order = chain(() => {});
  for (const op of ["insert", "update", "delete", "upsert"] as const) {
    builder[op] = chain(() => {
      record.op = op;
    });
  }
  const settle = () =>
    Promise.resolve(responses.shift() ?? { data: null, error: null });
  builder.maybeSingle = () => settle();
  builder.then = (resolve: (v: unknown) => unknown) => settle().then(resolve);
  return builder;
}

const fakeClient = {
  from(table: string) {
    const record: Recorded = { table, op: "select" };
    calls.push(record);
    return makeBuilder(record);
  },
};

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: () => fakeClient,
}));

const listRegressionRunsForFinding = vi.fn();
vi.mock("@/lib/regression/repository", () => ({
  listRegressionRunsForFinding: (...a: unknown[]) =>
    listRegressionRunsForFinding(...a),
}));

const {
  getFindingCasefile,
  getRegressionComparison,
  FindingCasefileReadError,
} = await import("@/lib/findings/casefile-read");

const DIAGNOSED = {
  id: "f-1",
  status: "OPEN",
  resolved_at: null,
  diagnosis_code: "RC-004",
  diagnosis_strength: "STRONG_EVIDENCE",
  diagnosis_summary: "A duplicate processing path executed the effect twice.",
  recommendation_code: "FIX-002",
  recommendation_text: "Enforce event-id idempotency before business effect.",
  diagnosed_at: "2026-09-01T00:00:00.000Z",
};

beforeEach(() => {
  calls.length = 0;
  responses = [];
  vi.clearAllMocks();
  listRegressionRunsForFinding.mockResolvedValue([]);
});

describe("finding casefile — persisted Phase 4 fields", () => {
  it("1: returns the diagnosis and recommendation as persisted", async () => {
    responses = [{ data: DIAGNOSED, error: null }];

    const casefile = await getFindingCasefile("f-1");

    expect(casefile?.diagnosis).toEqual({
      code: "RC-004",
      strength: "STRONG_EVIDENCE",
      summary: "A duplicate processing path executed the effect twice.",
      diagnosedAt: "2026-09-01T00:00:00.000Z",
    });
    expect(casefile?.recommendation).toEqual({
      code: "FIX-002",
      text: "Enforce event-id idempotency before business effect.",
    });
  });

  it("2: an undiagnosed finding returns null, not a placeholder", async () => {
    responses = [
      {
        data: {
          ...DIAGNOSED,
          diagnosis_code: null,
          diagnosis_strength: null,
          diagnosis_summary: null,
          recommendation_code: null,
          recommendation_text: null,
        },
        error: null,
      },
    ];

    const casefile = await getFindingCasefile("f-1");

    expect(casefile?.diagnosis).toBeNull();
    expect(casefile?.recommendation).toBeNull();
  });

  it("3: a half-written diagnosis is not rendered as a diagnosis", async () => {
    // All three columns are written together by Phase 4C; a partial row is
    // corruption, not an opinion.
    responses = [
      { data: { ...DIAGNOSED, diagnosis_summary: null }, error: null },
    ];

    expect((await getFindingCasefile("f-1"))?.diagnosis).toBeNull();
  });

  it("4: it reads only findings and never writes", async () => {
    responses = [{ data: DIAGNOSED, error: null }];

    await getFindingCasefile("f-1");

    expect(calls.map((c) => c.table)).toEqual(["findings"]);
    expect(calls.every((c) => c.op === "select")).toBe(true);
  });

  it("5: a missing finding is null only after a successful query", async () => {
    responses = [{ data: null, error: null }];
    expect(await getFindingCasefile("missing")).toBeNull();
  });
});

describe("finding casefile — READ FAILURE IS NOT 'NOT DIAGNOSED'", () => {
  it("6: a findings read error throws a typed error", async () => {
    responses = [
      { data: null, error: { message: 'relation "findings" does not exist' } },
    ];

    await expect(getFindingCasefile("f-1")).rejects.toBeInstanceOf(
      FindingCasefileReadError,
    );
  });

  it("7: an unreadable regression history is not 'never retested'", async () => {
    responses = [{ data: DIAGNOSED, error: null }];
    listRegressionRunsForFinding.mockRejectedValue(new Error("boom"));

    await expect(getFindingCasefile("f-1")).rejects.toMatchObject({
      code: "FINDING_CASEFILE_READ_FAILED",
    });
  });

  it("8: a failed read never resolves to a casefile", async () => {
    responses = [{ data: null, error: { message: "timeout" } }];

    let resolved: unknown = "not-called";
    await getFindingCasefile("f-1")
      .then((v) => {
        resolved = v;
      })
      .catch(() => {});

    expect(resolved).toBe("not-called");
  });

  it("9: no raw database message escapes", async () => {
    responses = [
      {
        data: null,
        error: {
          message: 'relation "findings" does not exist',
          hint: "check the service role key",
        },
      },
    ];

    const error = await getFindingCasefile("f-1").catch((e: unknown) => e);
    const text = `${(error as Error).name} ${(error as Error).message}`;

    for (const leaked of ["relation", "does not exist", "service role key"]) {
      expect(text, leaked).not.toContain(leaked);
    }
  });
});

describe("regression comparison — history is preserved", () => {
  it("10: no regression returns null rather than an empty comparison", async () => {
    listRegressionRunsForFinding.mockResolvedValue([]);
    expect(await getRegressionComparison("f-1", "res-1")).toBeNull();
  });

  it("11: before is the original result, after is the regression's run", async () => {
    listRegressionRunsForFinding.mockResolvedValue([
      { id: "reg-1", chaosRunId: "run-2", status: "RESOLVED" },
    ]);
    responses = [
      {
        data: {
          id: "res-1",
          invariant_id: "INV-002",
          result: "FAIL",
          severity: "CRITICAL",
          reason: "duplicate effect",
          evaluated_at: "2026-08-01T00:00:00.000Z",
        },
        error: null,
      },
      {
        data: [
          {
            id: "res-9",
            invariant_id: "INV-002",
            result: "PASS",
            severity: "CRITICAL",
            reason: "single effect",
            evaluated_at: "2026-09-01T00:00:00.000Z",
          },
        ],
        error: null,
      },
    ];

    const comparison = await getRegressionComparison("f-1", "res-1");

    // The original FAIL is still FAIL. It was not rewritten to match.
    expect(comparison?.before?.result).toBe("FAIL");
    expect(comparison?.after[0]?.result).toBe("PASS");
    expect(comparison?.status).toBe("RESOLVED");
  });

  it("12: a comparison read failure throws rather than showing a clean after", async () => {
    listRegressionRunsForFinding.mockResolvedValue([
      { id: "reg-1", chaosRunId: "run-2", status: "RESOLVED" },
    ]);
    responses = [
      { data: null, error: null },
      { data: null, error: { message: "timeout" } },
    ];

    await expect(
      getRegressionComparison("f-1", "res-1"),
    ).rejects.toBeInstanceOf(FindingCasefileReadError);
  });
});
