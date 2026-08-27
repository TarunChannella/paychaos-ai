import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import type {
  CreateBlockedChaosRunInput,
  CreatePendingChaosRunInput,
} from "@/lib/chaos/run-repository";

// Phase 3B: `lib/chaos/run-repository.ts` behavior against a MOCKED
// Supabase client (no network). Real-Supabase behavior is separately
// proven by tests/integration/supabase/052-chaos-run-persistence.integration.test.ts
// (NOT runnable yet — the chaos_runs migration has not been applied).
vi.mock("server-only", () => ({}));

interface MockResult {
  data: unknown;
  error: unknown;
}

type InsertFn = (payload: Record<string, unknown>) => FakeQueryBuilder;
type UpdateFn = (payload: Record<string, unknown>) => FakeQueryBuilder;
type SelectFn = (columns?: string) => FakeQueryBuilder;
type EqFn = (column: string, value: unknown) => FakeQueryBuilder;
type IsFn = (column: string, value: unknown) => FakeQueryBuilder;
type NotFn = (
  column: string,
  operator: string,
  value: unknown,
) => FakeQueryBuilder;
type ContainsFn = (
  column: string,
  value: Record<string, unknown>,
) => FakeQueryBuilder;
type FilterFn = (
  column: string,
  operator: string,
  value: unknown,
) => FakeQueryBuilder;
type SingleFn = () => Promise<MockResult>;
type MaybeSingleFn = () => Promise<MockResult>;

interface FakeQueryBuilder extends PromiseLike<MockResult> {
  insert: Mock<InsertFn>;
  update: Mock<UpdateFn>;
  select: Mock<SelectFn>;
  eq: Mock<EqFn>;
  is: Mock<IsFn>;
  not: Mock<NotFn>;
  contains: Mock<ContainsFn>;
  filter: Mock<FilterFn>;
  single: Mock<SingleFn>;
  maybeSingle: Mock<MaybeSingleFn>;
}

function makeQueryBuilder(result: MockResult): FakeQueryBuilder {
  const builder: FakeQueryBuilder = {
    insert: vi.fn<InsertFn>(() => builder),
    update: vi.fn<UpdateFn>(() => builder),
    select: vi.fn<SelectFn>(() => builder),
    eq: vi.fn<EqFn>(() => builder),
    is: vi.fn<IsFn>(() => builder),
    not: vi.fn<NotFn>(() => builder),
    contains: vi.fn<ContainsFn>(() => builder),
    filter: vi.fn<FilterFn>(() => builder),
    single: vi.fn<SingleFn>(async () => result),
    maybeSingle: vi.fn<MaybeSingleFn>(async () => result),
    then: (onfulfilled, onrejected) =>
      Promise.resolve(result).then(onfulfilled, onrejected),
  };
  return builder;
}

const fromMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: () => ({ from: fromMock }),
}));

beforeEach(() => {
  fromMock.mockReset();
});

const ORDER_ID = "22222222-2222-2222-2222-222222222222";
const ATTEMPT_ID = "33333333-3333-3333-3333-333333333333";
const PAYMENT_ID = "44444444-4444-4444-4444-444444444444";
const WEBHOOK_EVENT_ID = "11111111-1111-1111-1111-111111111111";
const RUN_ID = "55555555-5555-5555-5555-555555555555";

