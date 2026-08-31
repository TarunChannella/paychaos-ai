import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getSupabaseServerClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: () => getSupabaseServerClient(),
}));

import {
  persistFindingDiagnosis,
  readFindingDiagnosisState,
  ROOT_CAUSE_REPOSITORY_ERROR_CODES,
  RootCauseRepositoryError,
} from "@/lib/diagnosis/root-cause-repository";

/**
 * Phase 4C-R2 — the diagnosis repository's I/O behaviour against a
 * programmable fake Supabase client, following the Phase 3G pattern.
 *
 * This proves the SELECT + guarded-UPDATE algorithm: the first write, its
 * exact payload and guards, equivalent reuse with zero mutation, the
 * concurrent-loser re-read, and every integrity conflict — plus that
 * `findings` is only ever read or conditionally updated, never inserted,
 * upserted or deleted, and that no authoritative table is touched.
 */

const FINDING_ID = "22222222-2222-4222-8222-222222222222";
const RESULT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_RESULT_ID = "33333333-3333-4333-8333-333333333333";
const ATTEMPTED_AT = "2026-08-31T12:00:00.000Z";
const ORIGINAL_AT = "2026-08-30T09:00:00.000Z";

interface Recorded {
  table: string;
  op: string;
  payload?: Record<string, unknown>;
  filters: Array<[string, unknown]>;
  isFilters: Array<[string, unknown]>;
  projection?: string;
}

let recorded: Recorded[] = [];
let queued: Record<string, Array<{ data: unknown; error: unknown }>> = {};

function nextResult(table: string, op: string) {
  const key = `${table}:${op}`;
  const queue = queued[key];
  if (!queue || queue.length === 0) {
    throw new Error(`fake client: no queued result for ${key}`);
  }
  return queue.shift()!;
}

function queue(
  table: string,
  op: string,
  result: { data: unknown; error: unknown },
): void {
  const key = `${table}:${op}`;
  queued[key] = queued[key] ?? [];
  queued[key].push(result);
}

function makeClient() {
  return {
    from(table: string) {
      const build = (op: string, payload?: unknown) => {
        const entry: Recorded = {
          table,
          op,
          payload: payload as Record<string, unknown> | undefined,
          filters: [],
          isFilters: [],
        };
        recorded.push(entry);
        const chain = {
          select(projection?: string) {
            entry.projection = projection;
            return chain;
          },
          eq(column: string, value: unknown) {
            entry.filters.push([column, value]);
            return chain;
          },
          is(column: string, value: unknown) {
            entry.isFilters.push([column, value]);
            return chain;
          },
          maybeSingle() {
            return Promise.resolve(nextResult(table, op));
          },
          single() {
            return Promise.resolve(nextResult(table, op));
          },
        };
        return chain;
      };
      return {
        select: (projection?: string) => build("select").select(projection),
        update: (payload: unknown) => build("update", payload),
        insert: (payload: unknown) => build("insert", payload),
        upsert: (payload: unknown) => build("upsert", payload),
        delete: () => build("delete"),
      };
    },
    rpc: (name: string) => {
      recorded.push({ table: name, op: "rpc", filters: [], isFilters: [] });
      return Promise.resolve({ data: null, error: null });
    },
  };
}

/** A persisted findings row with every advisory field NULL. */
function row(overrides: Record<string, unknown> = {}) {
  return {
    id: FINDING_ID,
    invariant_result_id: RESULT_ID,
    status: "OPEN",
    title: "INV-005 — Invalid Signature Causes Zero Business Mutation",
    diagnosis_code: null,
    diagnosis_strength: null,
    diagnosis_summary: null,
    recommendation_code: null,
    recommendation_text: null,
    diagnosed_at: null,
    resolved_at: null,
    created_at: ORIGINAL_AT,
    updated_at: ORIGINAL_AT,
    ...overrides,
  };
}

function persistInput(overrides: Record<string, unknown> = {}) {
  return {
    findingId: FINDING_ID,
    invariantResultId: RESULT_ID,
    diagnosisCode: "RC-016" as const,
    diagnosisStrength: "INSUFFICIENT_EVIDENCE" as const,
    attemptedAt: ATTEMPTED_AT,
    ...overrides,
  };
}

