import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Phase 5 — what the Demo Reset panel TELLS THE OPERATOR.
 *
 * This is a truthfulness guard, not a styling one. The reset is atomic: it
 * either fully applied or did not apply at all. The panel's copy is the only
 * place that claim reaches a human, and it is the exact place the previous
 * implementation was wrong — it said "Earlier tables were cleared; later ones
 * were not", which was true of the looping implementation and would now be a
 * lie about a database that is completely untouched.
 *
 * A source-level assertion rather than a render: the strings are static, and
 * this avoids mounting a client component with a router just to read them.
 */

const SOURCE = readFileSync(
  join(process.cwd(), "components", "demo", "demo-reset-panel.tsx"),
  "utf8",
);

/** Documentation naming a construct must never satisfy a code assertion. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
}

const CODE = code(SOURCE);

describe("demo reset panel — the copy matches atomic behaviour", () => {
  it("1: failure states plainly that nothing was applied", () => {
    expect(CODE).toContain("failed and no reset was applied");
    expect(CODE).toContain("The database is ");
  });

  it("2: success states plainly that the reset happened", () => {
    expect(CODE).toContain("Demo data reset successfully");
  });

  it("3: no partial-reset vocabulary survives anywhere", () => {
    // Every one of these could only describe a half-finished reset, which
    // the implementation can no longer produce.
    for (const banned of [
      "stopped at",
      "Earlier tables were cleared",
      "later ones were not",
      "No further tables were cleared",
      "failedTable",
      "clearedTables",
    ]) {
      expect(CODE, banned).not.toContain(banned);
    }
  });

  it("4: no server-side failure reason is rendered to the operator", () => {
    // These are log identifiers. Showing them would leak deployment state
    // and tell an operator nothing they can act on.
    for (const banned of [
      "RESET_FUNCTION_UNAVAILABLE",
      "RESET_NOT_PERMITTED",
      "RESET_CONSTRAINT_VIOLATION",
      "failureReason",
      "PGRST",
    ]) {
      expect(CODE, banned).not.toContain(banned);
    }
  });

  it("5: destructive intent still requires typing RESET", () => {
    expect(CODE).toContain('const CONFIRM_WORD = "RESET"');
    expect(CODE).toContain("isArmed");
  });

  it("6: double submit is still impossible", () => {
    expect(CODE).toContain("inFlight.current");
    expect(CODE).toContain("if (inFlight.current || !isArmed) return");
  });

  it("7: the request still carries no body, so the UI cannot widen scope", () => {
    expect(CODE).toContain('fetch("/api/demo/reset", { method: "POST" })');
    expect(CODE).not.toContain("JSON.stringify");
  });
});
