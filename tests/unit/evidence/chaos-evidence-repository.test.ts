import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Phase 3E-B: `lib/evidence/chaos-evidence-repository.ts` and
 * `lib/evidence/chaos-evidence-service.ts` against a MOCKED Supabase client
 * (no network). Real-Supabase behavior is separately proven by
 * tests/integration/supabase/061-phase3e-chaos-evidence-assembly.integration.test.ts.
 *
 * The mock records EVERY query these modules issue — table, operation kind,
 * selected columns, count options and filters — so the tests can prove not
 * only what the modules return but that they issue ZERO writes, ZERO RPCs,
 * never `select *`, and never touch a current mutable merchant table.
 */
vi.mock("server-only", () => ({}));

interface MockResult {
  data?: unknown;
  count?: number | null;
  error?: unknown;
}

interface RecordedOp {
  table: string;
  kind: "select" | "update" | "insert" | "delete" | "upsert" | "rpc";
  columns: string | null;
  countOption: string | null;
  filters: string[];
  eqArgs: [string, unknown][];
}

const recordedOps: RecordedOp[] = [];
let responsesByTable: Record<string, MockResult[]> = {};

function nextResult(table: string): MockResult {
  const queue = responsesByTable[table];
  if (queue && queue.length > 0) {
    return queue.shift()!;
  }
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
        filters: [],
        eqArgs: [],
      });
      return Promise.resolve({ data: null, error: null });
    },
    from(table: string) {
      const op: RecordedOp = {
        table,
        kind: "select",
        columns: null,
        countOption: null,
        filters: [],
        eqArgs: [],
      };
      recordedOps.push(op);

      const resolve = async (): Promise<MockResult> => nextResult(table);

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
        not: (column: string) => {
          op.filters.push(`not:${column}`);
          return builder;
        },
        filter: (column: string) => {
          op.filters.push(`filter:${column}`);
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
  ChaosEvidenceRepositoryError,
  loadChaosRunEvidenceSource,
} from "@/lib/evidence/chaos-evidence-repository";
import { assembleChaosRunEvidence } from "@/lib/evidence/chaos-evidence-service";

const RUN_ID = "10000000-0000-4000-8000-000000000001";
const ORDER_ID = "20000000-0000-4000-8000-000000000002";
const PAYMENT_ATTEMPT_ID = "30000000-0000-4000-8000-000000000003";
const PAYMENT_ID = "40000000-0000-4000-8000-000000000004";
const WEBHOOK_ID = "50000000-0000-4000-8000-000000000005";
const ORIGINAL_ATTEMPT_ID = "60000000-0000-4000-8000-000000000006";
const REPLAY_ATTEMPT_ID = "70000000-0000-4000-8000-00000000000a";

/**
 * Every table this repository is FORBIDDEN from reading. Reading any of them
 * would make it possible to substitute today's mutable merchant state for a
 * missing historical snapshot — the exact fabrication the Historical Truth
 * Rule forbids.
 */
const FORBIDDEN_TABLES = [
  "orders",
  "payment_attempts",
  "payments",
  "fulfilments",
] as const;

function c01RunRow(overrides: Record<string, unknown> = {}) {
  return {
    id: RUN_ID,
    scenario_id: "C01",
    status: "COMPLETED",
    outcome: "UNKNOWN",
    fault_type: "REPLAY_EVENT",
    data_classification: "RECORDED_TEST_EVIDENCE",
    order_id: ORDER_ID,
    payment_attempt_id: PAYMENT_ATTEMPT_ID,
    payment_id: PAYMENT_ID,
    source_webhook_event_id: WEBHOOK_ID,
    failed_precheck_id: null,
    execution_block_code: null,
    fault_state: {},
    started_at: "2026-08-01T00:00:00.000Z",
    completed_at: "2026-08-01T00:00:05.000Z",
    ...overrides,
  };
}

function webhookRow(overrides: Record<string, unknown> = {}) {
  return {
    id: WEBHOOK_ID,
    razorpay_event_id: "evt_synthetic",
    event_type: "payment.captured",
    source_kind: "REAL_RAZORPAY_WEBHOOK",
    signature_verified: true,
    processing_status: "PROCESSED",
    duplicate_delivery_count: 0,
    received_at: "2026-07-31T23:59:00.000Z",
    payment_attempt_id: PAYMENT_ATTEMPT_ID,
    payment_id: PAYMENT_ID,
    ...overrides,
  };
}

function attemptRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ORIGINAL_ATTEMPT_ID,
    webhook_event_id: WEBHOOK_ID,
    chaos_run_id: null,
    source_kind: "REAL_RAZORPAY_WEBHOOK",
    status: "SUCCEEDED",
    is_duplicate_delivery: false,
    payment_attempt_id: PAYMENT_ATTEMPT_ID,
    payment_id: PAYMENT_ID,
    error_code: null,
    started_at: "2026-08-01T00:00:00.000Z",
    finished_at: "2026-08-01T00:00:00.500Z",
    state_before: null,
    state_after: null,
    ...overrides,
  };
}

