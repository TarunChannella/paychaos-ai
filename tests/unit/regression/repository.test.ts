import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * Phase 4E-R1 — guarded `regression_runs` persistence.
 *
 * A recording fake stands in for the Supabase client so every assertion is
 * about the STATEMENT this module actually issues: which table, which
 * columns, which guards, and how many writes. The real client is never
 * constructed and no network call is made.
 */

interface Recorded {
  readonly table: string;
  readonly op: "select" | "insert" | "update" | "delete" | "upsert" | "rpc";
  readonly projection?: string;
  readonly payload?: Record<string, unknown>;
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
    (record as { projection?: string }).projection = projection as string;
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
  // A terminal list query is awaited directly.
  builder.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve(nextResponse()).then(resolve);
  return builder;
}

const fakeClient = {
  from(table: string) {
    const api: Record<string, unknown> = {};
    for (const op of [
      "select",
      "insert",
      "update",
      "delete",
      "upsert",
    ] as const) {
      api[op] = (arg?: unknown) => {
        const record: Recorded = {
          table,
          op,
          eq: {},
          inFilters: {},
          order: [],
          ...(op === "select"
            ? { projection: arg as string }
            : { payload: arg as Record<string, unknown> }),
        };
        calls.push(record);
        return makeBuilder(record);
      };
    }
    return api;
  },
  rpc() {
    calls.push({
      table: "-",
      op: "rpc",
      eq: {},
      inFilters: {},
      order: [],
    });
    throw new Error("rpc must never be called");
  },
};

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: () => fakeClient,
}));

const {
  findActiveRegressionForFinding,
  finalizeRegressionError,
  finalizeRegressionResolved,
  finalizeRegressionStillFailing,
  findRegressionRunById,
  insertPendingRegressionRun,
  listRegressionRunsForFinding,
  RegressionRepositoryError,
  startPendingRegressionRun,
} = await import("@/lib/regression/repository");

const FINDING_ID = "11111111-1111-4111-8111-111111111111";
const CHAOS_RUN_ID = "22222222-2222-4222-8222-222222222222";
const REGRESSION_ID = "33333333-3333-4333-8333-333333333333";

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: REGRESSION_ID,
    finding_id: FINDING_ID,
    chaos_run_id: CHAOS_RUN_ID,
    status: "PENDING",
    started_at: null,
    completed_at: null,
    created_at: "2026-09-04T10:00:00.000Z",
    ...overrides,
  };
}

function queue(...items: { data: unknown; error: unknown }[]) {
  responses = items;
}

beforeEach(() => {
  calls.length = 0;
  responses = [];
  vi.resetAllMocks();
});

// ============================================================================
// READS
// ============================================================================

describe("Phase 4E-R1 repository — reads", () => {
  it("1: find by id projects an explicit column list, never *", async () => {
    queue({ data: row(), error: null });
    const found = await findRegressionRunById(REGRESSION_ID);

    expect(found?.id).toBe(REGRESSION_ID);
    expect(calls[0]!.table).toBe("regression_runs");
    expect(calls[0]!.projection).not.toContain("*");
    expect(calls[0]!.projection).toBe(
      "id, finding_id, chaos_run_id, status, started_at, completed_at, created_at",
    );
    expect(calls[0]!.eq).toEqual({ id: REGRESSION_ID });
  });

  it("2: an absent row is null, not an error", async () => {
    queue({ data: null, error: null });
    expect(await findRegressionRunById(REGRESSION_ID)).toBeNull();
  });

  it("3: a malformed regression id is rejected before any query", async () => {
    await expect(findRegressionRunById("nope")).rejects.toMatchObject({
      code: "REGRESSION_RUN_ID_INVALID",
    });
    expect(calls).toHaveLength(0);
  });

  it("4: a failed read is REGRESSION_READ_FAILED, never absence", async () => {
    queue({ data: null, error: { code: "500", message: "boom" } });
    await expect(findRegressionRunById(REGRESSION_ID)).rejects.toMatchObject({
      code: "REGRESSION_READ_FAILED",
    });
  });

  it("5: history is ordered deterministically, newest first", async () => {
    queue({ data: [row(), row({ id: "other" })], error: null });
    const history = await listRegressionRunsForFinding(FINDING_ID);

    expect(history).toHaveLength(2);
    expect(calls[0]!.eq).toEqual({ finding_id: FINDING_ID });
    expect(calls[0]!.order).toEqual(["created_at", "id"]);
  });

  it("6: an empty history is an empty list", async () => {
    queue({ data: [], error: null });
    expect(await listRegressionRunsForFinding(FINDING_ID)).toEqual([]);
  });

  it("7: a malformed finding id is rejected before any query", async () => {
    await expect(listRegressionRunsForFinding("nope")).rejects.toMatchObject({
      code: "REGRESSION_FINDING_ID_INVALID",
    });
    expect(calls).toHaveLength(0);
  });
});

