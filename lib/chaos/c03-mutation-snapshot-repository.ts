/**
 * Phase 3F evidence-compatibility correction — server-only, STRICTLY READ-ONLY
 * persistence boundary for the C03 mutation snapshot.
 *
 * `import "server-only"` for the same structural reason as every other
 * repository in this codebase: it performs Supabase I/O with the service-role
 * client and must never be reachable from a client bundle.
 *
 * ============================================================================
 * READ-ONLY IS A STRUCTURAL PROPERTY HERE, NOT A PROMISE
 * ============================================================================
 *
 * This module issues `SELECT` statements and nothing else. There is no
 * `.insert(`, no `.update(`, no `.delete(`, no `.upsert(` and no `.rpc(`
 * anywhere in it. It never invokes chaos execution, never invokes merchant
 * processing, never calls Razorpay or any HTTP endpoint, never creates a
 * payment, an order, a fulfilment, a chaos run, a webhook row or a processing
 * attempt, and never replays an event. Capturing evidence must not be able to
 * change the evidence it is capturing — a read that mutated state would make
 * the snapshot a description of its own side effects.
 *
 * That matters especially here: this snapshot is the input to INV-005's "zero
 * mutation" claim. If the capture itself could mutate anything, the invariant
 * would be measuring the instrument rather than the merchant.
 *
 * ============================================================================
 * NO CALLER-SUPPLIED INPUT AT ALL
 * ============================================================================
 *
 * `captureC03MutationSnapshot()` takes NO parameters. There is no entity
 * selector, no id, no filter, no table name, no column name, no ordering key
 * and no limit that a caller can influence — and therefore no URL, host,
 * hostname, IP, webhook URL, callback URL or target endpoint either. Every
 * query in this file is a fixed, literal, whole-table read of the controlled
 * Demo Merchant, bounded by a fixed server-owned constant.
 *
 * This is deliberate rather than incidental. C03 has no correlated order,
 * payment attempt, payment or webhook event (all four `chaos_runs` foreign
 * keys are NULL by design), and there is no `merchant_id`/tenant column
 * anywhere in this schema, so there is nothing legitimate to narrow by. A
 * parameter here could only ever be an unnecessary injection surface.
 *
 * ============================================================================
 * ALLOWLISTS, AND WHAT IS DELIBERATELY NOT READ
 * ============================================================================
 *
 * Every `SELECT` uses an explicit column allowlist — never `select("*")`. The
 * four business allowlists are byte-identical to the ones
 * `lib/evidence/evidence-repository.ts` already uses for
 * `MerchantStateSnapshotV1`, so this correction widens the read surface of the
 * codebase by exactly ZERO columns on those tables.
 *
 * `webhook_events` is read for `id` ONLY. INV-005's webhook clause is an
 * insertion test ("trusted canonical webhook rows created = 0"), which
 * internal UUIDs plus an exact count settle completely. `raw_payload_redacted`,
 * `raw_body_sha256`, `razorpay_event_id`, `event_type`, every signature, every
 * header and every customer-identifying field are therefore never selected and
 * cannot reach `fault_state` even by accident.
 *
 * ============================================================================
 * FAILURE IS REPORTED, NEVER DEFAULTED
 * ============================================================================
 *
 * A collection whose read FAILS becomes `null`. It is never converted to
 * `{ count: 0, rows: [], complete: true }`, which is the positive claim "read
 * successfully, genuinely empty". Conflating the two would let an
 * infrastructure failure masquerade as evidence that the merchant state was
 * empty — exactly the fabricated-PASS failure mode docs/MONEY_INVARIANTS.md
 * Principle 3 forbids.
 *
 * Failures are logged with a FIXED, SAFE event name and an error CLASS name
 * only. No raw Supabase/Postgres error, no message, no details, no hint and no
 * query text ever escapes this module — and specifically none ever reaches
 * `chaos_runs.fault_state`.
 *
 * A capture failure never throws to the caller and never fails the C03 run:
 * the signature checks are the scenario, and incomplete evidence is a truthful
 * outcome that a later evaluator turns into UNKNOWN.
 */