function ops(): string[] {
  return recorded.map((entry) => `${entry.table}:${entry.op}`);
}

beforeEach(() => {
  recorded = [];
  queued = {};
  getSupabaseServerClient.mockReset();
  getSupabaseServerClient.mockImplementation(() => makeClient());
});

describe("Phase 4C-R2 diagnosis repository — first write", () => {
  it("1: a fresh finding writes exactly the four approved columns", async () => {
    queue("findings", "select", { data: row(), error: null });
    queue("findings", "update", {
      data: row({
        diagnosis_code: "RC-016",
        diagnosis_strength: "INSUFFICIENT_EVIDENCE",
        diagnosed_at: ATTEMPTED_AT,
        updated_at: ATTEMPTED_AT,
      }),
      error: null,
    });

    const result = await persistFindingDiagnosis(persistInput());

    expect(result.kind).toBe("DIAGNOSED");
    expect(result.diagnosisCode).toBe("RC-016");
    expect(result.diagnosisStrength).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.diagnosedAt).toBe(ATTEMPTED_AT);
    expect(result.updatedAt).toBe(ATTEMPTED_AT);

    const update = recorded.find((entry) => entry.op === "update")!;
    // EXACTLY four keys. Not status, not resolved_at, not title, not summary,
    // not a recommendation field.
    expect(Object.keys(update.payload!).sort()).toEqual([
      "diagnosed_at",
      "diagnosis_code",
      "diagnosis_strength",
      "updated_at",
    ]);
    expect(update.payload).toEqual({
      diagnosis_code: "RC-016",
      diagnosis_strength: "INSUFFICIENT_EVIDENCE",
      diagnosed_at: ATTEMPTED_AT,
      updated_at: ATTEMPTED_AT,
    });
  });

  it("2: the update is pinned by exact finding id and invariant result id", async () => {
    queue("findings", "select", { data: row(), error: null });
    queue("findings", "update", {
      data: row({
        diagnosis_code: "RC-016",
        diagnosis_strength: "INSUFFICIENT_EVIDENCE",
        diagnosed_at: ATTEMPTED_AT,
        updated_at: ATTEMPTED_AT,
      }),
      error: null,
    });

    await persistFindingDiagnosis(persistInput());

    const update = recorded.find((entry) => entry.op === "update")!;
    expect(update.filters).toEqual([
      ["id", FINDING_ID],
      ["invariant_result_id", RESULT_ID],
    ]);
    // No broad status / scenario / date predicate.
    const columns = update.filters.map(([column]) => column);
    for (const forbidden of ["status", "created_at", "updated_at", "title"]) {
      expect(columns, forbidden).not.toContain(forbidden);
    }
  });

  it("3: the update is guarded by the fresh all-NULL advisory state", async () => {
    queue("findings", "select", { data: row(), error: null });
    queue("findings", "update", {
      data: row({
        diagnosis_code: "RC-016",
        diagnosis_strength: "INSUFFICIENT_EVIDENCE",
        diagnosed_at: ATTEMPTED_AT,
        updated_at: ATTEMPTED_AT,
      }),
      error: null,
    });

    await persistFindingDiagnosis(persistInput());

    const update = recorded.find((entry) => entry.op === "update")!;
    expect(update.isFilters).toEqual([
      ["diagnosis_code", null],
      ["diagnosis_strength", null],
      ["diagnosed_at", null],
      ["diagnosis_summary", null],
      ["recommendation_code", null],
      ["recommendation_text", null],
    ]);
  });

  it("3b: only findings is touched, and only by select and update", async () => {
    queue("findings", "select", { data: row(), error: null });
    queue("findings", "update", {
      data: row({
        diagnosis_code: "RC-016",
        diagnosis_strength: "INSUFFICIENT_EVIDENCE",
        diagnosed_at: ATTEMPTED_AT,
        updated_at: ATTEMPTED_AT,
      }),
      error: null,
    });

    await persistFindingDiagnosis(persistInput());

    expect(ops()).toEqual(["findings:select", "findings:update"]);
    for (const entry of recorded) {
      expect(entry.table).toBe("findings");
      expect(["select", "update"]).toContain(entry.op);
    }
  });
});

