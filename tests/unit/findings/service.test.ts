import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const findInvariantResultById = vi.fn();
const listInvariantResultsForChaosRun = vi.fn();
const findFindingByInvariantResultId = vi.fn();
const insertOpenFinding = vi.fn();

vi.mock("@/lib/findings/repository", async () => {
  // The title derivation is PURE and registry-backed, so it is deliberately
  // NOT mocked: these tests must prove the real deterministic title, not a stub.
  const actual = await vi.importActual<
    typeof import("@/lib/findings/repository")
  >("@/lib/findings/repository");
  return {
    ...actual,
    findInvariantResultById: (...a: unknown[]) => findInvariantResultById(...a),
    listInvariantResultsForChaosRun: (...a: unknown[]) =>
      listInvariantResultsForChaosRun(...a),
    findFindingByInvariantResultId: (...a: unknown[]) =>
      findFindingByInvariantResultId(...a),
    insertOpenFinding: (...a: unknown[]) => insertOpenFinding(...a),
  };
});

import {
  createFindingFromInvariantResult,
  generateFindingsForChaosRun,
  getFindingDetailByInvariantResultId,
  FindingServiceError,
} from "@/lib/findings/service";

/**
 * Phase 3G — orchestration boundary tests.
 *
 * The repository's I/O is mocked because it is an INFRASTRUCTURE boundary.
 * The title derivation is NOT mocked, so the real frozen invariant registry
 * decides every title here — a test that stubbed it would prove only that the
 * plumbing runs.
 */

const RESULT_ID = "11111111-1111-4111-8111-111111111111";
const RESULT_ID_2 = "44444444-4444-4444-8444-444444444444";
const RESULT_ID_3 = "55555555-5555-4555-8555-555555555555";
const RUN_ID = "99999999-9999-4999-8999-999999999999";
const FINDING_ID = "22222222-2222-4222-8222-222222222222";

const INV_003_TITLE = "INV-003 — Failed Payment Never Marks Order Paid";

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
    expected_summary: "A failed payment must never mark the order paid.",
    observed_summary: "The order was observed PAID after payment.failed.",
    reason: "deterministic evaluator reason",
    evidence_refs: [{ kind: "CHAOS_RUN", id: RUN_ID }],
    evaluated_at: "2026-08-20T09:59:00.000Z",
    ...overrides,
  };
}

function finding(overrides: Record<string, unknown> = {}) {
  return {
    id: FINDING_ID,
    invariantResultId: RESULT_ID,
    status: "OPEN",
    title: INV_003_TITLE,
    createdAt: "2026-08-20T10:00:00.000Z",
    updatedAt: "2026-08-20T10:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  insertOpenFinding.mockResolvedValue({ kind: "INSERTED", finding: finding() });
});

