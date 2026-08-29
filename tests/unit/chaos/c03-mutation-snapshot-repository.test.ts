import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Phase 3F evidence-compatibility correction —
 * `lib/chaos/c03-mutation-snapshot-repository.ts` against a MOCKED Supabase
 * client (no network).
 *
 * The mock records EVERY query the module issues — table, operation kind,
 * selected columns, count options, ordering and limits — so these tests prove
 * not only what the module returns but that it issues ZERO writes, ZERO RPCs,
 * never `select *`, and reads exactly the five tables INV-005 §6 names.
 *
 * Real-Supabase behavior is separately proven by
 * tests/integration/supabase/062-phase3f-evidence-compatibility.integration.test.ts.
 */
vi.mock("server-only", () => ({}));

interface RecordedOp {
  table: string;
  kind: "select" | "update" | "insert" | "delete" | "upsert" | "rpc";
  columns: string | null;
  countOption: string | null;
  orderColumns: string[];
  limits: number[];
  filters: string[];
}

const recordedOps: RecordedOp[] = [];
let responsesByTable: Record<
  string,
  { data?: unknown; count?: number | null; error?: unknown }[]
> = {};

function nextResult(table: string) {
  const queue = responsesByTable[table];
  if (queue && queue.length > 0) return queue.shift()!;
  return { data: null, count: null, error: null };
}

function makeClient() {
  return {
    rpc(name: string) {
      recordedOps.push({
        table: `rpc:${name}`,
        kind: "rpc",
        columns: null,
        countOption: null,
        orderColumns: [],
        limits: [],
        filters: [],
      });
      return Promise.resolve({ data: null, error: null });
    },
    from(table: string) {
      const op: RecordedOp = {
        table,
        kind: "select",
        columns: null,
        countOption: null,
        orderColumns: [],
        limits: [],
        filters: [],
      };
      recordedOps.push(op);

      const builder: Record<string, unknown> = {
        select: (columns?: string, options?: { count?: string }) => {
          op.columns = columns ?? "*";
          op.countOption = options?.count ?? null;
          return builder;
        },
        update: () => {
          op.kind = "update";
          return builder;
        },
        insert: () => {
          op.kind = "insert";
          return builder;
        },
        delete: () => {
          op.kind = "delete";
          return builder;
        },
        upsert: () => {
          op.kind = "upsert";
          return builder;
        },
        eq: (column: string) => {
          op.filters.push(`eq:${column}`);
          return builder;
        },
        order: (column: string) => {
          op.orderColumns.push(column);
          return builder;
        },
        limit: (value: number) => {
          op.limits.push(value);
          return builder;
        },
        then: (
          resolve: (value: unknown) => unknown,
          reject?: (reason: unknown) => unknown,
        ) => Promise.resolve(nextResult(table)).then(resolve, reject),
      };
      return builder;
    },
  };
}

// `makeClient` is a hoisted function declaration, so the factory may call it
// directly. `logEventMock` must go through `vi.hoisted` because a `const` is
// NOT hoisted above the `vi.mock` call.
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: () => makeClient(),
}));

const { logEventMock } = vi.hoisted(() => ({ logEventMock: vi.fn() }));
vi.mock("@/lib/security/logger", () => ({ logEvent: logEventMock }));

import { captureC03MutationSnapshot } from "@/lib/chaos/c03-mutation-snapshot-repository";
import { C03_MUTATION_SNAPSHOT_MAX_ROWS } from "@/lib/chaos/c03-mutation-snapshot";

const ORDER_ID = "aaaaaaaa-0000-0000-0000-000000000001";

function healthyResponses() {
  return {
    orders: [
      {
        data: [
          {
            id: ORDER_ID,
            payment_status: "UNPAID",
            business_status: "OPEN",
            amount_subunits: 75_000,
            currency: "INR",
          },
        ],
        count: 1,
        error: null,
      },
    ],
    payment_attempts: [{ data: [], count: 0, error: null }],
    payments: [{ data: [], count: 0, error: null }],
    fulfilments: [{ data: [], count: 0, error: null }],
    webhook_events: [{ data: [{ id: "w-1" }], count: 1, error: null }],
  };
}

beforeEach(() => {
  recordedOps.length = 0;
  responsesByTable = healthyResponses();
  logEventMock.mockReset();
});

