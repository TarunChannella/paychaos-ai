import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getSupabaseServerClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: () => getSupabaseServerClient(),
}));

import {
  persistFindingRecommendation,
  readFindingRecommendationState,
  RECOMMENDATION_REPOSITORY_ERROR_CODES,
  RecommendationRepositoryError,
} from "@/lib/diagnosis/recommendation-repository";

/**
 * Phase 4D-R2 — the recommendation repository's I/O behaviour against a
 * programmable fake Supabase client, following the Phase 3G / 4C pattern.
 *
 * This proves the SELECT + guarded-UPDATE algorithm: the first write, its
 * exact payload and guards, equivalent reuse with zero mutation, the
 * concurrent-loser re-read, and every integrity conflict — plus that Phase
 * 4C's diagnosis columns are used only as preconditions and never written.
 */

const FINDING_ID = "22222222-2222-4222-8222-222222222222";
const RESULT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_RESULT_ID = "33333333-3333-4333-8333-333333333333";
const DIAGNOSED_AT = "2026-08-30T09:00:00.000Z";
const ORIGINAL_AT = "2026-08-30T09:00:00.000Z";
const ATTEMPTED_AT = "2026-08-31T12:00:00.000Z";

const SUMMARY = "INV-005 failed. PayChaos selected RC-016.";
const REC_TEXT = "The invariant failure is proven, but a cause is not.";

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

/** A diagnosed Finding with every recommendation field still NULL. */
function row(overrides: Record<string, unknown> = {}) {
  return {
    id: FINDING_ID,
    invariant_result_id: RESULT_ID,
    status: "OPEN",
    title: "INV-005 — Invalid Signature Causes Zero Business Mutation",
    diagnosis_code: "RC-016",
    diagnosis_strength: "INSUFFICIENT_EVIDENCE",
    diagnosis_summary: null,
    recommendation_code: null,
    recommendation_text: null,
    diagnosed_at: DIAGNOSED_AT,
    resolved_at: null,
    created_at: "2026-08-29T09:00:00.000Z",
    updated_at: ORIGINAL_AT,
    ...overrides,
  };
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    findingId: FINDING_ID,
    invariantResultId: RESULT_ID,
    expectedDiagnosisCode: "RC-016" as const,
    expectedDiagnosisStrength: "INSUFFICIENT_EVIDENCE" as const,
    expectedDiagnosedAt: DIAGNOSED_AT,
    diagnosisSummary: SUMMARY,
    recommendationCode: "INVESTIGATE-EVIDENCE-GAP" as const,
    recommendationText: REC_TEXT,
    attemptedAt: ATTEMPTED_AT,
    ...overrides,
  };
}

/** The row shape produced by a successful first write. */
function writtenRow() {
  return row({
    diagnosis_summary: SUMMARY,
    recommendation_code: "INVESTIGATE-EVIDENCE-GAP",
    recommendation_text: REC_TEXT,
    updated_at: ATTEMPTED_AT,
  });
}

function ops(): string[] {
  return recorded.map((entry) => `${entry.table}:${entry.op}`);
}

function queueFirstWrite(): void {
  queue("findings", "select", { data: row(), error: null });
  queue("findings", "update", { data: writtenRow(), error: null });
}

beforeEach(() => {
  recorded = [];
  queued = {};
  getSupabaseServerClient.mockReset();
  getSupabaseServerClient.mockImplementation(() => makeClient());
});

