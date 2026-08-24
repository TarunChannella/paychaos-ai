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

describe("Migration set creates exactly the approved Phase 1 + Phase 2B + Phase 2C + Phase 2D tables (#5, #6, #7)", () => {
  const tableNames = extractCreateTableNames(combinedSql);

  // Phase 1 created orders/payment_attempts/fulfilments (#5-#7). Phase 2B
  // was purely additive-columns (no new CREATE TABLE). Phase 2C legitimately
  // adds `payments` via its own additive migration
  // (supabase/migrations/20260825000000_phase2c_payments.sql,
  // docs/DATABASE.md Section 11). Phase 2D legitimately adds
  // `webhook_events` via its own additive migration
  // (supabase/migrations/20260826000000_phase2d_webhook_events.sql,
  // docs/DATABASE.md Section 13) — this is the current approved cumulative
  // table set, not a Phase 1 boundary violation.
  it("creates orders, payment_attempts, payments, fulfilments, webhook_events and nothing else", () => {
    expect([...tableNames].sort()).toEqual([
      "fulfilments",
      "orders",
      "payment_attempts",
      "payments",
      "webhook_events",
    ]);
  });

  it("does not create any other Phase 2E+/3+/4+ table", () => {
    const forbidden = [
      "event_processing_attempts",
      "chaos_runs",
      "invariant_results",
      "findings",
      "regression_runs",
      "reliability_score_snapshots",
      "merchants",
    ];
    for (const name of forbidden) {
      expect(tableNames).not.toContain(name);
    }
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

describe("Phase 1C-A/2C/2D RLS is explicitly enabled on all 5 tables (#13)", () => {
  for (const table of [
    "orders",
    "payment_attempts",
    "payments",
    "fulfilments",
    "webhook_events",
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

  it("every GRANT targets only service_role, and only the 5 approved tables", () => {
    const grantLines = combinedSql
      .split("\n")
      .filter((line) => /^\s*grant\s/i.test(line));
    expect(grantLines.length).toBeGreaterThan(0);
    for (const line of grantLines) {
      expect(line).toMatch(/to service_role/i);
      expect(line).toMatch(
        /public\.(orders|payment_attempts|payments|fulfilments|webhook_events)/i,
      );
    }
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

  it("gen_random_uuid() remains the UUID default for all five tables", () => {
    const occurrences = [
      ...combinedSql.matchAll(
        /id uuid primary key default gen_random_uuid\(\)/gi,
      ),
    ];
    expect(occurrences.length).toBe(5);
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

  it("contains no GRANT statement for anon anywhere in the file", () => {
    expect(combinedSql).not.toMatch(/grant[^;]*\bto\s+anon\b/i);
  });

  it("contains no GRANT statement for authenticated anywhere in the file", () => {
    expect(combinedSql).not.toMatch(/grant[^;]*\bto\s+authenticated\b/i);
  });

  it("service_role retains explicit CRUD grants on exactly the five tables", () => {
    const grantLines = combinedSql
      .split("\n")
      .filter((line) => /^\s*grant\s/i.test(line));
    expect(grantLines.length).toBe(5);
    for (const line of grantLines) {
      expect(line).toMatch(/select,\s*insert,\s*update,\s*delete/i);
      expect(line).toMatch(/to service_role/i);
      expect(line).toMatch(
        /public\.(orders|payment_attempts|payments|fulfilments|webhook_events)/i,
      );
    }
  });

  it("RLS remains enabled on all five tables", () => {
    for (const table of [
      "orders",
      "payment_attempts",
      "payments",
      "fulfilments",
      "webhook_events",
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
