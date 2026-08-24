import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

// Phase 1B/2A: proves the .env.example / .gitignore contract required by
// docs/SECURITY.md ENV-003/ENV-004 — committed placeholder names only,
// real environment files never tracked.
const repoRoot = path.resolve(import.meta.dirname, "../../../");

describe("I: .env.example exists and contains no real secret values", () => {
  const envExamplePath = path.join(repoRoot, ".env.example");
  const content = fs.readFileSync(envExamplePath, "utf-8");

  it("exists", () => {
    expect(fs.existsSync(envExamplePath)).toBe(true);
  });

  it("declares the three Phase 1B variable names", () => {
    expect(content).toMatch(/^NEXT_PUBLIC_SUPABASE_URL=/m);
    expect(content).toMatch(/^NEXT_PUBLIC_SUPABASE_ANON_KEY=/m);
    expect(content).toMatch(/^SUPABASE_SERVICE_ROLE_KEY=/m);
  });

  it("declares the three Phase 2A Razorpay variable names", () => {
    expect(content).toMatch(/^RAZORPAY_MODE=/m);
    expect(content).toMatch(/^RAZORPAY_KEY_ID=/m);
    expect(content).toMatch(/^RAZORPAY_KEY_SECRET=/m);
  });

  it("does not declare any later-phase Razorpay/session secret as a variable line", () => {
    // Mentioning a later-phase name in an explanatory comment is fine (and
    // present here, to tell the reader why it's absent); what must not
    // happen is actually declaring it as a `NAME=` variable line yet.
    // RAZORPAY_KEY_SECRET is intentionally NOT in this list any more: it
    // is Phase 2A scope (Razorpay Test Configuration, this phase) and is
    // now legitimately declared above.
    expect(content).not.toMatch(/^RAZORPAY_WEBHOOK_SECRET=/m);
    expect(content).not.toMatch(/^PAYCHAOS_ACCESS_TOKEN=/m);
    expect(content).not.toMatch(/^PAYCHAOS_SESSION_SECRET=/m);
  });

  it("the Razorpay Key ID placeholder uses the Test Mode prefix, never rzp_live_", () => {
    // A `# ...` comment line is allowed to mention "rzp_live_" in prose to
    // explain why it is rejected (see the Razorpay section header comment
    // above) — what must never happen is the actual `RAZORPAY_KEY_ID=`
    // value line itself using that prefix.
    expect(content).toMatch(/^RAZORPAY_KEY_ID=rzp_test_/m);
    expect(content).not.toMatch(/^RAZORPAY_KEY_ID=rzp_live_/m);
  });

  it("RAZORPAY_KEY_SECRET is never declared with a NEXT_PUBLIC_ prefix", () => {
    expect(content).not.toMatch(/^NEXT_PUBLIC_RAZORPAY_KEY_SECRET=/m);
  });

  it("contains no JWT-shaped value (real Supabase anon/service keys are JWTs)", () => {
    // Real Supabase anon/service-role keys are JWTs and start with "eyJ".
    // A committed placeholder must never contain a real-looking token.
    expect(content).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
  });

  it("does not point at a real-looking non-placeholder Supabase project URL", () => {
    expect(content).not.toMatch(
      /https:\/\/(?!your-project)[a-z0-9]+\.supabase\.co/,
    );
  });
});

describe("J: real environment files remain git-ignored", () => {
  function isGitIgnored(relativePath: string): boolean {
    try {
      // Exit code 0 = ignored, non-zero = not ignored (git check-ignore -q).
      execFileSync("git", ["check-ignore", "-q", relativePath], {
        cwd: repoRoot,
      });
      return true;
    } catch {
      return false;
    }
  }

  it(".env.local is git-ignored", () => {
    expect(isGitIgnored(".env.local")).toBe(true);
  });

  it(".env (no suffix) is git-ignored", () => {
    expect(isGitIgnored(".env")).toBe(true);
  });

  it(".env.production.local is git-ignored", () => {
    expect(isGitIgnored(".env.production.local")).toBe(true);
  });

  it(".env.example is NOT git-ignored (it must stay committed)", () => {
    expect(isGitIgnored(".env.example")).toBe(false);
  });
});