function fakeChaosRunRow(overrides: Record<string, unknown> = {}) {
  return {
    id: RUN_ID,
    scenario_id: "C01",
    order_id: null,
    payment_attempt_id: null,
    payment_id: null,
    source_webhook_event_id: null,
    status: "PENDING",
    outcome: null,
    fault_type: null,
    failed_precheck_id: null,
    fault_config: {},
    fault_state: {},
    data_classification: "RECORDED_TEST_EVIDENCE",
    error_message_redacted: null,
    started_at: null,
    completed_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("lib/chaos/run-repository.ts — module surface", () => {
  it("imports the server-only marker package", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(
      path.resolve(import.meta.dirname, "../../../lib/chaos/run-repository.ts"),
      "utf-8",
    );
    expect(source).toMatch(/import\s+["']server-only["']/);
  });

  it("exposes exactly the fifteen approved P0 persistence/lifecycle functions (Phase 3B's original three, Phase 3C's three narrow C01 lifecycle transitions, Phase 3D-A's C03 lifecycle transitions plus two safe-shaped generic terminal helpers, and Phase 3D-B's five narrow C07 lifecycle transitions) — no speculative unconstrained lifecycle function", async () => {
    const mod = await import("@/lib/chaos/run-repository");
    // `ChaosRunRepositoryError` is a class, which is also `typeof === "function"`
    // in JS — excluded here deliberately since it is an error type, not a
    // persistence operation.
    const exportedFunctionNames = Object.keys(mod).filter(
      (name) =>
        typeof (mod as Record<string, unknown>)[name] === "function" &&
        name !== "ChaosRunRepositoryError",
    );
    expect(exportedFunctionNames.sort()).toEqual(
      [
        "createBlockedChaosRun",
        "createPendingChaosRun",
        "getChaosRunById",
        "startPendingC01RunAtomically",
        "completeRunningC01RunUnknown",
        "failRunningC01RunExecution",
        "blockPendingC03RunForPreSec007",
        "startPendingC03RunAtomically",
        "completeRunningChaosRunUnknown",
        "failRunningChaosRunExecution",
        "blockPendingC07RunForPreSec007",
        "startPendingC07RunAtomically",
        "consumeC07ClientConfirmationDrop",
        "completeRunningC07RunWithEvidence",
        "cancelRunningC07Fault",
      ].sort(),
    );
    // Generic/speculative names Phase 3B explicitly avoided remain absent.
    // `completeRunningChaosRunUnknown`/`failRunningChaosRunExecution` are
    // NOT the forbidden shape below — architect-approved Phase 3D-A "generic
    // terminal helpers" that accept only a fixed COMPLETED/UNKNOWN or
    // FAILED/ERROR shape and a safe fault_state/reason string, never an
    // arbitrary caller-supplied status/outcome/scenario/fault
    // type/execution_block_code (this task's Section 8C) — unlike a
    // forbidden `transitionRun`/`updateFaultState`, which would accept an
    // arbitrary target state.
    for (const forbidden of ["transitionRun", "updateFaultState"]) {
      expect(mod).not.toHaveProperty(forbidden);
    }
  });

  it("exports no insert/update/delete-shaped function beyond the two approved create functions", async () => {
    const mod = await import("@/lib/chaos/run-repository");
    const mutationLike = /^(update|delete|upsert|remove|write)/i;
    for (const name of Object.keys(mod)) {
      expect(name).not.toMatch(mutationLike);
    }
  });

  it("TYPE-LEVEL REGRESSION (architect correction): neither CreatePendingChaosRunInput nor CreateBlockedChaosRunInput can omit dataClassification through its public TypeScript contract — the DB column has no default, so this must be a compile error, not just a runtime check", () => {
    // Each @ts-expect-error below asserts that TypeScript itself rejects the
    // object literal for missing the required `dataClassification` field.
    // If a future change ever makes it optional again, these lines start
    // failing to compile with "Unused '@ts-expect-error' directive" —
    // typecheck (npm run typecheck) is where this regression is caught, not
    // this test's runtime assertions (which exist only so the file has a
    // real `it` to attach the comment to).
    // @ts-expect-error — dataClassification is required; this object is
    // deliberately missing it to prove the type rejects the omission.
    const pendingMissingClassification: CreatePendingChaosRunInput = {
      scenarioId: "C03",
      faultType: "INVALID_SIGNATURE_TEST",
    };
    // @ts-expect-error — dataClassification is required; this object is
    // deliberately missing it to prove the type rejects the omission.
    const blockedMissingClassification: CreateBlockedChaosRunInput = {
      scenarioId: "C03",
      failedPrecheckId: "PRECHECK-09",
      safeReason: "safe reason",
    };
    expect(pendingMissingClassification).toBeDefined();
    expect(blockedMissingClassification).toBeDefined();
  });
});

describe("createPendingChaosRun", () => {
  it("inserts exactly the PENDING shape: outcome/failed_precheck_id/error_message_redacted/started_at/completed_at all NULL, fault_config/fault_state {}", async () => {
    const builder = makeQueryBuilder({ data: fakeChaosRunRow(), error: null });
    fromMock.mockReturnValue(builder);
    const { createPendingChaosRun } =
      await import("@/lib/chaos/run-repository");

    await createPendingChaosRun({
      scenarioId: "C01",
      faultType: "REPLAY_EVENT",
      dataClassification: "RECORDED_TEST_EVIDENCE",
      orderId: ORDER_ID,
      paymentAttemptId: ATTEMPT_ID,
      paymentId: PAYMENT_ID,
      sourceWebhookEventId: WEBHOOK_EVENT_ID,
    });

    expect(fromMock).toHaveBeenCalledWith("chaos_runs");
    expect(builder.insert).toHaveBeenCalledWith({
      scenario_id: "C01",
      order_id: ORDER_ID,
      payment_attempt_id: ATTEMPT_ID,
      payment_id: PAYMENT_ID,
      source_webhook_event_id: WEBHOOK_EVENT_ID,
      status: "PENDING",
      outcome: null,
      fault_type: "REPLAY_EVENT",
      failed_precheck_id: null,
      fault_config: {},
      fault_state: {},
      data_classification: "RECORDED_TEST_EVIDENCE",
      error_message_redacted: null,
      started_at: null,
      completed_at: null,
    });
  });

  it("persists NULL fault_type for C11 — never a fabricated fourth primitive", async () => {
    const builder = makeQueryBuilder({
      data: fakeChaosRunRow({ scenario_id: "C11", fault_type: null }),
      error: null,
    });
    fromMock.mockReturnValue(builder);
    const { createPendingChaosRun } =
      await import("@/lib/chaos/run-repository");

    await createPendingChaosRun({
      scenarioId: "C11",
      faultType: null,
      dataClassification: "RECORDED_TEST_EVIDENCE",
      orderId: ORDER_ID,
    });

    expect(builder.insert).toHaveBeenCalledWith(
      expect.objectContaining({ fault_type: null }),
    );
  });

  it("persists NULL entity links when none are supplied (C03) — never fabricates one", async () => {
    const builder = makeQueryBuilder({
      data: fakeChaosRunRow({
        scenario_id: "C03",
        data_classification: "SYNTHETIC_DEMO",
      }),
      error: null,
    });
    fromMock.mockReturnValue(builder);
    const { createPendingChaosRun } =
      await import("@/lib/chaos/run-repository");

    await createPendingChaosRun({
      scenarioId: "C03",
      faultType: "INVALID_SIGNATURE_TEST",
      dataClassification: "SYNTHETIC_DEMO",
    });

    expect(builder.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        order_id: null,
        payment_attempt_id: null,
        payment_id: null,
        source_webhook_event_id: null,
      }),
    );
  });

  it("returns the persisted row", async () => {
    const row = fakeChaosRunRow();
    fromMock.mockReturnValue(makeQueryBuilder({ data: row, error: null }));
    const { createPendingChaosRun } =
      await import("@/lib/chaos/run-repository");
    const result = await createPendingChaosRun({
      scenarioId: "C01",
      faultType: "REPLAY_EVENT",
      dataClassification: "RECORDED_TEST_EVIDENCE",
    });
    expect(result).toEqual(row);
  });

  it("throws ChaosRunRepositoryError on a Supabase error, never leaking the raw error", async () => {
    fromMock.mockReturnValue(
      makeQueryBuilder({
        data: null,
        error: { message: "leaked-secret-detail" },
      }),
    );
    const { createPendingChaosRun, ChaosRunRepositoryError } =
      await import("@/lib/chaos/run-repository");
    const input = {
      scenarioId: "C01" as const,
      faultType: "REPLAY_EVENT" as const,
      dataClassification: "RECORDED_TEST_EVIDENCE" as const,
    };
    await expect(createPendingChaosRun(input)).rejects.toBeInstanceOf(
      ChaosRunRepositoryError,
    );
    try {
      await createPendingChaosRun(input);
      throw new Error("expected createPendingChaosRun to throw");
    } catch (err) {
      expect((err as Error).message).not.toContain("leaked-secret-detail");
    }
  });
});

describe("createBlockedChaosRun", () => {
  it("inserts exactly the BLOCKED shape: status COMPLETED, outcome BLOCKED, started_at NULL, completed_at set, fault_config/fault_state {}", async () => {
    const builder = makeQueryBuilder({
      data: fakeChaosRunRow({ status: "COMPLETED", outcome: "BLOCKED" }),
      error: null,
    });
    fromMock.mockReturnValue(builder);
    const { createBlockedChaosRun } =
      await import("@/lib/chaos/run-repository");
    const fixedNow = new Date("2026-02-02T00:00:00.000Z");

    await createBlockedChaosRun({
      scenarioId: "C07",
      failedPrecheckId: "PRECHECK-08",
      safeReason: "The supplied order is not fresh.",
      dataClassification: "RECORDED_TEST_EVIDENCE",
      faultType: "DROP_CLIENT_CONFIRMATION",
      orderId: ORDER_ID,
      now: () => fixedNow,
    });

    expect(builder.insert).toHaveBeenCalledWith({
      scenario_id: "C07",
      order_id: ORDER_ID,
      payment_attempt_id: null,
      payment_id: null,
      source_webhook_event_id: null,
      status: "COMPLETED",
      outcome: "BLOCKED",
      fault_type: "DROP_CLIENT_CONFIRMATION",
      failed_precheck_id: "PRECHECK-08",
      fault_config: {},
      fault_state: {},
      data_classification: "RECORDED_TEST_EVIDENCE",
      error_message_redacted: "The supplied order is not fresh.",
      started_at: null,
      completed_at: fixedNow.toISOString(),
    });
  });

  it("persists NULL fault_type for a blocked C11 run", async () => {
    const builder = makeQueryBuilder({
      data: fakeChaosRunRow({
        scenario_id: "C11",
        status: "COMPLETED",
        outcome: "BLOCKED",
      }),
      error: null,
    });
    fromMock.mockReturnValue(builder);
    const { createBlockedChaosRun } =
      await import("@/lib/chaos/run-repository");

    await createBlockedChaosRun({
      scenarioId: "C11",
      failedPrecheckId: "PRECHECK-07",
      safeReason: "No suitable authentic payment.failed evidence is available.",
      dataClassification: "SYNTHETIC_DEMO",
    });

    expect(builder.insert).toHaveBeenCalledWith(
      expect.objectContaining({ fault_type: null }),
    );
  });

  it("persists all entity links as NULL when none are provided (e.g. the C11 TEST_FIXTURE blocked model)", async () => {
    const builder = makeQueryBuilder({
      data: fakeChaosRunRow({
        scenario_id: "C11",
        status: "COMPLETED",
        outcome: "BLOCKED",
      }),
      error: null,
    });
    fromMock.mockReturnValue(builder);
    const { createBlockedChaosRun } =
      await import("@/lib/chaos/run-repository");

    await createBlockedChaosRun({
      scenarioId: "C11",
      failedPrecheckId: "PRECHECK-07",
      safeReason: "No suitable authentic payment.failed evidence is available.",
      dataClassification: "SYNTHETIC_DEMO",
    });

    expect(builder.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        order_id: null,
        payment_attempt_id: null,
        payment_id: null,
        source_webhook_event_id: null,
      }),
    );
  });

  it("always sets started_at to NULL, regardless of caller input shape", async () => {
    const builder = makeQueryBuilder({
      data: fakeChaosRunRow({ status: "COMPLETED", outcome: "BLOCKED" }),
      error: null,
    });
    fromMock.mockReturnValue(builder);
    const { createBlockedChaosRun } =
      await import("@/lib/chaos/run-repository");

    await createBlockedChaosRun({
      scenarioId: "C03",
      failedPrecheckId: "PRECHECK-10",
      safeReason:
        "Chaos request input contains unsupported, missing, or extra fields.",
      dataClassification: "SYNTHETIC_DEMO",
    });

    expect(builder.insert).toHaveBeenCalledWith(
      expect.objectContaining({ started_at: null }),
    );
  });

  it("sets a safe, real completed_at timestamp using the real clock by default", async () => {
    const builder = makeQueryBuilder({
      data: fakeChaosRunRow({ status: "COMPLETED", outcome: "BLOCKED" }),
      error: null,
    });
    fromMock.mockReturnValue(builder);
    const { createBlockedChaosRun } =
      await import("@/lib/chaos/run-repository");
    const before = Date.now();

    await createBlockedChaosRun({
      scenarioId: "C03",
      failedPrecheckId: "PRECHECK-09",
      safeReason: "Requested mechanism is not allowed for this scenario.",
      dataClassification: "SYNTHETIC_DEMO",
    });

    const after = Date.now();
    const insertedCompletedAt = (
      builder.insert.mock.calls[0]?.[0] as { completed_at: string }
    ).completed_at;
    expect(new Date(insertedCompletedAt).getTime()).toBeGreaterThanOrEqual(
      before,
    );
    expect(new Date(insertedCompletedAt).getTime()).toBeLessThanOrEqual(after);
  });

  it("returns the persisted row", async () => {
    const row = fakeChaosRunRow({ status: "COMPLETED", outcome: "BLOCKED" });
    fromMock.mockReturnValue(makeQueryBuilder({ data: row, error: null }));
    const { createBlockedChaosRun } =
      await import("@/lib/chaos/run-repository");
    const result = await createBlockedChaosRun({
      scenarioId: "C03",
      failedPrecheckId: "PRECHECK-09",
      safeReason: "Requested fault primitive is not allowed for this scenario.",
      dataClassification: "SYNTHETIC_DEMO",
    });
    expect(result).toEqual(row);
  });

  it("throws ChaosRunRepositoryError on a Supabase error, never leaking the raw error", async () => {
    fromMock.mockReturnValue(
      makeQueryBuilder({
        data: null,
        error: { message: "leaked-secret-detail" },
      }),
    );
    const { createBlockedChaosRun, ChaosRunRepositoryError } =
      await import("@/lib/chaos/run-repository");
    const input = {
      scenarioId: "C03" as const,
      failedPrecheckId: "PRECHECK-09" as const,
      safeReason: "Requested fault primitive is not allowed for this scenario.",
      dataClassification: "SYNTHETIC_DEMO" as const,
    };
    await expect(createBlockedChaosRun(input)).rejects.toBeInstanceOf(
      ChaosRunRepositoryError,
    );
    try {
      await createBlockedChaosRun(input);
      throw new Error("expected createBlockedChaosRun to throw");
    } catch (err) {
      expect((err as Error).message).not.toContain("leaked-secret-detail");
    }
  });
});