describe("Phase 4E-R1 repository — active regression", () => {
  it("8: active filters on exactly PENDING and RUNNING", async () => {
    queue({ data: [], error: null });
    await findActiveRegressionForFinding(FINDING_ID);

    expect(calls[0]!.eq).toEqual({ finding_id: FINDING_ID });
    expect(calls[0]!.inFilters["status"]).toEqual(["PENDING", "RUNNING"]);
  });

  it("9: a PENDING row is active", async () => {
    queue({ data: [row({ status: "PENDING" })], error: null });
    expect((await findActiveRegressionForFinding(FINDING_ID))?.status).toBe(
      "PENDING",
    );
  });

  it("10: a RUNNING row is active", async () => {
    queue({ data: [row({ status: "RUNNING" })], error: null });
    expect((await findActiveRegressionForFinding(FINDING_ID))?.status).toBe(
      "RUNNING",
    );
  });

  it("11: no active row is null", async () => {
    queue({ data: [], error: null });
    expect(await findActiveRegressionForFinding(FINDING_ID)).toBeNull();
  });

  it("12: more than one active row is an integrity conflict, not a guess", async () => {
    queue({
      data: [row({ status: "PENDING" }), row({ id: "b", status: "RUNNING" })],
      error: null,
    });
    await expect(
      findActiveRegressionForFinding(FINDING_ID),
    ).rejects.toMatchObject({ code: "REGRESSION_INTEGRITY_CONFLICT" });
  });
});

// ============================================================================
// INSERT
// ============================================================================

