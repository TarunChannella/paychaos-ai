import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Phase 4E-R3-A — boundaries for the minimum regression API.
 *
 * These two routes are adapters, nothing more. The whole point of the R2
 * architecture is that every consequential decision lives in the service, so
 * these assertions prove structurally that neither route can reach a
 * database, a chaos service, an evaluator, a Finding, Razorpay, or the
 * network — and that a caller cannot smuggle a scenario, an invariant or a
 * target through either of them.
 */

const ROOT = process.cwd();
const START_ROUTE = join(
  ROOT,
  "app",
  "api",
  "findings",
  "[findingId]",
  "regressions",
  "route.ts",
);
const ADVANCE_ROUTE = join(
  ROOT,
  "app",
  "api",
  "regressions",
  "[regressionRunId]",
  "advance",
  "route.ts",
);

/** Source with block and line comments stripped, so prose never satisfies a check. */
function codeOf(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
}

const startSource = readFileSync(START_ROUTE, "utf8");
const advanceSource = readFileSync(ADVANCE_ROUTE, "utf8");
const startCode = codeOf(startSource);
const advanceCode = codeOf(advanceSource);
const ROUTE_CODE = `${startCode}\n${advanceCode}`;

/** Every route file under app/api, so a third new one cannot slip in. */
function listRouteFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) listRouteFiles(full, found);
    else if (entry.name === "route.ts") found.push(full.replace(ROOT, ""));
  }
  return found;
}

describe("Phase 4E-R3-A — the approved surface", () => {
  it("1: exactly the two approved regression routes exist", () => {
    expect(existsSync(START_ROUTE)).toBe(true);
    expect(existsSync(ADVANCE_ROUTE)).toBe(true);

    const regressionRoutes = listRouteFiles(join(ROOT, "app", "api"))
      .filter((path) => /regression/i.test(path))
      .map((path) => path.replace(/\\/g, "/"))
      .sort();
    expect(regressionRoutes).toEqual([
      "/app/api/findings/[findingId]/regressions/route.ts",
      "/app/api/regressions/[regressionRunId]/advance/route.ts",
    ]);
  });

  it("2: both routes import the R2 regression service", () => {
    expect(startCode).toContain("@/lib/regression/service");
    expect(advanceCode).toContain("@/lib/regression/service");
  });

  it("3: the start route delegates to startRegression", () => {
    expect(startCode).toContain("startRegression(");
    expect(startCode).not.toContain("advanceRegression(");
  });

  it("4: the advance route delegates to advanceRegression", () => {
    expect(advanceCode).toContain("advanceRegression(");
    expect(advanceCode).not.toContain("startRegression(");
  });

  it("5: only POST is exported by each route", () => {
    for (const [name, code] of [
      ["start", startCode],
      ["advance", advanceCode],
    ] as const) {
      expect(code, name).toContain("export async function POST");
      for (const verb of ["GET", "PUT", "PATCH", "DELETE"]) {
        expect(code, `${name} ${verb}`).not.toContain(
          `export async function ${verb}`,
        );
      }
    }
  });
});

describe("Phase 4E-R3-A — the routes are adapters only", () => {
  it("6: neither route reaches the database", () => {
    for (const forbidden of [
      "@/lib/supabase/server",
      "getSupabaseServerClient",
      "createClient",
      ".from(",
      "@supabase/supabase-js",
    ]) {
      expect(ROUTE_CODE, forbidden).not.toContain(forbidden);
    }
  });

  it("7: neither route creates or evaluates a chaos run itself", () => {
    for (const forbidden of [
      "createChaosRun",
      "evaluateChaosRun",
      "runChaosPrecheck",
      "@/lib/chaos/",
      "@/lib/invariants/",
    ]) {
      expect(ROUTE_CODE, forbidden).not.toContain(forbidden);
    }
  });

  it("8: neither route calls a scenario execution service", () => {
    for (const forbidden of [
      "executeC01Replay",
      "executeC03InvalidSignatureTest",
      "armC07ClientConfirmationDrop",
      "executeC11RealWebhookReplay",
      "startC11AFailureObservation",
      "reconcileC07ClientConfirmationDrop",
      "reconcileC11AFailedPaymentObservation",
    ]) {
      expect(ROUTE_CODE, forbidden).not.toContain(forbidden);
    }
  });

  it("9: neither route touches a Finding or a regression row", () => {
    for (const forbidden of [
      "@/lib/regression/repository",
      "@/lib/regression/finding-lifecycle-repository",
      "@/lib/findings/",
      "resolveFindingAfterRegression",
      "markFindingStillFailingAfterRegression",
      "insertPendingRegressionRun",
      "generateFindingsForChaosRun",
      "createFindingFromInvariantResult",
    ]) {
      expect(ROUTE_CODE, forbidden).not.toContain(forbidden);
    }
  });

  it("10: no Razorpay, webhook or payment surface is reachable", () => {
    for (const forbidden of [
      "razorpay",
      "Razorpay",
      "@/lib/webhooks/",
      "@/lib/events/",
      "@/lib/payments/",
      "@/lib/demo-merchant/",
      "verifyWebhookSignature",
      "verifyCheckoutSignature",
    ]) {
      expect(ROUTE_CODE, forbidden).not.toContain(forbidden);
    }
  });

  it("11: no outbound networking of any kind", () => {
    for (const forbidden of [
      "fetch(",
      "axios",
      "XMLHttpRequest",
      "https://",
      "http://",
      "child_process",
      "node:fs",
    ]) {
      expect(ROUTE_CODE, forbidden).not.toContain(forbidden);
    }
  });
});

