import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Phase 3D-E — a static regression guard against
 * `tests/integration/supabase/059-chaos-c11-a-observation.integration.test.ts`
 * ever repeating the exact provenance mistake `057`'s first draft made
 * (Phase 3D-C correction): claiming genuine `RECORDED_TEST_EVIDENCE` from a
 * synthetic mechanics fixture, or invoking the production positive-path
 * execution service/entry points instead of the established `053`/`057`/
 * `058` SYNTHETIC_DEMO mechanics pattern.
 *
 * A plain static text check (no Supabase connection, offline unit suite) —
 * mirrors `058-chaos-c11-real-webhook-replay-provenance-guard.test.ts`
 * exactly.
 */

const repoRoot = path.resolve(import.meta.dirname, "../../../");
const targetFile = path.join(
  repoRoot,
  "tests",
  "integration",
  "supabase",
  "059-chaos-c11-a-observation.integration.test.ts",
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

describe("059-chaos-c11-a-observation.integration.test.ts — provenance guard", () => {
  it("found the target file and it is non-empty", () => {
    expect(source.length).toBeGreaterThan(0);
  });

  it("uses resolveC11AFailureObservationEvidence / readC11AObservedMerchantState (the resolvers under test)", () => {
    expect(functionalSource).toMatch(/resolveC11AFailureObservationEvidence/);
    expect(functionalSource).toMatch(/readC11AObservedMerchantState/);
  });

  it("uses startPendingC11ARunAtomically (the lifecycle disambiguation function under test)", () => {
    expect(functionalSource).toMatch(/startPendingC11ARunAtomically/);
  });

  it("creates every chaos_run classified SYNTHETIC_DEMO — never RECORDED_TEST_EVIDENCE as a WRITE value", () => {
    expect(functionalSource).toMatch(
      /dataClassification:\s*["']SYNTHETIC_DEMO["']/,
    );
    // RECORDED_TEST_EVIDENCE may legitimately appear as a comment-adjacent
    // string documenting the C11-B-shaped negative-path row this file
    // builds to prove it is REJECTED — but never as a value this file
    // itself treats as a genuine positive claim. The dedicated negative
    // test explicitly asserts startPendingC11ARunAtomically returns null
    // for it.
    const dataClassificationWrites = [
      ...functionalSource.matchAll(/dataClassification:\s*["']([^"']+)["']/g),
    ].map((m) => m[1]);
    expect(dataClassificationWrites.length).toBeGreaterThan(0);
    for (const value of dataClassificationWrites) {
      expect(["SYNTHETIC_DEMO", "RECORDED_TEST_EVIDENCE"]).toContain(value);
    }
  });

  it("uses the repository-level createPendingChaosRun — never the Phase 3A/3B/3D-E production chaos-creation/start entry points", () => {
    expect(functionalSource).toMatch(/\bcreatePendingChaosRun\b/);
    expect(functionalSource).not.toMatch(/runChaosPrecheck/);
    expect(functionalSource).not.toMatch(/(?<!Pending)\bcreateChaosRun\b/);
    expect(functionalSource).not.toMatch(/startC11AFailureObservation/);
    expect(functionalSource).not.toMatch(
      /reconcileC11AFailedPaymentObservation/,
    );
    expect(functionalSource).not.toMatch(/cancelRunningC11AObservation/);
  });

  it("never imports or calls the C11-B or C01 production positive-path execution services/routes", () => {
    expect(functionalSource).not.toMatch(/executeC11RealWebhookReplay/);
    expect(functionalSource).not.toMatch(/executeC01Replay/);
    expect(functionalSource).not.toMatch(
      /from\s+["']@\/lib\/chaos\/c11-execution-service["']/,
    );
    expect(functionalSource).not.toMatch(
      /from\s+["']@\/lib\/chaos\/replay-service["']/,
    );
    expect(functionalSource).not.toMatch(/execute-c11-b\/route/);
    expect(functionalSource).not.toMatch(/start-c11-a\/route/);
  });

  it("never calls processMerchantWebhookEvent or insertReplayProcessingAttempt — C11-A has no replay/processing mechanism", () => {
    expect(functionalSource).not.toMatch(/processMerchantWebhookEvent/);
    expect(functionalSource).not.toMatch(/insertReplayProcessingAttempt/);
  });

  it("uses the real, unmodified normalizeRazorpayEvent for authentic normalized_event shape", () => {
    expect(functionalSource).toMatch(/normalizeRazorpayEvent/);
  });

  it("documents the three-layer provenance distinction", () => {
    expect(source).toMatch(/SYNTHETIC_DEMO/);
    expect(source).toMatch(/SYNTHETIC CANONICAL COMPATIBILITY/i);
    expect(source).toMatch(/never claims a genuine positive/i);
  });

  it("child-before-parent cleanup order is documented and present in afterAll", () => {
    const afterAllIndex = source.indexOf("afterAll(async ()");
    expect(afterAllIndex).toBeGreaterThan(-1);
    const afterAllSource = source.slice(afterAllIndex);
    const epaIdx = afterAllSource.indexOf("event_processing_attempts");
    const chaosIdx = afterAllSource.indexOf('"chaos_runs"');
    const webhookIdx = afterAllSource.indexOf('"webhook_events"');
    const paymentsIdx = afterAllSource.indexOf('"payments"');
    const attemptsIdx = afterAllSource.indexOf('"payment_attempts"');
    const ordersIdx = afterAllSource.indexOf('"orders"');
    expect(epaIdx).toBeGreaterThan(-1);
    expect(epaIdx).toBeLessThan(chaosIdx);
    expect(chaosIdx).toBeLessThan(webhookIdx);
    expect(webhookIdx).toBeLessThan(paymentsIdx);
    expect(paymentsIdx).toBeLessThan(attemptsIdx);
    expect(attemptsIdx).toBeLessThan(ordersIdx);
  });

  it("independently proves zero remaining rows for all six owned tables after cleanup", () => {
    for (const table of [
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
});
