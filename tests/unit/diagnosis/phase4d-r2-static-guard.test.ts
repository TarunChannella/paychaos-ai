import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Phase 4D-R2 — a static guard over the recommendation orchestration service
 * and the recommendation persistence repository.
 *
 * The sharp risks here: the service could accept a caller-supplied
 * classification (defeating the whole trust boundary), reproduce Phase 4C's
 * diagnosis, or reach the database directly; and the repository could widen
 * beyond `findings`, acquire an INSERT/UPSERT/DELETE, overwrite Phase 4C's
 * diagnosis columns, or write the Phase 4E lifecycle.
 *
 * Comments are stripped before every content assertion.
 */

const repoRoot = path.resolve(import.meta.dirname, "../../../");

const SERVICE_PATH = "lib/diagnosis/recommendation-service.ts";
const REPOSITORY_PATH = "lib/diagnosis/recommendation-repository.ts";
const PURE_PATH = "lib/diagnosis/recommendations.ts";

function read(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf-8");
}

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

const service = stripComments(read(SERVICE_PATH));
const repository = stripComments(read(REPOSITORY_PATH));
const pure = stripComments(read(PURE_PATH));

describe("Phase 4D-R2 — orchestration service", () => {
  it("1: SERVER ONLY", () => {
    expect(service).toContain('import "server-only";');
  });

  it("2: the public entrypoint accepts a Finding ID only", () => {
    const signature = service.slice(
      service.indexOf("export async function recommendFinding"),
    );
    const params = signature.slice(
      signature.indexOf("("),
      signature.indexOf(")"),
    );
    // One parameter, a string finding id. No pack, classification,
    // recommendation, code, text or timestamp may be accepted.
    expect(params.replace(/\s+/g, " ").trim()).toBe("( findingId: string,");
    for (const forbidden of [
      "classification:",
      "pack:",
      "recommendation:",
      "diagnosisCode:",
      "recommendationCode:",
      "recommendationText:",
      "diagnosisSummary:",
      "diagnosedAt:",
      "updatedAt:",
    ]) {
      expect(params, forbidden).not.toContain(forbidden);
    }
  });

  it("3: it composes exactly the approved trusted units", () => {
    expect(service).toContain("diagnoseFinding(findingId)");
    expect(service).toContain(
      "assembleDiagnosisEvidencePackForFinding(findingId)",
    );
    expect(service).toContain(
      "buildRecommendation(pack, diagnosis.classification)",
    );
    expect(service).toContain("persistFindingRecommendation(");
  });

  it("4: it never re-runs or re-persists Phase 4C's diagnosis", () => {
    for (const forbidden of [
      "classifyRootCause(",
      "extractDiagnosticSignals(",
      "persistFindingDiagnosis(",
      "@/lib/diagnosis/root-cause-repository",
      "@/lib/diagnosis/diagnostic-signals-service",
    ]) {
      expect(service, forbidden).not.toContain(forbidden);
    }
  });

  it("5: NO DIRECT DATABASE ACCESS from the service", () => {
    for (const forbidden of [
      "@/lib/supabase/server",
      "@supabase/supabase-js",
      "createClient",
      "getSupabaseServerClient",
      "@/lib/findings/repository",
      "@/lib/findings/service",
      "@/lib/evidence/evidence-repository",
      "@/lib/invariants/result-repository",
      "@/lib/chaos/run-repository",
      ".from(",
      ".select(",
      ".update(",
      ".insert(",
      ".upsert(",
      ".delete(",
      ".rpc(",
      ".eq(",
      ".is(",
    ]) {
      expect(service, forbidden).not.toContain(forbidden);
    }
  });

  it("6: NO RAZORPAY, NETWORK, ENVIRONMENT, FILESYSTEM or SHELL", () => {
    for (const forbidden of [
      "@/lib/razorpay",
      "new Razorpay",
      "api.razorpay.com",
      "fetch(",
      "XMLHttpRequest",
      "http://",
      "https://",
      "process.env",
      "node:fs",
      "node:child_process",
      "readFileSync",
      "execSync",
      "spawn",
      "require(",
    ]) {
      expect(service, forbidden).not.toContain(forbidden);
    }
  });

  it("7: NO SECRET, NO AI/ML/LLM and NO CODE EXECUTION", () => {
    for (const forbidden of [
      "RAZORPAY_KEY_SECRET",
      "RAZORPAY_WEBHOOK_SECRET",
      "SUPABASE_SERVICE_ROLE_KEY",
      "PAYCHAOS_ACCESS_TOKEN",
      "SERVICE_ROLE",
      "openai",
      "anthropic",
      "ollama",
      "prompt",
      "embedding",
      "modelName",
      "eval(",
      "new Function",
      "child_process",
    ]) {
      expect(service, forbidden).not.toContain(forbidden);
    }
  });

  it("8: NO REGRESSION EXECUTION, SCORE or READINESS", () => {
    for (const forbidden of [
      "regression_runs",
      "regressionRunId",
      "startRegression",
      "runRegression",
      "executeScenario",
      "executeChaos",
      "@/lib/chaos/runner",
      "reliabilityScore",
      "RELIABILITY-V1",
      "readiness",
      "goLive",
    ]) {
      expect(service, forbidden).not.toContain(forbidden);
    }
  });

  it("9: NO payment, order, invariant or Finding-status mutation", () => {
    for (const forbidden of [
      '"orders"',
      '"payment_attempts"',
      '"payments"',
      '"fulfilments"',
      '"webhook_events"',
      '"event_processing_attempts"',
      '"chaos_runs"',
      '"invariant_results"',
      "resolved_at",
      "resolvedAt",
      "STILL_FAILING",
      '"RESOLVED"',
      "finalizeChaosRunOutcome",
      "persistInvariantResult",
      "insertOpenFinding",
    ]) {
      expect(service, forbidden).not.toContain(forbidden);
    }
  });

  it("10: NO API ROUTE or UI dependency", () => {
    for (const forbidden of [
      '"use client"',
      "next/navigation",
      "next/headers",
      "next/server",
      "NextRequest",
      "NextResponse",
      "react",
      "app/api",
      ".tsx",
    ]) {
      expect(service, forbidden).not.toContain(forbidden);
    }
  });

  it("11: exactly one server timestamp, for the recommendation write only", () => {
    expect([
      ...service.matchAll(/new Date\(\)\.toISOString\(\)/g),
    ]).toHaveLength(1);
    // It never sets a diagnosis timestamp.
    expect(service).not.toContain("diagnosedAt: new Date");
  });
});

