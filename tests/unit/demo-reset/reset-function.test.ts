import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { DEMO_RESET_TABLES, DEMO_RESET_RPC } =
  await import("@/lib/demo-reset/service");

/**
 * Phase 5 — the Demo Reset database function.
 *
 * WHY THESE TESTS EXIST. A production Demo Reset failed on
 * `event_processing_attempts` and left the database partially reset. Two
 * separate faults combined: a deletion order that violated a foreign key, and
 * ten independent requests with no transaction around them.
 *
 * The order fault survived review because the old unit test asserted a
 * HAND-WRITTEN list of parent/child pairs and simply did not include
 * `fulfilments -> event_processing_attempts`. So the order test here does not
 * accept a curated list from anyone: it parses every `references` clause out
 * of the migrations and requires the reset order to satisfy all of them.
 */

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

const RUNTIME_TABLES = new Set<string>(DEMO_RESET_TABLES);

/** Every migration, oldest first, with SQL comments stripped. */
function migrationSql(): { readonly file: string; readonly sql: string }[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((file) => ({
      file,
      sql: readFileSync(join(MIGRATIONS_DIR, file), "utf8")
        .split("\n")
        .filter((line) => !line.trimStart().startsWith("--"))
        .join("\n"),
    }));
}

interface Edge {
  readonly child: string;
  readonly parent: string;
  readonly rule: string;
}

/**
 * Derives the foreign-key graph among the ten runtime tables from the
 * migrations themselves — never from documentation or a constant.
 */
function foreignKeyEdges(): Edge[] {
  const edges: Edge[] = [];

  for (const { sql } of migrationSql()) {
    let owner: string | null = null;
    // A `references` clause can sit on the line after its column, so the
    // scanner tracks the enclosing CREATE/ALTER TABLE across lines.
    for (const raw of sql.split("\n")) {
      const line = raw.trim().toLowerCase();

      const created = /^create table(?: if not exists)? public\.([a-z_]+)/.exec(
        line,
      );
      if (created?.[1] !== undefined) {
        owner = created[1];
        continue;
      }

      const altered = /^alter table(?: if exists)? public\.([a-z_]+)/.exec(
        line,
      );
      if (altered?.[1] !== undefined) {
        owner = altered[1];
        continue;
      }

      const ref = /references\s+public\.([a-z_]+)/.exec(line);
      if (ref?.[1] === undefined || owner === null) continue;

      const parent = ref[1];
      if (!RUNTIME_TABLES.has(owner) || !RUNTIME_TABLES.has(parent)) continue;
      if (owner === parent) continue;

      edges.push({
        child: owner,
        parent,
        rule: /on delete (\w+)/.exec(line)?.[1] ?? "no action",
      });
    }
  }

  return edges;
}

describe("demo reset — the deletion order obeys the real schema", () => {
  it("1: the FK graph is actually discoverable from the migrations", () => {
    // A parser that silently found nothing would make every test below
    // vacuous, so the discovery itself is asserted first.
    expect(foreignKeyEdges().length).toBeGreaterThanOrEqual(20);
  });

  it("2: the exact pair that broke production is present and ordered", () => {
    const order = [...DEMO_RESET_TABLES] as string[];

    const culprit = foreignKeyEdges().find(
      (e) =>
        e.child === "fulfilments" && e.parent === "event_processing_attempts",
    );
    expect(culprit, "the regression's own FK must exist").toBeDefined();
    expect(culprit?.rule).toBe("restrict");

    expect(order.indexOf("fulfilments")).toBeLessThan(
      order.indexOf("event_processing_attempts"),
    );
    expect(order.indexOf("fulfilments")).toBeLessThan(
      order.indexOf("payments"),
    );
  });

  it("3: EVERY derived child precedes EVERY one of its parents", () => {
    const order = [...DEMO_RESET_TABLES] as string[];

    for (const { child, parent, rule } of foreignKeyEdges()) {
      expect(
        order.indexOf(child),
        `${child} -[${rule}]-> ${parent}: child must be deleted first`,
      ).toBeLessThan(order.indexOf(parent));
    }
  });

  it("4: every runtime FK is RESTRICT, so order is mandatory not optional", () => {
    // If any edge were CASCADE, order would be forgiving. None is — deleting
    // a parent first is always an outright error, which is why this class of
    // bug deserves a schema-derived test rather than a curated one.
    for (const edge of foreignKeyEdges()) {
      expect(edge.rule, `${edge.child} -> ${edge.parent}`).toBe("restrict");
    }
  });

  it("5: the order covers exactly the ten approved tables, no more", () => {
    expect(new Set(DEMO_RESET_TABLES).size).toBe(10);
  });
});

