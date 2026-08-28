import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Architect correction (Phase 3D-C provenance correction) — a static
 * regression guard against the exact mistake
 * `tests/integration/supabase/057-chaos-c11-payment-failed-fixture.integration.test.ts`
 * previously made: inserting an `event_processing_attempts` row via the live
 * production ingestion path (`insertEventProcessingAttempt`, `source_kind =
 * REAL_RAZORPAY_WEBHOOK`) with no `chaos_run` at all, rather than the
 * approved `SYNTHETIC_DEMO` mechanics `chaos_run` + `PAYCHAOS_REPLAY`
 * pattern already established by `053-chaos-replay-execution.integration.test.ts`.
 *
 * This is a plain static text check (parses 057's own source as text, no
 * Supabase connection, runs in the offline unit suite) so the rule cannot
 * silently regress even though 057 itself is a real-network integration
 * test that is not run as part of this suite.
 */

const repoRoot = path.resolve(import.meta.dirname, "../../../");
const targetFile = path.join(
  repoRoot,
  "tests",
  "integration",
  "supabase",
  "057-chaos-c11-payment-failed-fixture.integration.test.ts",
);

const source = fs.readFileSync(targetFile, "utf-8");

/**
 * Strips `//` line comments and `/** ... *\/` block comments so a
 * documentation reference to the forbidden pattern (e.g. this file's own
 * module doc comment explaining WHY it must never appear in functional
 * code) does not itself trip the guard.
 */
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

describe("057-chaos-c11-payment-failed-fixture.integration.test.ts — provenance guard", () => {
  it("found the target file and it is non-empty", () => {
    expect(source.length).toBeGreaterThan(0);
  });

  it("uses insertReplayProcessingAttempt (the PAYCHAOS_REPLAY mechanics path) — never insertEventProcessingAttempt (the live production ingestion path)", () => {
    expect(functionalSource).toMatch(/insertReplayProcessingAttempt/);
    expect(functionalSource).not.toMatch(/insertEventProcessingAttempt/);
  });

  it("creates its mechanics chaos_run classified SYNTHETIC_DEMO — never RECORDED_TEST_EVIDENCE", () => {
    expect(functionalSource).toMatch(
      /dataClassification:\s*["']SYNTHETIC_DEMO["']/,
    );
    expect(functionalSource).not.toContain("RECORDED_TEST_EVIDENCE");
  });

  it("uses the repository-level insertReplayProcessingAttempt + processMerchantWebhookEvent mechanics path", () => {
    expect(functionalSource).toMatch(/insertReplayProcessingAttempt/);
    expect(functionalSource).toMatch(/processMerchantWebhookEvent/);
  });

  it("never invokes the Phase 3A/3B chaos-creation entry points — this is a fixed pre-created SYNTHETIC_DEMO mechanics run only, never a claimed real C11 execution", () => {
    expect(functionalSource).not.toMatch(/runChaosPrecheck/);
    expect(functionalSource).not.toMatch(/\bcreateChaosRun\b/);
  });

  it("never imports or calls any C11 positive-path execution service (none exists yet — Phase 3D-D)", () => {
    expect(functionalSource).not.toMatch(/resolveAuthoritativeC11ReplaySource/);
    expect(functionalSource).not.toMatch(/executeC11/i);
    expect(functionalSource).not.toMatch(
      /from\s+["']@\/lib\/chaos\/c11-[\w-]+["']/,
    );
  });

  it("documents the three-layer provenance distinction (execution / evidence-origin / schema-compatibility)", () => {
    expect(source).toMatch(/PAYCHAOS_REPLAY/);
    expect(source).toMatch(/SYNTHETIC CANONICAL COMPATIBILITY/i);
    expect(source).toMatch(/never MUTATES that row/i);
  });
});