describe("Phase 4D-R2 — recommendation persistence repository", () => {
  it("12: SERVER ONLY", () => {
    expect(repository).toContain('import "server-only";');
  });

  it("13: Supabase access is limited to the findings table", () => {
    const tables = [...repository.matchAll(/\.from\("([^"]+)"\)/g)].map(
      (match) => match[1],
    );
    expect(tables.length).toBeGreaterThan(0);
    expect([...new Set(tables)]).toEqual(["findings"]);
  });

  it("14: SELECT and conditional UPDATE only", () => {
    expect(repository).toContain(".select(");
    expect(repository).toContain(".update(");
    for (const forbidden of [".insert(", ".upsert(", ".delete(", ".rpc("]) {
      expect(repository, forbidden).not.toContain(forbidden);
    }
  });

  it("15: the update payload is exactly the four approved columns", () => {
    const start = repository.indexOf(".update({");
    expect(start).toBeGreaterThan(-1);
    const payload = repository.slice(start, repository.indexOf("})", start));
    const keys = [...payload.matchAll(/^\s{6}(\w+):/gm)].map((m) => m[1]);
    expect(keys.sort()).toEqual([
      "diagnosis_summary",
      "recommendation_code",
      "recommendation_text",
      "updated_at",
    ]);
    // Phase 4C's diagnosis columns and the Phase 4E lifecycle are never
    // written — they appear only as guards.
    for (const forbidden of [
      "diagnosis_code:",
      "diagnosis_strength:",
      "diagnosed_at:",
      "status:",
      "resolved_at:",
      "title:",
      "invariant_result_id:",
      "created_at:",
    ]) {
      expect(payload, forbidden).not.toContain(forbidden);
    }
  });

  it("16: the update is guarded by identity, the diagnosis and the NULL fields", () => {
    for (const guard of [
      '.eq("id", input.findingId)',
      '.eq("invariant_result_id", input.invariantResultId)',
      '.eq("diagnosis_code", input.expectedDiagnosisCode)',
      '.eq("diagnosis_strength", input.expectedDiagnosisStrength)',
      '.eq("diagnosed_at", input.expectedDiagnosedAt)',
      '.is("diagnosis_summary", null)',
      '.is("recommendation_code", null)',
      '.is("recommendation_text", null)',
    ]) {
      expect(repository, guard).toContain(guard);
    }
    // Recommendation ownership must not depend on the Phase 4E lifecycle.
    expect(repository).not.toContain('.eq("status"');
  });

  it("17: NO authoritative merchant or evidence table is referenced", () => {
    for (const forbidden of [
      '"orders"',
      '"payment_attempts"',
      '"payments"',
      '"fulfilments"',
      '"webhook_events"',
      '"event_processing_attempts"',
      '"chaos_runs"',
      '"invariant_results"',
    ]) {
      expect(repository, forbidden).not.toContain(forbidden);
    }
  });

  it("18: the projection is an explicit allowlist and there is no retry loop", () => {
    expect(repository).not.toContain('select("*")');
    expect(repository).toContain("RECOMMENDATION_COLUMNS");
    for (const forbidden of ["while (", "for (;;)", "setTimeout", "retry"]) {
      expect(repository, forbidden).not.toContain(forbidden);
    }
  });

  it("19: NO SECRET, NETWORK, AI or later-phase vocabulary", () => {
    for (const forbidden of [
      "RAZORPAY_KEY_SECRET",
      "SUPABASE_SERVICE_ROLE_KEY",
      "SERVICE_ROLE",
      "fetch(",
      "http://",
      "https://",
      "process.env",
      "openai",
      "anthropic",
      "ollama",
      "reliabilityScore",
      "readiness",
      "goLive",
      "regressionRun",
    ]) {
      expect(repository, forbidden).not.toContain(forbidden);
    }
  });
});

