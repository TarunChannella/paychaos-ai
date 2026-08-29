import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getSupabaseServerClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: () => getSupabaseServerClient(),
}));

import {
  finalizeChaosRunOutcome,
  findInvariantResult,
  persistInvariantResult,
  InvariantResultRepositoryError,
  type InvariantResultCandidate,
} from "@/lib/invariants/result-repository";

import { RUN_ID } from "./fixtures";

/**
 * Phase 3F-C — the repository's I/O behaviour against a programmable fake
 * Supabase client.
 *
 * This proves the append-only algorithm itself: first insert, equivalent
 * reuse, the concurrent-loser re-read, integrity conflicts, and — critically —
 * that finalizing a chaos run writes EXACTLY ONE column.
 */

interface Recorded {
  table: string;
  op: "select" | "insert" | "update";
  payload?: Record<string, unknown>;
  filters: Array<[string, unknown]>;
}

let recorded: Recorded[] = [];
/** Queued results, consumed in order, keyed by `${table}:${op}`. */
let queued: Record<string, Array<{ data: unknown; error: unknown }>> = {};

function nextResult(table: string, op: string) {
  const key = `${table}:${op}`;
  const queue = queued[key];
  if (!queue || queue.length === 0) {
    throw new Error(`fake client: no queued result for ${key}`);
  }
  return queue.shift()!;
}

function makeClient() {
  return {
    from(table: string) {
      const build = (op: "select" | "insert" | "update", payload?: unknown) => {
        const entry: Recorded = {
          table,
          op,
          payload: payload as Record<string, unknown> | undefined,
          filters: [],
        };
        recorded.push(entry);
        const chain = {
          select() {
            return chain;
          },
          eq(column: string, value: unknown) {
            entry.filters.push([column, value]);
            return chain;
          },
          order() {
            return Promise.resolve(nextResult(table, op));
          },
          maybeSingle() {
            return Promise.resolve(nextResult(table, op));
          },
          then(resolve: (v: unknown) => unknown) {
            return Promise.resolve(nextResult(table, op)).then(resolve);
          },
        };
        return chain;
      };
      return {
        select: () => build("select"),
        insert: (payload: unknown) => build("insert", payload),
        update: (payload: unknown) => build("update", payload),
      };
    },
  };
}

const candidate: InvariantResultCandidate = {
  invariantId: "INV-005",
  invariantVersion: "1",
  orderId: null,
  paymentAttemptId: null,
  paymentId: null,
  chaosRunId: RUN_ID,
  result: "PASS",
  severity: "CRITICAL",
  expectedSummary: "expected",
  observedSummary: "observed",
  reason: "deterministic explanation",
  evidenceRefs: [{ kind: "CHAOS_RUN", id: RUN_ID }],
};

const storedRow = {
  id: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
  invariant_id: "INV-005",
  invariant_version: "1",
  order_id: null,
  payment_attempt_id: null,
  payment_id: null,
  chaos_run_id: RUN_ID,
  result: "PASS",
  severity: "CRITICAL",
  expected_summary: "expected",
  observed_summary: "observed",
  reason: "deterministic explanation",
  evidence_refs: [{ kind: "CHAOS_RUN", id: RUN_ID }],
  evaluated_at: "2026-08-20T10:00:00.000Z",
};

beforeEach(() => {
  recorded = [];
  queued = {};
  getSupabaseServerClient.mockImplementation(() => makeClient());
});

