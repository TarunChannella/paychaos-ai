import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  deterministicFindingTitle,
  FindingRepositoryError,
  isReusableFinding,
} from "@/lib/findings/repository";
import { isUuid } from "@/lib/findings/types";
import { listInvariantDefinitions } from "@/lib/invariants/registry";
import type { FindingRow } from "@/lib/findings/types";

/**
 * Phase 3G — the PURE half of the repository: title derivation, reuse
 * equivalence and identifier validation. No client, no I/O.
 */

const RESULT_ID = "11111111-1111-4111-8111-111111111111";

function finding(overrides: Partial<FindingRow> = {}): FindingRow {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    invariantResultId: RESULT_ID,
    status: "OPEN",
    title: "INV-003 — Failed Payment Never Marks Order Paid",
    createdAt: "2026-08-20T10:00:00.000Z",
    updatedAt: "2026-08-20T10:00:00.000Z",
    ...overrides,
  };
}

describe("deterministicFindingTitle", () => {
  it("1: renders the documented shape for a known invariant", () => {
    expect(deterministicFindingTitle("INV-003", "1")).toBe(
      "INV-003 — Failed Payment Never Marks Order Paid",
    );
  });

  it("2: every catalogued invariant produces a title from its OWN frozen name", () => {
    for (const definition of listInvariantDefinitions()) {
      const title = deterministicFindingTitle(
        definition.invariantId,
        definition.version,
      );
      expect(title).toBe(`${definition.invariantId} — ${definition.name}`);
      expect(title.startsWith(`${definition.invariantId} — `)).toBe(true);
    }
  });

  it("3: all twelve titles are distinct — no two invariants collide", () => {
    const titles = listInvariantDefinitions().map((d) =>
      deterministicFindingTitle(d.invariantId, d.version),
    );
    expect(titles).toHaveLength(12);
    expect(new Set(titles).size).toBe(12);
  });

  it("4: it is deterministic — repeated calls are byte-identical", () => {
    const first = deterministicFindingTitle("INV-005", "1");
    for (let i = 0; i < 25; i += 1) {
      expect(deterministicFindingTitle("INV-005", "1")).toBe(first);
    }
  });

  it("5: no title carries a timestamp, UUID, counter or run-specific text", () => {
    for (const definition of listInvariantDefinitions()) {
      const title = deterministicFindingTitle(
        definition.invariantId,
        definition.version,
      );
      expect(title).not.toMatch(/\d{4}-\d{2}-\d{2}/);
      expect(title).not.toMatch(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
      );
      expect(title.toLowerCase()).not.toContain("chaos run");
      expect(title.toLowerCase()).not.toContain("razorpay");
    }
  });

  it("6: an uncatalogued invariant ID is an integrity error, never a guess", () => {
    for (const unknown of ["INV-013", "INV-000", "inv-003", "", "INV-3"]) {
      let thrown: unknown;
      try {
        deterministicFindingTitle(unknown, "1");
      } catch (error) {
        thrown = error;
      }
      expect(thrown, unknown).toBeInstanceOf(FindingRepositoryError);
      expect((thrown as FindingRepositoryError).code).toBe(
        "FINDING_INVARIANT_UNKNOWN",
      );
    }
  });

  it("7: a version the catalogue no longer defines is an integrity error, not a rename", () => {
    let thrown: unknown;
    try {
      deterministicFindingTitle("INV-003", "2");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(FindingRepositoryError);
    expect((thrown as FindingRepositoryError).code).toBe(
      "FINDING_INVARIANT_VERSION_MISMATCH",
    );
  });

  it("8: thrown errors leak no raw database or catalogue internals", () => {
    for (const attempt of [
      () => deterministicFindingTitle("INV-013", "1"),
      () => deterministicFindingTitle("INV-003", "99"),
    ]) {
      let message = "";
      try {
        attempt();
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message.length).toBeGreaterThan(0);
      for (const forbidden of ["select", "insert", "pgrst", "constraint"]) {
        expect(message.toLowerCase()).not.toContain(forbidden);
      }
    }
  });
});

describe("isReusableFinding", () => {
  const title = "INV-003 — Failed Payment Never Marks Order Paid";

  it("9: an identical OPEN finding is reusable", () => {
    expect(isReusableFinding(finding(), RESULT_ID, title)).toBe(true);
  });

  it("10: a STILL_FAILING finding is STILL reusable — Phase 4 owns status", () => {
    expect(
      isReusableFinding(finding({ status: "STILL_FAILING" }), RESULT_ID, title),
    ).toBe(true);
  });

  it("11: a RESOLVED finding is STILL reusable and must never be reopened here", () => {
    expect(
      isReusableFinding(finding({ status: "RESOLVED" }), RESULT_ID, title),
    ).toBe(true);
  });

  it("12: a later updated_at does not break reuse — regeneration never rewrites it", () => {
    expect(
      isReusableFinding(
        finding({ updatedAt: "2027-01-01T00:00:00.000Z" }),
        RESULT_ID,
        title,
      ),
    ).toBe(true);
  });

  it("13: a contradictory title is NOT reusable", () => {
    expect(
      isReusableFinding(finding({ title: "something else" }), RESULT_ID, title),
    ).toBe(false);
  });

  it("14: a finding belonging to a different invariant result is NOT reusable", () => {
    expect(
      isReusableFinding(
        finding({ invariantResultId: "33333333-3333-4333-8333-333333333333" }),
        RESULT_ID,
        title,
      ),
    ).toBe(false);
  });
});

describe("isUuid", () => {
  it("15: accepts canonical UUIDs and rejects everything else", () => {
    expect(isUuid(RESULT_ID)).toBe(true);
    expect(isUuid("11111111-1111-4111-8111-111111111111".toUpperCase())).toBe(
      true,
    );
    for (const bad of [
      "",
      "not-a-uuid",
      "11111111111141118111111111111111",
      "11111111-1111-4111-8111-11111111111",
      "11111111-1111-4111-8111-1111111111111",
      " 11111111-1111-4111-8111-111111111111",
      null,
      undefined,
      42,
      {},
    ]) {
      expect(isUuid(bad), String(bad)).toBe(false);
    }
  });
});
