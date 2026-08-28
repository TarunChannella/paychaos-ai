import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Phase 3E-A — a static regression guard against
 * `tests/integration/supabase/060-phase3e-evidence-snapshot.integration.test.ts`
 * ever repeating the provenance mistake `057`'s first draft made (Phase 3D-C
 * correction): claiming genuine `RECORDED_TEST_EVIDENCE` from a synthetic
 * mechanics fixture, or invoking a production positive-path execution
 * service / HTTP route instead of the established `053`/`057`/`058`/`059`
 * SYNTHETIC_DEMO mechanics pattern.
 *
 * It additionally guards the Phase 3E-A-specific rule that this file must
 * never mutate or delete historical Phase 3D evidence.
 *
 * A plain static text check (no Supabase connection, offline unit suite) —
 * mirrors `059-chaos-c11-a-observation-provenance-guard.test.ts` exactly.
 */

const repoRoot = path.resolve(import.meta.dirname, "../../../");
const targetFile = path.join(
  repoRoot,
  "tests",
  "integration",
  "supabase",
  "060-phase3e-evidence-snapshot.integration.test.ts",
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

describe("060-phase3e-evidence-snapshot.integration.test.ts — provenance guard", () => {
  it("found the target file and it is non-empty", () => {
    expect(source.length).toBeGreaterThan(0);
  });

  it("uses the Phase 3E-A evidence surface under test", () => {
    expect(functionalSource).toMatch(
      /captureMerchantStateSnapshotForProcessingAttempt/,
    );
    expect(functionalSource).toMatch(/persistProcessingStateBefore/);
    expect(functionalSource).toMatch(/persistProcessingStateAfter/);
    expect(functionalSource).toMatch(
      /from\s+["']@\/lib\/evidence\/evidence-repository["']/,
    );
  });

  it("creates every chaos_run classified SYNTHETIC_DEMO — never RECORDED_TEST_EVIDENCE", () => {
    const dataClassificationWrites = [
      ...functionalSource.matchAll(/dataClassification:\s*["']([^"']+)["']/g),
    ].map((m) => m[1]);
    expect(dataClassificationWrites.length).toBeGreaterThan(0);
    for (const value of dataClassificationWrites) {
      expect(value).toBe("SYNTHETIC_DEMO");
    }
    expect(functionalSource).not.toMatch(/RECORDED_TEST_EVIDENCE/);
  });

  it("uses the repository-level createPendingChaosRun — never the production chaos-creation/precheck entry points", () => {
    expect(functionalSource).toMatch(/\bcreatePendingChaosRun\b/);
    expect(functionalSource).not.toMatch(/runChaosPrecheck/);
    expect(functionalSource).not.toMatch(/(?<!Pending)\bcreateChaosRun\b/);
  });

  it("never imports or calls any production positive-path chaos execution service or route", () => {
    for (const forbidden of [
      "executeC01Replay",
      "executeC11RealWebhookReplay",
      "executeC03InvalidSignatureTest",
      "startC11AFailureObservation",
      "reconcileC11AFailedPaymentObservation",
      "cancelRunningC11AObservation",
    ]) {
      expect(functionalSource).not.toMatch(new RegExp(forbidden));
    }
    expect(functionalSource).not.toMatch(
      /from\s+["']@\/lib\/chaos\/replay-service["']/,
    );
    expect(functionalSource).not.toMatch(
      /from\s+["']@\/lib\/chaos\/c11-execution-service["']/,
    );
    expect(functionalSource).not.toMatch(
      /from\s+["']@\/lib\/chaos\/c03-execution-service["']/,
    );
    expect(functionalSource).not.toMatch(
      /from\s+["']@\/lib\/chaos\/c07-execution-service["']/,
    );
    expect(functionalSource).not.toMatch(/\/route["']/);
  });

  it("documents that the migration is NOT yet applied and that the file is therefore not runnable", () => {
    expect(source).toMatch(/NOT RUNNABLE YET/);
    expect(source).toMatch(/state_before/);
    expect(source).toMatch(/manually applied/i);
  });

  it("documents the three-layer provenance distinction", () => {
    expect(source).toMatch(/SYNTHETIC_DEMO/);
    expect(source).toMatch(/SYNTHETIC CANONICAL COMPATIBILITY/i);
    expect(source).toMatch(/never claims a genuine positive/i);
  });

  it("records pre-existing processing-attempt evidence up front and re-verifies it after cleanup — historical Phase 3D evidence is never mutated", () => {
    expect(functionalSource).toMatch(/beforeAll\(async \(\)/);
    expect(functionalSource).toMatch(/preExistingAttemptEvidence/);
    const afterAllIndex = functionalSource.indexOf("afterAll(async ()");
    expect(afterAllIndex).toBeGreaterThan(-1);
    expect(functionalSource.slice(afterAllIndex)).toMatch(
      /preExistingAttemptEvidence/,
    );
  });

  it("never issues an unscoped delete — every cleanup delete is scoped by exact id or by an owned order id", () => {
    const deleteChains = [
      ...functionalSource.matchAll(/\.delete\(\)([\s\S]{0,200}?);/g),
    ].map((m) => m[1]!);
    expect(deleteChains.length).toBeGreaterThan(0);
    for (const chain of deleteChains) {
      expect(chain).toMatch(/\.(in\(\s*["']id["']|eq\(\s*["']order_id["'])/);
    }
  });

  it("child-before-parent cleanup order is present in afterAll", () => {
    const afterAllIndex = source.indexOf("afterAll(async ()");
    expect(afterAllIndex).toBeGreaterThan(-1);
    const afterAllSource = source.slice(afterAllIndex);
    const fulfilmentIdx = afterAllSource.indexOf('"fulfilments"');
    const epaIdx = afterAllSource.indexOf(
      'deleteChunked("event_processing_attempts"',
    );
    const chaosIdx = afterAllSource.indexOf('deleteChunked("chaos_runs"');
    const webhookIdx = afterAllSource.indexOf('deleteChunked("webhook_events"');
    const paymentsIdx = afterAllSource.indexOf('deleteChunked("payments"');
    const attemptsIdx = afterAllSource.indexOf(
      'deleteChunked("payment_attempts"',
    );
    const ordersIdx = afterAllSource.indexOf('deleteChunked("orders"');
    expect(fulfilmentIdx).toBeGreaterThan(-1);
    expect(fulfilmentIdx).toBeLessThan(epaIdx);
    expect(epaIdx).toBeLessThan(chaosIdx);
    expect(chaosIdx).toBeLessThan(webhookIdx);
    expect(webhookIdx).toBeLessThan(paymentsIdx);
    expect(paymentsIdx).toBeLessThan(attemptsIdx);
    expect(attemptsIdx).toBeLessThan(ordersIdx);
  });

  it("independently proves zero remaining rows for all seven owned tables after cleanup", () => {
    for (const table of [
      "fulfilments",
      "event_processing_attempts",
      "chaos_runs",
      "webhook_events",
      "payments",
      "payment_attempts",
      "orders",
    ]) {
      expect(functionalSource).toMatch(
        new RegExp(`assertNoRowsRemain\\("${table}"`),
      );
    }
  });

  it("proves the no-historical-backfill guarantee: a terminal SUCCEEDED re-entry and a non-runnable terminal attempt both leave state_before/state_after NULL", () => {
    expect(functionalSource).toMatch(/NO BACKFILL \(B\)/);
    expect(functionalSource).toMatch(/NO BACKFILL \(C\)/);
    expect(functionalSource).toMatch(/already_processed/);
    expect(functionalSource).toMatch(/PROCESSING_ATTEMPT_NOT_READY/);
    expect(functionalSource).toMatch(/NOT_ELIGIBLE/);
    expect(functionalSource).toMatch(/getProcessingSnapshotEligibility/);
  });

  it("never asserts an invariant PASS/FAIL verdict — Phase 3E records facts only", () => {
    expect(functionalSource).not.toMatch(/invariant_results/);
    expect(functionalSource).not.toMatch(/toBe\(["']PASS["']\)/);
    expect(functionalSource).not.toMatch(/toBe\(["']FAIL["']\)/);
  });
});