import "server-only";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import { logEvent } from "@/lib/security/logger";
import {
  buildC03MutationSnapshot,
  C03_MUTATION_SNAPSHOT_MAX_ROWS,
  type C03MutationSnapshotSource,
  type C03MutationSnapshotSourceCollection,
  type C03MutationSnapshotV1,
  type C03WebhookEventIdCollection,
} from "@/lib/chaos/c03-mutation-snapshot";

/**
 * Explicit column allowlists. Written out as literal strings rather than
 * derived from the snapshot types so that adding a column to any of these
 * tables can never silently widen what gets read into evidence — and so a
 * reviewer can see this module's entire read surface in one place.
 *
 * The four business allowlists intentionally match
 * `lib/evidence/evidence-repository.ts` exactly.
 */
const ORDER_COLUMNS =
  "id, payment_status, business_status, amount_subunits, currency";
const PAYMENT_ATTEMPT_COLUMNS =
  "id, order_id, status, amount_subunits, currency, razorpay_order_id, razorpay_order_status";
const PAYMENT_COLUMNS =
  "id, payment_attempt_id, razorpay_payment_id, razorpay_payment_status, amount_subunits, currency, checkout_signature_verified, captured_at, failed_at";
const FULFILMENT_COLUMNS =
  "id, order_id, payment_id, trigger_processing_attempt_id, effect_type, applied_at";
/** Identifiers only — see the module doc comment. */
const WEBHOOK_EVENT_ID_COLUMNS = "id";

/**
 * Reads one bounded, deterministically ordered collection.
 *
 * Ordering is by internal `id` (UUID primary key) so the bounded window is
 * itself deterministic: the same table always yields the same first N rows,
 * rather than whatever Postgres happened to return. `count: "exact"` gives the
 * true total, so a truncated collection still reports the cardinality it was
 * truncated from and `complete` is a real fact rather than a guess.
 *
 * Returns `null` on ANY read failure, having logged a fixed safe category.
 */
async function readBoundedCollection<TRow>(
  table: "orders" | "payment_attempts" | "payments" | "fulfilments",
  columns: string,
  safeLogEvent: string,
): Promise<C03MutationSnapshotSourceCollection<TRow> | null> {
  try {
    const client = getSupabaseServerClient();
    const { data, count, error } = await client
      .from(table)
      .select(columns, { count: "exact" })
      .order("id", { ascending: true })
      .limit(C03_MUTATION_SNAPSHOT_MAX_ROWS);

    if (error || data === null || count === null) {
      logEvent(safeLogEvent, { outcome: "read_failed" });
      return null;
    }

    const rows = data as unknown as readonly TRow[];
    return {
      count,
      rows,
      // `complete` is derived from the database's own exact count, never
      // assumed from "we got fewer rows than the cap".
      complete: rows.length === count,
    };
  } catch (err) {
    logEvent(safeLogEvent, {
      outcome: "read_threw",
      error_name: err instanceof Error ? err.name : "UnknownError",
    });
    return null;
  }
}

/**
 * Reads the trusted canonical `webhook_events` row set as internal UUIDs plus
 * an exact count. No provider payload, no event type, no signature.
 */
async function readTrustedWebhookEventIds(): Promise<C03WebhookEventIdCollection | null> {
  try {
    const client = getSupabaseServerClient();
    const { data, count, error } = await client
      .from("webhook_events")
      .select(WEBHOOK_EVENT_ID_COLUMNS, { count: "exact" })
      .order("id", { ascending: true })
      .limit(C03_MUTATION_SNAPSHOT_MAX_ROWS);

    if (error || data === null || count === null) {
      logEvent("chaos_c03_mutation_snapshot_webhook_events_read_failed", {
        outcome: "read_failed",
      });
      return null;
    }

    const ids = data.map((row) => row.id);
    return { count, ids, complete: ids.length === count };
  } catch (err) {
    logEvent("chaos_c03_mutation_snapshot_webhook_events_read_failed", {
      outcome: "read_threw",
      error_name: err instanceof Error ? err.name : "UnknownError",
    });
    return null;
  }
}

