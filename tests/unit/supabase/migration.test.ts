import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Phase 1C-A — migration/configuration tests.
 *
 * IMPORTANT: these are structural tests that parse the migration SQL file
 * as plain text and assert against its shape. They are NOT real
 * database/integration tests: no Supabase project is created, no
 * connection is opened, and this migration has NOT been applied to any
 * remote database as part of writing or testing this file. Real DB/RLS
 * integration tests happen after a developer manually applies this
 * migration — that is explicitly out of scope for Phase 1C-A.
 */

const repoRoot = path.resolve(import.meta.dirname, "../../../");
const migrationsDir = path.join(repoRoot, "supabase", "migrations");

function readMigrationFiles(): { name: string; sql: string }[] {
  if (!fs.existsSync(migrationsDir)) return [];
  return fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((name) => ({
      name,
      sql: fs.readFileSync(path.join(migrationsDir, name), "utf-8"),
    }));
}

const migrations = readMigrationFiles();
const combinedSql = migrations.map((m) => m.sql).join("\n");

function extractCreateTableNames(sql: string): string[] {
  const matches = [
    ...sql.matchAll(
      /create\s+table\s+(?:if not exists\s+)?(?:public\.)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?/gi,
    ),
  ];
  return matches.map((m) => m[1]!.toLowerCase());
}

describe("Phase 1C-A migration file exists (#4)", () => {
  it("supabase/migrations/ contains at least one .sql migration file", () => {
    expect(migrations.length).toBeGreaterThan(0);
  });

  it("the migration directory is the documented location (docs/DATABASE.md Section 43)", () => {
    expect(fs.existsSync(migrationsDir)).toBe(true);
  });
});

describe("Migration set creates exactly the approved Phase 1 + Phase 2B + Phase 2C + Phase 2D + Phase 2E + Phase 3B tables (#5, #6, #7)", () => {
  const tableNames = extractCreateTableNames(combinedSql);

  // Phase 1 created orders/payment_attempts/fulfilments (#5-#7). Phase 2B
  // was purely additive-columns (no new CREATE TABLE). Phase 2C legitimately
  // adds `payments` via its own additive migration
  // (supabase/migrations/20260825000000_phase2c_payments.sql,
  // docs/DATABASE.md Section 11). Phase 2D legitimately adds
  // `webhook_events` via its own additive migration
  // (supabase/migrations/20260826000000_phase2d_webhook_events.sql,
  // docs/DATABASE.md Section 13). Phase 2E legitimately adds
  // `event_processing_attempts` (Phase 2 subset only) via its own additive
  // migration (supabase/migrations/20260827000000_phase2e_webhook_dedup.sql,
  // docs/DATABASE.md Section 14). Phase 3B legitimately adds `chaos_runs` via
  // its own additive migration
  // (supabase/migrations/20260829000000_phase3b_chaos_runs.sql,
  // docs/DATABASE.md Section 15) — this is the current approved cumulative
  // table set, not a Phase 1 boundary violation.
  it("creates orders, payment_attempts, payments, fulfilments, webhook_events, event_processing_attempts, chaos_runs, invariant_results, findings and nothing else", () => {
    expect([...tableNames].sort()).toEqual([
      "chaos_runs",
      "event_processing_attempts",
      "findings",
      "fulfilments",
      "invariant_results",
      "orders",
      "payment_attempts",
      "payments",
      "webhook_events",
    ]);
  });

  // `invariant_results` left this list in Phase 3F-A and `findings` left it
  // in Phase 3G: both are now exact approved tables
  // (supabase/migrations/20260902000000_phase3f_invariant_results.sql and
  // 20260903000000_phase3g_findings.sql, docs/DATABASE.md Sections 16 and 17)
  // and both are asserted positively above. `findings` is NOT a Phase 4
  // table — docs/DATABASE.md Section 17 "Phase Ownership" and
  // docs/PHASE_PLAN.md Section 3G both place its CREATE in Phase 3, with
  // Phase 4 only populating its diagnosis/recommendation columns. Every
  // genuine Phase 4 table remains forbidden.
  it("does not create any other Phase 4+ table", () => {
    const forbidden = [
      "regression_runs",
      "reliability_score_snapshots",
      "merchants",
      "finding_evidence",
      "evidence_items",
    ];
    for (const name of forbidden) {
      expect(tableNames).not.toContain(name);
    }
  });

  // The approved P0 schema is exactly ten tables (docs/DATABASE.md Section
  // "Tables Requiring RLS"). Nine exist after Phase 3G; `regression_runs` is
  // the only one still outstanding, and it belongs to Phase 4.
  it("the cumulative table count is exactly nine after Phase 3G", () => {
    expect(tableNames).toHaveLength(9);
  });
});

describe("Phase 2E — event_processing_attempts is scoped to the Phase 2 column subset only (#16)", () => {
  const match = combinedSql.match(
    /create table\s+public\.event_processing_attempts\s*\(([\s\S]*?)\n\);/i,
  );
  const attemptsBlock = match ? match[1]! : "";

  it("found the event_processing_attempts table definition", () => {
    expect(attemptsBlock.length).toBeGreaterThan(0);
  });

  it("does not contain any Phase 3-only column (chaos_run_id/fault_action/state_before/state_after)", () => {
    for (const forbidden of [
      "chaos_run_id",
      "fault_action",
      "state_before",
      "state_after",
    ]) {
      expect(attemptsBlock).not.toMatch(new RegExp(`\\b${forbidden}\\b`, "i"));
    }
  });

  it("source_kind is CHECK-fixed to exactly REAL_RAZORPAY_WEBHOOK for Phase 2", () => {
    expect(combinedSql).toMatch(/source_kind\s*=\s*'REAL_RAZORPAY_WEBHOOK'/);
  });

  it("status CHECK includes the full approved lifecycle even though Phase 2E only ever inserts a subset", () => {
    expect(combinedSql).toMatch(
      /status in \(\s*'PENDING',\s*'HELD',\s*'PROCESSING',\s*'SUCCEEDED',\s*'FAILED',\s*'SKIPPED_DUPLICATE'\s*\)/,
    );
  });
});

describe("Phase 1C-A fulfilments excludes Phase 2 columns (#8, #9)", () => {
  const match = combinedSql.match(
    /create table\s+public\.fulfilments\s*\(([\s\S]*?)\n\);/i,
  );
  const fulfilmentsBlock = match ? match[1]! : "";

  it("found the fulfilments table definition", () => {
    expect(fulfilmentsBlock.length).toBeGreaterThan(0);
  });

  it("does not contain a payment_id column", () => {
    expect(fulfilmentsBlock).not.toMatch(/\bpayment_id\b/i);
  });

  it("does not contain a trigger_processing_attempt_id column", () => {
    expect(fulfilmentsBlock).not.toMatch(/\btrigger_processing_attempt_id\b/i);
  });
});

describe("Phase 1C-A required CHECK constraints (#10)", () => {
  it("orders.amount_subunits > 0", () => {
    expect(combinedSql).toMatch(/amount_subunits\s*>\s*0/);
  });

  it("currency format CHECK exists (uppercase 3-letter)", () => {
    // Plain substring check (not a regex) to avoid escaping the literal
    // regex-metacharacter-heavy Postgres pattern '^[A-Z]{3}$' twice over.
    expect(combinedSql).toContain("currency ~ '^[A-Z]{3}$'");
  });

  it("orders.payment_status enum CHECK", () => {
    expect(combinedSql).toMatch(
      /payment_status in \(\s*'UNPAID',\s*'PENDING',\s*'FAILED_OBSERVED',\s*'PAID'\s*\)/,
    );
  });

  it("orders.business_status enum CHECK", () => {
    expect(combinedSql).toMatch(
      /business_status in \(\s*'OPEN',\s*'FULFILLED'\s*\)/,
    );
  });

  it("payment_attempts.status enum CHECK matches the approved internal lifecycle", () => {
    expect(combinedSql).toMatch(
      /status in \(\s*'CREATED',\s*'ORDER_CREATED',\s*'CHECKOUT_IN_PROGRESS',\s*'FAILED_OBSERVED',\s*'CAPTURED'\s*\)/,
    );
  });

  it("payment_attempts.attempt_no > 0", () => {
    expect(combinedSql).toMatch(/attempt_no\s*>\s*0/);
  });

  it("fulfilments.effect_type is fixed to FULFIL_ORDER", () => {
    expect(combinedSql).toMatch(/effect_type = 'FULFIL_ORDER'/);
  });
});

describe("Phase 1C-A required UNIQUE constraints / indexes (#11)", () => {
  it("payment_attempts UNIQUE(order_id, attempt_no)", () => {
    expect(combinedSql).toMatch(/unique \(order_id, attempt_no\)/i);
  });

  it("payment_attempts UNIQUE(razorpay_receipt)", () => {
    expect(combinedSql).toMatch(/unique \(razorpay_receipt\)/i);
  });

  it("fulfilments UNIQUE(idempotency_key)", () => {
    expect(combinedSql).toMatch(/unique \(idempotency_key\)/i);
  });

  it("orders indexes on created_at, payment_status, business_status", () => {
    expect(combinedSql).toMatch(/create index orders_created_at_idx/i);
    expect(combinedSql).toMatch(/create index orders_payment_status_idx/i);
    expect(combinedSql).toMatch(/create index orders_business_status_idx/i);
  });

  it("payment_attempts indexes on order_id, status, created_at", () => {
    expect(combinedSql).toMatch(/create index payment_attempts_order_id_idx/i);
    expect(combinedSql).toMatch(/create index payment_attempts_status_idx/i);
    expect(combinedSql).toMatch(
      /create index payment_attempts_created_at_idx/i,
    );
  });

  it("fulfilments indexes on order_id, applied_at", () => {
    expect(combinedSql).toMatch(/create index fulfilments_order_id_idx/i);
    expect(combinedSql).toMatch(/create index fulfilments_applied_at_idx/i);
  });
});

describe("Phase 1C-A required foreign keys (#12)", () => {
  it("payment_attempts.order_id and fulfilments.order_id both reference orders(id)", () => {
    const occurrences = [
      ...combinedSql.matchAll(
        /order_id uuid not null references public\.orders \(id\)/gi,
      ),
    ];
    expect(occurrences.length).toBe(2);
  });

  it("uses conservative FK delete behavior (ON DELETE RESTRICT), no cascading deletes", () => {
    expect(combinedSql).toMatch(/on delete restrict/i);
    expect(combinedSql).not.toMatch(/on delete cascade/i);
  });
});

