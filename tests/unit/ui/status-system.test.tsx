import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { InvariantVerdict } from "@/components/findings/invariant-verdict";
import {
  DecisionStatus,
  LifecycleBadge,
  ProvenanceTag,
  SeverityBadge,
  VerdictBadge,
} from "@/components/ui/status";

/**
 * Phase 5 UI — the semantic status system.
 *
 * These tests exist because a status system is where a truthful product
 * quietly becomes an untruthful one: the moment UNKNOWN borrows the green of
 * a PASS, or a provenance label looks like a verdict, the screen is lying
 * without a single line of business logic being wrong.
 */

function html(node: React.ReactElement): string {
  return renderToStaticMarkup(node);
}

describe("status system — semantic mapping", () => {
  it("1: PASS, READY and RESOLVED share the pass tone", () => {
    expect(html(<VerdictBadge verdict="PASS" />)).toContain('data-tone="pass"');
    expect(html(<DecisionStatus status="READY" />)).toContain(
      'data-tone="pass"',
    );
    expect(html(<LifecycleBadge status="RESOLVED" />)).toContain(
      'data-tone="pass"',
    );
  });

  it("2: FAIL, NOT READY and CRITICAL share the fail tone", () => {
    expect(html(<VerdictBadge verdict="FAIL" />)).toContain('data-tone="fail"');
    expect(html(<DecisionStatus status="NOT READY" />)).toContain(
      'data-tone="fail"',
    );
    expect(html(<SeverityBadge severity="CRITICAL" />)).toContain(
      'data-tone="fail"',
    );
  });

  it("3: UNKNOWN and BLOCKED are amber — never the pass tone", () => {
    // The single most important mapping in the product.
    for (const verdict of ["UNKNOWN", "BLOCKED"]) {
      const markup = html(<VerdictBadge verdict={verdict} />);
      expect(markup, verdict).toContain('data-tone="warn"');
      expect(markup, verdict).not.toContain('data-tone="pass"');
    }
  });

  it("4: NEEDS ATTENTION is amber, not a pass", () => {
    const markup = html(<DecisionStatus status="NEEDS ATTENTION" />);
    expect(markup).toContain('data-tone="warn"');
    expect(markup).not.toContain('data-tone="pass"');
  });

  it("5: an unrecognised value renders its own text, never a guessed tone", () => {
    const markup = html(<VerdictBadge verdict="SOMETHING_NEW" />);
    expect(markup).toContain("SOMETHING NEW");
    expect(markup).toContain('data-tone="neutral"');
  });

  it("6: every state carries a glyph, so colour is never the only signal", () => {
    for (const [markup, name] of [
      [html(<VerdictBadge verdict="PASS" />), "PASS"],
      [html(<VerdictBadge verdict="FAIL" />), "FAIL"],
      [html(<VerdictBadge verdict="UNKNOWN" />), "UNKNOWN"],
      [html(<DecisionStatus status="READY" />), "READY"],
    ] as const) {
      expect(markup, name).toContain('aria-hidden="true"');
    }
  });
});

describe("status system — provenance is not a verdict", () => {
  it("7: a provenance tag carries no tone and no verdict styling", () => {
    const markup = html(<ProvenanceTag label="SYNTHETIC TEST" />);

    expect(markup).toContain('data-kind="provenance"');
    expect(markup).not.toContain("data-tone=");
    // No semantic colour family at all.
    for (const colour of ["emerald", "red", "amber"]) {
      expect(markup, colour).not.toContain(colour);
    }
  });

  it("8: provenance is visually distinct from every verdict", () => {
    const provenance = html(<ProvenanceTag label="RECORDED TEST EVIDENCE" />);
    const verdict = html(<VerdictBadge verdict="PASS" />);

    // Dashed + mono is the provenance language; verdicts use neither.
    expect(provenance).toContain("border-dashed");
    expect(verdict).not.toContain("border-dashed");
  });

  it("9: a decision status is larger than an ordinary badge", () => {
    // READY/NOT READY are consequential; they must not read as a tag.
    //
    // ADVANCED, NOT LOOSENED (final Phase 5 UI pass). This previously pinned
    // one literal class name, "text-base", so making the decision status
    // LARGER failed a test whose stated property still held. It now compares
    // the two sizes on the type scale, which is the property the test is
    // named after and is strictly harder to satisfy accidentally: a decision
    // status rendered at badge size fails either way, and one rendered with
    // no size class at all now fails too, where before it could pass.
    const SCALE = [
      "text-xs",
      "text-sm",
      "text-base",
      "text-lg",
      "text-xl",
      "text-2xl",
    ] as const;

    /** Largest size on the scale that the markup actually declares. */
    function largestSize(markup: string, label: string): number {
      const present = SCALE.map((size, index) =>
        new RegExp(`(^|["' ])${size}(["' ]|$)`).test(markup) ? index : -1,
      ).filter((index) => index >= 0);
      expect(present, `${label} must declare a type size`).not.toHaveLength(0);
      return Math.max(...present);
    }

    const decision = largestSize(
      html(<DecisionStatus status="READY" />),
      "DecisionStatus",
    );
    const badge = largestSize(
      html(<VerdictBadge verdict="PASS" />),
      "VerdictBadge",
    );

    // An ordinary badge stays at the bottom of the scale...
    expect(badge).toBe(SCALE.indexOf("text-xs"));
    // ...and the go-live decision is unambiguously bigger than it.
    expect(decision).toBeGreaterThan(badge);
  });
});

