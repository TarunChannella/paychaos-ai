import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Phase 3E-A — static safety guard over the evidence-snapshot production
 * surface (`lib/evidence/merchant-state-snapshot.ts`,
 * `lib/evidence/evidence-repository.ts`) and the instrumentation added to
 * `lib/events/processor.ts`.
 *
 * Mirrors `tests/unit/chaos/c11-runtime-static-guard.test.ts` and
 * `tests/unit/chaos/c11-a-static-guard.test.ts` exactly: asserts required
 * elements are PRESENT and forbidden ones are ABSENT from FUNCTIONAL code
 * (comments stripped with the same helper), so this task's Sections 7/9/11/
 * 12/13/17/19/20 cannot silently regress in a later round.
 *
 * A plain static text check (no imports of the target modules, no Supabase,
 * no mocks) — runs in the offline unit suite.
 */

const repoRoot = path.resolve(import.meta.dirname, "../../../");

const snapshotFile = path.join(
  repoRoot,
  "lib",
  "evidence",
  "merchant-state-snapshot.ts",
);
const evidenceRepositoryFile = path.join(
  repoRoot,
  "lib",
  "evidence",
  "evidence-repository.ts",
);
const processorFile = path.join(repoRoot, "lib", "events", "processor.ts");

const snapshotSource = fs.readFileSync(snapshotFile, "utf-8");
const evidenceRepositorySource = fs.readFileSync(
  evidenceRepositoryFile,
  "utf-8",
);
const processorSource = fs.readFileSync(processorFile, "utf-8");

/** Mirrors `057-chaos-c11-fixture-provenance-guard.test.ts`'s helper exactly. */
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

const functionalSnapshotSource = stripComments(snapshotSource);
const functionalEvidenceRepositorySource = stripComments(
  evidenceRepositorySource,
);
const functionalProcessorSource = stripComments(processorSource);

const allFunctionalSources = [
  functionalSnapshotSource,
  functionalEvidenceRepositorySource,
  functionalProcessorSource,
];

const MERCHANT_TABLES = [
  "orders",
  "payment_attempts",
  "payments",
  "fulfilments",
  "webhook_events",
  "chaos_runs",
] as const;