/** Queues a complete, well-formed C01 read sequence in the exact order the repository issues it. */
function queueHealthyC01(): void {
  responsesByTable = {
    chaos_runs: [{ data: c01RunRow(), error: null }],
    webhook_events: [
      { data: webhookRow(), error: null },
      { count: 1, error: null },
    ],
    event_processing_attempts: [
      { data: [attemptRow()], error: null },
      {
        data: [
          attemptRow({
            id: REPLAY_ATTEMPT_ID,
            chaos_run_id: RUN_ID,
            source_kind: "PAYCHAOS_REPLAY",
          }),
        ],
        error: null,
      },
    ],
  };
}

beforeEach(() => {
  recordedOps.length = 0;
  responsesByTable = {};
});

describe("loadChaosRunEvidenceSource — read shape", () => {
  it("1: resolves the run, source webhook, canonical count, originals and chaos-linked attempts by exact internal UUID", async () => {
    queueHealthyC01();
    const source = await loadChaosRunEvidenceSource(RUN_ID);

    expect(source).not.toBeNull();
    expect(source!.run.id).toBe(RUN_ID);
    expect(source!.sourceWebhook?.id).toBe(WEBHOOK_ID);
    expect(source!.canonicalSourceEventCount).toBe(1);
    expect(source!.originalProcessingAttempts).toHaveLength(1);
    expect(source!.chaosProcessingAttempts).toHaveLength(1);

    const eqPairs = recordedOps.flatMap((op) => op.eqArgs);
    expect(eqPairs).toContainEqual(["id", RUN_ID]);
    expect(eqPairs).toContainEqual(["id", WEBHOOK_ID]);
    expect(eqPairs).toContainEqual(["razorpay_event_id", "evt_synthetic"]);
    expect(eqPairs).toContainEqual(["webhook_event_id", WEBHOOK_ID]);
    expect(eqPairs).toContainEqual(["chaos_run_id", RUN_ID]);
  });

  it("2: classifies originals by persisted facts — REAL_RAZORPAY_WEBHOOK and chaos_run_id IS NULL", async () => {
    queueHealthyC01();
    await loadChaosRunEvidenceSource(RUN_ID);

    const originalsQuery = recordedOps.find(
      (op) =>
        op.table === "event_processing_attempts" &&
        op.filters.includes("eq:webhook_event_id"),
    );
    expect(originalsQuery).toBeDefined();
    expect(originalsQuery!.eqArgs).toContainEqual([
      "source_kind",
      "REAL_RAZORPAY_WEBHOOK",
    ]);
    expect(originalsQuery!.filters).toContain("is:chaos_run_id=null");
  });

  it("3: reads chaos-linked attempts UNFILTERED by source_kind, so wrong provenance surfaces instead of disappearing", async () => {
    queueHealthyC01();
    await loadChaosRunEvidenceSource(RUN_ID);

    const chaosQuery = recordedOps.find(
      (op) =>
        op.table === "event_processing_attempts" &&
        op.filters.includes("eq:chaos_run_id"),
    );
    expect(chaosQuery).toBeDefined();
    expect(chaosQuery!.eqArgs.map(([column]) => column)).toEqual([
      "chaos_run_id",
    ]);
  });

  it("4: the canonical source event count uses an exact head count on razorpay_event_id", async () => {
    queueHealthyC01();
    await loadChaosRunEvidenceSource(RUN_ID);

    const countQuery = recordedOps.find(
      (op) => op.table === "webhook_events" && op.countOption !== null,
    );
    expect(countQuery).toBeDefined();
    expect(countQuery!.countOption).toBe("exact");
    expect(countQuery!.eqArgs).toContainEqual([
      "razorpay_event_id",
      "evt_synthetic",
    ]);
  });

  it("5: a run with no source webhook link performs no webhook read and no originals read at all", async () => {
    responsesByTable = {
      chaos_runs: [
        { data: c01RunRow({ source_webhook_event_id: null }), error: null },
      ],
      event_processing_attempts: [{ data: [], error: null }],
    };
    const source = await loadChaosRunEvidenceSource(RUN_ID);

    expect(source!.sourceWebhook).toBeNull();
    expect(source!.canonicalSourceEventCount).toBeNull();
    expect(source!.originalProcessingAttempts).toEqual([]);
    expect(recordedOps.some((op) => op.table === "webhook_events")).toBe(false);
    expect(
      recordedOps.filter((op) => op.table === "event_processing_attempts"),
    ).toHaveLength(1);
  });

  it("6: an absent source webhook row stays null and no canonical count is invented", async () => {
    responsesByTable = {
      chaos_runs: [{ data: c01RunRow(), error: null }],
      webhook_events: [{ data: null, error: null }],
      event_processing_attempts: [
        { data: [], error: null },
        { data: [], error: null },
      ],
    };
    const source = await loadChaosRunEvidenceSource(RUN_ID);
    expect(source!.sourceWebhook).toBeNull();
    expect(source!.canonicalSourceEventCount).toBeNull();
    expect(
      recordedOps.filter((op) => op.table === "webhook_events"),
    ).toHaveLength(1);
  });
});