describe("getChaosRunById", () => {
  it("returns the row when found", async () => {
    const row = fakeChaosRunRow();
    const builder = makeQueryBuilder({ data: row, error: null });
    fromMock.mockReturnValue(builder);
    const { getChaosRunById } = await import("@/lib/chaos/run-repository");
    const result = await getChaosRunById(RUN_ID);
    expect(result).toEqual(row);
    expect(fromMock).toHaveBeenCalledWith("chaos_runs");
    expect(builder.eq).toHaveBeenCalledWith("id", RUN_ID);
  });

  it("returns null when not found", async () => {
    fromMock.mockReturnValue(makeQueryBuilder({ data: null, error: null }));
    const { getChaosRunById } = await import("@/lib/chaos/run-repository");
    expect(await getChaosRunById(RUN_ID)).toBeNull();
  });

  it("throws ChaosRunRepositoryError on a Supabase error, never leaking the raw error", async () => {
    fromMock.mockReturnValue(
      makeQueryBuilder({
        data: null,
        error: { message: "leaked-secret-detail" },
      }),
    );
    const { getChaosRunById, ChaosRunRepositoryError } =
      await import("@/lib/chaos/run-repository");
    await expect(getChaosRunById(RUN_ID)).rejects.toBeInstanceOf(
      ChaosRunRepositoryError,
    );
    try {
      await getChaosRunById(RUN_ID);
      throw new Error("expected getChaosRunById to throw");
    } catch (err) {
      expect((err as Error).message).not.toContain("leaked-secret-detail");
    }
  });
});

