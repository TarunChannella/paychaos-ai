import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Phase 3E-B — static safety guard over the read-only chaos-run evidence
 * assembly surface (`lib/evidence/chaos-run-evidence.ts`,
 * `lib/evidence/chaos-evidence-repository.ts`,
 * `lib/evidence/chaos-evidence-service.ts`).
 *
 * Mirrors `tests/unit/evidence/phase3e-a-static-guard.test.ts` exactly:
 * asserts required elements are PRESENT and forbidden ones are ABSENT from
 * FUNCTIONAL code (comments stripped with the same helper), so a later round
 * cannot silently reintroduce a write, an execution call, a network call, an
 * invariant verdict, or a current-merchant-state read.
 *
 * A plain static text check (no imports of the target modules, no Supabase,
 * no mocks) — runs in the offline unit suite.
 */

const repoRoot = path.resolve(import.meta.dirname, "../../../");

const domainFile = path.join(
  repoRoot,
  "lib",
  "evidence",
  "chaos-run-evidence.ts",
);
const repositoryFile = path.join(
  repoRoot,
  "lib",
  "evidence",
  "chaos-evidence-repository.ts",
);
const serviceFile = path.join(
  repoRoot,
  "lib",
  "evidence",
  "chaos-evidence-service.ts",
);

const domainSource = fs.readFileSync(domainFile, "utf-8");
const repositorySource = fs.readFileSync(repositoryFile, "utf-8");
const serviceSource = fs.readFileSync(serviceFile, "utf-8");

/** Mirrors `phase3e-a-static-guard.test.ts`'s helper exactly. */
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

/**
 * Returns the body of one named function from comment-stripped source, by
 * brace matching from its declaration. Used by the Blocker 2 guards so a
 * prohibition can be scoped to the function that must obey it, rather than to
 * the whole file (where an unrelated `.sort(` elsewhere would be a false
 * positive). Returns `null` if the function is not found — every caller
 * asserts non-null, so a renamed or deleted function fails the guard loudly
 * instead of silently passing.
 */
