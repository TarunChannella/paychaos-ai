import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Phase 4F-R1 — structural proof that the Reliability Score engine is pure.
 *
 * The score's whole value is that it is deterministic arithmetic over
 * persisted deterministic evidence. A single database call, clock read or
 * AI import would quietly destroy that, and a unit test asserting outputs
 * would not necessarily notice. These assertions make the property
 * structural rather than aspirational.
 *
 * Every check runs against source with comments stripped, so the module
 * documentation — which legitimately names the very things being banned, in
 * order to say they are absent — can never satisfy a check by accident.
 */

const ROOT = process.cwd();
const DIR = join(ROOT, "lib", "reliability");
const TYPES = join(DIR, "types.ts");
const SCORE = join(DIR, "score.ts");

/** Source with block and line comments removed. */
function codeOf(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
}

const typesSource = readFileSync(TYPES, "utf8");
const scoreSource = readFileSync(SCORE, "utf8");
const R1_CODE = `${codeOf(typesSource)}\n${codeOf(scoreSource)}`;

describe("Phase 4F-R1 — the approved surface", () => {
  it("1: exactly the two approved production files exist in lib/reliability", () => {
    expect(existsSync(TYPES)).toBe(true);
    expect(existsSync(SCORE)).toBe(true);
    expect(readdirSync(DIR).sort()).toEqual(["score.ts", "types.ts"]);
  });

  it("2: R1 introduces no repository and no service", () => {
    // Both belong to R2 and must not appear early.
    expect(existsSync(join(DIR, "repository.ts"))).toBe(false);
    expect(existsSync(join(DIR, "service.ts"))).toBe(false);
  });

  it("3: R1 introduces no API route and no UI page", () => {
    expect(existsSync(join(ROOT, "app", "api", "reliability"))).toBe(false);
    expect(existsSync(join(ROOT, "app", "reliability"))).toBe(false);
  });

  it("4: R1 introduces no migration", () => {
    const migrations = readdirSync(join(ROOT, "supabase", "migrations"))
      .filter((name) => name.endsWith(".sql"))
      .sort();
    expect(migrations).toHaveLength(13);
    expect(migrations.at(-1)).toBe(
      "20260904000000_phase4e_regression_runs.sql",
    );
  });

  it("5: R1 introduces no real-Supabase integration suite", () => {
    const integration = readdirSync(
      join(ROOT, "tests", "integration", "supabase"),
    ).filter((name) => name.startsWith("075-"));
    expect(integration).toEqual([]);
  });
});

describe("Phase 4F-R1 — the engine is pure", () => {
  it("6: no database access of any kind", () => {
    for (const forbidden of [
      "@/lib/supabase/server",
      "getSupabaseServerClient",
      "createClient",
      "@supabase/supabase-js",
      ".from(",
      ".select(",
      "server-only",
    ]) {
      expect(R1_CODE, forbidden).not.toContain(forbidden);
    }
  });

  it("7: no write path exists", () => {
    for (const forbidden of [
      ".insert(",
      ".update(",
      ".upsert(",
      ".delete(",
      ".rpc(",
      "persistReliability",
      "saveScore",
      "reliability_scores",
      "reliability_score_snapshots",
    ]) {
      expect(R1_CODE, forbidden).not.toContain(forbidden);
    }
  });

  it("8: no network, filesystem or process access", () => {
    for (const forbidden of [
      "fetch(",
      "axios",
      "XMLHttpRequest",
      "https://",
      "http://",
      "node:fs",
      "node:child_process",
      "child_process",
      "process.env",
    ]) {
      expect(R1_CODE, forbidden).not.toContain(forbidden);
    }
  });

  it("9: no clock and no randomness", () => {
    // A score that changed with the wall clock could not be reproducible.
    for (const forbidden of [
      "Date.now(",
      "new Date(",
      "toISOString(",
      "Math.random(",
      "randomUUID",
      "crypto",
    ]) {
      expect(R1_CODE, forbidden).not.toContain(forbidden);
    }
  });

  it("10: no Razorpay or payment surface is reachable", () => {
    for (const forbidden of [
      "razorpay",
      "Razorpay",
      "@/lib/webhooks/",
      "@/lib/events/",
      "@/lib/payments/",
      "@/lib/demo-merchant/",
      "verifyWebhookSignature",
    ]) {
      expect(R1_CODE, forbidden).not.toContain(forbidden);
    }
  });

  it("11: no chaos execution or invariant re-evaluation", () => {
    for (const forbidden of [
      "@/lib/chaos/",
      "@/lib/invariants/",
      "createChaosRun",
      "evaluateChaosRun",
      "evaluateInvariant",
      "persistInvariantResult",
    ]) {
      expect(R1_CODE, forbidden).not.toContain(forbidden);
    }
  });
});