describe("Phase 4C-R2 diagnosis repository — idempotent reuse", () => {
  it("4: an equivalent existing diagnosis performs ZERO mutation", async () => {
    queue("findings", "select", {
      data: row({
        diagnosis_code: "RC-016",
        diagnosis_strength: "INSUFFICIENT_EVIDENCE",
        diagnosed_at: ORIGINAL_AT,
        updated_at: ORIGINAL_AT,
      }),
      error: null,
    });

    const result = await persistFindingDiagnosis(persistInput());

    expect(result.kind).toBe("ALREADY_DIAGNOSED");
    expect(ops()).toEqual(["findings:select"]);
    expect(recorded.some((entry) => entry.op === "update")).toBe(false);
  });

  it("5: the ORIGINAL timestamps are preserved, not the new attempt", async () => {
    queue("findings", "select", {
      data: row({
        diagnosis_code: "RC-016",
        diagnosis_strength: "INSUFFICIENT_EVIDENCE",
        diagnosed_at: ORIGINAL_AT,
        updated_at: ORIGINAL_AT,
      }),
      error: null,
    });

    const result = await persistFindingDiagnosis(persistInput());

    expect(result.diagnosedAt).toBe(ORIGINAL_AT);
    expect(result.updatedAt).toBe(ORIGINAL_AT);
    expect(result.diagnosedAt).not.toBe(ATTEMPTED_AT);
  });

  it("6: later-phase summary and recommendation fields do not break reuse", async () => {
    // A later phase legitimately owns these; 4C neither compares nor clears
    // them.
    queue("findings", "select", {
      data: row({
        diagnosis_code: "RC-016",
        diagnosis_strength: "INSUFFICIENT_EVIDENCE",
        diagnosed_at: ORIGINAL_AT,
        diagnosis_summary: "A later-phase explanation.",
        recommendation_code: "FIX-EXAMPLE",
        recommendation_text: "A later-phase recommendation.",
      }),
      error: null,
    });

    const result = await persistFindingDiagnosis(persistInput());

    expect(result.kind).toBe("ALREADY_DIAGNOSED");
    expect(recorded.some((entry) => entry.op === "update")).toBe(false);
  });
});

describe("Phase 4C-R2 diagnosis repository — integrity conflicts", () => {
  async function expectConflict(existing: Record<string, unknown>) {
    queue("findings", "select", { data: row(existing), error: null });
    await expect(persistFindingDiagnosis(persistInput())).rejects.toMatchObject(
      {
        code: "DIAGNOSIS_PERSIST_INTEGRITY_CONFLICT",
      },
    );
    expect(recorded.some((entry) => entry.op === "update")).toBe(false);
  }

  it("7a: a code with no strength is a conflict", async () => {
    await expectConflict({
      diagnosis_code: "RC-016",
      diagnosed_at: ORIGINAL_AT,
    });
  });

  it("7b: a strength with no code is a conflict", async () => {
    await expectConflict({
      diagnosis_strength: "INSUFFICIENT_EVIDENCE",
      diagnosed_at: ORIGINAL_AT,
    });
  });

  it("7c: a diagnosis timestamp with no diagnosis is a conflict", async () => {
    await expectConflict({ diagnosed_at: ORIGINAL_AT });
  });

  it("8: a different diagnosis code is a conflict, never an overwrite", async () => {
    await expectConflict({
      diagnosis_code: "RC-003",
      diagnosis_strength: "INSUFFICIENT_EVIDENCE",
      diagnosed_at: ORIGINAL_AT,
    });
  });

  it("9: a different diagnosis strength is a conflict", async () => {
    await expectConflict({
      diagnosis_code: "RC-016",
      diagnosis_strength: "STRONG_EVIDENCE",
      diagnosed_at: ORIGINAL_AT,
    });
  });

  it("10: a populated diagnosis with no timestamp is a conflict", async () => {
    await expectConflict({
      diagnosis_code: "RC-016",
      diagnosis_strength: "INSUFFICIENT_EVIDENCE",
      diagnosed_at: null,
    });
  });

  it("11: a summary or recommendation with no diagnosis is a conflict", async () => {
    await expectConflict({ diagnosis_summary: "An orphaned explanation." });
    recorded = [];
    queued = {};
    await expectConflict({ recommendation_code: "FIX-EXAMPLE" });
    recorded = [];
    queued = {};
    await expectConflict({
      recommendation_text: "An orphaned recommendation.",
    });
  });

  it("11b: a finding reporting a different invariant result is a conflict", async () => {
    queue("findings", "select", {
      data: row({ invariant_result_id: OTHER_RESULT_ID }),
      error: null,
    });
    await expect(persistFindingDiagnosis(persistInput())).rejects.toMatchObject(
      {
        code: "DIAGNOSIS_PERSIST_INTEGRITY_CONFLICT",
      },
    );
    expect(recorded.some((entry) => entry.op === "update")).toBe(false);
  });
});

