import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  canonicalizeEvidenceRefs,
  isEquivalentPersistedResult,
  InvariantResultRepositoryError,
  type InvariantResultCandidate,
  type InvariantResultRow,
} from "@/lib/invariants/result-repository";

import { CAPTURE_WEBHOOK_ID, ORDER_ID, PAYMENT_ID, RUN_ID } from "./fixtures";

/**
 * Phase 3F-C — the append-only repository's PURE surface: candidate
 * canonicalization and deterministic content equality.
 *
 * These are the two decisions that make repeat evaluation idempotent rather
 * than duplicating or rewriting history, so they are tested directly instead
 * of only through a mocked client.
 */

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

const row: InvariantResultRow = {
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

describe("Phase 3F-C — evidence-reference canonicalization", () => {
  it("1: dedupes repeated references", () => {
    const refs = canonicalizeEvidenceRefs([
      { kind: "CHAOS_RUN", id: RUN_ID },
      { kind: "CHAOS_RUN", id: RUN_ID },
    ]);
    expect(refs).toEqual([{ kind: "CHAOS_RUN", id: RUN_ID }]);
  });

  it("2: sorts deterministically by frozen kind order, then UUID", () => {
    const shuffled = canonicalizeEvidenceRefs([
      { kind: "CHAOS_RUN", id: RUN_ID },
      { kind: "WEBHOOK_EVENT", id: CAPTURE_WEBHOOK_ID },
      { kind: "ORDER", id: ORDER_ID },
      { kind: "PAYMENT", id: PAYMENT_ID },
    ]);
    expect(shuffled.map((r) => r.kind)).toEqual([
      "ORDER",
      "PAYMENT",
      "WEBHOOK_EVENT",
      "CHAOS_RUN",
    ]);
  });

  it("3: input order never changes the canonical output", () => {
    const input = [
      { kind: "CHAOS_RUN" as const, id: RUN_ID },
      { kind: "ORDER" as const, id: ORDER_ID },
      { kind: "PAYMENT" as const, id: PAYMENT_ID },
    ];
    const forward = canonicalizeEvidenceRefs(input);
    const reversed = canonicalizeEvidenceRefs([...input].reverse());
    expect(JSON.stringify(reversed)).toBe(JSON.stringify(forward));
  });

  it("4: rejects an unapproved evidence kind", () => {
    expect(() =>
      canonicalizeEvidenceRefs([
        { kind: "SOMETHING_ELSE" as never, id: RUN_ID },
      ]),
    ).toThrow(InvariantResultRepositoryError);
  });

  it("5: rejects a reference whose id is not an internal UUID", () => {
    expect(() =>
      canonicalizeEvidenceRefs([{ kind: "CHAOS_RUN", id: "pay_NOTAUUID" }]),
    ).toThrow(InvariantResultRepositoryError);
  });

  it("6: keeps only {kind, id} — no third field can survive", () => {
    const refs = canonicalizeEvidenceRefs([
      {
        kind: "CHAOS_RUN",
        id: RUN_ID,
        payload: "secret",
      } as unknown as { kind: "CHAOS_RUN"; id: string },
    ]);
    expect(Object.keys(refs[0]!).sort()).toEqual(["id", "kind"]);
  });
});

describe("Phase 3F-C — deterministic content equality", () => {
  it("7: an identical candidate is equivalent", () => {
    expect(isEquivalentPersistedResult(row, candidate)).toBe(true);
  });

  it("8: id is EXCLUDED — a different persisted id is still equivalent", () => {
    expect(
      isEquivalentPersistedResult(
        { ...row, id: "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb" },
        candidate,
      ),
    ).toBe(true);
  });

  it("9: evaluated_at is EXCLUDED — a different timestamp is still equivalent", () => {
    expect(
      isEquivalentPersistedResult(
        { ...row, evaluated_at: "2020-01-01T00:00:00.000Z" },
        candidate,
      ),
    ).toBe(true);
  });

  it("10: evidence refs supplied in a different order are still equivalent", () => {
    const twoRefs: InvariantResultCandidate = {
      ...candidate,
      evidenceRefs: [
        { kind: "ORDER", id: ORDER_ID },
        { kind: "CHAOS_RUN", id: RUN_ID },
      ],
    };
    const stored: InvariantResultRow = {
      ...row,
      evidence_refs: [
        { kind: "ORDER", id: ORDER_ID },
        { kind: "CHAOS_RUN", id: RUN_ID },
      ],
    };
    expect(isEquivalentPersistedResult(stored, twoRefs)).toBe(true);
  });

  it("11: duplicated candidate refs collapse to the stored canonical set", () => {
    const duplicated: InvariantResultCandidate = {
      ...candidate,
      evidenceRefs: [
        { kind: "CHAOS_RUN", id: RUN_ID },
        { kind: "CHAOS_RUN", id: RUN_ID },
      ],
    };
    expect(isEquivalentPersistedResult(row, duplicated)).toBe(true);
  });

  it.each([
    ["result", { result: "FAIL" as const }],
    ["severity", { severity: "HIGH" as const }],
    ["invariant_version", { invariant_version: "2" }],
    ["expected_summary", { expected_summary: "different" }],
    ["observed_summary", { observed_summary: "different" }],
    ["reason", { reason: "different" }],
    ["order_id", { order_id: ORDER_ID }],
    ["payment_attempt_id", { payment_attempt_id: ORDER_ID }],
    ["payment_id", { payment_id: PAYMENT_ID }],
    ["chaos_run_id", { chaos_run_id: CAPTURE_WEBHOOK_ID }],
    ["invariant_id", { invariant_id: "INV-004" as const }],
  ])("12: a different %s makes the row NOT equivalent", (_field, patch) => {
    expect(isEquivalentPersistedResult({ ...row, ...patch }, candidate)).toBe(
      false,
    );
  });

  it("13: a different evidence-ref set is NOT equivalent", () => {
    expect(
      isEquivalentPersistedResult(
        { ...row, evidence_refs: [{ kind: "ORDER", id: ORDER_ID }] },
        candidate,
      ),
    ).toBe(false);
  });

  it("14: a missing evidence-ref array is NOT equivalent to a populated candidate", () => {
    expect(
      isEquivalentPersistedResult({ ...row, evidence_refs: [] }, candidate),
    ).toBe(false);
  });
});
