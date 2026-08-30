import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Phase 4B-R1 — a static guard over the deterministic signal module.
 *
 * The risks here are specific and none is catchable by a type check: the
 * module could acquire database access, start reading evaluator prose as if it
 * were machine-readable fact, quietly grow a root-cause taxonomy, or begin
 * emitting evidence-strength labels that belong to a later sub-phase.
 *
 * Comments are stripped before every content assertion, so the module may
 * explain in prose why something is deliberately excluded.
 */

const repoRoot = path.resolve(import.meta.dirname, "../../../");

const SIGNAL_PATH = "lib/diagnosis/diagnostic-signals.ts";

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

const source = stripComments(read(SIGNAL_PATH));

const importStatements = source
  .split("\n")
  .filter((line) => line.trimStart().startsWith("import "));

describe("Phase 4B-R1 signal module — static guard", () => {
  it("1: the approved production signal module exists and is non-empty", () => {
    expect(fs.existsSync(path.join(repoRoot, SIGNAL_PATH))).toBe(true);
    expect(source.length).toBeGreaterThan(0);
  });

  it("2: lib/diagnosis contains only the approved Phase 4A/4B modules", () => {
    // Advanced by exact approved filename each time a module is approved:
    // 4B-R2 added the server-only signal orchestration service, and 4C-R1
    // adds the pure root-cause classifier. The list is never loosened to
    // "any .ts file" — an unapproved production capability appearing in this
    // directory must still fail.
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
      "root-cause-classifier.ts",
    ]);
  });

  it("3: PURE — every import is type-only, so there is no runtime dependency", () => {
    expect(importStatements.length).toBeGreaterThan(0);
    for (const statement of importStatements) {
      expect(statement.trimStart(), statement).toMatch(/^import type\b/);
    }
    expect(source).not.toContain("server-only");
  });

  it("4: NO DATABASE and NO SECOND EVIDENCE MODEL", () => {
    for (const forbidden of [
      "@/lib/supabase/server",
      "@supabase/supabase-js",
      "createClient",
      "getSupabaseServerClient",
      "@/lib/findings/repository",
      "@/lib/findings/service",
      "@/lib/evidence/chaos-evidence-repository",
      "@/lib/evidence/chaos-evidence-service",
      "@/lib/evidence/evidence-repository",
      ".from(",
      ".select(",
      ".insert(",
      ".update(",
      ".upsert(",
      ".delete(",
      ".rpc(",
      ".eq(",
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it("5: NO NETWORK, ENVIRONMENT, FILESYSTEM or PROCESS access", () => {
    for (const forbidden of [
      "fetch(",
      "XMLHttpRequest",
      "process.env",
      "node:fs",
      "node:child_process",
      "readFileSync",
      "execSync",
      "spawn",
      "require(",
      "http://",
      "https://",
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it("6: NO CLOCK and NO RANDOMNESS — the same pack always yields the same set", () => {
    for (const forbidden of [
      "Date.now",
      "new Date",
      "Math.random",
      "crypto.randomUUID",
      "toISOString",
      "performance.now",
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it("7: NO AI PROVIDER and NO RAZORPAY CLIENT", () => {
    for (const forbidden of [
      "openai",
      "OpenAI",
      "anthropic",
      "Anthropic",
      "ollama",
      "Ollama",
      "@/lib/razorpay",
      "new Razorpay",
      "api.razorpay.com",
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it("8: NO SECRET is named or read", () => {
    for (const forbidden of [
      "RAZORPAY_KEY_SECRET",
      "RAZORPAY_WEBHOOK_SECRET",
      "SUPABASE_SERVICE_ROLE_KEY",
      "PAYCHAOS_ACCESS_TOKEN",
      "PAYCHAOS_SESSION_SECRET",
      "SERVICE_ROLE",
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it("9: NO PHASE 4C+ LOGIC — no root cause, strength, recommendation, score or readiness", () => {
    for (const forbidden of [
      "RC-0",
      "MISSING_EVENT_IDEMPOTENCY",
      "MISSING_BUSINESS_IDEMPOTENCY",
      "INVALID_SIGNATURE_HANDLING",
      "rootCause",
      "ROOT_CAUSE",
      "STRONG_EVIDENCE",
      "PARTIAL_EVIDENCE",
      "INSUFFICIENT_EVIDENCE",
      "diagnosisCode",
      "diagnosis_code",
      "diagnosisStrength",
      "recommendationCode",
      "recommendationText",
      "FIX-IDEMPOTENCY",
      "reliabilityScore",
      "RELIABILITY-V1",
      "readiness",
      "goLive",
      "regression_runs",
      "regressionRun",
      "confidence",
      "probability",
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it("10: PROSE IS NEVER READ as signal truth", () => {
    // These carry deterministic evaluator wording, not machine-readable facts.
    // The module must never branch on any of them.
    for (const forbidden of [
      "expectedSummary",
      "observedSummary",
      ".reason",
      "finding.title",
      "invariant.severity",
      ".severity",
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it("11: the frozen signal vocabulary is exactly the approved thirteen", () => {
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

    const declared = source
      .slice(source.indexOf("const SIGNAL_CODES"))
      .slice(
        0,
        source.slice(source.indexOf("const SIGNAL_CODES")).indexOf("]"),
      );

    for (const code of approved) {
      expect(declared, code).toContain(`"${code}"`);
    }
    // Exactly thirteen entries, in the frozen order.
    const found = [...declared.matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]);
    expect(found).toEqual([...approved]);
  });

  it("12: the three-state model is used, not a boolean", () => {
    expect(source).toContain('"PRESENT"');
    expect(source).toContain('"ABSENT"');
    expect(source).toContain('"UNKNOWN"');
    expect(source).toContain("DiagnosticSignalState");
  });

  it("13: PHASE 4B-R1 ADDS NO MIGRATION", () => {
    const migrations = fs
      .readdirSync(path.join(repoRoot, "supabase", "migrations"))
      .filter((name) => name.endsWith(".sql"))
      .sort();
    expect(migrations).toHaveLength(12);
    expect(migrations.at(-1)).toBe("20260903000000_phase3g_findings.sql");
  });

  it("14: PHASE 4B-R1 ADDS NO API ROUTE and NO UI", () => {
    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        return entry.isDirectory() ? walk(full) : [full];
      });
    const surfaces = walk(path.join(repoRoot, "app")).filter((file) =>
      /diagnos|signal|evidence-pack|recommend|reliabilit|readiness/i.test(file),
    );
    expect(surfaces).toEqual([]);
  });

  it("15: NO R2 SERVER ORCHESTRATION exists yet", () => {
    // The server wrapper is Phase 4B-R2 and must not appear here.
    expect(source).not.toContain("assembleDiagnosticSignalsForFinding");
    expect(source).not.toContain("async function");
    expect(source).not.toContain("await ");
  });

  it("16: the Phase 4A pure builder remains untouched — still zero runtime imports", () => {
    const builder = stripComments(read("lib/diagnosis/evidence-pack.ts"));
    const imports = builder
      .split("\n")
      .filter((line) => line.trimStart().startsWith("import "));
    expect(imports.length).toBeGreaterThan(0);
    for (const statement of imports) {
      expect(statement.trimStart(), statement).toMatch(/^import type\b/);
    }
    expect(builder).not.toContain("server-only");
  });
});
