import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Phase 3D-D — a static regression guard against
 * `tests/integration/supabase/058-chaos-c11-real-webhook-replay.integration.test.ts`
 * ever repeating the exact provenance mistake `057`'s first draft made
 * (Phase 3D-C correction): claiming genuine `RECORDED_TEST_EVIDENCE` from a
 * synthetic mechanics fixture, or invoking the production positive-path
 * execution service/entry points instead of the established `053`/`057`
 * SYNTHETIC_DEMO + PAYCHAOS_REPLAY mechanics pattern.
 *
 * A plain static text check (no Supabase connection, offline unit suite) —
 * mirrors `057-chaos-c11-fixture-provenance-guard.test.ts` exactly.
 */

const repoRoot = path.resolve(import.meta.dirname, "../../../");
const targetFile = path.join(
  repoRoot,
  "tests",
  "integration",
  "supabase",
  "058-chaos-c11-real-webhook-replay.integration.test.ts",
);

const source = fs.readFileSync(targetFile, "utf-8");

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

describe("058-chaos-c11-real-webhook-replay.integration.test.ts — provenance guard", () => {
  it("found the target file and it is non-empty", () => {
    expect(source.length).toBeGreaterThan(0);
  });

  it("uses resolveAuthoritativeC11ReplaySource (the new resolver under test)", () => {
    expect(functionalSource).toMatch(/resolveAuthoritativeC11ReplaySource/);
  });

  it("uses insertReplayProcessingAttempt (the PAYCHAOS_REPLAY mechanics path) — never insertEventProcessingAttempt for the replay attempt", () => {
    expect(functionalSource).toMatch(/insertReplayProcessingAttempt/);
    expect(functionalSource).not.toMatch(/insertEventProcessingAttempt/);
  });

  it("creates its mechanics chaos_run classified SYNTHETIC_DEMO — never RECORDED_TEST_EVIDENCE", () => {
    expect(functionalSource).toMatch(
      /dataClassification:\s*["']SYNTHETIC_DEMO["']/,
    );
    expect(functionalSource).not.toContain("RECORDED_TEST_EVIDENCE");
  });

  it("uses the repository-level createPendingChaosRun — never the Phase 3A/3B chaos-creation entry points", () => {
    expect(functionalSource).toMatch(/\bcreatePendingChaosRun\b/);
    expect(functionalSource).not.toMatch(/runChaosPrecheck/);
    expect(functionalSource).not.toMatch(/(?<!Pending)\bcreateChaosRun\b/);
  });

  it("never imports or calls the C11-B or C01 production positive-path execution services/routes", () => {
    expect(functionalSource).not.toMatch(/executeC11RealWebhookReplay/);
    expect(functionalSource).not.toMatch(/executeC01Replay/);
    expect(functionalSource).not.toMatch(
      /from\s+["']@\/lib\/chaos\/c11-execution-service["']/,
    );
    expect(functionalSource).not.toMatch(
      /from\s+["']@\/lib\/chaos\/replay-service["']/,
    );
    expect(functionalSource).not.toMatch(/execute-c11-b\/route/);
  });

  it("uses the real, unmodified processMerchantWebhookEvent for both the original and replay attempts", () => {
    expect(functionalSource).toMatch(/processMerchantWebhookEvent/);
  });

  it("documents the three-layer provenance distinction", () => {
    expect(source).toMatch(/PAYCHAOS_REPLAY/);
    expect(source).toMatch(/SYNTHETIC CANONICAL COMPATIBILITY/i);
    expect(source).toMatch(/never mutates that row/i);
  });

  it("never fabricates a positive claim about the real captured event e0df759e-bbde-45c3-aa80-a5a2d6b61be9 beyond a read-only recheck (no insert/update/delete targets it)", () => {
    const lines = source
      .split("\n")
      .filter((l) => l.includes("e0df759e-bbde-45c3-aa80-a5a2d6b61be9"));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).not.toMatch(/\.(insert|update|delete|upsert)\(/);
    }
  });
});
