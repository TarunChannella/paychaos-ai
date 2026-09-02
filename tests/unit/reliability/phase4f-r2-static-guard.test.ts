import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Phase 4F-R2 — structural boundaries for the reliability read layer.
 *
 * The repository is the only place in the score domain that can reach a
 * database, so "SELECT-only" has to be a property of the source rather than
 * of the author's intent. The service is the only place that could grow a
 * second copy of the arithmetic, so "no duplicate deduction table" has to be
 * proven too.
 *
 * All checks run against comment-stripped source, so documentation naming the
 * banned things — in order to say they are absent — can never satisfy a check
 * by accident.
 */

const ROOT = process.cwd();
const DIR = join(ROOT, "lib", "reliability");
const REPOSITORY = join(DIR, "repository.ts");
const SERVICE = join(DIR, "service.ts");

function codeOf(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
}

const repositorySource = readFileSync(REPOSITORY, "utf8");
const serviceSource = readFileSync(SERVICE, "utf8");
const repositoryCode = codeOf(repositorySource);
const serviceCode = codeOf(serviceSource);
const R2_CODE = `${repositoryCode}\n${serviceCode}`;

describe("Phase 4F-R2 — the repository is SELECT-only", () => {
  it("1: both R2 modules exist and are server-only", () => {
    expect(existsSync(REPOSITORY)).toBe(true);
    expect(existsSync(SERVICE)).toBe(true);
    expect(repositoryCode).toContain('import "server-only"');
    expect(serviceCode).toContain('import "server-only"');
  });

  it("2: the repository uses the existing Supabase server boundary", () => {
    expect(repositoryCode).toContain("@/lib/supabase/server");
    expect(repositoryCode).toContain("getSupabaseServerClient()");
    // Never its own client, and never a browser-reachable key.
    expect(repositoryCode).not.toContain("@supabase/supabase-js");
    expect(repositoryCode).not.toContain("createClient(");
    expect(R2_CODE).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(R2_CODE).not.toContain("NEXT_PUBLIC_");
  });

  it("3: no mutating verb appears anywhere in the R2 layer", () => {
    for (const forbidden of [
      ".insert(",
      ".update(",
      ".upsert(",
      ".delete(",
      ".rpc(",
    ]) {
      expect(R2_CODE, forbidden).not.toContain(forbidden);
    }
  });

  it("4: exactly two tables are read, and no other", () => {
    const tables = [...repositoryCode.matchAll(/\.from\("(\w+)"\)/g)].map(
      (m) => m[1],
    );
    expect([...new Set(tables)].sort()).toEqual([
      "chaos_runs",
      "invariant_results",
    ]);
    // The service reaches no table of its own at all.
    expect(serviceCode).not.toContain(".from(");
  });

  it("5: no payment, Finding, regression or chaos mutation is reachable", () => {
    for (const forbidden of [
      "createChaosRun",
      "evaluateChaosRun",
      "evaluateInvariant",
      "persistInvariantResult",
      "resolveFindingAfterRegression",
      "markFindingStillFailingAfterRegression",
      "insertPendingRegressionRun",
      "generateFindingsForChaosRun",
      "createFindingFromInvariantResult",
      "processMerchantWebhookEvent",
    ]) {
      expect(R2_CODE, forbidden).not.toContain(forbidden);
    }
  });

  it("6: a read failure is a typed error, never an empty result", () => {
    // The rule that keeps an outage from becoming a confident score of 40.
    expect(repositoryCode).toContain("ReliabilityRepositoryError");
    expect(repositoryCode).toContain("CHAOS_RUN_READ_FAILED");
    expect(repositoryCode).toContain("INVARIANT_RESULT_READ_FAILED");
    // Two throw sites, one per read.
    expect(
      (repositoryCode.match(/throw new ReliabilityRepositoryError/g) ?? [])
        .length,
    ).toBe(2);
  });

  it("7: no raw database diagnostic is ever forwarded", () => {
    for (const forbidden of [
      "error.message",
      "error.details",
      "error.hint",
      "error.code",
      "JSON.stringify(error",
      "console.log",
      "console.error",
    ]) {
      expect(R2_CODE, forbidden).not.toContain(forbidden);
    }
  });
});

