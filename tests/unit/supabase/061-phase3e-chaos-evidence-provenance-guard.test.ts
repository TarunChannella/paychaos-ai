import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Phase 3E-B — a static regression guard against
 * `tests/integration/supabase/061-phase3e-chaos-evidence-assembly.integration.test.ts`
 * ever repeating the provenance mistake `057`'s first draft made (Phase 3D-C
 * correction): claiming genuine `RECORDED_TEST_EVIDENCE` from a synthetic
 * mechanics fixture, or invoking a production positive-path execution service
 * / HTTP route instead of the established `053`/`057`/`058`/`059`/`060`
 * SYNTHETIC_DEMO mechanics pattern.
 *
 * It additionally guards the Phase 3E-B-specific rules that this file must
 * never mutate or delete historical Phase 3D evidence, and must never assert
 * a money PASS/FAIL verdict.
 *
 * A plain static text check (no Supabase connection, offline unit suite) —
 * mirrors `060-phase3e-evidence-snapshot-provenance-guard.test.ts` exactly.
 */

const repoRoot = path.resolve(import.meta.dirname, "../../../");
const targetFile = path.join(
  repoRoot,
  "tests",
  "integration",
  "supabase",
  "061-phase3e-chaos-evidence-assembly.integration.test.ts",
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

describe("061-phase3e-chaos-evidence-assembly.integration.test.ts — provenance guard", () => {
  it("found the target file and it is non-empty", () => {
    expect(source.length).toBeGreaterThan(0);
  });

  it("uses the Phase 3E-B evidence-assembly surface under test", () => {
    expect(functionalSource).toMatch(/assembleChaosRunEvidence/);
    expect(functionalSource).toMatch(/loadChaosRunEvidenceSource/);
    expect(functionalSource).toMatch(
      /from\s+["']@\/lib\/evidence\/chaos-evidence-service["']/,
    );
    expect(functionalSource).toMatch(
      /from\s+["']@\/lib\/evidence\/chaos-evidence-repository["']/,
    );
  });

  it("creates every chaos_run classified SYNTHETIC_DEMO — never RECORDED_TEST_EVIDENCE", () => {
    const classifications = [
      ...functionalSource.matchAll(/data_classification:\s*["']([^"']+)["']/g),
    ].map((m) => m[1]);
    expect(classifications.length).toBeGreaterThan(0);
    for (const value of classifications) {
      expect(value).toBe("SYNTHETIC_DEMO");
    }
    expect(functionalSource).not.toMatch(/RECORDED_TEST_EVIDENCE/);
  });

  it("never imports or calls any production chaos creation, precheck or positive-path execution service or route", () => {
    for (const forbidden of [
      "runChaosPrecheck",
      "executeC01Replay",
      "executeC03InvalidSignatureTest",
      "armC07ClientConfirmationDrop",
      "reconcileC07ClientConfirmationDrop",
      "executeC11RealWebhookReplay",
      "startC11AFailureObservation",
      "reconcileC11AFailedPaymentObservation",
      "cancelRunningC11AObservation",
    ]) {
      expect(functionalSource).not.toMatch(new RegExp(forbidden));
    }
    expect(functionalSource).not.toMatch(/(?<!Pending)\bcreateChaosRun\b/);
    expect(functionalSource).not.toMatch(
      /from\s+["']@\/lib\/chaos\/replay-service["']/,
    );
    expect(functionalSource).not.toMatch(
      /from\s+["']@\/lib\/chaos\/c03-execution-service["']/,
    );
    expect(functionalSource).not.toMatch(
      /from\s+["']@\/lib\/chaos\/c07-execution-service["']/,
    );
    expect(functionalSource).not.toMatch(
      /from\s+["']@\/lib\/chaos\/c11-execution-service["']/,
    );
    expect(functionalSource).not.toMatch(
      /from\s+["']@\/lib\/chaos\/run-service["']/,
    );
    expect(functionalSource).not.toMatch(/\/route["']/);
  });

  it("documents the three-layer provenance distinction and never claims a genuine provider delivery", () => {
    expect(source).toMatch(/SYNTHETIC_DEMO/);
    expect(source).toMatch(/SYNTHETIC CANONICAL COMPATIBILITY/i);
    expect(source).toMatch(/never claims a genuine positive/i);
    expect(source).toMatch(/NOT genuine provider evidence/i);
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

  it("proves the assembler performs zero writes and is deterministic across two reads", () => {
    expect(functionalSource).toMatch(/ZERO database writes/i);
    expect(functionalSource).toMatch(/countsAfter\)\.toEqual\(countsBefore\)/);
    expect(functionalSource).toMatch(/rowsAfter\)\.toBe\(rowsBefore\)/);
    expect(functionalSource).toMatch(/deep-equal bundle/i);
  });

  it("covers every frozen P0 scenario shape plus the missing/invalid snapshot gap cases", () => {
    expect(functionalSource).toMatch(/scenarioId:\s*["']C01["']/);
    expect(functionalSource).toMatch(/scenarioId:\s*["']C03["']/);
    expect(functionalSource).toMatch(/scenarioId:\s*["']C07["']/);
    expect(functionalSource).toMatch(/scenarioId:\s*["']C11["']/);
    expect(functionalSource).toMatch(/A_OBSERVATION/);
    expect(functionalSource).toMatch(/B_REPLAY/);
    expect(functionalSource).toMatch(/MISSING_STATE_BEFORE/);
    expect(functionalSource).toMatch(/INVALID_STATE_AFTER/);
    expect(functionalSource).toMatch(/MISSING_C03_VERIFICATION_CHECKS/);
    expect(functionalSource).toMatch(/C07_FAULT_NOT_CONSUMED/);
  });

  it("proves the evidence-integrity corrections against the real database", () => {
    // Correction 3 — canonical source processing-status completeness.
    expect(functionalSource).toMatch(/SOURCE_PROCESSING_NOT_PROCESSED/);
    expect(functionalSource).toMatch(
      /processingStatus\)\.toBe\(["']PROCESSED["']\)/,
    );
    for (const status of ["RECEIVED", "PROCESSING", "FAILED"]) {
      expect(functionalSource).toMatch(new RegExp(`["']${status}["']`));
    }

    // Blocker 2 — authoritative original, including retry history.
    expect(functionalSource).toMatch(
      /authoritativeOriginalProcessingAttemptId/,
    );
    expect(functionalSource).toMatch(
      /AMBIGUOUS_AUTHORITATIVE_ORIGINAL_PROCESSING_ATTEMPT/,
    );
    expect(functionalSource).toMatch(
      /MISSING_AUTHORITATIVE_ORIGINAL_PROCESSING_ATTEMPT/,
    );
    // A FAILED provider attempt is created and must remain VISIBLE.
    expect(functionalSource).toMatch(/status:\s*["']FAILED["']/);
    expect(functionalSource).toMatch(
      /originalProcessingAttempts\)\.toHaveLength\(2\)/,
    );
  });

  it("never asserts an invariant PASS/FAIL verdict — Phase 3E records facts only", () => {
    expect(functionalSource).not.toMatch(/invariant_results/);
    expect(functionalSource).not.toMatch(/toBe\(["']PASS["']\)/);
    expect(functionalSource).not.toMatch(/toBe\(["']FAIL["']\)/);
    expect(functionalSource).not.toMatch(/toBe\(["']NOT_APPLICABLE["']\)/);
  });

  it("never enables a TEST_FIXTURE or PAYCHAOS_SIMULATION runtime source_kind", () => {
    expect(functionalSource).not.toMatch(/TEST_FIXTURE/);
    expect(functionalSource).not.toMatch(/PAYCHAOS_SIMULATION/);
  });

  it("uses the next permanent integration number after 060 and introduces no migration", () => {
    expect(path.basename(targetFile)).toBe(
      "061-phase3e-chaos-evidence-assembly.integration.test.ts",
    );
    const integrationFiles = fs
      .readdirSync(path.join(repoRoot, "tests", "integration", "supabase"))
      .filter((name) => name.endsWith(".integration.test.ts"));
    expect(
      integrationFiles.filter((name) => name.startsWith("061-")),
    ).toHaveLength(1);
    // 062 is the Phase 3F evidence-compatibility correction, added after this
    // file. It is pinned by exact name — the rule this guard enforces is that
    // each integration number stays unique and that 061 itself introduces no
    // migration, not that 061 is permanently the highest number.
    expect(integrationFiles.filter((name) => name.startsWith("062-"))).toEqual([
      "062-phase3f-evidence-compatibility.integration.test.ts",
    ]);
    // 063 is the Phase 3F-A invariant_results schema suite, added after this
    // file, and is pinned by exact name for the same reason as 062.
    expect(integrationFiles.filter((name) => name.startsWith("063-"))).toEqual([
      "063-phase3f-invariant-results.integration.test.ts",
    ]);
    // 064 is the Phase 3F-C orchestration/persistence suite, added after this
    // file, and is pinned by exact name for the same reason as 062 and 063.
    expect(integrationFiles.filter((name) => name.startsWith("064-"))).toEqual([
      "064-phase3f-invariant-evaluation.integration.test.ts",
    ]);
    // 065 is the Phase 3G finding-generation suite, added after this file,
    // and is pinned by exact name for the same reason as 062, 063 and 064.
    expect(integrationFiles.filter((name) => name.startsWith("065-"))).toEqual([
      "065-phase3g-findings.integration.test.ts",
    ]);
    // 066 is the Phase 3H read-model suite, added after this file, and is
    // pinned by exact name for the same reason as 062 through 065.
    expect(integrationFiles.filter((name) => name.startsWith("066-"))).toEqual([
      "066-phase3h-read-models.integration.test.ts",
    ]);
    // 067 is the Phase 4A evidence-pack suite, added after this file, and is
    // pinned by exact name for the same reason as 062 through 066.
    expect(integrationFiles.filter((name) => name.startsWith("067-"))).toEqual([
      "067-phase4a-evidence-pack.integration.test.ts",
    ]);
    // 068 is the Phase 4B-R2 diagnostic-signal suite, added after this file,
    // and is pinned by exact name for the same reason as 062 through 067.
    expect(integrationFiles.filter((name) => name.startsWith("068-"))).toEqual([
      "068-phase4b-diagnostic-signals.integration.test.ts",
    ]);
    // 069 is the Phase 4C-R2 diagnosis-persistence suite, added after this
    // file, and is pinned by exact name for the same reason as 062 through 068.
    expect(integrationFiles.filter((name) => name.startsWith("069-"))).toEqual([
      "069-phase4c-root-cause-persistence.integration.test.ts",
    ]);
    expect(
      integrationFiles.filter((name) => name.startsWith("070-")),
      "a 070- integration suite appeared without this guard being advanced",
    ).toEqual([]);
    expect(functionalSource).not.toMatch(/create\s+table/i);
    expect(functionalSource).not.toMatch(/alter\s+table/i);
  });
});
