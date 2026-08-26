import { describe, expect, it, vi } from "vitest";

// Phase 3A — the registry is now server-authoritative (architect correction,
// Finding 5): it imports `server-only`, which throws when `window` exists
// (this project's Vitest unit environment is `jsdom`), so it must be mocked
// here exactly like every other server-only module's own test file.
vi.mock("server-only", () => ({}));

import {
  P0_SCENARIO_IDS,
  getScenarioDefinition,
  isRegisteredScenarioId,
  listScenarioDefinitions,
} from "@/lib/chaos/registry";
import type { ChaosScenarioDefinition, InvariantId } from "@/lib/chaos/types";

const EXPECTED_INVARIANTS: Record<string, readonly InvariantId[]> = {
  C01: ["INV-001", "INV-002", "INV-006", "INV-007"],
  C03: ["INV-004", "INV-005"],
  C07: ["INV-002", "INV-004", "INV-011"],
  C11: ["INV-003", "INV-004", "INV-011"],
};

describe("Chaos Scenario Registry — P0 scope", () => {
  it("registers exactly C01, C03, C07, C11 — no more, no fewer", () => {
    expect([...P0_SCENARIO_IDS].sort()).toEqual(["C01", "C03", "C07", "C11"]);
    expect(
      listScenarioDefinitions()
        .map((d) => d.scenarioId)
        .sort(),
    ).toEqual(["C01", "C03", "C07", "C11"]);
  });

  it("every registered scenario is enabled and P0", () => {
    for (const def of listScenarioDefinitions()) {
      expect(def.enabled).toBe(true);
      expect(def.priority).toBe("P0");
    }
  });

  it.each([
    "C02",
    "C04",
    "C05",
    "C06",
    "C08",
    "C09",
    "C10",
    "C12",
    "C13",
    "C14",
    "C15",
  ])("rejects unknown/P1 scenario id %s as unregistered", (id) => {
    expect(isRegisteredScenarioId(id)).toBe(false);
    expect(getScenarioDefinition(id as never)).toBeUndefined();
  });

  it("rejects non-string / malformed scenario id values", () => {
    expect(isRegisteredScenarioId(undefined)).toBe(false);
    expect(isRegisteredScenarioId(null)).toBe(false);
    expect(isRegisteredScenarioId(123)).toBe(false);
    expect(isRegisteredScenarioId({})).toBe(false);
    expect(isRegisteredScenarioId("")).toBe(false);
    expect(isRegisteredScenarioId("c01")).toBe(false); // case-sensitive
  });

  it.each(["C01", "C03", "C07", "C11"] as const)(
    "%s declares the frozen mechanism mapping",
    (id) => {
      const def = getScenarioDefinition(id) as ChaosScenarioDefinition;
      switch (id) {
        case "C01":
          expect(def.allowedMechanisms).toEqual(["B"]);
          break;
        case "C03":
          expect(def.allowedMechanisms).toEqual(["C"]);
          break;
        case "C07":
          // Architect correction, Finding 2: C07 uses the fixed A+C
          // combination of the authoritative primary mechanisms, never an
          // invented fourth mechanism category.
          expect(def.allowedMechanisms).toEqual([["A", "C"]]);
          break;
        case "C11":
          expect(def.allowedMechanisms).toEqual(["A", "B"]);
          break;
      }
    },
  );

  it.each(["C01", "C03", "C07", "C11"] as const)(
    "%s declares exactly the frozen invariant mapping (docs/MONEY_INVARIANTS.md Section 14)",
    (id) => {
      const def = getScenarioDefinition(id) as ChaosScenarioDefinition;
      expect([...def.requiredInvariants]).toEqual(EXPECTED_INVARIANTS[id]);
    },
  );

  it("C01 allows only REPLAY_EVENT", () => {
    const def = getScenarioDefinition("C01") as ChaosScenarioDefinition;
    expect(def.allowedFaultTypes).toEqual(["REPLAY_EVENT"]);
  });

  it("C03 allows only INVALID_SIGNATURE_TEST", () => {
    const def = getScenarioDefinition("C03") as ChaosScenarioDefinition;
    expect(def.allowedFaultTypes).toEqual(["INVALID_SIGNATURE_TEST"]);
  });

  it("C07 allows only DROP_CLIENT_CONFIRMATION", () => {
    const def = getScenarioDefinition("C07") as ChaosScenarioDefinition;
    expect(def.allowedFaultTypes).toEqual(["DROP_CLIENT_CONFIRMATION"]);
  });

  it("C11 has NO unsafe fault primitive — allowedFaultTypes is empty", () => {
    const def = getScenarioDefinition("C11") as ChaosScenarioDefinition;
    expect(def.allowedFaultTypes).toEqual([]);
  });

  it("no scenario's allowedFaultTypes contains a P1 primitive", () => {
    const p1Primitives = [
      "REORDER_EVENTS",
      "SIMULATED_HANDLER_DEADLINE_EXCEEDED",
      "FAIL_HANDLER_ONCE",
      "BUGGY_IDEMPOTENCY_KEY",
      "FAIL_DATABASE_TRANSACTION",
      "REPLAY_STALE_EVENT",
      "UNKNOWN_EVENT_FIXTURE",
    ];
    for (const def of listScenarioDefinitions()) {
      for (const fault of def.allowedFaultTypes) {
        expect(p1Primitives).not.toContain(fault);
      }
    }
  });

  it("every scenario definition exposes exactly the 12 frozen registry fields", () => {
    const expectedKeys = [
      "scenarioId",
      "name",
      "priority",
      "enabled",
      "allowedMechanisms",
      "requiredSourceEventTypes",
      "allowedFaultTypes",
      "requiredInvariants",
      "defaultFailureSeverity",
      "requiresRealPayment",
      "requiresVerifiedWebhook",
      "requiresReset",
    ];
    for (const def of listScenarioDefinitions()) {
      expect(Object.keys(def).sort()).toEqual([...expectedKeys].sort());
    }
  });

  it("definitions are deterministic/stable across repeated calls (same object identity per id)", () => {
    const first = getScenarioDefinition("C01");
    const second = getScenarioDefinition("C01");
    expect(first).toBe(second);
    expect(first).toEqual(second);
  });

  it("C01 default failure severity is Critical", () => {
    expect(getScenarioDefinition("C01")?.defaultFailureSeverity).toBe(
      "Critical",
    );
  });

  it("C03 default failure severity is Critical", () => {
    expect(getScenarioDefinition("C03")?.defaultFailureSeverity).toBe(
      "Critical",
    );
  });

  it("C07 default failure severity is High", () => {
    expect(getScenarioDefinition("C07")?.defaultFailureSeverity).toBe("High");
  });

  it("C11 default failure severity is Critical", () => {
    expect(getScenarioDefinition("C11")?.defaultFailureSeverity).toBe(
      "Critical",
    );
  });

  it("no scenario's allowedMechanisms contains an invented fourth mechanism category (architect correction, Finding 2)", () => {
    for (const def of listScenarioDefinitions()) {
      for (const m of def.allowedMechanisms) {
        if (Array.isArray(m)) {
          expect(m).toEqual(["A", "C"]);
        } else {
          expect(["A", "B", "C"]).toContain(m);
        }
      }
    }
  });

  it.each([
    ["C01", true, true],
    ["C03", false, false],
    ["C07", true, true],
    ["C11", true, false],
  ] as const)(
    "%s declares the frozen requiresVerifiedWebhook/requiresReset metadata (architect correction, Finding 4)",
    (id, requiresVerifiedWebhook, requiresReset) => {
      const def = getScenarioDefinition(id) as ChaosScenarioDefinition;
      expect(def.requiresVerifiedWebhook).toBe(requiresVerifiedWebhook);
      expect(def.requiresReset).toBe(requiresReset);
    },
  );
});

describe("Chaos Scenario Registry — server-authoritative boundary (architect correction, Finding 5)", () => {
  it("imports the server-only marker package, so a client-bundle import fails at build time", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(
      path.resolve(import.meta.dirname, "../../../lib/chaos/registry.ts"),
      "utf-8",
    );
    expect(source).toMatch(/import\s+["']server-only["']/);
  });
});
