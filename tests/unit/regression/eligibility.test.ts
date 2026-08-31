import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * Phase 4E-R1 — read-only regression eligibility.
 *
 * The frozen chaos registry runs FOR REAL throughout: only the persistence
 * reads are faked, so every assertion about a scenario's required invariant
 * set is checked against the authoritative registry rather than a fixture of
 * it. That is the point — a copied mapping in a fixture would hide exactly the
 * duplication this module must not have.
 */

const findFindingById = vi.fn();
const findInvariantResultById = vi.fn();
const findActiveRegressionForFinding = vi.fn();
const chaosRunResponse = {
  value: { data: null as unknown, error: null as unknown },
};
const chaosRunQueries: { table: string; projection: string; eq: unknown }[] =
  [];

vi.mock("@/lib/findings/repository", () => ({
  findFindingById: (...args: unknown[]) => findFindingById(...args),
  findInvariantResultById: (...args: unknown[]) =>
    findInvariantResultById(...args),
}));

vi.mock("@/lib/regression/repository", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/regression/repository")
  >("@/lib/regression/repository");
  return {
    ...actual,
    findActiveRegressionForFinding: (...args: unknown[]) =>
      findActiveRegressionForFinding(...args),
  };
});

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: () => ({
    from: (table: string) => ({
      select: (projection: string) => ({
        eq: (column: string, value: unknown) => ({
          maybeSingle: () => {
            chaosRunQueries.push({
              table,
              projection,
              eq: { [column]: value },
            });
            return Promise.resolve(chaosRunResponse.value);
          },
        }),
      }),
    }),
  }),
}));

const { resolveRegressionEligibility, RegressionEligibilityError } =
  await import("@/lib/regression/eligibility");

const FINDING_ID = "11111111-1111-4111-8111-111111111111";
const RESULT_ID = "22222222-2222-4222-8222-222222222222";
const RUN_ID = "33333333-3333-4333-8333-333333333333";

function finding(overrides: Record<string, unknown> = {}) {
  return {
    id: FINDING_ID,
    invariantResultId: RESULT_ID,
    status: "OPEN",
    title: "INV-005 — some frozen invariant name",
    createdAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-01T10:00:00.000Z",
    ...overrides,
  };
}

function invariantResult(overrides: Record<string, unknown> = {}) {
  return {
    id: RESULT_ID,
    invariant_id: "INV-005",
    chaos_run_id: RUN_ID,
    result: "FAIL",
    ...overrides,
  };
}

function chaosRun(scenarioId: string) {
  chaosRunResponse.value = {
    data: { id: RUN_ID, scenario_id: scenarioId },
    error: null,
  };
}

/** The happy path: a C03 finding on INV-005, with no active regression. */
function arrangeEligible(findingOverrides: Record<string, unknown> = {}) {
  findFindingById.mockResolvedValue(finding(findingOverrides));
  findInvariantResultById.mockResolvedValue(invariantResult());
  chaosRun("C03");
  findActiveRegressionForFinding.mockResolvedValue(null);
}

beforeEach(() => {
  vi.resetAllMocks();
  chaosRunQueries.length = 0;
  chaosRunResponse.value = { data: null, error: null };
});

// ============================================================================
// FINDING STATUS
// ============================================================================

describe("Phase 4E-R1 eligibility — finding status", () => {
  it("1: an OPEN finding is eligible", async () => {
    arrangeEligible({ status: "OPEN" });
    const result = await resolveRegressionEligibility(FINDING_ID);
    expect(result.kind).toBe("ELIGIBLE");
    if (result.kind !== "ELIGIBLE") throw new Error("expected ELIGIBLE");
    expect(result.findingStatus).toBe("OPEN");
  });

  it("2: a STILL_FAILING finding is eligible — it may be re-tested", async () => {
    arrangeEligible({ status: "STILL_FAILING" });
    const result = await resolveRegressionEligibility(FINDING_ID);
    expect(result.kind).toBe("ELIGIBLE");
  });

  it("3: a RESOLVED finding is eligible — verification may be repeated", async () => {
    // Architect decision D-2. Status is reported, never used to reject.
    arrangeEligible({ status: "RESOLVED" });
    const result = await resolveRegressionEligibility(FINDING_ID);
    expect(result.kind).toBe("ELIGIBLE");
    if (result.kind !== "ELIGIBLE") throw new Error("expected ELIGIBLE");
    expect(result.findingStatus).toBe("RESOLVED");
  });
});

// ============================================================================
// PROSE IS NEVER CONSULTED
// ============================================================================