describe("Phase 4C-R2 diagnosis repository — failures", () => {
  it("12: an absent finding is a typed NOT_FOUND", async () => {
    queue("findings", "select", { data: null, error: null });
    await expect(persistFindingDiagnosis(persistInput())).rejects.toMatchObject(
      {
        code: "DIAGNOSIS_PERSIST_FINDING_NOT_FOUND",
      },
    );
  });

  it("12b: an identifier that is not a UUID is rejected before any query", async () => {
    await expect(
      persistFindingDiagnosis(persistInput({ findingId: "not-a-uuid" })),
    ).rejects.toMatchObject({
      code: "DIAGNOSIS_PERSIST_FINDING_ID_INVALID",
    });
    expect(recorded).toEqual([]);
  });

  it("13: a SELECT failure is READ_FAILED and never absence", async () => {
    queue("findings", "select", {
      data: null,
      error: { code: "PGRST500", message: "boom", details: "secret detail" },
    });
    await expect(persistFindingDiagnosis(persistInput())).rejects.toMatchObject(
      {
        code: "DIAGNOSIS_PERSIST_READ_FAILED",
      },
    );
  });

  it("13b: no raw database error text escapes in the message", async () => {
    queue("findings", "select", {
      data: null,
      error: { code: "PGRST500", message: "boom", details: "secret detail" },
    });
    try {
      await persistFindingDiagnosis(persistInput());
      throw new Error("expected throw");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).not.toContain("boom");
      expect(message).not.toContain("secret detail");
      expect(message).not.toContain("PGRST500");
    }
  });

  it("14: an UPDATE failure is a typed UPDATE_FAILED", async () => {
    queue("findings", "select", { data: row(), error: null });
    queue("findings", "update", {
      data: null,
      error: { code: "PGRST500", message: "boom" },
    });
    await expect(persistFindingDiagnosis(persistInput())).rejects.toMatchObject(
      {
        code: "DIAGNOSIS_PERSIST_UPDATE_FAILED",
      },
    );
  });
});

describe("Phase 4C-R2 diagnosis repository — concurrency", () => {
  it("15: a concurrent EQUIVALENT winner yields ALREADY_DIAGNOSED", async () => {
    queue("findings", "select", { data: row(), error: null });
    // The guarded update matched no row: someone else got there first.
    queue("findings", "update", { data: null, error: null });
    queue("findings", "select", {
      data: row({
        diagnosis_code: "RC-016",
        diagnosis_strength: "INSUFFICIENT_EVIDENCE",
        diagnosed_at: ORIGINAL_AT,
        updated_at: ORIGINAL_AT,
      }),
      error: null,
    });

    const result = await persistFindingDiagnosis(persistInput());

    expect(result.kind).toBe("ALREADY_DIAGNOSED");
    expect(result.diagnosedAt).toBe(ORIGINAL_AT);
  });

  it("16: a concurrent CONTRADICTORY winner is an integrity conflict", async () => {
    queue("findings", "select", { data: row(), error: null });
    queue("findings", "update", { data: null, error: null });
    queue("findings", "select", {
      data: row({
        diagnosis_code: "RC-003",
        diagnosis_strength: "STRONG_EVIDENCE",
        diagnosed_at: ORIGINAL_AT,
      }),
      error: null,
    });

    await expect(persistFindingDiagnosis(persistInput())).rejects.toMatchObject(
      {
        code: "DIAGNOSIS_PERSIST_INTEGRITY_CONFLICT",
      },
    );
  });

  it("17: there is NO retry loop — the update is attempted exactly once", async () => {
    queue("findings", "select", { data: row(), error: null });
    queue("findings", "update", { data: null, error: null });
    queue("findings", "select", {
      data: row({
        diagnosis_code: "RC-016",
        diagnosis_strength: "INSUFFICIENT_EVIDENCE",
        diagnosed_at: ORIGINAL_AT,
      }),
      error: null,
    });

    await persistFindingDiagnosis(persistInput());

    expect(ops()).toEqual([
      "findings:select",
      "findings:update",
      "findings:select",
    ]);
    expect(recorded.filter((entry) => entry.op === "update")).toHaveLength(1);
  });
});