describe("startPendingC01RunAtomically (Phase 3C)", () => {
  it("issues a single atomic conditional UPDATE scoped to id/scenario_id/status/fault_type/outcome — never a SELECT-then-UPDATE", async () => {
    const builder = makeQueryBuilder({
      data: fakeChaosRunRow({ status: "RUNNING" }),
      error: null,
    });
    fromMock.mockReturnValue(builder);
    const { startPendingC01RunAtomically } =
      await import("@/lib/chaos/run-repository");
    const fixedNow = new Date("2026-03-03T00:00:00.000Z");

    await startPendingC01RunAtomically(RUN_ID, () => fixedNow);

    expect(fromMock).toHaveBeenCalledWith("chaos_runs");
    expect(builder.update).toHaveBeenCalledWith({
      status: "RUNNING",
      started_at: fixedNow.toISOString(),
      updated_at: fixedNow.toISOString(),
    });
    expect(builder.eq).toHaveBeenCalledWith("id", RUN_ID);
    expect(builder.eq).toHaveBeenCalledWith("scenario_id", "C01");
    expect(builder.eq).toHaveBeenCalledWith("status", "PENDING");
    expect(builder.eq).toHaveBeenCalledWith("fault_type", "REPLAY_EVENT");
    expect(builder.is).toHaveBeenCalledWith("outcome", null);
  });

  it("returns the claimed row on success", async () => {
    const row = fakeChaosRunRow({ status: "RUNNING" });
    fromMock.mockReturnValue(makeQueryBuilder({ data: row, error: null }));
    const { startPendingC01RunAtomically } =
      await import("@/lib/chaos/run-repository");
    expect(await startPendingC01RunAtomically(RUN_ID)).toEqual(row);
  });

  it("returns null (never throws) when zero rows matched — already claimed or not eligible", async () => {
    fromMock.mockReturnValue(makeQueryBuilder({ data: null, error: null }));
    const { startPendingC01RunAtomically } =
      await import("@/lib/chaos/run-repository");
    expect(await startPendingC01RunAtomically(RUN_ID)).toBeNull();
  });

  it("throws ChaosRunRepositoryError on a Supabase error, never leaking the raw error", async () => {
    fromMock.mockReturnValue(
      makeQueryBuilder({
        data: null,
        error: { message: "leaked-secret-detail" },
      }),
    );
    const { startPendingC01RunAtomically, ChaosRunRepositoryError } =
      await import("@/lib/chaos/run-repository");
    await expect(startPendingC01RunAtomically(RUN_ID)).rejects.toBeInstanceOf(
      ChaosRunRepositoryError,
    );
  });
});

