/**
 * Phase 3A — server-only, READ-ONLY persistence boundary for
 * Chaos-Precheck-relevant evidence (this task's Section 14).
 *
 * This module performs zero writes. It exists only so
 * `lib/chaos/safety-gate.ts` can (a) confirm the database is reachable and
 * (b) load already-persisted Phase 2 evidence (webhook events, orders,
 * payment attempts, fulfilment counts) to evaluate PRECHECK-06/07/08. It
 * never creates a `chaos_runs` row (that table does not exist yet — Phase
 * 3B scope, docs/DATABASE.md Section 15) and never mutates `orders`,
 * `payment_attempts`, `payments`, `webhook_events`, `event_processing_attempts`,
 * or `fulfilments`.
 *
 * Wherever an existing approved Phase 1/2 repository function already reads
 * the exact data needed (`getOrderById`, `countFulfilmentsForOrderIds`,
 * `getPaymentAttemptById` from `lib/demo-merchant/repository.ts`), this
 * module calls that function directly instead of re-implementing the same
 * query — "consume Phase 2, do not redesign it" (this task's Section 3).
 * The one read this codebase does not yet expose anywhere — an internal
 * `webhook_events` lookup by its own `id` (as opposed to the existing
 * `getWebhookEventByRazorpayEventId` in `lib/webhooks/repository.ts`, which
 * looks up by the Razorpay-issued external event id) — is added here, as a
 * new Phase-3-owned read, rather than by editing the approved Phase 2
 * `lib/webhooks/repository.ts` file.
 *
 * Structural guarantee: `import "server-only"` (same pattern as every other
 * repository in this codebase) makes a client-bundle import of this module
 * fail at build time.
 */
import "server-only";

import {
  countFulfilmentsForOrderIds,
  getOrderById,
  getPaymentAttemptById,
} from "@/lib/demo-merchant/repository";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";

export type WebhookEventRow =
  Database["public"]["Tables"]["webhook_events"]["Row"];

/** Deterministic domain error for this repository's I/O failures — never leaks the raw Supabase error (matches every other repository's error-boundary convention in this codebase). */
export class ChaosRepositoryError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ChaosRepositoryError";
    this.code = code;
  }
}

/**
 * PRECHECK-06 — Database Reachable (docs/CHAOS_SCENARIOS.md Section 11).
 * Performs the smallest bounded read-only operation possible: a `HEAD`
 * count query against `orders` with `limit(1)`, reading zero rows of data.
 * No new infrastructure (no separate health-check service, no network-ping
 * worker) — this task's Section 11.
 *
 * Throws `ChaosRepositoryError` on any failure; never returns a boolean, so
 * a caller cannot accidentally ignore the result — `lib/chaos/safety-gate.ts`
 * always wraps this in `try/catch` and treats any throw as `BLOCKED` /
 * `PRECHECK-06`.
 */
export async function checkChaosDatabaseReachable(): Promise<void> {
  const client = getSupabaseServerClient();

  const { error } = await client
    .from("orders")
    .select("id", { count: "exact", head: true })
    .limit(1);

  if (error) {
    throw new ChaosRepositoryError(
      "CHAOS_DATABASE_UNREACHABLE",
      "The database is not reachable.",
    );
  }
}

/**
 * Reads one canonical `webhook_events` row by its INTERNAL `id` (not the
 * Razorpay-issued `razorpay_event_id` that
 * `lib/webhooks/repository.ts`'s `getWebhookEventByRazorpayEventId` looks
 * up by). Returns `null` if no such row exists. This is the only new table
 * read this module adds beyond what `lib/demo-merchant/repository.ts`
 * already exposes.
 */
export async function getWebhookEventById(
  id: string,
): Promise<WebhookEventRow | null> {
  const client = getSupabaseServerClient();

  const { data, error } = await client
    .from("webhook_events")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new ChaosRepositoryError(
      "CHAOS_WEBHOOK_EVENT_LOOKUP_FAILED",
      "Failed to load webhook event evidence.",
    );
  }

  return data;
}

/** The known baseline facts PRECHECK-08 needs about one merchant order (docs/CHAOS_SCENARIOS.md Section 11 PRECHECK-08 "Known Demo State"). */
export interface OrderBaseline {
  readonly orderId: string;
  readonly paymentStatus: string;
  readonly businessStatus: string;
  readonly fulfilmentCount: number;
}

/**
 * Loads one order's PRECHECK-08 baseline facts: its `payment_status`,
 * `business_status`, and real fulfilment count — built entirely from
 * existing approved Phase 1/2 reads (`getOrderById`,
 * `countFulfilmentsForOrderIds`). Returns `null` if the order does not
 * exist.
 */
export async function getOrderBaseline(
  orderId: string,
): Promise<OrderBaseline | null> {
  const order = await getOrderById(orderId);
  if (!order) return null;

  const counts = await countFulfilmentsForOrderIds([orderId]);

  return {
    orderId: order.id,
    paymentStatus: order.payment_status,
    businessStatus: order.business_status,
    fulfilmentCount: counts.get(orderId) ?? 0,
  };
}

