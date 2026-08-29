import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getSupabaseServerClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: () => getSupabaseServerClient(),
}));

import {
  findFindingById,
  findFindingByInvariantResultId,
  findInvariantResultById,
  insertOpenFinding,
  listInvariantResultsForChaosRun,
  FindingRepositoryError,
} from "@/lib/findings/repository";

/**
 * Phase 3G — the repository's I/O behaviour against a programmable fake
 * Supabase client.
 *
 * This proves the INSERT-ONLY algorithm itself: first insert, equivalent
 * reuse, the concurrent-loser re-read, integrity conflicts — and, critically,
 * that `findings` is only ever read or inserted, never updated, upserted or
 * deleted, and that the inserted payload carries no Phase 4 field.
 */

const RESULT_ID = "11111111-1111-4111-8111-111111111111";
const RUN_ID = "99999999-9999-4999-8999-999999999999";
const FINDING_ID = "22222222-2222-4222-8222-222222222222";
const TITLE = "INV-003 — Failed Payment Never Marks Order Paid";

interface Recorded {
  table: string;
  op: string;
  payload?: Record<string, unknown>;
  filters: Array<[string, unknown]>;
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

function makeClient() {
  return {
    from(table: string) {
      const build = (op: string, payload?: unknown) => {
        const entry: Recorded = {
          table,
          op,
          payload: payload as Record<string, unknown> | undefined,
          filters: [],
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
          order() {
            return Promise.resolve(nextResult(table, op));
          },
          maybeSingle() {
            return Promise.resolve(nextResult(table, op));
          },
          single() {
            return Promise.resolve(nextResult(table, op));
          },
          then(resolve: (v: unknown) => unknown) {
            return Promise.resolve(nextResult(table, op)).then(resolve);
          },
        };
        return chain;
      };
      return {
        select: (projection?: string) =>
          build("select", undefined).select(projection),
        insert: (payload: unknown) => build("insert", payload),
        update: (payload: unknown) => build("update", payload),
        delete: () => build("delete"),
        upsert: (payload: unknown) => build("upsert", payload),
      };
    },
  };
}

function dbFinding(overrides: Record<string, unknown> = {}) {
  return {
    id: FINDING_ID,
    invariant_result_id: RESULT_ID,
    status: "OPEN",
    title: TITLE,
    created_at: "2026-08-20T10:00:00.000Z",
    updated_at: "2026-08-20T10:00:00.000Z",
    ...overrides,
  };
}

function dbResult(overrides: Record<string, unknown> = {}) {
  return {
    id: RESULT_ID,
    invariant_id: "INV-003",
    invariant_version: "1",
    order_id: null,
    payment_attempt_id: null,
    payment_id: null,
    chaos_run_id: RUN_ID,
    result: "FAIL",
    severity: "CRITICAL",
    expected_summary: "expected",
    observed_summary: "observed",
    reason: "reason",
    evidence_refs: [{ kind: "CHAOS_RUN", id: RUN_ID }],
    evaluated_at: "2026-08-20T09:59:00.000Z",
    ...overrides,
  };
}

function queue(
  key: string,
  ...results: Array<{ data: unknown; error: unknown }>
) {
  queued[key] = [...(queued[key] ?? []), ...results];
}

const ok = (data: unknown) => ({ data, error: null });
const fails = { data: null, error: { message: "duplicate key value" } };

beforeEach(() => {
  recorded = [];
  queued = {};
  getSupabaseServerClient.mockReturnValue(makeClient());
});

/** Every mutating call this test run observed, by table and verb. */
function mutations() {
  return recorded.filter((r) => r.op !== "select");
}

describe("Phase 3G repository — reads", () => {
  it("1: an invariant result is read by exact id with an explicit projection", async () => {
    queue("invariant_results:select", ok(dbResult()));

    const row = await findInvariantResultById(RESULT_ID);

    expect(row!.id).toBe(RESULT_ID);
    const read = recorded.find((r) => r.table === "invariant_results")!;
    expect(read.filters).toEqual([["id", RESULT_ID]]);
    expect(read.projection).toBeDefined();
    expect(read.projection).not.toContain("*");
    expect(mutations()).toHaveLength(0);
  });

  it("2: a missing invariant result is null, not an error", async () => {
    queue("invariant_results:select", ok(null));
    expect(await findInvariantResultById(RESULT_ID)).toBeNull();
  });

  it("3: a read failure raises a safe typed error with no raw database text", async () => {
    queue("invariant_results:select", {
      data: null,
      error: { message: 'relation "x" does not exist', hint: "leak" },
    });

    let thrown: unknown;
    try {
      await findInvariantResultById(RESULT_ID);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(FindingRepositoryError);
    expect((thrown as FindingRepositoryError).code).toBe("FINDING_READ_FAILED");
    expect((thrown as Error).message).not.toContain("relation");
    expect((thrown as Error).message).not.toContain("leak");
  });

  it("4: run-level results are read by chaos_run_id and ordered by invariant_id", async () => {
    queue(
      "invariant_results:select",
      ok([dbResult(), dbResult({ id: "x", invariant_id: "INV-004" })]),
    );

    const rows = await listInvariantResultsForChaosRun(RUN_ID);

    expect(rows).toHaveLength(2);
    const read = recorded.find((r) => r.table === "invariant_results")!;
    expect(read.filters).toEqual([["chaos_run_id", RUN_ID]]);
    expect(mutations()).toHaveLength(0);
  });

  it("5: a finding is read by invariant_result_id, and by its own id", async () => {
    queue("findings:select", ok(dbFinding()), ok(dbFinding()));

    const byResult = await findFindingByInvariantResultId(RESULT_ID);
    const byId = await findFindingById(FINDING_ID);

    expect(byResult!.id).toBe(FINDING_ID);
    expect(byId!.invariantResultId).toBe(RESULT_ID);
    expect(recorded[0]!.filters).toEqual([["invariant_result_id", RESULT_ID]]);
    expect(recorded[1]!.filters).toEqual([["id", FINDING_ID]]);
    expect(mutations()).toHaveLength(0);
  });

  it("6: a non-UUID identifier is rejected before any query is issued", async () => {
    for (const call of [
      () => findInvariantResultById("nope"),
      () => findFindingByInvariantResultId("nope"),
      () => findFindingById("nope"),
      () => listInvariantResultsForChaosRun("nope"),
    ]) {
      await expect(call()).rejects.toBeInstanceOf(FindingRepositoryError);
    }
    expect(recorded).toHaveLength(0);
  });
});

describe("Phase 3G repository — insertOpenFinding", () => {
  it("7: with no existing finding it INSERTs exactly one OPEN row", async () => {
    queue("findings:select", ok(null));
    queue("findings:insert", ok(dbFinding()));

    const persistence = await insertOpenFinding(RESULT_ID, TITLE);

    expect(persistence.kind).toBe("INSERTED");
    expect(persistence.finding.status).toBe("OPEN");

    const inserts = recorded.filter((r) => r.op === "insert");
    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.table).toBe("findings");
  });

  it("8: the inserted payload carries ONLY the three creation fields", async () => {
    queue("findings:select", ok(null));
    queue("findings:insert", ok(dbFinding()));

    await insertOpenFinding(RESULT_ID, TITLE);

    const payload = recorded.find((r) => r.op === "insert")!.payload!;
    expect(Object.keys(payload).sort()).toEqual([
      "invariant_result_id",
      "status",
      "title",
    ]);
    expect(payload.status).toBe("OPEN");
    expect(payload.title).toBe(TITLE);

    // Not one Phase 4 field, and no hand-set timestamp.
    for (const forbidden of [
      "diagnosis_code",
      "diagnosis_strength",
      "diagnosis_summary",
      "recommendation_code",
      "recommendation_text",
      "diagnosed_at",
      "resolved_at",
      "created_at",
      "updated_at",
      "id",
    ]) {
      expect(payload, forbidden).not.toHaveProperty(forbidden);
    }
  });

  it("9: an existing equivalent finding is returned unchanged and nothing is written", async () => {
    queue("findings:select", ok(dbFinding()));

    const persistence = await insertOpenFinding(RESULT_ID, TITLE);

    expect(persistence.kind).toBe("ALREADY_PRESENT");
    expect(persistence.finding.id).toBe(FINDING_ID);
    expect(mutations()).toHaveLength(0);
  });

  it("10: an existing RESOLVED finding is reused unchanged — never reopened", async () => {
    queue(
      "findings:select",
      ok(
        dbFinding({ status: "RESOLVED", resolved_at: "2026-09-01T00:00:00Z" }),
      ),
    );

    const persistence = await insertOpenFinding(RESULT_ID, TITLE);

    expect(persistence.kind).toBe("ALREADY_PRESENT");
    expect(persistence.finding.status).toBe("RESOLVED");
    expect(mutations()).toHaveLength(0);
  });

  it("11: an existing STILL_FAILING finding is reused unchanged", async () => {
    queue("findings:select", ok(dbFinding({ status: "STILL_FAILING" })));

    const persistence = await insertOpenFinding(RESULT_ID, TITLE);

    expect(persistence.finding.status).toBe("STILL_FAILING");
    expect(mutations()).toHaveLength(0);
  });

  it("12: an existing contradictory title raises an integrity conflict and writes nothing", async () => {
    queue("findings:select", ok(dbFinding({ title: "a different title" })));

    let thrown: unknown;
    try {
      await insertOpenFinding(RESULT_ID, TITLE);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(FindingRepositoryError);
    expect((thrown as FindingRepositoryError).code).toBe(
      "FINDING_INTEGRITY_CONFLICT",
    );
    expect(mutations()).toHaveLength(0);
  });

  it("13: a concurrent equivalent winner is re-read and returned, not retried", async () => {
    queue("findings:select", ok(null), ok(dbFinding()));
    queue("findings:insert", fails);

    const persistence = await insertOpenFinding(RESULT_ID, TITLE);

    expect(persistence.kind).toBe("ALREADY_PRESENT");
    expect(persistence.finding.id).toBe(FINDING_ID);
    // Exactly one insert attempt — no retry loop.
    expect(recorded.filter((r) => r.op === "insert")).toHaveLength(1);
  });

  it("14: a concurrent CONTRADICTORY winner raises an integrity conflict", async () => {
    queue("findings:select", ok(null), ok(dbFinding({ title: "other" })));
    queue("findings:insert", fails);

    await expect(insertOpenFinding(RESULT_ID, TITLE)).rejects.toMatchObject({
      code: "FINDING_INTEGRITY_CONFLICT",
    });
  });

  it("15: an insert failure with no winner is a safe FINDING_INSERT_FAILED", async () => {
    queue("findings:select", ok(null), ok(null));
    queue("findings:insert", fails);

    let thrown: unknown;
    try {
      await insertOpenFinding(RESULT_ID, TITLE);
    } catch (error) {
      thrown = error;
    }
    expect((thrown as FindingRepositoryError).code).toBe(
      "FINDING_INSERT_FAILED",
    );
    expect((thrown as Error).message).not.toContain("duplicate key");
  });

  it("16: across every path, findings is only ever selected or inserted", async () => {
    // Happy path, reuse path, and race path in one run.
    queue(
      "findings:select",
      ok(null),
      ok(dbFinding()),
      ok(null),
      ok(dbFinding()),
    );
    queue("findings:insert", ok(dbFinding()), fails);

    await insertOpenFinding(RESULT_ID, TITLE);
    await insertOpenFinding(RESULT_ID, TITLE);
    await insertOpenFinding(RESULT_ID, TITLE);

    const ops = [...new Set(recorded.map((r) => `${r.table}:${r.op}`))].sort();
    expect(ops).toEqual(["findings:insert", "findings:select"]);
  });
});
