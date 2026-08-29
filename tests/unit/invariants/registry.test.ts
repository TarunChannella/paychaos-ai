import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Both `lib/invariants/registry.ts` and `lib/chaos/registry.ts` import
// `server-only`, which throws when `window` exists (this project's Vitest
// unit environment is `jsdom`), so it is mocked here exactly as every other
// server-only module's own test file does.
vi.mock("server-only", () => ({}));

import {
  getInvariantDefinition,
  listInvariantDefinitions,
  P0_INVARIANT_IDS,
} from "@/lib/invariants/registry";
import {
  INVARIANT_EVIDENCE_KINDS,
  isInvariantSeverity,
  isMoneyInvariantId,
  MONEY_INVARIANT_IDS,
  type MoneyInvariantId,
} from "@/lib/invariants/types";
import { listScenarioDefinitions } from "@/lib/chaos/registry";

/**
 * Phase 3F-A — the frozen P0 invariant catalogue.
 *
 * Asserts catalogue CONTENT and IMMUTABILITY only. Phase 3F-A ships no
 * evaluator, so nothing here evaluates an invariant or asserts a
 * PASS/FAIL/UNKNOWN for any evidence.
 */

const repoRoot = path.resolve(import.meta.dirname, "../../../");

/**
 * Transcribed from docs/MONEY_INVARIANTS.md Section 14 (the P0 set table)
 * and each invariant's own Section 2/3/11. Written out literally rather than
 * derived from the registry, so a typo in the registry cannot make this test
 * agree with itself.
 */
const EXPECTED: ReadonlyArray<{
  id: MoneyInvariantId;
  name: string;
  severity: string;
  remediation: readonly string[];
}> = [
  {
    id: "INV-001",
    name: "Unique Webhook Protected Logic Once",
    severity: "CRITICAL",
    remediation: ["FIX-IDEMPOTENCY", "FIX-BUSINESS-IDEMPOTENCY"],
  },
  {
    id: "INV-002",
    name: "One Captured Payment, At Most One Fulfilment",
    severity: "CRITICAL",
    remediation: ["FIX-BUSINESS-IDEMPOTENCY"],
  },
  {
    id: "INV-003",
    name: "Failed Payment Never Marks Order Paid",
    severity: "CRITICAL",
    remediation: ["FIX-PAYMENT-FAILURE-GUARD", "FIX-STATE-MACHINE"],
  },
  {
    id: "INV-004",
    name: "Fulfilment Requires Verified Successful Payment",
    severity: "CRITICAL",
    remediation: [
      "FIX-PAYMENT-FAILURE-GUARD",
      "FIX-WEBHOOK-AUTH",
      "FIX-STATE-MACHINE",
    ],
  },
  {
    id: "INV-005",
    name: "Invalid Webhook Signature Causes Zero Mutation",
    severity: "CRITICAL",
    remediation: ["FIX-WEBHOOK-AUTH"],
  },
  {
    id: "INV-006",
    name: "Processed Event Replay Preserves Final Business State",
    severity: "CRITICAL",
    remediation: ["FIX-IDEMPOTENCY", "FIX-STATE-MACHINE"],
  },
  {
    id: "INV-007",
    name: "Duplicate Delivery Creates No Duplicate Business Record",
    severity: "CRITICAL",
    remediation: ["FIX-BUSINESS-IDEMPOTENCY"],
  },
  {
    id: "INV-008",
    name: "Order / Attempt / Payment Amount and Currency Consistency",
    severity: "CRITICAL",
    remediation: ["FIX-STATE-MACHINE"],
  },
  {
    id: "INV-009",
    name: "Failed Processing Is Atomic or Safely Retryable",
    severity: "CRITICAL",
    remediation: ["FIX-TRANSACTION-ATOMICITY", "FIX-RETRY-HANDLING"],
  },
  {
    id: "INV-010",
    name: "Fulfilment Has Exactly One Valid Payment Path",
    severity: "CRITICAL",
    remediation: ["FIX-TRANSACTION-ATOMICITY", "FIX-STATE-MACHINE"],
  },
  {
    id: "INV-011",
    name: "Payment State Is Legal, Monotonic and Convergent",
    severity: "CRITICAL",
    remediation: [
      "FIX-STATE-MACHINE",
      "FIX-RECONCILIATION",
      "FIX-CLIENT-INDEPENDENCE",
    ],
  },
  {
    id: "INV-012",
    name: "Unsupported Event Causes No Business Effect",
    severity: "HIGH",
    remediation: ["FIX-UNSUPPORTED-EVENT-GUARD"],
  },
];