describe("completeRunningC01RunUnknown (Phase 3C)", () => {
  it("updates status=COMPLETED/outcome=UNKNOWN/error_message_redacted=NULL, scoped to status=RUNNING only", async () => {
    const builder = makeQueryBuilder({
      data: fakeChaosRunRow({ status: "COMPLETED", outcome: "UNKNOWN" }),
      error: null,
    });
    fromMock.mockReturnValue(builder);
    const { completeRunningC01RunUnknown } =
      await import("@/lib/chaos/run-repository");
    const fixedNow = new Date("2026-03-03T01:00:00.000Z");

    await completeRunningC01RunUnknown(RUN_ID, () => fixedNow);

    expect(builder.update).toHaveBeenCalledWith({
      status: "COMPLETED",
      outcome: "UNKNOWN",
      completed_at: fixedNow.toISOString(),
      updated_at: fixedNow.toISOString(),
      error_message_redacted: null,
    });
    expect(builder.eq).toHaveBeenCalledWith("id", RUN_ID);
    expect(builder.eq).toHaveBeenCalledWith("status", "RUNNING");
  });

  it("returns null when the run is not RUNNING", async () => {
    fromMock.mockReturnValue(makeQueryBuilder({ data: null, error: null }));
    const { completeRunningC01RunUnknown } =
      await import("@/lib/chaos/run-repository");
    expect(await completeRunningC01RunUnknown(RUN_ID)).toBeNull();
  });

  it("throws ChaosRunRepositoryError on a Supabase error, never leaking the raw error", async () => {
    fromMock.mockReturnValue(
      makeQueryBuilder({
        data: null,
        error: { message: "leaked-secret-detail" },
      }),
    );
    const { completeRunningC01RunUnknown, ChaosRunRepositoryError } =
      await import("@/lib/chaos/run-repository");
    await expect(completeRunningC01RunUnknown(RUN_ID)).rejects.toBeInstanceOf(
      ChaosRunRepositoryError,
    );
  });
});

