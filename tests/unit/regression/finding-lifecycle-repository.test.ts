import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * Phase 4E-R2 — the guarded Finding lifecycle writer.
 *
 * A recording fake stands in for the Supabase client, so every assertion is
 * about the statement actually issued: which table, which columns, which
 * guard, and how many writes. The frozen Phase 3G CHECK
 * (`resolved_at IS NOT NULL` iff `status = 'RESOLVED'`) is the reason each
 * payload sets both fields together, and these cases pin that pairing.
 */

interface Recorded {
  readonly table: string;
  readonly op: "select" | "update" | "insert" | "delete" | "upsert";
  projection?: string;
  readonly payload?: Record<string, unknown>;
  readonly eq: Record<string, unknown>;
  readonly inFilters: Record<string, unknown>;
}

const calls: Recorded[] = [];
let responses: { data: unknown; error: unknown }[] = [];

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
  builder.maybeSingle = () =>
    Promise.resolve(responses.shift() ?? { data: null, error: null });
  return builder;
}

const fakeClient = {
  from(table: string) {
    const api: Record<string, unknown> = {};
    for (const op of [
      "select",
      "update",
      "insert",
      "delete",
      "upsert",
    ] as const) {
      api[op] = (arg?: unknown) => {
        const record: Recorded = {
          table,
          op,
          eq: {},
          inFilters: {},
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
};

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: () => fakeClient,
}));

const {
  FindingLifecycleError,
  markFindingStillFailingAfterRegression,
  readFindingLifecycle,
  resolveFindingAfterRegression,
} = await import("@/lib/regression/finding-lifecycle-repository");

const FINDING_ID = "11111111-1111-4111-8111-111111111111";

/**
 * The `updated_at` a caller would have observed immediately before deciding.
 * Every write is compare-and-set on it, so a concurrent lifecycle change
 * always wins over a stale verdict.
 */
const OBSERVED = "2026-09-01T10:00:00.000Z";

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: FINDING_ID,
    status: "OPEN",
    resolved_at: null,
    updated_at: "2026-09-01T10:00:00.000Z",
    ...overrides,
  };
}

function queue(...items: { data: unknown; error: unknown }[]) {
  responses = items;
}

const updates = () => calls.filter((c) => c.op === "update");

beforeEach(() => {
  calls.length = 0;
  responses = [];
  vi.resetAllMocks();
});

// ============================================================================
// WRITE SCOPE
// ============================================================================

describe("Phase 4E-R2 finding lifecycle — write scope", () => {
  it("1: resolving writes exactly status, resolved_at and updated_at", async () => {
    queue({
      data: row({ status: "RESOLVED", resolved_at: "T", updated_at: "T" }),
      error: null,
    });
    await resolveFindingAfterRegression({
      findingId: FINDING_ID,
      resolvedAt: "T",
      expectedUpdatedAt: OBSERVED,
    });

    expect(updates()).toHaveLength(1);
    expect(updates()[0]!.table).toBe("findings");
    expect(Object.keys(updates()[0]!.payload!).sort()).toEqual([
      "resolved_at",
      "status",
      "updated_at",
    ]);
  });

  it("2: marking still failing writes exactly the same three columns", async () => {
    queue({
      data: row({ status: "STILL_FAILING", updated_at: "T" }),
      error: null,
    });
    await markFindingStillFailingAfterRegression({
      findingId: FINDING_ID,
      updatedAt: "T",
      expectedUpdatedAt: OBSERVED,
    });

    expect(Object.keys(updates()[0]!.payload!).sort()).toEqual([
      "resolved_at",
      "status",
      "updated_at",
    ]);
  });

  it("3: no diagnosis, recommendation or identity column is ever written", async () => {
    queue({
      data: row({ status: "RESOLVED", resolved_at: "T" }),
      error: null,
    });
    await resolveFindingAfterRegression({
      findingId: FINDING_ID,
      resolvedAt: "T",
      expectedUpdatedAt: OBSERVED,
    });
    queue({ data: row({ status: "STILL_FAILING" }), error: null });
    await markFindingStillFailingAfterRegression({
      findingId: FINDING_ID,
      updatedAt: "T",
      expectedUpdatedAt: OBSERVED,
    });

    for (const update of updates()) {
      for (const forbidden of [
        "id",
        "invariant_result_id",
        "title",
        "diagnosis_code",
        "diagnosis_strength",
        "diagnosis_summary",
        "recommendation_code",
        "recommendation_text",
        "diagnosed_at",
        "created_at",
      ]) {
        expect(update.payload, forbidden).not.toHaveProperty(forbidden);
      }
    }
  });

  it("4: every statement targets findings and nothing else", async () => {
    queue({ data: row({ status: "RESOLVED", resolved_at: "T" }), error: null });
    await resolveFindingAfterRegression({
      findingId: FINDING_ID,
      resolvedAt: "T",
      expectedUpdatedAt: OBSERVED,
    });
    for (const call of calls) expect(call.table).toBe("findings");
    expect(calls.some((c) => c.op === "delete")).toBe(false);
    expect(calls.some((c) => c.op === "insert")).toBe(false);
    expect(calls.some((c) => c.op === "upsert")).toBe(false);
  });
});

