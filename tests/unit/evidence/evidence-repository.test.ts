import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Phase 3E-A: `lib/evidence/evidence-repository.ts` behavior against a
 * MOCKED Supabase client (no network). Real-Supabase behavior of the
 * `state_before`/`state_after` columns, their object CHECK constraints and
 * the set-once conditional UPDATE is separately proven by
 * tests/integration/supabase/060-phase3e-evidence-snapshot.integration.test.ts,
 * which remains NOT RUN until the Phase 3E-A migration is manually applied.
 *
 * The mock records EVERY query this module issues — table, operation kind,
 * selected columns, update payload and filters — so the tests can prove not
 * only what the module returns but that it never mutates a merchant table
 * and never issues a `select *`.
 */
vi.mock("server-only", () => ({}));

interface MockResult {
  data: unknown;
  error: unknown;
}

interface RecordedOp {
  table: string;
  kind: "select" | "update" | "insert" | "delete" | "upsert";
  columns: string | null;
  updatePayload: Record<string, unknown> | null;
  filters: string[];
  /** Every `.eq(column, value)` argument pair, so a test can assert the VALUE a predicate was scoped to, not just the column. */
  eqArgs: [string, unknown][];
}

const recordedOps: RecordedOp[] = [];
let responsesByTable: Record<string, MockResult[]> = {};

function nextResult(table: string): MockResult {
  const queue = responsesByTable[table];
  if (queue && queue.length > 0) {
    return queue.shift()!;
  }
  return { data: null, error: null };
}

function makeClient() {
  return {
    from(table: string) {
      const op: RecordedOp = {
        table,
        kind: "select",
        columns: null,
        updatePayload: null,
        filters: [],
        eqArgs: [],
      };
      recordedOps.push(op);

      const resolve = async (): Promise<MockResult> => nextResult(table);

      const builder: Record<string, unknown> = {
        select: (columns?: string) => {
          op.columns = columns ?? "*";
          return builder;
        },
        update: (payload: Record<string, unknown>) => {
          op.kind = "update";
          op.updatePayload = payload;
          return builder;
        },
        insert: (payload: Record<string, unknown>) => {
          op.kind = "insert";
          op.updatePayload = payload;
          return builder;
        },
        delete: () => {
          op.kind = "delete";
          return builder;
        },
        upsert: (payload: Record<string, unknown>) => {
          op.kind = "upsert";
          op.updatePayload = payload;
          return builder;
        },
        eq: (column: string, value: unknown) => {
          op.filters.push(`eq:${column}`);
          op.eqArgs.push([column, value]);
          return builder;
        },
        is: (column: string, value: unknown) => {
          op.filters.push(`is:${column}=${String(value)}`);
          return builder;
        },
        in: (column: string) => {
          op.filters.push(`in:${column}`);
          return builder;
        },
        order: () => builder,
        limit: () => builder,
        maybeSingle: resolve,
        single: resolve,
        then: (
          onfulfilled: (value: MockResult) => unknown,
          onrejected?: unknown,
        ) =>
          resolve().then(
            onfulfilled,
            onrejected as (reason: unknown) => unknown,
          ),
      };
      return builder;
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: () => makeClient(),
}));

import {
  EvidenceRepositoryError,
  captureMerchantStateSnapshotForProcessingAttempt,
  getProcessingSnapshotEligibility,
  persistProcessingStateAfter,
  persistProcessingStateBefore,
} from "@/lib/evidence/evidence-repository";
import {
  buildMerchantStateSnapshot,
  serializeMerchantStateSnapshot,
  type MerchantStateSnapshotSourceFulfilmentRow,
  type MerchantStateSnapshotSourceOrderRow,
  type MerchantStateSnapshotSourcePaymentAttemptRow,
  type MerchantStateSnapshotSourcePaymentRow,
} from "@/lib/evidence/merchant-state-snapshot";

const PROC_ATTEMPT_ID = "44444444-4444-4444-4444-444444444444";
const ORDER_ID = "11111111-1111-1111-1111-111111111111";
const ATTEMPT_ID = "22222222-2222-2222-2222-222222222222";
const PAYMENT_ID = "33333333-3333-3333-3333-333333333333";

const MERCHANT_TABLES = [
  "orders",
  "payment_attempts",
  "payments",
  "fulfilments",
  "webhook_events",
  "chaos_runs",
] as const;

beforeEach(() => {
  recordedOps.length = 0;
  responsesByTable = {};
});