describe("Phase 1C-A/2C/2D/2E RLS is explicitly enabled on all 6 tables (#13)", () => {
  for (const table of [
    "orders",
    "payment_attempts",
    "payments",
    "fulfilments",
    "webhook_events",
    "event_processing_attempts",
  ]) {
    it(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY is present`, () => {
      const re = new RegExp(
        `alter table public\\.${table} enable row level security`,
        "i",
      );
      expect(combinedSql).toMatch(re);
    });
  }
});

describe("Phase 1C-A no permissive anon/authenticated policy (#14)", () => {
  it("contains no CREATE POLICY statement at all", () => {
    expect(combinedSql).not.toMatch(/create policy/i);
  });

  it("contains no GRANT to anon or authenticated", () => {
    expect(combinedSql).not.toMatch(/grant[^;]*\bto\s+anon\b/i);
    expect(combinedSql).not.toMatch(/grant[^;]*\bto\s+authenticated\b/i);
  });

  it("every GRANT targets only service_role", () => {
    const grantLines = combinedSql
      .split("\n")
      .filter((line) => /^\s*grant\s/i.test(line));
    expect(grantLines.length).toBeGreaterThan(0);
    for (const line of grantLines) {
      expect(line).toMatch(/to service_role/i);
    }
  });

  it("every TABLE GRANT targets only the 9 approved tables", () => {
    const tableGrantLines = combinedSql
      .split("\n")
      .filter((line) => /^\s*grant\s.*\bon\s+(?!function\b)/i.test(line));
    expect(tableGrantLines.length).toBeGreaterThan(0);
    for (const line of tableGrantLines) {
      expect(line).toMatch(
        /public\.(orders|payment_attempts|payments|fulfilments|webhook_events|event_processing_attempts|chaos_runs|invariant_results|findings)\b/i,
      );
    }
  });

  it("the record_webhook_duplicate_delivery function is explicitly revoked from public and granted execute only to service_role", () => {
    expect(combinedSql).toMatch(
      /revoke all on function public\.record_webhook_duplicate_delivery\(text\) from public;/i,
    );
    expect(combinedSql).toMatch(
      /grant execute on function public\.record_webhook_duplicate_delivery\(text\) to service_role;/i,
    );
    expect(combinedSql).not.toMatch(/grant execute[^;]*\bto\s+anon\b/i);
    expect(combinedSql).not.toMatch(
      /grant execute[^;]*\bto\s+authenticated\b/i,
    );
  });
});

describe("Phase 1C-A migration file contains no secrets (#15)", () => {
  it("contains no JWT-shaped value (real Supabase anon/service keys are JWTs)", () => {
    expect(combinedSql).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
  });

  it("does not reference known secret env var names as assigned values", () => {
    expect(combinedSql).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY\s*=\s*['"]/i);
    expect(combinedSql).not.toMatch(/RAZORPAY_KEY_SECRET/i);
    expect(combinedSql).not.toMatch(/RAZORPAY_WEBHOOK_SECRET/i);
  });

  it("does not reference a real-looking non-placeholder Supabase project URL", () => {
    expect(combinedSql).not.toMatch(
      /https:\/\/(?!your-project)[a-z0-9]+\.supabase\.co/,
    );
  });
});

describe("Phase 1C-A immutability note is present (fulfilments Phase 2 columns)", () => {
  it("the migration documents that payment_id/trigger_processing_attempt_id arrive via Phase 2 additive migrations", () => {
    expect(combinedSql.toLowerCase()).toContain("phase 2");
    expect(combinedSql).toMatch(/never|not.*rewritten|immutab/i);
  });
});

describe("Phase 1C-A correction — no unnecessary pgcrypto extension", () => {
  it("does not create/enable the pgcrypto extension", () => {
    expect(combinedSql).not.toMatch(/create extension[^;]*pgcrypto/i);
  });

  it("gen_random_uuid() remains the UUID default for all nine tables", () => {
    const occurrences = [
      ...combinedSql.matchAll(
        /id uuid primary key default gen_random_uuid\(\)/gi,
      ),
    ];
    expect(occurrences.length).toBe(9);
  });
});

describe("Phase 2F migration — fulfilments additive columns (2F structural #21-27)", () => {
  it("21: does not recreate the fulfilments table (no second CREATE TABLE fulfilments)", () => {
    const occurrences = [
      ...combinedSql.matchAll(/create\s+table\s+public\.fulfilments\s*\(/gi),
    ];
    expect(occurrences.length).toBe(1);
  });

  it("22/24: adds payment_id and trigger_processing_attempt_id via ALTER TABLE", () => {
    expect(combinedSql).toMatch(
      /alter table public\.fulfilments\s+add column payment_id uuid references public\.payments \(id\) on delete restrict/i,
    );
    expect(combinedSql).toMatch(
      /add column trigger_processing_attempt_id uuid references public\.event_processing_attempts \(id\) on delete restrict/i,
    );
  });

  it("22: payment_id is made NOT NULL", () => {
    expect(combinedSql).toMatch(
      /alter table public\.fulfilments\s+alter column payment_id set not null/i,
    );
  });

  it("23: payment_id FK targets payments(id) ON DELETE RESTRICT", () => {
    expect(combinedSql).toMatch(
      /payment_id uuid references public\.payments \(id\) on delete restrict/i,
    );
  });

  it("25: trigger_processing_attempt_id FK targets event_processing_attempts(id) ON DELETE RESTRICT, nullable", () => {
    expect(combinedSql).toMatch(
      /trigger_processing_attempt_id uuid references public\.event_processing_attempts \(id\) on delete restrict/i,
    );
    // Nullable: no "not null" is ever applied to this column anywhere.
    expect(combinedSql).not.toMatch(
      /alter column trigger_processing_attempt_id set not null/i,
    );
  });

  it("26: required indexes exist", () => {
    expect(combinedSql).toMatch(
      /create index fulfilments_payment_id_idx on public\.fulfilments \(payment_id\)/i,
    );
    expect(combinedSql).toMatch(
      /create index fulfilments_trigger_processing_attempt_id_idx on public\.fulfilments \(trigger_processing_attempt_id\)/i,
    );
  });

  it("27: UNIQUE(idempotency_key) is preserved (still present exactly once, from the original Phase 1 migration)", () => {
    const occurrences = [
      ...combinedSql.matchAll(/unique \(idempotency_key\)/gi),
    ];
    expect(occurrences.length).toBe(1);
  });

  it("28: does not edit the original Phase 1 fulfilments CREATE TABLE block (still excludes payment_id/trigger_processing_attempt_id)", () => {
    const match = combinedSql.match(
      /create table\s+public\.fulfilments\s*\(([\s\S]*?)\n\);/i,
    );
    expect(match).not.toBeNull();
    const fulfilmentsCreateBlock = match![1]!;
    expect(fulfilmentsCreateBlock).not.toMatch(/\bpayment_id\b/i);
    expect(fulfilmentsCreateBlock).not.toMatch(
      /\btrigger_processing_attempt_id\b/i,
    );
  });
});

describe("Phase 2F migration — no Phase 3+ schema added (2F structural #29)", () => {
  it("does not create chaos_runs, invariant_results, findings, or regression_runs", () => {
    const phase2fMigration = migrations.find((m) => m.name.includes("phase2f"));
    expect(phase2fMigration).toBeDefined();
    for (const forbidden of [
      "chaos_runs",
      "invariant_results",
      "findings",
      "regression_runs",
    ]) {
      expect(phase2fMigration!.sql).not.toMatch(
        new RegExp(`create table\\s+public\\.${forbidden}`, "i"),
      );
    }
  });

  it("does not add any Phase 3-only event_processing_attempts column (ALTER/ADD COLUMN usage, not mere doc-comment mentions)", () => {
    const phase2fMigration = migrations.find((m) => m.name.includes("phase2f"));
    expect(phase2fMigration).toBeDefined();
    for (const forbidden of [
      "chaos_run_id",
      "fault_action",
      "state_before",
      "state_after",
    ]) {
      expect(phase2fMigration!.sql).not.toMatch(
        new RegExp(`add column\\s+${forbidden}\\b`, "i"),
      );
      expect(phase2fMigration!.sql).not.toMatch(
        new RegExp(`v_${forbidden}\\b`, "i"),
      );
    }
  });

  it("total table set as of Phase 2F was exactly the 6 approved tables (no new CREATE TABLE in the Phase 2F migration) — scoped to migrations up to and including Phase 2F, not the current combined set, since this asserts a historical fact about that migration, not a fact that should require updating at every later phase", () => {
    const phase2fIndex = migrations.findIndex((m) =>
      m.name.includes("phase2f"),
    );
    expect(phase2fIndex).toBeGreaterThanOrEqual(0);
    const sqlUpToPhase2f = migrations
      .slice(0, phase2fIndex + 1)
      .map((m) => m.sql)
      .join("\n");
    const tableNames = extractCreateTableNames(sqlUpToPhase2f);
    expect([...tableNames].sort()).toEqual([
      "event_processing_attempts",
      "fulfilments",
      "orders",
      "payment_attempts",
      "payments",
      "webhook_events",
    ]);
  });
});

describe("Phase 2F migration — process_webhook_payment_event RPC security (2F structural #30-35)", () => {
  // Captures the parameter list (between the parens) separately from the
  // header (up to "as $$") and the body (between "as $$" and the closing
  // "$$;") — kept as three distinct regexes rather than one combined
  // capture, since the parameter list, RETURNS/LANGUAGE/SECURITY/
  // search_path declarations, and the plpgsql body are three genuinely
  // different spans of the function definition.
  const paramsMatch = combinedSql.match(
    /create function public\.process_webhook_payment_event\(([\s\S]*?)\)\s*\nreturns jsonb/i,
  );
  const headerMatch = combinedSql.match(
    /create function public\.process_webhook_payment_event\([\s\S]*?as \$\$/i,
  );
  const bodyMatch = combinedSql.match(
    /create function public\.process_webhook_payment_event\([\s\S]*?as \$\$([\s\S]*?)\n\$\$;/i,
  );

  it("the function definition was found", () => {
    expect(paramsMatch).not.toBeNull();
    expect(headerMatch).not.toBeNull();
    expect(bodyMatch).not.toBeNull();
  });

  const functionHeader = headerMatch ? headerMatch[0]! : "";
  const functionBody = bodyMatch ? bodyMatch[1]! : "";

  it("30: is SECURITY INVOKER, not SECURITY DEFINER", () => {
    expect(functionHeader).toMatch(/security invoker/i);
    expect(functionHeader).not.toMatch(/security definer/i);
  });

  it("31: search_path is explicitly pinned to public", () => {
    expect(functionHeader).toMatch(/set search_path = public/i);
  });

  it("32: PUBLIC execute is explicitly revoked", () => {
    expect(combinedSql).toMatch(
      /revoke all on function public\.process_webhook_payment_event\(uuid\) from public;/i,
    );
  });

  it("33: anon/authenticated are never granted execute", () => {
    expect(combinedSql).not.toMatch(
      /grant execute on function public\.process_webhook_payment_event[^;]*\bto\s+anon\b/i,
    );
    expect(combinedSql).not.toMatch(
      /grant execute on function public\.process_webhook_payment_event[^;]*\bto\s+authenticated\b/i,
    );
  });

  it("34: service_role is explicitly granted execute", () => {
    expect(combinedSql).toMatch(
      /grant execute on function public\.process_webhook_payment_event\(uuid\) to service_role;/i,
    );
  });

  it("35: no dynamic SQL (no EXECUTE statement, no format()/quote_ident() string-building)", () => {
    expect(functionBody).not.toMatch(/\bexecute\s+(format|'|")/i);
    expect(functionBody).not.toMatch(/\bformat\s*\(/i);
    expect(functionBody).not.toMatch(/\bquote_ident\s*\(/i);
  });

  it("the only function parameter is p_processing_attempt_id uuid (no arbitrary table/column/order/payment/amount/status input)", () => {
    expect(paramsMatch).not.toBeNull();
    const paramsBlock = paramsMatch![1]!.trim().replace(/,$/, "");
    expect(paramsBlock).toBe("p_processing_attempt_id uuid");
  });

  it("row-locks the target processing attempt with SELECT ... FOR UPDATE before deciding whether it may be processed", () => {
    expect(functionBody).toMatch(/select \* into v_attempt[\s\S]*?for update/i);
  });

  it("uses ON CONFLICT (not a bare SELECT-then-INSERT) for the fulfilments idempotency-key race boundary", () => {
    expect(functionBody).toMatch(/on conflict \(idempotency_key\) do update/i);
  });

  it("never regresses orders.payment_status away from PAID, or payment_attempts.status away from CAPTURED", () => {
    // The captured-state UPDATE statements are always guarded so a stale
    // event cannot regress a stronger already-committed state.
    expect(functionBody).toMatch(
      /payment_status = 'PAID'[\s\S]*?where id = v_order\.id\s+and payment_status <> 'PAID'/i,
    );
    expect(functionBody).toMatch(
      /status = 'CAPTURED'[\s\S]*?where id = v_payment_attempt\.id\s+and status <> 'CAPTURED'/i,
    );
  });

  it("never regresses webhook_events.processing_status away from PROCESSED", () => {
    expect(functionBody).toMatch(
      /processing_status = 'PROCESSED'[\s\S]*?where id = v_webhook\.id\s+and processing_status <> 'PROCESSED'/i,
    );
  });
});

describe("Phase 2F migration — 2026-08-29 architect review correction (Findings A-D)", () => {
  const bodyMatch = combinedSql.match(
    /create function public\.process_webhook_payment_event\([\s\S]*?as \$\$([\s\S]*?)\n\$\$;/i,
  );
  const functionBody = bodyMatch ? bodyMatch[1]! : "";

  it("found the function body", () => {
    expect(functionBody.length).toBeGreaterThan(0);
  });

  describe("Finding A — deterministic FOR UPDATE lock order on every shared mutable correlated row", () => {
    it("locks event_processing_attempts, webhook_events, payment_attempts, orders, and payments, each with its own FOR UPDATE", () => {
      const forUpdateCount = (functionBody.match(/for update/gi) ?? []).length;
      // At least: attempt, webhook, payment_attempt, order, and payment
      // (captured branch) — payment is locked again in the failed and
      // order.paid branches too, so this is a lower bound, not an exact
      // count.
      expect(forUpdateCount).toBeGreaterThanOrEqual(5);
    });

    it("locks v_attempt before v_webhook, v_webhook before v_payment_attempt, v_payment_attempt before v_order, and v_order before the first v_payment lock (fixed order, never reordered)", () => {
      const attemptLockIdx = functionBody.search(
        /into v_attempt[\s\S]*?for update/i,
      );
      const webhookLockIdx = functionBody.search(
        /into v_webhook from public\.webhook_events[\s\S]*?for update/i,
      );
      const paymentAttemptLockIdx = functionBody.search(
        /into v_payment_attempt from public\.payment_attempts[\s\S]*?for update/i,
      );
      const orderLockIdx = functionBody.search(
        /into v_order from public\.orders[\s\S]*?for update/i,
      );
      const firstPaymentLockIdx = functionBody.search(
        /into v_payment from public\.payments[\s\S]*?for update/i,
      );

      for (const idx of [
        attemptLockIdx,
        webhookLockIdx,
        paymentAttemptLockIdx,
        orderLockIdx,
        firstPaymentLockIdx,
      ]) {
        expect(idx).toBeGreaterThanOrEqual(0);
      }
      expect(attemptLockIdx).toBeLessThan(webhookLockIdx);
      expect(webhookLockIdx).toBeLessThan(paymentAttemptLockIdx);
      expect(paymentAttemptLockIdx).toBeLessThan(orderLockIdx);
      expect(orderLockIdx).toBeLessThan(firstPaymentLockIdx);
    });

    it("computes v_already_captured (the payment.failed capture-precedence decision) AFTER locking v_payment with FOR UPDATE, never before", () => {
      const failedBranchMatch = functionBody.match(
        /elsif v_kind = 'payment\.failed' then([\s\S]*?)elsif v_kind = 'order\.paid'/i,
      );
      expect(failedBranchMatch).not.toBeNull();
      const failedBranch = failedBranchMatch![1]!;
      const lockIdx = failedBranch.search(
        /into v_payment from public\.payments[\s\S]*?for update/i,
      );
      const decisionIdx = failedBranch.indexOf("v_already_captured :=");
      expect(lockIdx).toBeGreaterThanOrEqual(0);
      expect(decisionIdx).toBeGreaterThan(lockIdx);
    });
  });

  describe("Finding B — fail-closed event contract (no catch-all ELSE as order.paid authority)", () => {
    it("validates normalized sourceKind, eventType, kind, and kind == eventType before any lock beyond the attempt itself", () => {
      expect(functionBody).toMatch(/PROCESSING_EVENT_INVALID/);
      expect(functionBody).toMatch(/v_norm_source_kind/);
      expect(functionBody).toMatch(/v_norm_event_type/);
      expect(functionBody).toMatch(/v_kind <> v_norm_event_type/);
    });

    it("uses explicit IF / ELSIF / ELSIF / ELSE branches for payment.captured / payment.failed / order.paid — no bare ELSE treated as order.paid", () => {
      expect(functionBody).toMatch(/if v_kind = 'payment\.captured' then/i);
      expect(functionBody).toMatch(/elsif v_kind = 'payment\.failed' then/i);
      expect(functionBody).toMatch(/elsif v_kind = 'order\.paid' then/i);
      // The final ELSE must itself raise a fail-closed exception, not
      // silently fall through to order.paid mutation logic.
      const finalElseMatch = functionBody.match(
        /elsif v_kind = 'order\.paid' then[\s\S]*?\n\s*else\s*\n([\s\S]*?)\n\s*end if;/i,
      );
      expect(finalElseMatch).not.toBeNull();
      expect(finalElseMatch![1]!).toMatch(
        /raise exception 'PROCESSING_EVENT_INVALID/i,
      );
    });

    it("cross-checks the canonical webhook_events row's own columns against the normalized event / processing attempt correlation", () => {
      for (const column of [
        "v_webhook.source_kind",
        "v_webhook.signature_verified",
        "v_webhook.event_type",
        "v_webhook.razorpay_order_id",
        "v_webhook.razorpay_payment_id",
        "v_webhook.payment_attempt_id",
        "v_webhook.payment_id",
        "v_webhook.amount_subunits",
        "v_webhook.currency",
        "v_webhook.razorpay_payment_status",
      ]) {
        expect(functionBody).toContain(column);
      }
    });
  });

  describe("Finding C — PROCESSING attempts are recoverable", () => {
    it("allows both PENDING and PROCESSING through the status gate (not PENDING alone)", () => {
      expect(functionBody).toMatch(
        /status not in \('PENDING', 'PROCESSING'\)/i,
      );
    });
  });

  describe("Finding D — fulfilment conflict check validates effect_type, not only order_id/payment_id", () => {
    it("the fulfilment ON CONFLICT identity check compares effect_type in addition to order_id and payment_id", () => {
      const conflictCheckMatch = functionBody.match(
        /returning \* into v_existing_fulfilment;\s*\n\s*if ([\s\S]*?)then\s*\n[\s\S]*?PROCESSING_FULFILMENT_CONFLICT/i,
      );
      expect(conflictCheckMatch).not.toBeNull();
      const condition = conflictCheckMatch![1]!;
      expect(condition).toMatch(/v_existing_fulfilment\.order_id/);
      expect(condition).toMatch(/v_existing_fulfilment\.payment_id/);
      expect(condition).toMatch(
        /v_existing_fulfilment\.effect_type <> 'FULFIL_ORDER'/,
      );
    });
  });
});

describe("Phase 1C-A correction — explicit browser-role revocation", () => {
  it("orders explicitly revokes privileges from anon and authenticated", () => {
    expect(combinedSql).toMatch(
      /revoke all privileges on table public\.orders from anon,\s*authenticated;/i,
    );
  });

  it("payment_attempts explicitly revokes privileges from anon and authenticated", () => {
    expect(combinedSql).toMatch(
      /revoke all privileges on table public\.payment_attempts from anon,\s*authenticated;/i,
    );
  });

  it("fulfilments explicitly revokes privileges from anon and authenticated", () => {
    expect(combinedSql).toMatch(
      /revoke all privileges on table public\.fulfilments from anon,\s*authenticated;/i,
    );
  });

  it("webhook_events explicitly revokes privileges from anon and authenticated", () => {
    expect(combinedSql).toMatch(
      /revoke all privileges on table public\.webhook_events from anon,\s*authenticated;/i,
    );
  });

  it("event_processing_attempts explicitly revokes privileges from anon and authenticated", () => {
    expect(combinedSql).toMatch(
      /revoke all privileges on table public\.event_processing_attempts from anon,\s*authenticated;/i,
    );
  });

  it("contains no GRANT statement for anon anywhere in the file", () => {
    expect(combinedSql).not.toMatch(/grant[^;]*\bto\s+anon\b/i);
  });

  it("contains no GRANT statement for authenticated anywhere in the file", () => {
    expect(combinedSql).not.toMatch(/grant[^;]*\bto\s+authenticated\b/i);
  });

  // Phase 3F-A: `invariant_results` is the EIGHTH granted table and is
  // deliberately the ONLY one without UPDATE — a persisted invariant result
  // is immutable append-only evidence (docs/MONEY_INVARIANTS.md Section 49),
  // so the append-only guarantee is enforced by privilege, not merely by
  // repository convention. This assertion is split rather than relaxed: the
  // seven mutable tables must still each carry full CRUD, and
  // invariant_results must carry SELECT/INSERT/DELETE and never UPDATE.
  it("service_role retains explicit CRUD grants on exactly the eight mutable tables, plus an append-only grant on invariant_results", () => {
    const tableGrantLines = combinedSql
      .split("\n")
      .filter((line) => /^\s*grant\s.*\bon\s+(?!function\b)/i.test(line));
    expect(tableGrantLines.length).toBe(9);

    const invariantGrants = tableGrantLines.filter((line) =>
      /public\.invariant_results\b/i.test(line),
    );
    expect(invariantGrants.length).toBe(1);
    expect(invariantGrants[0]!).toMatch(/select,\s*insert,\s*delete/i);
    expect(invariantGrants[0]!).not.toMatch(/\bupdate\b/i);
    expect(invariantGrants[0]!).toMatch(/to service_role/i);

    const mutableGrants = tableGrantLines.filter(
      (line) => !/public\.invariant_results\b/i.test(line),
    );
    expect(mutableGrants.length).toBe(8);
    for (const line of mutableGrants) {
      expect(line).toMatch(/select,\s*insert,\s*update,\s*delete/i);
      expect(line).toMatch(/to service_role/i);
      expect(line).toMatch(
        /public\.(orders|payment_attempts|payments|fulfilments|webhook_events|event_processing_attempts|chaos_runs|findings)\b/i,
      );
    }

    // Phase 3G's `findings` is the eighth mutable table and is pinned by
    // exact name rather than absorbed into a loosened count. It DOES carry
    // UPDATE — unlike invariant_results — because a finding is a mutable
    // lifecycle object (docs/DATABASE.md Section 17). That is a DATABASE
    // capability for Phase 4; Phase 3G production never executes an UPDATE,
    // which tests/unit/findings/phase3g-static-guard.test.ts enforces.
    const findingGrants = tableGrantLines.filter((line) =>
      /public\.findings\b/i.test(line),
    );
    expect(findingGrants.length).toBe(1);
    expect(findingGrants[0]!).toMatch(/select,\s*insert,\s*update,\s*delete/i);
    expect(findingGrants[0]!).toMatch(/to service_role/i);
  });

  it("RLS remains enabled on all nine tables", () => {
    for (const table of [
      "orders",
      "payment_attempts",
      "payments",
      "fulfilments",
      "webhook_events",
      "event_processing_attempts",
      "chaos_runs",
      "invariant_results",
      "findings",
    ]) {
      const re = new RegExp(
        `alter table public\\.${table} enable row level security`,
        "i",
      );
      expect(combinedSql).toMatch(re);
    }
  });

  it("there are still zero CREATE POLICY statements", () => {
    expect(combinedSql).not.toMatch(/create policy/i);
  });
});

describe("Phase 3B migration — chaos_runs static structural coverage (architect correction, Finding 4)", () => {
  // This describe block statically verifies the Phase 3B migration
  // (supabase/migrations/20260829000000_phase3b_chaos_runs.sql) BEFORE it
  // is manually applied to the real Supabase project — see this task's own
  // "Do NOT apply the Supabase migration" boundary. Real-Supabase
  // constraint/RLS/persistence behavior is separately proven by
  // tests/integration/supabase/052-chaos-run-persistence.integration.test.ts,
  // which remains NOT RUN until that manual application happens.
  const phase3bMigration = migrations.find((m) => m.name.includes("phase3b"));
  const chaosRunsMatch = combinedSql.match(
    /create table\s+public\.chaos_runs\s*\(([\s\S]*?)\n\);/i,
  );
  const chaosRunsBlock = chaosRunsMatch ? chaosRunsMatch[1]! : "";

  it("found the Phase 3B migration file and the chaos_runs table definition", () => {
    expect(phase3bMigration).toBeDefined();
    expect(chaosRunsBlock.length).toBeGreaterThan(0);
  });

  it("creates public.chaos_runs exactly once", () => {
    const occurrences = [
      ...combinedSql.matchAll(/create\s+table\s+public\.chaos_runs\s*\(/gi),
    ];
    expect(occurrences.length).toBe(1);
  });

  describe("columns / nullability", () => {
    it("scenario_id is NOT NULL", () => {
      expect(chaosRunsBlock).toMatch(/scenario_id text not null/i);
    });

    it("order_id/payment_attempt_id/payment_id/source_webhook_event_id are nullable FKs (no NOT NULL on any of them)", () => {
      for (const column of [
        "order_id",
        "payment_attempt_id",
        "payment_id",
        "source_webhook_event_id",
      ]) {
        const columnLineMatch = chaosRunsBlock.match(
          new RegExp(`${column}\\s+uuid\\s+references[^,\\n]*`, "i"),
        );
        expect(columnLineMatch).not.toBeNull();
        expect(columnLineMatch![0]).not.toMatch(/not null/i);
        expect(columnLineMatch![0]).toMatch(/on delete restrict/i);
      }
    });

    it("fault_type is nullable (no NOT NULL) — C11 has no fault primitive", () => {
      expect(chaosRunsBlock).toMatch(/fault_type text,/i);
      expect(chaosRunsBlock).not.toMatch(/fault_type text not null/i);
    });

    it("failed_precheck_id is nullable (no NOT NULL) and present as a column", () => {
      expect(chaosRunsBlock).toMatch(/failed_precheck_id text,/i);
      expect(chaosRunsBlock).not.toMatch(/failed_precheck_id text not null/i);
    });

    it("data_classification is TEXT NOT NULL with NO DEFAULT (architect correction — fail-closed provenance handling: a server-side bug or future writer must never be able to omit this column and silently receive a default classification in either direction)", () => {
      expect(chaosRunsBlock).toMatch(/data_classification text not null,/i);
      expect(chaosRunsBlock).not.toMatch(
        /data_classification text not null default/i,
      );
      expect(chaosRunsBlock).not.toMatch(/data_classification[^,]*default/i);
    });
  });

  describe("required CHECK constraints", () => {
    it.each([
      "chaos_runs_scenario_id_valid",
      "chaos_runs_status_valid",
      "chaos_runs_outcome_valid",
      "chaos_runs_fault_type_valid",
      "chaos_runs_failed_precheck_id_valid",
      "chaos_runs_data_classification_valid",
      "chaos_runs_fault_config_is_object",
      "chaos_runs_fault_state_is_object",
      "chaos_runs_blocked_state_consistent",
      "chaos_runs_pending_state_consistent",
    ])("%s exists", (constraintName) => {
      expect(chaosRunsBlock).toMatch(
        new RegExp(`constraint\\s+${constraintName}\\s+check`, "i"),
      );
    });

    it("chaos_runs_scenario_id_valid allows exactly C01/C03/C07/C11", () => {
      expect(chaosRunsBlock).toMatch(
        /scenario_id in \('C01', 'C03', 'C07', 'C11'\)/i,
      );
    });

    it("chaos_runs_fault_type_valid allows NULL or exactly the three canonical P0 primitives — no fourth primitive", () => {
      expect(chaosRunsBlock).toMatch(
        /fault_type is null or fault_type in \(\s*'REPLAY_EVENT', 'INVALID_SIGNATURE_TEST', 'DROP_CLIENT_CONFIRMATION'\s*\)/i,
      );
    });

    it("chaos_runs_failed_precheck_id_valid allows NULL or PRECHECK-01 through PRECHECK-10", () => {
      for (let n = 1; n <= 10; n++) {
        const id = `PRECHECK-${String(n).padStart(2, "0")}`;
        expect(chaosRunsBlock).toContain(`'${id}'`);
      }
      expect(chaosRunsBlock).toMatch(/failed_precheck_id is null or/i);
    });

    it("chaos_runs_data_classification_valid allows exactly RECORDED_TEST_EVIDENCE/SYNTHETIC_DEMO", () => {
      expect(chaosRunsBlock).toMatch(
        /data_classification in \('RECORDED_TEST_EVIDENCE', 'SYNTHETIC_DEMO'\)/i,
      );
    });

    it("chaos_runs_blocked_state_consistent requires status/outcome/failed_precheck_id/error_message_redacted/started_at/completed_at agreement", () => {
      expect(chaosRunsBlock).toMatch(/outcome = 'BLOCKED'/i);
      expect(chaosRunsBlock).toMatch(/status = 'COMPLETED'/i);
      expect(chaosRunsBlock).toMatch(/failed_precheck_id is not null/i);
      expect(chaosRunsBlock).toMatch(/error_message_redacted is not null/i);
      expect(chaosRunsBlock).toMatch(/started_at is null/i);
      expect(chaosRunsBlock).toMatch(/completed_at is not null/i);
      expect(chaosRunsBlock).toMatch(/outcome is distinct from 'BLOCKED'/i);
    });

    it("chaos_runs_pending_state_consistent requires outcome/failed_precheck_id/started_at/completed_at all NULL when status = PENDING", () => {
      expect(chaosRunsBlock).toMatch(
        /status <> 'PENDING'\s*\n\s*or \(\s*\n\s*outcome is null\s*\n\s*and failed_precheck_id is null\s*\n\s*and started_at is null\s*\n\s*and completed_at is null/i,
      );
    });
  });

  it("FK safety: all four entity/evidence columns use ON DELETE RESTRICT (no cascading deletes)", () => {
    const fkLines = chaosRunsBlock
      .split("\n")
      .filter((line) => /references public\./i.test(line));
    expect(fkLines.length).toBe(4);
    for (const line of fkLines) {
      expect(line).toMatch(/on delete restrict/i);
    }
    expect(chaosRunsBlock).not.toMatch(/on delete cascade/i);
  });

  describe("required indexes", () => {
    it.each([
      ["chaos_runs_scenario_id_idx", "scenario_id"],
      ["chaos_runs_order_id_idx", "order_id"],
      ["chaos_runs_payment_attempt_id_idx", "payment_attempt_id"],
      ["chaos_runs_payment_id_idx", "payment_id"],
      ["chaos_runs_source_webhook_event_id_idx", "source_webhook_event_id"],
    ])("%s on (%s)", (indexName, column) => {
      expect(combinedSql).toMatch(
        new RegExp(
          `create index ${indexName} on public\\.chaos_runs \\(${column}\\)`,
          "i",
        ),
      );
    });

    it("composite index on (status, created_at)", () => {
      expect(combinedSql).toMatch(
        /create index chaos_runs_status_created_at_idx on public\.chaos_runs \(status, created_at\)/i,
      );
    });

    it("composite index on (data_classification, completed_at)", () => {
      expect(combinedSql).toMatch(
        /create index chaos_runs_data_classification_completed_at_idx on public\.chaos_runs \(data_classification, completed_at\)/i,
      );
    });
  });

  describe("RLS / privileges", () => {
    it("RLS is enabled on chaos_runs", () => {
      expect(combinedSql).toMatch(
        /alter table public\.chaos_runs enable row level security/i,
      );
    });

    it("privileges are explicitly revoked from anon and authenticated", () => {
      expect(combinedSql).toMatch(
        /revoke all privileges on table public\.chaos_runs from anon,\s*authenticated;/i,
      );
    });

    it("CRUD is granted to service_role", () => {
      expect(combinedSql).toMatch(
        /grant select, insert, update, delete on public\.chaos_runs to service_role;/i,
      );
    });

    it("no CREATE POLICY exists for chaos_runs specifically (and none anywhere, per the suite-wide check above)", () => {
      expect(phase3bMigration!.sql).not.toMatch(/create policy/i);
    });

    it("chaos_runs never appears in a GRANT to anon or authenticated", () => {
      expect(combinedSql).not.toMatch(
        /grant[^;]*\bchaos_runs\b[^;]*\bto\s+(anon|authenticated)\b/i,
      );
    });
  });

  describe("scope: Phase 3B does not touch event_processing_attempts or later-phase tables", () => {
    it("does not add chaos_run_id to event_processing_attempts", () => {
      expect(phase3bMigration!.sql).not.toMatch(/add column\s+chaos_run_id\b/i);
    });

    it("does not widen event_processing_attempts.source_kind's CHECK constraint (its own header comment legitimately explains this deferral by name, so only functional/non-comment lines are checked here)", () => {
      const functionalSql = phase3bMigration!.sql
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n");
      expect(functionalSql).not.toMatch(/PAYCHAOS_REPLAY/);
      expect(functionalSql).not.toMatch(/PAYCHAOS_SIMULATION/);
      expect(functionalSql).not.toMatch(/TEST_FIXTURE/);
      expect(phase3bMigration!.sql).not.toMatch(
        /alter table\s+public\.event_processing_attempts/i,
      );
    });

    it("does not create invariant_results, findings, or regression_runs", () => {
      for (const forbidden of [
        "invariant_results",
        "findings",
        "regression_runs",
      ]) {
        expect(phase3bMigration!.sql).not.toMatch(
          new RegExp(`create table\\s+public\\.${forbidden}`, "i"),
        );
      }
    });
  });
});

describe("Phase 3C migration — controlled replay compatibility (architect-approved Phase 2F admission-gate fix)", () => {
  const phase3cMigration = migrations.find((m) => m.name.includes("phase3c"));
  const phase2eMigration = migrations.find((m) => m.name.includes("phase2e"));
  const phase2fMigration = migrations.find((m) => m.name.includes("phase2f"));

  it("found the Phase 3C migration file", () => {
    expect(phase3cMigration).toBeDefined();
  });

  it("does NOT create a new table (no functional CREATE TABLE statement — its own header comment legitimately mentions the phrase by name while explaining that historical CREATE TABLE statements are untouched, so only non-comment lines are checked here)", () => {
    const functionalSql = phase3cMigration!.sql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    expect(functionalSql).not.toMatch(/create\s+table/i);
  });

  it("does not edit the historical Phase 2E or Phase 2F migration files (both remain byte-for-byte present, unchanged, and are not the file this test is reading edits from)", () => {
    expect(phase2eMigration).toBeDefined();
    expect(phase2fMigration).toBeDefined();
    // The historical files' own CREATE TABLE/CREATE FUNCTION statements
    // still exist verbatim in the combined SQL — this migration only adds
    // NEW statements in its OWN file, never mutates theirs.
    expect(phase2eMigration!.sql).toMatch(
      /create table\s+public\.event_processing_attempts/i,
    );
    expect(phase2fMigration!.sql).toMatch(
      /create function public\.process_webhook_payment_event/i,
    );
  });

  describe("event_processing_attempts.chaos_run_id", () => {
    it("adds chaos_run_id as a nullable FK to chaos_runs(id) ON DELETE RESTRICT", () => {
      expect(phase3cMigration!.sql).toMatch(
        /alter table public\.event_processing_attempts\s+add column chaos_run_id uuid references public\.chaos_runs \(id\) on delete restrict;/i,
      );
    });

    it("adds the chaos_run_id index", () => {
      expect(phase3cMigration!.sql).toMatch(
        /create index event_processing_attempts_chaos_run_id_idx\s+on public\.event_processing_attempts \(chaos_run_id\);/i,
      );
    });
  });

  describe("source_kind widening", () => {
    it("drops the old event_processing_attempts_source_kind_valid constraint", () => {
      expect(phase3cMigration!.sql).toMatch(
        /alter table public\.event_processing_attempts\s+drop constraint event_processing_attempts_source_kind_valid;/i,
      );
    });

    it("recreates it allowing exactly REAL_RAZORPAY_WEBHOOK and PAYCHAOS_REPLAY", () => {
      expect(phase3cMigration!.sql).toMatch(
        /source_kind in \('REAL_RAZORPAY_WEBHOOK', 'PAYCHAOS_REPLAY'\)/,
      );
    });

    it("does NOT enable PAYCHAOS_SIMULATION or TEST_FIXTURE in the new CHECK constraint", () => {
      const constraintMatch = phase3cMigration!.sql.match(
        /add constraint event_processing_attempts_source_kind_valid check \(([\s\S]*?)\);/i,
      );
      expect(constraintMatch).not.toBeNull();
      const constraintBody = constraintMatch![1]!;
      expect(constraintBody).not.toMatch(/PAYCHAOS_SIMULATION/);
      expect(constraintBody).not.toMatch(/TEST_FIXTURE/);
    });
  });

  describe("PAYCHAOS_REPLAY provenance constraint", () => {
    it("adds event_processing_attempts_replay_provenance_valid requiring webhook_event_id, chaos_run_id, and is_duplicate_delivery = false", () => {
      const constraintMatch = phase3cMigration!.sql.match(
        /add constraint event_processing_attempts_replay_provenance_valid check \(([\s\S]*?)\);/i,
      );
      expect(constraintMatch).not.toBeNull();
      const body = constraintMatch![1]!;
      expect(body).toMatch(/webhook_event_id is not null/i);
      expect(body).toMatch(/chaos_run_id is not null/i);
      expect(body).toMatch(/is_duplicate_delivery = false/i);
    });
  });

  describe("RLS / privileges unchanged", () => {
    it("contains no CREATE POLICY, no GRANT to anon/authenticated, and no ALTER TABLE ... ENABLE ROW LEVEL SECURITY (RLS shape is untouched — already enabled by Phase 2E)", () => {
      expect(phase3cMigration!.sql).not.toMatch(/create policy/i);
      expect(phase3cMigration!.sql).not.toMatch(/grant[^;]*\bto\s+anon\b/i);
      expect(phase3cMigration!.sql).not.toMatch(
        /grant[^;]*\bto\s+authenticated\b/i,
      );
      expect(phase3cMigration!.sql).not.toMatch(/enable row level security/i);
    });

    it("re-asserts service_role-only execute on process_webhook_payment_event, still revoked from public", () => {
      expect(phase3cMigration!.sql).toMatch(
        /revoke all on function public\.process_webhook_payment_event\(uuid\) from public;/i,
      );
      expect(phase3cMigration!.sql).toMatch(
        /grant execute on function public\.process_webhook_payment_event\(uuid\) to service_role;/i,
      );
    });
  });

  describe("process_webhook_payment_event — CREATE OR REPLACE, signature-preserving", () => {
    const headerMatch = phase3cMigration
      ? phase3cMigration.sql.match(
          /create or replace function public\.process_webhook_payment_event\([\s\S]*?as \$\$/i,
        )
      : null;
    const bodyMatch = phase3cMigration
      ? phase3cMigration.sql.match(
          /create or replace function public\.process_webhook_payment_event\([\s\S]*?as \$\$([\s\S]*?)\n\$\$;/i,
        )
      : null;
    const functionHeader = headerMatch ? headerMatch[0]! : "";
    const functionBody = bodyMatch ? bodyMatch[1]! : "";

    it("uses CREATE OR REPLACE FUNCTION with the identical signature (uuid) — never CREATE FUNCTION (which would conflict) and never a renamed function", () => {
      expect(functionHeader.length).toBeGreaterThan(0);
      expect(phase3cMigration!.sql).toMatch(
        /create or replace function public\.process_webhook_payment_event\(\s*p_processing_attempt_id uuid\s*\)/i,
      );
    });

    it("preserves SECURITY INVOKER and pinned search_path", () => {
      expect(functionHeader).toMatch(/security invoker/i);
      expect(functionHeader).not.toMatch(/security definer/i);
      expect(functionHeader).toMatch(/set search_path = public/i);
    });

    it("preserves the three supported P0 event types (payment.captured/payment.failed/order.paid)", () => {
      expect(functionBody).toMatch(
        /'payment\.captured', 'payment\.failed', 'order\.paid'/,
      );
    });

    it("UNCHANGED: normalized_event.sourceKind must still equal REAL_RAZORPAY_WEBHOOK regardless of the processing attempt's own source_kind", () => {
      expect(functionBody).toMatch(
        /if v_norm_source_kind is distinct from 'REAL_RAZORPAY_WEBHOOK' then/i,
      );
    });

    it("UNCHANGED: the correlated canonical webhook_events row must still be REAL_RAZORPAY_WEBHOOK + signature_verified = true", () => {
      expect(functionBody).toMatch(
        /v_webhook\.source_kind <> 'REAL_RAZORPAY_WEBHOOK' or v_webhook\.signature_verified is not true/i,
      );
    });

    it("Phase 3C's ONLY admission change: the processing-attempt gate now permits PAYCHAOS_REPLAY (requiring chaos_run_id and is_duplicate_delivery = false), in addition to REAL_RAZORPAY_WEBHOOK", () => {
      expect(functionBody).toMatch(
        /source_kind not in \('REAL_RAZORPAY_WEBHOOK', 'PAYCHAOS_REPLAY'\)/i,
      );
      expect(functionBody).toMatch(
        /v_attempt\.source_kind = 'PAYCHAOS_REPLAY'/i,
      );
      expect(functionBody).toMatch(/v_attempt\.chaos_run_id is null/i);
      expect(functionBody).toMatch(
        /v_attempt\.is_duplicate_delivery is not false/i,
      );
    });

    it("still requires webhook_event_id is not null for both source kinds", () => {
      expect(functionBody).toMatch(
        /v_attempt\.webhook_event_id is null[\s\S]*?raise exception 'PROCESSING_SOURCE_INVALID/i,
      );
    });

    it("preserves the fixed FOR UPDATE lock order and the fulfilment ON CONFLICT idempotency boundary", () => {
      const forUpdateCount = (functionBody.match(/for update/gi) ?? []).length;
      expect(forUpdateCount).toBeGreaterThanOrEqual(5);
      expect(functionBody).toMatch(
        /on conflict \(idempotency_key\) do update/i,
      );
    });

    it("preserves every deterministic safe error code (no new error code was introduced)", () => {
      for (const code of [
        "PROCESSING_ATTEMPT_NOT_FOUND",
        "PROCESSING_ATTEMPT_NOT_READY",
        "PROCESSING_SOURCE_INVALID",
        "PROCESSING_EVENT_INVALID",
        "PROCESSING_CORRELATION_INVALID",
        "PROCESSING_PAYMENT_REQUIRED",
        "PROCESSING_AMOUNT_MISMATCH",
        "PROCESSING_CURRENCY_MISMATCH",
        "PROCESSING_FULFILMENT_CONFLICT",
      ]) {
        expect(functionBody).toContain(code);
      }
    });

    it("no dynamic SQL was introduced (no EXECUTE statement, no format()/quote_ident() string-building)", () => {
      expect(functionBody).not.toMatch(/\bexecute\s+(format|'|")/i);
      expect(functionBody).not.toMatch(/\bformat\s*\(/i);
      expect(functionBody).not.toMatch(/\bquote_ident\s*\(/i);
    });
  });

  describe("scope: does not touch chaos_runs, does not enable PAYCHAOS_SIMULATION/TEST_FIXTURE, does not add evidence-snapshot columns", () => {
    it("does not create or alter chaos_runs", () => {
      expect(phase3cMigration!.sql).not.toMatch(
        /create\s+table\s+public\.chaos_runs/i,
      );
      expect(phase3cMigration!.sql).not.toMatch(
        /alter table\s+public\.chaos_runs/i,
      );
    });

    it("does not add fault_action/state_before/state_after columns", () => {
      for (const forbidden of ["fault_action", "state_before", "state_after"]) {
        expect(phase3cMigration!.sql).not.toMatch(
          new RegExp(`add column\\s+${forbidden}\\b`, "i"),
        );
      }
    });

    it("does not create invariant_results, findings, or regression_runs", () => {
      for (const forbidden of [
        "invariant_results",
        "findings",
        "regression_runs",
      ]) {
        expect(phase3cMigration!.sql).not.toMatch(
          new RegExp(`create table\\s+public\\.${forbidden}`, "i"),
        );
      }
    });
  });

  describe("differential regression proof — process_webhook_payment_event is IDENTICAL to frozen Phase 2F outside the one approved admission delta (architect correction, Finding 4)", () => {
    const phase2fBodyMatch = phase2fMigration!.sql.match(
      /create function public\.process_webhook_payment_event\([\s\S]*?as \$\$([\s\S]*?)\n\$\$;/i,
    );
    const phase3cBodyMatch = phase3cMigration!.sql.match(
      /create or replace function public\.process_webhook_payment_event\([\s\S]*?as \$\$([\s\S]*?)\n\$\$;/i,
    );
    const phase2fBody = phase2fBodyMatch ? phase2fBodyMatch[1]! : "";
    const phase3cBody = phase3cBodyMatch ? phase3cBodyMatch[1]! : "";

    // Strips `--` line comments (this function body never uses `--` inside
    // a string literal, confirmed by inspection, so a plain per-line split
    // is safe), then collapses all whitespace/newlines to single spaces.
    // This lets the two bodies be compared for SEMANTIC equivalence without
    // being defeated by the deliberately reworded/shortened comments the
    // Phase 3C copy carries (e.g. the Phase 2F "Finding A/B/C/D" review
    // annotations are not repeated verbatim) — comments are stripped
    // entirely before comparison, so their wording cannot hide, and cannot
    // falsely flag, a real code difference.
    function normalizeSql(body: string): string {
      return body
        .split("\n")
        .map((line) => {
          const commentIdx = line.indexOf("--");
          return commentIdx === -1 ? line : line.slice(0, commentIdx);
        })
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
    }

    // The frozen Phase 2F admission block, verbatim from the applied
    // migration file's own text.
    const FROZEN_PHASE2F_ADMISSION_BLOCK = `
      if v_attempt.source_kind <> 'REAL_RAZORPAY_WEBHOOK' or v_attempt.webhook_event_id is null then
        raise exception 'PROCESSING_SOURCE_INVALID: processing attempt % does not carry valid REAL_RAZORPAY_WEBHOOK evidence', p_processing_attempt_id;
      end if;
    `;

    // The ONE architect-approved Phase 3C widened admission block.
    const PHASE3C_ADMISSION_BLOCK = `
      if v_attempt.webhook_event_id is null
         or v_attempt.source_kind not in ('REAL_RAZORPAY_WEBHOOK', 'PAYCHAOS_REPLAY')
         or (
           v_attempt.source_kind = 'PAYCHAOS_REPLAY'
           and (v_attempt.chaos_run_id is null or v_attempt.is_duplicate_delivery is not false)
         )
      then
        raise exception 'PROCESSING_SOURCE_INVALID: processing attempt % does not carry valid REAL_RAZORPAY_WEBHOOK or PAYCHAOS_REPLAY evidence', p_processing_attempt_id;
      end if;
    `;

    it("found both function bodies", () => {
      expect(phase2fBody.length).toBeGreaterThan(0);
      expect(phase3cBody.length).toBeGreaterThan(0);
    });

    it("the Phase 2F body contains the frozen admission block exactly once", () => {
      const normalizedBody = normalizeSql(phase2fBody);
      const normalizedBlock = normalizeSql(FROZEN_PHASE2F_ADMISSION_BLOCK);
      const occurrences = normalizedBody.split(normalizedBlock).length - 1;
      expect(occurrences).toBe(1);
    });

    it("the Phase 3C body contains the expected widened admission block exactly once", () => {
      const normalizedBody = normalizeSql(phase3cBody);
      const normalizedBlock = normalizeSql(PHASE3C_ADMISSION_BLOCK);
      const occurrences = normalizedBody.split(normalizedBlock).length - 1;
      expect(occurrences).toBe(1);
    });

    it("after reverting Phase 3C's widened admission block back to the frozen Phase 2F admission block, the two normalized function bodies are IDENTICAL — proving no other business logic, lock ordering, correlation validation, fulfilment logic, payment.failed precedence, supported event set, or final state update changed", () => {
      const normalizedPhase2fBody = normalizeSql(phase2fBody);
      const normalizedPhase3cBody = normalizeSql(phase3cBody);
      const normalizedNewBlock = normalizeSql(PHASE3C_ADMISSION_BLOCK);
      const normalizedOldBlock = normalizeSql(FROZEN_PHASE2F_ADMISSION_BLOCK);

      const revertedPhase3cBody = normalizedPhase3cBody.replace(
        normalizedNewBlock,
        normalizedOldBlock,
      );

      expect(revertedPhase3cBody).toBe(normalizedPhase2fBody);
    });
  });

  it("Phase 3C itself adds no new table — the cumulative set gains tables only in Phase 3F-A (invariant_results) and Phase 3G (findings)", () => {
    expect(extractCreateTableNames(phase3cMigration!.sql)).toEqual([]);
    const tableNames = extractCreateTableNames(combinedSql);
    expect([...tableNames].sort()).toEqual([
      "chaos_runs",
      "event_processing_attempts",
      "findings",
      "fulfilments",
      "invariant_results",
      "orders",
      "payment_attempts",
      "payments",
      "webhook_events",
    ]);
  });
});

describe("Phase 3D-0 migration — execution-block audit + C07 concurrency schema foundation", () => {
  const phase3dMigration = migrations.find((m) => m.name.includes("phase3d"));
  const phase3bMigration = migrations.find((m) => m.name.includes("phase3b"));
  const phase3cMigration = migrations.find((m) => m.name.includes("phase3c"));

  it("1: the new migration file exists", () => {
    expect(phase3dMigration).toBeDefined();
  });

  it("2: does not edit the historical Phase 3B or Phase 3C migration files (both remain byte-for-byte present with their own original CREATE TABLE/CREATE FUNCTION statements, not this file's)", () => {
    expect(phase3bMigration).toBeDefined();
    expect(phase3cMigration).toBeDefined();
    expect(phase3bMigration!.sql).toMatch(/create table\s+public\.chaos_runs/i);
    expect(phase3cMigration!.sql).toMatch(
      /create or replace function public\.process_webhook_payment_event/i,
    );
    expect(phase3dMigration!.sql).not.toMatch(/create\s+table/i);
    expect(phase3dMigration!.sql).not.toMatch(/create\s+function/i);
  });

  it("3: execution_block_code column is added to chaos_runs", () => {
    expect(phase3dMigration!.sql).toMatch(
      /alter table public\.chaos_runs\s+add column execution_block_code text;/i,
    );
  });

  it("4: chaos_runs_execution_block_code_valid allows NULL or exactly PRE-SEC-007", () => {
    const constraintMatch = phase3dMigration!.sql.match(
      /add constraint chaos_runs_execution_block_code_valid check \(([\s\S]*?)\);/i,
    );
    expect(constraintMatch).not.toBeNull();
    const body = constraintMatch![1]!;
    expect(body).toMatch(/execution_block_code is null or/i);
    expect(body).toMatch(/execution_block_code in \('PRE-SEC-007'\)/i);
  });

  it("5: does not accept PRE-SEC-010 or PRE-SEC-011 as a valid execution_block_code value — the CHECK constraint's value list is exactly ('PRE-SEC-007'); the column comment legitimately names both by string literal only to explain why they are excluded, so only the constraint's own value-list body is checked here, not the whole file", () => {
    const constraintMatch = phase3dMigration!.sql.match(
      /add constraint chaos_runs_execution_block_code_valid check \(([\s\S]*?)\);/i,
    );
    expect(constraintMatch).not.toBeNull();
    const body = constraintMatch![1]!;
    expect(body).not.toMatch(/PRE-SEC-010/);
    expect(body).not.toMatch(/PRE-SEC-011/);
  });

  it("6: chaos_runs_blocked_state_consistent is dropped and recreated encoding XOR semantics between failed_precheck_id and execution_block_code", () => {
    expect(phase3dMigration!.sql).toMatch(
      /drop constraint chaos_runs_blocked_state_consistent;/i,
    );
    const constraintMatch = phase3dMigration!.sql.match(
      /add constraint chaos_runs_blocked_state_consistent check \(([\s\S]*?)\n {2}\);/i,
    );
    expect(constraintMatch).not.toBeNull();
    const body = constraintMatch![1]!;
    expect(body).toMatch(
      /failed_precheck_id is not null and execution_block_code is null/i,
    );
    expect(body).toMatch(
      /failed_precheck_id is null and execution_block_code is not null/i,
    );
  });

  it("7: non-BLOCKED rows require both failed_precheck_id and execution_block_code NULL", () => {
    const constraintMatch = phase3dMigration!.sql.match(
      /add constraint chaos_runs_blocked_state_consistent check \(([\s\S]*?)\n {2}\);/i,
    );
    expect(constraintMatch).not.toBeNull();
    const body = constraintMatch![1]!;
    expect(body).toMatch(
      /outcome is distinct from 'BLOCKED'\s*\n\s*and failed_precheck_id is null\s*\n\s*and execution_block_code is null/i,
    );
  });

  it("8: chaos_runs_pending_state_consistent is dropped and recreated requiring execution_block_code IS NULL for PENDING", () => {
    expect(phase3dMigration!.sql).toMatch(
      /drop constraint chaos_runs_pending_state_consistent;/i,
    );
    const constraintMatch = phase3dMigration!.sql.match(
      /add constraint chaos_runs_pending_state_consistent check \(([\s\S]*?)\n {2}\);/i,
    );
    expect(constraintMatch).not.toBeNull();
    const body = constraintMatch![1]!;
    expect(body).toMatch(/outcome is null/i);
    expect(body).toMatch(/failed_precheck_id is null/i);
    expect(body).toMatch(/execution_block_code is null/i);
    expect(body).toMatch(/started_at is null/i);
    expect(body).toMatch(/completed_at is null/i);
  });

  it("9: a partial UNIQUE index enforces at most one RUNNING C07/DROP_CLIENT_CONFIRMATION run per order", () => {
    expect(phase3dMigration!.sql).toMatch(
      /create unique index chaos_runs_one_active_c07_fault_per_order_idx\s+on public\.chaos_runs \(order_id\)/i,
    );
  });

  it("10: the index predicate is exactly scoped to scenario_id=C07, fault_type=DROP_CLIENT_CONFIRMATION, status=RUNNING, order_id IS NOT NULL", () => {
    const indexMatch = phase3dMigration!.sql.match(
      /create unique index chaos_runs_one_active_c07_fault_per_order_idx[\s\S]*?where([\s\S]*?);/i,
    );
    expect(indexMatch).not.toBeNull();
    const predicate = indexMatch![1]!;
    expect(predicate).toMatch(/scenario_id = 'C07'/i);
    expect(predicate).toMatch(/fault_type = 'DROP_CLIENT_CONFIRMATION'/i);
    expect(predicate).toMatch(/status = 'RUNNING'/i);
    expect(predicate).toMatch(/order_id is not null/i);
  });

  it("11: does not touch any other table, RLS, or GRANT surface (no CREATE POLICY, no GRANT, no ENABLE ROW LEVEL SECURITY, no ALTER TABLE on a table other than chaos_runs)", () => {
    expect(phase3dMigration!.sql).not.toMatch(/create policy/i);
    expect(phase3dMigration!.sql).not.toMatch(/\bgrant\b/i);
    expect(phase3dMigration!.sql).not.toMatch(/enable row level security/i);
    const alterTableMatches = [
      ...phase3dMigration!.sql.matchAll(/alter table\s+public\.(\w+)/gi),
    ];
    expect(alterTableMatches.length).toBeGreaterThan(0);
    for (const match of alterTableMatches) {
      expect(match[1]!.toLowerCase()).toBe("chaos_runs");
    }
  });

  it("12: does not add C03/C07/C11 production behavior — no new table, no new function, no fixture/invariant/finding schema", () => {
    for (const forbidden of [
      "invariant_results",
      "findings",
      "regression_runs",
    ]) {
      expect(phase3dMigration!.sql).not.toMatch(
        new RegExp(`create table\\s+public\\.${forbidden}`, "i"),
      );
    }
  });

  it("13: Phase 3D-0 itself adds no new table — the cumulative set gains tables only in Phase 3F-A (invariant_results) and Phase 3G (findings)", () => {
    expect(extractCreateTableNames(phase3dMigration!.sql)).toEqual([]);
    const tableNames = extractCreateTableNames(combinedSql);
    expect([...tableNames].sort()).toEqual([
      "chaos_runs",
      "event_processing_attempts",
      "findings",
      "fulfilments",
      "invariant_results",
      "orders",
      "payment_attempts",
      "payments",
      "webhook_events",
    ]);
  });
});

describe("Phase 3E-A migration — event_processing_attempts evidence snapshots", () => {
  // Statically verifies supabase/migrations/20260901000000_phase3e_evidence_snapshots.sql
  // BEFORE it is manually applied to the real Supabase project — the same
  // discipline the Phase 3B/3C/3D-0 blocks above already follow. Real
  // constraint/set-once behavior against Postgres is separately covered by
  // tests/integration/supabase/060-phase3e-evidence-snapshot.integration.test.ts,
  // which remains NOT RUN until that manual application happens.
  const phase3eMigration = migrations.find((m) => m.name.includes("phase3e"));
  const phase2eMigration = migrations.find((m) => m.name.includes("phase2e"));
  const phase2fMigration = migrations.find((m) => m.name.includes("phase2f"));
  const phase3bMigration = migrations.find((m) => m.name.includes("phase3b"));
  const phase3cMigration = migrations.find((m) => m.name.includes("phase3c"));
  const phase3dMigration = migrations.find((m) => m.name.includes("phase3d"));

  /** Non-comment lines only — the file's own header legitimately NAMES several things it deliberately does not do. */
  function functionalSql(sql: string): string {
    return sql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
  }

  it("1: the new additive migration file exists", () => {
    expect(phase3eMigration).toBeDefined();
  });

  it("2: it sorts AFTER every migration that precedes it and BEFORE the Phase 3F-A and Phase 3G migrations (chronological filename ordering is preserved, so nothing can be applied out of order)", () => {
    const index = migrations.findIndex(
      (m) => m.name === phase3eMigration!.name,
    );
    expect(index).toBeGreaterThan(-1);
    for (const earlier of migrations.slice(0, index)) {
      expect(earlier.name < phase3eMigration!.name).toBe(true);
    }
    expect(migrations.slice(index + 1).map((m) => m.name)).toEqual([
      "20260902000000_phase3f_invariant_results.sql",
      "20260903000000_phase3g_findings.sql",
    ]);
    expect(phase3eMigration!.name).toMatch(
      /^\d{14}_phase3e_evidence_snapshots\.sql$/,
    );
  });

  it("3: every historical migration file remains unedited — each still contains its own original CREATE TABLE / CREATE FUNCTION statements, and this file contains none of them", () => {
    expect(phase2eMigration!.sql).toMatch(
      /create table\s+public\.event_processing_attempts/i,
    );
    expect(phase2fMigration!.sql).toMatch(
      /create function public\.process_webhook_payment_event/i,
    );
    expect(phase3bMigration!.sql).toMatch(/create table\s+public\.chaos_runs/i);
    expect(phase3cMigration!.sql).toMatch(
      /create or replace function public\.process_webhook_payment_event/i,
    );
    expect(phase3dMigration!.sql).toMatch(
      /add column execution_block_code text/i,
    );
    expect(functionalSql(phase3eMigration!.sql)).not.toMatch(/create\s+table/i);
    expect(functionalSql(phase3eMigration!.sql)).not.toMatch(
      /create\s+(or replace\s+)?function/i,
    );
  });

  it("4: state_before is added as a NULLABLE jsonb column (no NOT NULL, no DEFAULT)", () => {
    expect(phase3eMigration!.sql).toMatch(
      /alter table public\.event_processing_attempts\s+add column state_before jsonb;/i,
    );
    expect(phase3eMigration!.sql).not.toMatch(
      /add column state_before jsonb not null/i,
    );
    expect(phase3eMigration!.sql).not.toMatch(
      /alter column state_before set not null/i,
    );
    expect(phase3eMigration!.sql).not.toMatch(
      /add column state_before jsonb default/i,
    );
  });

  it("5: state_after is added as a NULLABLE jsonb column (no NOT NULL, no DEFAULT)", () => {
    expect(phase3eMigration!.sql).toMatch(
      /alter table public\.event_processing_attempts\s+add column state_after jsonb;/i,
    );
    expect(phase3eMigration!.sql).not.toMatch(
      /add column state_after jsonb not null/i,
    );
    expect(phase3eMigration!.sql).not.toMatch(
      /alter column state_after set not null/i,
    );
    expect(phase3eMigration!.sql).not.toMatch(
      /add column state_after jsonb default/i,
    );
  });

  it("6: both columns carry an explanatory column comment (the repository's established migration convention)", () => {
    expect(phase3eMigration!.sql).toMatch(
      /comment on column public\.event_processing_attempts\.state_before is/i,
    );
    expect(phase3eMigration!.sql).toMatch(
      /comment on column public\.event_processing_attempts\.state_after is/i,
    );
  });

  it("7: both JSON-object CHECK constraints exist and accept NULL", () => {
    const beforeMatch = phase3eMigration!.sql.match(
      /add constraint event_processing_attempts_state_before_is_object check \(([\s\S]*?)\);/i,
    );
    expect(beforeMatch).not.toBeNull();
    expect(beforeMatch![1]!).toMatch(/state_before is null or/i);
    expect(beforeMatch![1]!).toMatch(
      /jsonb_typeof\(state_before\) = 'object'/i,
    );

    const afterMatch = phase3eMigration!.sql.match(
      /add constraint event_processing_attempts_state_after_is_object check \(([\s\S]*?)\);/i,
    );
    expect(afterMatch).not.toBeNull();
    expect(afterMatch![1]!).toMatch(/state_after is null or/i);
    expect(afterMatch![1]!).toMatch(/jsonb_typeof\(state_after\) = 'object'/i);
  });

  it("8: no generic evidence table is created (docs/DATABASE.md Section 31 — evidence lives on existing records)", () => {
    for (const forbidden of [
      "evidence_snapshots",
      "chaos_evidence",
      "generic_evidence",
      "evidence_records",
      "evidence",
    ]) {
      expect(phase3eMigration!.sql).not.toMatch(
        new RegExp(
          `create table\\s+(if not exists\\s+)?(public\\.)?${forbidden}\\b`,
          "i",
        ),
      );
    }
    expect(extractCreateTableNames(combinedSql)).not.toContain("evidence");
  });

  it("9: no invariant/finding/regression schema is added by THIS migration (invariant_results arrives only in Phase 3F-A, findings only in Phase 3G)", () => {
    for (const forbidden of [
      "invariant_results",
      "findings",
      "regression_runs",
      "reliability_score_snapshots",
    ]) {
      expect(phase3eMigration!.sql).not.toMatch(
        new RegExp(`create table\\s+public\\.${forbidden}`, "i"),
      );
    }
    // Still absent from the cumulative migration set entirely — genuine
    // Phase 4 tables only. `invariant_results` and `findings` are
    // deliberately excluded from this second list because both are now
    // approved tables, created by Phase 3F-A and Phase 3G respectively.
    for (const forbidden of [
      "regression_runs",
      "reliability_score_snapshots",
    ]) {
      expect(extractCreateTableNames(combinedSql)).not.toContain(forbidden);
    }
    // No PASS/FAIL/UNKNOWN verdict vocabulary is introduced anywhere in the
    // functional SQL of this migration.
    expect(functionalSql(phase3eMigration!.sql)).not.toMatch(/'PASS'/);
    expect(functionalSql(phase3eMigration!.sql)).not.toMatch(/'FAIL'/);
  });

  it("10: no TEST_FIXTURE / PAYCHAOS_SIMULATION runtime widening — source_kind's CHECK is not touched at all", () => {
    const functional = functionalSql(phase3eMigration!.sql);
    expect(functional).not.toMatch(/TEST_FIXTURE/);
    expect(functional).not.toMatch(/PAYCHAOS_SIMULATION/);
    expect(functional).not.toMatch(/source_kind/i);
    expect(phase3eMigration!.sql).not.toMatch(
      /drop constraint event_processing_attempts_source_kind_valid/i,
    );
  });

  it("11: fault_action is NOT added — Phase 3E-A deliberately introduces no unused schema surface", () => {
    expect(phase3eMigration!.sql).not.toMatch(/add column\s+fault_action\b/i);
    expect(combinedSql).not.toMatch(/add column\s+fault_action\b/i);
  });

  it("12: nothing destructive — no DROP TABLE, no DROP COLUMN, no DROP CONSTRAINT, no TRUNCATE, no DELETE, no UPDATE backfill (functional SQL only: the file's own header comment legitimately NAMES these by promising it performs none of them)", () => {
    const functional = functionalSql(phase3eMigration!.sql);
    expect(functional).not.toMatch(/drop\s+table/i);
    expect(functional).not.toMatch(/drop\s+column/i);
    expect(functional).not.toMatch(/drop\s+constraint/i);
    expect(functional).not.toMatch(/truncate/i);
    expect(functional).not.toMatch(/^\s*delete\s+from/im);
    expect(functional).not.toMatch(/^\s*update\s+public\./im);
  });

  it("13: it only ever ALTERs event_processing_attempts — no other table, no RLS change, no GRANT, no policy", () => {
    const alterTableMatches = [
      ...phase3eMigration!.sql.matchAll(/alter table\s+public\.(\w+)/gi),
    ];
    expect(alterTableMatches.length).toBeGreaterThan(0);
    for (const match of alterTableMatches) {
      expect(match[1]!.toLowerCase()).toBe("event_processing_attempts");
    }
    expect(phase3eMigration!.sql).not.toMatch(/create policy/i);
    expect(phase3eMigration!.sql).not.toMatch(/\bgrant\b/i);
    expect(phase3eMigration!.sql).not.toMatch(/\brevoke\b/i);
    expect(phase3eMigration!.sql).not.toMatch(/enable row level security/i);
  });

  it("14: contains no secret-shaped value", () => {
    expect(phase3eMigration!.sql).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
    expect(phase3eMigration!.sql).not.toMatch(/RAZORPAY_KEY_SECRET/i);
    expect(phase3eMigration!.sql).not.toMatch(/RAZORPAY_WEBHOOK_SECRET/i);
    expect(phase3eMigration!.sql).not.toMatch(
      /SUPABASE_SERVICE_ROLE_KEY\s*=\s*['"]/i,
    );
  });

  it("15: Phase 3E-A itself adds no new table — the cumulative set gains tables only in Phase 3F-A (invariant_results) and Phase 3G (findings)", () => {
    expect(extractCreateTableNames(phase3eMigration!.sql)).toEqual([]);
    const tableNames = extractCreateTableNames(combinedSql);
    expect([...tableNames].sort()).toEqual([
      "chaos_runs",
      "event_processing_attempts",
      "findings",
      "fulfilments",
      "invariant_results",
      "orders",
      "payment_attempts",
      "payments",
      "webhook_events",
    ]);
  });
});

describe("Phase 3F-A migration — invariant_results (the first Money Invariant table)", () => {
  const phase3fMigration = migrations.find((m) => m.name.includes("phase3f"));

  function functional(sql: string): string {
    return sql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
  }

  it("1: exists, is the expected filename and sorts immediately before the Phase 3G migration", () => {
    expect(phase3fMigration).toBeDefined();
    expect(phase3fMigration!.name).toBe(
      "20260902000000_phase3f_invariant_results.sql",
    );
    // Advanced, not loosened: Phase 3G now sorts last, and Phase 3F-A must
    // sit exactly one place ahead of it — still an exact-position assertion.
    expect(migrations[migrations.length - 1]!.name).toBe(
      "20260903000000_phase3g_findings.sql",
    );
    expect(migrations[migrations.length - 2]!.name).toBe(
      phase3fMigration!.name,
    );
  });

  it("2: creates exactly one table, and it is invariant_results", () => {
    const created = extractCreateTableNames(phase3fMigration!.sql);
    expect(created).toEqual(["invariant_results"]);
  });

  it("3: declares every required column and invents none", () => {
    const match = phase3fMigration!.sql.match(
      /create table\s+public\.invariant_results\s*\(([\s\S]*?)\n\);/i,
    );
    expect(match).not.toBeNull();
    const block = match![1]!;
    for (const column of [
      "id",
      "invariant_id",
      "invariant_version",
      "order_id",
      "payment_attempt_id",
      "payment_id",
      "chaos_run_id",
      "result",
      "severity",
      "expected_summary",
      "observed_summary",
      "reason",
      "evidence_refs",
      "evaluated_at",
    ]) {
      expect(block).toMatch(new RegExp(`\\b${column}\\b`));
    }
    for (const forbidden of [
      "deterministic_reason",
      "scenario_run_id",
      "diagnosis_code",
      "root_cause",
      "recommendation",
      "confidence",
      "reliability_score",
      "finding_id",
    ]) {
      expect(block).not.toMatch(new RegExp(`\\b${forbidden}`, "i"));
    }
  });

  it("4: all four entity correlations are NULLABLE — the C03 shape (architect correction)", () => {
    const match = phase3fMigration!.sql.match(
      /create table\s+public\.invariant_results\s*\(([\s\S]*?)\n\);/i,
    );
    const block = match![1]!;
    for (const column of [
      "order_id",
      "payment_attempt_id",
      "payment_id",
      "chaos_run_id",
    ]) {
      const line = block
        .split("\n")
        .find((l) => l.trim().startsWith(`${column} `));
      expect(line).toBeDefined();
      expect(line!).not.toMatch(/not null/i);
      expect(line!).toMatch(
        /references public\.\w+ \(id\) on delete restrict/i,
      );
    }
  });

  it("4b: invariant_results_subject_present requires at least ONE of the four correlations to be non-null (architect blocker 3F-A-01 — no orphan authoritative result)", () => {
    const match = phase3fMigration!.sql.match(
      /constraint invariant_results_subject_present check \(([\s\S]*?)\n  \)\n\);/i,
    );
    expect(match).not.toBeNull();
    const body = match![1]!;

    // Exactly the four correlation columns, OR-ed, each tested for NOT NULL.
    const clauses = [...body.matchAll(/(\w+) is not null/gi)].map((m) =>
      m[1]!.toLowerCase(),
    );
    expect(clauses).toEqual([
      "order_id",
      "payment_attempt_id",
      "payment_id",
      "chaos_run_id",
    ]);
    // OR, never AND — an AND would wrongly require all four.
    expect(body).toMatch(/\bor\b/i);
    expect(body).not.toMatch(/\band\b/i);
    expect(body).not.toMatch(/\bis null\b/i);
  });

  it("4c: C03's shape stays legal — the constraint requires no order_id and no payment_attempt_id, and no individual correlation became NOT NULL", () => {
    const createBlock = phase3fMigration!.sql.match(
      /create table\s+public\.invariant_results\s*\(([\s\S]*?)\n\);/i,
    )![1]!;

    // No individual correlation column is NOT NULL — the subject rule is a
    // table-level CHECK, never a per-column NOT NULL.
    for (const column of [
      "order_id",
      "payment_attempt_id",
      "payment_id",
      "chaos_run_id",
    ]) {
      const line = createBlock
        .split("\n")
        .find((l) => l.trim().startsWith(`${column} `));
      expect(line).toBeDefined();
      expect(line!).not.toMatch(/not null/i);
    }

    const subjectBody = phase3fMigration!.sql.match(
      /constraint invariant_results_subject_present check \(([\s\S]*?)\n  \)\n\);/i,
    )![1]!;
    // A C03 row supplies ONLY chaos_run_id; that clause alone must satisfy
    // the constraint, so order_id/payment_attempt_id must not be mandatory
    // anywhere in it.
    expect(subjectBody).toMatch(/chaos_run_id is not null/i);
    expect(subjectBody).not.toMatch(/order_id is not null\s+and/i);
    expect(subjectBody).not.toMatch(/payment_attempt_id is not null\s+and/i);
  });

  it("5: no foreign key uses CASCADE or SET NULL", () => {
    expect(functional(phase3fMigration!.sql)).not.toMatch(/on delete cascade/i);
    expect(functional(phase3fMigration!.sql)).not.toMatch(
      /on delete set null/i,
    );
    const restricts = [
      ...phase3fMigration!.sql.matchAll(/on delete restrict/gi),
    ];
    expect(restricts.length).toBe(4);
  });

  it("6: result accepts EXACTLY PASS/FAIL/UNKNOWN — NOT_APPLICABLE and ERROR have no schema representation", () => {
    const match = phase3fMigration!.sql.match(
      /constraint invariant_results_result_valid check \(([\s\S]*?)\)\s*,/i,
    );
    expect(match).not.toBeNull();
    expect(match![1]!).toMatch(/result in \('PASS', 'FAIL', 'UNKNOWN'\)/i);
    expect(functional(phase3fMigration!.sql)).not.toMatch(/'NOT_APPLICABLE'/);
    expect(functional(phase3fMigration!.sql)).not.toMatch(/'ERROR'/);
  });

  it("7: severity accepts exactly LOW/MEDIUM/HIGH/CRITICAL with no INFO or WARNING", () => {
    const match = phase3fMigration!.sql.match(
      /constraint invariant_results_severity_valid check \(([\s\S]*?)\)\s*,/i,
    );
    expect(match).not.toBeNull();
    expect(match![1]!).toMatch(
      /severity in \('LOW', 'MEDIUM', 'HIGH', 'CRITICAL'\)/i,
    );
    expect(functional(phase3fMigration!.sql)).not.toMatch(/'INFO'/);
    expect(functional(phase3fMigration!.sql)).not.toMatch(/'WARNING'/);
  });

  it("8: invariant_id is constrained to the twelve P0 IDs and excludes the P1 IDs", () => {
    const match = phase3fMigration!.sql.match(
      /constraint invariant_results_invariant_id_valid check \(([\s\S]*?)\n  \),/i,
    );
    expect(match).not.toBeNull();
    const ids = [...match![1]!.matchAll(/'(INV-\d{3})'/g)].map((m) => m[1]!);
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
    expect(functional(phase3fMigration!.sql)).not.toMatch(/'INV-013'/);
    expect(functional(phase3fMigration!.sql)).not.toMatch(/'INV-014'/);
  });

  it("9: invariant_version is text NOT NULL DEFAULT '1' and evidence_refs is jsonb NOT NULL DEFAULT '[]'", () => {
    expect(phase3fMigration!.sql).toMatch(
      /invariant_version text not null default '1'/i,
    );
    expect(phase3fMigration!.sql).toMatch(
      /evidence_refs jsonb not null default '\[\]'/i,
    );
    expect(phase3fMigration!.sql).toMatch(
      /jsonb_typeof\(evidence_refs\) = 'array'/i,
    );
  });

  it("10: the partial unique index is on (chaos_run_id, invariant_id) WHERE chaos_run_id IS NOT NULL", () => {
    expect(phase3fMigration!.sql).toMatch(
      /create unique index invariant_results_chaos_run_invariant_uniq\s*\n\s*on public\.invariant_results \(chaos_run_id, invariant_id\)\s*\n\s*where chaos_run_id is not null;/i,
    );
    expect(phase3fMigration!.sql).not.toMatch(
      /create unique index[\s\S]{0,120}\(invariant_id\)/i,
    );
  });

  it("11: declares every required index and no speculative extra", () => {
    const indexes = [
      ...phase3fMigration!.sql.matchAll(
        /create (?:unique )?index (\w+)\s+on public\.invariant_results/gi,
      ),
    ].map((m) => m[1]!);
    expect([...indexes].sort()).toEqual([
      "invariant_results_chaos_run_invariant_uniq",
      "invariant_results_evaluated_at_idx",
      "invariant_results_payment_attempt_id_idx",
      "invariant_results_payment_id_idx",
      "invariant_results_result_idx",
      "invariant_results_severity_idx",
    ]);
  });

  it("12: enables RLS, creates no policy, and revokes anon/authenticated", () => {
    expect(phase3fMigration!.sql).toMatch(
      /alter table public\.invariant_results enable row level security;/i,
    );
    expect(phase3fMigration!.sql).not.toMatch(/create policy/i);
    expect(phase3fMigration!.sql).toMatch(
      /revoke all privileges on table public\.invariant_results from anon, authenticated;/i,
    );
  });

  it("13: grants service_role SELECT/INSERT/DELETE and NO UPDATE to any role — append-only by privilege", () => {
    expect(phase3fMigration!.sql).toMatch(
      /grant select, insert, delete on public\.invariant_results to service_role;/i,
    );
    const grants = [...phase3fMigration!.sql.matchAll(/^\s*grant .*$/gim)];
    expect(grants.length).toBe(1);
    for (const grant of grants) {
      expect(grant[0]!).not.toMatch(/\bupdate\b/i);
    }
    expect(functional(phase3fMigration!.sql)).not.toMatch(/grant all/i);
  });

  it("14: alters no existing table and creates no function, trigger or view", () => {
    for (const table of [
      "orders",
      "payment_attempts",
      "payments",
      "fulfilments",
      "webhook_events",
      "event_processing_attempts",
      "chaos_runs",
    ]) {
      expect(phase3fMigration!.sql).not.toMatch(
        new RegExp(`alter table\\s+public\\.${table}\\b`, "i"),
      );
    }
    expect(functional(phase3fMigration!.sql)).not.toMatch(/create function/i);
    expect(functional(phase3fMigration!.sql)).not.toMatch(/create trigger/i);
    expect(functional(phase3fMigration!.sql)).not.toMatch(/create view/i);
    expect(functional(phase3fMigration!.sql)).not.toMatch(/create or replace/i);
  });

  it("15: creates neither a later-phase table nor any Phase 4 table", () => {
    // THIS migration must still create none of these — including `findings`,
    // which is Phase 3G's to create, not Phase 3F-A's. That per-migration
    // assertion is unchanged and remains the point of the test.
    for (const forbidden of [
      "findings",
      "regression_runs",
      "reliability_score_snapshots",
      "merchants",
    ]) {
      expect(phase3fMigration!.sql).not.toMatch(
        new RegExp(
          `create table\\s+(if not exists\\s+)?(public\\.)?${forbidden}\\b`,
          "i",
        ),
      );
    }
    // Cumulatively, only the genuine Phase 4 tables remain absent —
    // `findings` legitimately arrived in Phase 3G.
    for (const forbidden of [
      "regression_runs",
      "reliability_score_snapshots",
      "merchants",
    ]) {
      expect(extractCreateTableNames(combinedSql)).not.toContain(forbidden);
    }
  });

  it("16: inserts no row — this is a schema-only migration", () => {
    expect(functional(phase3fMigration!.sql)).not.toMatch(/\binsert\s+into\b/i);
    expect(functional(phase3fMigration!.sql)).not.toMatch(
      /\bupdate\s+public\./i,
    );
    expect(functional(phase3fMigration!.sql)).not.toMatch(/\bdelete\s+from\b/i);
  });

  it("17: contains no secret", () => {
    expect(phase3fMigration!.sql).not.toMatch(/RAZORPAY_KEY_SECRET/i);
    expect(phase3fMigration!.sql).not.toMatch(/RAZORPAY_WEBHOOK_SECRET/i);
    expect(phase3fMigration!.sql).not.toMatch(
      /SUPABASE_SERVICE_ROLE_KEY\s*=\s*['"]/i,
    );
  });
});

describe("Phase 3G migration — findings static structural coverage", () => {
  // This describe block statically verifies the Phase 3G migration
  // (supabase/migrations/20260903000000_phase3g_findings.sql) BEFORE it is
  // manually applied to the real Supabase project. Real-Supabase
  // constraint/RLS/persistence behavior is separately proven by
  // tests/integration/supabase/065-phase3g-findings.integration.test.ts,
  // which remains NOT RUN until that manual application happens.
  const phase3gMigration = migrations.find((m) => m.name.includes("phase3g"));

  /** The migration text with SQL comments stripped, so prose cannot satisfy
   * or trip a DDL assertion. */
  const sql = (phase3gMigration?.sql ?? "")
    .split("\n")
    .map((line) => {
      const idx = line.indexOf("--");
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join("\n");

  const tableMatch = sql.match(
    /create table public\.findings\s*\(([\s\S]*?)\n\);/i,
  );
  const body = tableMatch?.[1] ?? "";

  it("the Phase 3G migration exists and is named exactly as approved", () => {
    expect(phase3gMigration).toBeDefined();
    expect(phase3gMigration!.name).toBe("20260903000000_phase3g_findings.sql");
  });

  it("it creates exactly one table — public.findings — and alters no other", () => {
    expect(extractCreateTableNames(sql)).toEqual(["findings"]);
    const altered = [...sql.matchAll(/alter\s+table\s+(\S+)/gi)].map((m) =>
      m[1]!.toLowerCase(),
    );
    expect([...new Set(altered)]).toEqual(["public.findings"]);
  });

  it("it declares exactly the thirteen documented columns", () => {
    expect(body.length).toBeGreaterThan(0);
    for (const column of [
      "id uuid primary key default gen_random_uuid()",
      "invariant_result_id uuid not null",
      "status text not null default 'OPEN'",
      "title text not null",
      "diagnosis_code text",
      "diagnosis_strength text",
      "diagnosis_summary text",
      "recommendation_code text",
      "recommendation_text text",
      "diagnosed_at timestamptz",
      "resolved_at timestamptz",
      "created_at timestamptz not null default now()",
      "updated_at timestamptz not null default now()",
    ]) {
      expect(body.toLowerCase(), column).toContain(column.toLowerCase());
    }
  });

  it("invariant_result_id is NOT NULL and references invariant_results ON DELETE RESTRICT", () => {
    expect(body).toMatch(
      /invariant_result_id uuid not null\s*\n\s*references public\.invariant_results \(id\) on delete restrict/i,
    );
    expect(body).not.toMatch(/on delete cascade/i);
    expect(body).not.toMatch(/on delete set null/i);
  });

  it("exactly one finding may exist per invariant result — a genuine named UNIQUE CONSTRAINT", () => {
    // docs/DATABASE.md Section 17 declares `invariant_result_id` as "FK +
    // UNIQUE" and lists `UNIQUE(invariant_result_id)` under Constraints, so
    // this must be a real table constraint rather than a standalone unique
    // index. Both enforce the same rule, but only the constraint matches the
    // documented contract and appears in information_schema.table_constraints.
    expect(body).toMatch(
      /constraint findings_invariant_result_id_uniq\s+unique \(invariant_result_id\)/i,
    );
    // Not re-declared as a separate index: the constraint creates its own
    // backing unique index, so a second one would be redundant storage.
    expect(sql).not.toMatch(/create unique index/i);
  });

  it("the required unique-index role is satisfied, and the explicit indexes are exactly the other three", () => {
    const explicit = [...sql.matchAll(/create (?:unique )?index (\w+)/gi)].map(
      (m) => m[1]!,
    );
    expect([...explicit].sort()).toEqual([
      "findings_created_at_idx",
      "findings_diagnosis_code_idx",
      "findings_status_idx",
    ]);
    // Section 17's fourth required index — unique on invariant_result_id —
    // is supplied by the UNIQUE constraint's automatic backing index, which
    // PostgreSQL names after the constraint.
    expect(body).toContain("findings_invariant_result_id_uniq");
  });

  it("the status CHECK is exactly the three documented values, defaulting to OPEN", () => {
    const check = body.match(
      /constraint findings_status_valid check \(([\s\S]*?)\)\s*,/i,
    );
    expect(check).not.toBeNull();
    expect(check![1]!).toMatch(/'OPEN',\s*'STILL_FAILING',\s*'RESOLVED'/);
    for (const forbidden of ["CLOSED", "IGNORED", "NEW", "IN_PROGRESS"]) {
      expect(check![1]!, forbidden).not.toContain(forbidden);
    }
    expect(body).toMatch(/status text not null default 'OPEN'/i);
  });

  it("the diagnosis_strength CHECK allows NULL and exactly the three labels", () => {
    const check = body.match(
      /constraint findings_diagnosis_strength_valid check \(([\s\S]*?)\)\s*,/i,
    );
    expect(check).not.toBeNull();
    expect(check![1]!).toMatch(/diagnosis_strength is null/i);
    expect(check![1]!).toMatch(
      /'STRONG_EVIDENCE',\s*'PARTIAL_EVIDENCE',\s*'INSUFFICIENT_EVIDENCE'/,
    );
    // Never a probabilistic confidence score (docs/DATABASE.md Section 17).
    expect(check![1]!.toLowerCase()).not.toContain("confidence");
    expect(check![1]!).not.toMatch(/\bnumeric\b/i);
  });

  it("resolved_at is non-null IF AND ONLY IF status is RESOLVED (architect ruling)", () => {
    // The constraint is the LAST item in the table body, so it is terminated
    // by the body's own close rather than by a comma — capture to the end.
    const check = body.match(
      /constraint findings_resolved_at_consistent check \(([\s\S]*)$/i,
    );
    expect(check).not.toBeNull();
    const expression = check![1]!.replace(/\s+/g, " ").toLowerCase();
    expect(expression).toContain(
      "status = 'resolved' and resolved_at is not null",
    );
    expect(expression).toContain(
      "status <> 'resolved' and resolved_at is null",
    );
  });

  it("no speculative index is added beyond the four Section 17 requires", () => {
    const explicit = [...sql.matchAll(/create (?:unique )?index (\w+)/gi)].map(
      (m) => m[1]!,
    );
    expect(explicit).toHaveLength(3);
    for (const name of explicit) {
      expect(name.startsWith("findings_")).toBe(true);
    }
    // Nothing indexed that Section 17 does not ask for.
    for (const forbidden of ["title", "updated_at", "resolved_at"]) {
      expect(sql).not.toMatch(
        new RegExp(`create index \\w*${forbidden}\\w* on`, "i"),
      );
    }
  });

  it("RLS is enabled with ZERO policies", () => {
    expect(sql).toMatch(
      /alter table public\.findings enable row level security/i,
    );
    expect(sql).not.toMatch(/create policy/i);
  });

  it("anon and authenticated are explicitly revoked and never granted", () => {
    expect(sql).toMatch(
      /revoke all privileges on table public\.findings from anon, authenticated/i,
    );
    expect(sql).not.toMatch(/grant[^;]*\bto\s+anon\b/i);
    expect(sql).not.toMatch(/grant[^;]*\bto\s+authenticated\b/i);
  });

  it("service_role holds exactly SELECT, INSERT, UPDATE, DELETE", () => {
    expect(sql).toMatch(
      /grant select, insert, update, delete on public\.findings to service_role/i,
    );
  });

  it("it writes no row, creates no function, trigger or view", () => {
    expect(sql).not.toMatch(/\binsert\s+into\b/i);
    expect(sql).not.toMatch(/create (or replace )?function/i);
    expect(sql).not.toMatch(/create trigger/i);
    expect(sql).not.toMatch(/create (or replace )?view/i);
  });

  it("it introduces no Phase 4 or generic-evidence table", () => {
    for (const forbidden of [
      "regression_runs",
      "reliability_score_snapshots",
      "finding_evidence",
      "evidence_items",
    ]) {
      expect(sql.toLowerCase(), forbidden).not.toContain(forbidden);
    }
  });

  it("it duplicates no authoritative invariant-result column onto findings", () => {
    // Evidence is reached through invariant_result_id, never copied.
    for (const forbidden of [
      "severity",
      "expected_summary",
      "observed_summary",
      "evidence_refs",
      "chaos_run_id",
      "order_id",
      "payment_attempt_id",
      "payment_id",
    ]) {
      expect(body.toLowerCase(), forbidden).not.toContain(forbidden);
    }
  });
});
