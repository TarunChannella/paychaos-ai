import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Phase 4E-R1 — source-level guards over `lib/regression/`.
 *
 * Regression is the first Phase 4 capability that will EXECUTE something and
 * WRITE a lifecycle, so the boundaries matter more here than anywhere else in
 * the diagnosis chain. These assertions prove structurally what a reviewer
 * would otherwise have to take on trust: this directory writes exactly one
 * table, reads everything else, and cannot reach a payment, a Razorpay
 * endpoint, an invariant result, a Finding, or an LLM.
 */

const DIR = join(process.cwd(), "lib", "regression");

const files = readdirSync(DIR)
  .filter((name) => name.endsWith(".ts"))
  .sort();

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

const sources = new Map(files.map((name) => [name, read(name)]));
const codes = new Map(files.map((name) => [name, codeOf(read(name))]));

const ALL_CODE = [...codes.values()].join("\n");

describe("Phase 4E-R1 — directory contents", () => {
  it("1: exactly the four approved R1 modules exist", () => {
    expect(files).toEqual([
      "eligibility.ts",
      "finalization.ts",
      "repository.ts",
      "types.ts",
    ]);
  });

  it("2: no orchestration service exists yet — that is R2's", () => {
    expect(files).not.toContain("service.ts");
    for (const name of files) {
      expect(codes.get(name), name).not.toContain("startRegression");
      expect(codes.get(name), name).not.toContain("executeRegression");
    }
  });
});