describe("Phase 4E-R1 repository — insert", () => {
  it("13: the payload is EXACTLY finding_id and chaos_run_id", async () => {
    queue({ data: row(), error: null });
    await insertPendingRegressionRun({
      findingId: FINDING_ID,
      chaosRunId: CHAOS_RUN_ID,
    });

    expect(calls[0]!.op).toBe("insert");
    expect(calls[0]!.table).toBe("regression_runs");
    expect(Object.keys(calls[0]!.payload!).sort()).toEqual([
      "chaos_run_id",
      "finding_id",
    ]);
  });

  it("14: no default-owned column is ever caller-supplied", async () => {
    queue({ data: row(), error: null });
    await insertPendingRegressionRun({
      findingId: FINDING_ID,
      chaosRunId: CHAOS_RUN_ID,
    });

    for (const column of [
      "id",
      "status",
      "created_at",
      "started_at",
      "completed_at",
    ]) {
      expect(calls[0]!.payload, column).not.toHaveProperty(column);
    }
  });

  it("15: the created row comes back PENDING with null timestamps", async () => {
    queue({ data: row(), error: null });
    const created = await insertPendingRegressionRun({
      findingId: FINDING_ID,
      chaosRunId: CHAOS_RUN_ID,
    });
    expect(created.status).toBe("PENDING");
    expect(created.startedAt).toBeNull();
    expect(created.completedAt).toBeNull();
  });

  it("16: the active partial-unique violation is a stable typed conflict", async () => {
    queue({
      data: null,
      error: {
        code: "23505",
        message:
          'duplicate key value violates unique constraint "regression_runs_active_finding_uniq"',
        details: null,
      },
    });
    await expect(
      insertPendingRegressionRun({
        findingId: FINDING_ID,
        chaosRunId: CHAOS_RUN_ID,
      }),
    ).rejects.toMatchObject({ code: "REGRESSION_ACTIVE_RUN_CONFLICT" });
  });

  it("17: a chaos_run_id unique violation is NOT an active-run conflict", async () => {
    // Different fault: that run already belongs to another regression.
    queue({
      data: null,
      error: {
        code: "23505",
        message:
          'duplicate key value violates unique constraint "regression_runs_chaos_run_id_uniq"',
        details: null,
      },
    });
    await expect(
      insertPendingRegressionRun({
        findingId: FINDING_ID,
        chaosRunId: CHAOS_RUN_ID,
      }),
    ).rejects.toMatchObject({ code: "REGRESSION_INSERT_FAILED" });
  });

  it("18: raw database wording never escapes", async () => {
    queue({
      data: null,
      error: {
        code: "23503",
        message: "insert or update on table violates foreign key constraint",
        details: "Key (finding_id)=(...) is not present in table findings.",
        hint: "check the id",
      },
    });
    try {
      await insertPendingRegressionRun({
        findingId: FINDING_ID,
        chaosRunId: CHAOS_RUN_ID,
      });
      throw new Error("expected a rejection");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).not.toContain("foreign key constraint");
      expect(message).not.toContain("Key (finding_id)");
      expect(message).not.toContain("check the id");
    }
  });

  it("19: malformed identifiers are rejected before any query", async () => {
    await expect(
      insertPendingRegressionRun({ findingId: "x", chaosRunId: CHAOS_RUN_ID }),
    ).rejects.toMatchObject({ code: "REGRESSION_FINDING_ID_INVALID" });
    await expect(
      insertPendingRegressionRun({ findingId: FINDING_ID, chaosRunId: "x" }),
    ).rejects.toMatchObject({ code: "REGRESSION_CHAOS_RUN_ID_INVALID" });
    expect(calls).toHaveLength(0);
  });
});

// ============================================================================
// TRANSITIONS
// ============================================================================

describe("Phase 4E-R1 repository — start", () => {
  it("20: PENDING -> RUNNING writes exactly status and started_at", async () => {
    queue({ data: row({ status: "RUNNING", started_at: "T1" }), error: null });
    const result = await startPendingRegressionRun({
      regressionRunId: REGRESSION_ID,
      startedAt: "T1",
    });

    expect(result.kind).toBe("TRANSITIONED");
    expect(calls[0]!.op).toBe("update");
    expect(calls[0]!.payload).toEqual({ status: "RUNNING", started_at: "T1" });
    expect(calls[0]!.eq).toEqual({ id: REGRESSION_ID });
    expect(calls[0]!.inFilters["status"]).toEqual(["PENDING"]);
    expect(calls[0]!.payload).not.toHaveProperty("completed_at");
  });

  it("21: an already-RUNNING row is a zero-write ALREADY with started_at intact", async () => {
    queue(
      { data: null, error: null },
      { data: row({ status: "RUNNING", started_at: "ORIGINAL" }), error: null },
    );
    const result = await startPendingRegressionRun({
      regressionRunId: REGRESSION_ID,
      startedAt: "LATER",
    });

    expect(result.kind).toBe("ALREADY");
    expect(result.run.startedAt).toBe("ORIGINAL");
    expect(calls.filter((c) => c.op === "update")).toHaveLength(1);
  });

  it("22: starting a terminal regression is a state conflict", async () => {
    queue(
      { data: null, error: null },
      { data: row({ status: "RESOLVED" }), error: null },
    );
    await expect(
      startPendingRegressionRun({
        regressionRunId: REGRESSION_ID,
        startedAt: "T1",
      }),
    ).rejects.toMatchObject({ code: "REGRESSION_STATE_CONFLICT" });
  });
});

