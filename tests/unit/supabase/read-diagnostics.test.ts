import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { sanitizeDiagnosticText } =
  await import("@/lib/supabase/read-diagnostics");

/**
 * Phase 5 — sanitized Supabase read diagnostics.
 *
 * WHY THIS FILE EXISTS. A deployed Preview renders the safe error boundary on
 * every page that reads persisted evidence, and the repository discarded the
 * Supabase error without logging it — so the deployment could not say WHY. The
 * fix logs the failure category; these tests are what make that logging safe
 * to ship.
 *
 * The hazard is specific: `logEvent` redacts fields whose NAME looks
 * sensitive, which is the right default and the wrong protection here. A
 * credential arriving inside `error.message` would pass straight through a
 * field innocently called `message`. So the sanitizer is value-driven, and
 * the tests below attack it with the shapes that actually matter.
 */

describe("read diagnostics — a credential can never reach a log line", () => {
  it("1: a JWT anywhere in the text is redacted", () => {
    // A Supabase service-role key IS a JWT. This is the shape that matters.
    const jwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.s1gn4tur3v4lu3";
    const out = sanitizeDiagnosticText(`JWT rejected: ${jwt} for role`);

    expect(out).not.toBeNull();
    expect(out).not.toContain("eyJ");
    expect(out).not.toContain("service_role");
    expect(out).toContain("[REDACTED]");
    // The surrounding, genuinely useful words survive.
    expect(out).toContain("JWT rejected");
  });

  it("2: a Razorpay secret-shaped identifier is redacted", () => {
    for (const key of ["rzp_live_ABC123def456", "rzp_test_XYZ789ghi012"]) {
      const out = sanitizeDiagnosticText(`key ${key} refused`);
      expect(out, key).not.toContain(key);
      expect(out, key).toContain("[REDACTED]");
    }
  });

  it("3: any long opaque token is redacted, even an unfamiliar shape", () => {
    // Defence in depth: catches a token nobody has thought of yet.
    const opaque = "a".repeat(48);
    const out = sanitizeDiagnosticText(`token=${opaque}`);
    expect(out).not.toContain(opaque);
    expect(out).toContain("[REDACTED]");
  });

  it("4: ordinary Postgres diagnostics survive intact", () => {
    // Over-redacting would defeat the purpose: these are the exact strings
    // that will name the deployment failure.
    for (const text of [
      "permission denied for table orders",
      'relation "public.orders" does not exist',
      "JWSError JWSInvalidSignature",
      "new row violates row-level security policy",
    ]) {
      expect(sanitizeDiagnosticText(text), text).toBe(text);
    }
  });

  it("5: a non-string is dropped rather than coerced", () => {
    // Coercing an object would risk stringifying something unexamined.
    for (const value of [undefined, null, 42, {}, [], { key: "secret" }]) {
      expect(sanitizeDiagnosticText(value), String(value)).toBeNull();
    }
  });

  it("6: output is bounded, so a pathological message cannot flood the log", () => {
    // Uses a repeating word so the long-token rule does not fire instead.
    const long = "permission ".repeat(200);
    const out = sanitizeDiagnosticText(long);
    expect(out).not.toBeNull();
    expect((out as string).length).toBeLessThanOrEqual(301);
  });
});

describe("read diagnostics — the module cannot reach a credential", () => {
  /**
   * Comment-stripped on purpose: the property below is about what the CODE
   * can reach. The module's own documentation names `headers` and `apikey`
   * precisely to say it never touches them, and prose explaining a hazard
   * must never fail a check about behaviour — otherwise the incentive is to
   * document the danger less clearly.
   */
  const SOURCE = readFileSync(
    join(process.cwd(), "lib", "supabase", "read-diagnostics.ts"),
    "utf8",
  )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");

  it("7: it reads no environment, client, header or request", () => {
    // There must be no code path by which a credential is picked up
    // incidentally — the safest guarantee is that none is reachable.
    for (const forbidden of [
      "process.env",
      "getServerEnv",
      "getClientEnv",
      "getSupabaseServerClient",
      "headers",
      "Authorization",
      "apikey",
      "cookie",
    ]) {
      expect(SOURCE, forbidden).not.toContain(forbidden);
    }
  });

  it("8: it never serializes the error wholesale", () => {
    // A closed field list is what keeps an unexamined property out of the log.
    for (const forbidden of [
      "JSON.stringify",
      "Object.entries",
      "Object.keys",
      "...error",
    ]) {
      expect(SOURCE, forbidden).not.toContain(forbidden);
    }
  });

  it("9: it is server-only", () => {
    expect(SOURCE).toContain('import "server-only"');
  });
});

describe("read diagnostics — behaviour is unchanged", () => {
  const REPO = readFileSync(
    join(process.cwd(), "lib", "demo-merchant", "repository.ts"),
    "utf8",
  );

  it("10: every instrumented site still throws what it threw before", () => {
    // The log line is added BEFORE the throw. If logging ever replaced a
    // throw, a read failure would silently return empty data and the page
    // would render as though the merchant genuinely had no orders — far
    // worse than an error boundary.
    const logCalls = [...REPO.matchAll(/logSupabaseReadFailure\(/g)];
    expect(logCalls.length).toBeGreaterThanOrEqual(9);

    for (const match of REPO.matchAll(
      /logSupabaseReadFailure\([\s\S]{0,200}/g,
    )) {
      expect(
        match[0].includes("throw new DemoMerchantRepositoryError"),
        "a log must be followed by the original throw",
      ).toBe(true);
    }
  });

  it("11: the read path used by /demo-merchant is fully instrumented", () => {
    // These five reads are what loading the page actually performs.
    for (const fn of [
      "listRecentOrders",
      "countFulfilmentsForOrderIds",
      "listLatestPaymentAttemptsForOrderIds",
      "listLatestPaymentsForAttemptIds",
    ]) {
      const start = REPO.indexOf(`export async function ${fn}`);
      expect(start, fn).toBeGreaterThan(-1);
      const next = REPO.indexOf("export async function", start + 10);
      const body = REPO.slice(start, next === -1 ? undefined : next);
      expect(body, `${fn} must log its failure`).toContain(
        "logSupabaseReadFailure",
      );
    }

    // The fifth lives in the webhook repository.
    const webhooks = readFileSync(
      join(process.cwd(), "lib", "webhooks", "repository.ts"),
      "utf8",
    );
    expect(webhooks).toContain("logSupabaseReadFailure");
  });
});