describe("Phase 3G — finding authority", () => {
  it("1: a persisted FAIL creates exactly one OPEN finding", async () => {
    findInvariantResultById.mockResolvedValue(dbResult());

    const result = await createFindingFromInvariantResult(RESULT_ID);

    expect(result.kind).toBe("CREATED");
    expect(result.kind === "CREATED" && result.finding.status).toBe("OPEN");
    expect(insertOpenFinding).toHaveBeenCalledTimes(1);
    expect(insertOpenFinding).toHaveBeenCalledWith(RESULT_ID, INV_003_TITLE);
  });

  it("2: a persisted PASS creates nothing and returns NO_FINDING_REQUIRED", async () => {
    findInvariantResultById.mockResolvedValue(dbResult({ result: "PASS" }));

    const result = await createFindingFromInvariantResult(RESULT_ID);

    expect(result).toEqual({
      kind: "NO_FINDING_REQUIRED",
      invariantResultId: RESULT_ID,
      result: "PASS",
      reason: "RESULT_NOT_FAIL",
    });
    expect(insertOpenFinding).not.toHaveBeenCalled();
  });

  it("3: a persisted UNKNOWN creates nothing — insufficient evidence is NEVER a finding", async () => {
    findInvariantResultById.mockResolvedValue(dbResult({ result: "UNKNOWN" }));

    const result = await createFindingFromInvariantResult(RESULT_ID);

    expect(result.kind).toBe("NO_FINDING_REQUIRED");
    expect(result.kind === "NO_FINDING_REQUIRED" && result.result).toBe(
      "UNKNOWN",
    );
    expect(insertOpenFinding).not.toHaveBeenCalled();
  });

  it("4: neither PASS nor UNKNOWN throws — they are normal dispositions", async () => {
    for (const value of ["PASS", "UNKNOWN"]) {
      findInvariantResultById.mockResolvedValue(dbResult({ result: value }));
      await expect(
        createFindingFromInvariantResult(RESULT_ID),
      ).resolves.toMatchObject({ kind: "NO_FINDING_REQUIRED" });
    }
  });

  it("5: a missing invariant result is a safe typed error, and writes nothing", async () => {
    findInvariantResultById.mockResolvedValue(null);

    const failure = createFindingFromInvariantResult(RESULT_ID);
    await expect(failure).rejects.toBeInstanceOf(FindingServiceError);
    await expect(failure).rejects.toMatchObject({
      code: "FINDING_INVARIANT_RESULT_NOT_FOUND",
    });
    expect(insertOpenFinding).not.toHaveBeenCalled();
  });

  it("6: an invalid UUID is rejected before the database is touched", async () => {
    await expect(
      createFindingFromInvariantResult("not-a-uuid"),
    ).rejects.toMatchObject({ code: "FINDING_INVARIANT_RESULT_ID_INVALID" });
    expect(findInvariantResultById).not.toHaveBeenCalled();
    expect(insertOpenFinding).not.toHaveBeenCalled();
  });

  it("7: an uncatalogued invariant id is an integrity error, and writes nothing", async () => {
    findInvariantResultById.mockResolvedValue(
      dbResult({ invariant_id: "INV-013" }),
    );

    await expect(
      createFindingFromInvariantResult(RESULT_ID),
    ).rejects.toMatchObject({ code: "FINDING_INVARIANT_UNKNOWN" });
    expect(insertOpenFinding).not.toHaveBeenCalled();
  });

  it("8: an invariant version mismatch is an integrity error, and writes nothing", async () => {
    findInvariantResultById.mockResolvedValue(
      dbResult({ invariant_version: "2" }),
    );

    await expect(
      createFindingFromInvariantResult(RESULT_ID),
    ).rejects.toMatchObject({ code: "FINDING_INVARIANT_VERSION_MISMATCH" });
    expect(insertOpenFinding).not.toHaveBeenCalled();
  });

  it("9: the title is the exact deterministic registry value, per invariant", async () => {
    for (const [id, expected] of [
      ["INV-003", INV_003_TITLE],
      ["INV-005", "INV-005 — Invalid Webhook Signature Causes Zero Mutation"],
      ["INV-011", "INV-011 — Payment State Is Legal, Monotonic and Convergent"],
    ] as const) {
      insertOpenFinding.mockClear();
      findInvariantResultById.mockResolvedValue(dbResult({ invariant_id: id }));
      await createFindingFromInvariantResult(RESULT_ID);
      expect(insertOpenFinding).toHaveBeenCalledWith(RESULT_ID, expected);
    }
  });

  it("10: the public API accepts NOTHING but an identifier", () => {
    // A caller cannot assert a result, severity, title or evidence: there is
    // exactly one parameter, and it is a UUID.
    expect(createFindingFromInvariantResult).toHaveLength(1);
    expect(generateFindingsForChaosRun).toHaveLength(1);
    expect(getFindingDetailByInvariantResultId).toHaveLength(1);
  });

  it("11: no thrown error leaks raw internals", async () => {
    findInvariantResultById.mockResolvedValue(null);
    let message = "";
    try {
      await createFindingFromInvariantResult(RESULT_ID);
    } catch (error) {
      message = (error as Error).message;
    }
    for (const forbidden of [
      "select",
      "insert",
      "pgrst",
      "razorpay",
      "stack",
    ]) {
      expect(message.toLowerCase()).not.toContain(forbidden);
    }
  });
});