describe("blockPendingC07RunForPreSec007 (Phase 3D-B)", () => {
  it("issues a single atomic conditional UPDATE hardcoding C07 eligibility including order_id IS NOT NULL", async () => {
    const builder = makeQueryBuilder({
      data: fakeChaosRunRow({
        scenario_id: "C07",
        status: "COMPLETED",
        outcome: "BLOCKED",
      }),
      error: null,
    });
    fromMock.mockReturnValue(builder);
    const { blockPendingC07RunForPreSec007 } =
      await import("@/lib/chaos/run-repository");
    const fixedNow = new Date("2026-03-03T02:00:00.000Z");

    await blockPendingC07RunForPreSec007(RUN_ID, "safe reason", () => fixedNow);

    expect(builder.update).toHaveBeenCalledWith({
      status: "COMPLETED",
      outcome: "BLOCKED",
      failed_precheck_id: null,
      execution_block_code: "PRE-SEC-007",
      error_message_redacted: "safe reason",
      started_at: null,
      completed_at: fixedNow.toISOString(),
      updated_at: fixedNow.toISOString(),
    });
    expect(builder.eq).toHaveBeenCalledWith("scenario_id", "C07");
    expect(builder.eq).toHaveBeenCalledWith(
      "fault_type",
      "DROP_CLIENT_CONFIRMATION",
    );
    expect(builder.eq).toHaveBeenCalledWith(
      "data_classification",
      "RECORDED_TEST_EVIDENCE",
    );
    expect(builder.not).toHaveBeenCalledWith("order_id", "is", null);
  });

  it("returns null when zero rows matched", async () => {
    fromMock.mockReturnValue(makeQueryBuilder({ data: null, error: null }));
    const { blockPendingC07RunForPreSec007 } =
      await import("@/lib/chaos/run-repository");
    expect(
      await blockPendingC07RunForPreSec007(RUN_ID, "safe reason"),
    ).toBeNull();
  });
});

describe("startPendingC07RunAtomically (Phase 3D-B)", () => {
  it("issues a single atomic UPDATE setting RUNNING + started_at + the fixed armed fault_state, hardcoding C07 eligibility", async () => {
    const builder = makeQueryBuilder({
      data: fakeChaosRunRow({ scenario_id: "C07", status: "RUNNING" }),
      error: null,
    });
    fromMock.mockReturnValue(builder);
    const { startPendingC07RunAtomically } =
      await import("@/lib/chaos/run-repository");
    const fixedNow = new Date("2026-03-03T03:00:00.000Z");

    const result = await startPendingC07RunAtomically(RUN_ID, () => fixedNow);

    expect(builder.update).toHaveBeenCalledWith({
      status: "RUNNING",
      started_at: fixedNow.toISOString(),
      updated_at: fixedNow.toISOString(),
      fault_state: { armed: true, consumed: false },
    });
    expect(builder.eq).toHaveBeenCalledWith("scenario_id", "C07");
    expect(builder.eq).toHaveBeenCalledWith(
      "fault_type",
      "DROP_CLIENT_CONFIRMATION",
    );
    expect(builder.not).toHaveBeenCalledWith("order_id", "is", null);
    expect(result.kind).toBe("STARTED");
  });

  it("returns NOT_ELIGIBLE (never throws) when zero rows matched and no error occurred", async () => {
    fromMock.mockReturnValue(makeQueryBuilder({ data: null, error: null }));
    const { startPendingC07RunAtomically } =
      await import("@/lib/chaos/run-repository");
    expect(await startPendingC07RunAtomically(RUN_ID)).toEqual({
      kind: "NOT_ELIGIBLE",
    });
  });

  it("maps a 23505 unique-violation error to ALREADY_ARMED_FOR_ORDER — the Phase 3D-0 partial index is the race-safety authority", async () => {
    fromMock.mockReturnValue(
      makeQueryBuilder({
        data: null,
        error: { code: "23505", message: "duplicate key value" },
      }),
    );
    const { startPendingC07RunAtomically } =
      await import("@/lib/chaos/run-repository");
    expect(await startPendingC07RunAtomically(RUN_ID)).toEqual({
      kind: "ALREADY_ARMED_FOR_ORDER",
    });
  });

  it("throws ChaosRunRepositoryError on any other Supabase error", async () => {
    fromMock.mockReturnValue(
      makeQueryBuilder({
        data: null,
        error: { code: "OTHER", message: "leaked-secret-detail" },
      }),
    );
    const { startPendingC07RunAtomically, ChaosRunRepositoryError } =
      await import("@/lib/chaos/run-repository");
    await expect(startPendingC07RunAtomically(RUN_ID)).rejects.toBeInstanceOf(
      ChaosRunRepositoryError,
    );
  });
});