function extractFunctionBody(source: string, name: string): string | null {
  const declaration = new RegExp(
    `function\\s+${name}\\s*\\([\\s\\S]*?\\)[\\s\\S]*?\\{`,
  ).exec(source);
  if (!declaration) return null;

  let depth = 0;
  const start = declaration.index + declaration[0].length - 1;
  for (let i = start; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}

const functionalDomainSource = stripComments(domainSource);
const functionalRepositorySource = stripComments(repositorySource);
const functionalServiceSource = stripComments(serviceSource);

const allFunctionalSources = [
  functionalDomainSource,
  functionalRepositorySource,
  functionalServiceSource,
];

/** Every table Phase 3E-B must never write to, plus the four it must never even READ. */
const ALL_TABLES = [
  "orders",
  "payment_attempts",
  "payments",
  "fulfilments",
  "webhook_events",
  "chaos_runs",
  "event_processing_attempts",
] as const;

const CURRENT_MERCHANT_STATE_TABLES = [
  "orders",
  "payment_attempts",
  "payments",
  "fulfilments",
] as const;

describe("Phase 3E-B evidence assembly — required elements present", () => {
  it("1: all three modules are server-only", () => {
    for (const source of [domainSource, repositorySource, serviceSource]) {
      expect(source).toMatch(/^import\s+["']server-only["'];/m);
    }
  });

  it("2: the public entry point is assembleChaosRunEvidence and takes only a chaos run id", () => {
    expect(functionalServiceSource).toMatch(
      /export async function assembleChaosRunEvidence/,
    );
    const fnMatch = functionalServiceSource.match(
      /export async function assembleChaosRunEvidence\(([^)]*)\)/,
    );
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![1]!.trim().replace(/,$/, "")).toBe("chaosRunId: string");
  });

  it("3: the domain module exports the versioned bundle builder and the runtime snapshot parser", () => {
    expect(functionalDomainSource).toMatch(
      /export const CHAOS_RUN_EVIDENCE_BUNDLE_VERSION\s*=\s*1\s+as const;/,
    );
    expect(functionalDomainSource).toMatch(
      /export function buildChaosRunEvidenceBundle/,
    );
    expect(functionalDomainSource).toMatch(
      /export function parseMerchantStateSnapshotV1/,
    );
    expect(functionalDomainSource).toMatch(
      /export function parseC03VerificationChecks/,
    );
    expect(functionalDomainSource).toMatch(
      /export function parseC07FaultStateEvidence/,
    );
  });

  it("4: the repository defines its own typed error class, so no raw Supabase error can escape", () => {
    expect(functionalRepositorySource).toMatch(
      /export class ChaosEvidenceRepositoryError extends Error/,
    );
    expect(functionalRepositorySource).not.toMatch(/error\.message/);
    expect(functionalRepositorySource).not.toMatch(/error\.details/);
  });

  it("5: the snapshot parser validates the version rather than casting", () => {
    expect(functionalDomainSource).toMatch(/MERCHANT_STATE_SNAPSHOT_VERSION/);
    expect(functionalDomainSource).toMatch(/["']INVALID["']/);
    expect(functionalDomainSource).toMatch(/["']NOT_CAPTURED["']/);
    expect(functionalDomainSource).toMatch(/["']CAPTURED["']/);
  });

  it("6: evidence references and gaps are both deduplicated and deterministically sorted", () => {
    expect(functionalDomainSource).toMatch(
      /export function dedupeAndSortEvidenceRefs/,
    );
    expect(functionalDomainSource).toMatch(
      /export function dedupeAndSortEvidenceGaps/,
    );
    expect(functionalDomainSource).toMatch(/\.sort\(compareEvidenceRefs\)/);
    expect(functionalDomainSource).toMatch(/\.sort\(compareEvidenceGaps\)/);
    expect(functionalDomainSource).toMatch(
      /\.sort\(compareProcessingAttempts\)/,
    );
  });

  /**
   * ==========================================================================
   * Architect correction, Blocker 2 — the authoritative-original rule must not
   * be able to silently regress to array-length-only, latest-attempt-wins, or
   * timestamp authority.
   * ==========================================================================
   */
  it("6b: the authoritative-original resolver exists and applies the full four-part candidate rule", () => {
    expect(functionalDomainSource).toMatch(
      /export function resolveAuthoritativeOriginalProcessingAttempt/,
    );
    expect(functionalDomainSource).toMatch(/["']EXACTLY_ONE["']/);
    expect(functionalDomainSource).toMatch(/["']AMBIGUOUS["']/);
    expect(functionalDomainSource).toMatch(/["']NONE["']/);

    const body = extractFunctionBody(
      functionalDomainSource,
      "resolveAuthoritativeOriginalProcessingAttempt",
    );
    expect(body).not.toBeNull();
    // All four candidate conditions, read from persisted columns.
    expect(body!).toMatch(/sourceKind === REAL_RAZORPAY_WEBHOOK/);
    expect(body!).toMatch(/chaosRunId === null/);
    expect(body!).toMatch(/status === PROCESSING_ATTEMPT_STATUS_SUCCEEDED/);
    expect(body!).toMatch(/isDuplicateDelivery === false/);
    // Only the CANDIDATE count decides the outcome.
    expect(body!).toMatch(/candidates\.length === 0/);
    expect(body!).toMatch(/candidates\.length === 1/);
  });

  it("6c: the resolver never uses timestamps, sorting, array position or 'latest wins' as authority", () => {
    const body = extractFunctionBody(
      functionalDomainSource,
      "resolveAuthoritativeOriginalProcessingAttempt",
    );
    expect(body).not.toBeNull();
    for (const forbidden of [
      /startedAt/,
      /finishedAt/,
      /\.sort\(/,
      /Math\.max/,
      /Math\.min/,
      /\.at\(\s*-1\s*\)/,
      /\.reverse\(/,
      /\.slice\(/,
      /\.pop\(/,
      /\.shift\(/,
    ]) {
      expect(body!).not.toMatch(forbidden);
    }
    // Never indexes the RAW history array — only the filtered candidate set.
    expect(body!).not.toMatch(/originalProcessingAttempts\[/);
    expect(body!).not.toMatch(/originalProcessingAttempts\.length/);
  });

  it("6d: every scenario that has original provider attempts routes through the resolver, not through a length check", () => {
    for (const fn of [
      "buildC01Evidence",
      "buildC07Evidence",
      "buildC11Evidence",
    ]) {
      const body = extractFunctionBody(functionalDomainSource, fn);
      expect(body).not.toBeNull();
      expect(body!).toMatch(/collectAuthoritativeOriginalGaps\(/);
      expect(body!).toMatch(/authoritativeOriginalProcessingAttemptId/);
    }
    // The superseded length-only gap vocabulary is gone for good.
    expect(functionalDomainSource).not.toMatch(
      /["']MISSING_ORIGINAL_PROCESSING_ATTEMPT["']/,
    );
    expect(functionalDomainSource).not.toMatch(
      /["']AMBIGUOUS_ORIGINAL_PROCESSING_ATTEMPT["']/,
    );
    expect(functionalDomainSource).toMatch(
      /MISSING_AUTHORITATIVE_ORIGINAL_PROCESSING_ATTEMPT/,
    );
    expect(functionalDomainSource).toMatch(
      /AMBIGUOUS_AUTHORITATIVE_ORIGINAL_PROCESSING_ATTEMPT/,
    );
  });

  it("6e: FAILED/duplicate original history is never filtered out in the repository — the broad read stays broad", () => {
    const originalsRead = functionalRepositorySource.match(
      /\.from\(\s*["']event_processing_attempts["']\s*\)[\s\S]{0,400}?\.is\(\s*["']chaos_run_id["']\s*,\s*null\s*\)/,
    );
    expect(originalsRead).not.toBeNull();
    // The originals query filters on provenance only — never on status or
    // is_duplicate_delivery, so retry history stays visible in the bundle.
    expect(originalsRead![0]).not.toMatch(/\.eq\(\s*["']status["']/);
    expect(originalsRead![0]).not.toMatch(
      /\.eq\(\s*["']is_duplicate_delivery["']/,
    );
    expect(functionalRepositorySource).not.toMatch(
      /\.eq\(\s*["']status["']\s*,\s*["']SUCCEEDED["']\s*\)/,
    );
  });

  it("6f: the snapshot parser enforces the order/fulfilments completeness relationship", () => {
    const body = extractFunctionBody(
      functionalDomainSource,
      "parseMerchantStateSnapshotV1",
    );
    expect(body).not.toBeNull();
    expect(body!).toMatch(/order !== null && !Array\.isArray\(fulfilments\)/);
    expect(body!).toMatch(/order === null && fulfilments !== null/);
  });

  it("6g: the source processing-status and C03 classification facts are checked against frozen literals", () => {
    expect(functionalDomainSource).toMatch(
      /const WEBHOOK_PROCESSING_STATUS_PROCESSED = ["']PROCESSED["'];/,
    );
    expect(functionalDomainSource).toMatch(
      /const PROCESSING_ATTEMPT_STATUS_SUCCEEDED = ["']SUCCEEDED["'];/,
    );
    expect(functionalDomainSource).toMatch(
      /const C03_REQUIRED_DATA_CLASSIFICATION = ["']SYNTHETIC_DEMO["'];/,
    );
    expect(functionalDomainSource).toMatch(
      /processingStatus !== WEBHOOK_PROCESSING_STATUS_PROCESSED/,
    );
    expect(functionalDomainSource).toMatch(
      /dataClassification !== C03_REQUIRED_DATA_CLASSIFICATION/,
    );
    expect(functionalDomainSource).toMatch(/SOURCE_PROCESSING_NOT_PROCESSED/);
    expect(functionalDomainSource).toMatch(/UNEXPECTED_DATA_CLASSIFICATION/);
  });

  it("7: the repository correlates by exact internal UUID on every read", () => {
    expect(functionalRepositorySource).toMatch(
      /\.eq\(\s*["']id["']\s*,\s*chaosRunId\s*\)/,
    );
    expect(functionalRepositorySource).toMatch(
      /\.eq\(\s*["']chaos_run_id["']\s*,\s*chaosRunId\s*\)/,
    );
    expect(functionalRepositorySource).toMatch(
      /\.is\(\s*["']chaos_run_id["']\s*,\s*null\s*\)/,
    );
    expect(functionalRepositorySource).toMatch(
      /\.eq\(\s*["']source_kind["']\s*,\s*["']REAL_RAZORPAY_WEBHOOK["']\s*\)/,
    );
  });
});

describe("Phase 3E-B evidence assembly — forbidden elements absent (functional code)", () => {
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
      expect(source).not.toMatch(/createBlockedChaosRun/);
      expect(source).not.toMatch(/runChaosPrecheck/);
    }
  });

  it("11: never invokes any chaos execution service", () => {
    for (const forbidden of [
      "executeC01Replay",
      "executeC03InvalidSignatureTest",
      "armC07ClientConfirmationDrop",
      "reconcileC07ClientConfirmationDrop",
      "executeC11RealWebhookReplay",
      "startC11AFailureObservation",
      "reconcileC11AFailedPaymentObservation",
      "cancelRunningC11AObservation",
    ]) {
      for (const source of allFunctionalSources) {
        expect(source).not.toMatch(new RegExp(forbidden));
      }
    }
    for (const source of allFunctionalSources) {
      expect(source).not.toMatch(
        /from\s+["']@\/lib\/chaos\/replay-service["']/,
      );
      expect(source).not.toMatch(
        /from\s+["']@\/lib\/chaos\/replay-repository["']/,
      );
      expect(source).not.toMatch(
        /from\s+["']@\/lib\/chaos\/c03-execution-service["']/,
      );
      expect(source).not.toMatch(
        /from\s+["']@\/lib\/chaos\/c07-execution-service["']/,
      );
      expect(source).not.toMatch(
        /from\s+["']@\/lib\/chaos\/c11-execution-service["']/,
      );
      expect(source).not.toMatch(
        /from\s+["']@\/lib\/chaos\/run-repository["']/,
      );
      expect(source).not.toMatch(/from\s+["']@\/lib\/chaos\/run-service["']/);
    }
  });

  it("12: never creates a replay processing attempt and never invokes the merchant processor", () => {
    for (const source of allFunctionalSources) {
      expect(source).not.toMatch(/insertReplayProcessingAttempt/);
      expect(source).not.toMatch(/processMerchantWebhookEvent/);
      expect(source).not.toMatch(/processWebhookPaymentEvent/);
      expect(source).not.toMatch(/record_webhook_duplicate_delivery/);
      expect(source).not.toMatch(/from\s+["']@\/lib\/events\//);
    }
  });

  it("13: contains NO mutating call and NO rpc anywhere — read-only is structural", () => {
    for (const source of allFunctionalSources) {
      expect(source).not.toMatch(/\.insert\(/);
      expect(source).not.toMatch(/\.update\(/);
      expect(source).not.toMatch(/\.delete\(/);
      expect(source).not.toMatch(/\.upsert\(/);
      expect(source).not.toMatch(/\.rpc\(/);
    }
    for (const table of ALL_TABLES) {
      const mutationPattern = new RegExp(
        `\\.from\\(\\s*["']${table}["']\\s*\\)[^;]*\\.(insert|update|delete|upsert)\\(`,
      );
      for (const source of allFunctionalSources) {
        expect(source).not.toMatch(mutationPattern);
      }
    }
  });

  it("14: never reads a current mutable merchant table — the Historical Truth Rule is structural", () => {
    for (const table of CURRENT_MERCHANT_STATE_TABLES) {
      const readPattern = new RegExp(`\\.from\\(\\s*["']${table}["']\\s*\\)`);
      for (const source of allFunctionalSources) {
        expect(source).not.toMatch(readPattern);
      }
    }
    // The only three tables this surface may name in a `.from(...)`.
    const fromTargets = [
      ...functionalRepositorySource.matchAll(
        /\.from\(\s*["']([^"']+)["']\s*\)/g,
      ),
    ].map((m) => m[1]!);
    expect(fromTargets.length).toBeGreaterThan(0);
    expect(new Set(fromTargets)).toEqual(
      new Set(["chaos_runs", "webhook_events", "event_processing_attempts"]),
    );
    // The pure domain and the service touch no table at all.
    expect(functionalDomainSource).not.toMatch(/\.from\(/);
    expect(functionalServiceSource).not.toMatch(/\.from\(/);
    expect(functionalDomainSource).not.toMatch(/getSupabaseServerClient/);
    expect(functionalServiceSource).not.toMatch(/getSupabaseServerClient/);
  });

  it("15: no backfill/reconstruct/repair helper exists anywhere in the assembly surface", () => {
    for (const source of allFunctionalSources) {
      expect(source).not.toMatch(/backfill/i);
      expect(source).not.toMatch(/reconstructSnapshot/i);
      expect(source).not.toMatch(/forceSnapshot/i);
      expect(source).not.toMatch(/overwriteSnapshot/i);
      expect(source).not.toMatch(/repairSnapshot/i);
      expect(source).not.toMatch(/synthesiz/i);
    }
  });

  it("16: the repository never issues a `select *`", () => {
    const selectArgs = [
      ...functionalRepositorySource.matchAll(/\.select\(([^)]*)\)/g),
    ].map((m) => m[1]!);
    expect(selectArgs.length).toBeGreaterThan(0);
    for (const arg of selectArgs) {
      expect(arg).not.toContain("*");
    }
  });

  it("17: no invariant/finding/score/diagnosis vocabulary and no PASS/FAIL verdict leaks in", () => {
    for (const source of allFunctionalSources) {
      expect(source).not.toMatch(/invariant_results/);
      expect(source).not.toMatch(/\bfindings\b/);
      expect(source).not.toMatch(/regression_runs/);
      expect(source).not.toMatch(/reliability_score/i);
      expect(source).not.toMatch(/evaluateInvariant/);
      expect(source).not.toMatch(/createFinding/);
      expect(source).not.toMatch(/["']PASS["']/);
      expect(source).not.toMatch(/["']FAIL["']/);
      expect(source).not.toMatch(/["']NOT_APPLICABLE["']/);
    }
  });

  it("18: never touches an LLM/AI runtime client", () => {
    for (const source of allFunctionalSources) {
      expect(source).not.toMatch(/openai|anthropic|ollama|langchain|gemini/i);
    }
  });

  it("19: never accepts an arbitrary target URL/host/endpoint as input", () => {
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

  it("20: TEST_FIXTURE / PAYCHAOS_SIMULATION runtime is not enabled or referenced by functional code", () => {
    for (const source of allFunctionalSources) {
      expect(source).not.toMatch(/TEST_FIXTURE/);
      expect(source).not.toMatch(/PAYCHAOS_SIMULATION/);
    }
  });

  it("21: the bundle is deterministic — no clock read, no randomness, no generated id", () => {
    for (const source of allFunctionalSources) {
      expect(source).not.toMatch(/new Date\(/);
      expect(source).not.toMatch(/Date\.now\(/);
      expect(source).not.toMatch(/Math\.random/);
      expect(source).not.toMatch(/randomUUID/);
      expect(source).not.toMatch(/assembledAt/);
      expect(source).not.toMatch(/generatedAt/);
    }
  });

  it("22: the full normalized_event blob is never selected or copied into the bundle", () => {
    for (const source of allFunctionalSources) {
      expect(source).not.toMatch(/normalized_event/);
      expect(source).not.toMatch(/normalizedEvent/);
    }
  });

  it("23: raw payload, body hash, signature and secret columns are never named in functional code", () => {
    for (const source of allFunctionalSources) {
      expect(source).not.toMatch(/raw_payload_redacted/);
      expect(source).not.toMatch(/raw_body_sha256/);
      expect(source).not.toMatch(/rawBody/);
      expect(source).not.toMatch(/getRazorpayWebhookSecret/);
      expect(source).not.toMatch(/verifyWebhookSignature/);
      expect(source).not.toMatch(/SERVICE_ROLE/i);
    }
  });

  it("24: provenance is only ever read through from the persisted source_kind column, never relabelled", () => {
    // The projection copies the persisted column verbatim...
    expect(functionalDomainSource).toMatch(
      /sourceKind:\s*row\.source_kind\s*,/,
    );
    // ...and the two provenance literals exist only as read-side comparison
    // constants (test 13 already proves this surface performs no write at
    // all, so a persisted `source_kind` can never be changed from here).
    expect(functionalDomainSource).toMatch(
      /const REAL_RAZORPAY_WEBHOOK = ["']REAL_RAZORPAY_WEBHOOK["'];/,
    );
    expect(functionalDomainSource).toMatch(
      /const PAYCHAOS_REPLAY = ["']PAYCHAOS_REPLAY["'];/,
    );
    for (const source of allFunctionalSources) {
      // A hardcoded provenance VALUE in a projection would be a relabel.
      expect(source).not.toMatch(/sourceKind\s*:\s*["']/);
      expect(source).not.toMatch(/sourceKind\s*=\s*["']/);
    }
  });
});

describe("Phase 3E-B does not modify frozen Phase 3A-3E-A mechanics", () => {
  it("25: the frozen replay counts are untouched in their own modules, and the restated evidence constants match them exactly", () => {
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

    // The read-only assembler restates them rather than importing an
    // execution module — so they must be proven equal here.
    expect(functionalDomainSource).toMatch(
      /export const C01_EXPECTED_REPLAY_ATTEMPT_COUNT\s*=\s*2\s*;/,
    );
    expect(functionalDomainSource).toMatch(
      /export const C11B_EXPECTED_REPLAY_ATTEMPT_COUNT\s*=\s*1\s*;/,
    );
    expect(functionalDomainSource).toMatch(
      /export const C11A_EXPECTED_REPLAY_ATTEMPT_COUNT\s*=\s*0\s*;/,
    );
  });

  it("26: C03's frozen two-check order WRONG_SIGNATURE then MISSING_SIGNATURE is preserved on both sides", () => {
    const c03Service = stripComments(
      fs.readFileSync(
        path.join(repoRoot, "lib", "chaos", "c03-execution-service.ts"),
        "utf-8",
      ),
    );
    expect(c03Service).toMatch(
      /checks:\s*\[wrongSignatureCheck,\s*missingSignatureCheck\]/,
    );
    const frozenOrder = functionalDomainSource.match(
      /C03_FROZEN_CASE_ORDER[^=]*=\s*\[([\s\S]*?)\]/,
    );
    expect(frozenOrder).not.toBeNull();
    expect(frozenOrder![1]!.indexOf("WRONG_SIGNATURE")).toBeLessThan(
      frozenOrder![1]!.indexOf("MISSING_SIGNATURE"),
    );
  });

  it("27: the Phase 3E-A snapshot surface is unchanged and still owns the only snapshot writes", () => {
    const evidenceRepository = stripComments(
      fs.readFileSync(
        path.join(repoRoot, "lib", "evidence", "evidence-repository.ts"),
        "utf-8",
      ),
    );
    const updateMatches = [
      ...evidenceRepository.matchAll(/\.update\(([^)]*)\)/g),
    ].map((m) => m[1]!.trim());
    expect(updateMatches).toEqual([
      "{ state_before: value }",
      "{ state_after: value }",
    ]);
    const snapshotModule = stripComments(
      fs.readFileSync(
        path.join(repoRoot, "lib", "evidence", "merchant-state-snapshot.ts"),
        "utf-8",
      ),
    );
    expect(snapshotModule).toMatch(
      /export const MERCHANT_STATE_SNAPSHOT_VERSION\s*=\s*1\s+as const;/,
    );
  });

  it("28: no chaos execution service or the merchant processor imports the new Phase 3E-B surface", () => {
    for (const file of [
      path.join(repoRoot, "lib", "chaos", "replay-service.ts"),
      path.join(repoRoot, "lib", "chaos", "c03-execution-service.ts"),
      path.join(repoRoot, "lib", "chaos", "c07-execution-service.ts"),
      path.join(repoRoot, "lib", "chaos", "c11-execution-service.ts"),
      path.join(repoRoot, "lib", "events", "processor.ts"),
    ]) {
      const source = stripComments(fs.readFileSync(file, "utf-8"));
      expect(source).not.toMatch(/chaos-run-evidence/);
      expect(source).not.toMatch(/chaos-evidence-repository/);
      expect(source).not.toMatch(/chaos-evidence-service/);
      expect(source).not.toMatch(/assembleChaosRunEvidence/);
    }
  });

  // Phase 3F-A added exactly one approved migration
  // (20260902000000_phase3f_invariant_results.sql, docs/DATABASE.md Section
  // 16). This guard advances to pin that exact filename rather than being
  // relaxed: the rule it enforces is that the Phase 3E-B evidence surface
  // itself introduced no migration and that no GENERIC evidence table exists,
  // not that the migration set is permanently frozen at ten files.
  // `invariant_results` therefore leaves the forbidden CREATE TABLE list, but
  // stays forbidden in the Phase 3E-B evidence sources below — those modules
  // must still never name the invariant table.
  it("29: the migration set is exactly the approved files, no evidence table exists anywhere, and the Phase 3E-B surface names no invariant table", () => {
    const migrations = fs
      .readdirSync(path.join(repoRoot, "supabase", "migrations"))
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
      "20260904000000_phase4e_regression_runs.sql",
    ]);

    const migrationSql = migrations.map((migration) =>
      fs.readFileSync(
        path.join(repoRoot, "supabase", "migrations", migration),
        "utf-8",
      ),
    );

    // No GENERIC evidence table may be created by any migration, and the
    // Phase 3E-B evidence surface may name none of these.
    for (const forbidden of [
      "evidence_snapshots",
      "chaos_evidence",
      "evidence_records",
      "evidence_packs",
      "scenario_evidence",
      "generic_evidence",
    ]) {
      for (const source of allFunctionalSources) {
        expect(source).not.toContain(forbidden);
      }
      for (const sql of migrationSql) {
        expect(sql).not.toMatch(
          new RegExp(`create\\s+table[^;]*${forbidden}`, "i"),
        );
      }
    }

    // `invariant_results` is now an approved table, so it is no longer
    // forbidden in the migration set — but the frozen Phase 3E-B evidence
    // modules must still never reference it. The evidence layer assigns and
    // persists no verdict.
    for (const source of allFunctionalSources) {
      expect(source).not.toContain("invariant_results");
    }
    const invariantCreates = migrationSql.filter((sql) =>
      /create\s+table\s+public\.invariant_results\b/i.test(sql),
    );
    expect(invariantCreates.length).toBe(1);

    // `findings` is likewise an approved table as of Phase 3G — created
    // exactly once — but the frozen Phase 3E-B evidence modules must never
    // reference it either. The evidence layer reports no issue and creates
    // no finding.
    for (const source of allFunctionalSources) {
      expect(source).not.toContain("findings");
    }
    const findingCreates = migrationSql.filter((sql) =>
      /create\s+table\s+public\.findings\b/i.test(sql),
    );
    expect(findingCreates.length).toBe(1);
  });

  it("30: `fault_action` is still not part of the schema or of this surface", () => {
    for (const source of allFunctionalSources) {
      expect(source).not.toMatch(/fault_action/);
    }
    const types = fs.readFileSync(
      path.join(repoRoot, "lib", "supabase", "types.ts"),
      "utf-8",
    );
    expect(types).not.toMatch(/^\s*fault_action[?]?:/m);
  });
});

/**
 * ============================================================================
 * Phase 3F evidence-compatibility correction — static guards over the two NEW
 * C03 mutation-snapshot modules and the widened evidence projections.
 *
 * Same technique as every guard above: assertions run against COMMENT-STRIPPED
 * functional source, so a reassuring comment alone can never satisfy them.
 * ============================================================================
 */
describe("Phase 3F evidence compatibility — C03 mutation snapshot modules", () => {
  const snapshotPath = path.join(
    repoRoot,
    "lib",
    "chaos",
    "c03-mutation-snapshot.ts",
  );
  const snapshotRepoPath = path.join(
    repoRoot,
    "lib",
    "chaos",
    "c03-mutation-snapshot-repository.ts",
  );

  const snapshotSource = fs.readFileSync(snapshotPath, "utf-8");
  const snapshotRepoSource = fs.readFileSync(snapshotRepoPath, "utf-8");
  const functionalSnapshot = stripComments(snapshotSource);
  const functionalSnapshotRepo = stripComments(snapshotRepoSource);
  const bothFunctional = [functionalSnapshot, functionalSnapshotRepo];

  it("F1: both modules are server-only", () => {
    for (const source of [snapshotSource, snapshotRepoSource]) {
      expect(source).toMatch(/^import\s+["']server-only["'];/m);
    }
  });

  it("F2: the pure module is genuinely pure — no Supabase client, no clock, no randomness, no network", () => {
    expect(functionalSnapshot).not.toMatch(/getSupabaseServerClient/);
    expect(functionalSnapshot).not.toMatch(/\.from\(/);
    expect(functionalSnapshot).not.toMatch(/new Date\(/);
    expect(functionalSnapshot).not.toMatch(/Date\.now\(/);
    expect(functionalSnapshot).not.toMatch(/Math\.random/);
    expect(functionalSnapshot).not.toMatch(/randomUUID/);
    expect(functionalSnapshot).not.toMatch(/fetch\(/);
  });

  it("F3: the pure module imports the frozen merchant-state field vocabulary as TYPES ONLY, so it takes on no runtime dependency", () => {
    expect(functionalSnapshot).toMatch(
      /import type \{[\s\S]*?\} from "@\/lib\/evidence\/merchant-state-snapshot";/,
    );
    // No VALUE import from the evidence surface anywhere.
    expect(functionalSnapshot).not.toMatch(
      /^import \{[^}]*\} from "@\/lib\/evidence\//m,
    );
  });

  it("F4: the repository contains NO mutating call and NO rpc — read-only is structural", () => {
    expect(functionalSnapshotRepo).not.toMatch(/\.insert\(/);
    expect(functionalSnapshotRepo).not.toMatch(/\.update\(/);
    expect(functionalSnapshotRepo).not.toMatch(/\.delete\(/);
    expect(functionalSnapshotRepo).not.toMatch(/\.upsert\(/);
    expect(functionalSnapshotRepo).not.toMatch(/\.rpc\(/);
  });

  it("F5: the repository reads exactly the five INV-005 tables and never chaos_runs or event_processing_attempts", () => {
    const fromTargets = [
      ...functionalSnapshotRepo.matchAll(/\.from\(\s*([^)]+)\)/g),
    ].map((m) => m[1]!.trim());
    expect(fromTargets.length).toBeGreaterThan(0);
    // Table names arrive either as literals or through the narrow union
    // parameter of `readBoundedCollection`.
    const literalTables = [
      ...functionalSnapshotRepo.matchAll(/\.from\(\s*["']([^"']+)["']\s*\)/g),
    ].map((m) => m[1]!);
    expect(literalTables).toContain("webhook_events");
    expect(functionalSnapshotRepo).not.toMatch(/["']chaos_runs["']/);
    expect(functionalSnapshotRepo).not.toMatch(
      /["']event_processing_attempts["']/,
    );
    for (const table of [
      "orders",
      "payment_attempts",
      "payments",
      "fulfilments",
    ]) {
      expect(functionalSnapshotRepo).toContain(`"${table}"`);
    }
  });

  it("F6: the repository never issues a `select *`", () => {
    const selectArgs = [
      ...functionalSnapshotRepo.matchAll(/\.select\(([^)]*)\)/g),
    ].map((m) => m[1]!);
    expect(selectArgs.length).toBeGreaterThan(0);
    for (const arg of selectArgs) {
      expect(arg).not.toContain("*");
    }
  });

  it("F7: the capture entry point takes NO parameters — no caller-controlled entity selector exists", () => {
    const match = functionalSnapshotRepo.match(
      /export async function captureC03MutationSnapshot\(([^)]*)\)/,
    );
    expect(match).not.toBeNull();
    expect(match![1]!.trim()).toBe("");
  });

  it("F8: neither module performs network I/O, touches Razorpay, or reaches an LLM", () => {
    for (const source of bothFunctional) {
      expect(source).not.toMatch(/fetch\(/);
      expect(source).not.toMatch(/axios/i);
      expect(source).not.toMatch(/https?\.request\(/);
      expect(source).not.toMatch(/new\s+Razorpay\s*\(/);
      expect(source).not.toMatch(/from\s+["']@\/lib\/razorpay\//);
      expect(source).not.toMatch(/openai|anthropic|ollama|langchain|gemini/i);
    }
  });

  it("F9: neither module accepts an arbitrary target URL/host/endpoint", () => {
    for (const source of bothFunctional) {
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

  it("F10: neither module assigns a money verdict, creates a finding, or names invariant_results", () => {
    for (const source of bothFunctional) {
      expect(source).not.toMatch(/invariant_results/);
      expect(source).not.toMatch(/createFinding/);
      expect(source).not.toMatch(/evaluateInvariant/);
      expect(source).not.toMatch(/["']PASS["']/);
      expect(source).not.toMatch(/["']FAIL["']/);
      expect(source).not.toMatch(/["']NOT_APPLICABLE["']/);
    }
  });

  it("F11: neither module reads the webhook payload, signature or secret surface", () => {
    for (const source of bothFunctional) {
      expect(source).not.toMatch(/raw_payload_redacted/);
      expect(source).not.toMatch(/raw_body_sha256/);
      expect(source).not.toMatch(/normalized_event/);
      expect(source).not.toMatch(/RAZORPAY_KEY_SECRET/);
      expect(source).not.toMatch(/RAZORPAY_WEBHOOK_SECRET/);
      expect(source).not.toMatch(/idempotency_key/);
    }
  });

  it("F12: ordering is by internal id, never by a timestamp used as identity", () => {
    expect(functionalSnapshotRepo).toMatch(
      /\.order\(\s*["']id["']\s*,\s*\{\s*ascending:\s*true\s*\}\s*\)/,
    );
    for (const forbidden of [
      /\.order\(\s*["']created_at["']/,
      /\.order\(\s*["']applied_at["']/,
      /\.order\(\s*["']received_at["']/,
      /\.order\(\s*["']updated_at["']/,
    ]) {
      expect(functionalSnapshotRepo).not.toMatch(forbidden);
    }
  });

  it("F13: no backfill/reconstruct/repair helper exists in either module", () => {
    for (const source of bothFunctional) {
      expect(source).not.toMatch(/backfill/i);
      expect(source).not.toMatch(/reconstruct/i);
      expect(source).not.toMatch(/repairSnapshot/i);
      expect(source).not.toMatch(/synthesiz/i);
    }
  });
});

describe("Phase 3F evidence compatibility — version lockstep and capture-search safety", () => {
  const snapshotSource = fs.readFileSync(
    path.join(repoRoot, "lib", "chaos", "c03-mutation-snapshot.ts"),
    "utf-8",
  );

  it("G1: the write-side and read-side C03 snapshot versions are kept in lockstep", () => {
    const writeSide = stripComments(snapshotSource).match(
      /C03_MUTATION_SNAPSHOT_VERSION\s*=\s*(\d+)\s+as const/,
    );
    const readSide = functionalDomainSource.match(
      /C03_MUTATION_SNAPSHOT_EVIDENCE_VERSION\s*=\s*(\d+)/,
    );
    expect(writeSide).not.toBeNull();
    expect(readSide).not.toBeNull();
    expect(readSide![1]).toBe(writeSide![1]);
  });

  it("G2: the read-only assembler still never imports a chaos execution module, including the new ones", () => {
    for (const source of allFunctionalSources) {
      expect(source).not.toMatch(
        /from\s+["']@\/lib\/chaos\/c03-mutation-snapshot-repository["']/,
      );
      expect(source).not.toMatch(
        /from\s+["']@\/lib\/chaos\/c03-mutation-snapshot["']/,
      );
    }
  });

  it("G3: the capture resolver exists and distinguishes every required outcome", () => {
    expect(functionalDomainSource).toMatch(
      /export function resolveAuthoritativeCaptureEvidence/,
    );
    for (const kind of [
      "NO_SUBJECT",
      "AMBIGUOUS_SUBJECT",
      "SEARCH_INCOMPLETE",
      "NONE_OBSERVED",
      "EXACTLY_ONE",
      "INCOMPLETE_INTERNAL_CORRELATION",
      "AMBIGUOUS",
    ]) {
      expect(functionalDomainSource).toContain(`"${kind}"`);
    }
  });

  it("G4: the capture resolver never uses timestamps, sorting-as-authority, or latest-wins", () => {
    const body = extractFunctionBody(
      functionalDomainSource,
      "resolveAuthoritativeCaptureEvidence",
    );
    expect(body).not.toBeNull();
    for (const forbidden of [
      /receivedAt/,
      /startedAt/,
      /finishedAt/,
      /createdAt/,
      /Math\.max/,
      /Math\.min/,
      /\.at\(\s*-1\s*\)/,
      /\.reverse\(/,
      /\.pop\(/,
      /\.shift\(/,
    ]) {
      expect(body!).not.toMatch(forbidden);
    }
  });

  it("G5: the capture resolver refuses a negative conclusion without a provider search — the false-no-capture guard is structural", () => {
    const body = extractFunctionBody(
      functionalDomainSource,
      "resolveAuthoritativeCaptureEvidence",
    );
    expect(body).not.toBeNull();
    // The completeness gate must be evaluated BEFORE any NONE_OBSERVED return.
    const gateIndex = body!.indexOf("SEARCH_INCOMPLETE");
    const noneIndex = body!.indexOf("NONE_OBSERVED");
    expect(gateIndex).toBeGreaterThan(-1);
    expect(noneIndex).toBeGreaterThan(-1);
    expect(gateIndex).toBeLessThan(noneIndex);
    expect(body!).toMatch(/providerSearchPerformed/);
    expect(body!).toMatch(/subjectRazorpayPaymentId/);
  });

  it("G6: the capture search uses exact equality only — never like/ilike/substring matching", () => {
    for (const source of allFunctionalSources) {
      expect(source).not.toMatch(/\.like\(/);
      expect(source).not.toMatch(/\.ilike\(/);
      expect(source).not.toMatch(/\.textSearch\(/);
      expect(source).not.toMatch(/\.filter\(\s*["']/);
      expect(source).not.toMatch(/\.or\(/);
    }
    expect(functionalRepositorySource).toMatch(
      /\.eq\(\s*["']razorpay_payment_id["']\s*,\s*captureSubjectRazorpayPaymentId\s*\)/,
    );
    expect(functionalRepositorySource).toMatch(
      /\.eq\(\s*["']event_type["']\s*,\s*CAPTURE_EVENT_TYPE\s*\)/,
    );
    expect(functionalRepositorySource).toMatch(
      /\.eq\(\s*["']signature_verified["']\s*,\s*true\s*\)/,
    );
  });

  it("G7: the capture search never filters on processing_status, so authentic capture evidence is never discarded", () => {
    expect(functionalRepositorySource).not.toMatch(
      /\.eq\(\s*["']processing_status["']/,
    );
  });

  it("G8: the webhook allowlist exposes the money and provider-identity columns but NOT razorpay_order_id or any payload column", () => {
    const match = functionalRepositorySource.match(
      /const WEBHOOK_EVENT_COLUMNS =\s*\n?\s*"([^"]+)"/,
    );
    expect(match).not.toBeNull();
    const columns = match![1]!.split(",").map((c) => c.trim());
    expect(columns).toContain("amount_subunits");
    expect(columns).toContain("currency");
    expect(columns).toContain("razorpay_payment_id");
    expect(columns).not.toContain("razorpay_order_id");
    expect(columns).not.toContain("raw_payload_redacted");
    expect(columns).not.toContain("raw_body_sha256");
    expect(columns).not.toContain("normalized_event");
  });

  it("G9: the C03 fault_state parser accepts exactly two key sets and is not a generic pass-through", () => {
    expect(functionalDomainSource).toMatch(
      /function isExactC03FaultStateKeySet/,
    );
    expect(functionalDomainSource).toMatch(
      /export function parseC03MutationEvidence/,
    );
    expect(functionalDomainSource).toMatch(/["']ABSENT["']/);
    expect(functionalDomainSource).toMatch(/["']INVALID["']/);
    expect(functionalDomainSource).toMatch(/MISSING_C03_MUTATION_EVIDENCE/);
    expect(functionalDomainSource).toMatch(/INVALID_C03_MUTATION_EVIDENCE/);
    expect(functionalDomainSource).toMatch(/INCOMPLETE_C03_MUTATION_EVIDENCE/);
  });
});
