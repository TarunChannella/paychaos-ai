import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Phase 4C-R2 — a static guard over the diagnosis orchestration service and
 * the diagnosis persistence repository.
 *
 * R2 is the FIRST layer in the whole diagnosis chain permitted to write, so
 * the risks are sharper than in any earlier sub-phase: the repository could
 * widen beyond `findings`, acquire an INSERT/UPSERT/DELETE, write a Finding's
 * status or a later phase's fields, or drop the guard that makes the first
 * write safe under concurrency. The service could assemble the Evidence Pack
 * twice, reach the database directly, or grow 4D recommendation logic.
 *
 * Comments are stripped before every content assertion.
 */

const repoRoot = path.resolve(import.meta.dirname, "../../../");

const SERVICE_PATH = "lib/diagnosis/root-cause-service.ts";
const REPOSITORY_PATH = "lib/diagnosis/root-cause-repository.ts";
const CLASSIFIER_PATH = "lib/diagnosis/root-cause-classifier.ts";

function read(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf-8");
}

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

const service = stripComments(read(SERVICE_PATH));
const repository = stripComments(read(REPOSITORY_PATH));
const classifier = stripComments(read(CLASSIFIER_PATH));

describe("Phase 4C-R2 — frozen classifier protection", () => {
  it("1: the R1 classifier is still PURE — every import is type-only or a frozen contract", () => {
    const imports = classifier
      .split("\n")
      .filter((line) => line.trimStart().startsWith("import "));
    expect(imports.length).toBeGreaterThan(0);
    for (const statement of imports) {
      const from = statement.match(/from\s+"([^"]+)"/);
      if (from === null) continue;
      expect(
        [
          "@/lib/diagnosis/diagnostic-signals",
          "@/lib/diagnosis/evidence-pack",
          "@/lib/supabase/types",
        ],
        statement,
      ).toContain(from[1]);
    }
    expect(classifier).not.toContain("server-only");
  });

  it("2: the R1 classifier still performs no I/O, clock or write", () => {
    for (const forbidden of [
      "getSupabaseServerClient",
      "@supabase/supabase-js",
      ".from(",
      ".select(",
      ".update(",
      ".insert(",
      ".eq(",
      "new Date",
      "Date.now",
      "Math.random",
      "fetch(",
      "process.env",
      "diagnosed_at",
      "persistFindingDiagnosis",
    ]) {
      expect(classifier, forbidden).not.toContain(forbidden);
    }
  });

  it("3: the frozen 4A/4B pure modules still have zero runtime imports", () => {
    for (const frozen of [
      "lib/diagnosis/evidence-pack.ts",
      "lib/diagnosis/diagnostic-signals.ts",
    ]) {
      const text = stripComments(read(frozen));
      const imports = text
        .split("\n")
        .filter((line) => line.trimStart().startsWith("import "));
      expect(imports.length, frozen).toBeGreaterThan(0);
      for (const statement of imports) {
        expect(statement.trimStart(), `${frozen}: ${statement}`).toMatch(
          /^import type\b/,
        );
      }
    }
  });
});

