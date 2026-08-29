import { describe, expect, it, vi } from "vitest";

/**
 * Phase 3F evidence-compatibility correction — the PURE C03 mutation-snapshot
 * contract (`lib/chaos/c03-mutation-snapshot.ts`).
 *
 * No Supabase, no network, no mocks beyond `server-only`. These tests prove
 * the properties docs/MONEY_INVARIANTS.md INV-005 depends on: determinism,
 * total ordering by internal UUID, honest completeness, the `null` vs empty
 * distinction, and the absence of any verdict or sensitive field.
 */
vi.mock("server-only", () => ({}));

import {
  buildC03MutationSnapshot,
  C03_MUTATION_SNAPSHOT_MAX_ROWS,
  C03_MUTATION_SNAPSHOT_VERSION,
  serializeC03MutationEvidence,
  serializeC03MutationSnapshot,
  type C03MutationSnapshotSource,
} from "@/lib/chaos/c03-mutation-snapshot";

const ORDER_A = "aaaaaaaa-0000-0000-0000-000000000001";
const ORDER_B = "bbbbbbbb-0000-0000-0000-000000000002";
const ORDER_C = "cccccccc-0000-0000-0000-000000000003";

function orderRow(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    payment_status: "UNPAID",
    business_status: "OPEN",
    amount_subunits: 75_000,
    currency: "INR",
    ...overrides,
  };
}

function emptySource(
  overrides: Partial<C03MutationSnapshotSource> = {},
): C03MutationSnapshotSource {
  return {
    orders: { count: 0, rows: [], complete: true },
    paymentAttempts: { count: 0, rows: [], complete: true },
    payments: { count: 0, rows: [], complete: true },
    fulfilments: { count: 0, rows: [], complete: true },
    trustedWebhookEvents: { count: 0, ids: [], complete: true },
    ...overrides,
  };
}

describe("buildC03MutationSnapshot — determinism and ordering", () => {
  it("A1: stamps the frozen envelope version", () => {
    expect(buildC03MutationSnapshot(emptySource()).version).toBe(
      C03_MUTATION_SNAPSHOT_VERSION,
    );
    expect(C03_MUTATION_SNAPSHOT_VERSION).toBe(1);
  });

  it("A2: sorts rows by internal UUID regardless of the order the database returned them", () => {
    const shuffled = buildC03MutationSnapshot(
      emptySource({
        orders: {
          count: 3,
          rows: [orderRow(ORDER_C), orderRow(ORDER_A), orderRow(ORDER_B)],
          complete: true,
        },
      }),
    );
    expect(shuffled.orders!.rows.map((r) => r.id)).toEqual([
      ORDER_A,
      ORDER_B,
      ORDER_C,
    ]);
  });

  it("A3: the same rows in any input order produce a deep-equal snapshot", () => {
    const one = buildC03MutationSnapshot(
      emptySource({
        orders: {
          count: 2,
          rows: [orderRow(ORDER_A), orderRow(ORDER_B)],
          complete: true,
        },
        trustedWebhookEvents: {
          count: 2,
          ids: ["w-2", "w-1"],
          complete: true,
        },
      }),
    );
    const two = buildC03MutationSnapshot(
      emptySource({
        orders: {
          count: 2,
          rows: [orderRow(ORDER_B), orderRow(ORDER_A)],
          complete: true,
        },
        trustedWebhookEvents: {
          count: 2,
          ids: ["w-1", "w-2"],
          complete: true,
        },
      }),
    );
    expect(one).toEqual(two);
    expect(one.trustedWebhookEvents!.ids).toEqual(["w-1", "w-2"]);
  });

  it("A4: is pure — building twice from the same source yields deep-equal results and never mutates the input", () => {
    const source = emptySource({
      orders: {
        count: 2,
        rows: [orderRow(ORDER_B), orderRow(ORDER_A)],
        complete: true,
      },
    });
    const before = JSON.stringify(source);
    const first = buildC03MutationSnapshot(source);
    const second = buildC03MutationSnapshot(source);
    expect(first).toEqual(second);
    expect(JSON.stringify(source)).toBe(before);
  });
});