describe("Phase 4E-R1 — module boundaries", () => {
  it("3: the two persistence-touching modules are server-only", () => {
    for (const name of ["repository.ts", "eligibility.ts"]) {
      expect(sources.get(name), name).toContain('import "server-only"');
    }
  });

  it("4: types and finalization are pure — no server-only, no runtime import", () => {
    for (const name of ["types.ts", "finalization.ts"]) {
      const code = codes.get(name)!;
      expect(code, name).not.toContain('import "server-only"');
      // Every non-type import in a pure module would be a runtime dependency.
      const imports = code.match(/^import .*$/gm) ?? [];
      for (const line of imports) {
        expect(line.startsWith("import type "), `${name}: ${line}`).toBe(true);
      }
    }
  });

  it("5: finalization reaches for no clock, randomness or environment", () => {
    const code = codes.get("finalization.ts")!;
    for (const forbidden of [
      "Date.now",
      "new Date",
      "Math.random",
      "process.env",
      "crypto",
      "toISOString",
    ]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });

  it("6: finalization consults no registry, repository or classifier", () => {
    const code = codes.get("finalization.ts")!;
    for (const forbidden of [
      "@/lib/chaos/registry",
      "@/lib/regression/repository",
      "@/lib/findings/repository",
      "@/lib/diagnosis/",
      "getScenarioDefinition",
    ]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });
});

describe("Phase 4E-R1 — write scope", () => {
  it("7: the repository is the only module that writes anything", () => {
    for (const name of ["types.ts", "finalization.ts", "eligibility.ts"]) {
      const code = codes.get(name)!;
      for (const forbidden of [
        ".insert(",
        ".update(",
        ".upsert(",
        ".delete(",
      ]) {
        expect(code, `${name} ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("8: every table the repository names is regression_runs", () => {
    const code = codes.get("repository.ts")!;
    const tables = [...code.matchAll(/\.from\("([^"]+)"\)/g)].map((m) => m[1]);
    expect(tables.length).toBeGreaterThan(0);
    expect(new Set(tables)).toEqual(new Set(["regression_runs"]));
  });

  it("9: eligibility only ever reads, and only chaos_runs directly", () => {
    const code = codes.get("eligibility.ts")!;
    const tables = [...code.matchAll(/\.from\("([^"]+)"\)/g)].map((m) => m[1]);
    expect(new Set(tables)).toEqual(new Set(["chaos_runs"]));
    expect(code).toContain(".select(");
  });

  it("10: no module deletes, upserts or calls an RPC", () => {
    for (const forbidden of [".delete(", ".upsert(", ".rpc("]) {
      expect(ALL_CODE, forbidden).not.toContain(forbidden);
    }
  });

  it("11: there is no generic status setter", () => {
    const code = codes.get("repository.ts")!;
    expect(code).not.toContain("setRegressionStatus");
    // Each transition is its own guarded function.
    for (const fn of [
      "startPendingRegressionRun",
      "finalizeRegressionResolved",
      "finalizeRegressionStillFailing",
      "finalizeRegressionError",
    ]) {
      expect(code, fn).toContain(`export async function ${fn}`);
    }
  });

  it("12: every write is guarded by an expected current status", () => {
    const code = codes.get("repository.ts")!;
    // The single update path filters on status before writing.
    expect(code).toContain(".update(spec.payload)");
    expect(code).toContain('.in("status", [...spec.from])');
    const updates = code.match(/\.update\(/g) ?? [];
    expect(updates).toHaveLength(1);
  });
});

describe("Phase 4E-R1 — nothing else may be mutated", () => {
  it("13: no Finding is ever written", () => {
    for (const forbidden of [
      'from("findings")',
      "insertOpenFinding",
      "resolveFinding",
      "updateFinding",
      "resolved_at",
      "STILL_FAILING'",
    ]) {
      expect(ALL_CODE, forbidden).not.toContain(forbidden);
    }
  });

  it("14: no automatic Finding generation is reachable (decision D-4)", () => {
    for (const forbidden of [
      "generateFindingsForChaosRun",
      "createFindingFromInvariantResult",
      "@/lib/findings/service",
    ]) {
      expect(ALL_CODE, forbidden).not.toContain(forbidden);
    }
  });

  it("15: read-only Finding repository imports remain legitimate", () => {
    // The eligibility trace genuinely needs to READ a finding. Banning the
    // repository outright would be wrong; banning the writers is the point.
    expect(codes.get("eligibility.ts")).toContain("@/lib/findings/repository");
    expect(codes.get("eligibility.ts")).toContain("findFindingById");
  });

  it("16: no invariant result, payment, order or fulfilment is mutated", () => {
    for (const table of [
      "invariant_results",
      "orders",
      "payment_attempts",
      "payments",
      "fulfilments",
      "webhook_events",
      "event_processing_attempts",
    ]) {
      expect(ALL_CODE, table).not.toContain(`from("${table}")`);
    }
  });

  it("17: no chaos run is created or executed in R1", () => {
    for (const forbidden of [
      "createChaosRun",
      "executeC01Replay",
      "executeC03InvalidSignatureTest",
      "armC07ClientConfirmationDrop",
      "executeC11RealWebhookReplay",
      "evaluateChaosRun",
      "runChaosPrecheck",
    ]) {
      expect(ALL_CODE, forbidden).not.toContain(forbidden);
    }
  });
});

describe("Phase 4E-R1 — external surface", () => {
  it("18: no Razorpay SDK, endpoint or credential is reachable", () => {
    for (const forbidden of [
      "razorpay",
      "Razorpay",
      "RAZORPAY_KEY",
      "RAZORPAY_WEBHOOK_SECRET",
    ]) {
      expect(ALL_CODE, forbidden).not.toContain(forbidden);
    }
  });

  it("19: no network, shell or filesystem access", () => {
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
      expect(ALL_CODE, forbidden).not.toContain(forbidden);
    }
  });

  it("20: no AI, ML or LLM dependency of any kind", () => {
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
      expect(ALL_CODE, forbidden).not.toContain(forbidden);
    }
  });

  it("21: no reliability score or readiness surface exists yet", () => {
    for (const forbidden of [
      "reliabilityScore",
      "reliability_score",
      "RELIABILITY",
      "readiness",
      "goLive",
      "GO_LIVE",
    ]) {
      expect(ALL_CODE, forbidden).not.toContain(forbidden);
    }
  });

  it("22: no route handler or React surface lives here", () => {
    for (const forbidden of [
      "NextRequest",
      "NextResponse",
      "next/server",
      "use client",
      "React",
      "tsx",
    ]) {
      expect(ALL_CODE, forbidden).not.toContain(forbidden);
    }
  });
});

describe("Phase 4E-R1 — the authoritative scenario mapping", () => {
  it("23: the registry is consumed, never copied", () => {
    expect(codes.get("eligibility.ts")).toContain("getScenarioDefinition");
    expect(codes.get("eligibility.ts")).toContain("@/lib/chaos/registry");
  });

  it("24: no module declares a scenario-to-invariant array of its own", () => {
    // A literal scenario id paired with invariant ids in the same file would
    // be the start of a second, drift-prone mapping.
    for (const [name, code] of codes) {
      const scenarios = code.match(/"C0[1379]"|"C11"/g) ?? [];
      expect(scenarios, `${name} names a scenario literally`).toEqual([]);
    }
  });

  it("25: no invariant id literal is hardcoded in production source", () => {
    for (const [name, code] of codes) {
      const invariants = code.match(/"INV-\d{3}"/g) ?? [];
      expect(invariants, `${name} names an invariant literally`).toEqual([]);
    }
  });
});

describe("Phase 4E-R1 — safe errors", () => {
  it("26: raw database fields are never interpolated into a message", () => {
    const code = codes.get("repository.ts")!;
    for (const forbidden of [
      "error.message}",
      "error.details}",
      "error.hint}",
      "String(error)",
      "JSON.stringify(error)",
    ]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });

  it("27: the active-run conflict is recognised by index name, not by message text alone", () => {
    const code = codes.get("repository.ts")!;
    expect(code).toContain("regression_runs_active_finding_uniq");
    expect(code).toContain('UNIQUE_VIOLATION = "23505"');
  });
});
