import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getScenarioDto, listScenarioDtos } from "@/lib/chaos/scenario-dto";
import { listScenarioDefinitions } from "@/lib/chaos/registry";

/**
 * Phase 3H — the scenario DTO must be a PROJECTION of the frozen registry,
 * never a second catalogue. A duplicate would drift silently, and the drifted
 * copy would be the one the operator reads.
 */

describe("Phase 3H scenario DTO — exactly the four approved scenarios", () => {
  it("1: lists exactly C01, C03, C07, C11 in registry order", () => {
    const ids = listScenarioDtos().map((s) => s.scenarioId);
    expect(ids).toEqual(["C01", "C03", "C07", "C11"]);
  });

  it("2: no P1 scenario is reachable, by id or by listing", () => {
    for (const p1 of [
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
    ]) {
      expect(getScenarioDto(p1), p1).toBeNull();
      expect(listScenarioDtos().some((s) => s.scenarioId === p1)).toBe(false);
    }
  });

  it("3: an unknown, malformed or non-string id is null, never a guess", () => {
    for (const bad of [
      "c01",
      "C1",
      "C011",
      "",
      " C01",
      null,
      undefined,
      42,
      {},
      ["C01"],
    ]) {
      expect(getScenarioDto(bad), String(bad)).toBeNull();
    }
  });
});

describe("Phase 3H scenario DTO — derived from the frozen registry", () => {
  it("4: every DTO field matches its registry definition exactly", () => {
    const definitions = listScenarioDefinitions();
    const dtos = listScenarioDtos();
    expect(dtos).toHaveLength(definitions.length);

    for (const definition of definitions) {
      const dto = dtos.find((d) => d.scenarioId === definition.scenarioId)!;
      expect(dto).toBeDefined();
      expect(dto.name).toBe(definition.name);
      expect(dto.priority).toBe(definition.priority);
      expect(dto.enabled).toBe(definition.enabled);
      expect(dto.requiresRealPayment).toBe(definition.requiresRealPayment);
      expect(dto.requiresVerifiedWebhook).toBe(
        definition.requiresVerifiedWebhook,
      );
      expect(dto.requiresReset).toBe(definition.requiresReset);
    }
  });

  it("5: required invariant IDs agree with the frozen registry, per scenario", () => {
    for (const definition of listScenarioDefinitions()) {
      const dto = getScenarioDto(definition.scenarioId)!;
      expect(dto.requiredInvariantIds).toEqual([
        ...definition.requiredInvariants,
      ]);
    }
  });

  it("6: the documented scenario-to-invariant mapping is what the UI will show", () => {
    // Restating the frozen mapping here is deliberate: if either the registry
    // or this projection drifted, this test — not a demo — would catch it.
    expect(getScenarioDto("C01")!.requiredInvariantIds).toEqual([
      "INV-001",
      "INV-002",
      "INV-006",
      "INV-007",
    ]);
    expect(getScenarioDto("C03")!.requiredInvariantIds).toEqual([
      "INV-004",
      "INV-005",
    ]);
    expect(getScenarioDto("C07")!.requiredInvariantIds).toEqual([
      "INV-002",
      "INV-004",
      "INV-011",
    ]);
    expect(getScenarioDto("C11")!.requiredInvariantIds).toEqual([
      "INV-003",
      "INV-004",
      "INV-011",
    ]);
  });

  it("7: source event types come from the registry, not from the projection", () => {
    for (const definition of listScenarioDefinitions()) {
      const dto = getScenarioDto(definition.scenarioId)!;
      expect(dto.requiredSourceEventTypes).toEqual([
        ...definition.requiredSourceEventTypes,
      ]);
    }
  });
});

describe("Phase 3H scenario DTO — mechanisms", () => {
  it("8: C11 exposes its two mechanisms as MECHANISMS, never as scenario IDs", () => {
    const c11 = getScenarioDto("C11")!;
    expect(c11.scenarioId).toBe("C11");
    expect(c11.mechanisms.map((m) => m.mechanism)).toEqual(["A", "B"]);
    expect(c11.mechanisms[0]!.label).toContain("C11-A");
    expect(c11.mechanisms[1]!.label).toContain("C11-B");

    // The sibling IDs must not exist anywhere.
    expect(getScenarioDto("C11A")).toBeNull();
    expect(getScenarioDto("C11B")).toBeNull();
    expect(listScenarioDtos().map((s) => s.scenarioId)).not.toContain("C11A");
  });

  it("9: C07's combination mechanism renders as a label, never as a bare tuple", () => {
    const c07 = getScenarioDto("C07")!;
    expect(c07.mechanisms).toHaveLength(1);
    expect(c07.mechanisms[0]!.mechanism).toEqual(["A", "C"]);
    expect(c07.mechanisms[0]!.label).not.toContain("A,C");
    expect(c07.mechanisms[0]!.label).toBe(
      "Observed Failure With Internal Verification",
    );
  });

  it("10: every scenario carries at least one labelled mechanism", () => {
    for (const dto of listScenarioDtos()) {
      expect(dto.mechanisms.length, dto.scenarioId).toBeGreaterThan(0);
      for (const mechanism of dto.mechanisms) {
        expect(mechanism.label.length).toBeGreaterThan(0);
        expect(mechanism.label).not.toBe("Approved Mechanism");
      }
    }
  });
});

describe("Phase 3H scenario DTO — no arbitrary-target surface", () => {
  it("11: no DTO field can carry a network destination or a fault primitive", () => {
    const serialized = JSON.stringify(listScenarioDtos()).toLowerCase();
    for (const forbidden of [
      "http://",
      "https://",
      '"url"',
      '"host"',
      '"hostname"',
      '"ip"',
      '"endpoint"',
      '"target"',
      '"script"',
      "fault_config",
      "faultconfig",
      "fault_state",
      "faultstate",
    ]) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
  });

  it("12: allowedFaultTypes is deliberately NOT exposed", () => {
    // Showing the fault primitive invites a UI that submits it; the server
    // derives it from the scenario instead.
    for (const dto of listScenarioDtos()) {
      expect(dto).not.toHaveProperty("allowedFaultTypes");
      expect(dto).not.toHaveProperty("faultType");
    }
  });

  it("13: C03 states plainly that it needs no merchant subject", () => {
    const c03 = getScenarioDto("C03")!;
    expect(c03.requiresRealPayment).toBe(false);
    expect(c03.requiresVerifiedWebhook).toBe(false);
    expect(c03.executionRequirements.join(" ")).toContain(
      "Requires no merchant subject",
    );
  });

  it("14: scenarios needing real evidence say so", () => {
    for (const id of ["C01", "C07", "C11"] as const) {
      const dto = getScenarioDto(id)!;
      expect(dto.executionRequirements.length, id).toBeGreaterThan(0);
    }
    expect(getScenarioDto("C01")!.executionRequirements.join(" ")).toContain(
      "signature-verified",
    );
  });

  it("15: the DTO is deeply frozen, so a caller cannot mutate the catalogue", () => {
    const dtos = listScenarioDtos();
    expect(Object.isFrozen(dtos)).toBe(true);
    for (const dto of dtos) {
      expect(Object.isFrozen(dto)).toBe(true);
      expect(Object.isFrozen(dto.requiredInvariantIds)).toBe(true);
      expect(Object.isFrozen(dto.mechanisms)).toBe(true);
    }
  });
});