describe("status system — lifecycle honesty", () => {
  it("10: only RESOLVED renders 'Fix verified'", () => {
    expect(html(<LifecycleBadge status="RESOLVED" />)).toContain(
      "Fix verified",
    );

    for (const status of ["PENDING", "RUNNING", "STILL_FAILING", "ERROR"]) {
      expect(html(<LifecycleBadge status={status} />), status).not.toContain(
        "Fix verified",
      );
    }
  });

  it("11: each non-resolved lifecycle state renders as itself", () => {
    expect(html(<LifecycleBadge status="PENDING" />)).toContain("Pending");
    expect(html(<LifecycleBadge status="RUNNING" />)).toContain("Running");
    expect(html(<LifecycleBadge status="STILL_FAILING" />)).toContain(
      "Still failing",
    );
    expect(html(<LifecycleBadge status="ERROR" />)).toContain("Error");
  });
});

describe("invariant verdict — authority is explicit", () => {
  const NODE = (
    <InvariantVerdict
      invariantId="INV-002"
      invariantName="One captured payment produces at most one fulfilment"
      severity="CRITICAL"
      result="FAIL"
      expectedSummary="At most one fulfilment for the captured payment."
      observedSummary="Two fulfilments recorded for the captured payment."
      reason="The protected effect executed twice."
      evaluatedAt="2026-09-01T00:00:00.000Z"
    />
  );

  it("12: it renders id, expected, observed and the verdict", () => {
    const markup = html(NODE);

    expect(markup).toContain("INV-002");
    expect(markup).toContain(
      "At most one fulfilment for the captured payment.",
    );
    expect(markup).toContain(
      "Two fulfilments recorded for the captured payment.",
    );
    expect(markup).toContain('data-testid="invariant-verdict-result"');
    expect(markup).toContain("FAIL");
  });

  it("13: it states DETERMINISTIC authority", () => {
    const markup = html(NODE);
    expect(markup).toContain('data-testid="invariant-verdict-authority"');
    expect(markup).toContain("Deterministic");
  });

  it("14: expected and observed are rendered verbatim, never parsed", () => {
    // The persisted summaries are prose. Turning them into "1" and "2" would
    // invent structure the engine never produced.
    const source = readFileSync(
      join(process.cwd(), "components", "findings", "invariant-verdict.tsx"),
      "utf8",
    );
    for (const forbidden of [
      "parseInt",
      "Number(",
      ".match(",
      "replace(/\\d",
      "split(",
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });
});

describe("AI truthfulness — Phase 4H has not happened", () => {
  it("15: no surface claims an AI produced the diagnosis", () => {
    const files = [
      join("components", "findings", "finding-casefile.tsx"),
      join("components", "findings", "invariant-verdict.tsx"),
      join("components", "findings", "regression-action.tsx"),
    ];

    for (const file of files) {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      const code = source
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split(String.fromCharCode(10))
        .filter((line) => !line.trimStart().startsWith("//"))
        .join(String.fromCharCode(10));

      for (const forbidden of [
        "AI Diagnosis",
        "AI Reasoning",
        "Agent Reasoning",
        "AI Root Cause",
        "LLM",
      ]) {
        expect(code, `${file}: ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("16: the permanent authority boundary is stated exactly", () => {
    // The approved wording. "AI explains verified evidence" is a statement
    // about AUTHORITY — the intelligence layer explains, it never decides —
    // and holds whether the explanation is produced by today's deterministic
    // rules or by a later model. It is paired with the sentence that makes
    // the limit explicit.
    const source = readFileSync(
      join(process.cwd(), "components", "findings", "finding-casefile.tsx"),
      "utf8",
    );

    expect(source).toContain(
      "Payment truth and invariant results are deterministic. AI explains",
    );
    expect(source).toContain("verified evidence.");
    expect(source).toContain("Diagnosis never determines payment state.");
  });
});