describe("Phase 3G — idempotency and forward compatibility", () => {
  it("12: an existing equivalent finding is reused, not recreated", async () => {
    findInvariantResultById.mockResolvedValue(dbResult());
    insertOpenFinding.mockResolvedValue({
      kind: "ALREADY_PRESENT",
      finding: finding(),
    });

    const result = await createFindingFromInvariantResult(RESULT_ID);

    expect(result.kind).toBe("ALREADY_PRESENT");
    expect(result.kind === "ALREADY_PRESENT" && result.finding.id).toBe(
      FINDING_ID,
    );
  });

  it("13: a STILL_FAILING finding is returned untouched", async () => {
    findInvariantResultById.mockResolvedValue(dbResult());
    insertOpenFinding.mockResolvedValue({
      kind: "ALREADY_PRESENT",
      finding: finding({ status: "STILL_FAILING" }),
    });

    const result = await createFindingFromInvariantResult(RESULT_ID);

    expect(result.kind === "ALREADY_PRESENT" && result.finding.status).toBe(
      "STILL_FAILING",
    );
  });

  it("14: a RESOLVED finding is returned untouched — regeneration never reopens it", async () => {
    findInvariantResultById.mockResolvedValue(dbResult());
    insertOpenFinding.mockResolvedValue({
      kind: "ALREADY_PRESENT",
      finding: finding({ status: "RESOLVED" }),
    });

    const result = await createFindingFromInvariantResult(RESULT_ID);

    expect(result.kind === "ALREADY_PRESENT" && result.finding.status).toBe(
      "RESOLVED",
    );
  });

  it("15: repeated generation is stable — same id, same createdAt, one insert call each", async () => {
    findInvariantResultById.mockResolvedValue(dbResult());
    insertOpenFinding.mockResolvedValue({
      kind: "ALREADY_PRESENT",
      finding: finding(),
    });

    const first = await createFindingFromInvariantResult(RESULT_ID);
    const second = await createFindingFromInvariantResult(RESULT_ID);

    expect(first).toEqual(second);
  });

  it("16: a contradictory pre-existing finding surfaces the repository's integrity conflict", async () => {
    findInvariantResultById.mockResolvedValue(dbResult());
    insertOpenFinding.mockRejectedValue(
      Object.assign(new Error("conflict"), {
        code: "FINDING_INTEGRITY_CONFLICT",
      }),
    );

    await expect(
      createFindingFromInvariantResult(RESULT_ID),
    ).rejects.toMatchObject({ code: "FINDING_INTEGRITY_CONFLICT" });
  });
});