describe("Phase 4F-R2 — the service composes, it does not recalculate", () => {
  it("8: the service calls the frozen R1 engine", () => {
    expect(serviceCode).toContain("calculateReliabilityScoreV1");
    expect(serviceCode).toContain("./repository");
    expect(serviceCode).toContain("./score");
  });

  it("9: no duplicate deduction table, matrix, ordering or severity rank", () => {
    // A second copy of any of these could only ever drift from score.ts.
    for (const forbidden of [
      "CRITICAL: 25",
      "HIGH: 20",
      "MEDIUM: 15",
      "LOW: 10",
      "NOT_RUN: 15",
      "100 -",
      "Math.max(0,",
      "createdAt DESC",
      ".sort(",
      "RECORDED_TEST_EVIDENCE:",
      "SYNTHETIC_DEMO:",
    ]) {
      expect(serviceCode, forbidden).not.toContain(forbidden);
    }
  });

  it("10: the repository performs no arithmetic either", () => {
    for (const forbidden of [
      "calculateReliabilityScoreV1",
      "RELIABILITY_FAIL_DEDUCTION",
      "RELIABILITY_STATE_DEDUCTION",
      "RELIABILITY_SEVERITY_ORDER",
      "RELIABILITY_REQUIRED_CLASSIFICATION",
    ]) {
      expect(repositoryCode, forbidden).not.toContain(forbidden);
    }
  });

  it("11: diagnostics are explanatory only and reuse the pure breakdown", () => {
    expect(serviceCode).toContain("LATEST_ELIGIBLE_RUN");
    expect(serviceCode).toContain("NO_CANDIDATES");
    expect(serviceCode).toContain("NO_ELIGIBLE_CANDIDATES");
    // eligibleCandidateCount is copied from the engine, never recomputed.
    expect(serviceCode).toContain("breakdown?.eligibleCandidateCount");
  });

  it("11b: the pure composition boundary is structural", () => {
    // The snapshot composition must be callable without any I/O, because the
    // same-snapshot acceptance proof depends on it being pure. Slice its body
    // and prove it reaches no database while the I/O entry point does.
    const start = serviceCode.indexOf(
      "export function composeReliabilityScoreReadModel(",
    );
    expect(start).toBeGreaterThan(-1);
    const after = serviceCode.slice(start);
    const newline = String.fromCharCode(10);
    let end = after.length;
    for (const marker of [
      `${newline}export function `,
      `${newline}export async function `,
    ]) {
      const index = after.indexOf(marker, 1);
      if (index !== -1 && index < end) end = index;
    }
    const composition = after.slice(0, end);

    expect(composition).toContain("calculateReliabilityScoreV1");
    for (const forbidden of [
      "getSupabaseServerClient",
      ".from(",
      "loadReliabilityCandidateRuns",
      "loadReliabilityInvariantResults",
      "await ",
    ]) {
      expect(composition, forbidden).not.toContain(forbidden);
    }

    // And the I/O entry point is the only place the loaders are reached.
    const entry = serviceCode.slice(
      serviceCode.indexOf("export async function getCurrentReliabilityScore"),
    );
    expect(entry).toContain("loadReliabilityCandidateRuns()");
    expect(entry).toContain("loadReliabilityInvariantResults(");
    expect(entry).toContain("composeReliabilityScoreReadModel(");
  });

  it("12: the score object is returned unmodified", () => {
    // No reassignment of the engine's own fields anywhere in the service.
    expect(serviceCode).not.toContain("score.score =");
    expect(serviceCode).not.toContain("score.totalDeduction =");
    expect(serviceCode).not.toContain("scenarioBreakdown =");
    expect(serviceCode).not.toContain("Object.assign(score");
  });
});

