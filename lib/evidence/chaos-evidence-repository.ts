/**
 * Phase 3E-B — server-only, STRICTLY READ-ONLY persistence boundary for
 * per-chaos-run evidence assembly.
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
 * payment, a chaos run, a webhook row or a processing attempt, and never
 * replays an event.
 *
 * Its ONLY caller-supplied input is an internal `chaos_runs.id` UUID. It
 * accepts no URL, host, hostname, IP, webhook URL, callback URL, target
 * endpoint, table name, column name, order state, payment state, snapshot
 * JSON or provider status from a browser or any other untrusted source —
 * every correlated fact is resolved from trusted persisted rows here.
 *
 * ============================================================================
 * WHAT IT DELIBERATELY DOES NOT READ
 * ============================================================================
 *
 * `orders`, `payment_attempts`, `payments` and `fulfilments` are NEVER read
 * by this module. That is the enforcement mechanism for the Historical Truth
 * Rule (`lib/evidence/chaos-run-evidence.ts` module doc comment): a missing
 * `state_before`/`state_after` can never be silently replaced with today's
 * mutable merchant state, because the current merchant state is not available
 * to this code path at all. Historical entity facts come from the durable
 * `MerchantStateSnapshotV1` snapshots or they come from nowhere.
 *
 * Every `SELECT` uses an explicit column allowlist — never `select("*")`. Raw
 * webhook bodies (`raw_payload_redacted`, `raw_body_sha256`), signatures,
 * secrets, headers, customer data and the full `normalized_event` blob are
 * never selected, so they cannot reach an evidence bundle even by accident.
 *
 * Errors never escape as raw Supabase/Postgres errors —
 * `ChaosEvidenceRepositoryError` carries a fixed safe `.code` and a fixed
 * safe `.message`, matching the established `ChaosRunRepositoryError` /
 * `EvidenceRepositoryError` / `C11ObservationRepositoryError` pattern. A
 * record that is genuinely ABSENT is reported as `null` (which the pure
 * builder turns into a deterministic evidence gap); a genuine database I/O
 * failure throws.
 */
import "server-only";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import type {
  ChaosRunEvidenceSource,
  RawChaosRunEvidenceRow,
  RawProcessingAttemptEvidenceRow,
  RawWebhookEvidenceRow,
} from "@/lib/evidence/chaos-run-evidence";

/** Deterministic domain error for this repository's I/O failures — never leaks the raw Supabase error. */
export class ChaosEvidenceRepositoryError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ChaosEvidenceRepositoryError";
    this.code = code;
  }
}

/**
 * Explicit column allowlists. Written out as literal strings rather than
 * derived from the evidence types so that adding a column to any of these
 * tables can never silently widen what gets read into evidence — and so a
 * reviewer can see this module's entire read surface in one place.
 *
 * `chaos_runs`: `fault_config` and `error_message_redacted` are deliberately
 * excluded. `fault_state` IS read because C03's two verification checks and
 * C07's armed/consumed booleans live there and nowhere else — but it is
 * runtime-validated into narrow, scenario-specific safe facts by
 * `lib/evidence/chaos-run-evidence.ts` and never surfaced as a generic blob.
 *
 * `webhook_events`: `raw_payload_redacted`, `raw_body_sha256`, every provider
 * free-text column and every customer-identifying field are excluded.
 *
 * `event_processing_attempts`: `normalized_event` is excluded on purpose (see
 * this task's "NO RAW normalized_event COPY" rule — provenance, event type,
 * correlation and processing status are all available as trusted columns), as
 * is `error_message_redacted`.
 */
const CHAOS_RUN_COLUMNS =
  "id, scenario_id, status, outcome, fault_type, data_classification, order_id, payment_attempt_id, payment_id, source_webhook_event_id, failed_precheck_id, execution_block_code, fault_state, started_at, completed_at";

const WEBHOOK_EVENT_COLUMNS =
  "id, razorpay_event_id, event_type, source_kind, signature_verified, processing_status, duplicate_delivery_count, received_at, payment_attempt_id, payment_id, razorpay_payment_id, amount_subunits, currency";