// ============================================================================
// TRANSITIONS
// ============================================================================

describe("Phase 4E-R2 finding lifecycle — transitions", () => {
  it("5: OPEN -> RESOLVED sets resolved_at", async () => {
    queue({
      data: row({ status: "RESOLVED", resolved_at: "T2", updated_at: "T2" }),
      error: null,
    });
    const result = await resolveFindingAfterRegression({
      findingId: FINDING_ID,
      resolvedAt: "T2",
      expectedUpdatedAt: OBSERVED,
    });

    expect(result.kind).toBe("UPDATED");
    expect(result.status).toBe("RESOLVED");
    expect(result.resolvedAt).toBe("T2");
    expect(updates()[0]!.payload).toEqual({
      status: "RESOLVED",
      resolved_at: "T2",
      updated_at: "T2",
    });
    expect(updates()[0]!.inFilters["status"]).toEqual([
      "OPEN",
      "STILL_FAILING",
    ]);
  });

  it("6: OPEN -> STILL_FAILING keeps resolved_at NULL", async () => {
    queue({
      data: row({ status: "STILL_FAILING", resolved_at: null }),
      error: null,
    });
    const result = await markFindingStillFailingAfterRegression({
      findingId: FINDING_ID,
      updatedAt: "T2",
      expectedUpdatedAt: OBSERVED,
    });

    expect(result.kind).toBe("UPDATED");
    expect(result.resolvedAt).toBeNull();
    expect(updates()[0]!.payload!["resolved_at"]).toBeNull();
  });

  it("7: STILL_FAILING -> RESOLVED is permitted", async () => {
    queue({
      data: row({ status: "RESOLVED", resolved_at: "T3" }),
      error: null,
    });
    const result = await resolveFindingAfterRegression({
      findingId: FINDING_ID,
      resolvedAt: "T3",
      expectedUpdatedAt: OBSERVED,
    });
    expect(result.kind).toBe("UPDATED");
    expect(result.status).toBe("RESOLVED");
  });

  it("8: RESOLVED -> STILL_FAILING reopens and CLEARS resolved_at", async () => {
    queue({
      data: row({ status: "STILL_FAILING", resolved_at: null }),
      error: null,
    });
    const result = await markFindingStillFailingAfterRegression({
      findingId: FINDING_ID,
      updatedAt: "T4",
      expectedUpdatedAt: OBSERVED,
    });

    expect(result.status).toBe("STILL_FAILING");
    expect(result.resolvedAt).toBeNull();
    // RESOLVED is inside the guard, so a genuine reopening really happens.
    expect(updates()[0]!.inFilters["status"]).toEqual(["OPEN", "RESOLVED"]);
    expect(updates()[0]!.payload!["resolved_at"]).toBeNull();
  });
});