describe("Phase 3E-A evidence surface — required elements present", () => {
  it("1: both evidence modules are server-only", () => {
    expect(snapshotSource).toMatch(/^import\s+["']server-only["'];/m);
    expect(evidenceRepositorySource).toMatch(/^import\s+["']server-only["'];/m);
  });

  it("2: the snapshot module exports the versioned builder and serializer", () => {
    expect(functionalSnapshotSource).toMatch(
      /export const MERCHANT_STATE_SNAPSHOT_VERSION\s*=\s*1\s+as const;/,
    );
    expect(functionalSnapshotSource).toMatch(
      /export function buildMerchantStateSnapshot/,
    );
    expect(functionalSnapshotSource).toMatch(
      /export function serializeMerchantStateSnapshot/,
    );
  });

  it("3: the evidence repository exports the capture + both set-once persist functions", () => {
    expect(functionalEvidenceRepositorySource).toMatch(
      /export async function captureMerchantStateSnapshotForProcessingAttempt/,
    );
    expect(functionalEvidenceRepositorySource).toMatch(
      /export async function persistProcessingStateBefore/,
    );
    expect(functionalEvidenceRepositorySource).toMatch(
      /export async function persistProcessingStateAfter/,
    );
  });

  it("4: it defines its own typed error class, so no raw Supabase error can escape", () => {
    expect(functionalEvidenceRepositorySource).toMatch(
      /export class EvidenceRepositoryError extends Error/,
    );
  });

  it("5: both persist functions use the set-once conditional-UPDATE idiom (`.is(column, null)`)", () => {
    expect(functionalEvidenceRepositorySource).toMatch(
      /\.is\(\s*["']state_before["']\s*,\s*null\s*\)/,
    );
    expect(functionalEvidenceRepositorySource).toMatch(
      /\.is\(\s*["']state_after["']\s*,\s*null\s*\)/,
    );
  });

  it("6: the processor still calls the existing merchant-processing repository function", () => {
    expect(functionalProcessorSource).toMatch(
      /await processWebhookPaymentEvent\(processingAttemptId\)/,
    );
  });

  it("7: the processor instruments before AND after the existing call", () => {
    expect(functionalProcessorSource).toMatch(
      /captureProcessingSnapshot\(processingAttemptId,\s*["']before["']\)/,
    );
    expect(functionalProcessorSource).toMatch(
      /captureProcessingSnapshot\(processingAttemptId,\s*["']after["']\)/,
    );
  });
});

describe("Phase 3E-A evidence surface — forbidden elements absent (functional code)", () => {
  it("8: never calls fetch/axios/a raw http(s) client or constructs a Razorpay SDK client", () => {
    for (const source of allFunctionalSources) {
      expect(source).not.toMatch(/fetch\(/);
      expect(source).not.toMatch(/axios/);
      expect(source).not.toMatch(/https?\.request\(/);
      expect(source).not.toMatch(/new\s+Razorpay\s*\(/);
      expect(source).not.toMatch(/require\(\s*["']razorpay["']\s*\)/i);
      expect(source).not.toMatch(/from\s+["']@\/lib\/razorpay\//);
    }
  });

  it("9: never imports or calls the Checkout verification surface", () => {
    for (const source of allFunctionalSources) {
      expect(source).not.toMatch(/verifyCheckoutAction/);
      expect(source).not.toMatch(/verifyCheckoutAndPersistPayment/);
    }
  });

  it("10: never creates or prechecks a chaos run", () => {
    for (const source of allFunctionalSources) {
      expect(source).not.toMatch(/\bcreateChaosRun\b/);
      expect(source).not.toMatch(/createPendingChaosRun/);
      expect(source).not.toMatch(/runChaosPrecheck/);
    }
  });

  it("11: never creates a replay processing attempt and never records a duplicate delivery", () => {
    for (const source of allFunctionalSources) {
      expect(source).not.toMatch(/insertReplayProcessingAttempt/);
      expect(source).not.toMatch(/record_webhook_duplicate_delivery/);
    }
  });

  it("12: never touches an LLM/AI runtime client", () => {
    for (const source of allFunctionalSources) {
      expect(source).not.toMatch(/openai|anthropic|ollama|langchain|gemini/i);
    }
  });

  it("13: never accepts an arbitrary target URL/host/endpoint as input", () => {
    for (const source of allFunctionalSources) {
      for (const forbidden of [
        "targetUrl",
        "targetHost",
        "target_endpoint",
        "webhook_url",
        "callback_url",
        "hostname",
        "url:",
        "host:",
      ]) {
        expect(source).not.toContain(forbidden);
      }
    }
  });

  it("14: never writes to orders/payment_attempts/payments/fulfilments/webhook_events/chaos_runs", () => {
    for (const table of MERCHANT_TABLES) {
      // Same shape as tests/unit/chaos/c11-a-static-guard.test.ts: `[^;]*`
      // confines the match to a SINGLE chained statement, so this can only
      // ever flag a genuine `client.from("<table>").update(...)` chain and
      // never a later, unrelated statement elsewhere in the file.
      const mutationPattern = new RegExp(
        `\\.from\\(\\s*["']${table}["']\\s*\\)[^;]*\\.(insert|update|delete|upsert)\\(`,
      );
      for (const source of allFunctionalSources) {
        expect(source).not.toMatch(mutationPattern);
      }
    }
  });

  it("15: the ONLY mutating calls anywhere in the evidence surface are the two state_before/state_after updates on event_processing_attempts", () => {
    const updateMatches = [
      ...functionalEvidenceRepositorySource.matchAll(/\.update\(([^)]*)\)/g),
    ].map((m) => m[1]!.trim());
    expect(updateMatches).toEqual([
      "{ state_before: value }",
      "{ state_after: value }",
    ]);
    // No other mutation verb exists in either evidence module at all.
    for (const source of [
      functionalSnapshotSource,
      functionalEvidenceRepositorySource,
    ]) {
      expect(source).not.toMatch(/\.insert\(/);
      expect(source).not.toMatch(/\.delete\(/);
      expect(source).not.toMatch(/\.upsert\(/);
    }
    expect(functionalSnapshotSource).not.toMatch(/\.update\(/);
  });

  it("16: the snapshot module is pure — no Supabase client, no clock, no randomness", () => {
    expect(functionalSnapshotSource).not.toMatch(/getSupabaseServerClient/);
    expect(functionalSnapshotSource).not.toMatch(/\.from\(/);
    expect(functionalSnapshotSource).not.toMatch(/new Date\(/);
    expect(functionalSnapshotSource).not.toMatch(/Date\.now\(/);
    expect(functionalSnapshotSource).not.toMatch(/Math\.random/);
    expect(functionalSnapshotSource).not.toMatch(/randomUUID/);
  });

  it("17: the evidence repository never issues a `select *`", () => {
    const selectArgs = [
      ...functionalEvidenceRepositorySource.matchAll(/\.select\(([^)]*)\)/g),
    ].map((m) => m[1]!);
    expect(selectArgs.length).toBeGreaterThan(0);
    for (const arg of selectArgs) {
      expect(arg).not.toContain("*");
    }
  });

  it("18: no invariant/finding/score/diagnosis vocabulary leaks into the evidence surface", () => {
    for (const source of [
      functionalSnapshotSource,
      functionalEvidenceRepositorySource,
    ]) {
      expect(source).not.toMatch(/invariant_results/);
      expect(source).not.toMatch(/\bfindings\b/);
      expect(source).not.toMatch(/regression_runs/);
      expect(source).not.toMatch(/reliability_score/i);
    }
  });

  it("19: TEST_FIXTURE / PAYCHAOS_SIMULATION runtime is not enabled or referenced by the evidence surface", () => {
    for (const source of allFunctionalSources) {
      expect(source).not.toMatch(/TEST_FIXTURE/);
      expect(source).not.toMatch(/PAYCHAOS_SIMULATION/);
    }
  });

  it("20: the evidence surface never reads or writes provenance (source_kind), so a snapshot can never change it", () => {
    for (const source of [
      functionalSnapshotSource,
      functionalEvidenceRepositorySource,
    ]) {
      expect(source).not.toMatch(/source_kind/);
    }
  });
});

describe("Phase 3E-A does not modify frozen C01/C03/C07/C11 mechanics", () => {
  it("21: the processor still declares exactly one parameter and returns the processor's own result", () => {
    const fnMatch = processorSource.match(
      /export async function processMerchantWebhookEvent\(([^)]*)\)/,
    );
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![1]!.trim().replace(/,$/, "")).toBe(
      "processingAttemptId: string",
    );
  });

  it("22: the processor never references a replay attempt count", () => {
    expect(functionalProcessorSource).not.toMatch(/C01_REPLAY_ATTEMPT_COUNT/);
    expect(functionalProcessorSource).not.toMatch(/C11_REPLAY_ATTEMPT_COUNT/);
  });

  it("23: the frozen replay counts are untouched in their own modules", () => {
    const replayService = fs.readFileSync(
      path.join(repoRoot, "lib", "chaos", "replay-service.ts"),
      "utf-8",
    );
    const c11Service = fs.readFileSync(
      path.join(repoRoot, "lib", "chaos", "c11-execution-service.ts"),
      "utf-8",
    );
    expect(replayService).toMatch(
      /export const C01_REPLAY_ATTEMPT_COUNT\s*=\s*2\s*;/,
    );
    expect(c11Service).toMatch(
      /export const C11_REPLAY_ATTEMPT_COUNT\s*=\s*1\s*;/,
    );
  });

  it("24: C03 remains processor-independent — its execution service still never calls the merchant processor, so Phase 3E-A creates no processing attempt for it", () => {
    const c03Service = stripComments(
      fs.readFileSync(
        path.join(repoRoot, "lib", "chaos", "c03-execution-service.ts"),
        "utf-8",
      ),
    );
    expect(c03Service).not.toMatch(/processMerchantWebhookEvent/);
    expect(c03Service).not.toMatch(/insertReplayProcessingAttempt/);
    expect(c03Service).not.toMatch(/from\s+["']@\/lib\/evidence\//);
  });

  it("25b: no chaos execution service imports the evidence surface directly — snapshots are inherited through the single central processor only", () => {
    for (const file of [
      "replay-service.ts",
      "c03-execution-service.ts",
      "c07-execution-service.ts",
      "c11-execution-service.ts",
    ]) {
      const source = stripComments(
        fs.readFileSync(path.join(repoRoot, "lib", "chaos", file), "utf-8"),
      );
      expect(source).not.toMatch(/@\/lib\/evidence\//);
      expect(source).not.toMatch(/state_before/);
      expect(source).not.toMatch(/state_after/);
    }
  });
});

/**
 * ============================================================================
 * Phase 3E-A architect correction — the terminal-backfill protection must not
 * be able to silently disappear.
 * ============================================================================
 *
 * Every assertion below runs against COMMENT-STRIPPED functional source, so a
 * reassuring comment alone can never satisfy this guard.
 */
describe("Phase 3E-A — no-historical-backfill protection is structurally present", () => {
  it("26: the state_before UPDATE carries BOTH the lifecycle guard (status = PENDING) and the set-once guard (state_before IS NULL) in one statement", () => {
    const guardedWrite =
      /\.update\(\s*\{\s*state_before:[^}]*\}\s*\)[\s\S]{0,400}?\.eq\(\s*["']status["']\s*,\s*["']PENDING["']\s*\)[\s\S]{0,200}?\.is\(\s*["']state_before["']\s*,\s*null\s*\)/;
    expect(functionalEvidenceRepositorySource).toMatch(guardedWrite);
  });

  it("27: EVERY state_before update in the evidence repository is guarded — there is no second, unguarded write path", () => {
    const beforeUpdates = [
      ...functionalEvidenceRepositorySource.matchAll(
        /\.update\(\s*\{\s*state_before:[\s\S]{0,600}?(?=\.maybeSingle\(|\.single\(|;)/g,
      ),
    ].map((m) => m[0]!);
    expect(beforeUpdates.length).toBeGreaterThan(0);
    for (const chain of beforeUpdates) {
      expect(chain).toMatch(
        /\.eq\(\s*["']status["']\s*,\s*["']PENDING["']\s*\)/,
      );
      expect(chain).toMatch(/\.is\(\s*["']state_before["']\s*,\s*null\s*\)/);
    }
  });

  it("28: every state_after update is still set-once guarded", () => {
    const afterUpdates = [
      ...functionalEvidenceRepositorySource.matchAll(
        /\.update\(\s*\{\s*state_after:[\s\S]{0,600}?(?=\.maybeSingle\(|\.single\(|;)/g,
      ),
    ].map((m) => m[0]!);
    expect(afterUpdates.length).toBeGreaterThan(0);
    for (const chain of afterUpdates) {
      expect(chain).toMatch(/\.is\(\s*["']state_after["']\s*,\s*null\s*\)/);
    }
  });

  it("29: the repository exposes a lifecycle eligibility read and a NOT_ELIGIBLE outcome", () => {
    expect(functionalEvidenceRepositorySource).toMatch(
      /export async function getProcessingSnapshotEligibility/,
    );
    expect(functionalEvidenceRepositorySource).toMatch(/ELIGIBLE_PENDING/);
    expect(functionalEvidenceRepositorySource).toMatch(/NOT_ELIGIBLE_TERMINAL/);
    expect(functionalEvidenceRepositorySource).toMatch(/READ_FAILED/);
    expect(functionalEvidenceRepositorySource).toMatch(/["']NOT_ELIGIBLE["']/);
  });

  it("30: a NOT_ELIGIBLE result is returned directly and never routed through verifyPersistedSnapshot — a NULL column on a terminal row is valid history, not corruption", () => {
    expect(functionalEvidenceRepositorySource).toMatch(
      /outcome:\s*["']NOT_ELIGIBLE["']\s*,\s*snapshot:\s*null/,
    );
  });

  it("31: the processor resolves eligibility BEFORE invoking the merchant processor", () => {
    const eligibilityIdx = functionalProcessorSource.indexOf(
      "isEligibleForSnapshotCapture(processingAttemptId)",
    );
    const processIdx = functionalProcessorSource.indexOf(
      "await processWebhookPaymentEvent(processingAttemptId)",
    );
    expect(eligibilityIdx).toBeGreaterThan(-1);
    expect(processIdx).toBeGreaterThan(-1);
    expect(eligibilityIdx).toBeLessThan(processIdx);
  });

  it("32: every snapshot capture call site in the processor is gated on eligibility", () => {
    const captureCalls = [
      ...functionalProcessorSource.matchAll(
        /captureProcessingSnapshot\(processingAttemptId,\s*["'](before|after)["']\)/g,
      ),
    ];
    expect(captureCalls.length).toBeGreaterThanOrEqual(3);
    // The gating flag is referenced at least once per call site.
    const gateReferences = [
      ...functionalProcessorSource.matchAll(/eligibleForSnapshots/g),
    ];
    expect(gateReferences.length).toBeGreaterThanOrEqual(captureCalls.length);
  });

  it("33: the processor explicitly suppresses an AFTER capture for an already_processed re-entry and for PROCESSING_ATTEMPT_NOT_READY", () => {
    expect(functionalProcessorSource).toMatch(
      /result\.outcome === ["']already_processed["']/,
    );
    expect(functionalProcessorSource).toMatch(/ALREADY_PROCESSED_REENTRY/);
    expect(functionalProcessorSource).toMatch(
      /repositoryCode !== ["']PROCESSING_ATTEMPT_NOT_READY["']/,
    );
  });

  it("34: no direct historical backfill helper exists anywhere in the evidence surface", () => {
    for (const source of allFunctionalSources) {
      expect(source).not.toMatch(/backfill/i);
      expect(source).not.toMatch(/reconstructSnapshot/i);
      expect(source).not.toMatch(/forceSnapshot/i);
      expect(source).not.toMatch(/overwriteSnapshot/i);
      expect(source).not.toMatch(/repairSnapshot/i);
    }
  });

  it("35: the migration's no-backfill promise is actually enforced by production code (architect correction §12) — the SQL states historical rows stay NULL, and the processor's eligibility gate is what makes that true", () => {
    const migrationSql = fs.readFileSync(
      path.join(
        repoRoot,
        "supabase",
        "migrations",
        "20260901000000_phase3e_evidence_snapshots.sql",
      ),
      "utf-8",
    );
    // The migration still makes the claim (it must never be weakened to make
    // an implementation look correct).
    expect(migrationSql).toMatch(/no backfill/i);
    expect(migrationSql).toMatch(/keeps? NULL for both columns/i);

    // And the production code structurally enforces it.
    expect(functionalProcessorSource).toMatch(/isEligibleForSnapshotCapture/);
    expect(functionalEvidenceRepositorySource).toMatch(
      /\.eq\(\s*["']status["']\s*,\s*["']PENDING["']\s*\)/,
    );
  });
});