describe("Phase 3F-A — the catalogue contains all twelve P0 invariants and only those", () => {
  it("1: exposes exactly twelve entries, in catalogue order", () => {
    const definitions = listInvariantDefinitions();
    expect(definitions).toHaveLength(12);
    expect(definitions.map((d) => d.invariantId)).toEqual([
      ...MONEY_INVARIANT_IDS,
    ]);
    expect(P0_INVARIANT_IDS).toEqual([...MONEY_INVARIANT_IDS]);
  });

  it("2: every entry is looked up by its own ID and is self-consistent", () => {
    for (const id of MONEY_INVARIANT_IDS) {
      const definition = getInvariantDefinition(id);
      expect(definition).toBeDefined();
      expect(definition!.invariantId).toBe(id);
    }
  });

  it("3: contains no P1 invariant — INV-013 and INV-014 are absent", () => {
    const ids = listInvariantDefinitions().map((d) => d.invariantId);
    expect(ids).not.toContain("INV-013");
    expect(ids).not.toContain("INV-014");
    for (const definition of listInvariantDefinitions()) {
      expect(definition.priority).toBe("P0");
    }
  });
});

describe("Phase 3F-A — catalogue values match docs/MONEY_INVARIANTS.md", () => {
  it("4: name, severity and remediation categories are exact for all twelve", () => {
    for (const expected of EXPECTED) {
      const definition = getInvariantDefinition(expected.id);
      expect(definition).toBeDefined();
      expect(definition!.name).toBe(expected.name);
      expect(definition!.defaultSeverity).toBe(expected.severity);
      expect([...definition!.remediationCategories]).toEqual([
        ...expected.remediation,
      ]);
    }
  });

  it("5: INV-012 is the only non-CRITICAL entry (docs/MONEY_INVARIANTS.md Section 27 Section 11 records High)", () => {
    const nonCritical = listInvariantDefinitions().filter(
      (d) => d.defaultSeverity !== "CRITICAL",
    );
    expect(nonCritical.map((d) => d.invariantId)).toEqual(["INV-012"]);
    expect(getInvariantDefinition("INV-012")!.defaultSeverity).toBe("HIGH");
  });

  it("6: every severity is a valid persisted severity — no title-case or INFO leakage from the frozen chaos FailureSeverity vocabulary", () => {
    for (const definition of listInvariantDefinitions()) {
      expect(isInvariantSeverity(definition.defaultSeverity)).toBe(true);
    }
  });

  it("7: every version is the P0 baseline '1' (docs/MONEY_INVARIANTS.md Section 48)", () => {
    for (const definition of listInvariantDefinitions()) {
      expect(definition.version).toBe("1");
    }
  });

  it("8: every requiredEvidence entry is an approved evidence kind, non-empty and duplicate-free", () => {
    for (const definition of listInvariantDefinitions()) {
      expect(definition.requiredEvidence.length).toBeGreaterThan(0);
      expect(new Set(definition.requiredEvidence).size).toBe(
        definition.requiredEvidence.length,
      );
      for (const kind of definition.requiredEvidence) {
        expect(INVARIANT_EVIDENCE_KINDS).toContain(kind);
      }
    }
  });

  it("9: every remediation category is a non-empty FIX-* code and every evaluatorKey is unique", () => {
    const evaluatorKeys = new Set<string>();
    for (const definition of listInvariantDefinitions()) {
      expect(definition.remediationCategories.length).toBeGreaterThan(0);
      for (const category of definition.remediationCategories) {
        expect(category).toMatch(/^FIX-[A-Z-]+$/);
      }
      expect(definition.description.length).toBeGreaterThan(0);
      expect(evaluatorKeys.has(definition.evaluatorKey)).toBe(false);
      evaluatorKeys.add(definition.evaluatorKey);
    }
    expect(evaluatorKeys.size).toBe(12);
  });
});

describe("Phase 3F-A — the catalogue is deterministic and immutable", () => {
  it("10: repeated reads return identical data", () => {
    expect(listInvariantDefinitions()).toEqual(listInvariantDefinitions());
  });

  it("11: every definition object and nested array is frozen", () => {
    for (const definition of listInvariantDefinitions()) {
      expect(Object.isFrozen(definition)).toBe(true);
      expect(Object.isFrozen(definition.requiredEvidence)).toBe(true);
      expect(Object.isFrozen(definition.remediationCategories)).toBe(true);
    }
  });

  it("12: an attempted mutation does not change the catalogue", () => {
    const before = getInvariantDefinition("INV-001")!.defaultSeverity;
    try {
      (
        getInvariantDefinition("INV-001") as unknown as {
          defaultSeverity: string;
        }
      ).defaultSeverity = "LOW";
    } catch {
      // Frozen objects throw in strict mode; either outcome is acceptable
      // as long as the value below is unchanged.
    }
    expect(getInvariantDefinition("INV-001")!.defaultSeverity).toBe(before);
  });
});