describe("Phase 4E-R1 repository — resolve", () => {
  it("23: RUNNING -> RESOLVED writes exactly status and completed_at", async () => {
    queue({
      data: row({ status: "RESOLVED", started_at: "T1", completed_at: "T2" }),
      error: null,
    });
    const result = await finalizeRegressionResolved({
      regressionRunId: REGRESSION_ID,
      completedAt: "T2",
    });

    expect(result.kind).toBe("TRANSITIONED");
    expect(calls[0]!.payload).toEqual({
      status: "RESOLVED",
      completed_at: "T2",
    });
    expect(calls[0]!.inFilters["status"]).toEqual(["RUNNING"]);
    expect(calls[0]!.payload).not.toHaveProperty("started_at");
    expect(result.run.startedAt).toBe("T1");
  });

  it("24: PENDING -> RESOLVED is rejected — nothing ever ran", async () => {
    queue(
      { data: null, error: null },
      { data: row({ status: "PENDING" }), error: null },
    );
    await expect(
      finalizeRegressionResolved({
        regressionRunId: REGRESSION_ID,
        completedAt: "T2",
      }),
    ).rejects.toMatchObject({ code: "REGRESSION_STATE_CONFLICT" });
  });

  it("25: an already-RESOLVED row is a zero-write ALREADY with completed_at intact", async () => {
    queue(
      { data: null, error: null },
      {
        data: row({ status: "RESOLVED", completed_at: "ORIGINAL" }),
        error: null,
      },
    );
    const result = await finalizeRegressionResolved({
      regressionRunId: REGRESSION_ID,
      completedAt: "LATER",
    });

    expect(result.kind).toBe("ALREADY");
    expect(result.run.completedAt).toBe("ORIGINAL");
    expect(calls.filter((c) => c.op === "update")).toHaveLength(1);
  });
});

describe("Phase 4E-R1 repository — still failing", () => {
  it("26: RUNNING -> STILL_FAILING writes exactly status and completed_at", async () => {
    queue({
      data: row({ status: "STILL_FAILING", completed_at: "T2" }),
      error: null,
    });
    const result = await finalizeRegressionStillFailing({
      regressionRunId: REGRESSION_ID,
      completedAt: "T2",
    });

    expect(result.kind).toBe("TRANSITIONED");
    expect(calls[0]!.payload).toEqual({
      status: "STILL_FAILING",
      completed_at: "T2",
    });
    expect(calls[0]!.inFilters["status"]).toEqual(["RUNNING"]);
  });

  it("27: an already-STILL_FAILING row is a zero-write ALREADY", async () => {
    queue(
      { data: null, error: null },
      {
        data: row({ status: "STILL_FAILING", completed_at: "ORIGINAL" }),
        error: null,
      },
    );
    const result = await finalizeRegressionStillFailing({
      regressionRunId: REGRESSION_ID,
      completedAt: "LATER",
    });
    expect(result.kind).toBe("ALREADY");
    expect(result.run.completedAt).toBe("ORIGINAL");
  });

  it("28: a contradictory terminal status conflicts, never overwrites", async () => {
    queue(
      { data: null, error: null },
      { data: row({ status: "RESOLVED" }), error: null },
    );
    await expect(
      finalizeRegressionStillFailing({
        regressionRunId: REGRESSION_ID,
        completedAt: "T2",
      }),
    ).rejects.toMatchObject({ code: "REGRESSION_STATE_CONFLICT" });
  });
});

describe("Phase 4E-R1 repository — error terminalization", () => {
  it("29: PENDING -> ERROR is allowed and leaves started_at NULL", async () => {
    queue({
      data: row({ status: "ERROR", started_at: null, completed_at: "T2" }),
      error: null,
    });
    const result = await finalizeRegressionError({
      regressionRunId: REGRESSION_ID,
      completedAt: "T2",
    });

    expect(result.kind).toBe("TRANSITIONED");
    expect(result.run.startedAt).toBeNull();
    expect(calls[0]!.inFilters["status"]).toEqual(["PENDING", "RUNNING"]);
    expect(calls[0]!.payload).toEqual({ status: "ERROR", completed_at: "T2" });
  });

  it("30: RUNNING -> ERROR preserves started_at", async () => {
    queue({
      data: row({ status: "ERROR", started_at: "T1", completed_at: "T2" }),
      error: null,
    });
    const result = await finalizeRegressionError({
      regressionRunId: REGRESSION_ID,
      completedAt: "T2",
    });
    expect(result.run.startedAt).toBe("T1");
  });

  it("31: an already-ERROR row is a zero-write ALREADY", async () => {
    queue(
      { data: null, error: null },
      { data: row({ status: "ERROR", completed_at: "ORIGINAL" }), error: null },
    );
    const result = await finalizeRegressionError({
      regressionRunId: REGRESSION_ID,
      completedAt: "LATER",
    });
    expect(result.kind).toBe("ALREADY");
    expect(result.run.completedAt).toBe("ORIGINAL");
  });

  it("32: a conclusive verdict is never overwritten by ERROR", async () => {
    for (const status of ["RESOLVED", "STILL_FAILING"]) {
      calls.length = 0;
      queue(
        { data: null, error: null },
        { data: row({ status }), error: null },
      );
      await expect(
        finalizeRegressionError({
          regressionRunId: REGRESSION_ID,
          completedAt: "T2",
        }),
        status,
      ).rejects.toMatchObject({ code: "REGRESSION_STATE_CONFLICT" });
    }
  });
});

