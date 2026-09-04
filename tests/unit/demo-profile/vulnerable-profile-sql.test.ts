import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Phase 5 — the controlled C01 vulnerable Demo Merchant profile, at the SQL
 * layer.
 *
 * WHY THIS FILE EXISTS. The vulnerable behaviour lives inside a PostgreSQL
 * function, which is the only place it CAN live if it is to be authoritative:
 * a check in TypeScript could be bypassed by any other caller of the same
 * RPC. That makes the SQL the security boundary, so the SQL is what these
 * tests interrogate.
 *
 * The properties below are the ones whose absence would be dangerous rather
 * than merely broken: the vulnerable key must be unreachable from a real
 * provider delivery, unreachable from C03/C07/C11, unreachable without an
 * explicit operator opt-in, and unable to survive a Demo Reset.
 *
 * EVERY ASSERTION RUNS AGAINST COMMENT-STRIPPED SQL. The migration documents
 * its own hazards in detail, and prose that explains a danger must never
 * satisfy a check about behaviour — otherwise the incentive is to document
 * the danger less clearly.
 */

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, "supabase", "migrations");
const MIGRATION_FILE =
  "20260907000000_phase5_c01_controlled_vulnerable_profile.sql";

/** SQL with every `--` comment line removed. */
function executableSql(file: string): string {
  return readFileSync(join(MIGRATIONS, file), "utf8")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
}

const RAW = readFileSync(join(MIGRATIONS, MIGRATION_FILE), "utf8");
const SQL = executableSql(MIGRATION_FILE);

/** The body of one `create ... function` block, comments stripped. */
function functionBody(sql: string, name: string): string {
  const start = sql.indexOf(`function public.${name}`);
  expect(start, `${name} must be defined`).toBeGreaterThan(-1);
  const end = sql.indexOf("\n$$;", start);
  expect(end, `${name} must be terminated`).toBeGreaterThan(start);
  return sql.slice(start, end);
}

const PROCESS_FN = functionBody(SQL, "process_webhook_payment_event");
const RESET_FN = functionBody(SQL, "reset_paychaos_demo_runtime");

/** The guarded vulnerable block, from the key assignment to the insert. */
const VULNERABLE_BLOCK = (() => {
  const start = PROCESS_FN.indexOf(
    "if v_attempt.source_kind = 'PAYCHAOS_REPLAY'",
  );
  expect(start, "the guarded vulnerable block must exist").toBeGreaterThan(-1);
  const end = PROCESS_FN.indexOf("insert into public.fulfilments", start);
  expect(end).toBeGreaterThan(start);
  return PROCESS_FN.slice(start, end);
})();

describe("vulnerable profile — the storage is a safe-by-default singleton", () => {
  it("1: the column defaults to SAFE", () => {
    // A fresh deployment must never start vulnerable. This is the single
    // most important default in the migration.
    expect(SQL).toContain(
      "c01_idempotency_profile text not null default 'SAFE'",
    );
  });

  it("2: only the two approved values are accepted", () => {
    // A CHECK, not application validation: a value outside the approved two
    // must be impossible to persist by any route, including psql.
    expect(SQL).toMatch(
      /check\s*\(\s*c01_idempotency_profile in \('SAFE', 'VULNERABLE_IDEMPOTENCY'\)\s*\)/,
    );
  });

  it("3: a second profile row is structurally impossible", () => {
    // Two rows would make "the current profile" ambiguous, and an ambiguous
    // security-relevant flag is a bug waiting to be exploited by whichever
    // row happens to be read first.
    expect(SQL).toContain("id boolean primary key");
    expect(SQL).toMatch(/check\s*\(id = true\)/);
  });

  it("4: the seeded row is SAFE and never overwrites an existing choice", () => {
    expect(SQL).toMatch(
      /insert into public\.demo_merchant_profile[\s\S]{0,120}'SAFE'/,
    );
    expect(SQL).toContain("on conflict (id) do nothing");
  });

  it("5: RLS is enabled, so a browser cannot read or write it directly", () => {
    expect(SQL).toContain(
      "alter table public.demo_merchant_profile enable row level security",
    );
    // No policy is granted to anon/authenticated anywhere in the migration.
    expect(SQL).not.toContain("create policy");
  });

  it("5b: explicit privileges follow the repository convention", () => {
    // ADDED AFTER ARCHITECT REVIEW CAUGHT THIS MISSING. The first version of
    // this migration enabled RLS and stopped there. RLS with no policy does
    // deny anon/authenticated every row, so it was not an exposure — but it
    // broke the convention every other table follows (see chaos_runs,
    // findings), and it left service_role's access depending on whatever
    // default privileges the project happens to carry. On a project with
    // restricted defaults the feature would simply have failed closed with
    // PROFILE_NOT_PERMITTED, which is a P0 capability gambling on an
    // assumption nobody had checked.
    expect(SQL).toContain(
      "revoke all privileges on table public.demo_merchant_profile from anon, authenticated",
    );
    expect(SQL).toContain(
      "grant select, update on public.demo_merchant_profile to service_role",
    );

    // Deliberately narrower than the runtime tables: the row is seeded by
    // this migration and RESTORED (never deleted) by the reset, so the server
    // needs neither INSERT nor DELETE. Granting them would be privilege the
    // feature cannot justify.
    expect(SQL).not.toMatch(
      /grant[^;]*\b(insert|delete)\b[^;]*demo_merchant_profile/,
    );
  });

  it("5c: every other runtime table still carries the same convention", () => {
    // Guards against this migration having quietly relaxed a neighbour.
    const foundation = executableSql("20260829000000_phase3b_chaos_runs.sql");
    expect(foundation).toContain(
      "revoke all privileges on table public.chaos_runs from anon, authenticated",
    );
  });
});