/**
 * The frozen filters that define an AUTHORITATIVE captured-payment basis
 * (docs/MONEY_INVARIANTS.md §5 "Authoritative Successful Payment Evidence":
 * "verified REAL_RAZORPAY_WEBHOOK / event_type = payment.captured / correlated
 * to the Razorpay Payment and internal payment attempt").
 *
 * `source_kind` and `signature_verified` are already CHECK-constrained on
 * `webhook_events` (`webhook_events_source_kind_valid`,
 * `webhook_events_signature_verified_true`), so these two filters are
 * belt-and-braces. They are written out explicitly anyway so the query STATES
 * its own authenticity conditions rather than relying on a constraint a
 * reviewer has to go and look up — and so that a future schema change can
 * never silently widen what counts as provider capture evidence.
 *
 * `processing_status` is deliberately NOT filtered: a signature-verified
 * provider `payment.captured` delivery is authentic provider evidence of
 * capture whether or not PayChaos finished processing it. Filtering on
 * `PROCESSED` would silently discard real capture evidence and could produce
 * exactly the false "no capture exists" conclusion this search exists to
 * prevent. The actual status is projected truthfully instead, for Phase 3F to
 * weigh.
 */
const CAPTURE_EVENT_TYPE = "payment.captured";
const CAPTURE_SOURCE_KIND = "REAL_RAZORPAY_WEBHOOK";

/**
 * Upper bound on capture candidates read. Four is more than enough to
 * distinguish the only three outcomes that matter (zero / exactly one / more
 * than one) while never silently hiding a third or fourth conflicting row
 * behind a `limit(1)`. There is deliberately NO `limit(1)`: taking the "first"
 * row would be latest-wins authority by another name.
 */
const CAPTURE_CANDIDATE_READ_LIMIT = 4;

const PROCESSING_ATTEMPT_COLUMNS =
  "id, webhook_event_id, chaos_run_id, source_kind, status, is_duplicate_delivery, payment_attempt_id, payment_id, error_code, started_at, finished_at, state_before, state_after";

/**
 * Loads the complete set of trusted persisted rows one chaos run's evidence
 * bundle is assembled from.
 *
 * `chaosRunId` is the ONLY input — an internal PayChaos UUID. Returns `null`
 * when no such chaos run exists (a genuinely absent record, distinct from a
 * read failure). Throws `ChaosEvidenceRepositoryError` on a genuine database
 * I/O failure, so an infrastructure problem can never be mistaken for
 * "this evidence does not exist".
 *
 * The reads, in order:
 *
 *   1. the exact `chaos_runs` row;
 *   2. the exact canonical `webhook_events` row named by
 *      `source_webhook_event_id`, if that column is non-NULL (an exact
 *      internal UUID match — never a fuzzy, timestamp-only or provider-ID
 *      substring match);
 *   3. the canonical row count for that webhook's `razorpay_event_id`, which
 *      is how C01 proves a replay never became a new canonical event;
 *   4. the ORIGINAL provider processing attempts for that source webhook:
 *      `source_kind = REAL_RAZORPAY_WEBHOOK` AND `chaos_run_id IS NULL`;
 *   5. every processing attempt linked to THIS chaos run by exact
 *      `chaos_run_id`, whatever its `source_kind` — read unfiltered on
 *      purpose, so an attempt carrying unexpected provenance surfaces as an
 *      integrity gap instead of silently disappearing from the bundle.
 *
 * Provenance is always taken from the persisted `source_kind` column — never
 * inferred from names, timestamps or ordering, and never relabelled.
 */