describe("Phase 3F-A — the frozen chaos registry's invariant IDs are all catalogued (task Section 20)", () => {
  it("13: every requiredInvariants entry across C01/C03/C07/C11 is a valid MoneyInvariantId", () => {
    const referenced = new Set<string>();
    for (const scenario of listScenarioDefinitions()) {
      for (const invariantId of scenario.requiredInvariants) {
        referenced.add(invariantId);
        expect(isMoneyInvariantId(invariantId)).toBe(true);
        expect(getInvariantDefinition(invariantId)).toBeDefined();
      }
    }
    // The frozen mapping references exactly eight distinct invariants; the
    // catalogue is a strict superset of twelve.
    expect(referenced.size).toBe(8);
    expect(referenced.size).toBeLessThan(MONEY_INVARIANT_IDS.length);
  });

  it("14: INV-008/009/010/012 are catalogued even though no P0 scenario maps to them", () => {
    const referenced = new Set<string>();
    for (const scenario of listScenarioDefinitions()) {
      for (const invariantId of scenario.requiredInvariants) {
        referenced.add(invariantId);
      }
    }
    for (const unmapped of ["INV-008", "INV-009", "INV-010", "INV-012"]) {
      expect(referenced.has(unmapped)).toBe(false);
      expect(
        getInvariantDefinition(unmapped as MoneyInvariantId),
      ).toBeDefined();
    }
  });

  it("15: lib/chaos/types.ts InvariantId is NOT widened — it still declares exactly the eight mapped IDs", () => {
    const chaosTypes = fs.readFileSync(
      path.join(repoRoot, "lib", "chaos", "types.ts"),
      "utf-8",
    );
    const match = chaosTypes.match(/export type InvariantId =([^;]*);/);
    expect(match).not.toBeNull();
    const declared = [...match![1]!.matchAll(/"(INV-\d{3})"/g)].map(
      (m) => m[1]!,
    );
    expect(declared).toEqual([
      "INV-001",
      "INV-002",
      "INV-003",
      "INV-004",
      "INV-005",
      "INV-006",
      "INV-007",
      "INV-011",
    ]);
  });

  it("16: lib/chaos/registry.ts is byte-unchanged in its scenario-to-invariant mapping", () => {
    const chaosRegistry = fs.readFileSync(
      path.join(repoRoot, "lib", "chaos", "registry.ts"),
      "utf-8",
    );
    const mappings = [
      ...chaosRegistry.matchAll(/requiredInvariants:\s*\[([^\]]*)\]/g),
    ].map((m) => [...m[1]!.matchAll(/"(INV-\d{3})"/g)].map((x) => x[1]!));
    expect(mappings).toEqual([
      ["INV-001", "INV-002", "INV-006", "INV-007"],
      ["INV-004", "INV-005"],
      ["INV-002", "INV-004", "INV-011"],
      ["INV-003", "INV-004", "INV-011"],
    ]);
  });
});

describe("Phase 3F-A — lib/invariants/registry.ts ships no evaluator and no I/O", () => {
  const source = fs.readFileSync(
    path.join(repoRoot, "lib", "invariants", "registry.ts"),
    "utf-8",
  );

  function stripComments(text: string): string {
    const withoutBlockComments = text.replace(/\/\*[\s\S]*?\*\//g, "");
    return withoutBlockComments
      .split("\n")
      .map((line) => {
        const idx = line.indexOf("//");
        return idx === -1 ? line : line.slice(0, idx);
      })
      .join("\n");
  }

  const functionalSource = stripComments(source);

  it("17: is server-only", () => {
    expect(source).toMatch(/import\s+["']server-only["']/);
  });

  it("18: names no database table and opens no connection", () => {
    expect(functionalSource).not.toMatch(/invariant_results/);
    expect(functionalSource).not.toMatch(/@\/lib\/supabase/);
    expect(functionalSource).not.toMatch(/\.from\(/);
    expect(functionalSource).not.toMatch(/\bfetch\s*\(/);
    expect(functionalSource).not.toMatch(/node:fs/);
  });

  it("19: touches no Razorpay surface", () => {
    expect(functionalSource).not.toMatch(/require\("razorpay"\)/);
    expect(functionalSource).not.toMatch(/from\s+["']razorpay["']/);
    expect(functionalSource).not.toMatch(/new Razorpay\(/);
  });

  it("20: reads no clock and no randomness", () => {
    expect(functionalSource).not.toMatch(/Date\.now\(/);
    expect(functionalSource).not.toMatch(/new Date\(/);
    expect(functionalSource).not.toMatch(/Math\.random\(/);
    expect(functionalSource).not.toMatch(/randomUUID/);
  });

  it("21: declares no evaluator function and no verdict literal — no placeholder returns PASS", () => {
    expect(functionalSource).not.toMatch(/\bevaluate[A-Z]/);
    expect(functionalSource).not.toMatch(/["']PASS["']/);
    expect(functionalSource).not.toMatch(/["']FAIL["']/);
    expect(functionalSource).not.toMatch(/["']UNKNOWN["']/);
    expect(functionalSource).not.toMatch(/["']NOT_APPLICABLE["']/);
  });

  it("22: contains no AI, diagnosis, recommendation-text or score surface", () => {
    for (const forbidden of [
      "confidence",
      "rootCause",
      "root_cause",
      "diagnosis",
      "reliabilityScore",
      "reliability_score",
      "llm",
      "openai",
      "anthropic",
      "ollama",
      "finding",
      "regression_run",
    ]) {
      expect(functionalSource.toLowerCase()).not.toContain(
        forbidden.toLowerCase(),
      );
    }
  });
});