describe("Phase 4C-R2 — orchestration service", () => {
  it("4: SERVER ONLY", () => {
    expect(service).toContain('import "server-only";');
  });

  it("5: it composes exactly the approved units", () => {
    expect(service).toContain("assembleDiagnosisEvidencePackForFinding");
    expect(service).toContain("extractDiagnosticSignals");
    expect(service).toContain("classifyRootCause");
    expect(service).toContain("persistFindingDiagnosis");
    expect(service).toContain("export async function diagnoseFinding");
  });

  it("6: the Evidence Pack is assembled EXACTLY ONCE in source", () => {
    const calls = [
      ...service.matchAll(/assembleDiagnosisEvidencePackForFinding\(/g),
    ];
    // One import reference plus one call site.
    expect(calls).toHaveLength(1);
    // The Phase 4B server service would assemble a second pack: never used.
    expect(service).not.toContain("assembleDiagnosticSignalsForFinding");
    expect(service).not.toContain("@/lib/diagnosis/diagnostic-signals-service");
  });

  it("7: NO DIRECT DATABASE ACCESS from the service", () => {
    for (const forbidden of [
      "@/lib/supabase/server",
      "@supabase/supabase-js",
      "createClient",
      "getSupabaseServerClient",
      "@/lib/findings/repository",
      "@/lib/findings/service",
      "@/lib/evidence/evidence-repository",
      "@/lib/evidence/chaos-evidence-repository",
      "@/lib/invariants/result-repository",
      "@/lib/chaos/run-repository",
      ".from(",
      ".select(",
      ".update(",
      ".insert(",
      ".upsert(",
      ".delete(",
      ".rpc(",
      ".eq(",
    ]) {
      expect(service, forbidden).not.toContain(forbidden);
    }
  });

  it("8: NO RAZORPAY, NETWORK, ENVIRONMENT, FILESYSTEM or SHELL", () => {
    for (const forbidden of [
      "@/lib/razorpay",
      "new Razorpay",
      "api.razorpay.com",
      "fetch(",
      "XMLHttpRequest",
      "http://",
      "https://",
      "process.env",
      "node:fs",
      "node:child_process",
      "readFileSync",
      "execSync",
      "spawn",
      "require(",
    ]) {
      expect(service, forbidden).not.toContain(forbidden);
    }
  });

  it("9: NO SECRET and NO AI/ML/LLM", () => {
    for (const forbidden of [
      "RAZORPAY_KEY_SECRET",
      "RAZORPAY_WEBHOOK_SECRET",
      "SUPABASE_SERVICE_ROLE_KEY",
      "PAYCHAOS_ACCESS_TOKEN",
      "PAYCHAOS_SESSION_SECRET",
      "SERVICE_ROLE",
      "openai",
      "OpenAI",
      "anthropic",
      "Anthropic",
      "ollama",
      "Ollama",
      "prompt",
      "embedding",
      "inference",
      "modelName",
    ]) {
      expect(service, forbidden).not.toContain(forbidden);
    }
  });

  it("10: NO 4D+ LOGIC — recommendation, regression, score, readiness", () => {
    for (const forbidden of [
      "recommendationCode",
      "recommendationText",
      "recommendation_code",
      "recommendation_text",
      "diagnosis_summary",
      "diagnosisSummary",
      "FIX-",
      "regression_runs",
      "regressionRun",
      "retest",
      "reliabilityScore",
      "RELIABILITY-V1",
      "readiness",
      "goLive",
    ]) {
      expect(service, forbidden).not.toContain(forbidden);
    }
  });

  it("11: NO payment, order, invariant or finding-status mutation", () => {
    for (const forbidden of [
      '"orders"',
      '"payment_attempts"',
      '"payments"',
      '"fulfilments"',
      '"webhook_events"',
      '"event_processing_attempts"',
      '"chaos_runs"',
      '"invariant_results"',
      "resolved_at",
      "resolvedAt",
      "STILL_FAILING",
      '"RESOLVED"',
      "finalizeChaosRunOutcome",
      "persistInvariantResult",
      "insertOpenFinding",
    ]) {
      expect(service, forbidden).not.toContain(forbidden);
    }
  });

  it("12: the timestamp is server-generated and never caller-supplied", () => {
    expect(service).toContain("new Date().toISOString()");
    // One timestamp per diagnosis, created after a classification exists.
    expect([
      ...service.matchAll(/new Date\(\)\.toISOString\(\)/g),
    ]).toHaveLength(1);
  });
});

describe("Phase 4C-R2 — diagnosis persistence repository", () => {
  it("13: SERVER ONLY", () => {
    expect(repository).toContain('import "server-only";');
  });

  it("14: Supabase access is limited to the findings table", () => {
    const tables = [...repository.matchAll(/\.from\("([^"]+)"\)/g)].map(
      (match) => match[1],
    );
    expect(tables.length).toBeGreaterThan(0);
    expect([...new Set(tables)]).toEqual(["findings"]);
  });

  it("15: SELECT and conditional UPDATE only — no insert, upsert, delete or rpc", () => {
    expect(repository).toContain(".select(");
    expect(repository).toContain(".update(");
    for (const forbidden of [".insert(", ".upsert(", ".delete(", ".rpc("]) {
      expect(repository, forbidden).not.toContain(forbidden);
    }
  });

  it("16: the update payload is exactly the four approved columns", () => {
    const start = repository.indexOf(".update({");
    expect(start).toBeGreaterThan(-1);
    const payload = repository.slice(start, repository.indexOf("})", start));
    const keys = [...payload.matchAll(/^\s{6}(\w+):/gm)].map((m) => m[1]);
    expect(keys.sort()).toEqual([
      "diagnosed_at",
      "diagnosis_code",
      "diagnosis_strength",
      "updated_at",
    ]);
    for (const forbidden of [
      "status:",
      "resolved_at:",
      "title:",
      "invariant_result_id:",
      "created_at:",
      "diagnosis_summary:",
      "recommendation_code:",
      "recommendation_text:",
    ]) {
      expect(payload, forbidden).not.toContain(forbidden);
    }
  });

  it("17: the update is guarded by the fresh all-NULL advisory state", () => {
    for (const guard of [
      '.is("diagnosis_code", null)',
      '.is("diagnosis_strength", null)',
      '.is("diagnosed_at", null)',
      '.is("diagnosis_summary", null)',
      '.is("recommendation_code", null)',
      '.is("recommendation_text", null)',
    ]) {
      expect(repository, guard).toContain(guard);
    }
    expect(repository).toContain('.eq("id", findingId)');
    expect(repository).toContain(
      '.eq("invariant_result_id", invariantResultId)',
    );
  });

  it("18: NO authoritative merchant or evidence table is referenced", () => {
    for (const forbidden of [
      '"orders"',
      '"payment_attempts"',
      '"payments"',
      '"fulfilments"',
      '"webhook_events"',
      '"event_processing_attempts"',
      '"chaos_runs"',
      '"invariant_results"',
    ]) {
      expect(repository, forbidden).not.toContain(forbidden);
    }
  });

  it("19: the projection is an explicit allowlist, never select(*)", () => {
    expect(repository).not.toContain('select("*")');
    expect(repository).not.toContain(".select('*')");
    expect(repository).toContain("DIAGNOSIS_COLUMNS");
  });

  it("20: NO SECRET, NETWORK, AI or 4D vocabulary", () => {
    for (const forbidden of [
      "RAZORPAY_KEY_SECRET",
      "RAZORPAY_WEBHOOK_SECRET",
      "SUPABASE_SERVICE_ROLE_KEY",
      "SERVICE_ROLE",
      "fetch(",
      "http://",
      "https://",
      "process.env",
      "openai",
      "anthropic",
      "ollama",
      "reliabilityScore",
      "readiness",
      "goLive",
      "regressionRun",
      "FIX-",
    ]) {
      expect(repository, forbidden).not.toContain(forbidden);
    }
  });

  it("21: NO retry loop around the conditional update", () => {
    for (const forbidden of ["while (", "for (;;)", "setTimeout", "retry"]) {
      expect(repository, forbidden).not.toContain(forbidden);
    }
  });
});

describe("Phase 4C-R2 — schema and surface boundaries", () => {
  it("22: PHASE 4C-R2 ADDS NO MIGRATION", () => {
    const migrations = fs
      .readdirSync(path.join(repoRoot, "supabase", "migrations"))
      .filter((name) => name.endsWith(".sql"))
      .sort();
    // Advanced for Phase 4E, which legitimately adds the tenth and last P0
    // table (docs/DATABASE.md Section 18). The protection is unchanged: this
    // phase still contributes NO migration of its own, and the Phase 3G
    // migration remains exactly where it was.
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
    expect(migrations.at(-4)).toBe("20260904000000_phase4e_regression_runs.sql");
    expect(migrations.at(-5)).toBe("20260903000000_phase3g_findings.sql");
  });

  it("23: lib/diagnosis contains only the approved Phase 4A/4B/4C modules", () => {
    const entries = fs
      .readdirSync(path.join(repoRoot, "lib", "diagnosis"), {
        withFileTypes: true,
      })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort();
    expect(entries).toEqual([
      "diagnostic-signals-service.ts",
      "diagnostic-signals.ts",
      "evidence-pack-service.ts",
      "evidence-pack.ts",
      "explanation-templates.ts",
      "recommendation-repository.ts",
      "recommendation-service.ts",
      "recommendations.ts",
      "root-cause-classifier.ts",
      "root-cause-repository.ts",
      "root-cause-service.ts",
    ]);
  });

  it("24: PHASE 4C-R2 ADDS NO API ROUTE and NO UI SURFACE", () => {
    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        return entry.isDirectory() ? walk(full) : [full];
      });
    const surfaces = walk(path.join(repoRoot, "app")).filter((file) =>
      /diagnos|signal|root-cause|evidence-pack|recommend|reliabilit|readiness/i.test(
        file,
      ),
    );
    // ADVANCED, NOT LOOSENED (Phase 4F-R3). Phase 4F legitimately adds the
    // reliability read API and page required by P4-AC-10/11, so those two
    // exact files are now expected. Every other surface this guard protects
    // remains absolutely forbidden, and an unexpected THIRD reliability
    // surface would fail here rather than slip in. This phase itself still
    // contributes no route or UI of its own.
    const normalised = surfaces
      .map((file) =>
        file.replace(repoRoot, "").split(String.fromCharCode(92)).join("/"),
      )
      .sort();
    // Advanced again in Phase 4G: the Go-Live Readiness read API is now a
    // legitimate surface. The list stays EXACT, so an unapproved surface
    // still fails here rather than slipping in.
    expect(normalised).toEqual([
      "/app/api/findings/[findingId]/diagnose/route.ts",
      "/app/api/readiness/route.ts",
      "/app/api/reliability/route.ts",
      "/app/reliability/page.tsx",
    ]);
  });

  it("25: neither R2 module declares a browser or API dependency", () => {
    for (const [name, source] of [
      ["service", service],
      ["repository", repository],
    ] as const) {
      for (const forbidden of [
        '"use client"',
        "next/navigation",
        "next/headers",
        "next/server",
        "NextRequest",
        "NextResponse",
        "react",
        "app/api",
        ".tsx",
      ]) {
        expect(source, `${name}: ${forbidden}`).not.toContain(forbidden);
      }
    }
  });
});
