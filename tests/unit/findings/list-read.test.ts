import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * Phase 5B — the Findings index read model.
 *
 * "No findings" is the strongest claim this product makes about a merchant's
 * integration. These tests exist mainly to prove it is only ever said when
 * the database genuinely holds none — never because a query failed.
 */

const calls: string[] = [];
let responses: { data: unknown; error: unknown }[] = [];
const ops: string[] = [];

function makeBuilder() {
  const builder: Record<string, unknown> = {};
  const chain = (fn?: () => void) => () => {
    fn?.();
    return builder;
  };
  builder.select = chain();
  builder.in = chain();
  builder.eq = chain();
  builder.order = chain();
  for (const op of ["insert", "update", "delete", "upsert"] as const) {
    builder[op] = chain(() => ops.push(op));
  }
  builder.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(responses.shift() ?? { data: [], error: null }).then(
      resolve,
    );
  return builder;
}

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: () => ({
    from(table: string) {
      calls.push(table);
      return makeBuilder();
    },
  }),
}));

const { listFindings, FindingListReadError } =
  await import("@/lib/findings/list-read");

function finding(id: string, resultId: string, created: string) {
  return {
    id,
    invariant_result_id: resultId,
    title: `Finding ${id}`,
    status: "OPEN",
    created_at: created,
  };
}

beforeEach(() => {
  calls.length = 0;
  ops.length = 0;
  responses = [];
});

describe("findings list — ordering and projection", () => {
  it("1: CRITICAL sorts above HIGH, MEDIUM and LOW", async () => {
    responses = [
      {
        data: [
          finding("f-low", "r-low", "2026-09-01T00:00:00Z"),
          finding("f-crit", "r-crit", "2026-08-01T00:00:00Z"),
          finding("f-med", "r-med", "2026-09-02T00:00:00Z"),
        ],
        error: null,
      },
      {
        data: [
          {
            id: "r-low",
            invariant_id: "INV-012",
            severity: "LOW",
            chaos_run_id: null,
          },
          {
            id: "r-crit",
            invariant_id: "INV-002",
            severity: "CRITICAL",
            chaos_run_id: null,
          },
          {
            id: "r-med",
            invariant_id: "INV-005",
            severity: "MEDIUM",
            chaos_run_id: null,
          },
        ],
        error: null,
      },
      { data: [], error: null },
    ];

    const rows = await listFindings();

    // Severity first — an operator opens this page to triage, not to browse.
    expect(rows.map((r) => r.severity)).toEqual(["CRITICAL", "MEDIUM", "LOW"]);
  });

  it("2: an unresolvable severity is reported CRITICAL, never dropped", async () => {
    responses = [
      {
        data: [finding("f-1", "missing", "2026-09-01T00:00:00Z")],
        error: null,
      },
      { data: [], error: null },
      { data: [], error: null },
    ];

    const rows = await listFindings();

    expect(rows).toHaveLength(1);
    expect(rows[0]!.severity).toBe("CRITICAL");
  });

  it("3: the newest regression per finding wins", async () => {
    responses = [
      { data: [finding("f-1", "r-1", "2026-08-01T00:00:00Z")], error: null },
      {
        data: [
          {
            id: "r-1",
            invariant_id: "INV-002",
            severity: "CRITICAL",
            chaos_run_id: null,
          },
        ],
        error: null,
      },
      {
        data: [
          {
            finding_id: "f-1",
            status: "STILL_FAILING",
            created_at: "2026-08-02T00:00:00Z",
          },
          {
            finding_id: "f-1",
            status: "RESOLVED",
            created_at: "2026-09-01T00:00:00Z",
          },
        ],
        error: null,
      },
    ];

    expect((await listFindings())[0]!.regressionStatus).toBe("RESOLVED");
  });

  it("4: a finding with no regression reports null, not a status", async () => {
    responses = [
      { data: [finding("f-1", "r-1", "2026-08-01T00:00:00Z")], error: null },
      {
        data: [
          {
            id: "r-1",
            invariant_id: "INV-002",
            severity: "CRITICAL",
            chaos_run_id: null,
          },
        ],
        error: null,
      },
      { data: [], error: null },
    ];

    expect((await listFindings())[0]!.regressionStatus).toBeNull();
  });

  it("5: it never writes", async () => {
    responses = [{ data: [], error: null }];
    await listFindings();
    expect(ops).toEqual([]);
  });

  it("6: a genuinely empty database returns [] after a successful query", async () => {
    responses = [{ data: [], error: null }];

    expect(await listFindings()).toEqual([]);
    // Only the findings query ran; nothing else was needed.
    expect(calls).toEqual(["findings"]);
  });
});

describe("findings list — READ FAILURE IS NOT 'NO FINDINGS'", () => {
  it("7: a findings read error throws", async () => {
    responses = [{ data: null, error: { message: "timeout" } }];

    await expect(listFindings()).rejects.toBeInstanceOf(FindingListReadError);
  });

  it("8: an invariant read error throws", async () => {
    responses = [
      { data: [finding("f-1", "r-1", "2026-08-01T00:00:00Z")], error: null },
      { data: null, error: { message: "timeout" } },
    ];

    await expect(listFindings()).rejects.toBeInstanceOf(FindingListReadError);
  });

  it("9: a failed read NEVER resolves to an empty list", async () => {
    // The single most dangerous outcome: an outage rendered as "your
    // integration currently has no unresolved failure".
    responses = [{ data: null, error: { message: "timeout" } }];

    let resolved: unknown = "not-called";
    await listFindings()
      .then((v) => {
        resolved = v;
      })
      .catch(() => {});

    expect(resolved).toBe("not-called");
  });

  it("10: no raw database message escapes", async () => {
    responses = [
      {
        data: null,
        error: {
          message: 'relation "findings" does not exist',
          code: "PGRST205",
        },
      },
    ];

    const error = await listFindings().catch((e: unknown) => e);
    const text = `${(error as Error).name} ${(error as Error).message} ${
      (error as { code?: string }).code
    }`;

    for (const leaked of ["relation", "does not exist", "PGRST205"]) {
      expect(text, leaked).not.toContain(leaked);
    }
  });
});