describe("Phase 4D-R2 — the pure R1 catalogue stays pure", () => {
  it("20: recommendations.ts is still pure and persists nothing", () => {
    expect(pure).not.toContain("server-only");
    for (const forbidden of [
      "getSupabaseServerClient",
      "@supabase/supabase-js",
      ".from(",
      ".update(",
      ".insert(",
      "diagnosis_summary",
      "recommendation_code",
      "recommendation_text",
      "updated_at",
      "new Date",
      "Math.random",
      "fetch(",
      "process.env",
      "regression_runs",
      "reliabilityScore",
      "readiness",
    ]) {
      expect(pure, forbidden).not.toContain(forbidden);
    }
  });

  it("21: the frozen provenance constants are exact, with TEMPLATE-V1 added", () => {
    expect(pure).toContain("RECOMMENDATION_OUTPUT_VERSION = 1");
    expect(pure).toContain('"RECOMMENDATION-CATALOGUE-V1"');
    expect(pure).toContain(
      'RECOMMENDATION_OUTPUT_SOURCE = "DETERMINISTIC_CATALOGUE"',
    );
    expect(pure).toContain('RECOMMENDATION_TEMPLATE_VERSION = "TEMPLATE-V1"');
    expect(pure).toContain(
      "templateVersion: typeof RECOMMENDATION_TEMPLATE_VERSION",
    );
    expect(pure).toContain("templateVersion: RECOMMENDATION_TEMPLATE_VERSION");
  });

  it("22: the frozen mappings and vocabularies are unchanged", () => {
    const cases = [...pure.matchAll(/case "(RC-\d{3})"/g)].map((m) => m[1]);
    expect(cases).toEqual([
      "RC-001",
      "RC-002",
      "RC-003",
      "RC-009",
      "RC-010",
      "RC-013",
      "RC-014",
      "RC-016",
    ]);

    const start = pure.indexOf("const RECOMMENDATION_CODES");
    const declared = pure
      .slice(start)
      .slice(0, pure.slice(start).indexOf("] as const)"));
    const codes = [...declared.matchAll(/"([A-Z-]+)"/g)].map((m) => m[1]);
    expect(codes).toHaveLength(14);
    expect(new Set(codes).size).toBe(14);
  });
});