describe("Phase 4D-R2 recommendation repository — first write", () => {
  it("1: the module is server-only and exposes the frozen error vocabulary", () => {
    expect([...RECOMMENDATION_REPOSITORY_ERROR_CODES]).toEqual([
      "RECOMMENDATION_PERSIST_FINDING_ID_INVALID",
      "RECOMMENDATION_PERSIST_FINDING_NOT_FOUND",
      "RECOMMENDATION_PERSIST_READ_FAILED",
      "RECOMMENDATION_PERSIST_UPDATE_FAILED",
      "RECOMMENDATION_PERSIST_INTEGRITY_CONFLICT",
    ]);
    expect(
      new RecommendationRepositoryError(
        "RECOMMENDATION_PERSIST_READ_FAILED",
        "fixed",
      ).name,
    ).toBe("RecommendationRepositoryError");
  });

  it("2/3: a fresh finding writes exactly the four approved columns", async () => {
    queueFirstWrite();

    const result = await persistFindingRecommendation(input());

    expect(result.kind).toBe("RECOMMENDED");
    expect(result.recommendationCode).toBe("INVESTIGATE-EVIDENCE-GAP");
    expect(result.updatedAt).toBe(ATTEMPTED_AT);

    const update = recorded.find((entry) => entry.op === "update")!;
    expect(Object.keys(update.payload!).sort()).toEqual([
      "diagnosis_summary",
      "recommendation_code",
      "recommendation_text",
      "updated_at",
    ]);
    expect(update.payload).toEqual({
      diagnosis_summary: SUMMARY,
      recommendation_code: "INVESTIGATE-EVIDENCE-GAP",
      recommendation_text: REC_TEXT,
      updated_at: ATTEMPTED_AT,
    });
  });

  it("4-8: the update is pinned by identity AND the exact Phase 4C diagnosis", async () => {
    queueFirstWrite();
    await persistFindingRecommendation(input());

    const update = recorded.find((entry) => entry.op === "update")!;
    expect(update.filters).toEqual([
      ["id", FINDING_ID],
      ["invariant_result_id", RESULT_ID],
      ["diagnosis_code", "RC-016"],
      ["diagnosis_strength", "INSUFFICIENT_EVIDENCE"],
      ["diagnosed_at", DIAGNOSED_AT],
    ]);
    // The Phase 4E lifecycle is deliberately NOT a precondition.
    const columns = update.filters.map(([column]) => column);
    expect(columns).not.toContain("status");
    expect(columns).not.toContain("resolved_at");
  });

  it("9: the update is guarded by all three NULL recommendation fields", async () => {
    queueFirstWrite();
    await persistFindingRecommendation(input());

    const update = recorded.find((entry) => entry.op === "update")!;
    expect(update.isFilters).toEqual([
      ["diagnosis_summary", null],
      ["recommendation_code", null],
      ["recommendation_text", null],
    ]);
  });
});

describe("Phase 4D-R2 recommendation repository — idempotent reuse", () => {
  it("10/11: an equivalent existing recommendation performs ZERO mutation", async () => {
    queue("findings", "select", {
      data: row({
        diagnosis_summary: SUMMARY,
        recommendation_code: "INVESTIGATE-EVIDENCE-GAP",
        recommendation_text: REC_TEXT,
      }),
      error: null,
    });

    const result = await persistFindingRecommendation(input());

    expect(result.kind).toBe("ALREADY_RECOMMENDED");
    expect(ops()).toEqual(["findings:select"]);
    expect(recorded.some((entry) => entry.op === "update")).toBe(false);
  });

  it("12: the ORIGINAL updated_at is preserved, not the new attempt", async () => {
    queue("findings", "select", {
      data: row({
        diagnosis_summary: SUMMARY,
        recommendation_code: "INVESTIGATE-EVIDENCE-GAP",
        recommendation_text: REC_TEXT,
        updated_at: ORIGINAL_AT,
      }),
      error: null,
    });

    const result = await persistFindingRecommendation(input());

    expect(result.updatedAt).toBe(ORIGINAL_AT);
    expect(result.updatedAt).not.toBe(ATTEMPTED_AT);
  });
});