function setResponses(responses: Record<string, MockResult[]>): void {
  responsesByTable = responses;
}

function attemptRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PROC_ATTEMPT_ID,
    payment_attempt_id: ATTEMPT_ID,
    payment_id: PAYMENT_ID,
    ...overrides,
  };
}

function paymentAttemptRow(
  overrides: Partial<MerchantStateSnapshotSourcePaymentAttemptRow> = {},
): MerchantStateSnapshotSourcePaymentAttemptRow {
  return {
    id: ATTEMPT_ID,
    order_id: ORDER_ID,
    status: "CAPTURED",
    amount_subunits: 49900,
    currency: "INR",
    razorpay_order_id: "order_TESTMODE123",
    razorpay_order_status: "paid",
    ...overrides,
  };
}

function orderRow(
  overrides: Partial<MerchantStateSnapshotSourceOrderRow> = {},
): MerchantStateSnapshotSourceOrderRow {
  return {
    id: ORDER_ID,
    payment_status: "PAID",
    business_status: "FULFILLED",
    amount_subunits: 49900,
    currency: "INR",
    ...overrides,
  };
}

function paymentRow(
  overrides: Partial<MerchantStateSnapshotSourcePaymentRow> = {},
): MerchantStateSnapshotSourcePaymentRow {
  return {
    id: PAYMENT_ID,
    payment_attempt_id: ATTEMPT_ID,
    razorpay_payment_id: "pay_TESTMODE123",
    razorpay_payment_status: "captured",
    amount_subunits: 49900,
    currency: "INR",
    checkout_signature_verified: true,
    captured_at: "2026-01-01T10:00:00.000Z",
    failed_at: null,
    ...overrides,
  };
}

function fulfilmentRows(): MerchantStateSnapshotSourceFulfilmentRow[] {
  return [
    {
      id: "aaaaaaaa-0000-0000-0000-000000000001",
      order_id: ORDER_ID,
      payment_id: PAYMENT_ID,
      trigger_processing_attempt_id: PROC_ATTEMPT_ID,
      effect_type: "FULFIL_ORDER",
      applied_at: "2026-01-01T10:00:01.000Z",
    },
  ];
}

function fullyCorrelatedResponses() {
  return {
    event_processing_attempts: [{ data: attemptRow(), error: null }],
    payment_attempts: [{ data: paymentAttemptRow(), error: null }],
    orders: [{ data: orderRow(), error: null }],
    payments: [{ data: paymentRow(), error: null }],
    fulfilments: [{ data: fulfilmentRows(), error: null }],
  };
}

const SAMPLE_SNAPSHOT = buildMerchantStateSnapshot({
  order: orderRow(),
  paymentAttempt: paymentAttemptRow(),
  payment: paymentRow(),
  fulfilments: fulfilmentRows(),
});
const SAMPLE_SNAPSHOT_JSON = serializeMerchantStateSnapshot(SAMPLE_SNAPSHOT);