describe("Phase 4E-R3-A — the caller controls nothing that matters", () => {
  it("12: the start body allowlist is exactly freshOrderId", () => {
    expect(startCode).toContain('const ALLOWED_KEYS = ["freshOrderId"]');
    // A rejected unknown key, never a silently ignored one.
    expect(startCode).toContain("ALLOWED_KEYS as readonly string[]");
  });

  it("13: no route READS a scenario or an invariant from a request", () => {
    // `scenarioId` legitimately appears as an OUTPUT field on the serialized
    // attempt, so a bare substring ban would be wrong. The property that
    // matters is that nothing is ever read out of the caller's body except
    // the one allowlisted key — asserted here by the absence of any read of
    // these names, and above by the allowlist itself.
    for (const name of [
      "scenarioId",
      "invariantId",
      "requiredInvariantIds",
      "mechanism",
      "faultType",
      "failureEvidence",
      "sourceWebhookEventId",
      "chaosRunId",
    ]) {
      for (const source of ["raw", "body", "parsed", "input", "request"]) {
        expect(ROUTE_CODE, `${source}.${name}`).not.toContain(
          `${source}.${name}`,
        );
      }
    }
    // And the only field ever taken off the body is the allowlisted one.
    const reads = [...ROUTE_CODE.matchAll(/\braw\.([A-Za-z]+)/g)].map(
      (m) => m[1],
    );
    expect([...new Set(reads)]).toEqual(["freshOrderId"]);
  });

  it("14: the advance route accepts no operational payload", () => {
    // It parses a body only to REFUSE one that carries keys.
    expect(advanceCode).toContain(
      "Object.keys(parsed as Record<string, unknown>).length > 0",
    );
    expect(advanceCode).not.toContain("freshOrderId");
  });

  it("15: neither route names a secret or an environment value", () => {
    for (const forbidden of [
      "SUPABASE_SERVICE_ROLE_KEY",
      "RAZORPAY_KEY_SECRET",
      "RAZORPAY_WEBHOOK_SECRET",
      "PAYCHAOS_ACCESS_TOKEN",
      "PAYCHAOS_SESSION_SECRET",
      "process.env",
    ]) {
      expect(ROUTE_CODE, forbidden).not.toContain(forbidden);
    }
  });
});

describe("Phase 4E-R3-A — the existing access gate is reused", () => {
  it("16: both routes use the existing session gate, not a new mechanism", () => {
    for (const [name, code] of [
      ["start", startCode],
      ["advance", advanceCode],
    ] as const) {
      expect(code, name).toContain("@/lib/access/session");
      expect(code, name).toContain("@/lib/config/access-env");
      expect(code, name).toContain("ACCESS_SESSION_COOKIE_NAME");
      expect(code, name).toContain("verifySessionToken(");
      // Fails closed when the gate is enabled but misconfigured.
      expect(code, name).toContain("getAccessGateEnv()");
    }
  });

  it("17: no new authentication mechanism is introduced", () => {
    for (const forbidden of [
      "jsonwebtoken",
      "jose",
      "next-auth",
      "apiKey",
      "api_key",
      "bearer",
      "Bearer",
      "basic auth",
    ]) {
      expect(ROUTE_CODE, forbidden).not.toContain(forbidden);
    }
  });
});

describe("Phase 4E-R3-A — nothing from a later phase", () => {
  it("18: no reliability score or readiness surface", () => {
    for (const forbidden of [
      "reliabilityScore",
      "reliability_score",
      "RELIABILITY",
      "readiness",
      "goLive",
      "GO_LIVE",
    ]) {
      expect(ROUTE_CODE, forbidden).not.toContain(forbidden);
    }
  });

  it("19: no React or UI code lives in these routes", () => {
    for (const forbidden of ["use client", "useState", "React", "jsx", "tsx"]) {
      expect(ROUTE_CODE, forbidden).not.toContain(forbidden);
    }
  });

  it("20: R3-A introduced no migration", () => {
    const migrations = readdirSync(join(ROOT, "supabase", "migrations"))
      .filter((name) => name.endsWith(".sql"))
      .sort();
    // Advanced for the Phase 5 Demo Reset fix, which legitimately adds one
    // additive migration (a narrow reset function; no table change). The
    // protection is unchanged: THIS phase still contributes no migration of
    // its own, and the earlier migrations stay exactly where they were.
    // Advanced again for the safeupdate fix, which legitimately adds one
    // additive migration (CREATE OR REPLACE of the reset function; no table
    // change), and once more for the Phase 5 controlled C01 vulnerable
    // profile (docs/DEMO_PLAN.md Section 9), which adds the one non-domain
    // configuration table. THIS phase still contributes no migration of its
    // own, and every position below is still an exact-name assertion.
    expect(migrations).toHaveLength(16);
    expect(migrations.at(-1)).toBe(
      "20260907000000_phase5_c01_controlled_vulnerable_profile.sql",
    );
    expect(migrations.at(-2)).toBe(
      "20260906000000_phase5_demo_reset_safeupdate.sql",
    );
    expect(migrations.at(-3)).toBe(
      "20260905000000_phase5_demo_reset_atomic.sql",
    );
    expect(migrations.at(-4)).toBe(
      "20260904000000_phase4e_regression_runs.sql",
    );
  });
});