describe("Phase 3F-C — invariant result persistence I/O", () => {
  it("1: no existing row -> INSERT, and the inserted row is returned", async () => {
    queued["invariant_results:select"] = [{ data: null, error: null }];
    queued["invariant_results:insert"] = [{ data: storedRow, error: null }];

    const result = await persistInvariantResult(candidate);
    expect(result.kind).toBe("INSERTED");
    expect(result.row.id).toBe(storedRow.id);

    const insert = recorded.find((r) => r.op === "insert")!;
    expect(insert.table).toBe("invariant_results");
    expect(insert.payload).toMatchObject({
      invariant_id: "INV-005",
      result: "PASS",
      chaos_run_id: RUN_ID,
      order_id: null,
      payment_attempt_id: null,
      payment_id: null,
    });
    // Persistence metadata is never proposed by the caller.
    expect(insert.payload).not.toHaveProperty("id");
    expect(insert.payload).not.toHaveProperty("evaluated_at");
  });

  it("2: an equivalent existing row is reused and NOTHING is written", async () => {
    queued["invariant_results:select"] = [{ data: storedRow, error: null }];

    const result = await persistInvariantResult(candidate);
    expect(result.kind).toBe("ALREADY_PERSISTED");
    expect(result.row.id).toBe(storedRow.id);
    expect(recorded.some((r) => r.op === "insert")).toBe(false);
    expect(recorded.some((r) => r.op === "update")).toBe(false);
  });

  it("3: a contradicting existing row raises an integrity conflict and writes nothing", async () => {
    queued["invariant_results:select"] = [
      { data: { ...storedRow, result: "FAIL" }, error: null },
    ];

    await expect(persistInvariantResult(candidate)).rejects.toMatchObject({
      code: "INVARIANT_RESULT_INTEGRITY_CONFLICT",
    });
    expect(recorded.some((r) => r.op === "insert")).toBe(false);
  });

  it("4: a concurrent winner with an equivalent row is reused after re-read", async () => {
    queued["invariant_results:select"] = [
      { data: null, error: null },
      { data: storedRow, error: null },
    ];
    queued["invariant_results:insert"] = [
      { data: null, error: { message: "duplicate key" } },
    ];

    const result = await persistInvariantResult(candidate);
    expect(result.kind).toBe("ALREADY_PERSISTED");
    expect(result.row.id).toBe(storedRow.id);
  });

  it("5: a concurrent winner with a CONTRADICTING row raises an integrity conflict", async () => {
    queued["invariant_results:select"] = [
      { data: null, error: null },
      { data: { ...storedRow, result: "UNKNOWN" }, error: null },
    ];
    queued["invariant_results:insert"] = [
      { data: null, error: { message: "duplicate key" } },
    ];

    await expect(persistInvariantResult(candidate)).rejects.toMatchObject({
      code: "INVARIANT_RESULT_INTEGRITY_CONFLICT",
    });
  });

  it("6: a genuine insert failure with no row afterwards is INSERT_FAILED", async () => {
    queued["invariant_results:select"] = [
      { data: null, error: null },
      { data: null, error: null },
    ];
    queued["invariant_results:insert"] = [
      { data: null, error: { message: "permission denied" } },
    ];

    await expect(persistInvariantResult(candidate)).rejects.toMatchObject({
      code: "INVARIANT_RESULT_INSERT_FAILED",
    });
  });

  it("7: a lookup failure is LOOKUP_FAILED and never leaks the raw error", async () => {
    queued["invariant_results:select"] = [
      { data: null, error: { message: "relation does not exist: secret-ish" } },
    ];

    const error = await findInvariantResult(RUN_ID, "INV-005").catch(
      (e: InvariantResultRepositoryError) => e,
    );
    expect(error).toBeInstanceOf(InvariantResultRepositoryError);
    expect((error as InvariantResultRepositoryError).code).toBe(
      "INVARIANT_RESULT_LOOKUP_FAILED",
    );
    expect((error as Error).message).not.toContain("relation does not exist");
  });

  it("8: a malformed evidence reference is rejected before any I/O", async () => {
    await expect(
      persistInvariantResult({
        ...candidate,
        evidenceRefs: [{ kind: "CHAOS_RUN", id: "not-a-uuid" }],
      }),
    ).rejects.toMatchObject({ code: "INVARIANT_RESULT_EVIDENCE_REF_INVALID" });
    expect(recorded).toHaveLength(0);
  });

  it("9: an invariant id outside the frozen catalogue is rejected before any I/O", async () => {
    await expect(
      persistInvariantResult({
        ...candidate,
        invariantId: "INV-013" as never,
      }),
    ).rejects.toMatchObject({
      code: "INVARIANT_RESULT_INVARIANT_ID_INVALID",
    });
    expect(recorded).toHaveLength(0);
  });
});

