import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getSupabaseServerClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: () => getSupabaseServerClient(),
}));

const loadC01SourceEvidence = vi.fn();
const loadC11RealWebhookFailureEvidence = vi.fn();
const getOrderBaseline = vi.fn();

vi.mock("@/lib/chaos/repository", async () => {
  // `isFreshBaseline` is PURE and frozen, so it is deliberately NOT mocked:
  // freshness must be decided by the real PRECHECK-08 rule, not by a stub.
  const actual = await vi.importActual<typeof import("@/lib/chaos/repository")>(
    "@/lib/chaos/repository",
  );
  return {
    ...actual,
    loadC01SourceEvidence: (...a: unknown[]) => loadC01SourceEvidence(...a),
    loadC11RealWebhookFailureEvidence: (...a: unknown[]) =>
      loadC11RealWebhookFailureEvidence(...a),
    getOrderBaseline: (...a: unknown[]) => getOrderBaseline(...a),
  };
});

import {
  ChaosEligibilityServiceError,
  listEligibleSources,
  revalidateEligibility,
} from "@/lib/chaos/eligibility-service";

/**
 * Phase 3H — eligibility must be SERVER-PROVEN and must never widen the
 * contract the frozen services accept.
 */

const WEBHOOK_ID = "11111111-1111-4111-8111-111111111111";
const WEBHOOK_ID_2 = "11111111-1111-4111-8111-111111111112";
const ORDER_ID = "22222222-2222-4222-8222-222222222222";
const ORDER_ID_2 = "22222222-2222-4222-8222-222222222223";

let webhookRows: unknown[] = [];
let orderRows: unknown[] = [];
let recorded: Array<{ table: string; op: string }> = [];

function makeClient() {
  return {
    from(table: string) {
      recorded.push({ table, op: "select" });
      const rows = table === "webhook_events" ? webhookRows : orderRows;
      const chain = {
        select: () => chain,
        in: () => chain,
        eq: () => chain,
        order: () => chain,
        limit: () => Promise.resolve({ data: rows, error: null }),
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve({ data: rows, error: null }).then(resolve),
      };
      return chain;
    },
  };
}

const freshBaseline = (orderId: string) => ({
  orderId,
  paymentStatus: "UNPAID",
  businessStatus: "OPEN",
  fulfilmentCount: 0,
});

beforeEach(() => {
  vi.clearAllMocks();
  recorded = [];
  webhookRows = [];
  orderRows = [];
  getSupabaseServerClient.mockImplementation(() => makeClient());
});

describe("Phase 3H eligibility — C03 needs no subject", () => {
  it("1: C03 returns NO_SOURCE_REQUIRED and issues no query", async () => {
    const result = await listEligibleSources({ scenarioId: "C03" });
    expect(result).toEqual({ kind: "NO_SOURCE_REQUIRED" });
    expect(recorded).toHaveLength(0);
  });

  it("2: C03 revalidation always refuses a subject — it takes none", async () => {
    expect(await revalidateEligibility({ scenarioId: "C03" }, ORDER_ID)).toBe(
      false,
    );
  });
});

describe("Phase 3H eligibility — C01 verified webhook sources", () => {
  it("3: only candidates the FROZEN loader confirms are offered", async () => {
    webhookRows = [
      {
        id: WEBHOOK_ID,
        event_type: "payment.captured",
        source_kind: "REAL_RAZORPAY_WEBHOOK",
        signature_verified: true,
        received_at: "2026-08-20T10:00:00.000Z",
      },
      {
        id: WEBHOOK_ID_2,
        event_type: "order.paid",
        source_kind: "REAL_RAZORPAY_WEBHOOK",
        signature_verified: true,
        received_at: "2026-08-20T09:00:00.000Z",
      },
    ];
    // The second row looks fine but the frozen loader rejects it.
    loadC01SourceEvidence.mockImplementation(async (id: string) =>
      id === WEBHOOK_ID
        ? {
            webhookEventId: WEBHOOK_ID,
            orderId: ORDER_ID,
            baseline: freshBaseline(ORDER_ID),
          }
        : null,
    );

    const result = await listEligibleSources({ scenarioId: "C01" });

    expect(result.kind).toBe("WEBHOOK_SOURCES");
    if (result.kind !== "WEBHOOK_SOURCES") return;
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.webhookEventId).toBe(WEBHOOK_ID);
    expect(result.candidates[0]!.orderId).toBe(ORDER_ID);
    expect(result.candidates[0]!.sourceKind).toBe("REAL_RAZORPAY_WEBHOOK");
  });

  it("4: an unverified row is filtered out even if the query returned it", async () => {
    webhookRows = [
      {
        id: WEBHOOK_ID,
        event_type: "payment.captured",
        source_kind: "REAL_RAZORPAY_WEBHOOK",
        signature_verified: false,
        received_at: "2026-08-20T10:00:00.000Z",
      },
    ];
    loadC01SourceEvidence.mockResolvedValue({
      webhookEventId: WEBHOOK_ID,
      orderId: ORDER_ID,
      baseline: freshBaseline(ORDER_ID),
    });

    const result = await listEligibleSources({ scenarioId: "C01" });
    if (result.kind !== "WEBHOOK_SOURCES") throw new Error("wrong kind");
    expect(result.candidates).toHaveLength(0);
    // The loader was never even consulted for an unverified row.
    expect(loadC01SourceEvidence).not.toHaveBeenCalled();
  });

  it("5: zero candidates is a VALID truthful answer, not an error", async () => {
    webhookRows = [];
    const result = await listEligibleSources({ scenarioId: "C01" });
    if (result.kind !== "WEBHOOK_SOURCES") throw new Error("wrong kind");
    expect(result.candidates).toEqual([]);
  });
});