export async function loadChaosRunEvidenceSource(
  chaosRunId: string,
): Promise<ChaosRunEvidenceSource | null> {
  const client = getSupabaseServerClient();

  const { data: run, error: runError } = await client
    .from("chaos_runs")
    .select(CHAOS_RUN_COLUMNS)
    .eq("id", chaosRunId)
    .maybeSingle();

  if (runError) {
    throw new ChaosEvidenceRepositoryError(
      "CHAOS_EVIDENCE_RUN_LOOKUP_FAILED",
      "Failed to load the chaos run for evidence assembly.",
    );
  }
  if (!run) {
    return null;
  }

  let sourceWebhook: RawWebhookEvidenceRow | null = null;
  let canonicalSourceEventCount: number | null = null;
  let originalProcessingAttempts: RawProcessingAttemptEvidenceRow[] = [];

  if (run.source_webhook_event_id) {
    const { data: webhook, error: webhookError } = await client
      .from("webhook_events")
      .select(WEBHOOK_EVENT_COLUMNS)
      .eq("id", run.source_webhook_event_id)
      .maybeSingle();

    if (webhookError) {
      throw new ChaosEvidenceRepositoryError(
        "CHAOS_EVIDENCE_WEBHOOK_LOOKUP_FAILED",
        "Failed to load the source webhook event for evidence assembly.",
      );
    }
    // A genuinely absent row stays `null` — the pure builder reports it as a
    // deterministic `SOURCE_WEBHOOK_NOT_FOUND` gap rather than this module
    // inventing a substitute.
    sourceWebhook = webhook;

    if (sourceWebhook) {
      const { count, error: countError } = await client
        .from("webhook_events")
        .select("id", { count: "exact", head: true })
        .eq("razorpay_event_id", sourceWebhook.razorpay_event_id);

      if (countError) {
        throw new ChaosEvidenceRepositoryError(
          "CHAOS_EVIDENCE_CANONICAL_COUNT_FAILED",
          "Failed to count canonical webhook events for evidence assembly.",
        );
      }
      canonicalSourceEventCount = count ?? null;
    }

    const { data: originals, error: originalsError } = await client
      .from("event_processing_attempts")
      .select(PROCESSING_ATTEMPT_COLUMNS)
      .eq("webhook_event_id", run.source_webhook_event_id)
      .eq("source_kind", "REAL_RAZORPAY_WEBHOOK")
      .is("chaos_run_id", null);

    if (originalsError) {
      throw new ChaosEvidenceRepositoryError(
        "CHAOS_EVIDENCE_ORIGINAL_ATTEMPT_LOOKUP_FAILED",
        "Failed to load the original processing attempts for evidence assembly.",
      );
    }
    originalProcessingAttempts = originals ?? [];
  }

  const { data: chaosAttempts, error: chaosAttemptsError } = await client
    .from("event_processing_attempts")
    .select(PROCESSING_ATTEMPT_COLUMNS)
    .eq("chaos_run_id", chaosRunId);

  if (chaosAttemptsError) {
    throw new ChaosEvidenceRepositoryError(
      "CHAOS_EVIDENCE_CHAOS_ATTEMPT_LOOKUP_FAILED",
      "Failed to load the chaos-linked processing attempts for evidence assembly.",
    );
  }

  // ==========================================================================
  // AUTHORITATIVE CAPTURE SEARCH
  // ==========================================================================
  //
  // WHY THIS EXISTS. `sourceWebhook` is only the chaos run's SOURCE event. A
  // C11 run is sourced from `payment.failed` by definition, and C01/C07 may
  // legitimately be sourced from `order.paid` (see `requiredSourceEventTypes`
  // in lib/chaos/registry.ts) — which docs/MONEY_INVARIANTS.md §5 explicitly
  // downgrades to "corroborating" evidence. So the frozen bundle carried NO
  // way to establish a verified captured-payment basis, which INV-004 §8
  // condition 3 and INV-010 §8 both require, and which INV-003 §12 needs as
  // its "capture-event search result".
  //
  // `payments.captured_at` cannot substitute for it. That column is written by
  // `process_webhook_payment_event`'s own `payment.captured` branch
  // (`captured_at = coalesce(captured_at, v_now)`) — i.e. by the very merchant
  // processing transaction these invariants exist to audit. Trusting it as
  // proof of an authoritative capture basis would be circular, and
  // docs/MONEY_INVARIANTS.md §4 ranks verified provider evidence strictly
  // above durable PayChaos state. It remains SUPPORTING evidence only, and it
  // already reaches the bundle inside the merchant-state snapshots.
  //
  // SUBJECT RESOLUTION. Both identity dimensions come ONLY from trusted
  // persisted rows — the chaos run's own FK column and the canonical source
  // webhook's own normalized columns. Never a browser value, never a
  // caller-supplied Razorpay id, never a value parsed out of a payload here.
  //
  // TWO SEPARATE EXACT QUERIES, NOT ONE `.or(...)`. PostgREST's `.or()` takes
  // a filter string, which would mean interpolating identifiers into a filter
  // DSL. Two independent parameterized `.eq()` reads avoid constructing any
  // filter expression from data at all, and the union is computed in the pure
  // builder. Every filter here is exact equality — never `like`, `ilike`, a
  // substring, a prefix, a fuzzy match, a timestamp preference or an ordering
  // that could act as "latest wins".
  //
  // A FAILED SEARCH IS NEVER SILENCE. If either read fails this throws, so an
  // infrastructure failure can never be mistaken for "no capture evidence
  // exists". `captureProviderSearchPerformed` records whether the PROVIDER
  // identity dimension was actually searched — the pure builder refuses to
  // report a complete negative result without it, because an internal-FK-only
  // search could miss a genuine capture whose `payment_id` correlation is
  // absent.
  const captureSubjectRazorpayPaymentId =
    sourceWebhook?.razorpay_payment_id ?? null;
  const captureSubjectInternalPaymentIds: string[] = [];
  if (run.payment_id) {
    captureSubjectInternalPaymentIds.push(run.payment_id);
  }
  if (sourceWebhook?.payment_id) {
    captureSubjectInternalPaymentIds.push(sourceWebhook.payment_id);
  }

  const captureCandidates: RawWebhookEvidenceRow[] = [];
  let captureProviderSearchPerformed = false;

  // The ENTIRE search is gated on having an exact trusted PROVIDER identity.
  //
  // This is not an optimization, it is the completeness rule expressed as
  // control flow. Without a provider identity the pure resolver returns
  // `SEARCH_INCOMPLETE` no matter what any other query found, because an
  // internal-`payment_id`-only search cannot see a genuine capture whose
  // internal correlation is missing — and reporting "no capture exists" from
  // such a search would produce a false INV-003/INV-004/INV-010 finding.
  // Issuing reads whose results can never change the outcome would only
  // create the illusion that a negative result had been established.
  if (captureSubjectRazorpayPaymentId) {
    const { data: providerMatches, error: providerMatchError } = await client
      .from("webhook_events")
      .select(WEBHOOK_EVENT_COLUMNS)
      .eq("razorpay_payment_id", captureSubjectRazorpayPaymentId)
      .eq("event_type", CAPTURE_EVENT_TYPE)
      .eq("source_kind", CAPTURE_SOURCE_KIND)
      .eq("signature_verified", true)
      .limit(CAPTURE_CANDIDATE_READ_LIMIT);

    if (providerMatchError) {
      throw new ChaosEvidenceRepositoryError(
        "CHAOS_EVIDENCE_CAPTURE_PROVIDER_LOOKUP_FAILED",
        "Failed to search for authoritative capture evidence by provider payment identity.",
      );
    }
    captureProviderSearchPerformed = true;
    captureCandidates.push(...(providerMatches ?? []));

    // The internal dimension is searched independently and unioned in, so a
    // capture row that IS relationally correlated but carries no normalized
    // `razorpay_payment_id` still surfaces rather than being invisible.
    // Deduplication by `id` happens in the pure builder.
    for (const internalPaymentId of captureSubjectInternalPaymentIds) {
      const { data: internalMatches, error: internalMatchError } = await client
        .from("webhook_events")
        .select(WEBHOOK_EVENT_COLUMNS)
        .eq("payment_id", internalPaymentId)
        .eq("event_type", CAPTURE_EVENT_TYPE)
        .eq("source_kind", CAPTURE_SOURCE_KIND)
        .eq("signature_verified", true)
        .limit(CAPTURE_CANDIDATE_READ_LIMIT);

      if (internalMatchError) {
        throw new ChaosEvidenceRepositoryError(
          "CHAOS_EVIDENCE_CAPTURE_INTERNAL_LOOKUP_FAILED",
          "Failed to search for authoritative capture evidence by internal payment identity.",
        );
      }
      captureCandidates.push(...(internalMatches ?? []));
    }
  }

  return {
    // Deterministic ordering is applied by the pure builder, never relied
    // upon from the database's own return order.
    run: run as RawChaosRunEvidenceRow,
    sourceWebhook,
    originalProcessingAttempts,
    chaosProcessingAttempts: chaosAttempts ?? [],
    canonicalSourceEventCount,
    captureSubjectRazorpayPaymentId,
    captureSubjectInternalPaymentIds,
    captureProviderSearchPerformed,
    captureCandidates,
  };
}