describe("loadChaosRunEvidenceSource — read-only and allowlist guarantees", () => {
  it("7: issues ZERO writes and ZERO RPCs", async () => {
    queueHealthyC01();
    await loadChaosRunEvidenceSource(RUN_ID);
    for (const op of recordedOps) {
      expect(op.kind).toBe("select");
    }
    expect(recordedOps.some((op) => op.table.startsWith("rpc:"))).toBe(false);
  });

  it("8: never issues a `select *`", async () => {
    queueHealthyC01();
    await loadChaosRunEvidenceSource(RUN_ID);
    expect(recordedOps.length).toBeGreaterThan(0);
    for (const op of recordedOps) {
      expect(op.columns).not.toBeNull();
      expect(op.columns).not.toContain("*");
    }
  });

  it("9: never reads a current mutable merchant table — a missing snapshot can never be substituted", async () => {
    queueHealthyC01();
    await loadChaosRunEvidenceSource(RUN_ID);
    const tables = recordedOps.map((op) => op.table);
    for (const forbidden of FORBIDDEN_TABLES) {
      expect(tables).not.toContain(forbidden);
    }
    expect(new Set(tables)).toEqual(
      new Set(["chaos_runs", "webhook_events", "event_processing_attempts"]),
    );
  });

  it("10: never selects a raw payload, hash, signature or normalized-event column", async () => {
    queueHealthyC01();
    await loadChaosRunEvidenceSource(RUN_ID);
    for (const op of recordedOps) {
      for (const forbidden of [
        "raw_payload_redacted",
        "raw_body_sha256",
        "normalized_event",
        "error_message_redacted",
        "fault_config",
      ]) {
        expect(op.columns).not.toContain(forbidden);
      }
    }
  });

  it("11: reads fault_state on chaos_runs only — the one column carrying C03/C07 scenario facts", async () => {
    queueHealthyC01();
    await loadChaosRunEvidenceSource(RUN_ID);
    const withFaultState = recordedOps.filter((op) =>
      (op.columns ?? "").includes("fault_state"),
    );
    expect(withFaultState).toHaveLength(1);
    expect(withFaultState[0]!.table).toBe("chaos_runs");
  });

  it("12: selects the snapshot columns on every processing-attempt read", async () => {
    queueHealthyC01();
    await loadChaosRunEvidenceSource(RUN_ID);
    const attemptReads = recordedOps.filter(
      (op) => op.table === "event_processing_attempts",
    );
    expect(attemptReads.length).toBeGreaterThan(0);
    for (const op of attemptReads) {
      expect(op.columns).toContain("state_before");
      expect(op.columns).toContain("state_after");
      expect(op.columns).toContain("source_kind");
      expect(op.columns).toContain("chaos_run_id");
    }
  });
});