// ============================================================================
// IDEMPOTENCY
// ============================================================================

describe("Phase 4E-R2 finding lifecycle — idempotency", () => {
  it("9: RESOLVED + PASS preserves the ORIGINAL resolved_at with zero writes", async () => {
    // The moment a defect was first proven fixed is a historical fact. A
    // later confirming re-test must never overwrite it.
    queue(
      { data: null, error: null },
      {
        data: row({
          status: "RESOLVED",
          resolved_at: "ORIGINAL",
          updated_at: "ORIGINAL",
        }),
        error: null,
      },
    );
    const result = await resolveFindingAfterRegression({
      findingId: FINDING_ID,
      resolvedAt: "MUCH-LATER",
      expectedUpdatedAt: OBSERVED,
    });

    expect(result.kind).toBe("ALREADY");
    expect(result.resolvedAt).toBe("ORIGINAL");
    expect(result.updatedAt).toBe("ORIGINAL");
    expect(updates()).toHaveLength(1); // the one attempt that matched nothing
  });

  it("10: STILL_FAILING + FAIL is a zero-write ALREADY", async () => {
    queue(
      { data: null, error: null },
      {
        data: row({
          status: "STILL_FAILING",
          resolved_at: null,
          updated_at: "ORIGINAL",
        }),
        error: null,
      },
    );
    const result = await markFindingStillFailingAfterRegression({
      findingId: FINDING_ID,
      updatedAt: "MUCH-LATER",
      expectedUpdatedAt: OBSERVED,
    });

    expect(result.kind).toBe("ALREADY");
    expect(result.updatedAt).toBe("ORIGINAL");
  });

  it("11: only a real mutation moves updated_at", async () => {
    queue(
      { data: null, error: null },
      { data: row({ status: "STILL_FAILING", updated_at: "T0" }), error: null },
    );
    const unchanged = await markFindingStillFailingAfterRegression({
      findingId: FINDING_ID,
      updatedAt: "T9",
      expectedUpdatedAt: OBSERVED,
    });
    expect(unchanged.updatedAt).toBe("T0");

    calls.length = 0;
    queue({
      data: row({ status: "STILL_FAILING", updated_at: "T9" }),
      error: null,
    });
    const changed = await markFindingStillFailingAfterRegression({
      findingId: FINDING_ID,
      updatedAt: "T9",
      expectedUpdatedAt: OBSERVED,
    });
    expect(changed.kind).toBe("UPDATED");
    expect(changed.updatedAt).toBe("T9");
  });

  it("12: one conditional update and at most one re-read", async () => {
    queue(
      { data: null, error: null },
      { data: row({ status: "RESOLVED", resolved_at: "X" }), error: null },
    );
    await resolveFindingAfterRegression({
      findingId: FINDING_ID,
      resolvedAt: "Y",
      expectedUpdatedAt: OBSERVED,
    });

    expect(updates()).toHaveLength(1);
    expect(calls.filter((c) => c.op === "select")).toHaveLength(1);
  });
});

// ============================================================================
// CONFLICTS AND SAFETY
// ============================================================================

