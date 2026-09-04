import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Phase 4A-R2 — a static guard over the server-only Evidence Pack service.
 *
 * The service is the first Phase 4 module allowed to touch the database, so
 * the risks change shape: it could acquire write capability, call a Finding
 * generator, reach Razorpay or an AI provider, leak a raw database error, or
 * quietly start deriving a diagnosis. None of that is catchable by a type
 * check.
 *
 * This guard is deliberately narrower than the R1 one. R2 legitimately imports
 * server-side read modules, so a blanket ban on the word "supabase" or on
 * repository imports would fail a correct implementation. What is asserted
 * instead is precise: the module is server-only, it calls no mutation, it
 * names no write-capable function, and it contains no Phase 4B+ logic.
 *
 * Comments are stripped before every content assertion.
 */

const repoRoot = path.resolve(import.meta.dirname, "../../../");

const SERVICE_PATH = "lib/diagnosis/evidence-pack-service.ts";
const BUILDER_PATH = "lib/diagnosis/evidence-pack.ts";

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

const rawSource = read(SERVICE_PATH);
const source = stripComments(rawSource);

describe("Phase 4A-R2 evidence pack service — static guard", () => {
  it("1: the service exists, is non-empty and lives under lib/diagnosis", () => {
    expect(source.length).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(repoRoot, SERVICE_PATH))).toBe(true);
  });

  it("2: SERVER ONLY — the module declares the server-only boundary", () => {
    expect(source).toContain('import "server-only";');
  });

  it("3: NO BROWSER, API ROUTE or UI dependency", () => {
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

  it("4: NO WRITES — no mutating call of any kind", () => {
    for (const forbidden of [
      ".insert(",
      ".update(",
      ".upsert(",
      ".delete(",
      ".rpc(",
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it("5: NO WRITE-CAPABLE FUNCTION is named or invoked", () => {
    for (const forbidden of [
      // Finding generation / mutation
      "insertOpenFinding",
      "createFindingFromInvariantResult",
      "generateFindingsForChaosRun",
      // Invariant persistence
      "persistInvariantResult",
      "finalizeChaosRunOutcome",
      "canonicalizeEvidenceRefs",
      // Evidence snapshot persistence
      "captureMerchantStateSnapshotForProcessingAttempt",
      "persistProcessingStateBefore",
      "persistProcessingStateAfter",
      // Chaos execution / mutation
      "startPendingC11ARunAtomically",
      "startPendingC11BRunAtomically",
      "createChaosRun",
      "evaluateChaosRun",
      "executeC03",
      "replayWebhookEvent",
      // Merchant mutation
      "processWebhookPaymentEvent",
      "createDemoOrder",
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it("6: the ONLY database reach is through approved read-only modules", () => {
    // These three are the frozen read paths R2 is permitted to orchestrate.
    expect(source).toContain("@/lib/findings/repository");
    expect(source).toContain("@/lib/findings/service");
    expect(source).toContain("@/lib/evidence/chaos-evidence-service");

    // No direct client, and no query building of its own.
    for (const forbidden of [
      "@/lib/supabase/server",
      "getSupabaseServerClient",
      "@supabase/supabase-js",
      "createClient",
      ".from(",
      ".select(",
      ".eq(",
      ".maybeSingle(",
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it("7: the pack is built ONLY through the approved R1 pure builder", () => {
    expect(source).toContain("buildDiagnosisEvidencePack");
    expect(source).toContain("@/lib/diagnosis/evidence-pack");
    // No second, parallel construction path.
    expect(source).not.toContain("DiagnosisEvidencePackV1 = {");
    expect(source).not.toContain("version: 1");
  });

  it("8: NO NETWORK, SHELL or FILESYSTEM access", () => {
    for (const forbidden of [
      "fetch(",
      "XMLHttpRequest",
      "node:fs",
      "node:child_process",
      "readFileSync",
      "writeFileSync",
      "execSync",
      "spawn",
      "http://",
      "https://",
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it("9: NO ENVIRONMENT read or dump", () => {
    for (const forbidden of ["process.env", "printenv", "dotenv"]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it("10: NO RAZORPAY client and NO AI provider", () => {
    for (const forbidden of [
      "@/lib/razorpay",
      "razorpay-node",
      "new Razorpay",
      "api.razorpay.com",
      "openai",
      "OpenAI",
      "anthropic",
      "Anthropic",
      "ollama",
      "Ollama",
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

  it("12: RAW DATABASE ERROR TEXT cannot escape through a service error", () => {
    // Only the stable `code` of an underlying failure is ever inspected, and
    // every thrown message is a fixed literal in this file.
    expect(source).toContain("underlyingCode");
    for (const forbidden of [
      "error.message",
      "error.details",
      "error.hint",
      "String(error)",
      "JSON.stringify(error)",
      "err.message",
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it("13: OUT-OF-SCOPE PERSISTED COLUMNS are not read or projected here", () => {
    for (const forbidden of [
      "fault_config",
      "faultConfig",
      "fault_state",
      "faultState",
      "raw_payload_redacted",
      "rawPayloadRedacted",
      "raw_body_sha256",
      "rawBodySha256",
      "normalized_event",
      "normalizedEvent",
      "error_message_redacted",
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it("14: NO PHASE 4B+ LOGIC — the service stops at evidence", () => {
    for (const forbidden of [
      "diagnosisCode",
      "diagnosis_code",
      "diagnosisStrength",
      "diagnosis_strength",
      "diagnosisSummary",
      "diagnosed_at",
      "diagnosedAt",
      "recommendationCode",
      "recommendationText",
      "STRONG_EVIDENCE",
      "PARTIAL_EVIDENCE",
      "INSUFFICIENT_EVIDENCE",
      "rootCause",
      "RC-00",
      "reliabilityScore",
      "RELIABILITY-V1",
      "goLive",
      "readiness",
      "regression_runs",
      "regressionRun",
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it("15: the FINDING is the entry boundary — no arbitrary subject is accepted", () => {
    expect(source).toContain("assembleDiagnosisEvidencePackForFinding");
    expect(source).toContain("findingId: string");
    // The service must not offer a payment/order/webhook-keyed entry point.
    for (const forbidden of [
      "ForPayment(",
      "ForOrder(",
      "ForWebhook(",
      "ForPaymentAttempt(",
      "razorpayPaymentId",
      "razorpayOrderId",
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it("16: read failure and factual absence are separate vocabularies", () => {
    expect(source).toContain("EVIDENCE_PACK_READ_FAILED");
    expect(source).toContain("EVIDENCE_PACK_FINDING_NOT_FOUND");
    expect(source).toContain("EVIDENCE_PACK_INTEGRITY_CONFLICT");
    // The service must never author an R1 gap: gaps are the builder's to emit.
    for (const forbidden of [
      "CHAOS_EVIDENCE_UNAVAILABLE",
      "NO_CHAOS_RUN_CORRELATION",
      "EVIDENCE_REF_UNRESOLVED",
      "gaps.push",
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it("17: R2 ADDS NO MIGRATION", () => {
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
    // Advanced again for the safeupdate fix, which legitimately adds one
    // additive migration (CREATE OR REPLACE of the reset function; no table
    // change), and once more for the Phase 5 controlled C01 vulnerable
    // profile (docs/DEMO_PLAN.md Section 9), which adds the one non-domain
    // configuration table. THIS phase still contributes no migration of its
    // own, and every position below is still an exact-name assertion.
    expect(migrations).toHaveLength(16);
    expect(migrations.at(-1)).toBe(
      "20260907000000_phase5_c01_controlled_vulnerable_profile.sql",
    );
    expect(migrations.at(-2)).toBe(
      "20260906000000_phase5_demo_reset_safeupdate.sql",
    );
    expect(migrations.at(-3)).toBe(
      "20260905000000_phase5_demo_reset_atomic.sql",
    );
    expect(migrations.at(-4)).toBe("20260904000000_phase4e_regression_runs.sql");
    expect(migrations.at(-5)).toBe("20260903000000_phase3g_findings.sql");
  });

  it("18: the R1 pure builder remains untouched by R2 — still zero runtime imports", () => {
    const builder = stripComments(read(BUILDER_PATH));
    const imports = builder
      .split("\n")
      .filter((line) => line.trimStart().startsWith("import "));
    expect(imports.length).toBeGreaterThan(0);
    for (const statement of imports) {
      expect(statement.trimStart(), statement).toMatch(/^import type\b/);
    }
    expect(builder).not.toContain("server-only");
  });

  it("19: NO API ROUTE or UI file was added for Phase 4 diagnosis", () => {
    const appDir = path.join(repoRoot, "app");
    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        return entry.isDirectory() ? walk(full) : [full];
      });
    const diagnosisSurfaces = walk(appDir).filter((file) =>
      /diagnos|evidence-pack|recommend|reliabilit|readiness/i.test(file),
    );
    // ADVANCED, NOT LOOSENED (Phase 4F-R3). Phase 4F legitimately adds the
    // reliability read API and page required by P4-AC-10/11, so those two
    // exact files are now expected. Every other surface this guard protects
    // remains absolutely forbidden, and an unexpected THIRD reliability
    // surface would fail here rather than slip in. This phase itself still
    // contributes no route or UI of its own.
    const normalised = diagnosisSurfaces
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
});