describe("Phase 4F-R1 — no Finding, regression, diagnosis or AI dependency", () => {
  it("12: none of those modules is imported", () => {
    for (const forbidden of [
      "@/lib/findings",
      "@/lib/regression",
      "@/lib/diagnosis",
      "@/lib/recommendations",
      "@/lib/reliability/repository",
      "@/lib/reliability/service",
    ]) {
      expect(R1_CODE, forbidden).not.toContain(forbidden);
    }
  });

  it("13: no Finding or regression field feeds the arithmetic", () => {
    for (const forbidden of [
      "resolved_at",
      "resolvedAt",
      "findingId",
      "regressionRunId",
      "diagnosis_code",
      "diagnosisCode",
      "diagnosis_strength",
      "diagnosisStrength",
      "diagnosis_summary",
      "diagnosisSummary",
      "recommendation_code",
      "recommendationCode",
      "recommendation_text",
      "recommendationText",
    ]) {
      expect(R1_CODE, forbidden).not.toContain(forbidden);
    }
  });

  it("14: no AI, ML or LLM surface", () => {
    for (const forbidden of [
      "openai",
      "OpenAI",
      "anthropic",
      "Anthropic",
      "ollama",
      "Ollama",
      "llm",
      "LLM",
      "embedding",
      "confidence",
      "probability",
    ]) {
      expect(R1_CODE, forbidden).not.toContain(forbidden);
    }
  });

  it("15: no Phase 4G readiness logic", () => {
    // Readiness labels belong to Go-Live Readiness V1, not to the score.
    for (const forbidden of [
      "NOT_READY",
      "NEEDS_ATTENTION",
      "GO_LIVE",
      "goLive",
      "readiness",
      "Readiness",
    ]) {
      expect(R1_CODE, forbidden).not.toContain(forbidden);
    }
  });
});

describe("Phase 4F-R1 — the frozen contract is present in source", () => {
  it("16: the frozen version strings", () => {
    expect(R1_CODE).toContain('"RELIABILITY-V1"');
    expect(R1_CODE).toContain('"LATEST_SELECTION_V1"');
    expect(R1_CODE).not.toContain("RELIABILITY-V2");
  });

  it("17: the mandatory scenario set is exactly the four P0 scenarios", () => {
    const declared = codeOf(typesSource).match(
      /RELIABILITY_MANDATORY_SCENARIOS = Object\.freeze\(\[([\s\S]*?)\]/,
    );
    expect(declared).not.toBeNull();
    const ids = [...declared![1]!.matchAll(/"(C\d{2})"/g)].map((m) => m[1]);
    expect(ids).toEqual(["C01", "C03", "C07", "C11"]);
  });

  it("18: the scenario-aware classification matrix is exact", () => {
    const code = codeOf(typesSource);
    const block = code.match(
      /RELIABILITY_REQUIRED_CLASSIFICATION[\s\S]*?Object\.freeze\(\{([\s\S]*?)\}\)/,
    );
    expect(block).not.toBeNull();
    const pairs = [...block![1]!.matchAll(/(C\d{2}):\s*"([A-Z_]+)"/g)].map(
      (m) => `${m[1]}=${m[2]}`,
    );
    expect(pairs).toEqual([
      "C01=RECORDED_TEST_EVIDENCE",
      "C03=SYNTHETIC_DEMO",
      "C07=RECORDED_TEST_EVIDENCE",
      "C11=RECORDED_TEST_EVIDENCE",
    ]);
  });

  it("19: the deduction table is exact and unweighted", () => {
    const code = codeOf(typesSource);
    for (const pair of [
      "CRITICAL: 25",
      "HIGH: 20",
      "MEDIUM: 15",
      "LOW: 10",
      "PASS: 0",
      "UNKNOWN: 15",
      "BLOCKED: 15",
      "ERROR: 15",
      "NOT_RUN: 15",
    ]) {
      expect(code, pair).toContain(pair);
    }
    expect(code).toContain("RELIABILITY_STARTING_SCORE = 100");
  });

  it("20: C03's provenance wording is a controlled simulation, never real evidence", () => {
    const code = codeOf(typesSource);
    expect(code).toContain(
      'SYNTHETIC_DEMO: "Controlled PayChaos security simulation"',
    );
    expect(code).toContain('RECORDED_TEST_EVIDENCE: "Recorded test evidence"');
    // The label vocabulary must never claim provider authenticity.
    for (const forbidden of [
      "Real Razorpay",
      "real webhook delivery",
      "recorded provider evidence",
      "Verified by Razorpay",
    ]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });

  it("21: completed_at is never used as the ordering key", () => {
    const code = codeOf(scoreSource);
    const selection = code.match(/function selectLatest\([\s\S]*?\n\}/);
    expect(selection).not.toBeNull();
    // The sort comparator reads createdAt and id, and nothing else.
    expect(selection![0]).toContain("a.createdAt");
    expect(selection![0]).toContain("a.id");
    expect(selection![0]).not.toContain("completedAt");
  });

  it("22: the engine exports exactly one public entry point", () => {
    const exported = [
      ...codeOf(scoreSource).matchAll(
        /export\s+(?:async\s+)?function\s+(\w+)/g,
      ),
    ].map((m) => m[1]);
    expect(exported).toEqual(["calculateReliabilityScoreV1"]);
  });
});
