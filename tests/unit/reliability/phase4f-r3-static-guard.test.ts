import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Phase 4F-R3 — boundaries for the reliability read API and UI.
 *
 * Both surfaces are adapters over the same trusted service. These assertions
 * prove structurally that neither can reach a database, duplicate the score
 * arithmetic, write anything, or grow Phase 4G readiness logic — and that the
 * UI cannot quietly start describing a controlled simulation as genuine
 * Razorpay evidence.
 *
 * Source is comment-stripped, so documentation naming a banned thing in order
 * to say it is absent can never satisfy a check by accident.
 */

const ROOT = process.cwd();
const ROUTE = join(ROOT, "app", "api", "reliability", "route.ts");
const PAGE = join(ROOT, "app", "reliability", "page.tsx");
const COMPONENT = join(
  ROOT,
  "components",
  "reliability",
  "reliability-overview.tsx",
);

function codeOf(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
}

const routeSource = readFileSync(ROUTE, "utf8");
const pageSource = readFileSync(PAGE, "utf8");
const componentSource = readFileSync(COMPONENT, "utf8");
const routeCode = codeOf(routeSource);
const pageCode = codeOf(pageSource);
const componentCode = codeOf(componentSource);
const R3_CODE = `${routeCode}\n${pageCode}\n${componentCode}`;

describe("Phase 4F-R3 — the approved surface", () => {
  it("1: the route, the page and the presentation component exist", () => {
    expect(existsSync(ROUTE)).toBe(true);
    expect(existsSync(PAGE)).toBe(true);
    expect(existsSync(COMPONENT)).toBe(true);
  });

  it("2: exactly one reliability API route exists", () => {
    expect(readdirSync(join(ROOT, "app", "api", "reliability"))).toEqual([
      "route.ts",
    ]);
  });

  it("3: the reliability component directory holds only approved files", () => {
    // ADVANCED, NOT LOOSENED (Phase 4G). The readiness panel legitimately
    // lives beside the score panel and is listed by exact name, so an
    // unapproved third component still fails here.
    // Advanced again in the Phase 5 UI pass: the readiness decision panel and
    // the scenario matrix are legitimate additions. The list stays EXACT, so
    // an unapproved fifth component still fails here.
    expect(readdirSync(join(ROOT, "components", "reliability")).sort()).toEqual(
      [
        "readiness-decision.tsx",
        "readiness-overview.tsx",
        "reliability-overview.tsx",
        "scenario-matrix.tsx",
      ],
    );
  });

  it("4: R3 introduces no migration", () => {
    const migrations = readdirSync(join(ROOT, "supabase", "migrations"))
      .filter((name) => name.endsWith(".sql"))
      .sort();
    // Advanced for the Phase 5 Demo Reset fix, which legitimately adds one
    // additive migration (a narrow reset function; no table change). The
    // protection is unchanged: THIS phase still contributes no migration of
    // its own, and the earlier migrations stay exactly where they were.
    expect(migrations).toHaveLength(14);
    expect(migrations.at(-1)).toBe(
      "20260905000000_phase5_demo_reset_atomic.sql",
    );
    expect(migrations.at(-2)).toBe(
      "20260904000000_phase4e_regression_runs.sql",
    );
  });
});

