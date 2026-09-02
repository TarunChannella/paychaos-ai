import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Phase 4G — structural boundaries for the Go-Live Readiness layer.
 *
 * Readiness is the most quotable output this project produces, so the
 * properties that keep it honest have to be properties of the SOURCE, not of
 * the author's intent: the evaluator is pure, the repository is SELECT-only,
 * nothing is persisted, no gate is fabricated, and no screen can restate the
 * verdict as a certification.
 *
 * Every check runs against comment-stripped source, so documentation naming a
 * banned construct — in order to say it is absent — can never satisfy a check
 * by accident.
 */

const ROOT = process.cwd();
const DIR = join(ROOT, "lib", "readiness");
const TYPES = join(DIR, "types.ts");
const ENGINE = join(DIR, "readiness.ts");
const REPOSITORY = join(DIR, "repository.ts");
const SERVICE = join(DIR, "service.ts");
const ROUTE = join(ROOT, "app", "api", "readiness", "route.ts");
const COMPONENT = join(
  ROOT,
  "components",
  "reliability",
  "readiness-overview.tsx",
);
const PAGE = join(ROOT, "app", "reliability", "page.tsx");

function codeOf(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
}

function read(path: string): string {
  return codeOf(readFileSync(path, "utf8"));
}

const typesCode = read(TYPES);
const engineCode = read(ENGINE);
const repositoryCode = read(REPOSITORY);
const serviceCode = read(SERVICE);
const routeCode = read(ROUTE);
const componentCode = read(COMPONENT);
const pageCode = read(PAGE);

const LIB_CODE = `${typesCode}\n${engineCode}\n${repositoryCode}\n${serviceCode}`;
const ALL_CODE = `${LIB_CODE}\n${routeCode}\n${componentCode}\n${pageCode}`;