describe("captureC03MutationSnapshot — read-only structural guarantees", () => {
  it("B1: issues ZERO writes and ZERO rpc calls", async () => {
    await captureC03MutationSnapshot();
    expect(recordedOps.every((op) => op.kind === "select")).toBe(true);
    expect(recordedOps.some((op) => op.table.startsWith("rpc:"))).toBe(false);
  });

  it("B2: reads exactly the five tables INV-005 requires, and nothing else", async () => {
    await captureC03MutationSnapshot();
    expect(new Set(recordedOps.map((op) => op.table))).toEqual(
      new Set([
        "orders",
        "payment_attempts",
        "payments",
        "fulfilments",
        "webhook_events",
      ]),
    );
    // Never touches chaos_runs or event_processing_attempts — C03 creates no
    // processing attempt and this module never writes its own run.
    expect(recordedOps.some((op) => op.table === "chaos_runs")).toBe(false);
    expect(
      recordedOps.some((op) => op.table === "event_processing_attempts"),
    ).toBe(false);
  });

  it("B3: never issues a `select *` and always requests an exact count", async () => {
    await captureC03MutationSnapshot();
    for (const op of recordedOps) {
      expect(op.columns).not.toBeNull();
      expect(op.columns).not.toContain("*");
      expect(op.countOption).toBe("exact");
    }
  });

  it("B4: reads webhook_events for `id` only — no provider payload, event type or signature column", async () => {
    await captureC03MutationSnapshot();
    const webhookRead = recordedOps.find(
      (op) => op.table === "webhook_events",
    )!;
    expect(webhookRead.columns).toBe("id");
  });

  it("B5: every read is deterministically ordered by internal UUID and bounded by the frozen cap", async () => {
    await captureC03MutationSnapshot();
    for (const op of recordedOps) {
      expect(op.orderColumns).toEqual(["id"]);
      expect(op.limits).toEqual([C03_MUTATION_SNAPSHOT_MAX_ROWS]);
    }
  });

  it("B6: applies no caller-controlled filter — the reads are whole-table by construction", async () => {
    await captureC03MutationSnapshot();
    for (const op of recordedOps) {
      expect(op.filters).toEqual([]);
    }
  });
});

describe("captureC03MutationSnapshot — truthful failure handling", () => {
  it("B7: a failed read becomes a null collection, never an empty one", async () => {
    responsesByTable = {
      ...healthyResponses(),
      payments: [{ data: null, count: null, error: { code: "PGRST500" } }],
    };
    const snapshot = await captureC03MutationSnapshot();

    expect(snapshot.payments).toBeNull();
    // The successful reads are unaffected and still make positive claims.
    expect(snapshot.paymentAttempts).toEqual({
      count: 0,
      rows: [],
      complete: true,
    });
  });

  it("B8: a read failure never throws and never leaks a raw database error", async () => {
    responsesByTable = {
      ...healthyResponses(),
      orders: [
        {
          data: null,
          count: null,
          error: {
            message: "RAW-PG-ERROR-MUST-NOT-LEAK",
            details: "column x",
          },
        },
      ],
    };
    const snapshot = await captureC03MutationSnapshot();
    expect(snapshot.orders).toBeNull();

    const loggedJson = JSON.stringify(logEventMock.mock.calls);
    expect(loggedJson).not.toContain("RAW-PG-ERROR-MUST-NOT-LEAK");
    expect(loggedJson).not.toContain("column x");
    expect(JSON.stringify(snapshot)).not.toContain(
      "RAW-PG-ERROR-MUST-NOT-LEAK",
    );
  });

  it("B9: complete is derived from the database's own exact count, not from the row length", async () => {
    responsesByTable = {
      ...healthyResponses(),
      orders: [
        {
          data: [
            {
              id: ORDER_ID,
              payment_status: "UNPAID",
              business_status: "OPEN",
              amount_subunits: 75_000,
              currency: "INR",
            },
          ],
          // The table genuinely holds more rows than were returned.
          count: 4_242,
          error: null,
        },
      ],
    };
    const snapshot = await captureC03MutationSnapshot();
    expect(snapshot.orders!.complete).toBe(false);
    expect(snapshot.orders!.count).toBe(4_242);
  });

  it("B10: projects the trusted webhook row set as sorted ids plus an exact count", async () => {
    responsesByTable = {
      ...healthyResponses(),
      webhook_events: [
        { data: [{ id: "w-3" }, { id: "w-1" }], count: 2, error: null },
      ],
    };
    const snapshot = await captureC03MutationSnapshot();
    expect(snapshot.trustedWebhookEvents).toEqual({
      count: 2,
      ids: ["w-1", "w-3"],
      complete: true,
    });
  });
});