/**
 * Captures one deterministic snapshot of the whole controlled Demo Merchant
 * state.
 *
 * Takes no input. Never throws — every failure mode becomes a `null`
 * collection inside the returned snapshot, so the caller always receives a
 * well-formed, truthfully-incomplete `C03MutationSnapshotV1` rather than an
 * exception that would have to be turned into a fabricated substitute.
 *
 * The five reads are issued concurrently. They are independent read-only
 * `SELECT`s against a single controlled dataset, and running them together
 * narrows the window in which an unrelated concurrent write could land BETWEEN
 * two of them and make one snapshot internally inconsistent. This is a
 * narrowing, not a guarantee: see the concurrency note in
 * `lib/chaos/c03-mutation-snapshot.ts` and ARCH-3F-014's operator rule. No
 * lock, no transaction and no serialization primitive is introduced here.
 */
export async function captureC03MutationSnapshot(): Promise<C03MutationSnapshotV1> {
  const [orders, paymentAttempts, payments, fulfilments, trustedWebhookEvents] =
    await Promise.all([
      readBoundedCollection<C03OrderSourceRow>(
        "orders",
        ORDER_COLUMNS,
        "chaos_c03_mutation_snapshot_orders_read_failed",
      ),
      readBoundedCollection<C03PaymentAttemptSourceRow>(
        "payment_attempts",
        PAYMENT_ATTEMPT_COLUMNS,
        "chaos_c03_mutation_snapshot_payment_attempts_read_failed",
      ),
      readBoundedCollection<C03PaymentSourceRow>(
        "payments",
        PAYMENT_COLUMNS,
        "chaos_c03_mutation_snapshot_payments_read_failed",
      ),
      readBoundedCollection<C03FulfilmentSourceRow>(
        "fulfilments",
        FULFILMENT_COLUMNS,
        "chaos_c03_mutation_snapshot_fulfilments_read_failed",
      ),
      readTrustedWebhookEventIds(),
    ]);

  const source: C03MutationSnapshotSource = {
    orders,
    paymentAttempts,
    payments,
    fulfilments,
    trustedWebhookEvents,
  };

  return buildC03MutationSnapshot(source);
}

/**
 * The exact raw row shapes the four business allowlists above return.
 *
 * Declared locally and structurally (rather than imported from the generated
 * Supabase types) for the same reason `lib/evidence/merchant-state-snapshot.ts`
 * does it: the projection stays independent of generated types, and a caller
 * cannot smuggle an unrelated object through by widening.
 */
interface C03OrderSourceRow {
  readonly id: string;
  readonly payment_status: string;
  readonly business_status: string;
  readonly amount_subunits: number;
  readonly currency: string;
}

interface C03PaymentAttemptSourceRow {
  readonly id: string;
  readonly order_id: string;
  readonly status: string;
  readonly amount_subunits: number;
  readonly currency: string;
  readonly razorpay_order_id: string | null;
  readonly razorpay_order_status: string | null;
}

interface C03PaymentSourceRow {
  readonly id: string;
  readonly payment_attempt_id: string;
  readonly razorpay_payment_id: string;
  readonly razorpay_payment_status: string | null;
  readonly amount_subunits: number;
  readonly currency: string;
  readonly checkout_signature_verified: boolean;
  readonly captured_at: string | null;
  readonly failed_at: string | null;
}

interface C03FulfilmentSourceRow {
  readonly id: string;
  readonly order_id: string;
  readonly payment_id: string;
  readonly trigger_processing_attempt_id: string | null;
  readonly effect_type: string;
  readonly applied_at: string;
}
