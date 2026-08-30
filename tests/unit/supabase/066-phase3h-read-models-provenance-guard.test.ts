import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Phase 3H — a static regression guard against
 * `tests/integration/supabase/066-phase3h-read-models.integration.test.ts`
 * ever ceasing to be READ-ONLY, fabricating provider evidence, executing a
 * chaos scenario, touching Razorpay, or mutating approved historical rows.
 *
 * The specific risk here is different from the earlier suites'. 066 exercises
 * READ models, so it needs no fixture of its own — which means the moment it
 * grows a single insert, it has stopped being what it claims to be. This guard
 * makes that impossible to add quietly.
 *
 * Mirrors `065-phase3g-findings-provenance-guard.test.ts`. A plain static text
 * check (no Supabase connection, offline unit suite).
 */

const repoRoot = path.resolve(import.meta.dirname, "../../../");
const integrationDir = path.join(repoRoot, "tests", "integration", "supabase");
const targetFile = path.join(
  integrationDir,
  "066-phase3h-read-models.integration.test.ts",
);

const source = fs.readFileSync(targetFile, "utf-8");

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

const functionalSource = stripComments(source);

/** Every mutating Supabase call, paired with the table it targets. */
function mutatingCalls(): Array<{ table: string; op: string }> {
  const calls: Array<{ table: string; op: string }> = [];
  const pattern =
    /\.from\(\s*["'`](\w+)["'`]\s*\)\s*[\s\S]{0,300}?\.(insert|update|upsert|delete)\(/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(functionalSource)) !== null) {
    calls.push({ table: match[1]!, op: match[2]! });
  }
  return calls;
}

describe("066-phase3h-read-models.integration.test.ts — provenance guard", () => {
  it("1: found the target file and it is non-empty", () => {
    expect(source.length).toBeGreaterThan(0);
  });

  it("2: the guard is comment-blind", () => {
    // The file's header legitimately names PAYCHAOS_SIMULATION and
    // `webhook_events` while explaining that it creates neither.
    expect(source).toContain("PAYCHAOS_SIMULATION");
    expect(source).toContain("webhook_events");
    expect(stripComments(source.split("describe(")[0]!)).not.toContain(
      "webhook_events",
    );
  });

  it("3: the suite is READ-ONLY — it mutates no table at all", () => {
    expect(mutatingCalls()).toEqual([]);
  });

  it("4: no insert, update, upsert or delete appears anywhere", () => {
    for (const verb of [".insert(", ".update(", ".upsert(", ".delete("]) {
      expect(functionalSource, verb).not.toContain(verb);
    }
  });

  it("5: it needs no cleanup, because it creates nothing", () => {
    // A read-only suite that grew an afterAll cleanup would be a sign it had
    // started writing.
    expect(functionalSource).not.toContain("afterAll");
    expect(functionalSource).not.toContain("beforeAll");
  });

  it("6: no provider evidence is fabricated", () => {
    // Fabrication is object-literal shaped — `raw_body_sha256: "…"`. The bare
    // column NAME is a different thing entirely: 066 lists these columns in a
    // denylist to assert the read model never LEAKS them, which is the
    // opposite of fabricating one. So every token is matched with its `:`,
    // matching the convention the other three already use.
    for (const forbidden of [
      "signature_verified:",
      "raw_body_sha256:",
      "razorpay_event_id:",
      "source_kind:",
    ]) {
      expect(functionalSource, forbidden).not.toContain(forbidden);
    }
    // The suite writes nothing at all (tests 3 and 4), so there is no path by
    // which provider evidence could be created even without the check above.
    expect(mutatingCalls()).toEqual([]);
    // And the leak denylist that legitimately names the column must remain.
    expect(functionalSource).toContain('"raw_body_sha256",');
  });

  /**
   * The only Razorpay-shaped strings 066 is allowed to contain, each with the
   * reason it is safe. Both are things 066 asserts ABOUT the read model, not
   * things it does:
   *
   *   - `REAL_RAZORPAY_WEBHOOK` is the PROVENANCE LABEL. Asserting it proves
   *     evidence is classified truthfully, which Phase 3 requires.
   *   - `x-razorpay-signature` appears only in the leak DENYLIST, asserting
   *     the projection never exposes the header.
   *
   * Each is neutralised before the scan AND separately asserted to still be
   * present, so this allowlist cannot rot into a blanket exemption. Any OTHER
   * mention of Razorpay still fails.
   */
  const SAFE_RAZORPAY_LITERALS = [
    "REAL_RAZORPAY_WEBHOOK",
    "x-razorpay-signature",
  ] as const;

  it("7: no Razorpay surface is touched", () => {
    let scanned = functionalSource;
    for (const safe of SAFE_RAZORPAY_LITERALS) {
      // Still genuinely present — never an exemption for a string that left.
      expect(functionalSource, safe).toContain(safe);
      scanned = scanned.replaceAll(safe, "SAFE_ASSERTED_LITERAL");
    }

    for (const forbidden of [
      "razorpay",
      "RAZORPAY_KEY",
      "api.razorpay.com",
      "checkout",
    ]) {
      expect(scanned.toLowerCase(), forbidden).not.toContain(
        forbidden.toLowerCase(),
      );
    }
  });

  it("7b: the safe Razorpay literals are ASSERTIONS, never live calls", () => {
    // `x-razorpay-signature` must appear only inside a not-to-contain denylist,
    // never as a header this suite sets on a request.
    expect(functionalSource).not.toMatch(
      /headers?\s*[:.[]?[^\n]*x-razorpay-signature/i,
    );
    expect(functionalSource).not.toContain("fetch(");
  });

  it("8: no chaos scenario is executed and no run is created", () => {
    for (const forbidden of [
      "createChaosRun",
      "executeC03",
      "executeChaos",
      "startChaosRun",
      "replayEvent",
      "evaluateChaosRun",
      "generateFindingsForChaosRun",
      "createFindingFromInvariantResult",
      "process_webhook_payment_event",
    ]) {
      expect(functionalSource, forbidden).not.toContain(forbidden);
    }
  });

  it("9: it exercises the REAL Phase 3H read models", () => {
    for (const required of [
      "@/lib/chaos/scenario-dto",
      "@/lib/chaos/eligibility-service",
      "@/lib/chaos/run-read-model",
      "@/lib/findings/run-findings-read",
      "@/lib/evidence/timeline-model",
    ]) {
      expect(functionalSource, required).toContain(required);
    }
  });

  it("10: the approved historical baseline is pinned by exact run ID", () => {
    expect(functionalSource).toContain("APPROVED_PHASE_3F_RUN_IDS");
    for (const runId of [
      "c406dafd-d48f-4e1e-b092-030acbb5e32b",
      "a0c5a66a-e70f-4e47-b9eb-0b3482c789d4",
      "68878716-ed49-40ec-85de-f962a4f6b21c",
      "5090e423-daa5-4122-99de-4c27d728957c",
      "b49d344a-f5cf-42ae-a078-819b26bfbffe",
    ]) {
      expect(functionalSource, runId).toContain(runId);
    }
    // Selected positively, never by exclusion.
    expect(functionalSource).not.toMatch(
      /\.not\(\s*["'`]id["'`],\s*["'`]in["'`]/,
    );
  });

  it("11: it asserts the approved tally rather than assuming it", () => {
    expect(functionalSource).toContain("PASS: 1");
    expect(functionalSource).toContain("UNKNOWN: 10");
    expect(functionalSource).toContain("toHaveLength(11)");
  });

  it("12: it never asserts a non-empty eligibility result", () => {
    // Zero candidates is a valid truthful answer; demanding candidates would
    // pressure a future change to weaken the frozen freshness rule.
    expect(functionalSource).not.toMatch(
      /candidates\s*\)\s*\.\s*toHaveLength\(\s*[1-9]/,
    );
    expect(functionalSource).not.toMatch(
      /candidates\.length\s*\)\s*\.toBeGreaterThan/,
    );
  });

  it("13: no AI/LLM surface", () => {
    for (const forbidden of ["openai", "anthropic", "ollama", "gpt-"]) {
      expect(functionalSource.toLowerCase(), forbidden).not.toContain(
        forbidden,
      );
    }
  });

  it("14: the integration sequence is pinned — 067 exists and 068 does not", () => {
    const integrationFiles = fs
      .readdirSync(integrationDir)
      .filter((name) => name.endsWith(".integration.test.ts"))
      .sort();

    expect(integrationFiles.filter((name) => name.startsWith("066-"))).toEqual([
      "066-phase3h-read-models.integration.test.ts",
    ]);
    // 067 is the Phase 4A evidence-pack suite, added after this file, and is
    // pinned by exact name for the same reason 066 is.
    expect(integrationFiles.filter((name) => name.startsWith("067-"))).toEqual([
      "067-phase4a-evidence-pack.integration.test.ts",
    ]);
    expect(
      integrationFiles.filter((name) => name.startsWith("068-")),
      "a 068- integration suite appeared without this guard being advanced",
    ).toEqual([]);
  });
});
