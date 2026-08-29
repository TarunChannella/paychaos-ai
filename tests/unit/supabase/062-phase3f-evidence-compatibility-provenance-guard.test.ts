import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Phase 3F evidence-compatibility correction — a static regression guard
 * against
 * `tests/integration/supabase/062-phase3f-evidence-compatibility.integration.test.ts`
 * ever claiming genuine `RECORDED_TEST_EVIDENCE` from a synthetic mechanics
 * fixture, invoking a production positive-path chaos execution service or HTTP
 * route, touching Razorpay, mutating historical Phase 3D evidence, or
 * asserting a money verdict.
 *
 * Mirrors `061-phase3e-chaos-evidence-provenance-guard.test.ts` exactly. A
 * plain static text check (no Supabase connection, offline unit suite).
 */

const repoRoot = path.resolve(import.meta.dirname, "../../../");
const targetFile = path.join(
  repoRoot,
  "tests",
  "integration",
  "supabase",
  "062-phase3f-evidence-compatibility.integration.test.ts",
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

describe("062-phase3f-evidence-compatibility.integration.test.ts — provenance guard", () => {
  it("1: found the target file and it is non-empty", () => {
    expect(source.length).toBeGreaterThan(0);
  });

  it("2: exercises the Phase 3F evidence-compatibility surfaces under test", () => {
    expect(functionalSource).toMatch(/captureC03MutationSnapshot/);
    expect(functionalSource).toMatch(/assembleChaosRunEvidence/);
    expect(functionalSource).toMatch(
      /from\s+["']@\/lib\/chaos\/c03-mutation-snapshot-repository["']/,
    );
    expect(functionalSource).toMatch(
      /from\s+["']@\/lib\/evidence\/chaos-evidence-service["']/,
    );
  });

  it("3: creates every chaos_run classified SYNTHETIC_DEMO — never RECORDED_TEST_EVIDENCE", () => {
    const classifications = [
      ...functionalSource.matchAll(/data_classification:\s*["']([^"']+)["']/g),
    ].map((m) => m[1]);
    expect(classifications.length).toBeGreaterThan(0);
    for (const value of classifications) {
      expect(value).toBe("SYNTHETIC_DEMO");
    }
    expect(functionalSource).not.toMatch(/RECORDED_TEST_EVIDENCE/);
  });

  it("4: never invokes a production chaos creation, precheck or execution service", () => {
    for (const forbidden of [
      "createChaosRun",
      "createPendingChaosRun",
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
      expect(functionalSource).not.toContain(forbidden);
    }
  });

  it("5: never invokes a chaos HTTP route or performs any network request of its own", () => {
    expect(functionalSource).not.toMatch(/\bfetch\s*\(/);
    expect(functionalSource).not.toMatch(/\/api\/chaos\//);
    expect(functionalSource).not.toMatch(/NextRequest/);
    expect(functionalSource).not.toMatch(/\baxios\b/i);
  });

  it("6: never touches Razorpay — no SDK, no API call, no key material", () => {
    expect(functionalSource).not.toMatch(/new\s+Razorpay\s*\(/);
    expect(functionalSource).not.toMatch(/from\s+["']@\/lib\/razorpay\//);
    expect(functionalSource).not.toMatch(/RAZORPAY_KEY_SECRET/);
    expect(functionalSource).not.toMatch(/RAZORPAY_WEBHOOK_SECRET/);
  });

  it("7: asserts NO money verdict anywhere — this layer assigns none", () => {
    expect(functionalSource).not.toMatch(/toBe\(\s*["']PASS["']\s*\)/);
    expect(functionalSource).not.toMatch(/toBe\(\s*["']FAIL["']\s*\)/);
    expect(functionalSource).not.toMatch(
      /toBe\(\s*["']NOT_APPLICABLE["']\s*\)/,
    );
    expect(functionalSource).not.toMatch(/invariant_results/);
    expect(functionalSource).not.toMatch(/createFinding/);
  });

  it("8: records pre-existing historical evidence up front and re-asserts it unchanged at the end", () => {
    expect(functionalSource).toMatch(/preExistingAttemptEvidence/);
    expect(functionalSource).toMatch(/preExistingChaosRunFaultState/);
    expect(functionalSource).toMatch(/beforeAll\(/);
    expect(functionalSource).toMatch(/afterAll\(/);
  });

  it("9: every delete is exact-ID-scoped — never a broad or unfiltered delete", () => {
    const deletes = [...functionalSource.matchAll(/\.delete\(\)([^;]*)/g)].map(
      (m) => m[1]!,
    );
    expect(deletes.length).toBeGreaterThan(0);
    for (const tail of deletes) {
      // Must be constrained by an explicit id list.
      expect(tail).toMatch(/\.in\(\s*["']id["']/);
    }
    expect(functionalSource).not.toMatch(/\.neq\(/);
    expect(functionalSource).not.toMatch(/truncate/i);
  });

  it("10: every database UPDATE is scoped to a row this file created", () => {
    // Scoped to Supabase updates only — `createHash(...).update(...)` is a
    // crypto call, not a database write, and must not be caught here.
    const updates = [
      ...functionalSource.matchAll(
        /\.from\(\s*["'][^"']+["']\s*\)\s*\n?\s*\.update\(([\s\S]*?);/g,
      ),
    ].map((m) => m[1]!);
    expect(updates.length).toBeGreaterThan(0);
    for (const tail of updates) {
      expect(tail).toMatch(/\.eq\(\s*["']id["']\s*,\s*fixture\.orderId\s*\)/);
    }
  });

  it("11: never CALLS a reconstruct/backfill/repair helper (naming one in a test title is fine)", () => {
    // Matches an invocation, not prose — the point is that no such helper is
    // ever executed, while a test may legitimately be NAMED for the behavior
    // it proves absent.
    expect(functionalSource).not.toMatch(/\bbackfill\w*\s*\(/i);
    expect(functionalSource).not.toMatch(/\breconstruct\w*\s*\(/i);
    expect(functionalSource).not.toMatch(/\brepairSnapshot\w*\s*\(/i);
    expect(functionalSource).not.toMatch(/\bsynthesiz\w*\s*\(/i);
  });

  it("12: proves the false-no-capture protection explicitly", () => {
    // The single most important behavioural guarantee of this correction.
    expect(functionalSource).toMatch(/INCOMPLETE_INTERNAL_CORRELATION/);
    expect(functionalSource).toMatch(/SEARCH_INCOMPLETE/);
    expect(functionalSource).toMatch(/NONE_OBSERVED/);
  });
});