describe("Phase 4E-R1 eligibility — structural evidence only", () => {
  it("4: NULL diagnosis fields do not block eligibility", async () => {
    arrangeEligible();
    // The finding row this module reads carries no diagnosis field at all.
    const result = await resolveRegressionEligibility(FINDING_ID);
    expect(result.kind).toBe("ELIGIBLE");
  });

  it("5: NULL recommendation fields do not block eligibility", async () => {
    arrangeEligible();
    const result = await resolveRegressionEligibility(FINDING_ID);
    expect(result.kind).toBe("ELIGIBLE");
  });

  it("6: an empty or misleading title changes nothing", async () => {
    arrangeEligible({ title: "" });
    expect((await resolveRegressionEligibility(FINDING_ID)).kind).toBe(
      "ELIGIBLE",
    );

    vi.resetAllMocks();
    arrangeEligible({ title: "INV-999 — not a real invariant" });
    expect((await resolveRegressionEligibility(FINDING_ID)).kind).toBe(
      "ELIGIBLE",
    );
  });

  it("7: the eligible result exposes no prose field", async () => {
    arrangeEligible();
    const result = await resolveRegressionEligibility(FINDING_ID);
    if (result.kind !== "ELIGIBLE") throw new Error("expected ELIGIBLE");

    expect(Object.keys(result).sort()).toEqual([
      "findingId",
      "findingStatus",
      "kind",
      "originalChaosRunId",
      "originalInvariantId",
      "originalInvariantResultId",
      "requiredInvariantIds",
      "scenarioId",
    ]);
  });
});

// ============================================================================
// STRUCTURAL RESOLUTION
// ============================================================================

describe("Phase 4E-R1 eligibility — structural resolution", () => {
  it("8: the trace runs finding -> invariant result -> chaos run", async () => {
    arrangeEligible();
    await resolveRegressionEligibility(FINDING_ID);

    expect(findFindingById).toHaveBeenCalledWith(FINDING_ID);
    expect(findInvariantResultById).toHaveBeenCalledWith(RESULT_ID);
    expect(chaosRunQueries[0]!.table).toBe("chaos_runs");
    expect(chaosRunQueries[0]!.eq).toEqual({ id: RUN_ID });
    expect(chaosRunQueries[0]!.projection).not.toContain("*");
  });

  it("9: the required invariant set comes from the REAL frozen registry", async () => {
    arrangeEligible();
    const result = await resolveRegressionEligibility(FINDING_ID);
    if (result.kind !== "ELIGIBLE") throw new Error("expected ELIGIBLE");

    // C03's authoritative set, read from lib/chaos/registry.ts itself.
    const { getScenarioDefinition } = await import("@/lib/chaos/registry");
    expect([...result.requiredInvariantIds]).toEqual([
      ...getScenarioDefinition("C03")!.requiredInvariants,
    ]);
    expect(result.scenarioId).toBe("C03");
    expect(result.originalInvariantId).toBe("INV-005");
    expect(result.originalChaosRunId).toBe(RUN_ID);
    expect(result.originalInvariantResultId).toBe(RESULT_ID);
  });

  it("10: a C01 finding gets C01's set, not C03's", async () => {
    findFindingById.mockResolvedValue(finding());
    findInvariantResultById.mockResolvedValue(
      invariantResult({ invariant_id: "INV-002" }),
    );
    chaosRun("C01");
    findActiveRegressionForFinding.mockResolvedValue(null);

    const result = await resolveRegressionEligibility(FINDING_ID);
    if (result.kind !== "ELIGIBLE") throw new Error("expected ELIGIBLE");

    const { getScenarioDefinition } = await import("@/lib/chaos/registry");
    expect([...result.requiredInvariantIds]).toEqual([
      ...getScenarioDefinition("C01")!.requiredInvariants,
    ]);
  });
});

// ============================================================================
// INELIGIBILITY
// ============================================================================

