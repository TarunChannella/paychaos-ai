import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Phase 4B-R2 — a static guard over the diagnostic signal orchestration
 * service.
 *
 * The risks here are specific and none is catchable by a type check: the
 * service could acquire its own database reader and become a second evidence
 * surface, start writing diagnosis columns, quietly reimplement a signal rule,
 * soften a read failure, or grow a root-cause taxonomy that belongs to 4C.
 *
 * Comments are stripped before every content assertion, so the module may
 * explain in prose why something is deliberately excluded.
 */

const repoRoot = path.resolve(import.meta.dirname, "../../../");

const SERVICE_PATH = "lib/diagnosis/diagnostic-signals-service.ts";

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

const source = stripComments(read(SERVICE_PATH));

const importStatements = source
  .split("\n")
  .filter((line) => line.trimStart().startsWith("import "));

describe("Phase 4B-R2 signal service — static guard", () => {
  it("1: the service exists, is non-empty and lives under lib/diagnosis", () => {
    expect(fs.existsSync(path.join(repoRoot, SERVICE_PATH))).toBe(true);
    expect(source.length).toBeGreaterThan(0);
  });

  it("2: SERVER ONLY — the module declares the server-only boundary", () => {
    expect(source).toContain('import "server-only";');
  });

  it("3: it uses the APPROVED evidence pack service and the APPROVED pure extractor", () => {
    expect(source).toContain('} from "@/lib/diagnosis/evidence-pack-service";');
    expect(source).toContain("assembleDiagnosisEvidencePackForFinding");
    expect(source).toContain('} from "@/lib/diagnosis/diagnostic-signals";');
    expect(source).toContain("extractDiagnosticSignals");
    expect(source).toContain("assembleDiagnosticSignalsForFinding");
  });

  it("4: ONE EVIDENCE SURFACE — no direct database client or repository", () => {
    for (const forbidden of [
      "@/lib/supabase/server",
      "@supabase/supabase-js",
      "createClient",
      "getSupabaseServerClient",
      "@/lib/evidence/evidence-repository",
      "@/lib/evidence/chaos-evidence-repository",
      "@/lib/evidence/chaos-evidence-service",
      "@/lib/findings/repository",
      "@/lib/findings/service",
      "@/lib/findings/run-findings-read",
      "@/lib/invariants/result-repository",
      "@/lib/invariants/service",
      "@/lib/chaos/repository",
      "@/lib/chaos/run-repository",
      "@/lib/chaos/run-service",
      "@/lib/webhooks/repository",
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it("5: NO SECOND EVIDENCE ASSEMBLER is constructed here", () => {
    for (const forbidden of [
      "buildDiagnosisEvidencePack",
      "assembleChaosRunEvidence",
      "loadChaosRunEvidenceSource",
      "captureMerchantStateSnapshotForProcessingAttempt",
      "buildMerchantStateSnapshot",
      "parseMerchantStateSnapshotV1",
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it("6: NO DIRECT payment, order, fulfilment or webhook read", () => {
    for (const forbidden of [
      ".from(",
      ".select(",
      ".eq(",
      ".single(",
      ".maybeSingle(",
      '"orders"',
      '"payment_attempts"',
      '"payments"',
      '"fulfilments"',
      '"webhook_events"',
      '"event_processing_attempts"',
      '"chaos_runs"',
      '"invariant_results"',
      '"findings"',
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it("7: NO WRITES — no mutating call and no write-capable function is named", () => {
    for (const forbidden of [
      ".insert(",
      ".update(",
      ".upsert(",
      ".delete(",
      ".rpc(",
      "insertOpenFinding",
      "createFindingFromInvariantResult",
      "generateFindingsForChaosRun",
      "persistInvariantResult",
      "finalizeChaosRunOutcome",
      "persistProcessingStateBefore",
      "persistProcessingStateAfter",
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it("8: NO DIAGNOSIS COLUMN is written", () => {
    for (const forbidden of [
      "diagnosis_code",
      "diagnosis_strength",
      "diagnosis_summary",
      "recommendation_code",
      "recommendation_text",
      "diagnosed_at",
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it("9: NO RAZORPAY CLIENT and NO NETWORK", () => {
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

  it("10: NO ENVIRONMENT DUMP, FILESYSTEM or SHELL access", () => {
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

  it("12: NO AI PROVIDER — P0 diagnosis needs no paid runtime API", () => {
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
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it("13: NO PHASE 4C+ LOGIC in executable code", () => {
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
      "evidenceStrength",
      "diagnosisCode",
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

  it("14: NO SIGNAL RULE is reimplemented here", () => {
    // The thirteen codes and the three states belong to the frozen R1 module.
    // Naming any of them here would mean a second copy of the semantics.
    for (const forbidden of [
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
      '"PRESENT"',
      '"ABSENT"',
      '"UNKNOWN"',
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it("15: NO READ FAILURE is softened into evidence", () => {
    // No catch, and no substituted empty result: a failure must escape.
    expect(source).not.toMatch(/\bcatch\b/);
    expect(source).not.toContain("?? null");
    expect(source).not.toContain("return null");
    expect(source).not.toContain("signals: []");
  });

  it("16: NO API ROUTE or UI dependency", () => {
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

  it("17: PHASE 4B-R2 ADDS NO MIGRATION", () => {
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

  it("18: PHASE 4B-R2 ADDS NO API ROUTE and NO UI SURFACE", () => {
    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        return entry.isDirectory() ? walk(full) : [full];
      });
    const surfaces = walk(path.join(repoRoot, "app")).filter((file) =>
      /diagnos|signal|evidence-pack|recommend|reliabilit|readiness/i.test(file),
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
      "/app/api/findings/[findingId]/diagnose/route.ts",
      "/app/api/readiness/route.ts",
      "/app/api/reliability/route.ts",
      "/app/reliability/page.tsx",
    ]);
  });

  it("19: the module stays tiny — orchestration only", () => {
    // Two imports of approved units, one exported function. A service that
    // grew its own logic would not fit this shape.
    const executable = source
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    expect(importStatements.length).toBeLessThanOrEqual(4);
    expect(executable.length).toBeLessThan(20);
    expect([...source.matchAll(/export\s+(async\s+)?function/g)]).toHaveLength(
      1,
    );
  });

  it("20: the frozen R1 pure extractor is STILL pure — zero runtime imports", () => {
    const r1 = stripComments(read("lib/diagnosis/diagnostic-signals.ts"));
    const imports = r1
      .split("\n")
      .filter((line) => line.trimStart().startsWith("import "));
    expect(imports.length).toBeGreaterThan(0);
    for (const statement of imports) {
      expect(statement.trimStart(), statement).toMatch(/^import type\b/);
    }
    expect(r1).not.toContain("server-only");
  });

  it("21: the frozen Phase 4A pure builder is STILL pure — zero runtime imports", () => {
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