describe("vulnerable profile — the processor is Phase 3C plus additions only", () => {
  /**
   * THE STRONGEST GUARANTEE IN THIS FILE, and the one the architect review
   * asked for by name: outside the guarded block, is the merchant processor
   * still the function Phase 3C approved?
   *
   * Answered by diffing the two executable bodies line by line rather than by
   * spot-checking statements. A spot check can only find what its author
   * thought to look for; this fails if ANY Phase 3C line was removed or
   * altered, including ones nobody anticipated.
   */
  function executableLines(file: string, name: string): string[] {
    const sql = readFileSync(join(MIGRATIONS, file), "utf8");
    const start = sql.indexOf(`create or replace function public.${name}`);
    expect(start, `${name} in ${file}`).toBeGreaterThan(-1);
    const end = sql.indexOf("\n$$;", start);
    expect(end).toBeGreaterThan(start);
    return (
      sql
        .slice(start, end)
        .split("\n")
        // Line endings are normalized before comparing. Git converts these
        // files to CRLF in the working copy on Windows while others stay LF,
        // so a raw split leaves a stray \r on some lines and every comparison
        // below silently fails — the two bodies came out fully disjoint,
        // which is a checkout artefact and says nothing about the SQL.
        .map((line) => line.replace(/\r$/, ""))
        .filter((line) => !line.trimStart().startsWith("--"))
    );
  }

  const PHASE3C_LINES = executableLines(
    "20260830000000_phase3c_controlled_replay.sql",
    "process_webhook_payment_event",
  );
  const PHASE5_LINES = executableLines(
    MIGRATION_FILE,
    "process_webhook_payment_event",
  );

  it("25: every Phase 3C line survives, in its original order", () => {
    // Subsequence check: Phase 3C's lines must all appear in Phase 5's body,
    // in the same order. Removing or editing any one of them fails here.
    let cursor = 0;
    const missing: string[] = [];
    for (const line of PHASE3C_LINES) {
      const at = PHASE5_LINES.indexOf(line, cursor);
      if (at === -1) missing.push(line);
      else cursor = at + 1;
    }

    expect(
      missing,
      `Phase 3C lines removed or altered: ${missing.slice(0, 5).join(" | ")}`,
    ).toEqual([]);
  });

  it("26: the only additions are the two declarations and the guarded block", () => {
    const added = PHASE5_LINES.filter(
      (line) => line.trim().length > 0 && !PHASE3C_LINES.includes(line),
    );

    // Every added line belongs to the profile lookup or the guard.
    for (const line of added) {
      expect(
        /v_replay_scenario_id|v_c01_profile|PAYCHAOS_REPLAY|chaos_run_id|chaos_runs|demo_merchant_profile|VULNERABLE_IDEMPOTENCY|ATTEMPT:|p\.id = true|end if;|v_idempotency_key := 'FULFIL_ORDER:'|^\s*$/.test(
          line,
        ),
        `unexpected added line: ${line}`,
      ).toBe(true);
    }

    // And the addition is small: a large diff would mean something else moved.
    expect(added.length).toBeLessThanOrEqual(25);
  });

  it("27: no Phase 3C line count shrank — the body only grew", () => {
    expect(PHASE5_LINES.length).toBeGreaterThan(PHASE3C_LINES.length);
  });
});