describe("Phase 3G — run-level generation", () => {
  it("17: a run with zero persisted results yields zero findings, no error", async () => {
    listInvariantResultsForChaosRun.mockResolvedValue([]);

    const summary = await generateFindingsForChaosRun(RUN_ID);

    expect(summary).toEqual({
      chaosRunId: RUN_ID,
      evaluatedResultCount: 0,
      failedResultCount: 0,
      findings: [],
      skipped: [],
    });
    expect(insertOpenFinding).not.toHaveBeenCalled();
  });

  it("18: PASS-only and UNKNOWN-only runs create nothing", async () => {
    for (const value of ["PASS", "UNKNOWN"]) {
      vi.clearAllMocks();
      listInvariantResultsForChaosRun.mockResolvedValue([
        dbResult({ result: value }),
      ]);

      const summary = await generateFindingsForChaosRun(RUN_ID);

      expect(summary.findings).toHaveLength(0);
      expect(summary.failedResultCount).toBe(0);
      expect(summary.skipped).toHaveLength(1);
      expect(insertOpenFinding).not.toHaveBeenCalled();
    }
  });

  it("19: one FAIL produces exactly one finding", async () => {
    listInvariantResultsForChaosRun.mockResolvedValue([dbResult()]);
    findInvariantResultById.mockResolvedValue(dbResult());

    const summary = await generateFindingsForChaosRun(RUN_ID);

    expect(summary.evaluatedResultCount).toBe(1);
    expect(summary.failedResultCount).toBe(1);
    expect(summary.findings).toHaveLength(1);
    expect(summary.findings[0]!.kind).toBe("CREATED");
    expect(summary.findings[0]!.invariantId).toBe("INV-003");
  });

  it("20: multiple FAILs produce one finding per invariant result", async () => {
    const rows = [
      dbResult({ id: RESULT_ID, invariant_id: "INV-003" }),
      dbResult({ id: RESULT_ID_2, invariant_id: "INV-004" }),
      dbResult({ id: RESULT_ID_3, invariant_id: "INV-011" }),
    ];
    listInvariantResultsForChaosRun.mockResolvedValue(rows);
    findInvariantResultById.mockImplementation(async (id: string) =>
      rows.find((r) => r.id === id),
    );
    insertOpenFinding.mockImplementation(async (id: string) => ({
      kind: "INSERTED",
      finding: finding({ id: `finding-${id}`, invariantResultId: id }),
    }));

    const summary = await generateFindingsForChaosRun(RUN_ID);

    expect(summary.failedResultCount).toBe(3);
    expect(summary.findings).toHaveLength(3);
    expect(new Set(summary.findings.map((f) => f.findingId)).size).toBe(3);
    expect(summary.findings.map((f) => f.invariantResultId)).toEqual([
      RESULT_ID,
      RESULT_ID_2,
      RESULT_ID_3,
    ]);
  });

  it("21: a mixed run produces findings for FAIL only", async () => {
    const rows = [
      dbResult({ id: RESULT_ID, invariant_id: "INV-003", result: "FAIL" }),
      dbResult({ id: RESULT_ID_2, invariant_id: "INV-004", result: "PASS" }),
      dbResult({ id: RESULT_ID_3, invariant_id: "INV-011", result: "UNKNOWN" }),
    ];
    listInvariantResultsForChaosRun.mockResolvedValue(rows);
    findInvariantResultById.mockImplementation(async (id: string) =>
      rows.find((r) => r.id === id),
    );

    const summary = await generateFindingsForChaosRun(RUN_ID);

    expect(summary.evaluatedResultCount).toBe(3);
    expect(summary.failedResultCount).toBe(1);
    expect(summary.findings).toHaveLength(1);
    expect(summary.findings[0]!.invariantResultId).toBe(RESULT_ID);
    expect(summary.skipped.map((s) => s.result).sort()).toEqual([
      "PASS",
      "UNKNOWN",
    ]);
    expect(insertOpenFinding).toHaveBeenCalledTimes(1);
  });

  it("22: rerunning the generator returns the same finding ids and creates no duplicate", async () => {
    listInvariantResultsForChaosRun.mockResolvedValue([dbResult()]);
    findInvariantResultById.mockResolvedValue(dbResult());
    insertOpenFinding.mockResolvedValue({
      kind: "ALREADY_PRESENT",
      finding: finding(),
    });

    const first = await generateFindingsForChaosRun(RUN_ID);
    const second = await generateFindingsForChaosRun(RUN_ID);

    expect(first.findings.map((f) => f.findingId)).toEqual(
      second.findings.map((f) => f.findingId),
    );
    expect(second.findings[0]!.kind).toBe("ALREADY_PRESENT");
  });

  it("23: an invalid chaos run id is rejected before any read", async () => {
    await expect(generateFindingsForChaosRun("nope")).rejects.toMatchObject({
      code: "FINDING_CHAOS_RUN_ID_INVALID",
    });
    expect(listInvariantResultsForChaosRun).not.toHaveBeenCalled();
  });

  it("24: results are consumed in the repository's deterministic order", async () => {
    const rows = [
      dbResult({ id: RESULT_ID, invariant_id: "INV-003" }),
      dbResult({ id: RESULT_ID_2, invariant_id: "INV-004" }),
    ];
    listInvariantResultsForChaosRun.mockResolvedValue(rows);
    findInvariantResultById.mockImplementation(async (id: string) =>
      rows.find((r) => r.id === id),
    );
    insertOpenFinding.mockImplementation(async (id: string) => ({
      kind: "INSERTED",
      finding: finding({ id: `finding-${id}`, invariantResultId: id }),
    }));

    const summary = await generateFindingsForChaosRun(RUN_ID);

    expect(summary.findings.map((f) => f.invariantId)).toEqual([
      "INV-003",
      "INV-004",
    ]);
  });
});

