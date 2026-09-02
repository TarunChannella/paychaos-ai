import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Phase 4E-R1 — the migration, proved from its SQL text.
 *
 * The remote database does not have this table yet: the migration is created
 * here and applied only after architect review. These assertions are therefore
 * the ONLY thing standing between a mistake in the DDL and a schema change
 * against the real project, so they read the file rather than the database.
 */

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");
const MIGRATION_NAME = "20260904000000_phase4e_regression_runs.sql";

const migrationFiles = readdirSync(MIGRATIONS_DIR)
  .filter((name) => name.endsWith(".sql"))
  .sort();

const sql = readFileSync(join(MIGRATIONS_DIR, MIGRATION_NAME), "utf8");
const lower = sql.toLowerCase();

/** SQL with every `--` comment line removed, so prose never satisfies a check. */
const code = sql
  .split(/\r?\n/)
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");
const codeLower = code.toLowerCase();

describe("Phase 4E-R1 migration — file", () => {
  it("1: the migration exists under the exact expected name", () => {
    expect(migrationFiles).toContain(MIGRATION_NAME);
  });

  it("2: it is the newest migration, and the count is now thirteen", () => {
    // Advanced for the Phase 5 Demo Reset fix, which legitimately adds one
    // additive migration (a narrow reset function; no table change). The
    // protection is unchanged: THIS phase still contributes no migration of
    // its own, and the earlier migrations stay exactly where they were.
    // Advanced again for the safeupdate fix, which legitimately adds one
    // additive migration (CREATE OR REPLACE of the reset function; no table
    // change). THIS phase still contributes no migration of its own.
    expect(migrationFiles).toHaveLength(15);
    expect(migrationFiles.at(-1)).toBe(
      "20260906000000_phase5_demo_reset_safeupdate.sql",
    );
    expect(migrationFiles.at(-2)).toBe(
      "20260905000000_phase5_demo_reset_atomic.sql",
    );
    expect(migrationFiles.at(-3)).toBe(MIGRATION_NAME);
    // The Phase 3G findings migration remains its immediate predecessor.
    expect(migrationFiles.at(-4)).toBe("20260903000000_phase3g_findings.sql");
  });

  it("3: exactly one table is created, and it is regression_runs", () => {
    const creates = codeLower.match(/create\s+table/g) ?? [];
    expect(creates).toHaveLength(1);
    expect(codeLower).toContain("create table public.regression_runs");
  });

  it("4: no earlier table is altered", () => {
    expect(codeLower).not.toContain("alter table public.findings");
    expect(codeLower).not.toContain("alter table public.chaos_runs");
    expect(codeLower).not.toContain("alter table public.invariant_results");
    expect(codeLower).not.toContain("alter table public.orders");
    expect(codeLower).not.toContain("alter table public.payments");
    expect(codeLower).not.toContain("alter table public.webhook_events");
    // The only ALTER TABLE permitted is the RLS toggle on the new table.
    const alters = codeLower.match(/alter\s+table\s+\S+/g) ?? [];
    expect(alters).toEqual(["alter table public.regression_runs"]);
  });

  it("5: no function, trigger, view or RPC is created", () => {
    for (const forbidden of [
      "create function",
      "create or replace function",
      "create trigger",
      "create view",
      "create or replace view",
      "create materialized view",
      "create procedure",
    ]) {
      expect(codeLower, forbidden).not.toContain(forbidden);
    }
  });

  it("6: no later-phase table is created", () => {
    expect(codeLower).not.toContain("reliability_score_snapshots");
    expect(codeLower).not.toContain("score_snapshots");
  });

  it("7: it writes no row", () => {
    for (const forbidden of ["insert into", "update public.", "delete from"]) {
      expect(codeLower, forbidden).not.toContain(forbidden);
    }
  });
});

describe("Phase 4E-R1 migration — columns", () => {
  const expectedColumns = [
    "id",
    "finding_id",
    "chaos_run_id",
    "status",
    "started_at",
    "completed_at",
    "created_at",
  ];

  it("8: the seven frozen columns are declared", () => {
    expect(codeLower).toContain(
      "id uuid primary key default gen_random_uuid()",
    );
    expect(codeLower).toContain("finding_id uuid not null");
    expect(codeLower).toContain("chaos_run_id uuid not null");
    expect(codeLower).toContain("status text not null default 'pending'");
    expect(codeLower).toContain("started_at timestamptz");
    expect(codeLower).toContain("completed_at timestamptz");
    expect(codeLower).toContain(
      "created_at timestamptz not null default now()",
    );
    expect(expectedColumns).toHaveLength(7);
  });

  it("9: there is NO updated_at column", () => {
    // docs/DATABASE.md Section 18 defines seven columns and no such column.
    // Asserted against the CREATE TABLE body specifically: the `comment on`
    // text deliberately EXPLAINS the absence, and that prose must not be
    // mistaken for a declaration.
    const body = codeLower.slice(
      codeLower.indexOf("create table public.regression_runs"),
      codeLower.indexOf("comment on table"),
    );
    expect(body.length).toBeGreaterThan(0);
    expect(body).not.toContain("updated_at");

    // And all seven frozen columns really are declared in that body.
    for (const column of expectedColumns) {
      expect(body, column).toContain(column);
    }
  });

  it("10: there is no JSONB, and no copied scenario/invariant/prose column", () => {
    expect(codeLower).not.toContain("jsonb");
    expect(codeLower).not.toContain("scenario_id text");
    expect(codeLower).not.toContain("invariant_id");
    expect(codeLower).not.toContain("reason text");
    expect(codeLower).not.toContain("error_message");
    expect(codeLower).not.toContain("diagnosis_");
    expect(codeLower).not.toContain("recommendation_");
  });
});