describe("buildC03MutationSnapshot — completeness and null semantics", () => {
  it("A5: a failed read stays null and is NEVER converted to an empty collection", () => {
    const snapshot = buildC03MutationSnapshot(
      emptySource({ orders: null, fulfilments: null }),
    );
    expect(snapshot.orders).toBeNull();
    expect(snapshot.fulfilments).toBeNull();
    // The distinction that matters: null (not read) vs a positive empty claim.
    expect(snapshot.payments).toEqual({ count: 0, rows: [], complete: true });
  });

  it("A6: a truncated collection reports complete:false and keeps the TRUE total count", () => {
    const rows = Array.from(
      { length: C03_MUTATION_SNAPSHOT_MAX_ROWS },
      (_, i) => orderRow(`order-${String(i).padStart(4, "0")}`),
    );
    const snapshot = buildC03MutationSnapshot(
      emptySource({
        orders: { count: 5_000, rows, complete: false },
      }),
    );
    expect(snapshot.orders!.complete).toBe(false);
    expect(snapshot.orders!.count).toBe(5_000);
    expect(snapshot.orders!.rows).toHaveLength(C03_MUTATION_SNAPSHOT_MAX_ROWS);
  });

  it("A7: the row cap is the frozen bounded value", () => {
    expect(C03_MUTATION_SNAPSHOT_MAX_ROWS).toBe(200);
  });
});

describe("serializeC03MutationSnapshot — explicit projection only", () => {
  it("A8: an unknown column present on a source row can never leak into persisted JSON", () => {
    const snapshot = buildC03MutationSnapshot(
      emptySource({
        orders: {
          count: 1,
          rows: [
            orderRow(ORDER_A, {
              // Fields a future migration might add, plus things that must
              // never be persisted as evidence.
              internal_note: "SHOULD-NEVER-APPEAR",
              customer_email: "person@example.com",
              raw_payload_redacted: { a: 1 },
            }) as never,
          ],
          complete: true,
        },
      }),
    );
    const json = JSON.stringify(serializeC03MutationSnapshot(snapshot));
    expect(json).not.toContain("SHOULD-NEVER-APPEAR");
    expect(json).not.toContain("person@example.com");
    expect(json).not.toContain("raw_payload_redacted");
    expect(json).not.toContain("internal_note");
  });

  it("A9: serialized order rows carry exactly the frozen field list", () => {
    const snapshot = buildC03MutationSnapshot(
      emptySource({
        orders: { count: 1, rows: [orderRow(ORDER_A)], complete: true },
      }),
    );
    const serialized = serializeC03MutationSnapshot(snapshot) as unknown as {
      orders: { rows: Record<string, unknown>[] };
    };
    expect(Object.keys(serialized.orders.rows[0]!).sort()).toEqual([
      "amountSubunits",
      "businessStatus",
      "currency",
      "id",
      "paymentStatus",
    ]);
  });

  it("A10: the serialized envelope carries exactly the five collections plus version", () => {
    const serialized = serializeC03MutationSnapshot(
      buildC03MutationSnapshot(emptySource()),
    );
    expect(Object.keys(serialized).sort()).toEqual([
      "fulfilments",
      "orders",
      "paymentAttempts",
      "payments",
      "trustedWebhookEvents",
      "version",
    ]);
  });

  it("A11: a null collection serializes as null, never as an empty object", () => {
    const serialized = serializeC03MutationSnapshot(
      buildC03MutationSnapshot(emptySource({ payments: null })),
    );
    expect(serialized.payments).toBeNull();
  });

  it("A12: money stays an integer count of subunits — never a float, never a string", () => {
    const snapshot = buildC03MutationSnapshot(
      emptySource({
        orders: {
          count: 1,
          rows: [orderRow(ORDER_A, { amount_subunits: 75_000 })],
          complete: true,
        },
      }),
    );
    const amount = snapshot.orders!.rows[0]!.amountSubunits;
    expect(Number.isInteger(amount)).toBe(true);
    expect(amount).toBe(75_000);
  });
});

describe("serializeC03MutationEvidence", () => {
  it("A13: a null side stays null — never replaced with an empty snapshot", () => {
    const serialized = serializeC03MutationEvidence({
      version: C03_MUTATION_SNAPSHOT_VERSION,
      before: buildC03MutationSnapshot(emptySource()),
      after: null,
    });
    expect(serialized.after).toBeNull();
    expect(serialized.before).not.toBeNull();
    expect(Object.keys(serialized).sort()).toEqual([
      "after",
      "before",
      "version",
    ]);
  });

  it("A14: contains no verdict vocabulary of any kind", () => {
    const json = JSON.stringify(
      serializeC03MutationEvidence({
        version: C03_MUTATION_SNAPSHOT_VERSION,
        before: buildC03MutationSnapshot(emptySource()),
        after: buildC03MutationSnapshot(emptySource()),
      }),
    );
    for (const verdict of [
      "PASS",
      "FAIL",
      "UNKNOWN",
      "NOT_APPLICABLE",
      "ERROR",
    ]) {
      expect(json).not.toContain(verdict);
    }
  });
});
