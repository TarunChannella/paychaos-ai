import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Phase 3F-B — static guard over the evaluator PRODUCTION surface.
 *
 * Proves by reading the source as text that the pure evaluator layer performs
 * no I/O, reads no clock or randomness, touches no Razorpay or AI service, and
 * — critically — contains no persistence whatsoever.
 *
 * Every assertion runs against COMMENT-STRIPPED source. A doc comment that
 * legitimately names `invariant_results` or `Date.now` while explaining why
 * the module never uses it must not make this guard fail, and a comment must
 * never be able to satisfy an assertion either.
 */

const repoRoot = path.resolve(import.meta.dirname, "../../../");

const EVALUATOR_SOURCES = [
  "lib/invariants/evaluator-utils.ts",
  "lib/invariants/evaluators.ts",
  "lib/invariants/evaluate.ts",
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

const sources = EVALUATOR_SOURCES.map((relative) => {
  const raw = fs.readFileSync(path.join(repoRoot, relative), "utf-8");
  return { relative, raw, functional: stripComments(raw) };
});

describe("Phase 3F-B evaluator surface — static safety guard", () => {
  it("1: found all three production files and each is non-empty", () => {
    expect(sources).toHaveLength(3);
    for (const source of sources) {
      expect(source.raw.length).toBeGreaterThan(0);
    }
  });

  it("2: the guard is comment-blind — a doc comment cannot satisfy or break it", () => {
    // `evaluators.ts` legitimately explains in prose that it never names
    // `invariant_results`. The stripped source must not contain the phrase,
    // proving comments really are removed before every assertion below.
    // `evaluator-utils.ts` legitimately explains in prose that it never names
    // the invariant-result table. The stripped source must not contain the
    // phrase, proving comments really are removed before every assertion
    // below.
    const utils = sources.find((s) =>
      s.relative.endsWith("evaluator-utils.ts"),
    )!;
    expect(utils.raw).toMatch(/invariant_results/);
    expect(utils.functional).not.toMatch(/invariant_results/);
  });

  it("3: no Supabase client, table access or SQL of any kind", () => {
    for (const { relative, functional } of sources) {
      expect(functional, relative).not.toMatch(/@\/lib\/supabase/);
      expect(functional, relative).not.toMatch(/createClient/);
      expect(functional, relative).not.toMatch(/\.from\(/);
      expect(functional, relative).not.toMatch(/getSupabaseServerClient/);
      expect(functional, relative).not.toMatch(/\.rpc\(/);
    }
  });

  it("4: NO PERSISTENCE — no invariant_results, no insert/update/upsert/delete", () => {
    for (const { relative, functional } of sources) {
      expect(functional, relative).not.toMatch(/invariant_results/);
      expect(functional, relative).not.toMatch(/\.insert\(/);
      expect(functional, relative).not.toMatch(/\.update\(/);
      expect(functional, relative).not.toMatch(/\.upsert\(/);
      expect(functional, relative).not.toMatch(/\.delete\(/);
      expect(functional, relative).not.toMatch(/\bINSERT\b/i);
      expect(functional, relative).not.toMatch(/\bUPSERT\b/i);
    }
  });

  it("5: no network access", () => {
    for (const { relative, functional } of sources) {
      expect(functional, relative).not.toMatch(/\bfetch\s*\(/);
      expect(functional, relative).not.toMatch(/XMLHttpRequest/);
      expect(functional, relative).not.toMatch(/node:https?/);
      expect(functional, relative).not.toMatch(/axios/);
    }
  });

  it("6: no Razorpay surface", () => {
    for (const { relative, functional } of sources) {
      expect(functional, relative).not.toMatch(/require\("razorpay"\)/);
      expect(functional, relative).not.toMatch(/from\s+["']razorpay["']/);
      expect(functional, relative).not.toMatch(/new Razorpay\(/);
      expect(functional, relative).not.toMatch(/api\.razorpay\.com/);
    }
  });

  it("7: no environment variables and no filesystem", () => {
    for (const { relative, functional } of sources) {
      expect(functional, relative).not.toMatch(/process\.env/);
      expect(functional, relative).not.toMatch(/node:fs/);
      expect(functional, relative).not.toMatch(/readFileSync/);
    }
  });

  it("8: no clock and no randomness — determinism by construction", () => {
    for (const { relative, functional } of sources) {
      expect(functional, relative).not.toMatch(/Date\.now\(/);
      expect(functional, relative).not.toMatch(/new Date\(/);
      expect(functional, relative).not.toMatch(/Math\.random\(/);
      expect(functional, relative).not.toMatch(/randomUUID/);
      expect(functional, relative).not.toMatch(/performance\.now/);
    }
  });

  it("9: no AI/LLM surface", () => {
    for (const { relative, functional } of sources) {
      const lower = functional.toLowerCase();
      for (const forbidden of [
        "openai",
        "anthropic",
        "ollama",
        "llm",
        "gpt-",
      ]) {
        expect(lower, `${relative} :: ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("10: no diagnosis, finding, recommendation or reliability-score surface", () => {
    for (const { relative, functional } of sources) {
      const lower = functional.toLowerCase();
      for (const forbidden of [
        "diagnosis",
        "root_cause",
        "rootcause",
        "recommendation",
        "reliability_score",
        "reliabilityscore",
        "createfinding",
        "regression_run",
      ]) {
        expect(lower, `${relative} :: ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("11: no floating-point money handling", () => {
    for (const { relative, functional } of sources) {
      expect(functional, relative).not.toMatch(/parseFloat/);
      expect(functional, relative).not.toMatch(/toFixed\(/);
      expect(functional, relative).not.toMatch(/Math\.round\(/);
      expect(functional, relative).not.toMatch(/epsilon/i);
    }
  });

  it("12: no secret is ever referenced", () => {
    for (const { relative, raw } of sources) {
      for (const forbidden of [
        "RAZORPAY_KEY_SECRET",
        "RAZORPAY_WEBHOOK_SECRET",
        "SUPABASE_SERVICE_ROLE_KEY",
        "PAYCHAOS_ACCESS_TOKEN",
        "PAYCHAOS_SESSION_SECRET",
      ]) {
        expect(raw, `${relative} :: ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("13: no raw payload, signature or PII field is read", () => {
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
    }
  });

  it("14: nothing is logged", () => {
    for (const { relative, functional } of sources) {
      expect(functional, relative).not.toMatch(
        /console\.(log|info|warn|error|debug)\(/,
      );
    }
  });

  it("15: the frozen Phase 3F-A registry and types are imported, never redefined", () => {
    const evaluators = sources.find((s) =>
      s.relative.endsWith("evaluators.ts"),
    )!;
    expect(evaluators.functional).toMatch(/from\s+["']\.\/registry["']/);
    expect(evaluators.functional).toMatch(/from\s+["']\.\/types["']/);
    // No local re-declaration of the catalogue ID union or severity vocabulary.
    for (const { relative, functional } of sources) {
      expect(functional, relative).not.toMatch(/export type MoneyInvariantId/);
      expect(functional, relative).not.toMatch(/export type InvariantSeverity/);
      expect(functional, relative).not.toMatch(
        /export type PersistedInvariantResult/,
      );
    }
  });

  it("16: exactly twelve evaluators are registered, INV-001..INV-012, with no P1 entry", () => {
    const evaluators = sources.find((s) =>
      s.relative.endsWith("evaluators.ts"),
    )!;
    const table = evaluators.functional.match(
      /export const INVARIANT_EVALUATORS[\s\S]*?\n\}\);/,
    );
    expect(table).not.toBeNull();
    const ids = [...table![0]!.matchAll(/"(INV-\d{3})"/g)].map((m) => m[1]!);
    expect(ids).toEqual([
      "INV-001",
      "INV-002",
      "INV-003",
      "INV-004",
      "INV-005",
      "INV-006",
      "INV-007",
      "INV-008",
      "INV-009",
      "INV-010",
      "INV-011",
      "INV-012",
    ]);
    expect(evaluators.functional).not.toMatch(/INV-013/);
    expect(evaluators.functional).not.toMatch(/INV-014/);
  });

  it("17: the frozen evidence contract is consumed as types only — no evidence model is rebuilt", () => {
    for (const { relative, functional } of sources) {
      // Type-only imports from the frozen evidence surface.
      const evidenceImports = [
        ...functional.matchAll(
          /import\s+(type\s+)?\{[\s\S]*?\}\s+from\s+["']@\/lib\/evidence\/[^"']+["']/g,
        ),
      ];
      for (const match of evidenceImports) {
        expect(match[0]!, relative).toMatch(/import\s+type\s+\{/);
      }
      // No re-implementation of the bundle builder or repository.
      expect(functional, relative).not.toMatch(/buildChaosRunEvidenceBundle/);
      expect(functional, relative).not.toMatch(/chaos-evidence-repository/);
      expect(functional, relative).not.toMatch(/chaos-evidence-service/);
    }
  });

  it("18: no blanket `gaps.length > 0 -> UNKNOWN` shortcut exists", () => {
    for (const { relative, functional } of sources) {
      expect(functional, relative).not.toMatch(/gaps\.length/);
      expect(functional, relative).not.toMatch(/bundle\.gaps/);
    }
  });

  it("19: the frozen chaos registry and types are not imported or modified here", () => {
    for (const { relative, functional } of sources) {
      expect(functional, relative).not.toMatch(/@\/lib\/chaos\/registry/);
    }
  });

  it("20: the frozen Phase 3F-A production files are byte-unchanged in their public contract", () => {
    const types = fs.readFileSync(
      path.join(repoRoot, "lib", "invariants", "types.ts"),
      "utf-8",
    );
    const registry = fs.readFileSync(
      path.join(repoRoot, "lib", "invariants", "registry.ts"),
      "utf-8",
    );
    // Still exactly twelve catalogue IDs, still the same result split.
    expect(
      [...types.matchAll(/\| "(INV-\d{3})"/g)].map((m) => m[1]!),
    ).toHaveLength(12);
    expect(types).toMatch(
      /export type PersistedInvariantResult = "PASS" \| "FAIL" \| "UNKNOWN";/,
    );
    expect(registry).toMatch(/import "server-only";/);
    // The registry still ships no evaluator.
    expect(stripComments(registry)).not.toMatch(/\bevaluate[A-Z]/);
  });
});