describe("Phase 4E-R1 eligibility — ineligibility", () => {
  it("11: a missing finding is REGRESSION_FINDING_NOT_FOUND", async () => {
    findFindingById.mockResolvedValue(null);
    const result = await resolveRegressionEligibility(FINDING_ID);
    expect(result).toMatchObject({
      kind: "INELIGIBLE",
      code: "REGRESSION_FINDING_NOT_FOUND",
      findingId: null,
    });
  });

  it("12: a baseline result with NULL chaos_run_id has nothing to rerun", async () => {
    findFindingById.mockResolvedValue(finding());
    findInvariantResultById.mockResolvedValue(
      invariantResult({ chaos_run_id: null }),
    );
    const result = await resolveRegressionEligibility(FINDING_ID);
    expect(result).toMatchObject({
      kind: "INELIGIBLE",
      code: "REGRESSION_NO_ORIGINAL_CHAOS_RUN",
      findingId: FINDING_ID,
    });
    // It never reached for a chaos run it knew did not exist.
    expect(chaosRunQueries).toHaveLength(0);
  });

  it("13: a missing original chaos run is reported distinctly", async () => {
    findFindingById.mockResolvedValue(finding());
    findInvariantResultById.mockResolvedValue(invariantResult());
    chaosRunResponse.value = { data: null, error: null };
    const result = await resolveRegressionEligibility(FINDING_ID);
    expect(result).toMatchObject({
      code: "REGRESSION_ORIGINAL_CHAOS_RUN_NOT_FOUND",
    });
  });

  it("14: an unregistered scenario cannot be rerun", async () => {
    findFindingById.mockResolvedValue(finding());
    findInvariantResultById.mockResolvedValue(invariantResult());
    chaosRun("C99");
    const result = await resolveRegressionEligibility(FINDING_ID);
    expect(result).toMatchObject({
      code: "REGRESSION_SCENARIO_NOT_REGISTERED",
    });
  });

  it("15: an invariant outside the scenario's required set is reported", async () => {
    // INV-008 is a real catalogue invariant, but C03 requires INV-004/INV-005,
    // so rerunning C03 could not re-test it.
    findFindingById.mockResolvedValue(finding());
    findInvariantResultById.mockResolvedValue(
      invariantResult({ invariant_id: "INV-008" }),
    );
    chaosRun("C03");
    findActiveRegressionForFinding.mockResolvedValue(null);

    const result = await resolveRegressionEligibility(FINDING_ID);
    expect(result).toMatchObject({
      code: "REGRESSION_ORIGINAL_INVARIANT_NOT_REQUIRED",
    });
  });

  it("16: a PENDING regression blocks a new one", async () => {
    arrangeEligible();
    findActiveRegressionForFinding.mockResolvedValue({
      id: "r1",
      status: "PENDING",
    });
    const result = await resolveRegressionEligibility(FINDING_ID);
    expect(result).toMatchObject({ code: "REGRESSION_ACTIVE_RUN_EXISTS" });
  });

  it("17: a RUNNING regression blocks a new one", async () => {
    arrangeEligible();
    findActiveRegressionForFinding.mockResolvedValue({
      id: "r1",
      status: "RUNNING",
    });
    const result = await resolveRegressionEligibility(FINDING_ID);
    expect(result).toMatchObject({ code: "REGRESSION_ACTIVE_RUN_EXISTS" });
  });

  it("18: terminal regression history does NOT block", async () => {
    // The active lookup is what decides; a finding with a long history of
    // finished regressions is freely re-testable.
    arrangeEligible();
    findActiveRegressionForFinding.mockResolvedValue(null);
    const result = await resolveRegressionEligibility(FINDING_ID);
    expect(result.kind).toBe("ELIGIBLE");
  });

  it("19: no ineligibility reason leaks a database message", async () => {
    findFindingById.mockResolvedValue(null);
    const result = await resolveRegressionEligibility(FINDING_ID);
    if (result.kind !== "INELIGIBLE") throw new Error("expected INELIGIBLE");
    expect(result.reason).not.toContain("select");
    expect(result.reason).not.toContain("PGRST");
    expect(result.reason.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// INFRASTRUCTURE FAULTS ARE NOT VERDICTS
// ============================================================================

describe("Phase 4E-R1 eligibility — infrastructure faults", () => {
  it("20: a malformed id is an error, never an INELIGIBLE verdict", async () => {
    await expect(
      resolveRegressionEligibility("not-a-uuid"),
    ).rejects.toBeInstanceOf(RegressionEligibilityError);
    await expect(
      resolveRegressionEligibility("not-a-uuid"),
    ).rejects.toMatchObject({
      code: "REGRESSION_ELIGIBILITY_FINDING_ID_INVALID",
    });
    expect(findFindingById).not.toHaveBeenCalled();
  });

  it("21: a failed finding read is an error, not 'not found'", async () => {
    findFindingById.mockRejectedValue(new Error("read failed"));
    await expect(
      resolveRegressionEligibility(FINDING_ID),
    ).rejects.toMatchObject({ code: "REGRESSION_ELIGIBILITY_READ_FAILED" });
  });

  it("22: a failed chaos run read is an error, not 'run not found'", async () => {
    findFindingById.mockResolvedValue(finding());
    findInvariantResultById.mockResolvedValue(invariantResult());
    chaosRunResponse.value = {
      data: null,
      error: { code: "500", message: "boom" },
    };
    await expect(
      resolveRegressionEligibility(FINDING_ID),
    ).rejects.toMatchObject({ code: "REGRESSION_ELIGIBILITY_READ_FAILED" });
  });

  it("23: a failed active-regression read is an error, not 'no active run'", async () => {
    arrangeEligible();
    const { RegressionRepositoryError } =
      await import("@/lib/regression/repository");
    findActiveRegressionForFinding.mockRejectedValue(
      new RegressionRepositoryError("REGRESSION_READ_FAILED", "safe"),
    );
    await expect(
      resolveRegressionEligibility(FINDING_ID),
    ).rejects.toMatchObject({ code: "REGRESSION_ELIGIBILITY_READ_FAILED" });
  });
});