describe("Phase 4E-R1 repository — statement discipline", () => {
  it("33: a race performs one update and at most one re-read", async () => {
    queue(
      { data: null, error: null },
      { data: row({ status: "RUNNING" }), error: null },
    );
    await startPendingRegressionRun({
      regressionRunId: REGRESSION_ID,
      startedAt: "T1",
    });

    expect(calls.filter((c) => c.op === "update")).toHaveLength(1);
    expect(calls.filter((c) => c.op === "select")).toHaveLength(1);
  });

  it("34: a vanished row during a race is a conflict, not a silent success", async () => {
    queue({ data: null, error: null }, { data: null, error: null });
    await expect(
      startPendingRegressionRun({
        regressionRunId: REGRESSION_ID,
        startedAt: "T1",
      }),
    ).rejects.toMatchObject({ code: "REGRESSION_STATE_CONFLICT" });
  });

  it("35: a failed update is REGRESSION_UPDATE_FAILED with no re-read", async () => {
    queue({ data: null, error: { code: "500", message: "boom" } });
    await expect(
      startPendingRegressionRun({
        regressionRunId: REGRESSION_ID,
        startedAt: "T1",
      }),
    ).rejects.toMatchObject({ code: "REGRESSION_UPDATE_FAILED" });
    expect(calls.filter((c) => c.op === "select")).toHaveLength(0);
  });

  it("36: every statement targets regression_runs and nothing else", async () => {
    queue({ data: row(), error: null });
    await insertPendingRegressionRun({
      findingId: FINDING_ID,
      chaosRunId: CHAOS_RUN_ID,
    });
    queue({ data: row({ status: "RUNNING" }), error: null });
    await startPendingRegressionRun({
      regressionRunId: REGRESSION_ID,
      startedAt: "T1",
    });
    queue({ data: row({ status: "RESOLVED" }), error: null });
    await finalizeRegressionResolved({
      regressionRunId: REGRESSION_ID,
      completedAt: "T2",
    });

    for (const call of calls) {
      expect(call.table).toBe("regression_runs");
    }
  });

  it("37: no DELETE, UPSERT or RPC is ever issued", async () => {
    queue({ data: row(), error: null });
    await insertPendingRegressionRun({
      findingId: FINDING_ID,
      chaosRunId: CHAOS_RUN_ID,
    });
    queue({ data: row({ status: "ERROR" }), error: null });
    await finalizeRegressionError({
      regressionRunId: REGRESSION_ID,
      completedAt: "T2",
    });

    for (const forbidden of ["delete", "upsert", "rpc"] as const) {
      expect(
        calls.some((c) => c.op === forbidden),
        forbidden,
      ).toBe(false);
    }
  });

  it("38: the error type carries a code and no database wording", async () => {
    queue({ data: null, error: { code: "500", message: "pg: relation ..." } });
    try {
      await findRegressionRunById(REGRESSION_ID);
      throw new Error("expected a rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(RegressionRepositoryError);
      expect((error as Error).name).toBe("RegressionRepositoryError");
      expect((error as Error).message).not.toContain("pg:");
      expect((error as Error).message).not.toContain("relation");
    }
  });
});
