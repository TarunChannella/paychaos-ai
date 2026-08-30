import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Phase 3G — a static regression guard against
 * `tests/integration/supabase/065-phase3g-findings.integration.test.ts`
 * ever fabricating provider evidence, executing a chaos scenario, touching
 * Razorpay, mutating historical evidence, or cleaning up with a broad delete.
 *
 * The risk this guard exists for is specific. Phase 3G's fixture inserts
 * `invariant_results` rows directly — which is legitimate, because the unit
 * under test is the Finding engine and no `FAIL` result exists in the project
 * to reuse. But the same shortcut would become a lie the moment the file
 * created a `webhook_events` row: that table is CHECK-constrained so every row
 * asserts a genuine, HMAC-authenticated Razorpay delivery. This guard makes
 * that impossible to add quietly.
 *
 * Mirrors `063-phase3f-invariant-results-provenance-guard.test.ts`. A plain
 * static text check (no Supabase connection, offline unit suite).
 */

const repoRoot = path.resolve(import.meta.dirname, "../../../");
const integrationDir = path.join(repoRoot, "tests", "integration", "supabase");
const targetFile = path.join(
  integrationDir,
  "065-phase3g-findings.integration.test.ts",
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

/** Every mutating Supabase call, paired with the table it targets. */
function mutatingCalls(): Array<{ table: string; op: string }> {
  const calls: Array<{ table: string; op: string }> = [];
  const pattern =
    /\.from\(\s*["'`](\w+)["'`]\s*\)\s*[\s\S]{0,300}?\.(insert|update|upsert|delete)\(/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(functionalSource)) !== null) {
    calls.push({ table: match[1]!, op: match[2]! });
  }
  return calls;
}

describe("065-phase3g-findings.integration.test.ts — provenance guard", () => {
  it("1: found the target file and it is non-empty", () => {
    expect(source.length).toBeGreaterThan(0);
  });

  it("2: the guard is comment-blind", () => {
    // The file's header legitimately names REAL_RAZORPAY_WEBHOOK while
    // explaining that it creates none.
    expect(source).toContain("REAL_RAZORPAY_WEBHOOK");
    expect(functionalSource).not.toContain("REAL_RAZORPAY_WEBHOOK");
  });

  it("3: no provider evidence is fabricated — webhook_events is never written", () => {
    for (const call of mutatingCalls()) {
      expect(call.table, `065 performs a ${call.op} on ${call.table}`).not.toBe(
        "webhook_events",
      );
      expect(call.table).not.toBe("event_processing_attempts");
    }
    expect(functionalSource).not.toContain("signature_verified");
    expect(functionalSource).not.toContain("raw_body_sha256");
    expect(functionalSource).not.toContain("razorpay_event_id");
  });

  it("4: only the three test-owned tables are ever mutated", () => {
    const tables = [...new Set(mutatingCalls().map((c) => c.table))].sort();
    expect(tables).toEqual(["chaos_runs", "findings", "invariant_results"]);
  });

  it("5: no merchant table is written", () => {
    for (const table of [
      "orders",
      "payment_attempts",
      "payments",
      "fulfilments",
    ]) {
      const calls = mutatingCalls().filter((c) => c.table === table);
      expect(calls, `065 mutates ${table}`).toHaveLength(0);
    }
  });

  it("6: every chaos run it creates is classified SYNTHETIC_DEMO", () => {
    expect(functionalSource).toContain('data_classification: "SYNTHETIC_DEMO"');
    for (const forbidden of [
      "REAL_RAZORPAY_WEBHOOK",
      "RECORDED_TEST_EVIDENCE",
      "PAYCHAOS_REPLAY",
    ]) {
      expect(
        functionalSource,
        `065 must not classify anything as ${forbidden}`,
      ).not.toContain(forbidden);
    }
  });

  it("7: no Razorpay surface is touched", () => {
    for (const forbidden of [
      "razorpay",
      "RAZORPAY_KEY",
      "api.razorpay.com",
      "checkout",
    ]) {
      expect(functionalSource.toLowerCase(), forbidden).not.toContain(
        forbidden.toLowerCase(),
      );
    }
  });

  it("8: no chaos scenario is executed", () => {
    for (const forbidden of [
      "executeChaos",
      "startChaosRun",
      "replayEvent",
      "runScenario",
      "c03ExecutionService",
      "process_webhook_payment_event",
    ]) {
      expect(functionalSource, forbidden).not.toContain(forbidden);
    }
  });

  it("9: it calls the REAL finding service, not a hand-rolled insert path", () => {
    expect(functionalSource).toContain("createFindingFromInvariantResult");
    expect(functionalSource).toContain("generateFindingsForChaosRun");
    expect(functionalSource).toContain("getFindingDetailByInvariantResultId");
    expect(functionalSource).toContain("@/lib/findings/service");
  });

  it("10: no AI/LLM surface", () => {
    for (const forbidden of ["openai", "anthropic", "ollama", "gpt-"]) {
      expect(functionalSource.toLowerCase(), forbidden).not.toContain(
        forbidden,
      );
    }
  });

  it("11: cleanup is exact-ID and never a broad or unfiltered delete", () => {
    const deletes = [
      ...functionalSource.matchAll(/\.delete\(\)([\s\S]{0,120})/g),
    ].map((m) => m[1]!);
    expect(deletes.length).toBeGreaterThan(0);
    for (const tail of deletes) {
      // Every delete must be narrowed by an explicit id list.
      expect(tail).toMatch(/\.in\(\s*["'`]id["'`]/);
      expect(tail).not.toMatch(/\.neq\(/);
      expect(tail).not.toMatch(/\.gte\(/);
    }
    // Children before parents, and in exactly that order. The chain is
    // written across several lines, so this matches the table and its delete
    // as a span rather than as one contiguous string.
    const order = ["findings", "invariant_results", "chaos_runs"];
    const positions = order.map((table) => {
      const match = functionalSource.match(
        new RegExp(`\\.from\\("${table}"\\)[\\s\\S]{0,80}?\\.delete\\(\\)`),
      );
      return match?.index ?? -1;
    });
    for (const [index, position] of positions.entries()) {
      expect(
        position,
        `no exact-ID delete found for ${order[index]}`,
      ).toBeGreaterThan(-1);
    }
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("12: cleanup proves zero remaining rows for all three tables", () => {
    expect(functionalSource).toContain("remainingFindings");
    expect(functionalSource).toContain("remainingResults");
    expect(functionalSource).toContain("remainingRuns");
  });

  it("13: it never claims a money verdict is correct — it only reports one", () => {
    for (const forbidden of [
      "INVARIANT_EVALUATORS",
      "evaluateInvariant",
      "evaluateChaosRun",
      "assembleChaosRunEvidence",
    ]) {
      expect(functionalSource, forbidden).not.toContain(forbidden);
    }
  });

  it("14: the authoritative Phase 3F baseline is pinned by exact run ID, never by exclusion", () => {
    // A negative scope ("every result that is not mine") would be true only
    // of today's database and would break the moment a later phase
    // legitimately persisted an invariant result elsewhere.
    expect(functionalSource).toContain("APPROVED_PHASE_3F_RUN_IDS");
    for (const runId of [
      "c406dafd-d48f-4e1e-b092-030acbb5e32b",
      "a0c5a66a-e70f-4e47-b9eb-0b3482c789d4",
      "68878716-ed49-40ec-85de-f962a4f6b21c",
      "5090e423-daa5-4122-99de-4c27d728957c",
      "b49d344a-f5cf-42ae-a078-819b26bfbffe",
    ]) {
      expect(functionalSource, runId).toContain(runId);
    }
    // The baseline is selected positively, and never by `.not(... "in" ...)`.
    expect(functionalSource).toMatch(
      /\.in\(\s*["'`]chaos_run_id["'`],\s*APPROVED_PHASE_3F_RUN_IDS\s*\)/,
    );
    expect(functionalSource).not.toMatch(
      /\.not\(\s*["'`]id["'`],\s*["'`]in["'`]/,
    );
  });

  it("15: the integration sequence is pinned — 065 exists and 066 does not", () => {
    const integrationFiles = fs
      .readdirSync(integrationDir)
      .filter((name) => name.endsWith(".integration.test.ts"))
      .sort();

    expect(integrationFiles.filter((name) => name.startsWith("065-"))).toEqual([
      "065-phase3g-findings.integration.test.ts",
    ]);
    // 066 is the Phase 3H read-model suite, added after this file, and is
    // pinned by exact name for the same reason 065 is.
    expect(integrationFiles.filter((name) => name.startsWith("066-"))).toEqual([
      "066-phase3h-read-models.integration.test.ts",
    ]);
    // 067 is the Phase 4A evidence-pack suite, added after this file, and is
    // pinned by exact name for the same reason 065 and 066 are.
    expect(integrationFiles.filter((name) => name.startsWith("067-"))).toEqual([
      "067-phase4a-evidence-pack.integration.test.ts",
    ]);
    expect(
      integrationFiles.filter((name) => name.startsWith("068-")),
      "a 068- integration suite appeared without this guard being advanced",
    ).toEqual([]);
  });
});