describe("Phase 3F-C — chaos-run outcome finalization writes exactly one column", () => {
  const completedUnknown = {
    data: { id: RUN_ID, status: "COMPLETED", outcome: "UNKNOWN" },
    error: null,
  };

  it("10: finalizing updates ONLY outcome — never updated_at or any other column", async () => {
    queued["chaos_runs:select"] = [completedUnknown];
    queued["chaos_runs:update"] = [
      { data: { id: RUN_ID, outcome: "PASS" }, error: null },
    ];

    const result = await finalizeChaosRunOutcome(RUN_ID, "PASS");
    expect(result).toEqual({ kind: "FINALIZED", outcome: "PASS" });

    const update = recorded.find((r) => r.op === "update")!;
    expect(update.table).toBe("chaos_runs");
    expect(Object.keys(update.payload!)).toEqual(["outcome"]);
    expect(update.payload).toEqual({ outcome: "PASS" });
    expect(update.payload).not.toHaveProperty("updated_at");
    expect(update.payload).not.toHaveProperty("status");
  });

  it("11: the guarded UPDATE is scoped to id + COMPLETED + UNKNOWN", async () => {
    queued["chaos_runs:select"] = [completedUnknown];
    queued["chaos_runs:update"] = [
      { data: { id: RUN_ID, outcome: "PASS" }, error: null },
    ];
    await finalizeChaosRunOutcome(RUN_ID, "PASS");

    const update = recorded.find((r) => r.op === "update")!;
    expect(update.filters).toEqual([
      ["id", RUN_ID],
      ["status", "COMPLETED"],
      ["outcome", "UNKNOWN"],
    ]);
  });

  it("12: an already-equal outcome on a COMPLETED run is idempotent and writes nothing", async () => {
    queued["chaos_runs:select"] = [
      {
        data: { id: RUN_ID, status: "COMPLETED", outcome: "PASS" },
        error: null,
      },
    ];
    const result = await finalizeChaosRunOutcome(RUN_ID, "PASS");
    expect(result).toEqual({ kind: "ALREADY_FINAL", outcome: "PASS" });
    expect(recorded.some((r) => r.op === "update")).toBe(false);
  });

  it("13: an equal outcome on a run that is NO LONGER COMPLETED is an integrity conflict", async () => {
    queued["chaos_runs:select"] = [
      { data: { id: RUN_ID, status: "RUNNING", outcome: "PASS" }, error: null },
    ];
    await expect(finalizeChaosRunOutcome(RUN_ID, "PASS")).rejects.toMatchObject(
      { code: "CHAOS_RUN_OUTCOME_INTEGRITY_CONFLICT" },
    );
    expect(recorded.some((r) => r.op === "update")).toBe(false);
  });

  it.each(["BLOCKED", "ERROR"])(
    "14: an existing %s outcome is never overwritten",
    async (outcome) => {
      queued["chaos_runs:select"] = [
        { data: { id: RUN_ID, status: "COMPLETED", outcome }, error: null },
      ];
      await expect(
        finalizeChaosRunOutcome(RUN_ID, "PASS"),
      ).rejects.toMatchObject({
        code: "CHAOS_RUN_OUTCOME_INTEGRITY_CONFLICT",
      });
      expect(recorded.some((r) => r.op === "update")).toBe(false);
    },
  );

  it("15: a contradicting persisted PASS/FAIL is an integrity conflict", async () => {
    queued["chaos_runs:select"] = [
      {
        data: { id: RUN_ID, status: "COMPLETED", outcome: "FAIL" },
        error: null,
      },
    ];
    await expect(finalizeChaosRunOutcome(RUN_ID, "PASS")).rejects.toMatchObject(
      { code: "CHAOS_RUN_OUTCOME_INTEGRITY_CONFLICT" },
    );
  });

  it("16: a race the caller LOSES re-reads and accepts an equal outcome idempotently", async () => {
    queued["chaos_runs:select"] = [
      completedUnknown,
      {
        data: { id: RUN_ID, status: "COMPLETED", outcome: "PASS" },
        error: null,
      },
    ];
    queued["chaos_runs:update"] = [{ data: null, error: null }];

    const result = await finalizeChaosRunOutcome(RUN_ID, "PASS");
    expect(result).toEqual({ kind: "ALREADY_FINAL", outcome: "PASS" });
  });

  it("17: a race whose re-read contradicts raises an integrity conflict", async () => {
    queued["chaos_runs:select"] = [
      completedUnknown,
      {
        data: { id: RUN_ID, status: "COMPLETED", outcome: "FAIL" },
        error: null,
      },
    ];
    queued["chaos_runs:update"] = [{ data: null, error: null }];

    await expect(finalizeChaosRunOutcome(RUN_ID, "PASS")).rejects.toMatchObject(
      { code: "CHAOS_RUN_OUTCOME_INTEGRITY_CONFLICT" },
    );
  });

  it("18: an update error is FINALIZE_FAILED without leaking the raw error", async () => {
    queued["chaos_runs:select"] = [completedUnknown];
    queued["chaos_runs:update"] = [
      {
        data: null,
        error: { message: "permission denied for table chaos_runs" },
      },
    ];
    const error = await finalizeChaosRunOutcome(RUN_ID, "PASS").catch(
      (e: InvariantResultRepositoryError) => e,
    );
    expect((error as InvariantResultRepositoryError).code).toBe(
      "CHAOS_RUN_OUTCOME_FINALIZE_FAILED",
    );
    expect((error as Error).message).not.toContain("permission denied");
  });

  it("19: a missing chaos run is a lookup failure, not a silent success", async () => {
    queued["chaos_runs:select"] = [{ data: null, error: null }];
    await expect(finalizeChaosRunOutcome(RUN_ID, "PASS")).rejects.toMatchObject(
      { code: "CHAOS_RUN_OUTCOME_LOOKUP_FAILED" },
    );
  });
});