describe("Phase 4F-R3 — the route is an adapter only", () => {
  it("5: GET is the only exported method", () => {
    expect(routeCode).toContain("export async function GET");
    for (const verb of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(routeCode, verb).not.toContain(`export async function ${verb}`);
    }
  });

  it("6: it delegates to the trusted service", () => {
    expect(routeCode).toContain("@/lib/reliability/service");
    expect(routeCode).toContain("getCurrentReliabilityScore()");
  });

  it("7: it reaches no database directly", () => {
    for (const forbidden of [
      "@/lib/supabase/server",
      "getSupabaseServerClient",
      "createClient",
      "@supabase/supabase-js",
      ".from(",
      ".select(",
      ".insert(",
      ".update(",
      ".upsert(",
      ".delete(",
      ".rpc(",
    ]) {
      expect(routeCode, forbidden).not.toContain(forbidden);
    }
  });

  it("8: it reuses the existing access gate, and adds no new mechanism", () => {
    expect(routeCode).toContain("@/lib/access/session");
    expect(routeCode).toContain("@/lib/config/access-env");
    expect(routeCode).toContain("ACCESS_SESSION_COOKIE_NAME");
    expect(routeCode).toContain("verifySessionToken(");
    expect(routeCode).toContain("getAccessGateEnv()");
    for (const forbidden of [
      "jsonwebtoken",
      "jose",
      "next-auth",
      "apiKey",
      "api_key",
      "Bearer",
    ]) {
      expect(routeCode, forbidden).not.toContain(forbidden);
    }
  });

  it("9: a read failure is reported as a failure, never as a score", () => {
    expect(routeCode).toContain("ReliabilityRepositoryError");
    expect(routeCode).toContain("503");
    // No fabricated score-shaped fallback anywhere in the route.
    for (const forbidden of [
      "NOT_RUN",
      "totalDeduction:",
      "score: 0",
      "score: 40",
      "scenarioBreakdown:",
    ]) {
      expect(routeCode, forbidden).not.toContain(forbidden);
    }
  });

  it("10: no secret or environment value is named", () => {
    for (const forbidden of [
      "SUPABASE_SERVICE_ROLE_KEY",
      "RAZORPAY_KEY_SECRET",
      "RAZORPAY_WEBHOOK_SECRET",
      "PAYCHAOS_ACCESS_TOKEN",
      "PAYCHAOS_SESSION_SECRET",
      "process.env",
    ]) {
      expect(R3_CODE, forbidden).not.toContain(forbidden);
    }
  });
});

describe("Phase 4F-R3 — the page is server-rendered from the trusted service", () => {
  it("11: it calls a trusted service directly and is dynamic", () => {
    // ADVANCED, NOT LOOSENED (Phase 4G). The page now makes ONE call, to the
    // readiness service, which composes and returns the frozen 4F reliability
    // read model alongside the assessment. The property this guard protects
    // is unchanged: the page reaches a trusted server service directly rather
    // than fetching its own HTTP API, and it is never cached.
    expect(pageCode).toContain("getCurrentGoLiveReadiness");
    expect(pageCode).toContain('export const dynamic = "force-dynamic"');
    // It must not fetch its own HTTP API, which would add a needless hop.
    expect(pageCode).not.toContain("fetch(");
    expect(pageCode).not.toContain("/api/reliability");
    expect(pageCode).not.toContain("/api/readiness");
  });

  it("12: it is a server component — no client directive, no client state", () => {
    expect(pageCode).not.toContain('"use client"');
    expect(componentCode).not.toContain('"use client"');
    for (const forbidden of ["useState", "useEffect", "onClick="]) {
      expect(`${pageCode}\n${componentCode}`, forbidden).not.toContain(
        forbidden,
      );
    }
  });

  it("13: neither page nor component reaches a database or the network", () => {
    for (const forbidden of [
      "@/lib/supabase/server",
      "getSupabaseServerClient",
      "@supabase/supabase-js",
      ".from(",
      "fetch(",
      "axios",
      "https://",
      "http://",
    ]) {
      expect(`${pageCode}\n${componentCode}`, forbidden).not.toContain(
        forbidden,
      );
    }
  });

  it("14: a read failure renders an honest gap, not a fabricated score", () => {
    expect(pageCode).toContain("Reliability data unavailable.");
    // The page must not invent any number of its own.
    for (const forbidden of ["score = 0", "score: 0", "= 40", "NOT_RUN"]) {
      expect(pageCode, forbidden).not.toContain(forbidden);
    }
  });
});