describe("captureMerchantStateSnapshotForProcessingAttempt", () => {
  it("1: resolves order -> payment attempt -> payment -> fulfilments from the trusted attempt row alone", async () => {
    setResponses(fullyCorrelatedResponses());

    const snapshot =
      await captureMerchantStateSnapshotForProcessingAttempt(PROC_ATTEMPT_ID);

    expect(snapshot.version).toBe(1);
    expect(snapshot.order?.id).toBe(ORDER_ID);
    expect(snapshot.paymentAttempt?.id).toBe(ATTEMPT_ID);
    expect(snapshot.payment?.id).toBe(PAYMENT_ID);
    expect(snapshot.fulfilments).toHaveLength(1);
  });

  it("2: every read is an explicit column allowlist — never `select *`", async () => {
    setResponses(fullyCorrelatedResponses());
    await captureMerchantStateSnapshotForProcessingAttempt(PROC_ATTEMPT_ID);

    expect(recordedOps.length).toBeGreaterThan(0);
    for (const op of recordedOps) {
      expect(op.columns).not.toBeNull();
      expect(op.columns).not.toBe("*");
      expect(op.columns).not.toContain("*");
    }
  });

  it("3: the ONLY input is the processing-attempt id — the attempt is looked up by id, and correlation comes from its own columns", async () => {
    setResponses(fullyCorrelatedResponses());
    await captureMerchantStateSnapshotForProcessingAttempt(PROC_ATTEMPT_ID);

    const attemptOp = recordedOps.find(
      (op) => op.table === "event_processing_attempts",
    );
    expect(attemptOp?.filters).toEqual(["eq:id"]);
    expect(
      recordedOps.find((op) => op.table === "payment_attempts")?.filters,
    ).toEqual(["eq:id"]);
    expect(recordedOps.find((op) => op.table === "orders")?.filters).toEqual([
      "eq:id",
    ]);
    expect(
      recordedOps.find((op) => op.table === "fulfilments")?.filters,
    ).toEqual(["eq:order_id"]);
  });

  it("4: performs NO write of any kind — capture is read-only", async () => {
    setResponses(fullyCorrelatedResponses());
    await captureMerchantStateSnapshotForProcessingAttempt(PROC_ATTEMPT_ID);

    for (const op of recordedOps) {
      expect(op.kind).toBe("select");
    }
  });

  it("5: a processing attempt with no correlations yields null entities and null fulfilments, never invented ones", async () => {
    setResponses({
      event_processing_attempts: [
        {
          data: attemptRow({ payment_attempt_id: null, payment_id: null }),
          error: null,
        },
      ],
    });

    const snapshot =
      await captureMerchantStateSnapshotForProcessingAttempt(PROC_ATTEMPT_ID);

    expect(snapshot).toEqual({
      version: 1,
      order: null,
      paymentAttempt: null,
      payment: null,
      fulfilments: null,
    });
    expect(recordedOps.map((op) => op.table)).toEqual([
      "event_processing_attempts",
    ]);
  });

  it("6: a correlated payment that does not exist yet stays null (the BEFORE-capture case), while the order still resolves", async () => {
    setResponses({
      event_processing_attempts: [
        { data: attemptRow({ payment_id: null }), error: null },
      ],
      payment_attempts: [
        { data: paymentAttemptRow({ status: "CREATED" }), error: null },
      ],
      orders: [{ data: orderRow({ payment_status: "UNPAID" }), error: null }],
      fulfilments: [{ data: [], error: null }],
    });

    const snapshot =
      await captureMerchantStateSnapshotForProcessingAttempt(PROC_ATTEMPT_ID);

    expect(snapshot.payment).toBeNull();
    expect(snapshot.order?.paymentStatus).toBe("UNPAID");
    expect(snapshot.fulfilments).toEqual([]);
  });

  it("7: a resolved order with zero fulfilments yields [] (a genuine zero), not null", async () => {
    setResponses({
      ...fullyCorrelatedResponses(),
      fulfilments: [{ data: [], error: null }],
    });

    const snapshot =
      await captureMerchantStateSnapshotForProcessingAttempt(PROC_ATTEMPT_ID);
    expect(snapshot.fulfilments).toEqual([]);
  });

  it("8: an unknown processing attempt is a safe failure — EVIDENCE_PROCESSING_ATTEMPT_NOT_FOUND, never a fabricated empty snapshot", async () => {
    setResponses({
      event_processing_attempts: [{ data: null, error: null }],
    });

    await expect(
      captureMerchantStateSnapshotForProcessingAttempt(PROC_ATTEMPT_ID),
    ).rejects.toMatchObject({
      name: "EvidenceRepositoryError",
      code: "EVIDENCE_PROCESSING_ATTEMPT_NOT_FOUND",
    });
  });

  it("9: a database read failure is NEVER converted into a null entity — it raises a safe, redacted repository error", async () => {
    setResponses({
      event_processing_attempts: [{ data: attemptRow(), error: null }],
      payment_attempts: [
        {
          data: null,
          error: {
            code: "42P01",
            message:
              'relation "payment_attempts" does not exist at postgres://user:hunter2@db.internal',
          },
        },
      ],
    });

    try {
      await captureMerchantStateSnapshotForProcessingAttempt(PROC_ATTEMPT_ID);
      throw new Error("expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(EvidenceRepositoryError);
      const repoErr = err as EvidenceRepositoryError;
      expect(repoErr.code).toBe("EVIDENCE_PAYMENT_ATTEMPT_LOOKUP_FAILED");
      expect(repoErr.message).not.toContain("hunter2");
      expect(repoErr.message).not.toContain("postgres://");
      expect(repoErr.message).not.toContain("42P01");
    }
  });

  it("10: every correlated-read failure has its own safe code, and none leaks raw database text", async () => {
    const cases: {
      responses: Record<string, MockResult[]>;
      code: string;
    }[] = [
      {
        responses: {
          event_processing_attempts: [
            { data: null, error: { code: "08006", message: "raw detail" } },
          ],
        },
        code: "EVIDENCE_PROCESSING_ATTEMPT_LOOKUP_FAILED",
      },
      {
        responses: {
          event_processing_attempts: [{ data: attemptRow(), error: null }],
          payment_attempts: [{ data: paymentAttemptRow(), error: null }],
          orders: [
            { data: null, error: { code: "08006", message: "raw detail" } },
          ],
        },
        code: "EVIDENCE_ORDER_LOOKUP_FAILED",
      },
      {
        responses: {
          event_processing_attempts: [{ data: attemptRow(), error: null }],
          payment_attempts: [{ data: paymentAttemptRow(), error: null }],
          orders: [{ data: orderRow(), error: null }],
          payments: [
            { data: null, error: { code: "08006", message: "raw detail" } },
          ],
        },
        code: "EVIDENCE_PAYMENT_LOOKUP_FAILED",
      },
      {
        responses: {
          event_processing_attempts: [{ data: attemptRow(), error: null }],
          payment_attempts: [{ data: paymentAttemptRow(), error: null }],
          orders: [{ data: orderRow(), error: null }],
          payments: [{ data: paymentRow(), error: null }],
          fulfilments: [
            { data: null, error: { code: "08006", message: "raw detail" } },
          ],
        },
        code: "EVIDENCE_FULFILMENT_LOOKUP_FAILED",
      },
    ];

    for (const testCase of cases) {
      recordedOps.length = 0;
      setResponses(testCase.responses);
      try {
        await captureMerchantStateSnapshotForProcessingAttempt(PROC_ATTEMPT_ID);
        throw new Error(`expected ${testCase.code} to throw`);
      } catch (err) {
        expect(err).toBeInstanceOf(EvidenceRepositoryError);
        expect((err as EvidenceRepositoryError).code).toBe(testCase.code);
        expect((err as Error).message).not.toContain("raw detail");
      }
    }
  });
});

describe("persistProcessingStateBefore — set-once", () => {
  it("11: the first write succeeds and is reported as CAPTURED, verified from the returned row", async () => {
    setResponses({
      event_processing_attempts: [
        {
          data: { id: PROC_ATTEMPT_ID, state_before: SAMPLE_SNAPSHOT_JSON },
          error: null,
        },
      ],
    });

    const result = await persistProcessingStateBefore(
      PROC_ATTEMPT_ID,
      SAMPLE_SNAPSHOT,
    );

    expect(result.outcome).toBe("CAPTURED");
    expect(result.snapshot).toEqual(SAMPLE_SNAPSHOT_JSON);
  });

  it("12: the write is a single atomic conditional UPDATE scoped by id AND `status = PENDING` AND `state_before IS NULL` — the lifecycle guard and the set-once guard are BOTH in the one statement, so a stale caller whose row went terminal loses the race instead of writing a late 'before'", async () => {
    setResponses({
      event_processing_attempts: [
        {
          data: { id: PROC_ATTEMPT_ID, state_before: SAMPLE_SNAPSHOT_JSON },
          error: null,
        },
      ],
    });

    await persistProcessingStateBefore(PROC_ATTEMPT_ID, SAMPLE_SNAPSHOT);

    const updates = recordedOps.filter((op) => op.kind === "update");
    expect(updates).toHaveLength(1);
    expect(updates[0]!.table).toBe("event_processing_attempts");
    expect(updates[0]!.filters).toEqual([
      "eq:id",
      "eq:status",
      "is:state_before=null",
    ]);
  });

  it("13: the UPDATE payload touches ONLY state_before — no status, no finished_at, no error columns", async () => {
    setResponses({
      event_processing_attempts: [
        {
          data: { id: PROC_ATTEMPT_ID, state_before: SAMPLE_SNAPSHOT_JSON },
          error: null,
        },
      ],
    });

    await persistProcessingStateBefore(PROC_ATTEMPT_ID, SAMPLE_SNAPSHOT);

    const update = recordedOps.find((op) => op.kind === "update")!;
    expect(Object.keys(update.updatePayload!)).toEqual(["state_before"]);
    expect(update.updatePayload!.state_before).toEqual(SAMPLE_SNAPSHOT_JSON);
  });

  it("14: a SECOND write does not overwrite — it reports ALREADY_CAPTURED and returns the PRE-EXISTING historical snapshot", async () => {
    const historical = { version: 1, order: null, note: "historical" };
    setResponses({
      event_processing_attempts: [
        // The conditional UPDATE matches zero rows (state_before is not NULL).
        { data: null, error: null },
        // The follow-up read finds the pre-existing snapshot.
        {
          data: {
            id: PROC_ATTEMPT_ID,
            status: "SUCCEEDED",
            state_before: historical,
          },
          error: null,
        },
      ],
    });

    const result = await persistProcessingStateBefore(
      PROC_ATTEMPT_ID,
      SAMPLE_SNAPSHOT,
    );

    expect(result.outcome).toBe("ALREADY_CAPTURED");
    expect(result.snapshot).toEqual(historical);
    // The new snapshot was NOT returned as if it had been written.
    expect(result.snapshot).not.toEqual(SAMPLE_SNAPSHOT_JSON);
  });

  it("15: a write against a non-existent attempt reports ATTEMPT_NOT_FOUND and claims no snapshot", async () => {
    setResponses({
      event_processing_attempts: [
        { data: null, error: null },
        { data: null, error: null },
      ],
    });

    const result = await persistProcessingStateBefore(
      PROC_ATTEMPT_ID,
      SAMPLE_SNAPSHOT,
    );

    expect(result).toEqual({ outcome: "ATTEMPT_NOT_FOUND", snapshot: null });
  });

  it("16: a database write failure raises a safe, redacted error — never a false CAPTURED", async () => {
    setResponses({
      event_processing_attempts: [
        {
          data: null,
          error: {
            code: "23514",
            message:
              "new row violates check constraint at postgres://user:hunter2@db.internal",
          },
        },
      ],
    });

    try {
      await persistProcessingStateBefore(PROC_ATTEMPT_ID, SAMPLE_SNAPSHOT);
      throw new Error("expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(EvidenceRepositoryError);
      expect((err as EvidenceRepositoryError).code).toBe(
        "EVIDENCE_STATE_BEFORE_WRITE_FAILED",
      );
      expect((err as Error).message).not.toContain("hunter2");
      expect((err as Error).message).not.toContain("check constraint");
    }
  });

  it("17: a database read-back failure raises its own distinct safe error", async () => {
    setResponses({
      event_processing_attempts: [
        { data: null, error: null },
        {
          data: null,
          error: { code: "08006", message: "raw readback detail" },
        },
      ],
    });

    try {
      await persistProcessingStateBefore(PROC_ATTEMPT_ID, SAMPLE_SNAPSHOT);
      throw new Error("expected to throw");
    } catch (err) {
      expect((err as EvidenceRepositoryError).code).toBe(
        "EVIDENCE_STATE_BEFORE_READBACK_FAILED",
      );
      expect((err as Error).message).not.toContain("raw readback detail");
    }
  });

  it("18: a returned row whose state_before is NOT a JSON object is never reported as CAPTURED (verified persisted state is authoritative)", async () => {
    for (const badValue of [null, 42, "a string", [1, 2, 3]]) {
      recordedOps.length = 0;
      setResponses({
        event_processing_attempts: [
          {
            data: { id: PROC_ATTEMPT_ID, state_before: badValue },
            error: null,
          },
        ],
      });
      await expect(
        persistProcessingStateBefore(PROC_ATTEMPT_ID, SAMPLE_SNAPSHOT),
      ).rejects.toMatchObject({
        name: "EvidenceRepositoryError",
        code: "EVIDENCE_STATE_BEFORE_NOT_VERIFIED",
      });
    }
  });
});

describe("persistProcessingStateAfter — set-once", () => {
  it("19: the first write succeeds and is reported as CAPTURED", async () => {
    setResponses({
      event_processing_attempts: [
        {
          data: { id: PROC_ATTEMPT_ID, state_after: SAMPLE_SNAPSHOT_JSON },
          error: null,
        },
      ],
    });

    const result = await persistProcessingStateAfter(
      PROC_ATTEMPT_ID,
      SAMPLE_SNAPSHOT,
    );
    expect(result.outcome).toBe("CAPTURED");
    expect(result.snapshot).toEqual(SAMPLE_SNAPSHOT_JSON);
  });

  it("20: the write is a single atomic conditional UPDATE scoped by id AND `state_after IS NULL`, touching only that column", async () => {
    setResponses({
      event_processing_attempts: [
        {
          data: { id: PROC_ATTEMPT_ID, state_after: SAMPLE_SNAPSHOT_JSON },
          error: null,
        },
      ],
    });

    await persistProcessingStateAfter(PROC_ATTEMPT_ID, SAMPLE_SNAPSHOT);

    const updates = recordedOps.filter((op) => op.kind === "update");
    expect(updates).toHaveLength(1);
    expect(updates[0]!.table).toBe("event_processing_attempts");
    expect(updates[0]!.filters).toEqual(["eq:id", "is:state_after=null"]);
    expect(Object.keys(updates[0]!.updatePayload!)).toEqual(["state_after"]);
  });

  it("21: a SECOND write does not overwrite — ALREADY_CAPTURED, pre-existing snapshot preserved", async () => {
    const historical = { version: 1, order: null, note: "historical-after" };
    setResponses({
      event_processing_attempts: [
        { data: null, error: null },
        { data: { id: PROC_ATTEMPT_ID, state_after: historical }, error: null },
      ],
    });

    const result = await persistProcessingStateAfter(
      PROC_ATTEMPT_ID,
      SAMPLE_SNAPSHOT,
    );
    expect(result.outcome).toBe("ALREADY_CAPTURED");
    expect(result.snapshot).toEqual(historical);
  });

  it("22: a non-existent attempt reports ATTEMPT_NOT_FOUND", async () => {
    setResponses({
      event_processing_attempts: [
        { data: null, error: null },
        { data: null, error: null },
      ],
    });
    const result = await persistProcessingStateAfter(
      PROC_ATTEMPT_ID,
      SAMPLE_SNAPSHOT,
    );
    expect(result).toEqual({ outcome: "ATTEMPT_NOT_FOUND", snapshot: null });
  });

  it("23: a database write failure raises its own safe, redacted error", async () => {
    setResponses({
      event_processing_attempts: [
        { data: null, error: { code: "23514", message: "raw after detail" } },
      ],
    });
    try {
      await persistProcessingStateAfter(PROC_ATTEMPT_ID, SAMPLE_SNAPSHOT);
      throw new Error("expected to throw");
    } catch (err) {
      expect((err as EvidenceRepositoryError).code).toBe(
        "EVIDENCE_STATE_AFTER_WRITE_FAILED",
      );
      expect((err as Error).message).not.toContain("raw after detail");
    }
  });

  it("24: an unverifiable returned row is never reported as CAPTURED", async () => {
    setResponses({
      event_processing_attempts: [
        { data: { id: PROC_ATTEMPT_ID, state_after: null }, error: null },
      ],
    });
    await expect(
      persistProcessingStateAfter(PROC_ATTEMPT_ID, SAMPLE_SNAPSHOT),
    ).rejects.toMatchObject({
      code: "EVIDENCE_STATE_AFTER_NOT_VERIFIED",
    });
  });
});

describe("no merchant-table mutation from the snapshot repository", () => {
  it("25: across capture + both persist paths, every write targets event_processing_attempts and nothing else", async () => {
    setResponses(fullyCorrelatedResponses());
    await captureMerchantStateSnapshotForProcessingAttempt(PROC_ATTEMPT_ID);

    setResponses({
      event_processing_attempts: [
        {
          data: { id: PROC_ATTEMPT_ID, state_before: SAMPLE_SNAPSHOT_JSON },
          error: null,
        },
        {
          data: { id: PROC_ATTEMPT_ID, state_after: SAMPLE_SNAPSHOT_JSON },
          error: null,
        },
      ],
    });
    await persistProcessingStateBefore(PROC_ATTEMPT_ID, SAMPLE_SNAPSHOT);
    await persistProcessingStateAfter(PROC_ATTEMPT_ID, SAMPLE_SNAPSHOT);

    const writes = recordedOps.filter((op) => op.kind !== "select");
    expect(writes.length).toBe(2);
    for (const write of writes) {
      expect(write.table).toBe("event_processing_attempts");
      expect(write.kind).toBe("update");
    }
    for (const table of MERCHANT_TABLES) {
      expect(
        recordedOps.filter((op) => op.table === table && op.kind !== "select"),
      ).toEqual([]);
    }
  });

  it("26: no INSERT, DELETE or UPSERT is ever issued by this module", async () => {
    setResponses(fullyCorrelatedResponses());
    await captureMerchantStateSnapshotForProcessingAttempt(PROC_ATTEMPT_ID);
    setResponses({
      event_processing_attempts: [
        {
          data: { id: PROC_ATTEMPT_ID, state_before: SAMPLE_SNAPSHOT_JSON },
          error: null,
        },
      ],
    });
    await persistProcessingStateBefore(PROC_ATTEMPT_ID, SAMPLE_SNAPSHOT);

    for (const op of recordedOps) {
      expect(["insert", "delete", "upsert"]).not.toContain(op.kind);
    }
  });
});

/**
 * ============================================================================
 * Phase 3E-A architect correction — NO HISTORICAL BACKFILL
 * ============================================================================
 *
 * Set-once prevents an OVERWRITE. It does NOT prevent a LATE FIRST WRITE into
 * a column that is still NULL — and every pre-Phase-3E row is NULL by design.
 * These tests pin the processing-lifecycle guard that closes that hole.
 */
describe("processing-lifecycle eligibility", () => {
  it("27: a PENDING attempt is ELIGIBLE_PENDING", async () => {
    setResponses({
      event_processing_attempts: [
        { data: { id: PROC_ATTEMPT_ID, status: "PENDING" }, error: null },
      ],
    });
    await expect(
      getProcessingSnapshotEligibility(PROC_ATTEMPT_ID),
    ).resolves.toEqual({ kind: "ELIGIBLE_PENDING", status: "PENDING" });
  });

  it("28: EVERY other status literal of event_processing_attempts_status_valid is NOT_ELIGIBLE_TERMINAL — including PROCESSING, which the frozen RPC admits but which represents a re-entry, not a fresh execution", async () => {
    for (const status of [
      "HELD",
      "PROCESSING",
      "SUCCEEDED",
      "FAILED",
      "SKIPPED_DUPLICATE",
    ]) {
      recordedOps.length = 0;
      setResponses({
        event_processing_attempts: [
          { data: { id: PROC_ATTEMPT_ID, status }, error: null },
        ],
      });
      await expect(
        getProcessingSnapshotEligibility(PROC_ATTEMPT_ID),
      ).resolves.toEqual({ kind: "NOT_ELIGIBLE_TERMINAL", status });
    }
  });

  it("29: an absent attempt is ATTEMPT_NOT_FOUND, and a database failure is READ_FAILED — never a thrown raw Supabase error, never a fabricated eligibility", async () => {
    setResponses({
      event_processing_attempts: [{ data: null, error: null }],
    });
    await expect(
      getProcessingSnapshotEligibility(PROC_ATTEMPT_ID),
    ).resolves.toEqual({ kind: "ATTEMPT_NOT_FOUND" });

    recordedOps.length = 0;
    setResponses({
      event_processing_attempts: [
        {
          data: null,
          error: { code: "08006", message: "raw connection detail hunter2" },
        },
      ],
    });
    await expect(
      getProcessingSnapshotEligibility(PROC_ATTEMPT_ID),
    ).resolves.toEqual({ kind: "READ_FAILED" });
  });

  it("30: the eligibility read is read-only and scoped to the one attempt id", async () => {
    setResponses({
      event_processing_attempts: [
        { data: { id: PROC_ATTEMPT_ID, status: "PENDING" }, error: null },
      ],
    });
    await getProcessingSnapshotEligibility(PROC_ATTEMPT_ID);

    expect(recordedOps).toHaveLength(1);
    expect(recordedOps[0]!.table).toBe("event_processing_attempts");
    expect(recordedOps[0]!.kind).toBe("select");
    expect(recordedOps[0]!.columns).toBe("id, status");
    expect(recordedOps[0]!.filters).toEqual(["eq:id"]);
  });
});

describe("state_before cannot be backfilled onto a terminal attempt", () => {
  it("31: the guarded UPDATE is scoped to the literal status value 'PENDING' (blocker requirement 9)", async () => {
    setResponses({
      event_processing_attempts: [
        {
          data: {
            id: PROC_ATTEMPT_ID,
            status: "PENDING",
            state_before: SAMPLE_SNAPSHOT_JSON,
          },
          error: null,
        },
      ],
    });
    await persistProcessingStateBefore(PROC_ATTEMPT_ID, SAMPLE_SNAPSHOT);

    const update = recordedOps.find((op) => op.kind === "update")!;
    expect(update.eqArgs).toEqual([
      ["id", PROC_ATTEMPT_ID],
      ["status", "PENDING"],
    ]);
  });

  it.each([
    ["SUCCEEDED"],
    ["FAILED"],
    ["HELD"],
    ["SKIPPED_DUPLICATE"],
    ["PROCESSING"],
  ])(
    "32: a %s attempt whose state_before is still NULL reports NOT_ELIGIBLE and writes nothing — the NULL is valid historical truth, not persistence corruption",
    async (status) => {
      setResponses({
        event_processing_attempts: [
          // The guarded UPDATE matched zero rows: status is not PENDING.
          { data: null, error: null },
          // Read-back: the row exists, is terminal, and is still NULL.
          {
            data: { id: PROC_ATTEMPT_ID, status, state_before: null },
            error: null,
          },
        ],
      });

      const result = await persistProcessingStateBefore(
        PROC_ATTEMPT_ID,
        SAMPLE_SNAPSHOT,
      );

      expect(result).toEqual({ outcome: "NOT_ELIGIBLE", snapshot: null });
      // Critically: NOT an error. A NULL column on a terminal row must not be
      // pushed through verifyPersistedSnapshot as if it were corruption.
    },
  );

  it("33: a race in which the row went terminal between the eligibility read and the guarded UPDATE returns NOT_ELIGIBLE — never CAPTURED, never an overwrite", async () => {
    // Eligibility observed PENDING...
    setResponses({
      event_processing_attempts: [
        { data: { id: PROC_ATTEMPT_ID, status: "PENDING" }, error: null },
      ],
    });
    const eligibility = await getProcessingSnapshotEligibility(PROC_ATTEMPT_ID);
    expect(eligibility.kind).toBe("ELIGIBLE_PENDING");

    // ...but by the time the guarded UPDATE runs another caller has
    // processed the attempt to SUCCEEDED, so it matches zero rows.
    recordedOps.length = 0;
    setResponses({
      event_processing_attempts: [
        { data: null, error: null },
        {
          data: {
            id: PROC_ATTEMPT_ID,
            status: "SUCCEEDED",
            state_before: null,
          },
          error: null,
        },
      ],
    });

    const result = await persistProcessingStateBefore(
      PROC_ATTEMPT_ID,
      SAMPLE_SNAPSHOT,
    );
    expect(result.outcome).toBe("NOT_ELIGIBLE");
    expect(result.outcome).not.toBe("CAPTURED");
    expect(result.snapshot).toBeNull();
  });

  it("34: a terminal attempt that ALREADY has a snapshot still reports ALREADY_CAPTURED and preserves it (set-once is unaffected by the lifecycle guard)", async () => {
    const historical = { version: 1, order: null, note: "captured-in-2026" };
    setResponses({
      event_processing_attempts: [
        { data: null, error: null },
        {
          data: {
            id: PROC_ATTEMPT_ID,
            status: "SUCCEEDED",
            state_before: historical,
          },
          error: null,
        },
      ],
    });

    const result = await persistProcessingStateBefore(
      PROC_ATTEMPT_ID,
      SAMPLE_SNAPSHOT,
    );
    expect(result.outcome).toBe("ALREADY_CAPTURED");
    expect(result.snapshot).toEqual(historical);
  });

  it("35: a still-PENDING, still-NULL row that nonetheless matched zero rows is reported as a persistence inconsistency, never as CAPTURED", async () => {
    setResponses({
      event_processing_attempts: [
        { data: null, error: null },
        {
          data: { id: PROC_ATTEMPT_ID, status: "PENDING", state_before: null },
          error: null,
        },
      ],
    });

    await expect(
      persistProcessingStateBefore(PROC_ATTEMPT_ID, SAMPLE_SNAPSHOT),
    ).rejects.toMatchObject({
      name: "EvidenceRepositoryError",
      code: "EVIDENCE_STATE_BEFORE_UPDATE_INCONSISTENT",
    });
  });

  it("36: no production path in this module can write state_before to a terminal row — every state_before UPDATE carries the PENDING predicate (blocker requirement 10)", async () => {
    // Exercise both persist entry points and confirm the invariant holds
    // across every recorded mutating statement.
    setResponses({
      event_processing_attempts: [
        { data: null, error: null },
        {
          data: {
            id: PROC_ATTEMPT_ID,
            status: "SUCCEEDED",
            state_before: null,
          },
          error: null,
        },
      ],
    });
    await persistProcessingStateBefore(PROC_ATTEMPT_ID, SAMPLE_SNAPSHOT);

    const beforeUpdates = recordedOps.filter(
      (op) =>
        op.kind === "update" &&
        Object.keys(op.updatePayload ?? {}).includes("state_before"),
    );
    expect(beforeUpdates.length).toBeGreaterThan(0);
    for (const update of beforeUpdates) {
      expect(update.eqArgs).toContainEqual(["status", "PENDING"]);
      expect(update.filters).toContain("is:state_before=null");
    }
  });
});
