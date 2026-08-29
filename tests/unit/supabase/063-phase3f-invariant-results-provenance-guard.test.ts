import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Phase 3F-A — a static regression guard against
 * `tests/integration/supabase/063-phase3f-invariant-results.integration.test.ts`
 * ever claiming genuine `RECORDED_TEST_EVIDENCE` from a schema fixture,
 * executing a chaos scenario, touching Razorpay, mutating historical
 * evidence, asserting that a money verdict is CORRECT, or cleaning up with a
 * broad delete.
 *
 * Mirrors `062-phase3f-evidence-compatibility-provenance-guard.test.ts`. A
 * plain static text check (no Supabase connection, offline unit suite).
 */

const repoRoot = path.resolve(import.meta.dirname, "../../../");
const targetFile = path.join(
  repoRoot,
  "tests",
  "integration",
  "supabase",
  "063-phase3f-invariant-results.integration.test.ts",
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

describe("063-phase3f-invariant-results.integration.test.ts — provenance guard", () => {
  it("1: found the target file and it is non-empty", () => {
    expect(source.length).toBeGreaterThan(0);
  });

  it("2: exercises the invariant_results table under test", () => {
    expect(functionalSource).toMatch(/from\("invariant_results"\)/);
  });

  it("3: every chaos_run it creates is SYNTHETIC_DEMO — never RECORDED_TEST_EVIDENCE", () => {
    const classifications = [
      ...functionalSource.matchAll(/data_classification:\s*["']([^"']+)["']/g),
    ].map((m) => m[1]!);
    expect(classifications.length).toBeGreaterThan(0);
    for (const classification of classifications) {
      expect(classification).toBe("SYNTHETIC_DEMO");
    }
    expect(functionalSource).not.toMatch(/RECORDED_TEST_EVIDENCE/);
  });

  it("4: executes no chaos scenario and calls no chaos execution service", () => {
    for (const forbidden of [
      "executeC03InvalidSignatureTest",
      "executeC07",
      "executeC11",
      "executeReplay",
      "createChaosRun",
      "runChaosScenario",
    ]) {
      expect(functionalSource).not.toContain(forbidden);
    }
  });

  it("5: touches no Razorpay surface and opens no external network call", () => {
    expect(functionalSource).not.toMatch(/require\("razorpay"\)/);
    expect(functionalSource).not.toMatch(/from\s+["']razorpay["']/);
    expect(functionalSource).not.toMatch(/new Razorpay\(/);
    expect(functionalSource).not.toMatch(/api\.razorpay\.com/);
    expect(functionalSource).not.toMatch(/\bfetch\s*\(/);
  });

  it("6: touches only the four expected tables, and creates no payment/webhook/processing row at all", () => {
    const touchedTables = [
      ...functionalSource.matchAll(/\.from\("(\w+)"\)/g),
    ].map((m) => m[1]!);
    expect(new Set(touchedTables)).toEqual(
      new Set([
        "invariant_results",
        "chaos_runs",
        // ONE test-owned baseline order, so the non-chaos subject anchor is
        // proven against a real FK rather than only statically.
        "orders",
        // READ-ONLY — the historical snapshot non-mutation proof.
        "event_processing_attempts",
      ]),
    );
    for (const forbidden of [
      "payment_attempts",
      "payments",
      "fulfilments",
      "webhook_events",
    ]) {
      expect(functionalSource).not.toMatch(
        new RegExp(`\\.from\\("${forbidden}"\\)`),
      );
    }
  });

  it("6b: event_processing_attempts is READ-ONLY here — never inserted, updated or deleted", () => {
    const attemptCalls = [
      ...functionalSource.matchAll(
        /\.from\("event_processing_attempts"\)([\s\S]*?);/g,
      ),
    ].map((m) => m[1]!);
    expect(attemptCalls.length).toBeGreaterThan(0);
    for (const call of attemptCalls) {
      expect(call).toMatch(/\.select\(/);
      expect(call).not.toMatch(/\.insert\(/);
      expect(call).not.toMatch(/\.update\(/);
      expect(call).not.toMatch(/\.upsert\(/);
      expect(call).not.toMatch(/\.delete\(/);
    }
  });

  it("6c: the only orders row is one test-owned insert built from the suite helper and tracked for the end-state proof", () => {
    expect(functionalSource).toMatch(/testOrderInsert\(/);
    expect(functionalSource).toMatch(/trackOrder\(/);
    const orderInserts = [
      ...functionalSource.matchAll(/\.from\("orders"\)\s*\n?\s*\.insert\(/g),
    ];
    expect(orderInserts.length).toBe(1);
    // No genuine merchant order is ever updated by this file.
    const orderCalls = [
      ...functionalSource.matchAll(/\.from\("orders"\)([\s\S]*?);/g),
    ].map((m) => m[1]!);
    for (const call of orderCalls) {
      expect(call).not.toMatch(/\.update\(/);
      expect(call).not.toMatch(/\.upsert\(/);
    }
  });

  it("7: never replays an event or claims a real provider event", () => {
    for (const forbidden of [
      "PAYCHAOS_REPLAY",
      "REAL_RAZORPAY_WEBHOOK",
      "PAYCHAOS_SIMULATION",
      "TEST_FIXTURE",
    ]) {
      expect(functionalSource).not.toContain(forbidden);
    }
  });

  it("8: cleans up by exact ID only — no broad or unfiltered delete", () => {
    // A delete call may be split across lines, so capture up to its
    // statement terminator rather than to the end of the line.
    const deletes = [
      ...functionalSource.matchAll(/\.delete\(\)([\s\S]*?);/g),
    ].map((m) => m[1]!);
    expect(deletes.length).toBeGreaterThan(0);
    for (const tail of deletes) {
      // Every delete must be narrowed by an explicit id filter.
      expect(tail).toMatch(/\.(in|eq)\(\s*["']id["']/);
    }
    expect(functionalSource).not.toMatch(/\.delete\(\)\s*;/);
    expect(functionalSource).not.toMatch(/\.neq\(/);
  });

  it("9: deletes children before parents (invariant_results, then chaos_runs, then orders) — every FK is RESTRICT", () => {
    const resultsDelete = functionalSource.indexOf(
      'from("invariant_results").delete()',
    );
    const runsDelete = functionalSource.indexOf('from("chaos_runs").delete()');
    const ordersDelete = functionalSource.indexOf('from("orders").delete()');
    expect(resultsDelete).toBeGreaterThan(-1);
    expect(runsDelete).toBeGreaterThan(-1);
    expect(ordersDelete).toBeGreaterThan(-1);
    expect(resultsDelete).toBeLessThan(runsDelete);
    expect(runsDelete).toBeLessThan(ordersDelete);
  });

  it("10: independently re-verifies cleanup with a real SELECT rather than trusting the delete", () => {
    expect(functionalSource).toMatch(/count:\s*["']exact["']/);
    expect(functionalSource).toMatch(/expect\(remainingResults\)\.toBe\(0\)/);
    expect(functionalSource).toMatch(/expect\(remainingRuns\)\.toBe\(0\)/);
    expect(functionalSource).toMatch(/expect\(remainingOrders\)\.toBe\(0\)/);
  });

  it("10b: proves historical non-mutation by EXACT deep equality against a beforeAll snapshot, not by a shape check", () => {
    // An explicit column allowlist is captured before any owned row exists.
    expect(functionalSource).toMatch(/HISTORICAL_CHAOS_RUN_COLUMNS/);
    expect(functionalSource).toMatch(/PROCESSING_ATTEMPT_COLUMNS/);
    expect(functionalSource).toMatch(/historicalChaosRunsBefore/);
    expect(functionalSource).toMatch(/processingAttemptsBefore/);
    // Deterministic ordering, then value-by-value comparison.
    expect(functionalSource).toMatch(/function sortById/);
    expect(functionalSource).toMatch(
      /expect\(sortById\([\s\S]{0,80}\)\)\.toEqual\(\s*historicalChaosRunsBefore,?\s*\)/,
    );
    expect(functionalSource).toMatch(
      /expect\(sortById\([\s\S]{0,80}\)\)\.toEqual\(\s*processingAttemptsBefore,?\s*\)/,
    );
    // The weaker superseded assertion must not come back.
    expect(functionalSource).not.toMatch(
      /expect\(typeof run\.fault_state\)\.toBe\("object"\)/,
    );
  });

  it("10c: the historical projection is an explicit allowlist that reads no secret, payload or signature", () => {
    const allowlist = functionalSource.match(
      /const HISTORICAL_CHAOS_RUN_COLUMNS\s*=\s*\n?\s*"([^"]+)"/,
    );
    expect(allowlist).not.toBeNull();
    const columns = allowlist![1]!.split(",").map((c) => c.trim());
    expect(columns).toEqual([
      "id",
      "scenario_id",
      "status",
      "outcome",
      "fault_type",
      "data_classification",
      "order_id",
      "payment_attempt_id",
      "payment_id",
      "source_webhook_event_id",
      "fault_state",
      "execution_block_code",
      "failed_precheck_id",
      "started_at",
      "completed_at",
      "created_at",
    ]);
    expect(functionalSource).not.toMatch(/select\("\*"\)/);
  });

  it("10d: the four known approved historical run IDs are asserted present only if they existed at beforeAll", () => {
    for (const id of [
      "a0c5a66a-e70f-4e47-b9eb-0b3482c789d4",
      "68878716-ed49-40ec-85de-f962a4f6b21c",
      "5090e423-daa5-4122-99de-4c27d728957c",
      "b49d344a-f5cf-42ae-a078-819b26bfbffe",
    ]) {
      expect(functionalSource).toContain(id);
    }
    // Guarded by the beforeAll truth — never a hard failure for an ID that
    // was simply absent in this environment.
    expect(functionalSource).toMatch(/historicalChaosRunIds\.has\(id\)/);
  });

  it("10e: proves the subject-anchor rule — all-four-NULL rejected, C03 anchored solely by its chaos run", () => {
    // The superseded, factually wrong claim must never return.
    expect(functionalSource).not.toMatch(
      /NO entity correlation at all succeeds/,
    );
    expect(source).not.toMatch(
      /this is exactly the C03 shape.*NULL[\s\S]{0,40}chaos_run_id: null/,
    );
    // The all-NULL case must be asserted REJECTED.
    expect(functionalSource).toMatch(/ALL FOUR correlations NULL is REJECTED/);
    // The C03 case must anchor on a real chaos run.
    expect(functionalSource).toMatch(/EXACT C03 shape/);
    expect(functionalSource).toMatch(/chaos_run_id: chaosRunA/);
    // A baseline shape must be proven against a real order FK.
    expect(functionalSource).toMatch(/baseline ORDER shape/);
    expect(functionalSource).toMatch(/order_id: baselineOrderId/);
  });

  it("11: asserts no evaluator behavior — Phase 3F-A ships no evaluator", () => {
    for (const forbidden of [
      "lib/invariants/evaluators",
      "evaluateInvariant",
      "evaluateChaosRun",
      "assembleChaosRunEvidence",
    ]) {
      expect(functionalSource).not.toContain(forbidden);
    }
  });

  it("12: contains no AI, diagnosis, recommendation or reliability-score surface", () => {
    for (const forbidden of [
      "diagnosis",
      "root_cause",
      "rootCause",
      "recommendation",
      "reliability_score",
      "reliabilityScore",
      "findings",
      "regression_runs",
      "openai",
      "anthropic",
      "ollama",
    ]) {
      expect(functionalSource.toLowerCase()).not.toContain(
        forbidden.toLowerCase(),
      );
    }
  });

  it("13: logs no secret and no raw payload", () => {
    for (const forbidden of [
      "RAZORPAY_KEY_SECRET",
      "RAZORPAY_WEBHOOK_SECRET",
      "SUPABASE_SERVICE_ROLE_KEY",
      "PAYCHAOS_ACCESS_TOKEN",
      "PAYCHAOS_SESSION_SECRET",
      "raw_body_sha256",
      "raw_payload_redacted",
      "normalized_event",
      "x-razorpay-signature",
    ]) {
      expect(functionalSource).not.toContain(forbidden);
    }
    expect(functionalSource).not.toMatch(/console\.(log|info|warn|error)\(/);
  });

  it("14: documents that the migration is not yet applied, so an expected pre-migration failure is never mistaken for a product regression", () => {
    expect(source).toMatch(/NOT RUNNABLE YET/);
    expect(source).toMatch(/20260902000000_phase3f_invariant_results\.sql/);
  });
});