describe("Phase 3H eligibility — a read failure is NOT an empty result", () => {
  /** A client whose list query fails. */
  function failingClient(message: string) {
    return {
      from() {
        const chain = {
          select: () => chain,
          in: () => chain,
          eq: () => chain,
          order: () => chain,
          limit: () => Promise.resolve({ data: null, error: { message } }),
          then: (resolve: (v: unknown) => unknown) =>
            Promise.resolve({ data: null, error: { message } }).then(resolve),
        };
        return chain;
      },
    };
  }

  it("5a: a failed webhook query throws ELIGIBILITY_READ_FAILED, never []", async () => {
    getSupabaseServerClient.mockImplementation(() =>
      failingClient('relation "webhook_events" does not exist'),
    );

    const failure = listEligibleSources({ scenarioId: "C01" });
    await expect(failure).rejects.toBeInstanceOf(ChaosEligibilityServiceError);
    await expect(failure).rejects.toMatchObject({
      code: "ELIGIBILITY_READ_FAILED",
    });
  });

  it("5b: a failed order query throws too — for C07 and for C11-A", async () => {
    getSupabaseServerClient.mockImplementation(() =>
      failingClient("connection terminated"),
    );

    await expect(
      listEligibleSources({ scenarioId: "C07" }),
    ).rejects.toMatchObject({ code: "ELIGIBILITY_READ_FAILED" });
    await expect(
      listEligibleSources({ scenarioId: "C11", mechanism: "A" }),
    ).rejects.toMatchObject({ code: "ELIGIBILITY_READ_FAILED" });
  });

  it("5c: the thrown message leaks no raw database text", async () => {
    getSupabaseServerClient.mockImplementation(() =>
      failingClient('relation "orders" does not exist — hint: leak me'),
    );

    let message = "";
    try {
      await listEligibleSources({ scenarioId: "C07" });
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message.length).toBeGreaterThan(0);
    for (const forbidden of ["relation", "orders", "hint", "leak me"]) {
      expect(message.toLowerCase(), forbidden).not.toContain(forbidden);
    }
  });

  it("5d: 'no evidence exists' and 'could not determine' are different answers", async () => {
    // Success with zero rows — a fact the operator can act on.
    webhookRows = [];
    getSupabaseServerClient.mockImplementation(() => makeClient());
    const empty = await listEligibleSources({ scenarioId: "C01" });
    expect(empty.kind).toBe("WEBHOOK_SOURCES");

    // Failure — an outage, which must NOT look like the line above.
    getSupabaseServerClient.mockImplementation(() => failingClient("boom"));
    await expect(
      listEligibleSources({ scenarioId: "C01" }),
    ).rejects.toBeInstanceOf(ChaosEligibilityServiceError);
  });
});

describe("Phase 3H eligibility — C07 and C11-A fresh orders", () => {
  it("6: freshness is decided by the frozen rule, not by the query filter", async () => {
    orderRows = [
      {
        id: ORDER_ID,
        payment_status: "UNPAID",
        business_status: "OPEN",
        created_at: "2026-08-20T10:00:00.000Z",
      },
      {
        id: ORDER_ID_2,
        payment_status: "UNPAID",
        business_status: "OPEN",
        created_at: "2026-08-20T09:00:00.000Z",
      },
    ];
    // The second order has a fulfilment, so the real isFreshBaseline rejects
    // it even though the SQL filter matched.
    getOrderBaseline.mockImplementation(async (id: string) =>
      id === ORDER_ID
        ? freshBaseline(ORDER_ID)
        : { ...freshBaseline(ORDER_ID_2), fulfilmentCount: 1 },
    );

    const result = await listEligibleSources({ scenarioId: "C07" });

    expect(result.kind).toBe("ORDER_SUBJECTS");
    if (result.kind !== "ORDER_SUBJECTS") return;
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.orderId).toBe(ORDER_ID);
    expect(result.candidates[0]!.fulfilmentCount).toBe(0);
  });

  it("7: C11 mechanism A uses fresh orders, exactly like C07", async () => {
    orderRows = [
      {
        id: ORDER_ID,
        payment_status: "UNPAID",
        business_status: "OPEN",
        created_at: "2026-08-20T10:00:00.000Z",
      },
    ];
    getOrderBaseline.mockResolvedValue(freshBaseline(ORDER_ID));

    const result = await listEligibleSources({
      scenarioId: "C11",
      mechanism: "A",
    });
    expect(result.kind).toBe("ORDER_SUBJECTS");
  });
});

