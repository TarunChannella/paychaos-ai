import { describe, expect, it } from "vitest";

import {
  ACTIVE_REGRESSION_STATUSES,
  isActiveRegressionStatus,
  isTerminalRegressionStatus,
  REGRESSION_DECISION_REASONS,
  REGRESSION_INELIGIBILITY_CODES,
  REGRESSION_REPOSITORY_ERROR_CODES,
  TERMINAL_REGRESSION_STATUSES,
} from "@/lib/regression/types";
import type { Database, RegressionRunStatus } from "@/lib/supabase/types";

/**
 * Phase 4E-R1 — the frozen regression vocabularies.
 *
 * These are contracts a later round and the database both depend on, so they
 * are pinned by exact content and order rather than by count alone.
 */

const ALL_STATUSES: readonly RegressionRunStatus[] = [
  "PENDING",
  "RUNNING",
  "RESOLVED",
  "STILL_FAILING",
  "ERROR",
];

describe("Phase 4E-R1 — status vocabulary", () => {
  it("1: active means exactly PENDING and RUNNING", () => {
    expect([...ACTIVE_REGRESSION_STATUSES]).toEqual(["PENDING", "RUNNING"]);
  });

  it("2: terminal means exactly RESOLVED, STILL_FAILING and ERROR", () => {
    expect([...TERMINAL_REGRESSION_STATUSES]).toEqual([
      "RESOLVED",
      "STILL_FAILING",
      "ERROR",
    ]);
  });

  it("3: active and terminal partition the five statuses with no overlap", () => {
    const active = new Set<string>(ACTIVE_REGRESSION_STATUSES);
    const terminal = new Set<string>(TERMINAL_REGRESSION_STATUSES);
    for (const status of ALL_STATUSES) {
      expect(active.has(status) !== terminal.has(status), status).toBe(true);
    }
    expect(active.size + terminal.size).toBe(ALL_STATUSES.length);
  });

  it("4: the predicates agree with the tuples for every status", () => {
    for (const status of ALL_STATUSES) {
      expect(isActiveRegressionStatus(status), status).toBe(
        (ACTIVE_REGRESSION_STATUSES as readonly string[]).includes(status),
      );
      expect(isTerminalRegressionStatus(status), status).toBe(
        (TERMINAL_REGRESSION_STATUSES as readonly string[]).includes(status),
      );
    }
  });

  it("5: the tuples are frozen", () => {
    expect(Object.isFrozen(ACTIVE_REGRESSION_STATUSES)).toBe(true);
    expect(Object.isFrozen(TERMINAL_REGRESSION_STATUSES)).toBe(true);
  });
});

describe("Phase 4E-R1 — error and decision vocabularies", () => {
  it("6: the repository error codes are exact", () => {
    expect([...REGRESSION_REPOSITORY_ERROR_CODES]).toEqual([
      "REGRESSION_FINDING_ID_INVALID",
      "REGRESSION_RUN_ID_INVALID",
      "REGRESSION_CHAOS_RUN_ID_INVALID",
      "REGRESSION_READ_FAILED",
      "REGRESSION_INSERT_FAILED",
      "REGRESSION_UPDATE_FAILED",
      "REGRESSION_STATE_CONFLICT",
      "REGRESSION_ACTIVE_RUN_CONFLICT",
      "REGRESSION_INTEGRITY_CONFLICT",
    ]);
  });

  it("7: the ineligibility codes are exact", () => {
    expect([...REGRESSION_INELIGIBILITY_CODES]).toEqual([
      "REGRESSION_FINDING_NOT_FOUND",
      "REGRESSION_NO_ORIGINAL_CHAOS_RUN",
      "REGRESSION_ORIGINAL_CHAOS_RUN_NOT_FOUND",
      "REGRESSION_SCENARIO_NOT_REGISTERED",
      "REGRESSION_ORIGINAL_INVARIANT_NOT_REQUIRED",
      "REGRESSION_ACTIVE_RUN_EXISTS",
    ]);
  });

  it("8: no ineligibility code mentions diagnosis or recommendation", () => {
    // A finding is eligible because of what it points at, never because of
    // what has been said about it.
    for (const code of REGRESSION_INELIGIBILITY_CODES) {
      expect(code, code).not.toContain("DIAGNOSIS");
      expect(code, code).not.toContain("RECOMMENDATION");
    }
  });

  it("9: the decision reasons are exact", () => {
    expect([...REGRESSION_DECISION_REASONS]).toEqual([
      "SCENARIO_CRITERIA_PASSED",
      "SCENARIO_CRITERIA_FAILED",
      "ORIGINAL_INVARIANT_NOT_PROVEN_PASS",
      "INCONCLUSIVE_UNKNOWN",
    ]);
  });

  it("10: every vocabulary is frozen and duplicate-free", () => {
    for (const vocabulary of [
      REGRESSION_REPOSITORY_ERROR_CODES,
      REGRESSION_INELIGIBILITY_CODES,
      REGRESSION_DECISION_REASONS,
    ]) {
      expect(Object.isFrozen(vocabulary)).toBe(true);
      expect(new Set<string>(vocabulary).size).toBe(vocabulary.length);
    }
  });
});