describe("vulnerable profile — four independent conditions gate the defect", () => {
  it("6: it requires PAYCHAOS_REPLAY provenance", () => {
    // THE ISOLATION THAT MATTERS MOST. A genuine provider delivery is
    // REAL_RAZORPAY_WEBHOOK, so ordinary webhook processing cannot reach the
    // vulnerable key by any path.
    expect(VULNERABLE_BLOCK).toContain(
      "v_attempt.source_kind = 'PAYCHAOS_REPLAY'",
    );
  });

  it("7: it requires the attempt to belong to a chaos run", () => {
    expect(VULNERABLE_BLOCK).toContain("v_attempt.chaos_run_id is not null");
  });

  it("8: it requires the run to be scenario C01", () => {
    // C03, C07 and C11 must be unaffected, and the scenario is read from the
    // persisted chaos run rather than from anything a caller supplies.
    expect(VULNERABLE_BLOCK).toContain("v_replay_scenario_id = 'C01'");
    expect(VULNERABLE_BLOCK).toMatch(
      /select cr\.scenario_id[\s\S]{0,120}from public\.chaos_runs cr/,
    );
  });

  it("9: it requires an explicitly persisted VULNERABLE_IDEMPOTENCY", () => {
    expect(VULNERABLE_BLOCK).toContain(
      "v_c01_profile = 'VULNERABLE_IDEMPOTENCY'",
    );
    expect(VULNERABLE_BLOCK).toMatch(/from public\.demo_merchant_profile/);
  });

  it("10: all four conditions are ANDed, never ORed", () => {
    // An `or` anywhere in this block would collapse the isolation to a
    // single condition and is exactly the mistake worth failing loudly on.
    expect(VULNERABLE_BLOCK).not.toMatch(/\bor\b/);
    expect(VULNERABLE_BLOCK).toContain(
      "and v_attempt.chaos_run_id is not null",
    );
  });

  it("11: the vulnerable key is the documented one — it includes the attempt id", () => {
    // docs/CHAOS_SCENARIOS.md Section 43 prescribes exactly this defect:
    // "idempotency key incorrectly includes processing attempt ID".
    expect(VULNERABLE_BLOCK).toMatch(
      /v_idempotency_key := 'FULFIL_ORDER:' \|\| v_order\.id::text[\s\S]{0,80}p_processing_attempt_id/,
    );
  });
});

describe("vulnerable profile — the safe path remains the default behaviour", () => {
  it("12: the stable semantic key is assigned before any profile is read", () => {
    // The safe key is unconditional; the vulnerable block can only ever
    // REPLACE it. So a failure to read the profile, a missing row, or any
    // unexpected value leaves the merchant safe.
    const safeAt = PROCESS_FN.indexOf(
      "v_idempotency_key := 'FULFIL_ORDER:' || v_order.id::text;",
    );
    const guardAt = PROCESS_FN.indexOf(
      "if v_attempt.source_kind = 'PAYCHAOS_REPLAY'",
    );
    expect(safeAt).toBeGreaterThan(-1);
    expect(guardAt).toBeGreaterThan(safeAt);
  });

  it("13: nothing else in the function reads the profile table", () => {
    // One read site, inside the guard. A second would be a second chance to
    // get the conditions wrong.
    const reads = [...PROCESS_FN.matchAll(/demo_merchant_profile/g)];
    expect(reads).toHaveLength(1);
  });
});