describe("Phase 4D-R2 recommendation repository — integrity conflicts", () => {
  async function expectConflict(
    existing: Record<string, unknown>,
    overrides: Record<string, unknown> = {},
  ) {
    recorded = [];
    queued = {};
    queue("findings", "select", { data: row(existing), error: null });
    await expect(
      persistFindingRecommendation(input(overrides)),
    ).rejects.toMatchObject({
      code: "RECOMMENDATION_PERSIST_INTEGRITY_CONFLICT",
    });
    expect(recorded.some((entry) => entry.op === "update")).toBe(false);
  }

  it("13: a summary with no recommendation is a conflict", async () => {
    await expectConflict({ diagnosis_summary: SUMMARY });
  });

  it("14: a recommendation code with no summary or text is a conflict", async () => {
    await expectConflict({ recommendation_code: "INVESTIGATE-EVIDENCE-GAP" });
  });

  it("15: recommendation text with no code is a conflict", async () => {
    await expectConflict({ recommendation_text: REC_TEXT });
  });

  it("16: a contradictory summary is a conflict, never an overwrite", async () => {
    await expectConflict({
      diagnosis_summary: "A different summary.",
      recommendation_code: "INVESTIGATE-EVIDENCE-GAP",
      recommendation_text: REC_TEXT,
    });
  });

  it("17: a contradictory recommendation code is a conflict", async () => {
    await expectConflict({
      diagnosis_summary: SUMMARY,
      recommendation_code: "FIX-WEBHOOK-AUTH",
      recommendation_text: REC_TEXT,
    });
  });

  it("18: contradictory recommendation text is a conflict", async () => {
    await expectConflict({
      diagnosis_summary: SUMMARY,
      recommendation_code: "INVESTIGATE-EVIDENCE-GAP",
      recommendation_text: "Different remediation text.",
    });
  });

  it("19: a diagnosis-code mismatch is a conflict", async () => {
    await expectConflict({ diagnosis_code: "RC-003" });
  });

  it("20: a diagnosis-strength mismatch is a conflict", async () => {
    await expectConflict({ diagnosis_strength: "STRONG_EVIDENCE" });
  });

  it("21: a diagnosed_at mismatch is a conflict", async () => {
    await expectConflict({ diagnosed_at: "2026-01-01T00:00:00.000Z" });
    await expectConflict({ diagnosed_at: null });
  });

  it("21b: a different invariant result is a conflict", async () => {
    await expectConflict({ invariant_result_id: OTHER_RESULT_ID });
  });
});

describe("Phase 4D-R2 recommendation repository — failures", () => {
  it("22: an absent finding is a typed NOT_FOUND", async () => {
    queue("findings", "select", { data: null, error: null });
    await expect(persistFindingRecommendation(input())).rejects.toMatchObject({
      code: "RECOMMENDATION_PERSIST_FINDING_NOT_FOUND",
    });
  });

  it("22b: an identifier that is not a UUID is rejected before any query", async () => {
    await expect(
      persistFindingRecommendation(input({ findingId: "not-a-uuid" })),
    ).rejects.toMatchObject({
      code: "RECOMMENDATION_PERSIST_FINDING_ID_INVALID",
    });
    expect(recorded).toEqual([]);
  });

  it("23: a SELECT failure is READ_FAILED and never absence", async () => {
    queue("findings", "select", {
      data: null,
      error: { code: "PGRST500", message: "boom", details: "secret detail" },
    });
    await expect(persistFindingRecommendation(input())).rejects.toMatchObject({
      code: "RECOMMENDATION_PERSIST_READ_FAILED",
    });
  });

  it("24: an UPDATE failure is a typed UPDATE_FAILED", async () => {
    queue("findings", "select", { data: row(), error: null });
    queue("findings", "update", {
      data: null,
      error: { code: "PGRST500", message: "boom" },
    });
    await expect(persistFindingRecommendation(input())).rejects.toMatchObject({
      code: "RECOMMENDATION_PERSIST_UPDATE_FAILED",
    });
  });

  it("31: no raw database error text ever escapes", async () => {
    queue("findings", "select", {
      data: null,
      error: {
        code: "PGRST500",
        message: "boom",
        details: "secret detail",
        hint: "secret hint",
      },
    });
    try {
      await persistFindingRecommendation(input());
      throw new Error("expected throw");
    } catch (error) {
      const message = (error as Error).message;
      for (const leak of ["boom", "secret detail", "secret hint", "PGRST500"]) {
        expect(message, leak).not.toContain(leak);
      }
    }
  });
});

