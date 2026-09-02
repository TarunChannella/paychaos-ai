import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FindingCorrelation } from "@/components/findings/finding-correlation";

import type { GroupableFinding } from "@/lib/findings/grouping";

/**
 * Phase 4H-2 — the correlation panel.
 *
 * The property that matters is restraint: with a dataset too small to analyse
 * it must say exactly that, and never render a chart, a percentage or a
 * reassuring "0 correlations found".
 */

function render(findings: readonly GroupableFinding[]): string {
  return renderToStaticMarkup(<FindingCorrelation findings={findings} />);
}

function finding(
  id: string,
  overrides: Partial<GroupableFinding> = {},
): GroupableFinding {
  return {
    findingId: id,
    diagnosisCode: "RC-001",
    invariantId: "INV-002",
    scenarioId: "C01",
    ...overrides,
  };
}

describe("finding correlation — honest about thin data", () => {
  it("1: a low-data dataset shows exactly the approved sentence", () => {
    const html = render([finding("f-1"), finding("f-2")]);

    expect(html).toContain(
      "Not enough diagnosed finding history for meaningful correlation.",
    );
    expect(html).toContain('data-testid="finding-correlation-insufficient"');
  });

  it("2: an empty dataset is insufficient, not 'clean'", () => {
    const html = render([]);

    expect(html).toContain(
      "Not enough diagnosed finding history for meaningful correlation.",
    );
    expect(html).not.toContain("finding-correlation-groups");
  });

  it("3: it never renders a percentage, chart or trend", () => {
    for (const rows of [
      [],
      [finding("f-1"), finding("f-2")],
      [finding("f-1"), finding("f-2"), finding("f-3")],
    ]) {
      const html = render(rows);
      expect(html).not.toMatch(/\d+\s*%/);
      for (const forbidden of ["<svg", "trend", "chart", "increase"]) {
        expect(html, forbidden).not.toContain(forbidden);
      }
    }
  });

  it("4: with enough rows it reports real shared values and counts", () => {
    const html = render([finding("f-1"), finding("f-2"), finding("f-3")]);

    expect(html).toContain('data-testid="finding-correlation-groups"');
    expect(html).toContain("RC-001");
    expect(html).toContain("Same root cause");
    expect(html).toContain("3 findings");
  });

  it("5: undiagnosed findings never form a root-cause group", () => {
    const html = render([
      finding("f-1", { diagnosisCode: null }),
      finding("f-2", { diagnosisCode: null }),
      finding("f-3", { diagnosisCode: null }),
    ]);

    expect(html).not.toContain("Same root cause");
  });

  it("6: it states its own method rather than implying analysis", () => {
    const html = render([finding("f-1"), finding("f-2"), finding("f-3")]);

    expect(html).toContain("No clustering, no");
    expect(html).toContain("literally share a recorded value");
  });
});