describe("consumeC07ClientConfirmationDrop (Phase 3D-B correction round — exact JSON state)", () => {
  it("11: issues a single atomic UPDATE using EXACT jsonb equality (never containment) to require armed=true/consumed=false before flipping to consumed=true", async () => {
    const builder = makeQueryBuilder({
      data: fakeChaosRunRow({ scenario_id: "C07", status: "RUNNING" }),
      error: null,
    });
    fromMock.mockReturnValue(builder);
    const { consumeC07ClientConfirmationDrop } =
      await import("@/lib/chaos/run-repository");
    const fixedNow = new Date("2026-03-03T04:00:00.000Z");

    await consumeC07ClientConfirmationDrop(RUN_ID, () => fixedNow);

    expect(builder.update).toHaveBeenCalledWith({
      fault_state: { armed: true, consumed: true },
      updated_at: fixedNow.toISOString(),
    });
    // A raw object passed to postgrest-js's `.eq()` is not serialized as
    // JSON (it would stringify to the literal "[object Object]" and the
    // database would reject it with 22P02) — the exact JSON text is
    // supplied explicitly via `.filter(column, "eq", value)`, postgrest-js's
    // documented raw-syntax escape hatch.
    expect(builder.filter).toHaveBeenCalledWith(
      "fault_state",
      "eq",
      JSON.stringify({ armed: true, consumed: false }),
    );
    expect(builder.eq).toHaveBeenCalledWith("status", "RUNNING");
    expect(builder.eq).toHaveBeenCalledWith(
      "data_classification",
      "RECORDED_TEST_EVIDENCE",
    );
    expect(builder.contains).not.toHaveBeenCalled();
  });

  it("returns null (never throws) when zero rows matched — already consumed or not active", async () => {
    fromMock.mockReturnValue(makeQueryBuilder({ data: null, error: null }));
    const { consumeC07ClientConfirmationDrop } =
      await import("@/lib/chaos/run-repository");
    expect(await consumeC07ClientConfirmationDrop(RUN_ID)).toBeNull();
  });
});

describe("completeRunningC07RunWithEvidence (Phase 3D-B correction round — exact JSON state)", () => {
  it("12: requires EXACT consumed=true jsonb equality (never containment), scopes to the expected order, and populates the resolved evidence FKs", async () => {
    const builder = makeQueryBuilder({
      data: fakeChaosRunRow({
        scenario_id: "C07",
        status: "COMPLETED",
        outcome: "UNKNOWN",
      }),
      error: null,
    });
    fromMock.mockReturnValue(builder);
    const { completeRunningC07RunWithEvidence } =
      await import("@/lib/chaos/run-repository");
    const fixedNow = new Date("2026-03-03T05:00:00.000Z");

    await completeRunningC07RunWithEvidence(
      RUN_ID,
      "order-1",
      {
        paymentAttemptId: "attempt-1",
        paymentId: "payment-1",
        sourceWebhookEventId: "webhook-1",
      },
      () => fixedNow,
    );

    expect(builder.update).toHaveBeenCalledWith({
      status: "COMPLETED",
      outcome: "UNKNOWN",
      completed_at: fixedNow.toISOString(),
      updated_at: fixedNow.toISOString(),
      fault_state: { armed: true, consumed: true },
      payment_attempt_id: "attempt-1",
      payment_id: "payment-1",
      source_webhook_event_id: "webhook-1",
      error_message_redacted: null,
    });
    expect(builder.eq).toHaveBeenCalledWith("order_id", "order-1");
    expect(builder.filter).toHaveBeenCalledWith(
      "fault_state",
      "eq",
      JSON.stringify({ armed: true, consumed: true }),
    );
    expect(builder.contains).not.toHaveBeenCalled();
  });

  it("returns null when zero rows matched", async () => {
    fromMock.mockReturnValue(makeQueryBuilder({ data: null, error: null }));
    const { completeRunningC07RunWithEvidence } =
      await import("@/lib/chaos/run-repository");
    expect(
      await completeRunningC07RunWithEvidence(RUN_ID, "order-1", {
        paymentAttemptId: "a",
        paymentId: "p",
        sourceWebhookEventId: "w",
      }),
    ).toBeNull();
  });
});

