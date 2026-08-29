import "server-only";

import {
  getOrderBaseline,
  isFreshBaseline,
  loadC01SourceEvidence,
  loadC11RealWebhookFailureEvidence,
} from "@/lib/chaos/repository";
import { getSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Phase 3H — server-proven eligible subjects for the chaos scenario selector.
 *
 * WHY THIS EXISTS. Every frozen loader (`loadC01SourceEvidence`,
 * `loadC11RealWebhookFailureEvidence`, `getOrderBaseline`) VALIDATES one
 * supplied identifier. None of them LISTS candidates. Without a list the UI
 * would have to accept a free-text UUID, which is exactly the arbitrary-input
 * surface `CLAUDE.md` Section 6 forbids. This module produces the list, and
 * every candidate it emits is confirmed by the frozen validator itself — not
 * by a parallel re-implementation of the precheck rules.
 *
 * NO ARBITRARY TARGET. A candidate carries internal UUIDs and short factual
 * metadata. There is no URL, host, IP, endpoint, script or fault field
 * anywhere in these shapes.
 *
 * NO PROVIDER FABRICATION. Candidates are drawn only from rows that already
 * exist. `webhook_events` is CHECK-constrained so every row is a genuine
 * signature-verified Razorpay Test Mode delivery; this module reads them and
 * creates none.
 *
 * `TEST_FIXTURE` IS NOT OFFERED. The frozen `ChaosFailureEvidenceRef` includes
 * a `TEST_FIXTURE` kind, but `loadC11TestFixtureFailureEvidence` deterministically
 * returns "unavailable" because no fixture store exists. Presenting it to an
 * operator would advertise evidence that cannot resolve, so C11-B lists real
 * webhook evidence only.
 *
 * LISTING IS NOT AUTHORIZATION. A candidate can go stale between listing and
 * execution — an order can be paid, a baseline can stop being fresh. The run
 * route therefore calls `revalidateEligibility(...)` again before it trusts
 * anything, and `createChaosRun` still runs the full precheck after that.
 *
 * A READ FAILURE IS NOT AN EMPTY RESULT. If a candidate query fails, this
 * module THROWS rather than returning `[]`. The two states look identical in a
 * list but mean opposite things: "no eligible evidence exists" is a fact an
 * operator can act on, while "eligibility could not be determined" is an
 * outage. Collapsing the second into the first would let the UI state a
 * confident falsehood about the merchant's evidence.
 */

/** Deterministic domain error — never leaks a raw Supabase error or payload. */
export class ChaosEligibilityServiceError extends Error {
  readonly code: "ELIGIBILITY_READ_FAILED";

  constructor() {
    super("Eligible chaos sources could not be determined.");
    this.name = "ChaosEligibilityServiceError";
    this.code = "ELIGIBILITY_READ_FAILED";
  }
}

/** A source that is a verified Razorpay webhook event. */
export interface WebhookSourceCandidate {
  readonly kind: "WEBHOOK_EVENT";
  readonly webhookEventId: string;
  readonly eventType: string;
  readonly receivedAt: string;
  /** The internal order this event correlates to, when one resolves. */
  readonly orderId: string;
  /** Provenance, from the persisted column — never assumed. */
  readonly sourceKind: string;
}

/** A source that is an internal merchant order in a fresh baseline state. */
export interface OrderSubjectCandidate {
  readonly kind: "ORDER";
  readonly orderId: string;
  readonly paymentStatus: string;
  readonly businessStatus: string;
  readonly fulfilmentCount: number;
  readonly createdAt: string;
}

export type EligibilityResult =
  /** The scenario needs no subject at all (C03). */
  | { readonly kind: "NO_SOURCE_REQUIRED" }
  | {
      readonly kind: "WEBHOOK_SOURCES";
      readonly candidates: readonly WebhookSourceCandidate[];
    }
  | {
      readonly kind: "ORDER_SUBJECTS";
      readonly candidates: readonly OrderSubjectCandidate[];
    };

/**
 * The mechanism an operator is choosing for, since C11 has two and they need
 * different evidence. Not a scenario ID.
 */
export type EligibilityRequest =
  | { readonly scenarioId: "C01" }
  | { readonly scenarioId: "C03" }
  | { readonly scenarioId: "C07" }
  | { readonly scenarioId: "C11"; readonly mechanism: "A" }
  | { readonly scenarioId: "C11"; readonly mechanism: "B" };

/** How many candidates a selector will show. Deliberately small. */
const CANDIDATE_LIMIT = 25;

/**
 * Verified webhook events of the given types, newest first.
 *
 * Only `signature_verified` rows are considered. The table's CHECK already
 * guarantees that, but asserting it here means a future schema widening
 * cannot silently start offering unverified evidence to an operator.
 */
async function listVerifiedWebhookEventIds(
  eventTypes: readonly string[],
): Promise<
  ReadonlyArray<{
    id: string;
    event_type: string;
    source_kind: string;
    received_at: string;
  }>
> {
  const client = getSupabaseServerClient();
  const { data, error } = await client
    .from("webhook_events")
    .select("id, event_type, source_kind, signature_verified, received_at")
    .in("event_type", [...eventTypes])
    .eq("signature_verified", true)
    .order("received_at", { ascending: false })
    .limit(CANDIDATE_LIMIT);

  // An outage is not "no verified webhooks exist".
  if (error) throw new ChaosEligibilityServiceError();
  return (data ?? [])
    .filter((row) => row.signature_verified === true)
    .map((row) => ({
      id: row.id,
      event_type: row.event_type,
      source_kind: row.source_kind,
      received_at: row.received_at,
    }));
}

/**
 * C01 candidates: verified `payment.captured`/`order.paid` events that the
 * FROZEN loader itself confirms are usable.
 *
 * The loader is the authority. A row that looks right but fails
 * `loadC01SourceEvidence` (missing correlation, unresolvable order) is simply
 * not offered, rather than being offered and then blocked at PRECHECK-07.
 */
async function listC01Candidates(): Promise<readonly WebhookSourceCandidate[]> {
  const rows = await listVerifiedWebhookEventIds([
    "payment.captured",
    "order.paid",
  ]);

  const candidates: WebhookSourceCandidate[] = [];
  for (const row of rows) {
    const evidence = await loadC01SourceEvidence(row.id);
    if (evidence === null) continue;
    candidates.push({
      kind: "WEBHOOK_EVENT",
      webhookEventId: evidence.webhookEventId,
      eventType: row.event_type,
      receivedAt: row.received_at,
      orderId: evidence.orderId,
      sourceKind: row.source_kind,
    });
  }
  return Object.freeze(candidates);
}

/**
 * C11-B candidates: verified `payment.failed` evidence the frozen loader
 * confirms. Real webhook evidence only — never `TEST_FIXTURE`.
 */
async function listC11BCandidates(): Promise<
  readonly WebhookSourceCandidate[]
> {
  const rows = await listVerifiedWebhookEventIds(["payment.failed"]);

  const candidates: WebhookSourceCandidate[] = [];
  for (const row of rows) {
    const evidence = await loadC11RealWebhookFailureEvidence(row.id);
    if (evidence === null) continue;
    candidates.push({
      kind: "WEBHOOK_EVENT",
      webhookEventId: evidence.webhookEventId,
      eventType: row.event_type,
      receivedAt: row.received_at,
      orderId: evidence.orderId,
      sourceKind: row.source_kind,
    });
  }
  return Object.freeze(candidates);
}

/**
 * C07 and C11-A candidates: orders in a FRESH baseline.
 *
 * Freshness is decided by the frozen `isFreshBaseline` (UNPAID + OPEN + zero
 * fulfilments), not by a query filter written here, so the definition cannot
 * drift from PRECHECK-08.
 */
async function listFreshOrderCandidates(): Promise<
  readonly OrderSubjectCandidate[]
> {
  const client = getSupabaseServerClient();
  const { data, error } = await client
    .from("orders")
    .select("id, payment_status, business_status, created_at")
    .eq("payment_status", "UNPAID")
    .eq("business_status", "OPEN")
    .order("created_at", { ascending: false })
    .limit(CANDIDATE_LIMIT);

  // An outage is not "no fresh orders exist".
  if (error) throw new ChaosEligibilityServiceError();

  const candidates: OrderSubjectCandidate[] = [];
  for (const row of data ?? []) {
    const baseline = await getOrderBaseline(row.id);
    if (baseline === null || !isFreshBaseline(baseline)) continue;
    candidates.push({
      kind: "ORDER",
      orderId: baseline.orderId,
      paymentStatus: baseline.paymentStatus,
      businessStatus: baseline.businessStatus,
      fulfilmentCount: baseline.fulfilmentCount,
      createdAt: row.created_at,
    });
  }
  return Object.freeze(candidates);
}

/**
 * Lists what an operator may choose for one scenario/mechanism.
 *
 * An EMPTY candidate list is a valid, truthful answer. It means the database
 * currently holds no evidence this scenario can safely use, and the UI must
 * disable the run rather than invent an option.
 */
export async function listEligibleSources(
  request: EligibilityRequest,
): Promise<EligibilityResult> {
  if (request.scenarioId === "C03") {
    return { kind: "NO_SOURCE_REQUIRED" };
  }

  if (request.scenarioId === "C01") {
    return { kind: "WEBHOOK_SOURCES", candidates: await listC01Candidates() };
  }

  if (request.scenarioId === "C07") {
    return {
      kind: "ORDER_SUBJECTS",
      candidates: await listFreshOrderCandidates(),
    };
  }

  // C11 — the mechanism decides which evidence applies.
  if (request.mechanism === "A") {
    return {
      kind: "ORDER_SUBJECTS",
      candidates: await listFreshOrderCandidates(),
    };
  }
  return { kind: "WEBHOOK_SOURCES", candidates: await listC11BCandidates() };
}

/**
 * Re-confirms one chosen subject at execution time.
 *
 * Listing is not authorization. Between the operator seeing a candidate and
 * pressing Run, an order can be paid or a baseline can stop being fresh, so
 * the run route calls this again and refuses anything that no longer holds.
 * `createChaosRun` then still runs the full frozen precheck — this is an
 * additional gate, never a replacement for one.
 */
export async function revalidateEligibility(
  request: EligibilityRequest,
  subjectId: string,
): Promise<boolean> {
  if (request.scenarioId === "C03") return false; // C03 takes no subject.

  if (request.scenarioId === "C01") {
    return (await loadC01SourceEvidence(subjectId)) !== null;
  }

  if (request.scenarioId === "C07") {
    const baseline = await getOrderBaseline(subjectId);
    return baseline !== null && isFreshBaseline(baseline);
  }

  if (request.mechanism === "A") {
    const baseline = await getOrderBaseline(subjectId);
    return baseline !== null && isFreshBaseline(baseline);
  }

  return (await loadC11RealWebhookFailureEvidence(subjectId)) !== null;
}
