import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Phase 4C-R1 — a static guard over the pure root-cause classifier.
 *
 * The risks here are specific and none is catchable by a type check: the
 * classifier could acquire database access, start writing a Finding's
 * diagnosis columns, read evaluator prose as if it were machine-readable
 * fact, emit a confidence percentage, grow a recommendation catalogue, or
 * quietly rewrite the frozen Phase 4B signal contract to manufacture the
 * evidence a rule wants.
 *
 * Comments are stripped before every content assertion, so the module may
 * explain in prose why something is deliberately excluded.
 */

const repoRoot = path.resolve(import.meta.dirname, "../../../");

const CLASSIFIER_PATH = "lib/diagnosis/root-cause-classifier.ts";

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

const source = stripComments(read(CLASSIFIER_PATH));

const importStatements = source
  .split("\n")
  .filter((line) => line.trimStart().startsWith("import "));

describe("Phase 4C-R1 root-cause classifier — static guard", () => {
  it("1: the production classifier exists and is non-empty", () => {
    expect(fs.existsSync(path.join(repoRoot, CLASSIFIER_PATH))).toBe(true);
    expect(source.length).toBeGreaterThan(0);
  });

  it("2: lib/diagnosis contains only the approved Phase 4A/4B/4C modules", () => {
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

  it("3: PURE — no server-only marker", () => {
    expect(source).not.toContain("server-only");
  });

  it("4: every import comes only from the frozen 4A/4B contracts", () => {
    // Value imports are permitted from the two pure frozen modules (both have
    // zero runtime imports themselves), plus a type-only import of the pure
    // schema-vocabulary declaration file. Nothing else may be imported.
    const allowed = [
      "@/lib/diagnosis/diagnostic-signals",
      "@/lib/diagnosis/evidence-pack",
      "@/lib/supabase/types",
    ];
    expect(importStatements.length).toBeGreaterThan(0);
    for (const statement of importStatements) {
      const from = statement.match(/from\s+"([^"]+)"/);
      // Multi-line import statements end on a later line; only the closing
      // line carries `from`. Those are checked when they appear.
      if (from === null) continue;
      expect(allowed, statement).toContain(from[1]);
    }
    // The supabase vocabulary reference is type-only and appears exactly once.
    const supabaseLines = source
      .split("\n")
      .filter((line) => line.toLowerCase().includes("supabase"));
    expect(supabaseLines).toEqual([
      'import type { InvariantResultEvidenceRef } from "@/lib/supabase/types";',
    ]);
  });

  it("5: NO DATABASE — no client, repository or service", () => {
    for (const forbidden of [
      "@/lib/supabase/server",
      "@supabase/supabase-js",
      "createClient",
      "getSupabaseServerClient",
      "@/lib/findings/repository",
      "@/lib/findings/service",
      "@/lib/findings/run-findings-read",
      "@/lib/evidence/evidence-repository",
      "@/lib/evidence/chaos-evidence-repository",
      "@/lib/evidence/chaos-evidence-service",
      "@/lib/invariants/result-repository",
      "@/lib/invariants/service",
      "@/lib/chaos/repository",
      "@/lib/chaos/run-repository",
      "@/lib/chaos/run-service",
      "@/lib/webhooks/repository",
      "@/lib/diagnosis/evidence-pack-service",
      "@/lib/diagnosis/diagnostic-signals-service",
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it("6: NO WRITE CALL and NO QUERY of any kind", () => {
    for (const forbidden of [
      ".insert(",
      ".update(",
      ".upsert(",
      ".delete(",
      ".rpc(",
      ".from(",
      ".select(",
      ".single(",
      ".maybeSingle(",
      ".eq(",
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it("7: NO FINDING DIAGNOSIS PERSISTENCE — R2 owns that", () => {
    for (const forbidden of [
      "diagnosis_code",
      "diagnosis_strength",
      "diagnosis_summary",
      "recommendation_code",
      "recommendation_text",
      "diagnosed_at",
      "diagnosedAt",
      "persistDiagnosis",
      "updateFindingDiagnosis",
      "insertOpenFinding",
      "createFindingFromInvariantResult",
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it("8: NO RAZORPAY CLIENT and NO NETWORK", () => {
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
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it("9: NO ENVIRONMENT, FILESYSTEM or SHELL access", () => {
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

  it("10: NO CLOCK and NO RANDOMNESS — identical input, identical output", () => {
    for (const forbidden of [
      "Date.now",
      "new Date",
      "Date(",
      "Math.random",
      "crypto.randomUUID",
      "toISOString",
      "performance.now",
      "generatedAt",
      "classifiedAt",
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

  it("12: NO AI / ML / LLM — P0 diagnosis needs no runtime model", () => {
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
      "inference",
      "sklearn",
      "modelName",
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it("13: NO RECOMMENDATION vocabulary — Phase 4D owns that", () => {
    for (const forbidden of [
      "recommendationCode",
      "recommendationText",
      "recommendationCatalogue",
      "FIX-IDEMPOTENCY",
      "FIX-SIGNATURE",
      "FIX-CLIENT-INDEPENDENCE",
      "FIX-STATE-MACHINE",
      "FIX-RECONCILIATION",
      "FIX-AMOUNT-CURRENCY-VALIDATION",
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it("14: NO REGRESSION, SCORE or READINESS logic", () => {
    for (const forbidden of [
      "regression_runs",
      "regressionRun",
      "regressionEngine",
      "retest",
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

  it("15: NO CONFIDENCE PERCENTAGE — evidence strength only", () => {
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
    // The three approved labels, and only those, form the strength vocabulary.
    expect(source).toContain('"STRONG_EVIDENCE"');
    expect(source).toContain('"PARTIAL_EVIDENCE"');
    expect(source).toContain('"INSUFFICIENT_EVIDENCE"');
  });

  it("16: PROSE IS NEVER READ as executable evidence", () => {
    for (const forbidden of [
      "expectedSummary",
      "observedSummary",
      "finding.title",
      ".title",
      ".reason",
      "invariant.severity",
      ".severity",
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it("17: the classifier consumes the frozen Evidence Pack and Signal Set", () => {
    expect(source).toContain("DiagnosisEvidencePackV1");
    expect(source).toContain("DiagnosticSignalSetV1");
    expect(source).toContain("DIAGNOSTIC_SIGNAL_CODES");
    expect(source).toContain("DIAGNOSTIC_SIGNAL_VERSION");
    expect(source).toContain("export function classifyRootCause");
  });

  it("18: the frozen rule version and output source are pinned", () => {
    expect(source).toContain('DIAGNOSIS_RULE_VERSION = "DIAG-RULES-V1"');
    expect(source).toContain('DIAGNOSIS_OUTPUT_SOURCE = "DETERMINISTIC_RULES"');
  });

  it("19: all sixteen frozen RC codes are declared, none invented", () => {
    const declared = [...source.matchAll(/code: "(RC-\d{3})"/g)].map(
      (match) => match[1],
    );
    const unique = [...new Set(declared)].sort();
    expect(unique).toEqual([
      "RC-001",
      "RC-002",
      "RC-003",
      "RC-004",
      "RC-005",
      "RC-006",
      "RC-007",
      "RC-008",
      "RC-009",
      "RC-010",
      "RC-011",
      "RC-012",
      "RC-013",
      "RC-014",
      "RC-015",
      "RC-016",
    ]);
    // No RC code outside the frozen taxonomy exists anywhere in the module.
    const anyCode = [
      ...new Set([...source.matchAll(/RC-\d{3}/g)].map((m) => m[0])),
    ];
    for (const code of anyCode) {
      expect(unique, code).toContain(code);
    }
  });

  it("20: NO API ROUTE or UI dependency", () => {
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

  it("21: PHASE 4C-R1 ADDS NO MIGRATION", () => {
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

  it("22: PHASE 4C-R1 ADDS NO API ROUTE and NO UI SURFACE", () => {
    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        return entry.isDirectory() ? walk(full) : [full];
      });
    const surfaces = walk(path.join(repoRoot, "app")).filter((file) =>
      /diagnos|signal|root-cause|evidence-pack|recommend|reliabilit|readiness/i.test(
        file,
      ),
    );
    // ADVANCED, NOT LOOSENED (Phase 4F-R3). Phase 4F legitimately adds the
    // reliability read API and page required by P4-AC-10/11, so those two
    // exact files are now expected. Every other surface this guard protects
    // remains absolutely forbidden, and an unexpected THIRD reliability
    // surface would fail here rather than slip in. This phase itself still
    // contributes no route or UI of its own.
    const normalised = surfaces
      .map((file) =>
        file.replace(repoRoot, "").split(String.fromCharCode(92)).join("/"),
      )
      .sort();
    // Advanced again in Phase 4G: the Go-Live Readiness read API is now a
    // legitimate surface. The list stays EXACT, so an unapproved surface
    // still fails here rather than slipping in.
    expect(normalised).toEqual([
      "/app/api/readiness/route.ts",
      "/app/api/reliability/route.ts",
      "/app/reliability/page.tsx",
    ]);
  });

  it("23: NO R2 SERVER ORCHESTRATION exists yet", () => {
    expect(source).not.toContain("classifyRootCauseForFinding");
    expect(source).not.toContain("async function");
    expect(source).not.toContain("await ");
  });

  // ------------------------------------------------------- frozen 4A / 4B

  it("24: the frozen Phase 4B signal contract is unchanged", () => {
    const signalSource = stripComments(
      read("lib/diagnosis/diagnostic-signals.ts"),
    );
    const approved = [
      "DUPLICATE_EVENT_ATTEMPTS",
      "DUPLICATE_FULFILMENTS",
      "DIFFERENT_FULFILMENT_IDEMPOTENCY_KEYS",
      "SAME_LOGICAL_PAYMENT",
      "INVALID_SIGNATURE_MUTATED_STATE",
      "CLIENT_CONFIRMATION_MISSING",
      "PAYMENT_CAPTURED_VIA_WEBHOOK",
      "CAPTURE_EXISTS_ORDER_NOT_PAID",
      "FAILURE_EVENT_MARKED_PAID",
      "OUT_OF_ORDER_STATE_REGRESSION",
      "REPLAY_CHANGED_FINAL_STATE",
      "AMOUNT_MISMATCH",
      "CURRENCY_MISMATCH",
    ] as const;

    const start = signalSource.indexOf("const SIGNAL_CODES");
    const declared = signalSource
      .slice(start)
      .slice(0, signalSource.slice(start).indexOf("]"));
    const found = [...declared.matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]);
    // Exactly thirteen, in the frozen order: 4C adds no signal and rewrites
    // none.
    expect(found).toEqual([...approved]);
    expect(signalSource).toContain("DIAGNOSTIC_SIGNAL_VERSION = 1");
  });

  it("25: the frozen 4A and 4B pure modules still have zero runtime imports", () => {
    for (const frozen of [
      "lib/diagnosis/evidence-pack.ts",
      "lib/diagnosis/diagnostic-signals.ts",
    ]) {
      const text = stripComments(read(frozen));
      const imports = text
        .split("\n")
        .filter((line) => line.trimStart().startsWith("import "));
      expect(imports.length, frozen).toBeGreaterThan(0);
      for (const statement of imports) {
        expect(statement.trimStart(), `${frozen}: ${statement}`).toMatch(
          /^import type\b/,
        );
      }
      expect(text, frozen).not.toContain("server-only");
    }
  });

  it("26: the frozen 4A and 4B server modules still declare server-only", () => {
    for (const frozen of [
      "lib/diagnosis/evidence-pack-service.ts",
      "lib/diagnosis/diagnostic-signals-service.ts",
    ]) {
      expect(stripComments(read(frozen)), frozen).toContain(
        'import "server-only";',
      );
    }
  });
});