describe("loadChaosRunEvidenceSource — error boundary", () => {
  it("13: a genuinely absent chaos run returns null, not an error", async () => {
    responsesByTable = { chaos_runs: [{ data: null, error: null }] };
    await expect(loadChaosRunEvidenceSource(RUN_ID)).resolves.toBeNull();
    expect(recordedOps).toHaveLength(1);
  });

  it("14: a chaos-run read FAILURE throws a typed safe error and never leaks the raw Supabase error", async () => {
    responsesByTable = {
      chaos_runs: [
        {
          data: null,
          error: {
            code: "42P01",
            message: 'relation "chaos_runs" does not exist',
            details: "internal detail",
          },
        },
      ],
    };
    await expect(loadChaosRunEvidenceSource(RUN_ID)).rejects.toBeInstanceOf(
      ChaosEvidenceRepositoryError,
    );

    responsesByTable = {
      chaos_runs: [
        { data: null, error: { code: "42P01", message: "secret detail" } },
      ],
    };
    try {
      await loadChaosRunEvidenceSource(RUN_ID);
      throw new Error("expected a throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ChaosEvidenceRepositoryError);
      const safe = err as ChaosEvidenceRepositoryError;
      expect(safe.code).toBe("CHAOS_EVIDENCE_RUN_LOOKUP_FAILED");
      expect(safe.message).toBe(
        "Failed to load the chaos run for evidence assembly.",
      );
      expect(safe.message).not.toContain("secret detail");
      expect(safe.message).not.toContain("42P01");
    }
  });

  it("15: each downstream read failure has its own distinct safe code", async () => {
    const cases: [Record<string, MockResult[]>, string][] = [
      [
        {
          chaos_runs: [{ data: c01RunRow(), error: null }],
          webhook_events: [{ data: null, error: { message: "boom" } }],
        },
        "CHAOS_EVIDENCE_WEBHOOK_LOOKUP_FAILED",
      ],
      [
        {
          chaos_runs: [{ data: c01RunRow(), error: null }],
          webhook_events: [
            { data: webhookRow(), error: null },
            { count: null, error: { message: "boom" } },
          ],
        },
        "CHAOS_EVIDENCE_CANONICAL_COUNT_FAILED",
      ],
      [
        {
          chaos_runs: [{ data: c01RunRow(), error: null }],
          webhook_events: [
            { data: webhookRow(), error: null },
            { count: 1, error: null },
          ],
          event_processing_attempts: [
            { data: null, error: { message: "boom" } },
          ],
        },
        "CHAOS_EVIDENCE_ORIGINAL_ATTEMPT_LOOKUP_FAILED",
      ],
      [
        {
          chaos_runs: [{ data: c01RunRow(), error: null }],
          webhook_events: [
            { data: webhookRow(), error: null },
            { count: 1, error: null },
          ],
          event_processing_attempts: [
            { data: [], error: null },
            { data: null, error: { message: "boom" } },
          ],
        },
        "CHAOS_EVIDENCE_CHAOS_ATTEMPT_LOOKUP_FAILED",
      ],
    ];

    for (const [responses, expectedCode] of cases) {
      recordedOps.length = 0;
      responsesByTable = responses;
      try {
        await loadChaosRunEvidenceSource(RUN_ID);
        throw new Error(`expected a throw for ${expectedCode}`);
      } catch (err) {
        expect(err).toBeInstanceOf(ChaosEvidenceRepositoryError);
        expect((err as ChaosEvidenceRepositoryError).code).toBe(expectedCode);
        expect((err as ChaosEvidenceRepositoryError).message).not.toContain(
          "boom",
        );
      }
    }
  });
});

describe("assembleChaosRunEvidence — the public entry point", () => {
  it("16: returns a deterministic versioned bundle for an existing run", async () => {
    queueHealthyC01();
    const bundle = await assembleChaosRunEvidence(RUN_ID);

    expect(bundle).not.toBeNull();
    expect(bundle!.version).toBe(1);
    expect(bundle!.run.id).toBe(RUN_ID);
    expect(bundle!.scenarioEvidence).toMatchObject({ scenarioId: "C01" });
    expect(bundle!.requiredInvariantIds).toEqual([
      "INV-001",
      "INV-002",
      "INV-006",
      "INV-007",
    ]);
    // A single replay where two are frozen, plus the deliberately NULL
    // historical snapshots on both attempts, are reported as FACTS.
    expect(bundle!.gaps.map((gap) => gap.code)).toContain(
      "UNEXPECTED_CHAOS_PROCESSING_ATTEMPT_COUNT",
    );
    expect(bundle!.gaps.map((gap) => gap.code)).toContain(
      "MISSING_STATE_BEFORE",
    );
  });

  it("17: two assemblies of unchanged data produce a deep-equal bundle", async () => {
    queueHealthyC01();
    const first = await assembleChaosRunEvidence(RUN_ID);
    queueHealthyC01();
    const second = await assembleChaosRunEvidence(RUN_ID);
    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("18: an unknown chaos run id returns null and performs no further reads", async () => {
    responsesByTable = { chaos_runs: [{ data: null, error: null }] };
    await expect(assembleChaosRunEvidence(RUN_ID)).resolves.toBeNull();
    expect(recordedOps).toHaveLength(1);
  });

  it("19: assembling performs zero writes and no verdict is ever produced", async () => {
    queueHealthyC01();
    const bundle = await assembleChaosRunEvidence(RUN_ID);
    for (const op of recordedOps) {
      expect(op.kind).toBe("select");
    }
    const serialized = JSON.stringify(bundle);
    expect(serialized).not.toContain("invariant_results");
    expect(serialized).not.toContain("verdict");
    expect(serialized).not.toContain("NOT_APPLICABLE");
  });
});
