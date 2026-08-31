import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Phase 4E-R2 — source-level boundaries for the orchestration layer.
 *
 * R2 is the first Phase 4 code that EXECUTES chaos and WRITES a Finding
 * lifecycle, so what it may reach for matters more than anywhere else in the
 * diagnosis chain. These assertions prove structurally what review would
 * otherwise have to take on trust: the service composes the frozen Phase 3
 * services rather than reimplementing them, the lifecycle writer touches
 * three columns of one table, and neither can reach a Razorpay endpoint, an
 * arbitrary network target, or an LLM.
 */

const DIR = join(process.cwd(), "lib", "regression");

const SERVICE = "service.ts";
const LIFECYCLE = "finding-lifecycle-repository.ts";

function read(name: string): string {
  return readFileSync(join(DIR, name), "utf8");
}

/** Source with block and line comments stripped, so prose never satisfies a check. */
function codeOf(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
}

const serviceSource = read(SERVICE);
const lifecycleSource = read(LIFECYCLE);
const serviceCode = codeOf(serviceSource);
const lifecycleCode = codeOf(lifecycleSource);
const R2_CODE = `${serviceCode}\n${lifecycleCode}`;

describe("Phase 4E-R2 — module boundaries", () => {
  it("1: both R2 modules are server-only", () => {
    expect(serviceSource).toContain('import "server-only"');
    expect(lifecycleSource).toContain('import "server-only"');
  });

  it("2: no API route or React surface lives in lib/regression", () => {
    for (const forbidden of [
      "NextRequest",
      "NextResponse",
      "next/server",
      "use client",
      "useState",
      "React",
    ]) {
      expect(R2_CODE, forbidden).not.toContain(forbidden);
    }
  });

  it("3: no reliability score or readiness surface exists", () => {
    for (const forbidden of [
      "reliabilityScore",
      "reliability_score",
      "RELIABILITY",
      "readiness",
      "goLive",
      "GO_LIVE",
    ]) {
      expect(R2_CODE, forbidden).not.toContain(forbidden);
    }
  });
});

describe("Phase 4E-R2 — no external reach", () => {
  it("4: no AI, ML or LLM dependency of any kind", () => {
    for (const forbidden of [
      "openai",
      "OpenAI",
      "anthropic",
      "Anthropic",
      "ollama",
      "llm",
      "LLM",
      "prompt",
      "embedding",
      "confidence",
      "probability",
    ]) {
      expect(R2_CODE, forbidden).not.toContain(forbidden);
    }
  });

  it("5: no network, shell or filesystem access", () => {
    for (const forbidden of [
      "fetch(",
      "axios",
      "XMLHttpRequest",
      "child_process",
      "execSync",
      "node:fs",
      "readFileSync",
      "https://",
      "http://",
    ]) {
      expect(R2_CODE, forbidden).not.toContain(forbidden);
    }
  });

  it("6: no Razorpay SDK, endpoint or credential is reachable", () => {
    for (const forbidden of [
      "razorpay",
      "Razorpay",
      "RAZORPAY_KEY",
      "RAZORPAY_WEBHOOK_SECRET",
      "SUPABASE_SERVICE_ROLE_KEY",
    ]) {
      expect(R2_CODE, forbidden).not.toContain(forbidden);
    }
  });

  it("7: the public input carries no arbitrary target field", () => {
    // The whole point of taking a Finding ID: there is nowhere to put a URL.
    const types = codeOf(read("types.ts"));
    const inputBlock = types.slice(
      types.indexOf("export interface StartRegressionInput"),
      types.indexOf("export const REGRESSION_CONTINUATIONS"),
    );
    expect(inputBlock.length).toBeGreaterThan(0);

    // Asserted against the DECLARED FIELD NAMES, not the block's prose: the
    // interface is exactly two fields, so nothing else can be smuggled in.
    const fields = [...inputBlock.matchAll(/readonly\s+([A-Za-z]+)\??:/g)].map(
      (m) => m[1],
    );
    expect(fields.sort()).toEqual(["findingId", "freshOrderId"]);
  });
});