/** `true` when an order's baseline is fresh: `UNPAID` + `OPEN` + zero fulfilments (the C07/C11-Mechanism-A precondition, docs/CHAOS_SCENARIOS.md Sections 19/23). */
export function isFreshBaseline(baseline: OrderBaseline): boolean {
  return (
    baseline.paymentStatus === "UNPAID" &&
    baseline.businessStatus === "OPEN" &&
    baseline.fulfilmentCount === 0
  );
}

/** C01's required evidence: the correlated order id plus its baseline. */
export interface C01Evidence {
  readonly webhookEventId: string;
  readonly orderId: string;
  readonly baseline: OrderBaseline;
}

/**
 * PRECHECK-07 evidence load for C01 (docs/CHAOS_SCENARIOS.md Section 13
 * Sections 6/8/13). Requires: the referenced `webhook_events` row exists,
 * carries `signature_verified = true` (the table's own CHECK constraint
 * already guarantees `source_kind = 'REAL_RAZORPAY_WEBHOOK'` whenever a row
 * exists at all — docs/DATABASE.md Section 13 — so this function does not
 * re-check that separately), has a P0-supported `event_type`
 * (`payment.captured` preferred, `order.paid` accepted), and correlates
 * through `payment_attempt_id` to a resolvable order. Returns `null` if any
 * of that is not satisfiable — the caller (`lib/chaos/safety-gate.ts`) maps
 * that to `BLOCKED` / `PRECHECK-07`, never a fabricated pass.
 */
export async function loadC01SourceEvidence(
  webhookEventId: string,
): Promise<C01Evidence | null> {
  const webhookEvent = await getWebhookEventById(webhookEventId);
  if (!webhookEvent) return null;
  if (!webhookEvent.signature_verified) return null;
  if (
    webhookEvent.event_type !== "payment.captured" &&
    webhookEvent.event_type !== "order.paid"
  ) {
    return null;
  }
  if (!webhookEvent.payment_attempt_id) return null;

  const attempt = await getPaymentAttemptById(webhookEvent.payment_attempt_id);
  if (!attempt) return null;

  const baseline = await getOrderBaseline(attempt.order_id);
  if (!baseline) return null;

  return {
    webhookEventId: webhookEvent.id,
    orderId: attempt.order_id,
    baseline,
  };
}

/** C11 Mechanism B's required evidence: the correlated order id plus its baseline. */
export interface C11FailureEvidence {
  readonly webhookEventId: string;
  readonly orderId: string;
  readonly baseline: OrderBaseline;
}

/**
 * PRECHECK-07 evidence load for C11 Mechanism B, `REAL_WEBHOOK_EVENT` kind
 * (docs/CHAOS_SCENARIOS.md Section 23 Sections 6/8). Requires: the
 * referenced `webhook_events` row exists, is signature-verified, has
 * `event_type = 'payment.failed'`, and correlates to a resolvable order.
 * Returns `null` (never a fabricated evidence object) if any condition
 * fails.
 */
export async function loadC11RealWebhookFailureEvidence(
  webhookEventId: string,
): Promise<C11FailureEvidence | null> {
  const webhookEvent = await getWebhookEventById(webhookEventId);
  if (!webhookEvent) return null;
  if (!webhookEvent.signature_verified) return null;
  if (webhookEvent.event_type !== "payment.failed") return null;
  if (!webhookEvent.payment_attempt_id) return null;

  const attempt = await getPaymentAttemptById(webhookEvent.payment_attempt_id);
  if (!attempt) return null;

  const baseline = await getOrderBaseline(attempt.order_id);
  if (!baseline) return null;

  return {
    webhookEventId: webhookEvent.id,
    orderId: attempt.order_id,
    baseline,
  };
}

/**
 * PRECHECK-07 evidence load for C11 Mechanism B, `TEST_FIXTURE` kind. Phase
 * 3A does not implement a fixture store — there is no sanitized authentic
 * `payment.failed` fixture catalogue to look up yet. This function always
 * returns `null` ("unavailable"), which the caller maps to `BLOCKED`. This
 * is deliberate: "No fixture content needs to be created in this sub-phase
 * merely to force the gate to pass" (this task's Section 7) and "Do not
 * invent a real Razorpay failure" (docs/CHAOS_SCENARIOS.md Section 23
 * Section 8). `fixtureId` is accepted (not `void`) so the function's shape
 * documents the intended future lookup key, even though no lookup can
 * currently succeed.
 */
export async function loadC11TestFixtureFailureEvidence(
  fixtureId: string,
): Promise<C11FailureEvidence | null> {
  // Intentionally unresolvable — see doc comment above. `void` keeps the
  // parameter genuinely referenced (documenting the intended future lookup
  // key) without a lint/unused-parameter warning or any behavior.
  void fixtureId;
  return null;
}