describe("Phase 4D-R2 — schema and surface boundaries", () => {
  it("23: PHASE 4D-R2 ADDS NO MIGRATION", () => {
    const migrations = fs
      .readdirSync(path.join(repoRoot, "supabase", "migrations"))
      .filter((name) => name.endsWith(".sql"))
      .sort();
    // Advanced for Phase 4E, which legitimately adds the tenth and last P0
    // table (docs/DATABASE.md Section 18). The protection is unchanged: this
    // phase still contributes NO migration of its own, and the Phase 3G
    // migration remains exactly where it was.
    // Advanced for the Phase 5 Demo Reset fix, which legitimately adds one
    // additive migration (a narrow reset function; no table change). The
    // protection is unchanged: THIS phase still contributes no migration of
    // its own, and the earlier migrations stay exactly where they were.
    expect(migrations).toHaveLength(14);
    expect(migrations.at(-1)).toBe(
      "20260905000000_phase5_demo_reset_atomic.sql",
    );
    expect(migrations.at(-2)).toBe(
      "20260904000000_phase4e_regression_runs.sql",
    );
    expect(migrations.at(-3)).toBe("20260903000000_phase3g_findings.sql");
  });

  it("24: lib/diagnosis contains only the approved Phase 4A-4D modules", () => {
    const entries = fs
      .readdirSync(path.join(repoRoot, "lib", "diagnosis"), {
        withFileTypes: true,
      })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort();
    expect(entries).toEqual([
      "diagnostic-signals-service.ts",
      "diagnostic-signals.ts",
      "evidence-pack-service.ts",
      "evidence-pack.ts",
      "explanation-templates.ts",
      "recommendation-repository.ts",
      "recommendation-service.ts",
      "recommendations.ts",
      "root-cause-classifier.ts",
      "root-cause-repository.ts",
      "root-cause-service.ts",
    ]);
  });

  it("25: PHASE 4D-R2 ADDS NO API ROUTE and NO UI SURFACE", () => {
    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        return entry.isDirectory() ? walk(full) : [full];
      });
    const surfaces = walk(path.join(repoRoot, "app"))
      .map((file) =>
        file.replace(repoRoot, "").split(String.fromCharCode(92)).join("/"),
      )
      .filter((file) =>
        /diagnos|signal|root-cause|recommend|evidence-pack|regression|reliabilit|readiness/i.test(
          file,
        ),
      )
      .sort();

    // ADVANCED, NOT LOOSENED (Phase 4E-R3-A). Phase 4E legitimately adds the
    // minimum regression API required by P4-AC-06, so those two exact route
    // files are now expected. Every other surface this guard protects —
    // diagnosis, signals, root cause, recommendation, evidence pack,
    // reliability and readiness — remains absolutely forbidden, and an
    // unexpected THIRD regression surface would fail here rather than slip
    // in. Phase 4D itself still contributes no route or UI of its own.
    // Advanced again in Phase 4F-R3: the reliability read API and page are
    // now legitimate too. The list stays exact, so an unapproved fifth
    // surface still fails here.
    // Advanced again in Phase 4G: the Go-Live Readiness read API is now a
    // legitimate surface. The list stays EXACT, so an unapproved surface
    // still fails here rather than slipping in.
    expect(surfaces).toEqual([
      "/app/api/findings/[findingId]/diagnose/route.ts",
      "/app/api/findings/[findingId]/regressions/route.ts",
      "/app/api/readiness/route.ts",
      "/app/api/regressions/[regressionRunId]/advance/route.ts",
      "/app/api/reliability/route.ts",
      "/app/reliability/page.tsx",
    ]);
  });

  it("26: the frozen Phase 4C production modules are unchanged in shape", () => {
    const classifier = stripComments(
      read("lib/diagnosis/root-cause-classifier.ts"),
    );
    expect(classifier).not.toContain("server-only");
    expect(classifier).toContain('DIAGNOSIS_RULE_VERSION = "DIAG-RULES-V1"');
    expect(classifier).toContain(
      'DIAGNOSIS_OUTPUT_SOURCE = "DETERMINISTIC_RULES"',
    );

    for (const frozen of [
      "lib/diagnosis/root-cause-repository.ts",
      "lib/diagnosis/root-cause-service.ts",
    ]) {
      expect(stripComments(read(frozen)), frozen).toContain(
        'import "server-only";',
      );
    }
  });
});