describe("Phase 3G — Finding Detail read model", () => {
  beforeEach(() => {
    findFindingByInvariantResultId.mockResolvedValue(finding());
    findInvariantResultById.mockResolvedValue(dbResult());
  });

  it("25: it returns the finding's own persisted identity and status", async () => {
    const detail = await getFindingDetailByInvariantResultId(RESULT_ID);

    expect(detail.findingId).toBe(FINDING_ID);
    expect(detail.invariantResultId).toBe(RESULT_ID);
    expect(detail.status).toBe("OPEN");
    expect(detail.title).toBe(INV_003_TITLE);
    expect(detail.createdAt).toBe("2026-08-20T10:00:00.000Z");
    expect(detail.updatedAt).toBe("2026-08-20T10:00:00.000Z");
  });

  it("26: every invariant fact comes from the LINKED result, not a copy", async () => {
    const linked = dbResult({
      severity: "HIGH",
      expected_summary: "linked expected",
      observed_summary: "linked observed",
      reason: "linked reason",
      evaluated_at: "2026-08-21T00:00:00.000Z",
    });
    findInvariantResultById.mockResolvedValue(linked);

    const detail = await getFindingDetailByInvariantResultId(RESULT_ID);

    expect(detail.invariant.invariantId).toBe("INV-003");
    expect(detail.invariant.invariantVersion).toBe("1");
    expect(detail.invariant.severity).toBe("HIGH");
    expect(detail.invariant.expectedSummary).toBe("linked expected");
    expect(detail.invariant.observedSummary).toBe("linked observed");
    expect(detail.invariant.reason).toBe("linked reason");
    expect(detail.invariant.evaluatedAt).toBe("2026-08-21T00:00:00.000Z");
  });

  it("27: evidence refs are surfaced as references, never as copied evidence", async () => {
    const detail = await getFindingDetailByInvariantResultId(RESULT_ID);

    expect(detail.invariant.evidenceRefs).toEqual([
      { kind: "CHAOS_RUN", id: RUN_ID },
    ]);
    for (const ref of detail.invariant.evidenceRefs) {
      expect(Object.keys(ref).sort()).toEqual(["id", "kind"]);
    }
  });

  it("28: all four correlations are surfaced, including truthful NULLs", async () => {
    const detail = await getFindingDetailByInvariantResultId(RESULT_ID);

    expect(detail.correlations).toEqual({
      chaosRunId: RUN_ID,
      orderId: null,
      paymentAttemptId: null,
      paymentId: null,
    });
  });

  it("29: a populated merchant correlation set is surfaced verbatim", async () => {
    findInvariantResultById.mockResolvedValue(
      dbResult({
        order_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
        payment_attempt_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
        payment_id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc3",
      }),
    );

    const detail = await getFindingDetailByInvariantResultId(RESULT_ID);

    expect(detail.correlations.orderId).toBe(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
    );
    expect(detail.correlations.paymentId).toBe(
      "cccccccc-cccc-4ccc-8ccc-ccccccccccc3",
    );
  });

  it("30: it exposes NO diagnosis or recommendation surface", async () => {
    const detail = await getFindingDetailByInvariantResultId(RESULT_ID);
    const serialized = JSON.stringify(detail).toLowerCase();

    for (const forbidden of [
      "diagnosis",
      "recommendation",
      "diagnosed_at",
      "resolved_at",
      "confidence",
      "root_cause",
    ]) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
  });

  it("31: a missing finding is a safe typed error", async () => {
    findFindingByInvariantResultId.mockResolvedValue(null);

    await expect(
      getFindingDetailByInvariantResultId(RESULT_ID),
    ).rejects.toMatchObject({ code: "FINDING_NOT_FOUND" });
  });

  it("32: a finding whose invariant result cannot be read never degrades to a partial object", async () => {
    findInvariantResultById.mockResolvedValue(null);

    await expect(
      getFindingDetailByInvariantResultId(RESULT_ID),
    ).rejects.toMatchObject({ code: "FINDING_INTEGRITY_CONFLICT" });
  });

  it("33: an invalid UUID is rejected before any read", async () => {
    await expect(
      getFindingDetailByInvariantResultId("nope"),
    ).rejects.toMatchObject({ code: "FINDING_INVARIANT_RESULT_ID_INVALID" });
    expect(findFindingByInvariantResultId).not.toHaveBeenCalled();
  });
});
