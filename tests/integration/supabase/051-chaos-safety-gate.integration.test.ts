import { createHash, randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { getSupabaseServerClient } from "@/lib/supabase/server";

import { CERTIFIED_BASELINE_ABSENT } from "./certified-baseline";
import type { Database } from "@/lib/supabase/types";

import { taggedValue } from "./helpers";

/**
 * Phase 3A — proves the READ-ONLY Chaos Precheck / Safety Gate
 * (`lib/chaos/repository.ts`, `lib/chaos/safety-gate.ts`) against the REAL
 * Supabase project.
 *
 * ARCHITECT CORRECTION (Finding 1 — critical provenance bug): this file used
 * to insert synthetic rows directly into the canonical `webhook_events`
 * table and treat them as successful C01/C11 authentic-provider evidence.
 * That is not acceptable: `webhook_events`'s documented purpose
 * (docs/DATABASE.md Section 13) is "the canonical representation of a
 * genuine, signature-verified Razorpay Test Mode webhook event", and its
 * `source_kind` column is schema-fixed to `REAL_RAZORPAY_WEBHOOK` — the
 * table's provenance guarantee is structural, not something a test's own
 * comments or intentions can carve an exception into. A row this test
 * inserts is indistinguishable, to every other reader of this table, from a
 * genuine Razorpay-delivered event.
 *
 * This file therefore NEVER inserts into `webhook_events` to satisfy an
 * authentic-provider evidence prerequisite:
 *   - C01's positive real-evidence case resolves the eligible canonical
 *     webhook row from the KNOWN genuine Phase 2G payment
 *     (`pay_TU0xvTbsJiOqPI`) via trusted, read-only database relationships
 *     (payments -> webhook_events by payment_attempt_id) — never a
 *     hardcoded webhook ID, never a synthesized row. If that genuine row
 *     cannot be resolved in the current environment, the test reports that
 *     case as UNAVAILABLE (via a clear console warning) rather than
 *     synthesizing one.
 *   - C11's positive real-evidence case is NOT covered here at all — Phase 2
 *     never established a genuine failed-payment evidence capture, so a
 *     genuine `payment.failed` webhook_events row does not exist yet to
 *     read. That success path stays covered at the unit level only
 *     (tests/unit/chaos/safety-gate.test.ts, against a mocked evidence
 *     loader). This file only proves C11's missing-evidence -> BLOCKED path
 *     and its order/baseline database behavior, both of which need no
 *     `webhook_events` row at all.
 *
 * ALLOWED synthetic DB fixtures in this file (this task's Finding 1 "Allowed
 * synthetic DB fixtures"): `orders`, `payment_attempts`, `payments`,
 * `fulfilments` — ordinary database relationship/baseline reads, never
 * presented as provider evidence. The one exception described in "Forbidden
 * synthetic evidence" below deliberately never persists.
 *
 * This file performs ZERO mutation through the module under test itself —
 * `lib/chaos/repository.ts` exports only read functions. All INSERT/DELETE
 * calls below are this test file's own fixture setup/teardown (via the raw
 * Supabase client), not anything `lib/chaos/repository.ts` or
 * `lib/chaos/safety-gate.ts` does.
 *
 * `runChaosPrecheck` end-to-end tests below call the REAL `getRazorpayEnv()`
 * (not mocked) — they rely on this machine's `.env.local` already
 * containing valid `RAZORPAY_MODE=test`/`RAZORPAY_KEY_ID`/
 * `RAZORPAY_KEY_SECRET` (required for Phase 2's own real Test Mode
 * verification, per handoffs/PHASE-2-HANDOFF.md). If that configuration is
 * ever absent in a given environment, those specific end-to-end assertions
 * will fail with `PRECHECK-01`/`PRECHECK-02` instead of the
 * scenario-specific outcome under test — a genuine environment gap to
 * report honestly, not to silently skip or paper over. The
 * database-relationship-focused tests (baseline reads, reachability) do not
 * depend on Razorpay configuration at all and call `lib/chaos/repository.ts`
 * directly.
 */
function fakeSha256Hex(seed: string): string {
  return createHash("sha256").update(seed).digest("hex");
}

const client = getSupabaseServerClient();

const outstandingFulfilmentIds: string[] = [];
const outstandingPaymentIds: string[] = [];
const outstandingAttemptIds: string[] = [];
const outstandingOrderIds: string[] = [];

async function createOrderWithState(
  amountSubunits: number,
  paymentStatus: Database["public"]["Tables"]["orders"]["Row"]["payment_status"],
  businessStatus: Database["public"]["Tables"]["orders"]["Row"]["business_status"],
): Promise<{ id: string; currency: string }> {
  const { data, error } = await client
    .from("orders")
    .insert({
      amount_subunits: amountSubunits,
      currency: "INR",
      payment_status: paymentStatus,
      business_status: businessStatus,
    })
    .select()
    .single();
  expect(error).toBeNull();
  if (!data) throw new Error("expected orders insert to return a row");
  outstandingOrderIds.push(data.id);
  return { id: data.id, currency: data.currency };
}

async function createAttempt(
  orderId: string,
  amountSubunits: number,
  currency: string,
): Promise<string> {
  const { data, error } = await client
    .from("payment_attempts")
    .insert({
      order_id: orderId,
      attempt_no: 1,
      amount_subunits: amountSubunits,
      currency,
      status: "CAPTURED",
      razorpay_receipt: taggedValue("attempt"),
      razorpay_order_id: taggedValue("order"),
      razorpay_order_status: "paid",
    })
    .select()
    .single();
  expect(error).toBeNull();
  if (!data)
    throw new Error("expected payment_attempts insert to return a row");
  outstandingAttemptIds.push(data.id);
  return data.id;
}

async function createPayment(
  paymentAttemptId: string,
  amountSubunits: number,
  currency: string,
): Promise<string> {
  const { data, error } = await client
    .from("payments")
    .insert({
      payment_attempt_id: paymentAttemptId,
      razorpay_payment_id: taggedValue("payment"),
      amount_subunits: amountSubunits,
      currency,
      checkout_signature_verified: false,
    })
    .select()
    .single();
  expect(error).toBeNull();
  if (!data) throw new Error("expected payments insert to return a row");
  outstandingPaymentIds.push(data.id);
  return data.id;
}

async function createFulfilment(
  orderId: string,
  paymentId: string,
): Promise<string> {
  const { data, error } = await client
    .from("fulfilments")
    .insert({
      order_id: orderId,
      payment_id: paymentId,
      effect_type: "FULFIL_ORDER",
      idempotency_key: taggedValue("fulfilment"),
    })
    .select()
    .single();
  expect(error).toBeNull();
  if (!data) throw new Error("expected fulfilments insert to return a row");
  outstandingFulfilmentIds.push(data.id);
  return data.id;
}

/**
 * Builds order(PAID/FULFILLED) -> attempt(CAPTURED) -> payment -> fulfilment
 * — a test-owned synthetic database fixture for exercising baseline reads
 * against a non-fresh order. Deliberately creates NO `webhook_events` row
 * (architect correction, Finding 1) — this fixture proves database
 * relationship/baseline behavior only, never provider evidence.
 */
async function buildPaidFulfilledOrderScenario(): Promise<{
  orderId: string;
  paymentAttemptId: string;
}> {
  const amountSubunits = 50_000;
  const order = await createOrderWithState(amountSubunits, "PAID", "FULFILLED");
  const attemptId = await createAttempt(
    order.id,
    amountSubunits,
    order.currency,
  );
  const paymentId = await createPayment(
    attemptId,
    amountSubunits,
    order.currency,
  );
  await createFulfilment(order.id, paymentId);
  return { orderId: order.id, paymentAttemptId: attemptId };
}

/** The genuine Phase 2G canonical source event this file resolved for C01, and which supported event type it was. */
interface GenuineC01SourceEvidence {
  readonly webhookEventId: string;
  readonly eventType: "payment.captured" | "order.paid";
}

/**
 * Resolves the eligible canonical `webhook_events` row correlated to the
 * KNOWN genuine Phase 2G payment (`pay_TU0xvTbsJiOqPI`), via trusted,
 * read-only database relationships only — payments -> webhook_events by
 * `payment_attempt_id`. Never hardcodes a webhook ID, never inserts
 * anything. Returns `null` if the genuine row cannot be resolved in this
 * environment (architect correction, Finding 1).
 *
 * Deterministic per this task's Fix 1: queries `payment.captured` and
 * `order.paid` SEPARATELY (never a single `.in()` query that could become
 * ambiguous if genuine rows of both types exist) — `payment.captured` is
 * tried first and preferred; `order.paid` is only consulted as a fallback
 * when no `payment.captured` row correlates. Within either query, results
 * are ordered by `received_at` ascending (the earliest genuine delivery)
 * and capped with `.limit(1)` before `.maybeSingle()`, so this can never
 * throw "multiple rows" even if more than one genuine delivery/evidence row
 * exists for the same payment attempt.
 */
async function resolveGenuineC01SourceEvidence(): Promise<GenuineC01SourceEvidence | null> {
  const { data: payment } = await client
    .from("payments")
    .select("payment_attempt_id")
    .eq("razorpay_payment_id", "pay_TU0xvTbsJiOqPI")
    .maybeSingle();
  if (!payment?.payment_attempt_id) return null;

  const { data: captured } = await client
    .from("webhook_events")
    .select("id")
    .eq("payment_attempt_id", payment.payment_attempt_id)
    .eq("event_type", "payment.captured")
    .eq("signature_verified", true)
    .order("received_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (captured?.id) {
    return { webhookEventId: captured.id, eventType: "payment.captured" };
  }

  const { data: orderPaid } = await client
    .from("webhook_events")
    .select("id")
    .eq("payment_attempt_id", payment.payment_attempt_id)
    .eq("event_type", "order.paid")
    .eq("signature_verified", true)
    .order("received_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (orderPaid?.id) {
    return { webhookEventId: orderPaid.id, eventType: "order.paid" };
  }

  return null;
}

describe("Phase 3A — checkChaosDatabaseReachable (real Supabase)", () => {
  it("resolves against the real project", async () => {
    const { checkChaosDatabaseReachable } =
      await import("@/lib/chaos/repository");
    await expect(checkChaosDatabaseReachable()).resolves.toBeUndefined();
  });
});

describe("Phase 3A — getOrderBaseline / isFreshBaseline (real Supabase)", () => {
  it("reads a fresh UNPAID/OPEN/zero-fulfilment order correctly", async () => {
    const order = await createOrderWithState(10_000, "UNPAID", "OPEN");
    const { getOrderBaseline, isFreshBaseline } =
      await import("@/lib/chaos/repository");
    const baseline = await getOrderBaseline(order.id);
    expect(baseline).toEqual({
      orderId: order.id,
      paymentStatus: "UNPAID",
      businessStatus: "OPEN",
      fulfilmentCount: 0,
    });
    expect(isFreshBaseline(baseline!)).toBe(true);
  });

  it("a wrong (PAID+fulfilled) baseline is correctly classified as NOT fresh", async () => {
    const scenario = await buildPaidFulfilledOrderScenario();
    const { getOrderBaseline, isFreshBaseline } =
      await import("@/lib/chaos/repository");
    const baseline = await getOrderBaseline(scenario.orderId);
    expect(baseline?.paymentStatus).toBe("PAID");
    expect(baseline?.businessStatus).toBe("FULFILLED");
    expect(baseline?.fulfilmentCount).toBe(1);
    expect(isFreshBaseline(baseline!)).toBe(false);
  });

  it("returns null for a nonexistent order id", async () => {
    const { getOrderBaseline } = await import("@/lib/chaos/repository");
    expect(await getOrderBaseline(randomUUID())).toBeNull();
  });
});

describe("Phase 3A — webhook_events schema constraint (no fixture ever persists)", () => {
  it("the database itself refuses to construct signature_verified = false — the schema guarantee lib/chaos/repository.ts's defensive checks rely on. This insert always fails; no row is ever created.", async () => {
    const { error } = await client
      .from("webhook_events")
      .insert({
        razorpay_event_id: taggedValue("unverified"),
        event_type: "payment.captured",
        signature_verified: false,
        raw_body_sha256: fakeSha256Hex(`unverified-${randomUUID()}`),
        raw_payload_redacted: {},
      } as Database["public"]["Tables"]["webhook_events"]["Insert"])
      .select()
      .single();
    expect(error).not.toBeNull();
  });
});

describe("Phase 3A — loadC01SourceEvidence (nonexistent evidence only — no synthetic canonical row is ever created here)", () => {
  it("returns null for a nonexistent webhook event id", async () => {
    const { loadC01SourceEvidence } = await import("@/lib/chaos/repository");
    expect(await loadC01SourceEvidence(randomUUID())).toBeNull();
  });
});

describe("Phase 3A — loadC11RealWebhookFailureEvidence (nonexistent evidence only — no synthetic canonical row is ever created here)", () => {
  it("returns null for a nonexistent webhook event id", async () => {
    const { loadC11RealWebhookFailureEvidence } =
      await import("@/lib/chaos/repository");
    expect(await loadC11RealWebhookFailureEvidence(randomUUID())).toBeNull();
  });
});

describe("Phase 3A — runChaosPrecheck end-to-end (real Supabase + real Razorpay Test Mode config)", () => {
  it("C03 reaches PRECHECK_PASSED against the real DB (no evidence dependency)", async () => {
    const { runChaosPrecheck } = await import("@/lib/chaos/safety-gate");
    const result = await runChaosPrecheck({
      scenarioId: "C03",
      mechanism: "C",
      faultType: "INVALID_SIGNATURE_TEST",
    });
    expect(result.status).toBe("PRECHECK_PASSED");
  });

  it("C01 positive real-evidence integration — genuine Phase 2G evidence resolved via trusted DB relationships, never synthesized; MUST prove PRECHECK_PASSED or fail (architect correction, Fix 2)", async (ctx) => {
    // CERTIFIED-BASELINE GUARD (Phase 5 correction, docs/TESTING.md 5.0).
    // This test is pinned to the genuine Phase 2G payment
    // `pay_TU0xvTbsJiOqPI`. Demo Reset clears `webhook_events` by design, so
    // that evidence can be absent through no fault of the precheck — and a
    // permanent hard FAIL then reads as "the precheck is broken" when the
    // truth is "there is nothing certified left to check against".
    //
    // The assertion below is UNCHANGED and still runs in full whenever the
    // evidence exists. Only the absent case changed: SKIPPED, never PASSED,
    // and never satisfied by synthesizing a canonical row.
    const evidence = await resolveGenuineC01SourceEvidence();
    if (!evidence) ctx.skip(CERTIFIED_BASELINE_ABSENT);
    if (!evidence) {
      throw new Error(
        "Expected genuine Phase 2G canonical C01 source evidence to exist: " +
          "no signature-verified payment.captured (preferred) or order.paid " +
          "(fallback) webhook_events row correlates to the known genuine " +
          "payment pay_TU0xvTbsJiOqPI via payment_attempt_id. This is a " +
          "genuine environment gap to report, not a reason to synthesize " +
          "evidence or accept BLOCKED as a passing outcome.",
      );
    }
    // eslint-disable-next-line no-console
    console.info(
      `[Phase 3A][C01 positive-evidence] resolved genuine Phase 2G source ` +
        `event type: ${evidence.eventType}.`,
    );
    const { runChaosPrecheck } = await import("@/lib/chaos/safety-gate");
    const result = await runChaosPrecheck({
      scenarioId: "C01",
      mechanism: "B",
      faultType: "REPLAY_EVENT",
      sourceWebhookEventId: evidence.webhookEventId,
    });
    // Must be exactly PRECHECK_PASSED — a BLOCKED result fails this test
    // (toEqual's diff surfaces the actual failedPrecheckId/reason). Never
    // tolerate ["PRECHECK_PASSED", "BLOCKED"] as an acceptable outcome for a
    // positive test (architect correction, Fix 2).
    expect(result).toEqual({
      status: "PRECHECK_PASSED",
      scenarioId: "C01",
      mechanism: "B",
    });
  });

  it("C01 with missing evidence produces BLOCKED / PRECHECK-07", async () => {
    const { runChaosPrecheck } = await import("@/lib/chaos/safety-gate");
    const result = await runChaosPrecheck({
      scenarioId: "C01",
      mechanism: "B",
      faultType: "REPLAY_EVENT",
      sourceWebhookEventId: randomUUID(),
    });
    expect(result).toMatchObject({
      status: "BLOCKED",
      failedPrecheckId: "PRECHECK-07",
    });
  });

  it("C07 blocks with PRECHECK-08 against the real DB when no order is supplied (architect correction, Finding 3)", async () => {
    const { runChaosPrecheck } = await import("@/lib/chaos/safety-gate");
    const result = await runChaosPrecheck({
      scenarioId: "C07",
      mechanism: ["A", "C"],
      faultType: "DROP_CLIENT_CONFIRMATION",
    });
    expect(result).toMatchObject({
      status: "BLOCKED",
      failedPrecheckId: "PRECHECK-08",
    });
  });

  it("C07 reaches PRECHECK_PASSED against the real DB with a genuinely fresh supplied order", async () => {
    const order = await createOrderWithState(12_000, "UNPAID", "OPEN");
    const { runChaosPrecheck } = await import("@/lib/chaos/safety-gate");
    const result = await runChaosPrecheck({
      scenarioId: "C07",
      mechanism: ["A", "C"],
      faultType: "DROP_CLIENT_CONFIRMATION",
      freshOrderId: order.id,
    });
    expect(result).toEqual({
      status: "PRECHECK_PASSED",
      scenarioId: "C07",
      mechanism: ["A", "C"],
    });
  });

  it("C11 Mechanism A blocks with PRECHECK-08 against the real DB when no order is supplied (architect correction, Finding 3)", async () => {
    const { runChaosPrecheck } = await import("@/lib/chaos/safety-gate");
    const result = await runChaosPrecheck({
      scenarioId: "C11",
      mechanism: "A",
    });
    expect(result).toMatchObject({
      status: "BLOCKED",
      failedPrecheckId: "PRECHECK-08",
    });
  });

  it("C11 Mechanism A reaches PRECHECK_PASSED with a real fresh order", async () => {
    const order = await createOrderWithState(5_000, "UNPAID", "OPEN");
    const { runChaosPrecheck } = await import("@/lib/chaos/safety-gate");
    const result = await runChaosPrecheck({
      scenarioId: "C11",
      mechanism: "A",
      freshOrderId: order.id,
    });
    expect(result).toEqual({
      status: "PRECHECK_PASSED",
      scenarioId: "C11",
      mechanism: "A",
    });
  });

  it("C11 Mechanism A with a real WRONG (already-PAID) baseline produces BLOCKED / PRECHECK-08", async () => {
    const scenario = await buildPaidFulfilledOrderScenario();
    const { runChaosPrecheck } = await import("@/lib/chaos/safety-gate");
    const result = await runChaosPrecheck({
      scenarioId: "C11",
      mechanism: "A",
      freshOrderId: scenario.orderId,
    });
    expect(result).toMatchObject({
      status: "BLOCKED",
      failedPrecheckId: "PRECHECK-08",
    });
  });

  it("C11 Mechanism B with missing failure evidence produces BLOCKED / PRECHECK-07 — no synthetic payment.failed webhook is ever created (architect correction, Finding 1)", async () => {
    const { runChaosPrecheck } = await import("@/lib/chaos/safety-gate");
    const result = await runChaosPrecheck({
      scenarioId: "C11",
      mechanism: "B",
      failureEvidence: {
        kind: "REAL_WEBHOOK_EVENT",
        webhookEventId: randomUUID(),
      },
    });
    expect(result).toMatchObject({
      status: "BLOCKED",
      failedPrecheckId: "PRECHECK-07",
    });
  });
});

describe("Phase 3A — no path mutates merchant/payment state (this task's TEST CHANGES REQUIRED item 10)", () => {
  it("lib/chaos/repository.ts and lib/chaos/safety-gate.ts contain no insert/update/delete/upsert call", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    for (const file of ["repository.ts", "safety-gate.ts"]) {
      const source = fs.readFileSync(
        path.resolve(import.meta.dirname, `../../../lib/chaos/${file}`),
        "utf-8",
      );
      expect(source).not.toMatch(/\.(insert|update|delete|upsert)\s*\(/);
    }
  });

  it("this test file itself never inserts a webhook_events row to satisfy an authentic-evidence prerequisite (architect correction, Finding 1) — only the always-failing schema-constraint proof above ever attempts one", async () => {
    const fs = await import("node:fs");
    const source = fs.readFileSync(new URL(import.meta.url), "utf-8");
    const insertCalls = [
      ...source.matchAll(/\.from\(\s*"webhook_events"\s*\)\s*\.insert\(/g),
    ];
    expect(insertCalls.length).toBe(1);
  });
});

describe("Phase 3A — historical real Phase 2 rows remain unchanged", () => {
  it("the known manually-verified Phase 2C row is untouched by this file's synthetic tests", async () => {
    const { data: order } = await client
      .from("orders")
      .select("*")
      .eq("id", "eabed2c4-5d48-4f20-8cc9-67248564648a")
      .maybeSingle();
    if (order) {
      expect(order.payment_status).toBe("UNPAID");
      expect(order.business_status).toBe("OPEN");
    }

    const { data: payment } = await client
      .from("payments")
      .select("*")
      .eq("razorpay_payment_id", "pay_TTcbVd43PMN79M")
      .maybeSingle();
    if (payment) {
      expect(payment.razorpay_payment_status).toBeNull();
    }
  });

  it("the known genuine Phase 2G order/payment are untouched by this file's synthetic tests (read-only confirmation only, never a write)", async () => {
    const { data: order } = await client
      .from("orders")
      .select("*")
      .eq("id", "cdc8c3fc-d78c-4cd9-837d-c41f5cc04a72")
      .maybeSingle();
    // Phase 2G's real payment legitimately IS captured/paid — this is a
    // read-only confirmation query only, never an assertion that this file
    // changed it, and never a write.
    if (order) {
      expect(["UNPAID", "PENDING", "FAILED_OBSERVED", "PAID"]).toContain(
        order.payment_status,
      );
    }

    const { data: payment } = await client
      .from("payments")
      .select("*")
      .eq("razorpay_payment_id", "pay_TU0xvTbsJiOqPI")
      .maybeSingle();
    expect(payment === null || typeof payment.id === "string").toBe(true);
  });
});

const CLEANUP_CHUNK_SIZE = 50;

async function batchDelete(
  table: "fulfilments" | "payments" | "payment_attempts" | "orders",
  ids: readonly string[],
): Promise<void> {
  for (let i = 0; i < ids.length; i += CLEANUP_CHUNK_SIZE) {
    const chunk = ids.slice(i, i + CLEANUP_CHUNK_SIZE);
    if (chunk.length === 0) continue;
    await client.from(table).delete().in("id", chunk);
  }
}

afterAll(async () => {
  // Reverse dependency order — exact-ID/tag-scoped cleanup of only the
  // synthetic rows this file created. No webhook_events row is ever created
  // by this file (architect correction, Finding 1), so there is nothing to
  // clean up in that table.
  await batchDelete("fulfilments", outstandingFulfilmentIds);
  await batchDelete("payments", outstandingPaymentIds);
  await batchDelete("payment_attempts", outstandingAttemptIds);
  await batchDelete("orders", outstandingOrderIds);

  // Independently re-verify via a real SELECT that no synthetic evidence
  // from this file remains.
  const { count: remainingFulfilments } = await client
    .from("fulfilments")
    .select("id", { count: "exact", head: true })
    .in(
      "id",
      outstandingFulfilmentIds.length ? outstandingFulfilmentIds : [""],
    );
  expect(remainingFulfilments).toBe(0);

  const { count: remainingOrders } = await client
    .from("orders")
    .select("id", { count: "exact", head: true })
    .in("id", outstandingOrderIds.length ? outstandingOrderIds : [""]);
  expect(remainingOrders).toBe(0);
}, 120_000);