// ============================================================================
// GENERATED SUPABASE TYPE SURFACE
// ============================================================================

/**
 * These are compile-time assertions: `tsc --noEmit` fails the build if the
 * generated `regression_runs` type stops matching the migration. The runtime
 * `expect` calls exist so the file reports as a real test rather than a silent
 * type-only module.
 */
type Tables = Database["public"]["Tables"];
type RegressionTable = Tables["regression_runs"];

/** Exact `Row` shape — every column of the migration, and no other. */
const ROW: RegressionTable["Row"] = {
  id: "id",
  finding_id: "finding",
  chaos_run_id: "run",
  status: "PENDING",
  started_at: null,
  completed_at: null,
  created_at: "now",
};

/** `Insert` supplies only the two required columns; the rest have defaults. */
const INSERT: RegressionTable["Insert"] = {
  finding_id: "finding",
  chaos_run_id: "run",
};

/** `Update` is a real type — a regression run is a lifecycle object. */
const UPDATE: RegressionTable["Update"] = {
  status: "RESOLVED",
  completed_at: "now",
};

describe("Phase 4E-R1 — generated Supabase types", () => {
  it("11: the Row carries exactly the seven migration columns", () => {
    expect(Object.keys(ROW).sort()).toEqual([
      "chaos_run_id",
      "completed_at",
      "created_at",
      "finding_id",
      "id",
      "started_at",
      "status",
    ]);
  });

  it("12: there is no updated_at anywhere in the type surface", () => {
    expect(ROW).not.toHaveProperty("updated_at");
    expect(INSERT).not.toHaveProperty("updated_at");
    expect(UPDATE).not.toHaveProperty("updated_at");
  });

  it("13: Insert requires only finding_id and chaos_run_id", () => {
    expect(Object.keys(INSERT).sort()).toEqual(["chaos_run_id", "finding_id"]);
  });

  it("14: Update accepts the lifecycle columns and identity is never re-pointed", () => {
    expect(Object.keys(UPDATE).sort()).toEqual(["completed_at", "status"]);
    // `id`, `finding_id` and `chaos_run_id` are deliberately absent from the
    // Update type: a regression is never re-pointed at a different finding or
    // chaos run. Each line below is a compile-time proof of that.
    // @ts-expect-error identity is not updatable
    const badId: RegressionTable["Update"] = { id: "x" };
    // @ts-expect-error a regression never changes which finding it re-tests
    const badFinding: RegressionTable["Update"] = { finding_id: "x" };
    // @ts-expect-error a regression never changes which chaos run it used
    const badRun: RegressionTable["Update"] = { chaos_run_id: "x" };
    expect([badId, badFinding, badRun]).toHaveLength(3);
  });

  it("15: the Row status is the frozen five-value union", () => {
    const statuses: RegressionRunStatus[] = [
      "PENDING",
      "RUNNING",
      "RESOLVED",
      "STILL_FAILING",
      "ERROR",
    ];
    expect(statuses).toHaveLength(5);
    // @ts-expect-error UNKNOWN is a chaos-run outcome, never a regression status
    const bad: RegressionRunStatus = "UNKNOWN";
    // @ts-expect-error BLOCKED is a chaos-run outcome, never a regression status
    const alsoBad: RegressionRunStatus = "BLOCKED";
    expect([bad, alsoBad]).toHaveLength(2);
  });

  it("16: no P1-only score table has been added to the Database type", () => {
    const tableNames: (keyof Tables)[] = [
      "orders",
      "payment_attempts",
      "payments",
      "fulfilments",
      "webhook_events",
      "event_processing_attempts",
      "chaos_runs",
      "invariant_results",
      "findings",
      "regression_runs",
    ];
    expect(tableNames).toHaveLength(10);
    // @ts-expect-error reliability_score_snapshots is P1-only and untyped here
    const forbidden: keyof Tables = "reliability_score_snapshots";
    expect(forbidden).toBeDefined();
  });
});