describe("Phase 4F-R3 — no arithmetic is duplicated in the presentation", () => {
  it("15: no deduction table, matrix, ordering or clamp in route/page/component", () => {
    for (const forbidden of [
      "CRITICAL: 25",
      "HIGH: 20",
      "MEDIUM: 15",
      "LOW: 10",
      "NOT_RUN: 15",
      "Math.max(0,",
      "100 -",
      "createdAt DESC",
      "RECORDED_TEST_EVIDENCE:",
      "SYNTHETIC_DEMO:",
      "calculateReliabilityScoreV1",
      "composeReliabilityScoreReadModel",
    ]) {
      expect(R3_CODE, forbidden).not.toContain(forbidden);
    }
  });

  it("16: no Finding, regression, chaos, Razorpay or AI dependency", () => {
    // The bare word "Razorpay" is NOT banned: the page carries the same
    // honest "Razorpay Test Mode" badge every other operator surface shows,
    // and removing it would make the UI less truthful, not more. What must be
    // absent is any Razorpay CLIENT or API dependency.
    for (const forbidden of [
      "@/lib/findings",
      "@/lib/regression",
      "@/lib/diagnosis",
      "@/lib/recommendations",
      "@/lib/chaos/",
      "@/lib/invariants/",
      "@/lib/razorpay",
      "razorpay(",
      "new Razorpay",
      "RAZORPAY_KEY",
      "api.razorpay.com",
      "openai",
      "anthropic",
      "ollama",
      "confidence",
      "probability",
    ]) {
      expect(R3_CODE, forbidden).not.toContain(forbidden);
    }
    // ADVANCED, NOT LOOSENED (Phase 5 UI pass). The Test Mode badge moved out
    // of this page and into the application shell, which renders it on every
    // route except the login screen — so it is now MORE prominent, not less.
    // The property this guard protects is unchanged: any Razorpay mention on
    // these surfaces must be the truthful Test Mode badge and nothing else.
    const mentions = [...R3_CODE.matchAll(/Razorpay/g)].length;
    expect(mentions).toBeLessThanOrEqual(1);

    // The badge genuinely still exists, globally.
    const shell = readFileSync(
      join(ROOT, "components", "shell", "app-shell.tsx"),
      "utf8",
    );
    expect(shell).toContain("RAZORPAY TEST MODE");
    expect(shell).toContain('data-testid="env-badge"');
    // The page itself no longer duplicates the badge — the shell above it
    // does, on every protected route. Asserting it here again would pin a
    // layout decision rather than the guarantee.
  });

  it("17: nothing persists a score", () => {
    for (const forbidden of [
      "reliability_scores",
      "reliability_score_snapshots",
      "persistScore",
      "saveScore",
    ]) {
      expect(R3_CODE, forbidden).not.toContain(forbidden);
    }
  });
});

describe("Phase 4F-R3 — no Phase 4G readiness, and honest provenance", () => {
  it("18: no readiness verdict is computed or rendered", () => {
    for (const forbidden of [
      "NOT_READY",
      "NEEDS_ATTENTION",
      "NOT READY",
      "NEEDS ATTENTION",
      "GO_LIVE",
      "goLive",
      "readinessStatus",
      "certification",
    ]) {
      expect(R3_CODE, forbidden).not.toContain(forbidden);
    }
  });

  it("19: the UI contract carries the controlled-simulation wording", () => {
    // The label itself comes from the frozen types; the UI must render it and
    // must never substitute a provider-authenticity claim of its own.
    expect(componentCode).toContain("provenanceLabel");
    for (const forbidden of [
      "Real Razorpay Event",
      "real webhook delivery",
      "recorded provider evidence",
      "Verified by Razorpay",
      "Razorpay certified",
    ]) {
      expect(componentCode, forbidden).not.toContain(forbidden);
    }
  });

  it("20: UNKNOWN is stated as not-a-pass in the rendered wording", () => {
    expect(componentCode).toContain("not counted as PASS");
    // And no state is dressed up as a clean bill of health.
    for (const forbidden of [
      "healthy",
      "production ready",
      "certified",
      "approved by Razorpay",
    ]) {
      expect(componentCode, forbidden).not.toContain(forbidden);
    }
  });
});

describe("Phase 4F-R3 — the page is behind the existing operator gate", () => {
  it("21: middleware protects /reliability with the same gate", () => {
    const middleware = codeOf(
      readFileSync(join(ROOT, "middleware.ts"), "utf8"),
    );
    expect(middleware).toContain('"/reliability"');
    expect(middleware).toContain('"/reliability/:path*"');
    // The public webhook path must stay unprotected.
    expect(middleware).not.toContain("/api/webhooks");
  });
});
