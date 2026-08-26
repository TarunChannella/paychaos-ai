import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Architect correction (Phase 3C final provenance correction) — a static
 * regression guard against the exact mistake
 * `tests/integration/supabase/053-chaos-replay-execution.integration.test.ts`
 * previously made: creating a `chaos_runs` row classified
 * `RECORDED_TEST_EVIDENCE` from a SYNTHETIC canonical `webhook_events`
 * fixture, then invoking the production positive-path service
 * (`executeC01Replay`) against it as if the evidence were genuine.
 *
 * This is a plain static text check (parses 053's own source as text,
 * no Supabase connection, runs in the offline unit suite) so the rule
 * cannot silently regress even though 053 itself is a real-network
 * integration test that is not run as part of this suite.
 */

const repoRoot = path.resolve(import.meta.dirname, "../../../");
const targetFile = path.join(
  repoRoot,
  "tests",
  "integration",
  "supabase",
  "053-chaos-replay-execution.integration.test.ts",
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

describe("053-chaos-replay-execution.integration.test.ts — provenance guard", () => {
  it("found the target file and it is non-empty", () => {
    expect(source.length).toBeGreaterThan(0);
  });

  it("never creates a chaos_runs row classified RECORDED_TEST_EVIDENCE anywhere in functional code — every chaos_runs row this file creates must be SYNTHETIC_DEMO", () => {
    expect(functionalSource).not.toContain("RECORDED_TEST_EVIDENCE");
  });

  it("createSyntheticMechanicsChaosRun hardcodes SYNTHETIC_DEMO", () => {
    expect(functionalSource).toMatch(
      /dataClassification:\s*["']SYNTHETIC_DEMO["']/,
    );
  });

  it("never imports or calls the production positive-path service executeC01Replay", () => {
    expect(functionalSource).not.toMatch(/executeC01Replay/);
    expect(functionalSource).not.toMatch(
      /from\s+["']@\/lib\/chaos\/replay-service["']/,
    );
  });

  it("uses the repository-level insertReplayProcessingAttempt + processMerchantWebhookEvent mechanics path instead of the full service orchestration", () => {
    expect(functionalSource).toMatch(/insertReplayProcessingAttempt/);
    expect(functionalSource).toMatch(/processMerchantWebhookEvent/);
  });

  it("documents the deferred manual-verification gate for an authentic C01 replay claim", () => {
    expect(source).toMatch(/MANUAL VERIFICATION/i);
    expect(source).toMatch(/never reusing a synthetic canonical row/i);
  });
});