describe("Phase 4G — the evaluator is pure", () => {
  it("1: every 4G module exists", () => {
    for (const path of [
      TYPES,
      ENGINE,
      REPOSITORY,
      SERVICE,
      ROUTE,
      COMPONENT,
      PAGE,
    ]) {
      expect(existsSync(path), path).toBe(true);
    }
  });

  it("2: the engine and the types have no I/O and no server-only import", () => {
    // Purity is what makes the readiness decision testable and reproducible.
    for (const [name, code] of [
      ["types", typesCode],
      ["readiness", engineCode],
    ] as const) {
      for (const forbidden of [
        'import "server-only"',
        "@/lib/supabase/server",
        "getSupabaseServerClient",
        ".from(",
        "fetch(",
        "process.env",
        "Date.now(",
        "new Date(",
        "Math.random(",
        "randomUUID",
        "node:fs",
        "await ",
      ]) {
        expect(code, `${name}: ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("2b: any Supabase reference in the pure modules is TYPE-ONLY", () => {
    // A `import type` of a row type is erased at compile time and carries no
    // client, no credential and no I/O. A VALUE import would not be, so the
    // distinction is what is actually checked.
    for (const [name, code] of [
      ["types", typesCode],
      ["readiness", engineCode],
    ] as const) {
      for (const line of code.split(String.fromCharCode(10))) {
        if (!line.includes("@/lib/supabase")) continue;
        expect(line.trimStart(), name).toMatch(/^import type /);
      }
    }
  });

  it("3: the engine imports only its own types", () => {
    const imports = [...engineCode.matchAll(/from "([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(imports.every((path) => path === "./types")).toBe(true);
  });

  it("4: the engine exports exactly one decision function", () => {
    const exported = [
      ...engineCode.matchAll(/export (?:async )?function (\w+)/g),
    ].map((m) => m[1]);
    expect(exported).toEqual(["evaluateGoLiveReadinessV1"]);
    expect(engineCode).not.toContain("export async function");
  });

  it("5: the frozen status set and precedence exist as constants", () => {
    for (const required of [
      "GO-LIVE-READINESS-V1",
      '"NOT READY"',
      '"NEEDS ATTENTION"',
      '"READY"',
      "READINESS_GATE_STATES",
      "READINESS_GATE_IDS",
      "READINESS_BLOCKING_REASONS",
      "READINESS_ATTENTION_REASONS",
    ]) {
      expect(typesCode, required).toContain(required);
    }
  });

  it("6: every frozen reason code is defined exactly once", () => {
    for (const code of [
      "NR_TEST_MODE_SECURITY_FAILED",
      "NR_HEALTHY_BASELINE_FAILED",
      "NR_MANDATORY_SCENARIO_FAILED",
      "NR_UNRESOLVED_HIGH_RISK_FINDING",
      "NA_SCORE_BELOW_100",
      "NA_MANDATORY_SCENARIO_INCONCLUSIVE",
      "NA_UNRESOLVED_LOWER_RISK_FINDING",
      "NA_REQUIRED_VERIFICATION_INCOMPLETE",
    ]) {
      expect(typesCode, code).toContain(code);
      expect(engineCode, code).toContain(code);
    }
  });

  it("7: the readiness decision is never delegated to a model", () => {
    for (const forbidden of [
      "openai",
      "anthropic",
      "ollama",
      "LLM",
      "prompt",
      "completion",
      "embedding",
      "probability",
      "predict",
      "Math.random",
    ]) {
      expect(ALL_CODE, forbidden).not.toContain(forbidden);
    }
  });
});

describe("Phase 4G — the repository is SELECT-only", () => {
  it("8: the repository and service are server-only", () => {
    expect(repositoryCode).toContain('import "server-only"');
    expect(serviceCode).toContain('import "server-only"');
  });

  it("9: no mutating verb appears anywhere in the 4G layer", () => {
    for (const forbidden of [
      ".insert(",
      ".update(",
      ".upsert(",
      ".delete(",
      ".rpc(",
    ]) {
      expect(ALL_CODE, forbidden).not.toContain(forbidden);
    }
  });

  it("10: exactly two tables are read, and no other", () => {
    const tables = [...repositoryCode.matchAll(/\.from\("(\w+)"\)/g)].map(
      (m) => m[1],
    );
    expect([...new Set(tables)].sort()).toEqual([
      "findings",
      "invariant_results",
    ]);
    // Nothing outside the repository reaches a table at all.
    for (const code of [engineCode, serviceCode, routeCode, componentCode]) {
      expect(code).not.toContain(".from(");
    }
  });

  it("11: regression_runs never decides how serious a Finding is", () => {
    for (const forbidden of [
      '"regression_runs"',
      "@/lib/regression",
      "diagnosis_strength",
      "diagnosis_code",
      "recommendation_code",
    ]) {
      expect(ALL_CODE, forbidden).not.toContain(forbidden);
    }
  });

  it("12: a read failure is a typed error, never an empty result", () => {
    expect(repositoryCode).toContain("ReadinessRepositoryError");
    expect(repositoryCode).toContain("FINDING_READ_FAILED");
    expect(repositoryCode).toContain("INVARIANT_RESULT_READ_FAILED");
    // Three throw sites: findings, severities, selected-run evidence.
    expect(
      (repositoryCode.match(/throw new ReadinessRepositoryError/g) ?? [])
        .length,
    ).toBe(3);
  });

  it("13: no raw database diagnostic is ever forwarded", () => {
    for (const forbidden of [
      "error.message",
      "error.details",
      "error.hint",
      "JSON.stringify(error",
      "console.log",
      "console.error",
    ]) {
      expect(ALL_CODE, forbidden).not.toContain(forbidden);
    }
  });

  it("14: the service does not swallow a repository failure", () => {
    // A caught read error silently becoming "no unresolved findings" is how a
    // false READY would be born, so the service holds no try/catch around the
    // loaders at all.
    const entry = serviceCode.slice(
      serviceCode.indexOf("export async function getCurrentGoLiveReadiness"),
    );
    expect(entry).not.toContain("catch");
    expect(entry).toContain("loadUnresolvedFindings()");
    expect(entry).toContain("loadSelectedRunInvariantEvidence(");
  });
});

describe("Phase 4G — no second score engine, no fabricated gate", () => {
  it("15: the service reuses the frozen 4F read model", () => {
    expect(serviceCode).toContain("getCurrentReliabilityScore");
    expect(serviceCode).toContain("@/lib/reliability/service");
  });

  it("16: no deduction table, selection rule or score arithmetic is duplicated", () => {
    for (const forbidden of [
      "calculateReliabilityScoreV1",
      "RELIABILITY_FAIL_DEDUCTION",
      "RELIABILITY_STATE_DEDUCTION",
      "CRITICAL: 25",
      "HIGH: 20",
      "MEDIUM: 15",
      "LOW: 10",
      "100 -",
      "Math.max(0,",
      "createdAt DESC",
      "LATEST_SELECTION",
      "loadReliabilityCandidateRuns",
      "loadReliabilityInvariantResults",
    ]) {
      expect(`${serviceCode}\n${engineCode}`, forbidden).not.toContain(
        forbidden,
      );
    }
  });

  it("17: the 4F read model is returned by reference, never rebuilt", () => {
    expect(serviceCode).toContain("return { readiness, reliability }");
    for (const forbidden of [
      "reliability.score.score =",
      "scenarioBreakdown =",
      "Object.assign(reliability",
      "structuredClone(reliability",
    ]) {
      expect(serviceCode, forbidden).not.toContain(forbidden);
    }
  });

  it("18: an unestablished gate is UNKNOWN — never hard-coded PASS", () => {
    // The gates with no runtime authority must literally return UNKNOWN.
    expect(serviceCode).toContain('return "UNKNOWN"');
    for (const forbidden of [
      'buildGate: "PASS"',
      'securityVerificationGate: "PASS"',
      'automatedTestGate: "PASS"',
      'manualVerificationGate: "PASS"',
      'healthyBaselineGate: "PASS"',
      'realRazorpayManualVerificationGate: "PASS"',
    ]) {
      expect(serviceCode, forbidden).not.toContain(forbidden);
    }
  });

  it("19: the status is never hard-coded anywhere outside the evaluator", () => {
    for (const code of [serviceCode, repositoryCode, routeCode, pageCode]) {
      for (const forbidden of [
        'status: "READY"',
        'status = "READY"',
        'return "READY"',
      ]) {
        expect(code, forbidden).not.toContain(forbidden);
      }
    }
  });

  it("20: no Razorpay secret or environment value can be read out", () => {
    for (const forbidden of [
      "keySecret",
      "keyId",
      "webhookSecret",
      "RAZORPAY_KEY_SECRET",
      "RAZORPAY_WEBHOOK_SECRET",
      "SUPABASE_SERVICE_ROLE_KEY",
      "PAYCHAOS_ACCESS_TOKEN",
      "PAYCHAOS_SESSION_SECRET",
      "NEXT_PUBLIC_",
      "raw_body",
      "signature",
      "fault_config",
      "fault_state",
    ]) {
      expect(ALL_CODE, forbidden).not.toContain(forbidden);
    }
  });
});

describe("Phase 4G — nothing is persisted", () => {
  it("21: no readiness storage of any kind exists", () => {
    for (const forbidden of [
      "readiness_scores",
      "readiness_snapshots",
      "go_live_status",
      "go_live_readiness",
      "persistReadiness",
      "saveReadiness",
      "storeReadiness",
      "recordReadiness",
    ]) {
      expect(ALL_CODE, forbidden).not.toContain(forbidden);
    }
  });

  it("22: 4G introduces no migration", () => {
    const migrations = readdirSync(join(ROOT, "supabase", "migrations"))
      .filter((name) => name.endsWith(".sql"))
      .sort();
    // Advanced for the Phase 5 Demo Reset fix, which legitimately adds one
    // additive migration (a narrow reset function; no table change). The
    // protection is unchanged: THIS phase still contributes no migration of
    // its own, and the earlier migrations stay exactly where they were.
    // Advanced again for the safeupdate fix, which legitimately adds one
    // additive migration (CREATE OR REPLACE of the reset function; no table
    // change). THIS phase still contributes no migration of its own.
    expect(migrations).toHaveLength(15);
    expect(migrations.at(-1)).toBe(
      "20260906000000_phase5_demo_reset_safeupdate.sql",
    );
    expect(migrations.at(-2)).toBe(
      "20260905000000_phase5_demo_reset_atomic.sql",
    );
    expect(migrations.at(-3)).toBe(
      "20260904000000_phase4e_regression_runs.sql",
    );
    for (const name of migrations) {
      expect(name, name).not.toContain("readiness");
    }
  });

  it("23: no chaos, payment, webhook or Finding mutation is reachable", () => {
    for (const forbidden of [
      "createChaosRun",
      "evaluateChaosRun",
      "evaluateInvariant",
      "persistInvariantResult",
      "resolveFindingAfterRegression",
      "markFindingStillFailingAfterRegression",
      "insertPendingRegressionRun",
      "generateFindingsForChaosRun",
      "processMerchantWebhookEvent",
      "@/lib/chaos/",
      "@/lib/invariants/",
      "@/lib/webhooks/",
      "@/lib/payments/",
    ]) {
      expect(ALL_CODE, forbidden).not.toContain(forbidden);
    }
  });
});

describe("Phase 4G — the read surface is GET-only and honest", () => {
  it("24: the route exports GET and nothing that mutates", () => {
    expect(routeCode).toContain("export async function GET");
    for (const method of [
      "export async function POST",
      "export async function PUT",
      "export async function PATCH",
      "export async function DELETE",
    ]) {
      expect(routeCode, method).not.toContain(method);
    }
    expect(routeCode).toContain('export const dynamic = "force-dynamic"');
    expect(routeCode).toContain('export const runtime = "nodejs"');
  });

  it("25: the route enforces the existing access gate before the service", () => {
    expect(routeCode).toContain("getAccessGateEnv");
    expect(routeCode).toContain("verifySessionToken");
    expect(routeCode).toContain("ACCESS_SESSION_COOKIE_NAME");
    const gateIndex = routeCode.indexOf("getAccessGateEnv()");
    const serviceIndex = routeCode.indexOf("getCurrentGoLiveReadiness()");
    expect(gateIndex).toBeGreaterThan(-1);
    expect(serviceIndex).toBeGreaterThan(gateIndex);
  });

  it("26: the route contains no readiness rule of its own", () => {
    for (const forbidden of [
      "NR_",
      "NA_",
      "blockingReasons.push",
      "attentionReasons.push",
      "evaluateGoLiveReadinessV1",
      "gates.map",
    ]) {
      expect(routeCode, forbidden).not.toContain(forbidden);
    }
  });

  it("27: the component is presentation-only", () => {
    for (const forbidden of [
      '"use client"',
      "useState",
      "useEffect",
      "fetch(",
      "evaluateGoLiveReadinessV1",
      "@/lib/readiness/service",
      "@/lib/readiness/repository",
      "NR_TEST_MODE_SECURITY_FAILED",
      "blockingReasons.push",
    ]) {
      expect(componentCode, forbidden).not.toContain(forbidden);
    }
    // It takes an already-evaluated model and renders it.
    expect(componentCode).toContain("GoLiveReadinessV1");
  });

  it("28: the disclaimer comes from the frozen constant, not from a screen", () => {
    expect(typesCode).toContain("READINESS_DISCLAIMER");
    expect(typesCode).toContain("It is not Razorpay certification.");
    // The component renders the model's own disclaimer field rather than
    // restating it, so no screen can soften the wording.
    expect(componentCode).toContain("readiness.disclaimer");
    expect(componentCode).not.toContain("READINESS_DISCLAIMER =");
  });

  it("29: no surface claims certification, approval or guaranteed safety", () => {
    const prose = ALL_CODE.toLowerCase();
    for (const claim of [
      "certified",
      "we certify",
      "approved for production",
      "guaranteed safe",
      "razorpay approved",
      "razorpay certified",
      "production approved",
    ]) {
      expect(prose, claim).not.toContain(claim);
    }
  });

  it("30: the page renders both panels from a single service call", () => {
    expect(pageCode).toContain("getCurrentGoLiveReadiness()");
    expect(pageCode).toContain("<ReadinessOverview");
    expect(pageCode).toContain("<ReliabilityOverview");
    // One read, not two: the reliability panel reuses the same snapshot.
    expect(pageCode).not.toContain("getCurrentReliabilityScore");
    expect(
      (pageCode.match(/getCurrentGoLiveReadiness\(\)/g) ?? []).length,
    ).toBe(1);
  });

  it("31: no readiness verdict is fabricated in the page's failure branch", () => {
    for (const forbidden of ["READY", "NEEDS ATTENTION", "NOT READY"]) {
      expect(pageCode, forbidden).not.toContain(forbidden);
    }
  });
});