describe("Phase 4E-R2 — the existing Chaos Runner is reused", () => {
  it("8: run creation goes through the frozen createChaosRun", () => {
    expect(serviceCode).toContain("@/lib/chaos/run-service");
    expect(serviceCode).toContain("createChaosRun(");
  });

  it("9: evaluation goes through the frozen evaluateChaosRun", () => {
    expect(serviceCode).toContain("@/lib/invariants/service");
    expect(serviceCode).toContain("evaluateChaosRun(");
  });

  it("10: every approved scenario execution service is the existing one", () => {
    for (const [module, fn] of [
      ["@/lib/chaos/replay-service", "executeC01Replay"],
      ["@/lib/chaos/c03-execution-service", "executeC03InvalidSignatureTest"],
      ["@/lib/chaos/c07-execution-service", "armC07ClientConfirmationDrop"],
      ["@/lib/chaos/c11-execution-service", "executeC11RealWebhookReplay"],
      ["@/lib/chaos/c11-execution-service", "startC11AFailureObservation"],
    ] as const) {
      expect(serviceCode, module).toContain(module);
      expect(serviceCode, fn).toContain(fn);
    }
  });

  it("11: no second runner — no merchant processing is reimplemented", () => {
    for (const forbidden of [
      "processMerchantWebhookEvent",
      "verifyWebhookSignature",
      "verifyCheckoutSignature",
      "@/lib/events/processor",
      "@/lib/webhooks/service",
      "@/lib/razorpay/",
      "evaluateInvariant",
      "@/lib/invariants/evaluate",
      "@/lib/invariants/evaluators",
    ]) {
      expect(R2_CODE, forbidden).not.toContain(forbidden);
    }
  });

  it("12: sources are revalidated through the existing eligibility service", () => {
    expect(serviceCode).toContain("@/lib/chaos/eligibility-service");
    expect(serviceCode).toContain("revalidateEligibility(");
  });

  it("13: no local scenario-to-invariant mapping exists", () => {
    // A scenario literal beside invariant literals would be the start of a
    // second, drift-prone mapping. Scenario ids appear only as the frozen
    // creation shapes; no invariant id is named at all.
    const invariants = R2_CODE.match(/"INV-\d{3}"/g) ?? [];
    expect(invariants).toEqual([]);
    expect(R2_CODE).not.toContain("requiredInvariants");
  });
});

describe("Phase 4E-R2 — no automatic Finding generation", () => {
  it("14: neither Finding generator is reachable", () => {
    for (const forbidden of [
      "generateFindingsForChaosRun",
      "createFindingFromInvariantResult",
      "@/lib/findings/service",
      "insertOpenFinding",
    ]) {
      expect(R2_CODE, forbidden).not.toContain(forbidden);
    }
  });

  it("15: the read-only Finding repository import stays legitimate", () => {
    // Completion genuinely needs to READ the original invariant id.
    expect(serviceCode).toContain("@/lib/findings/repository");
    expect(serviceCode).toContain("findInvariantResultById");
  });
});

