import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Phase 4A-R1 — a static guard over the Diagnosis Evidence Pack module.
 *
 * The pack sits between authoritative payment evidence and the later
 * diagnosis layers, so the risks are specific and none of them is catchable
 * by a type check: the module could quietly acquire database access, start
 * writing, reach the network, call an AI provider, read a secret, or widen
 * the frozen Phase 3 safe projections to pull an unnecessary raw column
 * into a structure that later phases may hand onward.
 *
 * A plain static text check — no rendering, no Supabase, no network.
 *
 * Comments are stripped before every content assertion, so the module may
 * explain in prose why a given column is deliberately out of scope without
 * that explanation failing the guard.
 */

const repoRoot = path.resolve(import.meta.dirname, "../../../");

const MODULE_PATH = "lib/diagnosis/evidence-pack.ts";

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

const rawSource = read(MODULE_PATH);
const source = stripComments(rawSource);

/** Every `import ...` statement in the module, comments already removed. */
const importStatements = source
  .split("\n")
  .filter((line) => line.trimStart().startsWith("import "));

describe("Phase 4A-R1 evidence pack — static guard", () => {
  it("1: the production module exists, is non-empty and lives under lib/diagnosis", () => {
    expect(source.length).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(repoRoot, MODULE_PATH))).toBe(true);
  });

  it("2: Phase 4A-R1 adds exactly one production module under lib/diagnosis", () => {
    const dir = path.join(repoRoot, "lib", "diagnosis");
    const entries = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort();
    expect(entries).toEqual(["evidence-pack.ts"]);
  });

  it("3: the module performs no runtime import at all — every import is type-only", () => {
    expect(importStatements.length).toBeGreaterThan(0);
    for (const statement of importStatements) {
      expect(statement.trimStart(), statement).toMatch(/^import type\b/);
    }
  });

  it("4: NO DATABASE — no Supabase client, repository or service import", () => {
    for (const forbidden of [
      "@/lib/supabase/server",
      "@supabase/supabase-js",
      "createClient",
      "server-only",
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

  it("5: NO WRITES — no mutation or query call of any kind", () => {
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

  it("5b: the only database-adjacent reference is a type-only import of the vocabulary module", () => {
    // `lib/supabase/types.ts` is a pure declaration file: it has zero imports
    // and zero runtime code, so a `import type` of it is erased at compile
    // time and can grant no database access. Reusing it is deliberate — the
    // alternative is re-declaring the persisted vocabularies here, which
    // could silently drift from the frozen schema.
    //
    // Every other form of database reach is banned by tests 3, 4, 5 and 6.
    const supabaseLines = source
      .split("\n")
      .filter((line) => line.toLowerCase().includes("supabase"));

    expect(supabaseLines).toEqual(['} from "@/lib/supabase/types";']);
  });

  it("6: NO WRITE-CAPABLE FUNCTION is referenced by name", () => {
    for (const forbidden of [
      "insertOpenFinding",
      "createFindingFromInvariantResult",
      "generateFindingsForChaosRun",
      "persistInvariantResult",
      "finalizeChaosRunOutcome",
      "captureMerchantStateSnapshotForProcessingAttempt",
      "persistProcessingStateBefore",
      "persistProcessingStateAfter",
      "assembleChaosRunEvidence",
      "loadChaosRunEvidenceSource",
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it("7: NO NETWORK, ENVIRONMENT, FILESYSTEM or PROCESS access", () => {
    for (const forbidden of [
      "fetch(",
      "XMLHttpRequest",
      "process.env",
      "node:fs",
      "node:child_process",
      "readFileSync",
      "writeFileSync",
      "execSync",
      "spawn",
      "require(",
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it("8: NO AI PROVIDER — P0 diagnosis needs no paid runtime API", () => {
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

  it("9: NO RAZORPAY CLIENT — the pack reads persisted evidence only", () => {
    for (const forbidden of [
      "@/lib/razorpay",
      "razorpay-node",
      "new Razorpay",
      "api.razorpay.com",
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it("10: NO SECRET is named or read", () => {
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

  it("11: OUT-OF-SCOPE PERSISTED COLUMNS are not projected by this pack", () => {
    // These columns exist and are legitimate evidence elsewhere in the
    // project. They are simply outside the narrow Phase 4A allowlist, and the
    // frozen Phase 3 safe projections already avoid surfacing them.
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
      "errorMessageRedacted",
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it("12: NO SENSITIVE PAYMENT DATA vocabulary appears", () => {
    for (const forbidden of [
      "cardNumber",
      "card_number",
      "cvv",
      "CVV",
      '"pan"',
      "otp",
      "OTP",
      "signatureValue",
      "checkoutSignature",
      "x-razorpay-signature",
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it("13: NO ARBITRARY TARGET can be expressed", () => {
    for (const forbidden of [
      "http://",
      "https://",
      "targetUrl",
      "endpoint",
      "hostname",
      "webhookUrl",
    ]) {
      expect(source.toLowerCase(), forbidden).not.toContain(
        forbidden.toLowerCase(),
      );
    }
  });

  it("14: NO NON-DETERMINISM — no clock and no randomness", () => {
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

  it("15: NO PHASE 4B+ LOGIC — the pack stops at evidence", () => {
    for (const forbidden of [
      "diagnosisCode",
      "diagnosis_code",
      "diagnosisStrength",
      "diagnosis_strength",
      "diagnosisSummary",
      "recommendationCode",
      "recommendationText",
      "STRONG_EVIDENCE",
      "PARTIAL_EVIDENCE",
      "INSUFFICIENT_EVIDENCE",
      "rootCause",
      "ROOT_CAUSE",
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

  it("16: the persisted evidence-kind spelling is never rewritten in code", () => {
    // The module deliberately emits no evidence-kind string for processing
    // facts, so neither frozen vocabulary can be substituted for the other.
    expect(source).not.toContain('"PROCESSING_ATTEMPT"');
    expect(source).not.toContain("'PROCESSING_ATTEMPT'");
    expect(source).not.toContain('"INVARIANT_RESULT"');
    expect(source).not.toContain('kind: "EVENT_PROCESSING_ATTEMPT"');
  });

  it("17: the pack is versioned and never persisted", () => {
    expect(source).toContain("DIAGNOSIS_EVIDENCE_PACK_VERSION");
    expect(source).toContain("DiagnosisEvidencePackV1");
    expect(source).not.toContain("evidence_packs");
    expect(source).not.toContain("evidencePacks");
  });

  it("18: PHASE 4A ADDS NO MIGRATION", () => {
    const migrationsDir = path.join(repoRoot, "supabase", "migrations");
    const migrations = fs
      .readdirSync(migrationsDir)
      .filter((name) => name.endsWith(".sql"))
      .sort();

    expect(migrations).toEqual([
      "20260823000000_phase1_foundation_schema.sql",
      "20260824000000_phase2b_payment_attempts_razorpay_correlation.sql",
      "20260825000000_phase2c_payments.sql",
      "20260826000000_phase2d_webhook_events.sql",
      "20260827000000_phase2e_webhook_dedup.sql",
      "20260828000000_phase2f_merchant_processing.sql",
      "20260829000000_phase3b_chaos_runs.sql",
      "20260830000000_phase3c_controlled_replay.sql",
      "20260831000000_phase3d_execution_safety.sql",
      "20260901000000_phase3e_evidence_snapshots.sql",
      "20260902000000_phase3f_invariant_results.sql",
      "20260903000000_phase3g_findings.sql",
    ]);
  });

  it("19: the FAIL-only entry gate is enforced in code, not merely assumed", () => {
    expect(source).toContain("EVIDENCE_PACK_SOURCE_NOT_FAIL");
    expect(source).toContain('invariantResult.result !== "FAIL"');
    expect(source).toContain("EVIDENCE_PACK_INVARIANT_RESULT_MISMATCH");
    expect(source).toContain("EVIDENCE_PACK_CHAOS_RUN_MISMATCH");
  });

  it("20: no `any` escape hatch is used for unsupported evidence", () => {
    expect(source).not.toMatch(/:\s*any\b/);
    expect(source).not.toMatch(/\bas any\b/);
    expect(source).not.toContain("@ts-ignore");
    expect(source).not.toContain("@ts-expect-error");
  });
});