describe("Phase 4E-R2 finding lifecycle — conflicts", () => {
  it("13: an unexpected state is a typed conflict, not a silent write", async () => {
    queue(
      { data: null, error: null },
      { data: row({ status: "STILL_FAILING" }), error: null },
    );
    await expect(
      resolveFindingAfterRegression({
        findingId: FINDING_ID,
        resolvedAt: "T",
        expectedUpdatedAt: OBSERVED,
      }),
    ).rejects.toMatchObject({ code: "FINDING_LIFECYCLE_STATE_CONFLICT" });
  });

  it("14: a vanished finding is a typed not-found", async () => {
    queue({ data: null, error: null }, { data: null, error: null });
    await expect(
      markFindingStillFailingAfterRegression({
        findingId: FINDING_ID,
        updatedAt: "T",
        expectedUpdatedAt: OBSERVED,
      }),
    ).rejects.toMatchObject({ code: "FINDING_LIFECYCLE_NOT_FOUND" });
  });

  it("15: a malformed id is rejected before any query", async () => {
    await expect(
      resolveFindingAfterRegression({
        findingId: "nope",
        resolvedAt: "T",
        expectedUpdatedAt: OBSERVED,
      }),
    ).rejects.toMatchObject({ code: "FINDING_LIFECYCLE_ID_INVALID" });
    expect(calls).toHaveLength(0);
  });

  it("16: a failed update is REGRESSION-safe and never re-reads", async () => {
    queue({ data: null, error: { code: "500", message: "boom" } });
    await expect(
      resolveFindingAfterRegression({
        findingId: FINDING_ID,
        resolvedAt: "T",
        expectedUpdatedAt: OBSERVED,
      }),
    ).rejects.toMatchObject({ code: "FINDING_LIFECYCLE_UPDATE_FAILED" });
    expect(calls.filter((c) => c.op === "select")).toHaveLength(0);
  });

  it("17: raw database wording never escapes", async () => {
    queue({
      data: null,
      error: {
        code: "23514",
        message:
          'new row violates check constraint "findings_resolved_at_consistent"',
        details: "Failing row contains (...)",
        hint: "fix the row",
      },
    });
    try {
      await resolveFindingAfterRegression({
        findingId: FINDING_ID,
        resolvedAt: "T",
        expectedUpdatedAt: OBSERVED,
      });
      throw new Error("expected a rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(FindingLifecycleError);
      const message = (error as Error).message;
      expect(message).not.toContain("check constraint");
      expect(message).not.toContain("Failing row");
      expect(message).not.toContain("fix the row");
    }
  });

  it("17b: the write is compare-and-set on the observed updated_at", async () => {
    queue({
      data: row({ status: "RESOLVED", resolved_at: "T", updated_at: "T" }),
      error: null,
    });
    await resolveFindingAfterRegression({
      findingId: FINDING_ID,
      resolvedAt: "T",
      expectedUpdatedAt: OBSERVED,
    });

    // Id AND the exact observed timestamp, so any concurrent lifecycle write
    // makes this statement match zero rows.
    expect(updates()[0]!.eq).toEqual({
      id: FINDING_ID,
      updated_at: OBSERVED,
    });
  });

  it("17c: a newer concurrent write makes a stale verdict fail closed", async () => {
    // The Finding moved on: it is OPEN again (reopened by a newer regression)
    // and carries a different updated_at, so the CAS matches nothing and the
    // re-read shows a state this verdict may not claim.
    queue(
      { data: null, error: null },
      {
        data: row({ status: "OPEN", resolved_at: null, updated_at: "NEWER" }),
        error: null,
      },
    );

    await expect(
      resolveFindingAfterRegression({
        findingId: FINDING_ID,
        resolvedAt: "STALE",
        expectedUpdatedAt: OBSERVED,
      }),
    ).rejects.toMatchObject({ code: "FINDING_LIFECYCLE_STATE_CONFLICT" });

    // One attempt, one re-read, and no second write.
    expect(updates()).toHaveLength(1);
  });

  it("18: the reader projects only the three lifecycle columns", async () => {
    queue({ data: row(), error: null });
    const read = await readFindingLifecycle(FINDING_ID);

    expect(read?.status).toBe("OPEN");
    expect(calls[0]!.projection).toBe("id, status, resolved_at, updated_at");
    expect(calls[0]!.projection).not.toContain("diagnosis");
    expect(calls[0]!.projection).not.toContain("recommendation");
  });

  it("19: a missing finding reads as null, not an error", async () => {
    queue({ data: null, error: null });
    expect(await readFindingLifecycle(FINDING_ID)).toBeNull();
  });
});