describe("Phase 4F-R2 — no Finding, regression, AI or network dependency", () => {
  it("13: none of those modules is imported", () => {
    for (const forbidden of [
      "@/lib/findings",
      "@/lib/regression",
      "@/lib/diagnosis",
      "@/lib/recommendations",
      "@/lib/chaos/",
      "@/lib/invariants/",
      "@/lib/webhooks/",
      "@/lib/payments/",
      "@/lib/events/",
    ]) {
      expect(R2_CODE, forbidden).not.toContain(forbidden);
    }
  });

  it("14: findings and regression_runs are never queried", () => {
    for (const forbidden of [
      '"findings"',
      '"regression_runs"',
      '"orders"',
      '"payments"',
      '"payment_attempts"',
      '"webhook_events"',
      '"event_processing_attempts"',
      '"fulfilments"',
    ]) {
      expect(R2_CODE, forbidden).not.toContain(forbidden);
    }
  });

  it("15: no Finding or diagnosis field is read", () => {
    for (const forbidden of [
      "resolved_at",
      "resolvedAt",
      "diagnosis_code",
      "diagnosis_strength",
      "diagnosis_summary",
      "recommendation_code",
      "recommendation_text",
      "expected_summary",
      "observed_summary",
      "evidence_refs",
    ]) {
      expect(R2_CODE, forbidden).not.toContain(forbidden);
    }
  });

  it("16: no Razorpay, external HTTP or AI surface", () => {
    for (const forbidden of [
      "razorpay",
      "Razorpay",
      "fetch(",
      "axios",
      "https://",
      "http://",
      "openai",
      "anthropic",
      "ollama",
      "LLM",
      "confidence",
      "probability",
    ]) {
      expect(R2_CODE, forbidden).not.toContain(forbidden);
    }
  });

  it("17: no Phase 4G readiness decision logic", () => {
    for (const forbidden of [
      "NOT_READY",
      "NEEDS_ATTENTION",
      "GO_LIVE",
      "goLive",
      "readiness",
      "Readiness",
    ]) {
      expect(R2_CODE, forbidden).not.toContain(forbidden);
    }
  });
});

describe("Phase 4F-R2 — nothing is persisted and nothing later-phase exists", () => {
  it("18: no score storage of any kind", () => {
    for (const forbidden of [
      "reliability_scores",
      "reliability_score_snapshots",
      "persistScore",
      "saveScore",
      "snapshot",
    ]) {
      expect(R2_CODE, forbidden).not.toContain(forbidden);
    }
  });

  it("19: R2 introduces no migration", () => {
    const migrations = readdirSync(join(ROOT, "supabase", "migrations"))
      .filter((name) => name.endsWith(".sql"))
      .sort();
    // Advanced for the Phase 5 Demo Reset fix, which legitimately adds one
    // additive migration (a narrow reset function; no table change). The
    // protection is unchanged: THIS phase still contributes no migration of
    // its own, and the earlier migrations stay exactly where they were.
    // Advanced again for the safeupdate fix, which legitimately adds one
    // additive migration (CREATE OR REPLACE of the reset function; no table
    // change). THIS phase still contributes no migration of its own.
    expect(migrations).toHaveLength(15);
    expect(migrations.at(-1)).toBe(
      "20260906000000_phase5_demo_reset_safeupdate.sql",
    );
    expect(migrations.at(-2)).toBe(
      "20260905000000_phase5_demo_reset_atomic.sql",
    );
    expect(migrations.at(-3)).toBe(
      "20260904000000_phase4e_regression_runs.sql",
    );
  });

  it("20: the R3 read surfaces exist, and R2 itself still reaches neither", () => {
    // Advanced in R3. What R2 must keep proving is that the REPOSITORY and
    // SERVICE do not depend on the route or the page — the dependency runs
    // one way only.
    expect(
      existsSync(join(ROOT, "app", "api", "reliability", "route.ts")),
    ).toBe(true);
    expect(existsSync(join(ROOT, "app", "reliability", "page.tsx"))).toBe(true);
    for (const forbidden of [
      "@/app/api/reliability",
      "@/app/reliability",
      "@/components/reliability",
      "next/server",
    ]) {
      expect(R2_CODE, forbidden).not.toContain(forbidden);
    }
  });

  it("21: the 4F integration suites are exactly the approved 075 and 076", () => {
    const integration = readdirSync(
      join(ROOT, "tests", "integration", "supabase"),
    );
    expect(integration.filter((name) => name.startsWith("075-"))).toEqual([
      "075-phase4f-reliability-read.integration.test.ts",
    ]);
    expect(integration.filter((name) => name.startsWith("076-"))).toEqual([
      "076-phase4f-reliability-api.integration.test.ts",
    ]);
  });

  it("22: the 075 suite itself contains no write operation", () => {
    const suite = codeOf(
      readFileSync(
        join(
          ROOT,
          "tests",
          "integration",
          "supabase",
          "075-phase4f-reliability-read.integration.test.ts",
        ),
        "utf8",
      ),
    );
    for (const forbidden of [
      ".insert(",
      ".update(",
      ".upsert(",
      ".delete(",
      ".rpc(",
    ]) {
      expect(suite, forbidden).not.toContain(forbidden);
    }
  });
});
