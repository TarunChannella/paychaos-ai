import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Phase 3G — static guard over the Finding surface.
 *
 * Two properties matter most here and neither is provable from behaviour
 * alone:
 *
 *   1. `findings` is INSERT-ONLY in Phase 3G production. The migration DOES
 *      grant `service_role` UPDATE and DELETE, because Phase 4 needs them —
 *      so the guard cannot infer restraint from privileges. It inspects which
 *      TABLE each mutating call targets and which verb it uses.
 *   2. The frozen Phase 3F production files were not modified by Phase 3G.
 *
 * Every assertion runs against COMMENT-STRIPPED source, so a doc comment that
 * legitimately names a forbidden token cannot fail the guard, and a comment
 * can never satisfy one either.
 */

const repoRoot = path.resolve(import.meta.dirname, "../../../");

const PHASE_3G_SOURCES = [
  "lib/findings/types.ts",
  "lib/findings/repository.ts",
  "lib/findings/service.ts",
] as const;

/** The two modules that may touch the database at all. */
const IO_SOURCES = [
  "lib/findings/repository.ts",
  "lib/findings/service.ts",
] as const;

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

const sources = PHASE_3G_SOURCES.map((relative) => {
  const raw = fs.readFileSync(path.join(repoRoot, relative), "utf-8");
  return { relative, raw, functional: stripComments(raw) };
});

const ioSources = sources.filter((s) =>
  (IO_SOURCES as readonly string[]).includes(s.relative),
);

