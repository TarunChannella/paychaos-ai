import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Phase 4D-R1 — a static guard over the pure recommendation catalogue.
 *
 * The risks here are specific and none is catchable by a type check: the
 * module sits one step from advice a human will act on, so it could acquire
 * database access, start writing Finding columns, execute a regression, reach
 * for an AI provider to phrase remediation, read evaluator prose as fact, or
 * quietly grow scoring and readiness logic that belongs to 4F/4G.
 *
 * Comments are stripped before every content assertion, so the module may
 * explain in prose why something is deliberately excluded.
 */

const repoRoot = path.resolve(import.meta.dirname, "../../../");

const MODULE_PATH = "lib/diagnosis/recommendations.ts";

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

const source = stripComments(read(MODULE_PATH));

const importStatements = source
  .split("\n")
  .filter((line) => line.trimStart().startsWith("import "));

describe("Phase 4D-R1 recommendations — purity", () => {
  it("1: the production module exists and is non-empty", () => {
    expect(fs.existsSync(path.join(repoRoot, MODULE_PATH))).toBe(true);
    expect(source.length).toBeGreaterThan(0);
  });

  it("2: PURE — no server-only marker", () => {
    expect(source).not.toContain("server-only");
  });

  it("3: it consumes only frozen pure Phase 4A/4B/4C contracts", () => {
    const allowed = [
      "@/lib/diagnosis/root-cause-classifier",
      "@/lib/diagnosis/diagnostic-signals",
      "@/lib/diagnosis/evidence-pack",
      "@/lib/supabase/types",
    ];
    expect(importStatements.length).toBeGreaterThan(0);
    for (const statement of importStatements) {
      const from = statement.match(/from\s+"([^"]+)"/);
      if (from === null) continue;
      expect(allowed, statement).toContain(from[1]);
    }
    // The schema-vocabulary reference is type-only and appears exactly once.
    const supabaseLines = source
      .split("\n")
      .filter((line) => line.toLowerCase().includes("supabase"));
    expect(supabaseLines).toEqual([
      'import type { InvariantResultEvidenceRef } from "@/lib/supabase/types";',
    ]);
  });

  it("4: NO DATABASE — no client, repository or service", () => {
    for (const forbidden of [
      "@/lib/supabase/server",
      "@supabase/supabase-js",
      "createClient",
      "getSupabaseServerClient",
      "@/lib/diagnosis/evidence-pack-service",
      "@/lib/diagnosis/diagnostic-signals-service",
      "@/lib/diagnosis/root-cause-service",
      "@/lib/diagnosis/root-cause-repository",
      "@/lib/findings/repository",
      "@/lib/findings/service",
      "@/lib/evidence/evidence-repository",
      "@/lib/invariants/result-repository",
      "@/lib/chaos/run-repository",
      "@/lib/chaos/run-service",
      ".from(",
      ".select(",
      ".insert(",
      ".update(",
      ".upsert(",
      ".delete(",
      ".rpc(",
      ".eq(",
      ".is(",
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it("5: NO PERSISTENCE of any diagnosis or recommendation field", () => {
    for (const forbidden of [
      "diagnosis_code",
      "diagnosis_strength",
      "diagnosis_summary",
      "recommendation_code",
      "recommendation_text",
      "diagnosed_at",
      "updated_at",
      "persistFindingDiagnosis",
      "persistRecommendation",
      "updateFinding",
      "insertOpenFinding",
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it("6: NO FINDING STATUS or lifecycle mutation", () => {
    for (const forbidden of [
      "resolved_at",
      "resolvedAt",
      "STILL_FAILING",
      '"RESOLVED"',
      '"OPEN"',
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it("7: NO RAZORPAY CLIENT and NO NETWORK", () => {
    for (const forbidden of [
      "@/lib/razorpay",
      "razorpay-node",
      "new Razorpay",
      "api.razorpay.com",
      "fetch(",
      "XMLHttpRequest",
      "http://",
      "https://",
      "targetUrl",
      "webhookUrl",
      "endpoint",
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it("8: NO ENVIRONMENT, FILESYSTEM or SHELL access", () => {
    for (const forbidden of [
      "process.env",
      "node:fs",
      "node:child_process",
      "node:os",
      "readFileSync",
      "writeFileSync",
      "execSync",
      "spawn",
      "require(",
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it("9: NO CODE EXECUTION — this module gives advice, it never applies it", () => {
    for (const forbidden of [
      "eval(",
      "new Function",
      "Function(",
      "vm.runIn",
      "exec(",
      "child_process",
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it("10: NO CLOCK and NO RANDOMNESS — R1 is timeless", () => {
    for (const forbidden of [
      "Date.now",
      "new Date",
      "Date(",
      "Math.random",
      "crypto.randomUUID",
      "toISOString",
      "performance.now",
      "generatedAt",
      "createdAt",
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it("11: NO SECRET is named or read", () => {
    for (const forbidden of [
      "RAZORPAY_KEY_SECRET",
      "RAZORPAY_WEBHOOK_SECRET",
      "SUPABASE_SERVICE_ROLE_KEY",
      "PAYCHAOS_ACCESS_TOKEN",
      "PAYCHAOS_SESSION_SECRET",
      "SERVICE_ROLE",
      "keySecret",
      "webhookSecret",
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it("12: NO AI / ML / LLM — remediation wording is a frozen template", () => {
    for (const forbidden of [
      "openai",
      "OpenAI",
      "anthropic",
      "Anthropic",
      "ollama",
      "Ollama",
      "sk-",
      "gpt-",
      "claude-",
      "prompt",
      "embedding",
      "inferenceEngine",
      "sklearn",
      "modelName",
      "temperature",
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it("12b: NO DUPLICATED scenario -> invariant-set mapping is declared here", () => {
    // Resolving a scenario to its required invariant set belongs to Phase 4E
    // and must use the authoritative scenario registry. A second copy here
    // would be free to drift from the frozen mapping.
    for (const scenario of ["C01", "C03", "C07", "C11"]) {
      // No `C01: [...]` / `"C01": [...]` map entry of any quoting style.
      expect(source, scenario).not.toMatch(
        new RegExp(`["'\`]?${scenario}["'\`]?\\s*:\\s*\\[`),
      );
    }
    // No invariant-id array literal at all.
    expect(source).not.toMatch(/\[\s*["'`]INV-\d{3}["'`]/);
    // And no import of the scenario/invariant registries.
    for (const forbidden of [
      "@/lib/chaos/registry",
      "@/lib/chaos/scenarios",
      "@/lib/invariants/registry",
      "listInvariantDefinitions",
      "getInvariantDefinition",
      "getScenarioDefinition",
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it("12c: IT CONSUMES A DIAGNOSIS — it never runs a second one", () => {
    // Importing the classifier module is legitimate and expected: the frozen
    // taxonomy, constants and types come from it. What must never happen is
    // this module RUNNING diagnosis itself, which would create a second
    // version of the truth.
    for (const forbidden of [
      "classifyRootCause(",
      "extractDiagnosticSignals(",
      "assembleDiagnosticSignalsForFinding(",
      "assembleDiagnosisEvidencePackForFinding(",
      "@/lib/diagnosis/diagnostic-signals-service",
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }

    // Nor may it rebuild a ranking engine of its own.
    for (const forbidden of [
      "compareCandidates",
      "rankCandidates",
      "MATCH_TIER_ORDER",
      "STRENGTH_ORDER",
      "RULE_PRECEDENCE",
      ".sort(",
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }

    // It consumes the ranked winner and validates it instead.
    expect(source).toContain("rankedCandidates[0]");
    expect(source).toContain("assertClassificationSelection");
    expect(source).toContain("ROOT_CAUSE_TAXONOMY");
  });

  it("13: NO REGRESSION EXECUTION — 4D recommends, 4E runs", () => {
    for (const forbidden of [
      "regression_runs",
      "regressionRunId",
      "startRegression",
      "runRegression",
      "executeScenario",
      "executeChaos",
      "@/lib/chaos/runner",
      "@/lib/chaos/execution",
      "replayEvent",
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it("14: NO RELIABILITY SCORE and NO GO-LIVE READINESS", () => {
    for (const forbidden of [
      "reliabilityScore",
      "RELIABILITY-V1",
      "scoreBreakdown",
      "readiness",
      "goLive",
      "GO_LIVE",
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it("15: NO CONFIDENCE PERCENTAGE or probability", () => {
    for (const forbidden of [
      "confidence",
      "probability",
      "percent",
      "likelihood",
      '"HIGH"',
      '"MEDIUM"',
      '"LOW"',
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it("16: PROSE IS NEVER READ as evidence", () => {
    // The bare suffix `.title` is NOT banned: this module legitimately emits
    // its own frozen `template.title` and `recommendation.title`. What must
    // never appear is a read of the Finding's or evaluator's prose fields.
    for (const forbidden of [
      "expectedSummary",
      "observedSummary",
      "finding.title",
      "pack.finding.title",
      ".reason",
      "invariant.severity",
      ".severity",
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
    // Every `.title` read in the module is on a local template or on the
    // module's own output shape, never on the supplied pack.
    for (const match of source.matchAll(/(\w+)\.title/g)) {
      expect(["template", "recommendation"], match[0]).toContain(match[1]);
    }
  });

  it("17: NO API ROUTE or UI dependency", () => {
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
      expect(source, forbidden).not.toContain(forbidden);
    }
  });
});

describe("Phase 4D-R1 — frozen vocabularies", () => {
  it("18: the version, catalogue version and output source are pinned", () => {
    expect(source).toContain("RECOMMENDATION_OUTPUT_VERSION = 1");
    expect(source).toContain(
      'RECOMMENDATION_CATALOGUE_VERSION =\n  "RECOMMENDATION-CATALOGUE-V1"',
    );
    expect(source).toContain(
      'RECOMMENDATION_OUTPUT_SOURCE = "DETERMINISTIC_CATALOGUE"',
    );
    // Approved 4D-R2 compatibility addition: template provenance only.
    expect(source).toContain('RECOMMENDATION_TEMPLATE_VERSION = "TEMPLATE-V1"');
  });

  it("19: the recommendation-code vocabulary is exactly the approved fourteen", () => {
    const start = source.indexOf("const RECOMMENDATION_CODES");
    expect(start).toBeGreaterThan(-1);
    const declared = source
      .slice(start)
      .slice(0, source.slice(start).indexOf("] as const)"));
    const found = [...declared.matchAll(/"([A-Z-]+)"/g)].map((m) => m[1]);
    expect(found).toEqual([
      "FIX-IDEMPOTENCY",
      "FIX-BUSINESS-IDEMPOTENCY",
      "FIX-WEBHOOK-AUTH",
      "FIX-STATE-MACHINE",
      "FIX-WEBHOOK-TIMEOUT",
      "FIX-RETRY-HANDLING",
      "FIX-TRANSACTION-ATOMICITY",
      "FIX-CLIENT-INDEPENDENCE",
      "FIX-RECONCILIATION",
      "FIX-PROVENANCE",
      "FIX-UNSUPPORTED-EVENT-GUARD",
      "FIX-PAYMENT-FAILURE-GUARD",
      "FIX-AMOUNT-CURRENCY-VALIDATION",
      "INVESTIGATE-EVIDENCE-GAP",
    ]);
    expect(new Set(found).size).toBe(14);
  });

  it("20: no unapproved FIX- code is invented anywhere in the module", () => {
    const approved = new Set([
      "FIX-IDEMPOTENCY",
      "FIX-BUSINESS-IDEMPOTENCY",
      "FIX-WEBHOOK-AUTH",
      "FIX-STATE-MACHINE",
      "FIX-WEBHOOK-TIMEOUT",
      "FIX-RETRY-HANDLING",
      "FIX-TRANSACTION-ATOMICITY",
      "FIX-CLIENT-INDEPENDENCE",
      "FIX-RECONCILIATION",
      "FIX-PROVENANCE",
      "FIX-UNSUPPORTED-EVENT-GUARD",
      "FIX-PAYMENT-FAILURE-GUARD",
      "FIX-AMOUNT-CURRENCY-VALIDATION",
    ]);
    for (const match of source.matchAll(/FIX-[A-Z-]+/g)) {
      expect(approved, match[0]).toContain(match[0]);
    }
  });

  it("21: the executable root-cause set is exactly the approved eight", () => {
    const start = source.indexOf("ACTIVE_RECOMMENDATION_ROOT_CAUSE_CODES");
    expect(start).toBeGreaterThan(-1);
    const declared = source
      .slice(start)
      .slice(0, source.slice(start).indexOf("]);"));
    const found = [...declared.matchAll(/"(RC-\d{3})"/g)].map((m) => m[1]);
    expect(found).toEqual([
      "RC-001",
      "RC-002",
      "RC-003",
      "RC-009",
      "RC-010",
      "RC-013",
      "RC-014",
      "RC-016",
    ]);
  });

  it("22: the eight inactive root causes have no EXECUTABLE selection rule", () => {
    // The rule is about executable selection, not vocabulary. A comment or a
    // type description may legitimately name an inactive code to explain why
    // it is deferred; what must not exist is a way to REACH remediation for
    // one.
    const inactive = [
      "RC-004",
      "RC-005",
      "RC-006",
      "RC-007",
      "RC-008",
      "RC-011",
      "RC-012",
      "RC-015",
    ] as const;

    const activeStart = source.indexOf(
      "ACTIVE_RECOMMENDATION_ROOT_CAUSE_CODES",
    );
    const activeList = source
      .slice(activeStart)
      .slice(0, source.slice(activeStart).indexOf("]);"));

    const selectStart = source.indexOf("function selectTemplate");
    expect(selectStart).toBeGreaterThan(-1);
    const selectBody = source.slice(
      selectStart,
      source.indexOf("\n}", selectStart),
    );

    for (const code of inactive) {
      // Not an executable active outcome.
      expect(activeList, code).not.toContain(`"${code}"`);
      // No case label selecting remediation for it.
      expect(selectBody, code).not.toContain(`case "${code}"`);
      // No executable map entry of any shape.
      expect(source, code).not.toMatch(
        new RegExp(`["'\`]?${code}["'\`]?\\s*:`),
      );
    }

    // Only the eight approved outcomes have a case label.
    const cases = [...selectBody.matchAll(/case "(RC-\d{3})"/g)].map(
      (m) => m[1],
    );
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
  });

  it("23: provenance wording never falsely attributes a controlled fault to the provider", () => {
    // The provider NAME is not banned outright — the real rule is that a
    // PayChaos-controlled replay or injected fault must never be described as
    // something the provider did.
    const lowered = source.toLowerCase();
    for (const forbidden of [
      "razorpay duplicated the payment",
      "razorpay duplicated the event",
      "razorpay duplicated",
      "razorpay replayed",
      "razorpay sent an invalid webhook",
      "razorpay sent an invalid signature",
      "razorpay failed",
      "provider duplicated",
      "provider replayed",
      "provider failed the payment",
    ]) {
      expect(lowered, forbidden).not.toContain(forbidden);
    }

    // The required provenance-correct wording is present.
    expect(source).toContain("A PayChaos replay changed protected final");
    expect(source).toContain("The controlled invalid-signature test");
    expect(source).toContain(
      "Client confirmation was intentionally absent in the controlled test.",
    );
  });
});

describe("Phase 4D-R1 — frozen upstream modules unchanged", () => {
  it("24: lib/diagnosis contains only the approved Phase 4A/4B/4C/4D modules", () => {
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
      "recommendation-repository.ts",
      "recommendation-service.ts",
      "recommendations.ts",
      "root-cause-classifier.ts",
      "root-cause-repository.ts",
      "root-cause-service.ts",
    ]);
  });

  it("25: the frozen 4A/4B/4C pure modules still have no runtime I/O", () => {
    for (const frozen of [
      "lib/diagnosis/evidence-pack.ts",
      "lib/diagnosis/diagnostic-signals.ts",
      "lib/diagnosis/root-cause-classifier.ts",
    ]) {
      const text = stripComments(read(frozen));
      expect(text, frozen).not.toContain("server-only");
      for (const forbidden of [
        "getSupabaseServerClient",
        "@supabase/supabase-js",
        ".from(",
        ".update(",
        "fetch(",
        "process.env",
        "Math.random",
      ]) {
        expect(text, `${frozen}: ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("26: the frozen 4C production contract is unchanged", () => {
    const classifier = stripComments(
      read("lib/diagnosis/root-cause-classifier.ts"),
    );
    expect(classifier).toContain("ROOT_CAUSE_CLASSIFICATION_VERSION = 1");
    expect(classifier).toContain('DIAGNOSIS_RULE_VERSION = "DIAG-RULES-V1"');
    expect(classifier).toContain(
      'DIAGNOSIS_OUTPUT_SOURCE = "DETERMINISTIC_RULES"',
    );

    const repository = stripComments(
      read("lib/diagnosis/root-cause-repository.ts"),
    );
    const service = stripComments(read("lib/diagnosis/root-cause-service.ts"));
    expect(repository).toContain('import "server-only";');
    expect(service).toContain('import "server-only";');
  });

  it("27: PHASE 4D-R1 ADDS NO MIGRATION", () => {
    const migrations = fs
      .readdirSync(path.join(repoRoot, "supabase", "migrations"))
      .filter((name) => name.endsWith(".sql"))
      .sort();
    // Advanced for Phase 4E, which legitimately adds the tenth and last P0
    // table (docs/DATABASE.md Section 18). The protection is unchanged: this
    // phase still contributes NO migration of its own, and the Phase 3G
    // migration remains exactly where it was.
    expect(migrations).toHaveLength(13);
    expect(migrations.at(-1)).toBe(
      "20260904000000_phase4e_regression_runs.sql",
    );
    expect(migrations.at(-2)).toBe("20260903000000_phase3g_findings.sql");
  });

  it("28: PHASE 4D-R1 ADDS NO API ROUTE and NO UI SURFACE", () => {
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
    expect(surfaces).toEqual([
      "/app/api/findings/[findingId]/regressions/route.ts",
      "/app/api/regressions/[regressionRunId]/advance/route.ts",
      "/app/api/reliability/route.ts",
      "/app/reliability/page.tsx",
    ]);
  });

  it("29: NO R2 SERVER ORCHESTRATION exists yet", () => {
    expect(source).not.toContain("recommendFinding");
    expect(source).not.toContain("async function");
    expect(source).not.toContain("await ");
  });
});