describe("Phase 4D-R2 recommendation repository — concurrency", () => {
  it("25: a concurrent EQUIVALENT winner yields ALREADY_RECOMMENDED", async () => {
    queue("findings", "select", { data: row(), error: null });
    queue("findings", "update", { data: null, error: null });
    queue("findings", "select", {
      data: row({
        diagnosis_summary: SUMMARY,
        recommendation_code: "INVESTIGATE-EVIDENCE-GAP",
        recommendation_text: REC_TEXT,
        updated_at: ORIGINAL_AT,
      }),
      error: null,
    });

    const result = await persistFindingRecommendation(input());

    expect(result.kind).toBe("ALREADY_RECOMMENDED");
    expect(result.updatedAt).toBe(ORIGINAL_AT);
  });

  it("26: a concurrent CONTRADICTORY winner is an integrity conflict", async () => {
    queue("findings", "select", { data: row(), error: null });
    queue("findings", "update", { data: null, error: null });
    queue("findings", "select", {
      data: row({
        diagnosis_summary: "Someone else's summary.",
        recommendation_code: "FIX-WEBHOOK-AUTH",
        recommendation_text: "Someone else's text.",
      }),
      error: null,
    });

    await expect(persistFindingRecommendation(input())).rejects.toMatchObject({
      code: "RECOMMENDATION_PERSIST_INTEGRITY_CONFLICT",
    });
  });

  it("26b: a concurrently re-diagnosed finding is an integrity conflict", async () => {
    queue("findings", "select", { data: row(), error: null });
    queue("findings", "update", { data: null, error: null });
    queue("findings", "select", {
      data: row({
        diagnosis_code: "RC-003",
        diagnosis_summary: SUMMARY,
        recommendation_code: "INVESTIGATE-EVIDENCE-GAP",
        recommendation_text: REC_TEXT,
      }),
      error: null,
    });

    await expect(persistFindingRecommendation(input())).rejects.toMatchObject({
      code: "RECOMMENDATION_PERSIST_INTEGRITY_CONFLICT",
    });
  });

  it("27: there is NO retry loop — the update is attempted exactly once", async () => {
    queue("findings", "select", { data: row(), error: null });
    queue("findings", "update", { data: null, error: null });
    queue("findings", "select", {
      data: row({
        diagnosis_summary: SUMMARY,
        recommendation_code: "INVESTIGATE-EVIDENCE-GAP",
        recommendation_text: REC_TEXT,
      }),
      error: null,
    });

    await persistFindingRecommendation(input());

    expect(ops()).toEqual([
      "findings:select",
      "findings:update",
      "findings:select",
    ]);
    expect(recorded.filter((entry) => entry.op === "update")).toHaveLength(1);
  });
});

describe("Phase 4D-R2 recommendation repository — forbidden operations", () => {
  it("28: no insert, upsert, delete or rpc is ever issued", async () => {
    queueFirstWrite();
    await persistFindingRecommendation(input());

    for (const forbidden of ["insert", "upsert", "delete", "rpc"]) {
      expect(
        recorded.some((entry) => entry.op === forbidden),
        forbidden,
      ).toBe(false);
    }
  });

  it("29: only the findings table is ever addressed", async () => {
    queueFirstWrite();
    await persistFindingRecommendation(input());

    expect(ops()).toEqual(["findings:select", "findings:update"]);
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

  it("30: status, resolved_at and the Phase 4C diagnosis are never written", async () => {
    queueFirstWrite();
    await persistFindingRecommendation(input());

    const update = recorded.find((entry) => entry.op === "update")!;
    for (const forbidden of [
      "status",
      "resolved_at",
      "title",
      "id",
      "invariant_result_id",
      "created_at",
      // The whole point: Phase 4C's columns are preconditions, not payload.
      "diagnosis_code",
      "diagnosis_strength",
      "diagnosed_at",
    ]) {
      expect(Object.keys(update.payload!), forbidden).not.toContain(forbidden);
    }
  });

  it("30b: the read projection is an explicit allowlist, never select(*)", async () => {
    queue("findings", "select", { data: row(), error: null });
    await readFindingRecommendationState(FINDING_ID);

    const select = recorded.find((entry) => entry.op === "select")!;
    expect(select.projection).toBeTypeOf("string");
    expect(select.projection).not.toContain("*");
    expect(select.projection).toContain("recommendation_code");
    expect(select.projection).toContain("diagnosis_summary");
  });
});