describe("Phase 4E-R2 — Finding lifecycle write scope", () => {
  it("16: the lifecycle repository touches only findings", () => {
    const tables = [...lifecycleCode.matchAll(/\.from\("([^"]+)"\)/g)].map(
      (m) => m[1],
    );
    expect(tables.length).toBeGreaterThan(0);
    expect(new Set(tables)).toEqual(new Set(["findings"]));
  });

  it("17: exactly one update path exists, and it is status-guarded", () => {
    expect(lifecycleCode).toContain(".update(spec.payload)");
    expect(lifecycleCode).toContain('.in("status", [...spec.from])');
    expect(lifecycleCode.match(/\.update\(/g) ?? []).toHaveLength(1);
  });

  it("18: every update payload is limited to the three lifecycle columns", () => {
    const payloads = [
      ...lifecycleCode.matchAll(/payload:\s*\{([\s\S]*?)\n    \}/g),
    ].map((m) => m[1]!);
    expect(payloads.length).toBeGreaterThan(0);
    for (const payload of payloads) {
      const keys = [...payload.matchAll(/^\s*([a-z_]+):/gm)].map((m) => m[1]);
      expect(keys.sort()).toEqual(["resolved_at", "status", "updated_at"]);
    }
  });

  it("19: no diagnosis, recommendation or identity column is ever named in a write", () => {
    for (const forbidden of [
      "diagnosis_code",
      "diagnosis_strength",
      "diagnosis_summary",
      "recommendation_code",
      "recommendation_text",
      "diagnosed_at",
      "invariant_result_id:",
      "title:",
      "created_at:",
    ]) {
      expect(lifecycleCode, forbidden).not.toContain(forbidden);
    }
  });

  it("20: there is no generic updateFinding", () => {
    expect(lifecycleCode).not.toContain("updateFinding");
    expect(lifecycleCode).not.toContain("setFindingStatus");
    for (const fn of [
      "resolveFindingAfterRegression",
      "markFindingStillFailingAfterRegression",
    ]) {
      expect(lifecycleCode, fn).toContain(`export async function ${fn}`);
    }
  });

  it("21: the service never writes a Finding directly", () => {
    expect(serviceCode).not.toContain('from("findings")');
    expect(serviceCode).toContain(
      "@/lib/regression/finding-lifecycle-repository",
    );
  });
});

describe("Phase 4E-R2 — nothing else is mutated", () => {
  it("22: regression_runs is written only through the R1 repository", () => {
    expect(serviceCode).not.toContain('from("regression_runs")');
    expect(serviceCode).toContain("@/lib/regression/repository");
  });

  it("23: no evidence table is mutated by regression code", () => {
    for (const table of [
      "invariant_results",
      "orders",
      "payment_attempts",
      "payments",
      "fulfilments",
      "webhook_events",
      "event_processing_attempts",
      "chaos_runs",
    ]) {
      expect(R2_CODE, table).not.toContain(`from("${table}")`);
    }
  });

  it("24: no DELETE, UPSERT or RPC exists anywhere in R2", () => {
    for (const forbidden of [".delete(", ".upsert(", ".rpc("]) {
      expect(R2_CODE, forbidden).not.toContain(forbidden);
    }
  });

  it("25: the orphan chaos run is never deleted", () => {
    // A safety-gated run that lost the active race stays as audit evidence.
    expect(serviceCode).toContain("ORPHAN_START");
    expect(serviceCode).not.toContain("deleteChaosRun");
  });
});

describe("Phase 4E-R2 — honest multi-step scenarios", () => {
  it("26: C07 and C11-A return a waiting state, never a completion", () => {
    expect(serviceCode).toContain("AWAITING_EXTERNAL_ACTION");
    expect(serviceCode).toContain("C07_TEST_MODE_CHECKOUT");
    expect(serviceCode).toContain("C11_A_TEST_MODE_FAILED_PAYMENT");
  });

  it("27: no reconciliation or cancellation service is driven from R2", () => {
    // Those remain the frozen operator paths; R2 arms and then waits.
    for (const forbidden of [
      "reconcileC07ClientConfirmationDrop",
      "reconcileC11AFailedPaymentObservation",
      "cancelRunningC07Fault",
      "cancelRunningC11AObservation",
      "checkAndSuppressC07ClientConfirmation",
    ]) {
      expect(R2_CODE, forbidden).not.toContain(forbidden);
    }
  });

  it("28: C11 runtime evidence is REAL_WEBHOOK_EVENT only", () => {
    expect(serviceCode).toContain("REAL_WEBHOOK_EVENT");
    expect(serviceCode).not.toContain("TEST_FIXTURE");
    expect(serviceCode).not.toContain("fixtureId");
  });

  it("29: the verdict rules are consumed, never restated", () => {
    expect(serviceCode).toContain("@/lib/regression/finalization");
    expect(serviceCode).toContain("decideRegressionOutcome(");
    // No local re-derivation of the frozen decision.
    expect(serviceCode).not.toContain("SCENARIO_CRITERIA_PASSED");
    expect(serviceCode).not.toContain("INCONCLUSIVE_UNKNOWN");
    expect(serviceCode).not.toContain("ORIGINAL_INVARIANT_NOT_PROVEN_PASS");
  });

  it("30: persisted chaos state is re-read rather than trusted from memory", () => {
    expect(serviceCode).toContain("getChaosRunById(");
    expect(serviceCode).toContain("@/lib/chaos/run-repository");
    // At least three call sites: start/advance, the multi-step re-read, and
    // completion. A single read would mean some path trusted memory.
    expect(
      (serviceCode.match(/getChaosRunById\(/g) ?? []).length,
    ).toBeGreaterThanOrEqual(3);
  });
});

describe("Phase 4E-R2 — the newest attempt owns the Finding", () => {
  it("31: the frozen R1 history reader is reused, not reimplemented", () => {
    expect(serviceCode).toContain("listRegressionRunsForFinding(");
    // No second history query anywhere in regression production code.
    expect(R2_CODE).not.toContain('from("regression_runs")');
    expect(R2_CODE).not.toContain('order("created_at"');
  });

  it("32: SUPERSEDED exists at the service level only", () => {
    expect(serviceCode).toContain("SUPERSEDED");
    expect(serviceCode).toContain("NEWER_REGRESSION_EXISTS");

    // It must never become a database status: the row keeps its own verdict.
    const types = codeOf(read("types.ts"));
    const statusUnion = types.slice(
      types.indexOf("export type RegressionRunStatus"),
      types.indexOf("export type RegressionRunStatus") + 400,
    );
    expect(statusUnion).not.toContain("SUPERSEDED");
    expect(codeOf(read("repository.ts"))).not.toContain("SUPERSEDED");
  });

  it("33: the Finding write is compare-and-set on updated_at", () => {
    expect(serviceCode).toContain("readFindingLifecycle(");
    expect(serviceCode).toContain("expectedUpdatedAt");
    expect(lifecycleCode).toContain(
      '.eq("updated_at", spec.expectedUpdatedAt)',
    );
  });

  it("34: a stale attempt never retries its lifecycle write in a loop", () => {
    // Exactly one call site each; the conflict path returns SUPERSEDED or
    // rethrows, it never loops.
    expect(
      (serviceCode.match(/resolveFindingAfterRegression\(/g) ?? []).length,
    ).toBe(1);
    expect(
      (serviceCode.match(/markFindingStillFailingAfterRegression\(/g) ?? [])
        .length,
    ).toBe(1);
    expect(serviceCode).not.toContain("while (");
    expect(serviceCode).not.toContain("for (");
  });

  it("34b: no single-step branch terminalizes on NOT_STARTABLE", () => {
    // Persisted chaos state is authoritative for EVERY scenario, so a
    // NOT_STARTABLE result must never short-circuit into an error. Only the
    // multi-step branch may inspect the returned kind at all, and even it
    // defers to the re-read row.
    expect(serviceCode).not.toContain('executed.kind === "NOT_STARTABLE"');
    expect(serviceCode).not.toContain('EXECUTION_NOT_STARTABLE",\n      );');
  });

  it("34c: a previous conclusive verdict converges before a new start", () => {
    expect(serviceCode).toContain("convergePreviousConclusive(");
    expect(serviceCode).toContain("PRIOR_CONVERGENCE_FAILED");
    // Convergence must precede creation in the source order of startRegression.
    const start = serviceCode.indexOf("export async function startRegression");
    const converge = serviceCode.indexOf("convergePreviousConclusive(", start);
    const create = serviceCode.indexOf("createChaosRun(planned.plan.create)");
    expect(converge).toBeGreaterThan(start);
    expect(converge).toBeLessThan(create);
  });

  it("34d: only a CONCLUSIVE attempt can supersede another", () => {
    // An ERROR attempt carries NO_CHANGE semantics and must never suppress an
    // earlier RESOLVED/STILL_FAILING verdict.
    expect(serviceCode).toContain("isNewestConclusiveAttempt(");
    expect(serviceCode).toContain("function isConclusive(");
    expect(serviceCode).toContain(
      'status === "RESOLVED" || status === "STILL_FAILING"',
    );
    expect(serviceCode).not.toContain("isLatestAttempt(");
  });

  it("35: a fresh order can never be the historical one", () => {
    expect(serviceCode).toContain("FRESH_ORDER_REUSE_FORBIDDEN");
    expect(serviceCode).toContain("freshOrderId === originalRun.order_id");
    // Both provider-dependent scenarios carry the check.
    expect(
      (serviceCode.match(/FRESH_ORDER_REUSE_FORBIDDEN/g) ?? []).length,
    ).toBeGreaterThanOrEqual(2);
  });
});