describe("demo reset — the migration is narrow and safe", () => {
  /**
   * The migration that currently DEFINES the deployed behaviour.
   *
   * The function is defined once and then replaced by a later migration, so
   * the assertions below must read the LAST definition. Reading the first
   * would test a version of the function that production no longer runs —
   * which is how a fix can appear verified while the live code is stale.
   */
  const resetMigration = migrationSql()
    .filter((m) => m.sql.includes(`function public.${DEMO_RESET_RPC}`))
    .at(-1);

  /**
   * The EXECUTABLE body of the function, between the dollar quotes.
   *
   * Structural bans are asserted against this rather than the whole file on
   * purpose. The migration legitimately contains the words CASCADE and
   * TRUNCATE inside `comment on function ... is '...'`, where they document
   * what the function refuses to do, and the word EXECUTE inside the GRANT
   * statement. Matching those would be matching prose and privileges, not
   * behaviour — and banning a word from a comment would only teach the next
   * author to describe the danger less clearly.
   */
  function functionBody(): string {
    const sql = resetMigration?.sql ?? "";
    const start = sql.indexOf("as $$");
    const end = sql.lastIndexOf("$$;");
    expect(start, "the function body must be locatable").toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return sql.slice(start, end).toLowerCase();
  }

  function deletedTables(): string[] {
    return [
      ...(resetMigration?.sql.matchAll(/delete from public\.([a-z_]+)/g) ?? []),
    ].map((m) => m[1] as string);
  }

  it("6: the function is CREATEd exactly once and only ever replaced", () => {
    expect(resetMigration, "reset migration must exist").toBeDefined();

    // A second bare `create function` would fail against a database that
    // already has it; a later change must be `create or replace`.
    const created = migrationSql().filter((m) =>
      m.sql.includes(`create function public.${DEMO_RESET_RPC}`),
    );
    expect(created).toHaveLength(1);

    // And the definition in force is the newest one.
    expect(resetMigration?.sql).toContain(
      `create or replace function public.${DEMO_RESET_RPC}()`,
    );
  });

  it("7: the function takes zero arguments", () => {
    expect(resetMigration?.sql).toContain(
      `function public.${DEMO_RESET_RPC}()`,
    );
    // Nothing a caller supplies can reach it: every mention of the function
    // in the migration is the zero-argument form.
    const mentions =
      resetMigration?.sql.split(`public.${DEMO_RESET_RPC}`) ?? [];
    for (const tail of mentions.slice(1)) {
      expect(tail.startsWith("()"), tail.slice(0, 40)).toBe(true);
    }
  });

  it("8: it deletes only the ten approved runtime tables", () => {
    const deleted = deletedTables();

    expect(deleted).toHaveLength(10);
    expect(new Set(deleted)).toEqual(new Set<string>(DEMO_RESET_TABLES));
  });

  it("9: the function statement order matches the exported order", () => {
    // The constant is documentation; the function is what runs. If they ever
    // disagree the documentation is lying, so they are pinned together.
    expect(deletedTables()).toEqual([...DEMO_RESET_TABLES]);
  });

  it("9b: SAFEUPDATE — every DELETE carries a WHERE clause", () => {
    // THE GUARD THAT WOULD HAVE CAUGHT THE PRODUCTION BUG.
    //
    // Supabase's `safeupdate` refuses an unqualified DELETE in the API role
    // context, so `delete from public.fulfilments;` fails with SQLSTATE
    // 21000 ("DELETE requires a WHERE clause") through PostgREST while
    // succeeding in the SQL editor. The function was therefore correct about
    // order and atomicity and still could not run from the application.
    //
    // Reading statement-by-statement, rather than checking the body for the
    // word "where", is what makes this catch a SINGLE regressed statement
    // among ten correct ones.
    // Each DELETE is read from its own keyword up to its terminating
    // semicolon, so a single regressed statement among ten correct ones is
    // still caught.
    const statements = functionBody().match(/delete from public\.[^;]*/g) ?? [];

    expect(statements).toHaveLength(10);

    for (const statement of statements) {
      expect(statement, `unqualified DELETE: "${statement}"`).toContain(
        "where",
      );
    }
  });

  it("9c: SAFEUPDATE — every DELETE is qualified by a non-null key", () => {
    // `where id is not null` is always true for an existing row because `id`
    // is each table's primary key, so the sweep is still whole-table. It is
    // preferred over `where true` because its always-true-ness comes from a
    // schema guarantee rather than from a literal.
    const body = functionBody();

    for (const table of DEMO_RESET_TABLES) {
      expect(body, table).toContain(
        `delete from public.${table} where id is not null`,
      );
    }
  });

  it("9d: SAFEUPDATE — the guard is never disabled to get around this", () => {
    // Switching the protection off for the duration of the function would
    // remove it from every other statement in that session, to dodge a rule
    // this function should simply satisfy.
    //
    // Asserted against the EXECUTABLE BODY, not the whole file: the
    // migration's own comment legitimately names safeupdate to explain what
    // the predicates are for, and banning the word from documentation would
    // only teach the next author to explain the hazard less clearly.
    const body = functionBody();

    for (const banned of [
      "safeupdate",
      "session_replication_role",
      "set local",
      "reset all",
    ]) {
      expect(body, banned).not.toContain(banned);
    }
  });

  it("10: no dynamic SQL — nothing to inject into", () => {
    const body = functionBody();

    // plpgsql EXECUTE is the only way to run a constructed string here, and
    // every string-building primitive is banned alongside it.
    // plpgsql EXECUTE is the only way to run a constructed string, and every
    // string-building primitive is banned alongside it. `||` is deliberately
    // NOT banned: the body uses it for jsonb concatenation when building the
    // deleted-row counts, which never becomes part of a statement.
    for (const banned of [
      "execute ",
      "format(",
      "quote_ident",
      "quote_literal",
    ]) {
      expect(body, banned).not.toContain(banned);
    }
  });

  it("11: no CASCADE, no TRUNCATE, no DROP, no ALTER", () => {
    const body = functionBody();

    for (const banned of [
      "cascade",
      "truncate",
      "drop ",
      "alter ",
      "create ",
      "grant ",
      "update ",
      "insert ",
    ]) {
      expect(body, banned).not.toContain(banned);
    }

    // Whatever else it does, the body's only data statements are DELETEs,
    // one per approved table and nothing else.
    const dataStatements = body.match(/(delete|update|insert|merge) from/g);
    expect(dataStatements ?? []).toHaveLength(10);
    expect(new Set(dataStatements ?? [])).toEqual(new Set(["delete from"]));
  });

  it("11b: ATOMICITY — the body has no exception handler", () => {
    const body = functionBody();

    // THIS IS THE ATOMICITY GUARANTEE, and it is easy to lose by accident.
    //
    // A plpgsql block with an `EXCEPTION` clause runs inside an implicit
    // SUBTRANSACTION. If the reset ever grew a `begin ... exception when
    // others then ... end` wrapper — the instinctive way to "handle" a
    // failure and return a tidy error — a failing DELETE would be caught,
    // the subtransaction rolled back, and the function would RETURN
    // NORMALLY. The outer transaction would then COMMIT every delete that
    // ran before the failure: exactly the partial reset that occurred in
    // production, reintroduced while looking like better error handling.
    //
    // With no handler, the error propagates, the statement aborts, and every
    // delete in the call rolls back together.
    expect(body).not.toContain("exception");

    // One `begin`/`end` pair only — the function block itself. A nested
    // block is the construct an exception handler would need.
    expect(body.match(/\bbegin\b/g) ?? []).toHaveLength(1);
  });

  it("11c: ATOMICITY — the whole reset is one function, one call", () => {
    // Ten separate statements from application code cannot share a
    // transaction over PostgREST; ten statements inside one function
    // necessarily do. The service test asserts the caller side; this asserts
    // the database side actually contains all ten deletes.
    expect(deletedTables()).toHaveLength(10);
  });

  it("12: execute is revoked from PUBLIC, anon and authenticated", () => {
    const sql = resetMigration?.sql.toLowerCase() ?? "";

    expect(sql).toContain(
      `revoke all on function public.${DEMO_RESET_RPC}() from public`,
    );
    expect(sql).toContain(
      `revoke all on function public.${DEMO_RESET_RPC}() from anon, authenticated`,
    );
  });

  it("13: service_role is the only granted executor", () => {
    const sql = resetMigration?.sql.toLowerCase() ?? "";
    const grants = [...sql.matchAll(/grant execute on function [^;]+;/g)].map(
      (m) => m[0],
    );

    expect(grants).toHaveLength(1);

    // Parse the GRANTEE LIST, not the whole statement: the statement always
    // contains the word "public" as the SCHEMA qualifier of the function
    // name, which is not a role and must not be mistaken for one.
    const grantees = (/\sto\s+([^;]+);/.exec(grants[0] ?? "")?.[1] ?? "")
      .split(",")
      .map((role) => role.trim());

    expect(grantees).toEqual(["service_role"]);
  });

  it("14: it touches no schema, auth, storage or configuration surface", () => {
    const sql = resetMigration?.sql.toLowerCase() ?? "";

    for (const forbidden of [
      "auth.",
      "storage.",
      "schema_migrations",
      "pg_policies",
      "row level security",
      "create policy",
    ]) {
      expect(sql, forbidden).not.toContain(forbidden);
    }
  });

  it("15: search_path is pinned and privileges are not elevated", () => {
    const sql = resetMigration?.sql.toLowerCase() ?? "";

    expect(sql).toContain("set search_path = public");
    // `security definer` would run the deletes as the function's owner. The
    // trusted caller already holds DELETE on all ten tables, so elevating
    // privileges here would be unnecessary risk.
    expect(sql).not.toContain("security definer");
    expect(sql).toContain("security invoker");
  });
});
