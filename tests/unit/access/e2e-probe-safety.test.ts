import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Phase 5 correction — no end-to-end spec may probe with a destructive call.
 *
 * ============================================================================
 * THE INCIDENT THIS PREVENTS
 * ============================================================================
 *
 * `access-unlock.spec.ts` detected whether the access gate was enabled by
 * POSTing to `/api/demo/reset` and checking for a 401/403. That endpoint IS
 * gated — but the gate is DISABLED by default for local development, which is
 * the case in every ordinary run. So the POST was not refused: it succeeded,
 * wiped all ten runtime tables, and the probe then correctly concluded "gate
 * off" and skipped the tests.
 *
 * Two tests called it, so one Playwright run reset the project twice, silently.
 * A manually-created C01 demonstration — a real Razorpay Test Mode payment, its
 * duplicate fulfilments, four Findings and a regression attempt — was destroyed
 * this way.
 *
 * A probe must never be able to change what it is probing. This file makes
 * that structural instead of a thing to remember.
 */

const E2E_DIR = join(process.cwd(), "tests", "e2e");

/** Spec source with comments stripped — prose must not satisfy the check. */
function specCode(name: string): string {
  return readFileSync(join(E2E_DIR, name), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
}

const SPEC_FILES = readdirSync(E2E_DIR).filter((n) => n.endsWith(".spec.ts"));

/**
 * Endpoints that irreversibly destroy persisted evidence.
 *
 * Deliberately a tiny, explicit list rather than a pattern: the point is that
 * adding another destructive endpoint is a decision someone has to make here.
 */
const DESTRUCTIVE_ENDPOINTS = ["/api/demo/reset"] as const;

describe("e2e probe safety — no spec may call a destructive endpoint", () => {
  it("1: the spec directory was actually found", () => {
    // Guards against the whole suite passing vacuously on a bad path.
    expect(SPEC_FILES.length).toBeGreaterThan(3);
    expect(SPEC_FILES).toContain("access-unlock.spec.ts");
  });

  it("2: no spec POSTs to a destructive endpoint", () => {
    for (const name of SPEC_FILES) {
      const source = specCode(name);
      for (const endpoint of DESTRUCTIVE_ENDPOINTS) {
        expect(
          source,
          `${name} must not call ${endpoint} — the access gate is disabled by ` +
            "default, so a 'gated' endpoint is NOT refused in an ordinary run " +
            "and the call really does clear every runtime table",
        ).not.toContain(endpoint);
      }
    }
  });

  it("3: the access-gate probe uses a non-writing endpoint", () => {
    // The specific replacement, pinned. `/api/demo/profile` checks the gate
    // BEFORE parsing the body, so an invalid body is refused at 401 (gated) or
    // 400 (ungated) and neither path writes.
    const source = specCode("access-unlock.spec.ts");
    const start = source.indexOf("async function gateIsEnabled");
    expect(start).toBeGreaterThan(-1);
    const body = source.slice(start, start + 500);

    expect(body).toContain("/api/demo/profile");
    expect(body).toMatch(/status\(\) === 401/);
  });

  it("4: the probe sends a body the server must reject", () => {
    // If the probe ever sent a VALID profile it would flip the controlled C01
    // vulnerability on an ungated instance — a different silent mutation.
    const source = specCode("access-unlock.spec.ts");
    const start = source.indexOf("async function gateIsEnabled");
    const body = source.slice(start, start + 500);

    expect(body).not.toContain('"SAFE"');
    expect(body).not.toContain('"VULNERABLE_IDEMPOTENCY"');
    expect(body).toContain("__probe_not_a_valid_profile__");
  });
});

describe("e2e probe safety — the reset endpoint keeps its own protection", () => {
  it("5: the reset route still gates before it resets", () => {
    // The endpoint is not the problem — calling it from a probe was. This
    // asserts the route's own guard is intact, so the fix above is the only
    // change this incident required.
    const route = readFileSync(
      join(process.cwd(), "app", "api", "demo", "reset", "route.ts"),
      "utf8",
    );
    // Scoped to the POST handler, not the whole file: `runDemoReset` also
    // appears in the import block at the top, and comparing that against the
    // gate call compared an import to a call site rather than two statements.
    const handlerAt = route.indexOf("export async function POST");
    expect(handlerAt).toBeGreaterThan(-1);
    const handler = route.slice(handlerAt);

    const gateAt = handler.indexOf("getAccessGateEnv");
    const resetAt = handler.indexOf("runDemoReset(");
    expect(gateAt).toBeGreaterThan(-1);
    expect(resetAt).toBeGreaterThan(gateAt);
  });
});