describe("Phase 4C-R2 diagnosis repository — forbidden operations", () => {
  it("18: no insert, upsert, delete or rpc is ever issued", async () => {
    queue("findings", "select", { data: row(), error: null });
    queue("findings", "update", {
      data: row({
        diagnosis_code: "RC-016",
        diagnosis_strength: "INSUFFICIENT_EVIDENCE",
        diagnosed_at: ATTEMPTED_AT,
        updated_at: ATTEMPTED_AT,
      }),
      error: null,
    });

    await persistFindingDiagnosis(persistInput());

    for (const forbidden of ["insert", "upsert", "delete", "rpc"]) {
      expect(
        recorded.some((entry) => entry.op === forbidden),
        forbidden,
      ).toBe(false);
    }
  });

  it("19: status and resolved_at are never written", async () => {
    queue("findings", "select", { data: row(), error: null });
    queue("findings", "update", {
      data: row({
        diagnosis_code: "RC-016",
        diagnosis_strength: "INSUFFICIENT_EVIDENCE",
        diagnosed_at: ATTEMPTED_AT,
        updated_at: ATTEMPTED_AT,
      }),
      error: null,
    });

    await persistFindingDiagnosis(persistInput());

    const update = recorded.find((entry) => entry.op === "update")!;
    for (const forbidden of [
      "status",
      "resolved_at",
      "title",
      "id",
      "invariant_result_id",
      "created_at",
      "diagnosis_summary",
      "recommendation_code",
      "recommendation_text",
    ]) {
      expect(Object.keys(update.payload!), forbidden).not.toContain(forbidden);
    }
  });

  it("20: no authoritative merchant or evidence table is ever addressed", async () => {
    queue("findings", "select", { data: row(), error: null });
    queue("findings", "update", {
      data: row({
        diagnosis_code: "RC-016",
        diagnosis_strength: "INSUFFICIENT_EVIDENCE",
        diagnosed_at: ATTEMPTED_AT,
        updated_at: ATTEMPTED_AT,
      }),
      error: null,
    });

    await persistFindingDiagnosis(persistInput());

    for (const table of [
      "orders",
      "payment_attempts",
      "payments",
      "fulfilments",
      "webhook_events",
      "event_processing_attempts",
      "chaos_runs",
      "invariant_results",
    ]) {
      expect(
        recorded.some((entry) => entry.table === table),
        table,
      ).toBe(false);
    }
  });

  it("21: the read projection is an explicit allowlist, never select(*)", async () => {
    queue("findings", "select", { data: row(), error: null });
    await readFindingDiagnosisState(FINDING_ID);

    const select = recorded.find((entry) => entry.op === "select")!;
    expect(select.projection).toBeTypeOf("string");
    expect(select.projection).not.toContain("*");
    expect(select.projection).toContain("diagnosis_code");
    expect(select.projection).toContain("diagnosed_at");
  });

  it("22: the error vocabulary is exactly the five approved codes", () => {
    expect([...ROOT_CAUSE_REPOSITORY_ERROR_CODES]).toEqual([
      "DIAGNOSIS_PERSIST_FINDING_ID_INVALID",
      "DIAGNOSIS_PERSIST_FINDING_NOT_FOUND",
      "DIAGNOSIS_PERSIST_READ_FAILED",
      "DIAGNOSIS_PERSIST_UPDATE_FAILED",
      "DIAGNOSIS_PERSIST_INTEGRITY_CONFLICT",
    ]);
    expect(
      new RootCauseRepositoryError("DIAGNOSIS_PERSIST_READ_FAILED", "fixed")
        .name,
    ).toBe("RootCauseRepositoryError");
  });
});