describe("cancelRunningC07Fault (Phase 3D-B final correction round — Blocker A: atomic exact pre-state)", () => {
  it("transitions a RUNNING C07 run to FAILED/ERROR, scoped to the expected order, preserving fault_state untouched", async () => {
    const builder = makeQueryBuilder({
      data: fakeChaosRunRow({
        scenario_id: "C07",
        status: "FAILED",
        outcome: "ERROR",
      }),
      error: null,
    });
    fromMock.mockReturnValue(builder);
    const { cancelRunningC07Fault } =
      await import("@/lib/chaos/run-repository");
    const fixedNow = new Date("2026-03-03T06:00:00.000Z");

    await cancelRunningC07Fault(
      RUN_ID,
      "order-1",
      false,
      "operator cancel",
      () => fixedNow,
    );

    expect(builder.update).toHaveBeenCalledWith({
      status: "FAILED",
      outcome: "ERROR",
      completed_at: fixedNow.toISOString(),
      updated_at: fixedNow.toISOString(),
      error_message_redacted: "operator cancel",
    });
    expect(builder.eq).toHaveBeenCalledWith("order_id", "order-1");
    expect(builder.eq).toHaveBeenCalledWith(
      "data_classification",
      "RECORDED_TEST_EVIDENCE",
    );
    // fault_state is never part of the update payload.
    const updatePayload = builder.update.mock.calls[0]![0];
    expect(updatePayload).not.toHaveProperty("fault_state");
  });

  it("Blocker A: requires exact fault_state={armed:true,consumed:false} via .filter(..., 'eq', ...) when expectedConsumed=false — never .contains()", async () => {
    const builder = makeQueryBuilder({
      data: fakeChaosRunRow({ scenario_id: "C07", status: "FAILED" }),
      error: null,
    });
    fromMock.mockReturnValue(builder);
    const { cancelRunningC07Fault } =
      await import("@/lib/chaos/run-repository");

    await cancelRunningC07Fault(RUN_ID, "order-1", false, "operator cancel");

    expect(builder.filter).toHaveBeenCalledWith(
      "fault_state",
      "eq",
      JSON.stringify({ armed: true, consumed: false }),
    );
    expect(builder.contains).not.toHaveBeenCalled();
  });

  it("Blocker A: requires exact fault_state={armed:true,consumed:true} via .filter(..., 'eq', ...) when expectedConsumed=true — never .contains()", async () => {
    const builder = makeQueryBuilder({
      data: fakeChaosRunRow({ scenario_id: "C07", status: "FAILED" }),
      error: null,
    });
    fromMock.mockReturnValue(builder);
    const { cancelRunningC07Fault } =
      await import("@/lib/chaos/run-repository");

    await cancelRunningC07Fault(RUN_ID, "order-1", true, "operator cancel");

    expect(builder.filter).toHaveBeenCalledWith(
      "fault_state",
      "eq",
      JSON.stringify({ armed: true, consumed: true }),
    );
    expect(builder.contains).not.toHaveBeenCalled();
  });

  it("returns null when the run is not currently RUNNING (or the exact pre-state predicate no longer matches)", async () => {
    fromMock.mockReturnValue(makeQueryBuilder({ data: null, error: null }));
    const { cancelRunningC07Fault } =
      await import("@/lib/chaos/run-repository");
    expect(
      await cancelRunningC07Fault(RUN_ID, "order-1", false, "operator cancel"),
    ).toBeNull();
  });
});

describe("failRunningC01RunExecution (Phase 3C)", () => {
  it("updates status=FAILED/outcome=ERROR with the given safe reason, scoped to status=RUNNING only", async () => {
    const builder = makeQueryBuilder({
      data: fakeChaosRunRow({ status: "FAILED", outcome: "ERROR" }),
      error: null,
    });
    fromMock.mockReturnValue(builder);
    const { failRunningC01RunExecution } =
      await import("@/lib/chaos/run-repository");
    const fixedNow = new Date("2026-03-03T02:00:00.000Z");

    await failRunningC01RunExecution(
      RUN_ID,
      "Chaos replay execution failed before the intended scenario could complete.",
      () => fixedNow,
    );

    expect(builder.update).toHaveBeenCalledWith({
      status: "FAILED",
      outcome: "ERROR",
      completed_at: fixedNow.toISOString(),
      updated_at: fixedNow.toISOString(),
      error_message_redacted:
        "Chaos replay execution failed before the intended scenario could complete.",
    });
    expect(builder.eq).toHaveBeenCalledWith("id", RUN_ID);
    expect(builder.eq).toHaveBeenCalledWith("status", "RUNNING");
  });

  it("never persists a raw error object as the reason — only the safe string the caller supplies", async () => {
    const builder = makeQueryBuilder({
      data: fakeChaosRunRow({ status: "FAILED", outcome: "ERROR" }),
      error: null,
    });
    fromMock.mockReturnValue(builder);
    const { failRunningC01RunExecution } =
      await import("@/lib/chaos/run-repository");

    await failRunningC01RunExecution(RUN_ID, "safe fixed reason");

    const updatePayload = builder.update.mock.calls[0]?.[0] as {
      error_message_redacted: string;
    };
    expect(updatePayload.error_message_redacted).toBe("safe fixed reason");
  });

  it("throws ChaosRunRepositoryError on a Supabase error, never leaking the raw error", async () => {
    fromMock.mockReturnValue(
      makeQueryBuilder({
        data: null,
        error: { message: "leaked-secret-detail" },
      }),
    );
    const { failRunningC01RunExecution, ChaosRunRepositoryError } =
      await import("@/lib/chaos/run-repository");
    await expect(
      failRunningC01RunExecution(RUN_ID, "safe reason"),
    ).rejects.toBeInstanceOf(ChaosRunRepositoryError);
  });
});