describe("Phase 3H eligibility — C11-B real webhook evidence only", () => {
  it("8: C11-B offers verified payment.failed evidence the frozen loader confirms", async () => {
    webhookRows = [
      {
        id: WEBHOOK_ID,
        event_type: "payment.failed",
        source_kind: "REAL_RAZORPAY_WEBHOOK",
        signature_verified: true,
        received_at: "2026-08-20T10:00:00.000Z",
      },
    ];
    loadC11RealWebhookFailureEvidence.mockResolvedValue({
      webhookEventId: WEBHOOK_ID,
      orderId: ORDER_ID,
      baseline: freshBaseline(ORDER_ID),
    });

    const result = await listEligibleSources({
      scenarioId: "C11",
      mechanism: "B",
    });

    expect(result.kind).toBe("WEBHOOK_SOURCES");
    if (result.kind !== "WEBHOOK_SOURCES") return;
    expect(result.candidates[0]!.eventType).toBe("payment.failed");
  });

  it("9: TEST_FIXTURE is NEVER offered as runtime evidence", async () => {
    webhookRows = [
      {
        id: WEBHOOK_ID,
        event_type: "payment.failed",
        source_kind: "REAL_RAZORPAY_WEBHOOK",
        signature_verified: true,
        received_at: "2026-08-20T10:00:00.000Z",
      },
    ];
    loadC11RealWebhookFailureEvidence.mockResolvedValue({
      webhookEventId: WEBHOOK_ID,
      orderId: ORDER_ID,
      baseline: freshBaseline(ORDER_ID),
    });

    const result = await listEligibleSources({
      scenarioId: "C11",
      mechanism: "B",
    });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("TEST_FIXTURE");
    expect(serialized).not.toContain("fixtureId");
    if (result.kind !== "WEBHOOK_SOURCES") return;
    for (const candidate of result.candidates) {
      expect(candidate.kind).toBe("WEBHOOK_EVENT");
    }
  });
});

describe("Phase 3H eligibility — candidate shape safety", () => {
  it("10: candidates carry only safe identifiers and factual metadata", async () => {
    webhookRows = [
      {
        id: WEBHOOK_ID,
        event_type: "payment.captured",
        source_kind: "REAL_RAZORPAY_WEBHOOK",
        signature_verified: true,
        received_at: "2026-08-20T10:00:00.000Z",
      },
    ];
    loadC01SourceEvidence.mockResolvedValue({
      webhookEventId: WEBHOOK_ID,
      orderId: ORDER_ID,
      baseline: freshBaseline(ORDER_ID),
    });

    const result = await listEligibleSources({ scenarioId: "C01" });
    if (result.kind !== "WEBHOOK_SOURCES") throw new Error("wrong kind");

    expect(Object.keys(result.candidates[0]!).sort()).toEqual([
      "eventType",
      "kind",
      "orderId",
      "receivedAt",
      "sourceKind",
      "webhookEventId",
    ]);

    const serialized = JSON.stringify(result).toLowerCase();
    for (const forbidden of [
      "raw_payload",
      "normalized_event",
      "signature",
      "raw_body_sha256",
      "secret",
      "email",
      "phone",
      "card",
      "cvv",
      "http://",
      "https://",
      "fault_config",
    ]) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
  });
});

describe("Phase 3H eligibility — listing is not authorization", () => {
  it("11: revalidation re-asks the frozen loader for C01", async () => {
    loadC01SourceEvidence.mockResolvedValue({
      webhookEventId: WEBHOOK_ID,
      orderId: ORDER_ID,
      baseline: freshBaseline(ORDER_ID),
    });
    expect(await revalidateEligibility({ scenarioId: "C01" }, WEBHOOK_ID)).toBe(
      true,
    );

    loadC01SourceEvidence.mockResolvedValue(null);
    expect(await revalidateEligibility({ scenarioId: "C01" }, WEBHOOK_ID)).toBe(
      false,
    );
  });

  it("12: an order that stopped being fresh is refused at revalidation", async () => {
    getOrderBaseline.mockResolvedValue(freshBaseline(ORDER_ID));
    expect(await revalidateEligibility({ scenarioId: "C07" }, ORDER_ID)).toBe(
      true,
    );

    // The operator paid the order between listing and pressing Run.
    getOrderBaseline.mockResolvedValue({
      ...freshBaseline(ORDER_ID),
      paymentStatus: "PAID",
    });
    expect(await revalidateEligibility({ scenarioId: "C07" }, ORDER_ID)).toBe(
      false,
    );
  });

  it("13: a missing subject is refused, never assumed", async () => {
    getOrderBaseline.mockResolvedValue(null);
    expect(await revalidateEligibility({ scenarioId: "C07" }, ORDER_ID)).toBe(
      false,
    );

    loadC11RealWebhookFailureEvidence.mockResolvedValue(null);
    expect(
      await revalidateEligibility(
        { scenarioId: "C11", mechanism: "B" },
        WEBHOOK_ID,
      ),
    ).toBe(false);
  });
});