/** Every mutating Supabase call, paired with the table it targets. */
function mutatingCalls(
  functional: string,
): Array<{ table: string; op: string }> {
  const calls: Array<{ table: string; op: string }> = [];
  const pattern =
    /\.from\(\s*["'`](\w+)["'`]\s*\)\s*[\s\S]{0,200}?\.(insert|update|upsert|delete)\(/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(functional)) !== null) {
    calls.push({ table: match[1]!, op: match[2]! });
  }
  return calls;
}

const migrationPath = path.join(
  repoRoot,
  "supabase",
  "migrations",
  "20260903000000_phase3g_findings.sql",
);
const migration = fs.readFileSync(migrationPath, "utf-8");

describe("Phase 3G surface — static safety guard", () => {
  it("1: found all three production files and each is non-empty", () => {
    expect(sources).toHaveLength(3);
    for (const source of sources) {
      expect(source.raw.length).toBeGreaterThan(0);
    }
  });

  it("2: the guard is comment-blind", () => {
    // `repository.ts` legitimately names UPSERT and DELETE in prose while
    // explaining that it performs neither. The stripped source must not
    // contain either token, or every ban below could be satisfied by a
    // comment — and defeated by one.
    const repository = sources.find((s) =>
      s.relative.endsWith("repository.ts"),
    )!;
    expect(repository.raw.toLowerCase()).toContain("upsert");
    expect(repository.functional.toLowerCase()).not.toContain("upsert");
  });

  it("3: INSERT-ONLY — findings is never updated, upserted or deleted", () => {
    for (const { relative, functional } of ioSources) {
      for (const call of mutatingCalls(functional)) {
        if (call.table !== "findings") continue;
        expect(
          call.op,
          `${relative} performs a forbidden ${call.op} on findings`,
        ).toBe("insert");
      }
    }
  });

  it("4: findings is the ONLY table Phase 3G mutates", () => {
    const allCalls = ioSources.flatMap((s) => mutatingCalls(s.functional));
    const tables = [...new Set(allCalls.map((c) => c.table))];
    expect(tables).toEqual(["findings"]);
  });

  it("5: no mutating verb appears against any authoritative evidence table", () => {
    for (const { relative, functional } of ioSources) {
      for (const table of [
        "invariant_results",
        "chaos_runs",
        "orders",
        "payment_attempts",
        "payments",
        "fulfilments",
        "webhook_events",
        "event_processing_attempts",
      ]) {
        const calls = mutatingCalls(functional).filter(
          (c) => c.table === table,
        );
        expect(calls, `${relative} mutates ${table}`).toHaveLength(0);
      }
    }
  });

  it("6: no lifecycle mutator is exported anywhere in Phase 3G", () => {
    for (const { relative, functional } of sources) {
      for (const forbidden of [
        "updateFinding",
        "resolveFinding",
        "markStillFailing",
        "reopenFinding",
        "setDiagnosis",
        "setRecommendation",
        "deleteFinding",
      ]) {
        expect(functional, `${relative} :: ${forbidden}`).not.toContain(
          forbidden,
        );
      }
    }
  });

  it("7: no Phase 4 column is ever WRITTEN by Phase 3G", () => {
    // The generated Supabase table type legitimately DESCRIBES these columns —
    // they exist in the database. This asserts the narrower property: no
    // Phase 3G production module names one as a value it sets.
    for (const { relative, functional } of sources) {
      for (const column of [
        "diagnosis_code",
        "diagnosis_strength",
        "diagnosis_summary",
        "recommendation_code",
        "recommendation_text",
        "diagnosed_at",
        "resolved_at",
      ]) {
        expect(functional, `${relative} :: ${column}`).not.toContain(column);
      }
    }
  });

  it("8: the single insert payload contains only the three creation fields", () => {
    const repository = sources.find((s) =>
      s.relative.endsWith("repository.ts"),
    )!;
    const inserts = [
      ...repository.functional.matchAll(/\.insert\(\s*(\{[^}]*\})\s*\)/g),
    ].map((m) => m[1]!);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]!).toMatch(/invariant_result_id/);
    expect(inserts[0]!).toMatch(/status:\s*["'`]OPEN["'`]/);
    expect(inserts[0]!).toMatch(/title/);
    for (const forbidden of [
      "diagnosis",
      "recommendation",
      "resolved_at",
      "created_at",
      "updated_at",
    ]) {
      expect(inserts[0]!, forbidden).not.toContain(forbidden);
    }
    // A bare `id:` would mean the row's primary key is being supplied by the
    // application. `\b` keeps this from matching `invariant_result_id:`.
    expect(inserts[0]!).not.toMatch(/\bid:/);
  });

  it("9: no wildcard SELECT — every read is an explicit allowlist", () => {
    for (const { relative, functional } of ioSources) {
      expect(functional, relative).not.toMatch(/\.select\(\s*["'`]\*/);
    }
  });

  it("10: no network access of any kind", () => {
    for (const { relative, functional } of sources) {
      expect(functional, relative).not.toMatch(/\bfetch\s*\(/);
      expect(functional, relative).not.toMatch(/XMLHttpRequest/);
      expect(functional, relative).not.toMatch(/node:https?/);
      expect(functional, relative).not.toMatch(/axios/);
    }
  });

  it("11: no Razorpay client, endpoint or credential", () => {
    for (const { relative, raw, functional } of sources) {
      expect(functional, relative).not.toMatch(/require\("razorpay"\)/);
      expect(functional, relative).not.toMatch(/from\s+["']razorpay["']/);
      expect(functional, relative).not.toMatch(/new Razorpay\(/);
      expect(functional, relative).not.toMatch(/api\.razorpay\.com/);
      expect(raw, relative).not.toContain("RAZORPAY_KEY_SECRET");
      expect(raw, relative).not.toContain("RAZORPAY_WEBHOOK_SECRET");
    }
  });

  it("12: no secret is ever referenced", () => {
    for (const { relative, raw } of sources) {
      for (const forbidden of [
        "SUPABASE_SERVICE_ROLE_KEY",
        "PAYCHAOS_ACCESS_TOKEN",
        "PAYCHAOS_SESSION_SECRET",
      ]) {
        expect(raw, `${relative} :: ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("13: no AI/LLM surface", () => {
    for (const { relative, functional } of sources) {
      const lower = functional.toLowerCase();
      for (const forbidden of ["openai", "anthropic", "ollama", "gpt-"]) {
        expect(lower, `${relative} :: ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("14: no diagnosis, recommendation, regression or scoring logic", () => {
    for (const { relative, functional } of sources) {
      const lower = functional.toLowerCase();
      for (const forbidden of [
        "rootcause",
        "root_cause",
        "confidence",
        "regression_run",
        "regressionrun",
        "reliability_score",
        "reliabilityscore",
        "golive",
        "go_live",
      ]) {
        expect(lower, `${relative} :: ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("15: no raw payload, signature or PII is read or logged", () => {
    for (const { relative, functional } of sources) {
      for (const forbidden of [
        "normalized_event",
        "raw_payload_redacted",
        "raw_body_sha256",
        "state_before",
        "state_after",
        "x-razorpay-signature",
        "cardNumber",
        "cvv",
        "otp",
      ]) {
        expect(functional, `${relative} :: ${forbidden}`).not.toContain(
          forbidden,
        );
      }
      expect(functional, relative).not.toMatch(
        /console\.(log|info|warn|error|debug)\(/,
      );
    }
  });

  it("16: both I/O modules are server-only", () => {
    for (const { relative, raw } of ioSources) {
      expect(raw, relative).toMatch(/import\s+["']server-only["']/);
    }
  });

  it("17: the service never re-evaluates, re-assembles evidence or executes chaos", () => {
    const service = sources.find((s) => s.relative.endsWith("service.ts"))!;
    for (const forbidden of [
      "evaluateInvariant",
      "evaluateChaosRun",
      "assembleChaosRunEvidence",
      "INVARIANT_EVALUATORS",
      "executeChaos",
      "startChaosRun",
    ]) {
      expect(service.functional, forbidden).not.toContain(forbidden);
    }
    // It never reaches for a table itself, either.
    expect(service.functional).not.toMatch(/\.from\(/);
  });

  it("18: only a persisted FAIL can produce a finding", () => {
    const service = sources.find((s) => s.relative.endsWith("service.ts"))!;
    // The gate exists...
    expect(service.functional).toMatch(/result\.result\s*!==\s*["'`]FAIL["'`]/);
    // ...and no other signal is consulted to decide that something failed.
    for (const forbidden of ["outcome", "scenario_id", "scenarioId"]) {
      expect(service.functional, forbidden).not.toContain(forbidden);
    }
  });

  it("19: Phase 3F production files are unchanged by Phase 3G work", () => {
    for (const relative of [
      "lib/invariants/types.ts",
      "lib/invariants/registry.ts",
      "lib/invariants/evaluate.ts",
      "lib/invariants/evaluator-utils.ts",
      "lib/invariants/evaluators.ts",
      "lib/invariants/result-repository.ts",
      "lib/invariants/service.ts",
    ]) {
      const text = fs.readFileSync(path.join(repoRoot, relative), "utf-8");
      const functional = stripComments(text);
      // No frozen Phase 3F module knows the Finding engine exists.
      expect(functional, relative).not.toContain("findings");
      expect(functional, relative).not.toContain("lib/findings");
      expect(functional, relative).not.toContain("createFindingFrom");
      expect(functional, relative).not.toContain("generateFindingsFor");
    }
  });

  it("20: Phase 3G introduced exactly one migration, and it sits one place before the latest", () => {
    const migrations = fs
      .readdirSync(path.join(repoRoot, "supabase", "migrations"))
      .sort();
    // Advanced, not loosened: Phase 4E adds the tenth and last P0 table
    // (docs/DATABASE.md Section 18), so Phase 3G's migration is now second
    // from last. Both positions stay exact-name assertions, and Phase 3G
    // still owns exactly one migration — asserted below.
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
    expect(migrations[migrations.length - 1]).toBe(
      "20260907000000_phase5_c01_controlled_vulnerable_profile.sql",
    );
    expect(migrations[migrations.length - 2]).toBe(
      "20260906000000_phase5_demo_reset_safeupdate.sql",
    );
    expect(migrations[migrations.length - 3]).toBe(
      "20260905000000_phase5_demo_reset_atomic.sql",
    );
    expect(migrations[migrations.length - 4]).toBe(
      "20260904000000_phase4e_regression_runs.sql",
    );
    expect(migrations[migrations.length - 5]).toBe(
      "20260903000000_phase3g_findings.sql",
    );
    // Phase 3F still owns exactly one migration of its own — advanced, not
    // loosened: this stays an exact-name assertion.
    expect(migrations.filter((m) => m.includes("phase3f"))).toEqual([
      "20260902000000_phase3f_invariant_results.sql",
    ]);
    expect(migrations.filter((m) => m.includes("phase3g"))).toEqual([
      "20260903000000_phase3g_findings.sql",
    ]);
  });

  it("21: the Phase 3G migration creates exactly one table and alters none", () => {
    // SQL comments are stripped first: this migration's header prose
    // legitimately says "no ALTER TABLE statement appears below", and a
    // comment must neither trip nor satisfy a DDL assertion.
    const sql = migration
      .split("\n")
      .map((line) => {
        const idx = line.indexOf("--");
        return idx === -1 ? line : line.slice(0, idx);
      })
      .join("\n");

    const created = [
      ...sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(\S+)/gi),
    ].map((m) => m[1]!);
    expect(created).toEqual(["public.findings"]);

    // The only ALTER is the RLS enablement on the table this migration owns.
    const altered = [...sql.matchAll(/alter\s+table\s+(\S+)/gi)].map(
      (m) => m[1]!,
    );
    expect([...new Set(altered)]).toEqual(["public.findings"]);

    for (const forbidden of [
      "regression_runs",
      "reliability_score_snapshots",
      "finding_evidence",
      "evidence_items",
    ]) {
      expect(sql.toLowerCase(), forbidden).not.toContain(forbidden);
    }
  });
});
