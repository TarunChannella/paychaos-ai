import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Phase 3F-C — static guard over the orchestration/persistence surface.
 *
 * Two properties matter most here and neither is provable from behaviour
 * alone:
 *
 *   1. `invariant_results` is APPEND-ONLY. The guard must not simply ban
 *      `.update(` globally, because finalizing `chaos_runs.outcome` is an
 *      allowed UPDATE. It therefore inspects which TABLE each mutating call
 *      targets.
 *   2. The frozen Phase 3F-B evaluator files were not modified by the resumed
 *      3F-C work.
 *
 * Every assertion runs against COMMENT-STRIPPED source, so a doc comment that
 * legitimately names a forbidden token cannot fail the guard, and a comment
 * can never satisfy one either.
 */

const repoRoot = path.resolve(import.meta.dirname, "../../../");

const PHASE_3F_C_SOURCES = [
  "lib/invariants/result-repository.ts",
  "lib/invariants/service.ts",
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

const sources = PHASE_3F_C_SOURCES.map((relative) => {
  const raw = fs.readFileSync(path.join(repoRoot, relative), "utf-8");
  return { relative, raw, functional: stripComments(raw) };
});

/**
 * Every mutating Supabase call, paired with the table it targets.
 *
 * Matches `.from("<table>")` followed by the first mutating verb in the same
 * statement, which is how this codebase always writes a chain.
 */
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

describe("Phase 3F-C surface — static safety guard", () => {
  it("1: found both production files and each is non-empty", () => {
    expect(sources).toHaveLength(2);
    for (const source of sources) {
      expect(source.raw.length).toBeGreaterThan(0);
    }
  });

  it("2: the guard is comment-blind", () => {
    // `service.ts` legitimately names Razorpay in prose while explaining that
    // it never calls it. The stripped source must not contain the token.
    const service = sources.find((s) => s.relative.endsWith("service.ts"))!;
    expect(service.raw.toLowerCase()).toMatch(/razorpay/);
    expect(service.functional.toLowerCase()).not.toContain("razorpay");
  });

  it("3: APPEND-ONLY — invariant_results is never updated, upserted or deleted", () => {
    for (const { relative, functional } of sources) {
      for (const call of mutatingCalls(functional)) {
        if (call.table !== "invariant_results") continue;
        expect(
          call.op,
          `${relative} performs a forbidden ${call.op} on invariant_results`,
        ).toBe("insert");
      }
    }
  });

  it("4: the ONLY mutating call on chaos_runs is an update, and no other table is mutated", () => {
    const allCalls = sources.flatMap((s) => mutatingCalls(s.functional));
    const tables = [...new Set(allCalls.map((c) => c.table))].sort();
    expect(tables).toEqual(["chaos_runs", "invariant_results"]);

    const chaosRunOps = [
      ...new Set(
        allCalls.filter((c) => c.table === "chaos_runs").map((c) => c.op),
      ),
    ];
    expect(chaosRunOps).toEqual(["update"]);
  });

  it("5: the chaos_runs update sets exactly one column — outcome", () => {
    const repository = sources.find((s) =>
      s.relative.endsWith("result-repository.ts"),
    )!;
    const updates = [
      ...repository.functional.matchAll(/\.update\(\s*(\{[^}]*\})\s*\)/g),
    ].map((m) => m[1]!);
    expect(updates).toHaveLength(1);
    expect(updates[0]!).toMatch(/^\{\s*outcome:\s*derived\s*,?\s*\}$/);
    expect(updates[0]!).not.toMatch(/updated_at/);
    expect(updates[0]!).not.toMatch(/status/);
  });

  it("6: no wildcard SELECT — every read is an explicit allowlist", () => {
    for (const { relative, functional } of sources) {
      expect(functional, relative).not.toMatch(/\.select\(\s*["'`]\*/);
    }
  });

  it("7: no network access of any kind", () => {
    for (const { relative, functional } of sources) {
      expect(functional, relative).not.toMatch(/\bfetch\s*\(/);
      expect(functional, relative).not.toMatch(/XMLHttpRequest/);
      expect(functional, relative).not.toMatch(/node:https?/);
      expect(functional, relative).not.toMatch(/axios/);
    }
  });

  it("8: no Razorpay client, endpoint or credential", () => {
    for (const { relative, raw, functional } of sources) {
      expect(functional, relative).not.toMatch(/require\("razorpay"\)/);
      expect(functional, relative).not.toMatch(/from\s+["']razorpay["']/);
      expect(functional, relative).not.toMatch(/new Razorpay\(/);
      expect(functional, relative).not.toMatch(/api\.razorpay\.com/);
      expect(raw, relative).not.toContain("RAZORPAY_KEY_SECRET");
      expect(raw, relative).not.toContain("RAZORPAY_WEBHOOK_SECRET");
    }
  });

  it("9: no secret is ever referenced", () => {
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

  it("10: no AI/LLM surface", () => {
    for (const { relative, functional } of sources) {
      const lower = functional.toLowerCase();
      for (const forbidden of ["openai", "anthropic", "ollama", "gpt-"]) {
        expect(lower, `${relative} :: ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("11: no Finding creation, diagnosis, recommendation or reliability scoring", () => {
    for (const { relative, functional } of sources) {
      const lower = functional.toLowerCase();
      for (const forbidden of [
        "findings",
        "createfinding",
        "diagnosis",
        "root_cause",
        "rootcause",
        "recommendation",
        "reliability_score",
        "reliabilityscore",
        "regression_run",
      ]) {
        expect(lower, `${relative} :: ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("12: no raw payload, signature or PII is read or logged", () => {
    for (const { relative, functional } of sources) {
      for (const forbidden of [
        "normalized_event",
        "raw_payload_redacted",
        "raw_body_sha256",
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

  it("13: both modules are server-only", () => {
    for (const { relative, raw } of sources) {
      expect(raw, relative).toMatch(/import\s+["']server-only["']/);
    }
  });

  it("14: the service reads evidence ONLY through the frozen assembler", () => {
    const service = sources.find((s) => s.relative.endsWith("service.ts"))!;
    expect(service.functional).toMatch(/assembleChaosRunEvidence/);
    // It never reaches for merchant tables itself to reconstruct history.
    expect(service.functional).not.toMatch(/\.from\(/);
    for (const table of [
      "orders",
      "payment_attempts",
      "payments",
      "fulfilments",
      "webhook_events",
      "event_processing_attempts",
    ]) {
      expect(service.functional, table).not.toContain(`"${table}"`);
    }
  });

  it("15: the service applies no C03 (or any scenario) special case", () => {
    const service = sources.find((s) => s.relative.endsWith("service.ts"))!;
    for (const scenario of ["C01", "C03", "C07", "C11"]) {
      expect(service.functional, scenario).not.toContain(`"${scenario}"`);
    }
    // And it never rewrites a disposition into another one.
    expect(service.functional).not.toMatch(
      /disposition\s*=\s*["'`](PASS|FAIL|UNKNOWN|NOT_APPLICABLE)["'`]/,
    );
  });

  it("16: NOT_APPLICABLE and ERROR are never written as a result value", () => {
    const repository = sources.find((s) =>
      s.relative.endsWith("result-repository.ts"),
    )!;
    const insert = repository.functional.match(/\.insert\(\{[\s\S]*?\}\)/)![0]!;
    expect(insert).not.toMatch(/NOT_APPLICABLE/);
    expect(insert).not.toMatch(/["'`]ERROR["'`]/);
    expect(insert).not.toMatch(/SKIPPED/);
    expect(insert).not.toMatch(/NOT_RUN/);
  });

  it("17: no clock is read to finalize the aggregate outcome", () => {
    const repository = sources.find((s) =>
      s.relative.endsWith("result-repository.ts"),
    )!;
    expect(repository.functional).not.toMatch(/new Date\(/);
    expect(repository.functional).not.toMatch(/Date\.now\(/);
  });

  it("18: the frozen Phase 3F-B evaluator surface is unchanged by 3F-C work", () => {
    const evaluators = fs.readFileSync(
      path.join(repoRoot, "lib", "invariants", "evaluators.ts"),
      "utf-8",
    );
    // Still exactly twelve registered evaluators.
    const table = evaluators.match(
      /export const INVARIANT_EVALUATORS[\s\S]*?\n\}\);/,
    )!;
    expect([...table[0]!.matchAll(/"(INV-\d{3})"/g)]).toHaveLength(12);
    // The corrected applicability ordering is still in place.
    expect(evaluators).toMatch(/hasMerchantSubject/);
    // The evaluator surface still persists nothing.
    expect(stripComments(evaluators)).not.toMatch(/invariant_results/);
    expect(stripComments(evaluators)).not.toMatch(/\.from\(/);

    const evaluate = fs.readFileSync(
      path.join(repoRoot, "lib", "invariants", "evaluate.ts"),
      "utf-8",
    );
    expect(stripComments(evaluate)).not.toMatch(/\.from\(/);
  });

  it("19: no migration was introduced by Phase 3F-C", () => {
    const migrations = fs
      .readdirSync(path.join(repoRoot, "supabase", "migrations"))
      .sort();

    // ADVANCED, NOT LOOSENED. Phase 3G legitimately added the twelfth
    // migration, so "the 3F-A migration sorts last" is now historically
    // stale. The property this guard actually protects is narrower and is
    // asserted by exact name: the whole of Phase 3F introduced EXACTLY ONE
    // migration — `invariant_results` — and Phase 3F-C introduced none of
    // its own. A generic count would prove neither.
    expect(migrations.filter((m) => m.includes("phase3f"))).toEqual([
      "20260902000000_phase3f_invariant_results.sql",
    ]);
    expect(migrations.filter((m) => m.includes("phase3f-c"))).toEqual([]);
    // Advanced again for Phase 4E, which legitimately adds the thirteenth
    // migration (`regression_runs`, the tenth and last P0 table). The
    // exact-name property above is what this guard protects and is unchanged.
    expect(migrations[migrations.length - 1]).toBe(
      "20260904000000_phase4e_regression_runs.sql",
    );
    expect(migrations[migrations.length - 2]).toBe(
      "20260903000000_phase3g_findings.sql",
    );
    expect(migrations).toHaveLength(13);
  });
});