describe("vulnerable profile — no protection is weakened to achieve it", () => {
  it("14: no constraint, trigger or index is disabled anywhere", () => {
    // docs/CHAOS_SCENARIOS.md Section 43 names this as the BAD example.
    // The unique index must stay enabled: the demonstration is that a bad
    // key defeats a working constraint, not that the constraint was removed.
    for (const forbidden of [
      "drop constraint",
      "disable trigger",
      "drop index",
      "set constraints",
      "deferrable",
      "alter table public.fulfilments",
    ]) {
      expect(SQL.toLowerCase(), forbidden).not.toContain(forbidden);
    }
  });

  it("15: the signature admission gate is still present and still strict", () => {
    // CORRECTED after this assertion was written backwards. The first version
    // demanded that `signature_verified` not appear in the migration at all,
    // which failed — because the function READS it, in the admission gate
    // that refuses to process anything whose canonical webhook event was not
    // a signature-verified real Razorpay delivery.
    //
    // Absence was never the property worth protecting; that gate surviving
    // the edit is. Asserting the gate's exact shape is the stronger test, and
    // it would fail if a future change relaxed `is not true` to a null-
    // tolerant comparison or dropped the source-kind half.
    expect(PROCESS_FN).toContain(
      "if v_webhook.source_kind <> 'REAL_RAZORPAY_WEBHOOK' or v_webhook.signature_verified is not true then",
    );

    // Byte-for-byte the Phase 3C gate: the migration inherits it rather than
    // restating it, so it cannot drift.
    const PHASE3C = executableSql(
      "20260830000000_phase3c_controlled_replay.sql",
    );
    expect(PHASE3C).toContain(
      "if v_webhook.source_kind <> 'REAL_RAZORPAY_WEBHOOK' or v_webhook.signature_verified is not true then",
    );

    // And no secret material is introduced by this migration.
    for (const forbidden of ["webhook_secret", "verify_signature", "hmac"]) {
      expect(SQL.toLowerCase(), forbidden).not.toContain(forbidden);
    }
  });

  it("16: the function's permission surface is not widened", () => {
    // Still service_role only, still revoked from the browser-facing roles.
    expect(SQL).toContain(
      "revoke all on function public.process_webhook_payment_event(uuid) from anon, authenticated",
    );
    expect(SQL).toContain(
      "grant execute on function public.process_webhook_payment_event(uuid) to service_role",
    );
    expect(SQL).not.toMatch(/grant[\s\S]{0,80}to (anon|authenticated|public)/);
  });

  it("17: the migration contains no credential-shaped literal", () => {
    // ENV-004: a migration is committed to Git and must carry no secret.
    expect(RAW).not.toMatch(/rzp_(test|live)_[A-Za-z0-9]{6,}/);
    expect(RAW).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}\./);
  });
});

describe("vulnerable profile — a Demo Reset always restores SAFE", () => {
  it("18: the reset function sets the profile back to SAFE", () => {
    expect(RESET_FN).toMatch(
      /update public\.demo_merchant_profile[\s\S]{0,160}c01_idempotency_profile = 'SAFE'/,
    );
  });

  it("19: it restores rather than deletes, so the singleton always exists", () => {
    // Deleting the row would leave the profile absent, and an absent profile
    // is not the same as a safe one — every later read would fail.
    expect(RESET_FN).not.toMatch(/delete from public\.demo_merchant_profile/);
  });

  it("20: the restore happens inside the same transaction as the deletes", () => {
    // A plpgsql function body is one transaction, so this is really an
    // assertion that the restore lives INSIDE the function rather than being
    // a second call the route could skip or fail to make.
    expect(RESET_FN).toContain("demo_merchant_profile");
    expect(RESET_FN).toContain("delete from public.orders");
  });

  it("21: every original reset target is still cleared", () => {
    // The reset gained a statement; it must not have lost one.
    for (const table of [
      "fulfilments",
      "regression_runs",
      "event_processing_attempts",
      "findings",
      "invariant_results",
      "chaos_runs",
      "webhook_events",
      "payments",
      "payment_attempts",
      "orders",
    ]) {
      expect(RESET_FN, table).toContain(
        `delete from public.${table} where id is not null`,
      );
    }
  });

  it("22: the safeupdate protection is still satisfied by every delete", () => {
    // Supabase's safeupdate refuses an unqualified DELETE in the API role
    // context — the confirmed production failure (SQLSTATE 21000) this
    // predicate exists to avoid.
    const deletes = [...RESET_FN.matchAll(/delete from public\.\w+[^;]*/g)];
    expect(deletes.length).toBe(10);
    for (const match of deletes) {
      expect(match[0], match[0]).toContain("where id is not null");
    }
  });
});

describe("vulnerable profile — it is the newest migration and stands alone", () => {
  it("23: no earlier migration mentions the profile table", () => {
    // Proves the capability arrived in exactly one reviewable place.
    const others = readdirSync(MIGRATIONS).filter(
      (f) => f.endsWith(".sql") && f !== MIGRATION_FILE,
    );
    expect(others.length).toBeGreaterThan(10);
    for (const file of others) {
      expect(
        executableSql(file),
        `${file} must not reference the profile`,
      ).not.toContain("demo_merchant_profile");
    }
  });

  it("24: it sorts last, so it is applied after the reset it replaces", () => {
    const all = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    expect(all[all.length - 1]).toBe(MIGRATION_FILE);
  });
});