describe("Phase 4E-R1 migration — constraints", () => {
  it("11: both foreign keys are ON DELETE RESTRICT", () => {
    expect(codeLower).toContain(
      "references public.findings (id) on delete restrict",
    );
    expect(codeLower).toContain(
      "references public.chaos_runs (id) on delete restrict",
    );
  });

  it("12: no foreign key cascades or nulls evidence away", () => {
    expect(codeLower).not.toContain("on delete cascade");
    expect(codeLower).not.toContain("on delete set null");
  });

  it("13: the status CHECK lists exactly the five approved values", () => {
    expect(code).toContain(
      "status in ('PENDING', 'RUNNING', 'RESOLVED', 'STILL_FAILING', 'ERROR')",
    );
  });

  it("14: chaos_run_id is UNIQUE as a named table constraint", () => {
    expect(codeLower).toContain(
      "constraint regression_runs_chaos_run_id_uniq unique (chaos_run_id)",
    );
  });

  it("15: there is NO UNIQUE(finding_id) over all history", () => {
    // A finding may be re-tested many times; only ACTIVE runs are bounded.
    expect(codeLower).not.toContain("unique (finding_id)");
    expect(codeLower).not.toContain("unique(finding_id)");
  });

  it("16: there is no timestamp/status consistency CHECK (decision D-1)", () => {
    // Lifecycle consistency is the repository's, enforced by explicit
    // transitions. docs/DATABASE.md Section 18 freezes only the status CHECK.
    const checks = codeLower.match(/constraint\s+\S+\s+check/g) ?? [];
    expect(checks).toHaveLength(1);
    expect(codeLower).not.toContain("started_at is null");
    expect(codeLower).not.toContain("completed_at is not null");
  });
});

describe("Phase 4E-R1 migration — indexes", () => {
  it("17: finding_id, status and created_at each have an index", () => {
    expect(codeLower).toContain(
      "create index regression_runs_finding_id_idx\n  on public.regression_runs (finding_id)",
    );
    expect(codeLower).toContain(
      "create index regression_runs_status_idx\n  on public.regression_runs (status)",
    );
    expect(codeLower).toContain(
      "create index regression_runs_created_at_idx\n  on public.regression_runs (created_at)",
    );
  });

  it("18: the active-regression partial unique index exists with the exact predicate", () => {
    expect(codeLower).toContain(
      "create unique index regression_runs_active_finding_uniq",
    );
    expect(code).toContain("where status in ('PENDING', 'RUNNING')");
  });

  it("19: the partial index is documented as a concurrency boundary", () => {
    // A future reader must not mistake it for a one-regression-ever rule.
    expect(lower).toContain("concurrency boundary");
    expect(lower).toContain("not a one-regression-ever");
  });
});

describe("Phase 4E-R1 migration — RLS and privileges", () => {
  it("20: row level security is enabled", () => {
    expect(codeLower).toContain(
      "alter table public.regression_runs enable row level security",
    );
  });

  it("21: no policy is created at all", () => {
    expect(codeLower).not.toContain("create policy");
    expect(codeLower).not.toContain("using (true)");
    expect(codeLower).not.toContain("with check (true)");
  });

  it("22: anon and authenticated are explicitly revoked", () => {
    expect(codeLower).toContain(
      "revoke all privileges on table public.regression_runs from anon, authenticated",
    );
  });

  it("23: only service_role is granted, and no privilege reaches a browser role", () => {
    expect(codeLower).toContain(
      "grant select, insert, update, delete on public.regression_runs to service_role",
    );
    const grants = codeLower.match(/grant[^;]+;/g) ?? [];
    expect(grants).toHaveLength(1);
    for (const grant of grants) {
      expect(grant).not.toContain(" anon");
      expect(grant).not.toContain("authenticated");
      expect(grant).not.toContain("public;");
    }
  });

  it("24: the privilege model matches the frozen findings migration's shape", () => {
    const findings = readFileSync(
      join(MIGRATIONS_DIR, "20260903000000_phase3g_findings.sql"),
      "utf8",
    ).toLowerCase();
    for (const clause of [
      "enable row level security",
      "revoke all privileges on table",
      "grant select, insert, update, delete on public.",
    ]) {
      expect(findings, clause).toContain(clause);
      expect(codeLower, clause).toContain(clause);
    }
  });
});

describe("Phase 4E-R1 migration — documentation", () => {
  it("25: the comments record what the table is and what stays immutable", () => {
    expect(codeLower).toContain("comment on table public.regression_runs");
    for (const column of [
      "finding_id",
      "chaos_run_id",
      "status",
      "started_at",
      "completed_at",
      "created_at",
    ]) {
      expect(codeLower, column).toContain(
        `comment on column public.regression_runs.${column}`,
      );
    }
  });

  it("26: ERROR is documented as 'proved nothing', not as a payment failure", () => {
    expect(lower).toContain("not a claim that a payment failed");
  });
});
