/**
 * Phase 3E-B — the PURE, deterministic per-chaos-run evidence assembly
 * domain (docs/PHASE_PLAN.md "Phase 3E — Evidence Snapshot": "Collect all
 * deterministic inputs required for invariant evaluation").
 *
 * `import "server-only"` for the same structural reason as
 * `lib/evidence/merchant-state-snapshot.ts`: a chaos-run evidence bundle is
 * server-side truth assembled from service-role reads and must never be
 * reachable from a client bundle, even though this particular file performs
 * no I/O of its own.
 *
 * ============================================================================
 * WHAT THIS MODULE IS, AND IS NOT
 * ============================================================================
 *
 * IS: a pure function from already-read, trusted persisted rows to one
 * versioned, deterministically ordered `ChaosRunEvidenceBundleV1`. No
 * Supabase client, no `fetch`, no Razorpay call, no LLM call, no randomness,
 * no clock read. The same rows always produce a deep-equal bundle — which is
 * exactly what docs/MONEY_INVARIANTS.md Principle 1 requires of the evidence
 * Phase 3F will evaluate.
 *
 * IS NOT: a Money Invariant Engine. Nothing here assigns `PASS`, `FAIL`,
 * `UNKNOWN`, `NOT_APPLICABLE` or `ERROR`; nothing here writes an
 * `invariant_results` row; nothing here creates a finding, a diagnosis, a
 * recommendation or a score. There is deliberately NO verdict field anywhere
 * in the bundle. Phase 3E-B says what the durable facts ARE; Phase 3F alone
 * decides what they MEAN (docs/PHASE_PLAN.md "Phase 3F — Money Invariant
 * Engine": "deterministic evaluators, evidence requirement checks and
 * PASS/FAIL/UNKNOWN").
 *
 * ============================================================================
 * THE HISTORICAL TRUTH RULE (the single most important rule here)
 * ============================================================================
 *
 * This module NEVER reconstructs a missing `state_before`/`state_after` from
 * current, mutable merchant rows, and the repository that feeds it never
 * reads `orders`/`payment_attempts`/`payments`/`fulfilments` at all.
 *
 * Phase 3E-A deliberately left every pre-Phase-3E processing attempt's
 * snapshot columns `NULL` and proved (handoffs/PHASE-3E-A-HANDOFF.md §12b:
 * 20 attempts, 0 non-null `state_before`, 0 non-null `state_after`) that no
 * backfill occurred. Those `NULL`s are AUTHORITATIVE HISTORICAL TRUTH — they
 * mean "this evidence was never captured", not "look it up somewhere else".
 * Substituting today's order row would be a fabricated claim about a
 * processing attempt that ran in the past. A missing snapshot therefore
 * becomes a deterministic evidence GAP and nothing more.
 *
 * ============================================================================
 * A GAP IS NOT A VERDICT
 * ============================================================================
 *
 * An `EvidenceGap` states one factual thing: the assembler could not
 * establish a required factual input from the durable record. It is not
 * `FAIL`, not `UNKNOWN`, not `ERROR`, not `NOT_APPLICABLE` and not
 * "unreliable merchant". Phase 3F may well map a particular gap to
 * `UNKNOWN` — that mapping is Phase 3F's decision, made in Phase 3F's code.
 */
import "server-only";

import { getScenarioDefinition } from "@/lib/chaos/registry";
import type { ChaosScenarioId, InvariantId } from "@/lib/chaos/types";
import { MERCHANT_STATE_SNAPSHOT_VERSION } from "@/lib/evidence/merchant-state-snapshot";
import type {
  MerchantStateSnapshotFulfilmentV1,
  MerchantStateSnapshotOrderV1,
  MerchantStateSnapshotPaymentAttemptV1,
  MerchantStateSnapshotPaymentV1,
  MerchantStateSnapshotV1,
} from "@/lib/evidence/merchant-state-snapshot";
import type {
  ChaosRunDataClassification,
  ChaosRunExecutionBlockCode,
  ChaosRunFailedPrecheckId,
  ChaosRunFaultType,
  ChaosRunOutcome,
  ChaosRunStatus,
} from "@/lib/supabase/types";

/**
 * Bundle envelope version. Bump ONLY when the assembled shape changes in a
 * way a Phase 3F evaluator must branch on. The bundle is an IN-MEMORY
 * contract — it is never persisted, and Phase 3E-B deliberately creates no
 * evidence table for it (docs/DATABASE.md "No generic evidence table":
 * evidence lives on the existing records and is later referenced by
 * `invariant_results.evidence_refs`).
 */
export const CHAOS_RUN_EVIDENCE_BUNDLE_VERSION = 1 as const;

/**
 * The frozen C01 replay count, restated here rather than imported.
 *
 * `lib/chaos/replay-service.ts` owns the executable constant
 * (`C01_REPLAY_ATTEMPT_COUNT = 2`), but importing that module would pull the
 * entire chaos EXECUTION surface — the merchant processor, the replay
 * repository, the run lifecycle writers — into a strictly read-only
 * assembler. A read-only module must not be able to reach an execution path
 * even transitively. The two values are instead kept in lockstep by
 * `tests/unit/evidence/phase3e-b-static-guard.test.ts`, which reads both
 * files as text and fails if they ever diverge.
 */
export const C01_EXPECTED_REPLAY_ATTEMPT_COUNT = 2;

/**
 * The frozen C11-B replay count (`C11_REPLAY_ATTEMPT_COUNT = 1` in
 * `lib/chaos/c11-execution-service.ts`) — restated for the same reason as
 * `C01_EXPECTED_REPLAY_ATTEMPT_COUNT` above, and guarded the same way.
 */
export const C11B_EXPECTED_REPLAY_ATTEMPT_COUNT = 1;

/** C11-A is pure observation: it performs no replay at all. */
export const C11A_EXPECTED_REPLAY_ATTEMPT_COUNT = 0;

// ============================================================================
// EVIDENCE REFERENCES
// ============================================================================

/**
 * The reference kinds a future `invariant_results.evidence_refs` array may
 * carry (docs/DATABASE.md "Evidence References"). `ORDER` and
 * `PAYMENT_ATTEMPT` extend that document's non-exhaustive "may reference
 * records such as" list; both are internal PayChaos entities whose UUIDs
 * already appear on the trusted rows this module reads.
 */
export type EvidenceRefKind =
  | "CHAOS_RUN"
  | "FULFILMENT"
  | "ORDER"
  | "PAYMENT"
  | "PAYMENT_ATTEMPT"
  | "PROCESSING_ATTEMPT"
  | "WEBHOOK_EVENT";

/**
 * One structured evidence reference: a kind plus an internal UUID, and
 * NOTHING else (docs/DATABASE.md: "Each reference must contain: evidence
 * kind; internal UUID. Do not copy entire webhook payloads into invariant
 * results."). No raw payload, no signature, no normalized event, no secret,
 * no customer data, no diagnosis, no recommendation, no PASS/FAIL.
 */
export interface EvidenceRef {
  readonly kind: EvidenceRefKind;
  readonly id: string;
}

// ============================================================================
// EVIDENCE GAPS
// ============================================================================

/**
 * Deterministic factual gap codes. Each states that a required factual input
 * could not be established from the durable record — never a money verdict.
 */
export type EvidenceGapCode =
  /** The run has not reached `COMPLETED`, so its execution evidence is not final. */
  | "RUN_NOT_COMPLETED"
  /** The run terminated `BLOCKED`: by contract no replay/fault injection ever ran, so there is no execution evidence to assemble. */
  | "RUN_BLOCKED_BEFORE_EXECUTION"
  /** The scenario requires a source webhook, but `chaos_runs.source_webhook_event_id` is NULL. */
  | "MISSING_SOURCE_WEBHOOK_LINK"
  /** `source_webhook_event_id` is set, but no `webhook_events` row with that id could be resolved. */
  | "SOURCE_WEBHOOK_NOT_FOUND"
  /** The resolved source webhook is not `REAL_RAZORPAY_WEBHOOK`. */
  | "SOURCE_PROVENANCE_MISMATCH"
  /** The resolved source webhook's `signature_verified` is not `true`. */
  | "SOURCE_SIGNATURE_NOT_VERIFIED"
  /** The resolved source webhook's `event_type` is not one this scenario declares. */
  | "SOURCE_EVENT_TYPE_UNEXPECTED"
  /**
   * The canonical source event has not completed processing
   * (`webhook_events.processing_status !== 'PROCESSED'`). Authoritative
   * provider evidence is only complete once the canonical event itself
   * finished processing — an event still `RECEIVED`/`PROCESSING`, or one that
   * ended `FAILED`, is a factually incomplete source.
   */
  | "SOURCE_PROCESSING_NOT_PROCESSED"
  /** The canonical `webhook_events` row count for the source Razorpay event id could not be established. */
  | "MISSING_CANONICAL_SOURCE_EVENT_COUNT"
  /** The canonical `webhook_events` row count for the source Razorpay event id is not exactly one. */
  | "UNEXPECTED_CANONICAL_SOURCE_EVENT_COUNT"
  /**
   * No AUTHORITATIVE original provider processing attempt could be resolved
   * for the source webhook. Deliberately NOT "zero rows exist": a canonical
   * event may legitimately carry several `REAL_RAZORPAY_WEBHOOK` attempts
   * over time, and a lone attempt that ended `FAILED` (or that is flagged
   * `is_duplicate_delivery`) is not an authoritative original either.
   */
  | "MISSING_AUTHORITATIVE_ORIGINAL_PROCESSING_ATTEMPT"
  /**
   * More than one attempt satisfies the authoritative-original candidate
   * rule, so there is no deterministic way to name THE canonical original.
   * Fails closed — never "pick the latest".
   */
  | "AMBIGUOUS_AUTHORITATIVE_ORIGINAL_PROCESSING_ATTEMPT"
  /** A processing attempt linked to this chaos run does not carry `PAYCHAOS_REPLAY` provenance. */
  | "PROCESSING_PROVENANCE_MISMATCH"
  /** The number of chaos-run-linked processing attempts differs from what this scenario's frozen mechanism produces. */
  | "UNEXPECTED_CHAOS_PROCESSING_ATTEMPT_COUNT"
  /** A relevant processing attempt's `state_before` is NULL — authoritative "never captured", never backfilled. */
  | "MISSING_STATE_BEFORE"
  /** A relevant processing attempt's `state_after` is NULL — authoritative "never captured", never backfilled. */
  | "MISSING_STATE_AFTER"
  /** A relevant processing attempt's `state_before` is present but is not a valid `MerchantStateSnapshotV1`. */
  | "INVALID_STATE_BEFORE"
  /** A relevant processing attempt's `state_after` is present but is not a valid `MerchantStateSnapshotV1`. */
  | "INVALID_STATE_AFTER"
  /** The scenario requires a correlated order, but `chaos_runs.order_id` is NULL. */
  | "MISSING_ORDER_REFERENCE"
  /** The scenario requires a correlated payment attempt, but `chaos_runs.payment_attempt_id` is NULL. */
  | "MISSING_PAYMENT_ATTEMPT_REFERENCE"
  /** The scenario requires a correlated payment, but `chaos_runs.payment_id` is NULL. */
  | "MISSING_PAYMENT_REFERENCE"
  /** The run's `fault_type` is not the frozen primitive this scenario uses. */
  | "UNEXPECTED_FAULT_TYPE"
  /** The run's `data_classification` is not the one this scenario's frozen evidence model requires. */
  | "UNEXPECTED_DATA_CLASSIFICATION"
  /** C03's persisted `fault_state` does not carry exactly the two frozen verification checks. */
  | "MISSING_C03_VERIFICATION_CHECKS"
  /**
   * C03's persisted `fault_state` carries no `mutationEvidence` key at all —
   * the legacy shape written before this correction existed. Authoritative
   * "never captured", never backfilled: a snapshot taken today would be a
   * false claim about a run that executed in the past.
   */
  | "MISSING_C03_MUTATION_EVIDENCE"
  /** C03's `mutationEvidence` is present but is not the exact frozen validated shape. */
  | "INVALID_C03_MUTATION_EVIDENCE"
  /**
   * C03's mutation evidence exists but is not complete enough to support a
   * delta comparison: a side is `null`, a required collection is `null`, or a
   * collection was truncated (`complete: false`). Two truncated prefixes must
   * never be compared and called "unchanged".
   */
  | "INCOMPLETE_C03_MUTATION_EVIDENCE"
  /** No trustworthy subject identity could be established for the authoritative capture search. */
  | "MISSING_CAPTURE_SEARCH_SUBJECT"
  /** Trusted persisted rows disagree about which payment the capture search is about. Fails closed — never picks one. */
  | "AMBIGUOUS_CAPTURE_SEARCH_SUBJECT"
  /**
   * A capture subject exists, but the search could not be established as
   * covering the canonical webhook evidence for that exact payment identity
   * (no trusted provider identity was available to search by). A negative
   * result under these conditions is NOT proof that no capture exists.
   */
  | "INCOMPLETE_CAPTURE_SEARCH"
  /** More than one verified provider capture candidate matched. Fails closed — never "pick the latest". */
  | "AMBIGUOUS_AUTHORITATIVE_CAPTURE_WEBHOOK"
  /**
   * Exactly one verified provider `payment.captured` event matched the trusted
   * provider identity, but its internal `payment_id` correlation is absent or
   * disagrees with the run's internal subject. The capture evidence is REAL
   * and stays visible; only the relational link INV-004/INV-010 need is
   * missing.
   */
  | "INCOMPLETE_CAPTURE_INTERNAL_CORRELATION"
  /** A C03 run carries a merchant/provider FK it must never have. */
  | "UNEXPECTED_C03_PROVIDER_LINK"
  /** C07's persisted `fault_state` is not exactly `{armed: true, consumed: <boolean>}`. */
  | "MISSING_C07_FAULT_STATE"
  /** C07's fault was armed but never consumed, so no client-confirmation drop was actually exercised. */
  | "C07_FAULT_NOT_CONSUMED"
  /** The observed C11 evidence shape matches neither the A (zero-replay) nor the B (one-replay) mechanism. */
  | "AMBIGUOUS_C11_EVIDENCE_SHAPE";

/**
 * One factual gap. `subjectId` is the internal UUID the gap is about (which
 * processing attempt lacks a snapshot, which attempt carries the wrong
 * provenance) or `null` for a run-level gap. Never free text, never a raw
 * database error, never a verdict.
 */
export interface EvidenceGap {
  readonly code: EvidenceGapCode;
  readonly subjectId: string | null;
}

// ============================================================================
// SAFE PROJECTIONS
// ============================================================================

/**
 * Explicit allowlist projection of `chaos_runs` — never the raw row.
 *
 * `fault_config` and `fault_state` are deliberately ABSENT: a generic
 * arbitrary JSON blob is exactly what this projection exists to prevent.
 * Each scenario's own safe, validated facts appear under
 * `ChaosRunEvidenceBundleV1.scenarioEvidence` instead (C03's two verification
 * checks, C07's armed/consumed booleans) — nothing else from `fault_state`
 * ever reaches a caller. `error_message_redacted` is also absent: it is
 * operator-facing prose, not a deterministic evaluation input.
 */
export interface SafeChaosRunEvidence {
  readonly id: string;
  readonly scenarioId: ChaosScenarioId;
  readonly status: ChaosRunStatus;
  readonly outcome: ChaosRunOutcome | null;
  readonly faultType: ChaosRunFaultType | null;
  readonly dataClassification: ChaosRunDataClassification;
  readonly orderId: string | null;
  readonly paymentAttemptId: string | null;
  readonly paymentId: string | null;
  readonly sourceWebhookEventId: string | null;
  readonly failedPrecheckId: ChaosRunFailedPrecheckId | null;
  readonly executionBlockCode: ChaosRunExecutionBlockCode | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
}

/**
 * Explicit allowlist projection of `webhook_events` — never the raw row.
 *
 * Deliberately ABSENT: `raw_payload_redacted`, `raw_body_sha256`, any
 * signature value, any header, `provider_created_at`'s sibling free-text
 * columns, and every customer-identifying field. An invariant needs
 * provenance, authenticity, correlation and delivery counts — not the
 * payload.
 */
export interface SafeWebhookEvidence {
  readonly id: string;
  readonly razorpayEventId: string;
  readonly eventType: string;
  readonly sourceKind: string;
  readonly signatureVerified: boolean;
  readonly processingStatus: string;
  readonly duplicateDeliveryCount: number;
  readonly receivedAt: string;
  readonly paymentAttemptId: string | null;
  readonly paymentId: string | null;
  /**
   * The trusted, normalized Razorpay Payment identifier this canonical event
   * refers to, or `null` when normalization established none.
   *
   * A persisted provider identifier, not customer data. Exposed because the
   * authoritative-capture search genuinely needs it: correlating capture
   * evidence by internal `payment_id` ALONE could report "no capture exists"
   * for a genuine capture whose internal correlation is missing, which would
   * produce a false INV-003/INV-004/INV-010 failure. A false payment finding
   * is not a safe outcome, so the exact provider identity is a required input
   * rather than a convenience.
   *
   * `razorpay_order_id` is deliberately NOT exposed: the capture-correlation
   * contract does not use it, and a field is never surfaced merely because the
   * column exists.
   */
  readonly razorpayPaymentId: string | null;
  /**
   * Trusted normalized money terms carried by this canonical event, or `null`
   * when normalization established none.
   *
   * Required by docs/MONEY_INVARIANTS.md INV-008 §8: "If trusted normalized
   * webhook evidence contains amount/currency, it must match the canonical
   * payment values as well." Without these the clause was unevaluable.
   *
   * Integer smallest-currency subunits, straight from the persisted
   * `bigint` column — never a float, never rounded. `null` is preserved
   * exactly and is NEVER defaulted to `0`; INV-008 §16 requires UNKNOWN, not
   * PASS, when a required money value cannot be established.
   */
  readonly amountSubunits: number | null;
  /** Trusted normalized currency, or `null`. Never defaulted to `"INR"` — see `amountSubunits`. */
  readonly currency: string | null;
}

/**
 * The result of runtime-validating one persisted `state_before`/`state_after`
 * JSONB value.
 *
 * `NOT_CAPTURED` is the authoritative historical `NULL` (see the module doc
 * comment's Historical Truth Rule). `INVALID` means a value IS present but is
 * not a valid `MerchantStateSnapshotV1` — never silently accepted, never
 * repaired, never replaced with current merchant state.
 */
export type ParsedProcessingSnapshot =
  | { readonly kind: "NOT_CAPTURED" }
  | { readonly kind: "INVALID" }
  | { readonly kind: "CAPTURED"; readonly snapshot: MerchantStateSnapshotV1 };

/**
 * Explicit allowlist projection of one `event_processing_attempts` row.
 *
 * Deliberately ABSENT: `normalized_event` (the whole blob — see this task's
 * "NO RAW normalized_event COPY" rule; every fact Phase 3F needs from it is
 * already available as a trusted column on `webhook_events` or on this row)
 * and `error_message_redacted` (prose). `errorCode` is kept: it is a fixed,
 * safe, deterministic enum-like value.
 */
export interface ProcessingAttemptEvidence {
  readonly id: string;
  readonly webhookEventId: string | null;
  readonly chaosRunId: string | null;
  readonly sourceKind: string;
  readonly status: string;
  readonly isDuplicateDelivery: boolean;
  readonly paymentAttemptId: string | null;
  readonly paymentId: string | null;
  readonly errorCode: string | null;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly stateBefore: ParsedProcessingSnapshot;
  readonly stateAfter: ParsedProcessingSnapshot;
}

// ============================================================================
// SCENARIO EVIDENCE ENVELOPES
// ============================================================================

export interface C01Evidence {
  readonly scenarioId: "C01";
  readonly expectedReplayAttemptCount: number;
  readonly observedReplayAttemptCount: number;
  readonly chaosLinkedProcessingAttemptCount: number;
  /** Every original provider attempt for the source, INCLUDING failed/retry history. */
  readonly originalProcessingAttemptCount: number;
  /**
   * The id of the ONE authoritative original provider attempt, or `null` when
   * none could be resolved or more than one candidate exists. An id, not a
   * copy — the full projection already lives in
   * `ChaosRunEvidenceBundleV1.originalProcessingAttempts`.
   */
  readonly authoritativeOriginalProcessingAttemptId: string | null;
}

/** C03's two frozen runtime cases, in their frozen execution order. */
export type C03VerificationCase = "WRONG_SIGNATURE" | "MISSING_SIGNATURE";
export type C03VerificationClassification =
  "REJECTED" | "UNEXPECTED_ACCEPTANCE";

export interface C03VerificationCheckEvidence {
  readonly case: C03VerificationCase;
  readonly classification: C03VerificationClassification;
}

/**
 * One bounded collection inside a persisted C03 mutation snapshot.
 *
 * `count` is the exact table cardinality the snapshot was taken from;
 * `complete` says whether `rows` holds all of them. A collection with
 * `complete: false` is a TRUNCATED PREFIX and must never be compared against
 * another prefix and called "unchanged".
 */
export interface C03MutationCollectionEvidence<TRow> {
  readonly count: number;
  readonly rows: readonly TRow[];
  readonly complete: boolean;
}

/** The trusted canonical `webhook_events` row set: internal UUIDs and an exact count only. */
export interface C03TrustedWebhookEventSetEvidence {
  readonly count: number;
  readonly ids: readonly string[];
  readonly complete: boolean;
}

/**
 * One validated C03 mutation snapshot.
 *
 * The four business collections carry FULL ROW-STATE projections, not counts,
 * because an order can move `UNPAID -> PAID` and a payment can gain a
 * `captured_at` while the row count stays identical. A `null` collection means
 * "that table could not be read" and is never conflated with an empty one.
 *
 * The row projections deliberately reuse the frozen `MerchantStateSnapshot*V1`
 * field vocabulary and are validated by the very same row parsers this module
 * already uses for `state_before`/`state_after`, so the two evidence surfaces
 * can never drift apart.
 */
export interface C03MutationSnapshotEvidence {
  readonly orders: C03MutationCollectionEvidence<MerchantStateSnapshotOrderV1> | null;
  readonly paymentAttempts: C03MutationCollectionEvidence<MerchantStateSnapshotPaymentAttemptV1> | null;
  readonly payments: C03MutationCollectionEvidence<MerchantStateSnapshotPaymentV1> | null;
  readonly fulfilments: C03MutationCollectionEvidence<MerchantStateSnapshotFulfilmentV1> | null;
  readonly trustedWebhookEvents: C03TrustedWebhookEventSetEvidence | null;
}

/**
 * C03's validated before/after mutation evidence envelope.
 *
 * Either side may be `null`: a capture failure during execution is recorded
 * truthfully rather than replaced with a fabricated snapshot. This module
 * NEVER compares the two sides — that comparison is INV-005's decision and
 * belongs to Phase 3F.
 */
export interface C03MutationEvidence {
  readonly before: C03MutationSnapshotEvidence | null;
  readonly after: C03MutationSnapshotEvidence | null;
}

/**
 * C03's processor-independent evidence envelope.
 *
 * C03 is architecturally different from every other P0 scenario and Phase
 * 3E-B does not paper over that: it is `SYNTHETIC_DEMO`, it calls the real
 * signature-verification primitive directly, it creates NO canonical
 * `webhook_events` row, NO `event_processing_attempts` row, and NO merchant
 * mutation, and all of its merchant/provider FKs are NULL. The envelope
 * therefore reports absence and correlation facts honestly rather than
 * fabricating a webhook, a processing attempt or a merchant before/after
 * snapshot to fit the other scenarios' model.
 */
export interface C03Evidence {
  readonly scenarioId: "C03";
  /** `null` when the persisted `fault_state` is not exactly the frozen two-check shape. */
  readonly verificationChecks: readonly C03VerificationCheckEvidence[] | null;
  readonly sourceWebhookLinked: boolean;
  readonly orderLinked: boolean;
  readonly paymentAttemptLinked: boolean;
  readonly paymentLinked: boolean;
  readonly chaosLinkedProcessingAttemptCount: number;
  /**
   * The before/after Demo Merchant state captured during this run's own
   * execution, or `null` for a run recorded before this evidence existed (see
   * `MISSING_C03_MUTATION_EVIDENCE`) or whose persisted value failed
   * validation (`INVALID_C03_MUTATION_EVIDENCE`).
   *
   * These are the inputs docs/MONEY_INVARIANTS.md INV-005 §6 requires. They
   * are FACTS ONLY: this module never compares `before` against `after`, and
   * assigns no verdict. That comparison is INV-005's decision and belongs to
   * Phase 3F.
   */
  readonly mutationEvidence: C03MutationEvidence | null;
}

export interface C07Evidence {
  readonly scenarioId: "C07";
  /** `null` when the persisted `fault_state` is not exactly `{armed: true, consumed: <boolean>}`. */
  readonly faultArmed: boolean | null;
  /** `null` for the same reason as `faultArmed`. */
  readonly faultConsumed: boolean | null;
  readonly expectedReplayAttemptCount: number;
  readonly observedReplayAttemptCount: number;
  readonly chaosLinkedProcessingAttemptCount: number;
  /** Every original provider attempt for the source, INCLUDING failed/retry history. */
  readonly originalProcessingAttemptCount: number;
  /** See `C01Evidence.authoritativeOriginalProcessingAttemptId`. */
  readonly authoritativeOriginalProcessingAttemptId: string | null;
}

/**
 * The factual classification of an observed C11 evidence shape — NOT a money
 * verdict, and not a claim about which mechanism the operator intended.
 *
 * `A_OBSERVATION`: a completed run with a resolved source webhook and ZERO
 * chaos-run-linked processing attempts (Mechanism A is pure observation).
 * `B_REPLAY`: a completed run with a resolved source webhook and exactly ONE
 * chaos-run-linked `PAYCHAOS_REPLAY` attempt.
 * `AMBIGUOUS_OR_INCOMPLETE`: anything else, including a `BLOCKED` run (e.g.
 * the `TEST_FIXTURE` mechanism, which remains `PRECHECK-07` BLOCKED at
 * runtime and therefore has no provider evidence to assemble at all).
 */
export type C11EvidenceShape =
  "A_OBSERVATION" | "B_REPLAY" | "AMBIGUOUS_OR_INCOMPLETE";

export interface C11Evidence {
  readonly scenarioId: "C11";
  readonly observedShape: C11EvidenceShape;
  /** `null` while the shape is `AMBIGUOUS_OR_INCOMPLETE` — no frozen expectation applies. */
  readonly expectedReplayAttemptCount: number | null;
  readonly observedReplayAttemptCount: number;
  readonly chaosLinkedProcessingAttemptCount: number;
  /** Every original provider attempt for the source, INCLUDING failed/retry history. */
  readonly originalProcessingAttemptCount: number;
  /** See `C01Evidence.authoritativeOriginalProcessingAttemptId`. */
  readonly authoritativeOriginalProcessingAttemptId: string | null;
  readonly sourceEventTypeIsPaymentFailed: boolean;
}

export type ScenarioEvidence =
  C01Evidence | C03Evidence | C07Evidence | C11Evidence;

// ============================================================================
// THE BUNDLE
// ============================================================================

/**
 * One versioned, deterministic, in-memory evidence bundle for exactly one
 * chaos run. Contains no verdict field of any kind, by design.
 */
export interface ChaosRunEvidenceBundleV1 {
  readonly version: typeof CHAOS_RUN_EVIDENCE_BUNDLE_VERSION;
  readonly run: SafeChaosRunEvidence;
  /** The scenario's frozen required invariant IDs, from `lib/chaos/registry.ts`. Naming them is not evaluating them. */
  readonly requiredInvariantIds: readonly InvariantId[];
  readonly sourceWebhook: SafeWebhookEvidence | null;
  readonly originalProcessingAttempts: readonly ProcessingAttemptEvidence[];
  readonly chaosProcessingAttempts: readonly ProcessingAttemptEvidence[];
  /** Canonical `webhook_events` row count for the source Razorpay event id; `null` when no source webhook was resolved. */
  readonly canonicalSourceEventCount: number | null;

  /**
   * The authoritative captured-payment basis for this run, as a FACT about a
   * search — never a verdict.
   *
   * Deliberately a bundle-level field rather than a per-scenario one: exactly
   * ONE shared mechanism serves INV-003's capture-event search, INV-004 §8
   * condition 3 and INV-010 §8's "authoritative successful payment evidence".
   * Two overlapping mechanisms would be two things to keep correct.
   *
   * This NEVER replaces or relabels `sourceWebhook`. A C11 run sourced from
   * `payment.failed` still reports `sourceWebhook.eventType ===
   * "payment.failed"`; the capture evidence is separate, independent evidence
   * carrying its own provenance. When the source event IS itself the verified
   * capture, the same trusted row legitimately appears in both roles with the
   * same `id` — one row, two roles, nothing manufactured.
   */
  readonly authoritativeCapture: AuthoritativeCaptureResolution;
  /**
   * The single resolved capture webhook when one was resolved at all —
   * populated for BOTH `EXACTLY_ONE` and `INCOMPLETE_INTERNAL_CORRELATION`,
   * because provider-authenticated capture evidence stays visible even when
   * its internal correlation is incomplete. `null` for every other resolution.
   */
  readonly authoritativeCaptureWebhook: SafeWebhookEvidence | null;

  readonly scenarioEvidence: ScenarioEvidence;
  readonly evidenceRefs: readonly EvidenceRef[];
  readonly gaps: readonly EvidenceGap[];
}

// ============================================================================
// RAW SOURCE ROWS (the repository's explicit allowlist SELECT results)
// ============================================================================

/**
 * Deliberately typed as narrow structural shapes rather than
 * `Database[...]["Row"]`, exactly as `lib/evidence/merchant-state-snapshot.ts`
 * does: this pure module stays independent of the generated Supabase types,
 * and a caller cannot smuggle an unrelated object through by widening.
 * `fault_state`/`state_before`/`state_after` are `unknown` on purpose — they
 * are JSONB and MUST be runtime-validated here, never cast.
 */
export interface RawChaosRunEvidenceRow {
  readonly id: string;
  readonly scenario_id: ChaosScenarioId;
  readonly status: ChaosRunStatus;
  readonly outcome: ChaosRunOutcome | null;
  readonly fault_type: ChaosRunFaultType | null;
  readonly data_classification: ChaosRunDataClassification;
  readonly order_id: string | null;
  readonly payment_attempt_id: string | null;
  readonly payment_id: string | null;
  readonly source_webhook_event_id: string | null;
  readonly failed_precheck_id: ChaosRunFailedPrecheckId | null;
  readonly execution_block_code: ChaosRunExecutionBlockCode | null;
  readonly fault_state: unknown;
  readonly started_at: string | null;
  readonly completed_at: string | null;
}

export interface RawWebhookEvidenceRow {
  readonly id: string;
  readonly razorpay_event_id: string;
  readonly event_type: string;
  readonly source_kind: string;
  readonly signature_verified: boolean;
  readonly processing_status: string;
  readonly duplicate_delivery_count: number;
  readonly received_at: string;
  readonly payment_attempt_id: string | null;
  readonly payment_id: string | null;
  readonly razorpay_payment_id: string | null;
  readonly amount_subunits: number | null;
  readonly currency: string | null;
}

export interface RawProcessingAttemptEvidenceRow {
  readonly id: string;
  readonly webhook_event_id: string | null;
  readonly chaos_run_id: string | null;
  readonly source_kind: string;
  readonly status: string;
  readonly is_duplicate_delivery: boolean;
  readonly payment_attempt_id: string | null;
  readonly payment_id: string | null;
  readonly error_code: string | null;
  readonly started_at: string;
  readonly finished_at: string | null;
  readonly state_before: unknown;
  readonly state_after: unknown;
}

export interface ChaosRunEvidenceSource {
  readonly run: RawChaosRunEvidenceRow;
  readonly sourceWebhook: RawWebhookEvidenceRow | null;
  /** `REAL_RAZORPAY_WEBHOOK` attempts for the source webhook that carry NO `chaos_run_id`. */
  readonly originalProcessingAttempts: readonly RawProcessingAttemptEvidenceRow[];
  /** Every attempt whose `chaos_run_id` is exactly this run's id, whatever its `source_kind`. */
  readonly chaosProcessingAttempts: readonly RawProcessingAttemptEvidenceRow[];
  readonly canonicalSourceEventCount: number | null;

  // --- authoritative capture search inputs --------------------------------

  /**
   * The trusted Razorpay Payment identifier the capture search was run
   * against, taken from the canonical source webhook's own normalized column.
   * `null` when none could be established from a trusted persisted row.
   */
  readonly captureSubjectRazorpayPaymentId: string | null;
  /**
   * Internal `payments.id` values asserted by trusted persisted rows (the
   * chaos run's own FK and the canonical source webhook's own FK). May contain
   * duplicates; deduplication and conflict detection happen in the pure
   * resolver.
   */
  readonly captureSubjectInternalPaymentIds: readonly string[];
  /**
   * Whether the PROVIDER-identity dimension was actually searched.
   *
   * This is the completeness fact that stops a false negative. An
   * internal-`payment_id`-only search cannot see a genuine verified capture
   * whose internal correlation is absent, so without a provider search the
   * resolver must never report a complete "no capture exists" result.
   */
  readonly captureProviderSearchPerformed: boolean;
  /** Union of both exact-identity searches; may contain duplicate rows. */
  readonly captureCandidates: readonly RawWebhookEvidenceRow[];
}

// ============================================================================
// RUNTIME SNAPSHOT VALIDATION
// ============================================================================

const REAL_RAZORPAY_WEBHOOK = "REAL_RAZORPAY_WEBHOOK";
const PAYCHAOS_REPLAY = "PAYCHAOS_REPLAY";

/**
 * The exact frozen literals these comparisons read, taken from the applied
 * schema rather than invented here:
 *
 *   `webhook_events_processing_status_valid`
 *     ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED')
 *     — supabase/migrations/20260826000000_phase2d_webhook_events.sql
 *
 *   `event_processing_attempts_status_valid`
 *     ('PENDING', 'HELD', 'PROCESSING', 'SUCCEEDED', 'FAILED',
 *      'SKIPPED_DUPLICATE')
 *     — supabase/migrations/20260827000000_phase2e_webhook_dedup.sql
 */
const WEBHOOK_PROCESSING_STATUS_PROCESSED = "PROCESSED";
const PROCESSING_ATTEMPT_STATUS_SUCCEEDED = "SUCCEEDED";

/** C03's frozen runtime evidence classification (`lib/chaos/run-service.ts`, `lib/chaos/c03-execution-service.ts`). */
const C03_REQUIRED_DATA_CLASSIFICATION = "SYNTHETIC_DEMO";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

/** Money is always an integer count of smallest currency subunits — never a float (docs/MONEY_INVARIANTS.md Principle 7). */
function isSubunitAmount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function parseSnapshotOrder(
  value: unknown,
): MerchantStateSnapshotOrderV1 | null | undefined {
  if (value === null) return null;
  if (!isPlainObject(value)) return undefined;
  if (
    typeof value.id !== "string" ||
    typeof value.paymentStatus !== "string" ||
    typeof value.businessStatus !== "string" ||
    !isSubunitAmount(value.amountSubunits) ||
    typeof value.currency !== "string"
  ) {
    return undefined;
  }
  return {
    id: value.id,
    paymentStatus: value.paymentStatus,
    businessStatus: value.businessStatus,
    amountSubunits: value.amountSubunits,
    currency: value.currency,
  };
}

function parseSnapshotPaymentAttempt(
  value: unknown,
): MerchantStateSnapshotPaymentAttemptV1 | null | undefined {
  if (value === null) return null;
  if (!isPlainObject(value)) return undefined;
  if (
    typeof value.id !== "string" ||
    typeof value.orderId !== "string" ||
    typeof value.status !== "string" ||
    !isSubunitAmount(value.amountSubunits) ||
    typeof value.currency !== "string" ||
    !isNullableString(value.razorpayOrderId) ||
    !isNullableString(value.razorpayOrderStatus)
  ) {
    return undefined;
  }
  return {
    id: value.id,
    orderId: value.orderId,
    status: value.status,
    amountSubunits: value.amountSubunits,
    currency: value.currency,
    razorpayOrderId: value.razorpayOrderId,
    razorpayOrderStatus: value.razorpayOrderStatus,
  };
}

function parseSnapshotPayment(
  value: unknown,
): MerchantStateSnapshotPaymentV1 | null | undefined {
  if (value === null) return null;
  if (!isPlainObject(value)) return undefined;
  if (
    typeof value.id !== "string" ||
    typeof value.paymentAttemptId !== "string" ||
    typeof value.razorpayPaymentId !== "string" ||
    !isNullableString(value.razorpayPaymentStatus) ||
    !isSubunitAmount(value.amountSubunits) ||
    typeof value.currency !== "string" ||
    typeof value.checkoutSignatureVerified !== "boolean" ||
    !isNullableString(value.capturedAt) ||
    !isNullableString(value.failedAt)
  ) {
    return undefined;
  }
  return {
    id: value.id,
    paymentAttemptId: value.paymentAttemptId,
    razorpayPaymentId: value.razorpayPaymentId,
    razorpayPaymentStatus: value.razorpayPaymentStatus,
    amountSubunits: value.amountSubunits,
    currency: value.currency,
    checkoutSignatureVerified: value.checkoutSignatureVerified,
    capturedAt: value.capturedAt,
    failedAt: value.failedAt,
  };
}

function parseSnapshotFulfilments(
  value: unknown,
): readonly MerchantStateSnapshotFulfilmentV1[] | null | undefined {
  if (value === null) return null;
  if (!Array.isArray(value)) return undefined;
  const parsed: MerchantStateSnapshotFulfilmentV1[] = [];
  for (const entry of value) {
    if (!isPlainObject(entry)) return undefined;
    if (
      typeof entry.id !== "string" ||
      typeof entry.orderId !== "string" ||
      typeof entry.paymentId !== "string" ||
      !isNullableString(entry.triggerProcessingAttemptId) ||
      typeof entry.effectType !== "string" ||
      typeof entry.appliedAt !== "string"
    ) {
      return undefined;
    }
    // HISTORICAL COMPATIBILITY. `idempotencyKey` was added to this projection
    // after these snapshots were written, so a persisted row from before that
    // change legitimately has no such property. Its absence must NOT make the
    // snapshot INVALID — that would retroactively destroy historical evidence
    // that was correct when it was captured. Absent (or an explicit null)
    // becomes `null`, meaning NOT CAPTURED IN THIS SNAPSHOT. It is never
    // reconstructed from `orderId`: the database column is `NOT NULL`, so a
    // derived value would be a claim about something never observed. A present
    // value of the wrong type is still INVALID.
    if (
      "idempotencyKey" in entry &&
      entry.idempotencyKey !== null &&
      typeof entry.idempotencyKey !== "string"
    ) {
      return undefined;
    }
    const idempotencyKey =
      typeof entry.idempotencyKey === "string" ? entry.idempotencyKey : null;

    parsed.push({
      id: entry.id,
      orderId: entry.orderId,
      paymentId: entry.paymentId,
      triggerProcessingAttemptId: entry.triggerProcessingAttemptId,
      effectType: entry.effectType,
      appliedAt: entry.appliedAt,
      idempotencyKey,
    });
  }
  // Re-applied here rather than trusted from the persisted array: the same
  // set of fulfilments must always come back in the same sequence, even if a
  // historical row was written before the ordering rule existed.
  return parsed.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Deterministic runtime validation of one persisted `state_before` /
 * `state_after` JSONB value against the frozen `MerchantStateSnapshotV1`
 * contract. NEVER a blind cast.
 *
 * - `null`/`undefined` stays `NOT_CAPTURED` — authoritative historical truth,
 *   never reconstructed from current merchant state;
 * - a non-object, a wrong `version`, a missing required key, or any nested
 *   field of the wrong primitive type is `INVALID` — never silently accepted;
 * - every returned field is copied by explicit name, so an unknown field
 *   present in the persisted JSON can never leak into the bundle;
 * - a nullable entity stays nullable, and `fulfilments: null` (meaning "the
 *   owning order was not resolved") stays distinct from `[]` (meaning "the
 *   order WAS resolved and genuinely had none").
 *
 * Never throws.
 */
export function parseMerchantStateSnapshotV1(
  value: unknown,
): ParsedProcessingSnapshot {
  if (value === null || value === undefined) {
    return { kind: "NOT_CAPTURED" };
  }
  if (!isPlainObject(value)) {
    return { kind: "INVALID" };
  }
  if (value.version !== MERCHANT_STATE_SNAPSHOT_VERSION) {
    return { kind: "INVALID" };
  }
  for (const key of ["order", "paymentAttempt", "payment", "fulfilments"]) {
    if (!(key in value)) {
      return { kind: "INVALID" };
    }
  }

  const order = parseSnapshotOrder(value.order);
  if (order === undefined) return { kind: "INVALID" };

  const paymentAttempt = parseSnapshotPaymentAttempt(value.paymentAttempt);
  if (paymentAttempt === undefined) return { kind: "INVALID" };

  const payment = parseSnapshotPayment(value.payment);
  if (payment === undefined) return { kind: "INVALID" };

  const fulfilments = parseSnapshotFulfilments(value.fulfilments);
  if (fulfilments === undefined) return { kind: "INVALID" };

  // ------------------------------------------------------------------------
  // CROSS-FIELD COMPLETENESS (architect correction, Blocker 1)
  // ------------------------------------------------------------------------
  // Validating `order` and `fulfilments` independently would accept logically
  // inconsistent shapes — most importantly `order = non-null` with
  // `fulfilments = null`, which blurs the frozen Phase 3E-A distinction that
  // the whole fulfilment-count invariant family depends on:
  //
  //   fulfilments === null -> the owning order was NOT resolved, so NO claim
  //                           about fulfilments is made (NOT CAPTURED);
  //   fulfilments === []   -> the order WAS resolved and genuinely had zero
  //                           fulfilment rows (a positive observation).
  //
  // A snapshot that resolved an order must therefore carry an array, and a
  // snapshot that resolved no order must carry `null`. Anything else is
  // INVALID. Nothing is fabricated or transformed to make a shape pass — a
  // `null` is never replaced with `[]`, and an `[]` is never replaced with
  // `null`. This parser only validates persisted historical facts.
  if (order !== null && !Array.isArray(fulfilments)) {
    return { kind: "INVALID" };
  }
  if (order === null && fulfilments !== null) {
    return { kind: "INVALID" };
  }

  return {
    kind: "CAPTURED",
    snapshot: {
      version: MERCHANT_STATE_SNAPSHOT_VERSION,
      order,
      paymentAttempt,
      payment,
      fulfilments,
    },
  };
}

// ============================================================================
// SCENARIO FAULT_STATE VALIDATION
// ============================================================================

const C03_FROZEN_CASE_ORDER: readonly C03VerificationCase[] = [
  "WRONG_SIGNATURE",
  "MISSING_SIGNATURE",
];

function isC03Classification(
  value: unknown,
): value is C03VerificationClassification {
  return value === "REJECTED" || value === "UNEXPECTED_ACCEPTANCE";
}

/**
 * The C03 mutation snapshot envelope version this reader accepts.
 *
 * Restated here rather than imported from
 * `lib/chaos/c03-mutation-snapshot.ts`, for exactly the reason
 * `parseC07FaultStateEvidence` and `C01_EXPECTED_REPLAY_ATTEMPT_COUNT` are
 * already restated in this module: a strictly read-only assembler must not
 * depend on the chaos EXECUTION surface, even transitively, and a persisted
 * JSONB value must be runtime-validated rather than trusted regardless. The
 * two constants are kept in lockstep by
 * `tests/unit/evidence/phase3e-b-static-guard.test.ts`, which reads both files
 * as text and fails if they diverge.
 */
const C03_MUTATION_SNAPSHOT_EVIDENCE_VERSION = 1;

/**
 * The ONLY two `fault_state` key sets a C03 run may carry.
 *
 * `{checks}` is the LEGACY shape written before the mutation-evidence
 * correction existed; the already-approved historical C03 run has exactly this
 * shape and must keep parsing truthfully. `{checks, mutationEvidence}` is the
 * corrected shape. Anything else — a PENDING run's `{}`, an extra key, a
 * renamed key — is rejected. This is deliberately NOT relaxed into a generic
 * pass-through: an arbitrary JSON blob on `fault_state` is exactly what the
 * safe-projection rule exists to prevent.
 */
function isExactC03FaultStateKeySet(
  value: Record<string, unknown>,
): value is Record<string, unknown> {
  const keys = Object.keys(value).sort();
  if (keys.length === 1) return keys[0] === "checks";
  if (keys.length === 2) {
    return keys[0] === "checks" && keys[1] === "mutationEvidence";
  }
  return false;
}

/** Validates one bounded collection envelope: exactly `{count, complete, rows}` with a whole-number count. */
function parseC03Collection<TRow>(
  value: unknown,
  parseRows: (rows: readonly unknown[]) => readonly TRow[] | undefined,
): C03MutationCollectionEvidence<TRow> | null | undefined {
  if (value === null) return null;
  if (!isPlainObject(value)) return undefined;
  const keys = Object.keys(value).sort();
  if (
    keys.length !== 3 ||
    keys[0] !== "complete" ||
    keys[1] !== "count" ||
    keys[2] !== "rows"
  ) {
    return undefined;
  }
  if (!Number.isInteger(value.count) || (value.count as number) < 0) {
    return undefined;
  }
  if (typeof value.complete !== "boolean") return undefined;
  if (!Array.isArray(value.rows)) return undefined;

  const rows = parseRows(value.rows);
  if (rows === undefined) return undefined;

  return {
    count: value.count as number,
    rows,
    complete: value.complete,
  };
}

/**
 * Maps an array through one of the frozen row parsers this module already uses
 * for `state_before`/`state_after`.
 *
 * A row that is JSON `null` or fails validation invalidates the whole
 * collection — a collection row is never legitimately null, and a partially
 * parsed collection would be a silently weakened claim about merchant state.
 */
function parseC03Rows<TRow extends { readonly id: string }>(
  rows: readonly unknown[],
  parseRow: (value: unknown) => TRow | null | undefined,
): readonly TRow[] | undefined {
  const parsed: TRow[] = [];
  for (const entry of rows) {
    const row = parseRow(entry);
    if (row === null || row === undefined) return undefined;
    parsed.push(row);
  }
  // Re-applied here rather than trusted from the persisted array, exactly as
  // `parseSnapshotFulfilments` does: the same set must always come back in the
  // same sequence.
  return parsed.sort(compareByIdField);
}

function compareByIdField(
  a: { readonly id: string },
  b: { readonly id: string },
): number {
  return compareStrings(a.id, b.id);
}

/** Validates the trusted canonical webhook row set: exactly `{count, complete, ids}`. */
function parseC03TrustedWebhookEvents(
  value: unknown,
): C03TrustedWebhookEventSetEvidence | null | undefined {
  if (value === null) return null;
  if (!isPlainObject(value)) return undefined;
  const keys = Object.keys(value).sort();
  if (
    keys.length !== 3 ||
    keys[0] !== "complete" ||
    keys[1] !== "count" ||
    keys[2] !== "ids"
  ) {
    return undefined;
  }
  if (!Number.isInteger(value.count) || (value.count as number) < 0) {
    return undefined;
  }
  if (typeof value.complete !== "boolean") return undefined;
  if (!Array.isArray(value.ids)) return undefined;
  const ids: string[] = [];
  for (const id of value.ids) {
    if (typeof id !== "string") return undefined;
    ids.push(id);
  }
  return {
    count: value.count as number,
    ids: ids.sort(compareStrings),
    complete: value.complete,
  };
}

/** Validates one persisted C03 mutation snapshot side. `undefined` means present-but-invalid. */
function parseC03MutationSnapshot(
  value: unknown,
): C03MutationSnapshotEvidence | null | undefined {
  if (value === null) return null;
  if (!isPlainObject(value)) return undefined;
  if (value.version !== C03_MUTATION_SNAPSHOT_EVIDENCE_VERSION) {
    return undefined;
  }
  const keys = Object.keys(value).sort();
  const expected = [
    "fulfilments",
    "orders",
    "paymentAttempts",
    "payments",
    "trustedWebhookEvents",
    "version",
  ];
  if (keys.length !== expected.length) return undefined;
  for (let i = 0; i < expected.length; i++) {
    if (keys[i] !== expected[i]) return undefined;
  }

  const orders = parseC03Collection(value.orders, (rows) =>
    parseC03Rows(rows, parseSnapshotOrder),
  );
  if (orders === undefined) return undefined;

  const paymentAttempts = parseC03Collection(value.paymentAttempts, (rows) =>
    parseC03Rows(rows, parseSnapshotPaymentAttempt),
  );
  if (paymentAttempts === undefined) return undefined;

  const payments = parseC03Collection(value.payments, (rows) =>
    parseC03Rows(rows, parseSnapshotPayment),
  );
  if (payments === undefined) return undefined;

  // `parseSnapshotFulfilments` is reused verbatim — the same validator this
  // module already applies to `state_before`/`state_after` fulfilment arrays,
  // so the two evidence surfaces cannot drift. Its `null` return means "the
  // JSON value was null", which `parseC03Collection` has already excluded by
  // the time this callback runs, so it is normalized to `undefined`
  // (present-but-invalid) rather than silently accepted.
  const fulfilments = parseC03Collection<MerchantStateSnapshotFulfilmentV1>(
    value.fulfilments,
    (rows) => parseSnapshotFulfilments(rows) ?? undefined,
  );
  if (fulfilments === undefined) return undefined;

  const trustedWebhookEvents = parseC03TrustedWebhookEvents(
    value.trustedWebhookEvents,
  );
  if (trustedWebhookEvents === undefined) return undefined;

  return {
    orders,
    paymentAttempts,
    payments,
    fulfilments,
    trustedWebhookEvents,
  };
}

/**
 * The result of validating a C03 run's persisted `mutationEvidence`.
 *
 * `ABSENT` is the authoritative legacy "never captured" — the already-approved
 * historical C03 run, which is NEVER backfilled. `INVALID` means a value IS
 * present but does not match the frozen contract; it is never silently
 * accepted and never repaired.
 */
export type ParsedC03MutationEvidence =
  | { readonly kind: "ABSENT" }
  | { readonly kind: "INVALID" }
  | { readonly kind: "PRESENT"; readonly evidence: C03MutationEvidence };

/**
 * Validates a C03 run's persisted `fault_state.mutationEvidence` against the
 * exact frozen shape `lib/chaos/c03-mutation-snapshot.ts` writes. NEVER a
 * blind cast, and never throws.
 *
 * Accepts ONLY `{version, before, after}` with a matching version. Either side
 * may be `null` (a truthful capture failure). Every returned field is copied
 * by explicit name, so an unknown field present in the persisted JSON can
 * never leak into the bundle.
 */
export function parseC03MutationEvidence(
  faultState: unknown,
): ParsedC03MutationEvidence {
  if (!isPlainObject(faultState)) return { kind: "ABSENT" };
  if (!("mutationEvidence" in faultState)) return { kind: "ABSENT" };

  const value = faultState.mutationEvidence;
  if (!isPlainObject(value)) return { kind: "INVALID" };
  if (value.version !== C03_MUTATION_SNAPSHOT_EVIDENCE_VERSION) {
    return { kind: "INVALID" };
  }
  const keys = Object.keys(value).sort();
  if (
    keys.length !== 3 ||
    keys[0] !== "after" ||
    keys[1] !== "before" ||
    keys[2] !== "version"
  ) {
    return { kind: "INVALID" };
  }

  const before = parseC03MutationSnapshot(value.before);
  if (before === undefined) return { kind: "INVALID" };
  const after = parseC03MutationSnapshot(value.after);
  if (after === undefined) return { kind: "INVALID" };

  return { kind: "PRESENT", evidence: { before, after } };
}

/**
 * Is this validated mutation evidence complete enough for a later delta
 * comparison to be meaningful?
 *
 * Requires BOTH sides present, every collection present, and every collection
 * `complete`. This is a COMPLETENESS fact, not a verdict: it says whether the
 * evidence can support a comparison, never what the comparison would show.
 * Phase 3F turns incompleteness into UNKNOWN.
 */
export function isC03MutationEvidenceComplete(
  evidence: C03MutationEvidence,
): boolean {
  return (
    isC03MutationSnapshotComplete(evidence.before) &&
    isC03MutationSnapshotComplete(evidence.after)
  );
}

function isC03MutationSnapshotComplete(
  snapshot: C03MutationSnapshotEvidence | null,
): boolean {
  if (snapshot === null) return false;
  return (
    snapshot.orders !== null &&
    snapshot.orders.complete &&
    snapshot.paymentAttempts !== null &&
    snapshot.paymentAttempts.complete &&
    snapshot.payments !== null &&
    snapshot.payments.complete &&
    snapshot.fulfilments !== null &&
    snapshot.fulfilments.complete &&
    snapshot.trustedWebhookEvents !== null &&
    snapshot.trustedWebhookEvents.complete
  );
}

/**
 * Validates C03's persisted `fault_state` against the EXACT frozen shape
 * `lib/chaos/c03-execution-service.ts` writes: `{ checks: [WRONG_SIGNATURE,
 * MISSING_SIGNATURE] }`, in that order, each entry carrying only `case` and
 * `classification`.
 *
 * The frozen order is preserved, never sorted — it is part of the recorded
 * fact. Anything else (a PENDING run's `{}`, an extra key, a wrong case
 * order, a non-literal classification) returns `null`, which the builder
 * turns into a `MISSING_C03_VERIFICATION_CHECKS` gap. Never throws.
 */
export function parseC03VerificationChecks(
  value: unknown,
): readonly C03VerificationCheckEvidence[] | null {
  if (!isPlainObject(value)) return null;
  if (!isExactC03FaultStateKeySet(value)) return null;
  const checks = value.checks;
  if (!Array.isArray(checks)) return null;
  if (checks.length !== C03_FROZEN_CASE_ORDER.length) return null;

  const parsed: C03VerificationCheckEvidence[] = [];
  for (let i = 0; i < C03_FROZEN_CASE_ORDER.length; i++) {
    const entry: unknown = checks[i];
    if (!isPlainObject(entry)) return null;
    const entryKeys = Object.keys(entry);
    if (
      entryKeys.length !== 2 ||
      !entryKeys.includes("case") ||
      !entryKeys.includes("classification")
    ) {
      return null;
    }
    if (entry.case !== C03_FROZEN_CASE_ORDER[i]) return null;
    if (!isC03Classification(entry.classification)) return null;
    parsed.push({
      case: C03_FROZEN_CASE_ORDER[i]!,
      classification: entry.classification,
    });
  }
  return parsed;
}

/**
 * Validates C07's persisted `fault_state` against the EXACT frozen shape
 * `{armed: true, consumed: <boolean>}` — the same exactness rule
 * `lib/chaos/c07-repository.ts`'s `parseExactC07FaultState` enforces on the
 * execution side. Reimplemented here rather than imported so this read-only
 * assembler never depends on a chaos execution module; the two are kept in
 * lockstep by the Phase 3E-B static guard and by unit tests.
 *
 * Returns `null` for anything else. Never throws.
 */
export function parseC07FaultStateEvidence(
  value: unknown,
): { readonly armed: true; readonly consumed: boolean } | null {
  if (!isPlainObject(value)) return null;
  const keys = Object.keys(value);
  if (
    keys.length !== 2 ||
    !keys.includes("armed") ||
    !keys.includes("consumed")
  ) {
    return null;
  }
  if (value.armed !== true) return null;
  if (typeof value.consumed !== "boolean") return null;
  return { armed: true, consumed: value.consumed };
}

// ============================================================================
// DETERMINISTIC ORDERING / DEDUPLICATION
// ============================================================================

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Evidence references sort by `kind` ascending, then `id` ascending — a strict total order over any set of (kind, UUID) pairs. */
export function compareEvidenceRefs(a: EvidenceRef, b: EvidenceRef): number {
  const byKind = compareStrings(a.kind, b.kind);
  return byKind !== 0 ? byKind : compareStrings(a.id, b.id);
}

/** Deduplicates on the exact `(kind, id)` pair and returns a deterministically sorted array. */
export function dedupeAndSortEvidenceRefs(
  refs: readonly EvidenceRef[],
): readonly EvidenceRef[] {
  const seen = new Map<string, EvidenceRef>();
  for (const ref of refs) {
    seen.set(`${ref.kind} ${ref.id}`, ref);
  }
  return [...seen.values()].sort(compareEvidenceRefs);
}

/** Gaps sort by `code` ascending, then `subjectId` ascending with a run-level `null` subject first. */
export function compareEvidenceGaps(a: EvidenceGap, b: EvidenceGap): number {
  const byCode = compareStrings(a.code, b.code);
  if (byCode !== 0) return byCode;
  if (a.subjectId === b.subjectId) return 0;
  if (a.subjectId === null) return -1;
  if (b.subjectId === null) return 1;
  return compareStrings(a.subjectId, b.subjectId);
}

/** Deduplicates on the exact `(code, subjectId)` pair and returns a deterministically sorted array. */
export function dedupeAndSortEvidenceGaps(
  gaps: readonly EvidenceGap[],
): readonly EvidenceGap[] {
  const seen = new Map<string, EvidenceGap>();
  for (const gap of gaps) {
    seen.set(`${gap.code} ${gap.subjectId ?? ""}`, gap);
  }
  return [...seen.values()].sort(compareEvidenceGaps);
}

/**
 * Processing attempts sort by `started_at` ascending, then `id` ascending.
 * `started_at` alone is NOT a total order (two attempts can share a
 * timestamp — C01 creates its two replays in a tight loop), so the UUID
 * primary key breaks every tie and makes the order strict and total.
 */
function compareProcessingAttempts(
  a: ProcessingAttemptEvidence,
  b: ProcessingAttemptEvidence,
): number {
  const byStartedAt = compareStrings(a.startedAt, b.startedAt);
  return byStartedAt !== 0 ? byStartedAt : compareStrings(a.id, b.id);
}

// ============================================================================
// AUTHORITATIVE ORIGINAL PROCESSING ATTEMPT
// ============================================================================

/**
 * The deterministic outcome of resolving THE authoritative original provider
 * processing attempt for a source webhook.
 */
/**
 * The outcome of the authoritative capture search.
 *
 * Every member is a FACT about the search, never a money verdict.
 *
 * - `NO_SUBJECT` — no trustworthy payment identity could be established from
 *   any trusted persisted row. This is the normal, correct state for C03,
 *   which has no merchant/provider correlation at all by design. It is NEVER
 *   evidence that no capture exists.
 * - `AMBIGUOUS_SUBJECT` — trusted persisted rows disagree about WHICH payment
 *   the search is about. Fails closed; no row is chosen. Never evidence that
 *   no capture exists.
 * - `SEARCH_INCOMPLETE` — a subject exists, but the search could not be
 *   established as covering the canonical evidence for that exact payment
 *   identity (no trusted provider identity was available to search by). A
 *   negative result here would be unsafe, so no negative result is reported.
 *   Phase 3F must treat this as UNKNOWN, never as a failure.
 * - `NONE_OBSERVED` — the COMPLETE negative search fact: an exact trusted
 *   provider identity was established, the query succeeded, and zero verified
 *   `REAL_RAZORPAY_WEBHOOK` `payment.captured` rows exist for it. This is a
 *   positive, required input to INV-003's "capture-event search result", not
 *   an evidence gap.
 * - `EXACTLY_ONE` — exactly one verified provider capture event, AND its
 *   internal `payment_id` matches the run's internal subject. This is the only
 *   member that supplies INV-004 §8 condition 3 plus the relational link
 *   INV-010 §8 requires.
 * - `INCOMPLETE_INTERNAL_CORRELATION` — exactly one verified provider capture
 *   event matched the trusted provider identity, but its internal correlation
 *   is absent or disagrees. The capture evidence is REAL and stays visible on
 *   the bundle; it is simply not sufficient for a relational INV-004/INV-010
 *   PASS. Critically, this is NEVER collapsed into `NONE_OBSERVED` — doing so
 *   would let an evaluator claim "failure-only evidence" for a payment that
 *   demonstrably was captured, which is exactly the false-finding failure mode
 *   this contract exists to prevent (INV-003 §16 "Failure followed later by
 *   capture").
 * - `AMBIGUOUS` — more than one candidate, or a candidate whose provider
 *   identity conflicts with the subject. Fails closed; never "pick the
 *   latest".
 */
export type AuthoritativeCaptureResolution =
  | { readonly kind: "NO_SUBJECT" }
  | { readonly kind: "AMBIGUOUS_SUBJECT" }
  | { readonly kind: "SEARCH_INCOMPLETE" }
  | { readonly kind: "NONE_OBSERVED" }
  | {
      readonly kind: "EXACTLY_ONE";
      readonly webhook: SafeWebhookEvidence;
    }
  | {
      readonly kind: "INCOMPLETE_INTERNAL_CORRELATION";
      readonly webhook: SafeWebhookEvidence;
    }
  | {
      readonly kind: "AMBIGUOUS";
      readonly candidates: readonly SafeWebhookEvidence[];
    };

/**
 * Resolves the authoritative captured-payment basis for one chaos run.
 *
 * PURE: no I/O, no clock, no randomness. Uses ONLY exact identity equality —
 * never a substring, prefix, `like`/`ilike`, fuzzy match, timestamp preference
 * or array position. There is deliberately no sorting-then-taking-first
 * anywhere in the decision path: "latest wins" is not authority.
 *
 * The single most important rule here: a NEGATIVE result is only ever reported
 * when the search was genuinely capable of finding a positive one. Concluding
 * "no capture exists" from a search that could not have seen it would produce
 * false INV-003/INV-004/INV-010 findings, and a false payment finding is not a
 * safe outcome.
 */
export function resolveAuthoritativeCaptureEvidence(input: {
  readonly subjectRazorpayPaymentId: string | null;
  readonly subjectInternalPaymentIds: readonly string[];
  readonly providerSearchPerformed: boolean;
  readonly candidates: readonly SafeWebhookEvidence[];
}): AuthoritativeCaptureResolution {
  const internalIds = [...new Set(input.subjectInternalPaymentIds)].sort(
    compareStrings,
  );

  if (internalIds.length === 0 && input.subjectRazorpayPaymentId === null) {
    return { kind: "NO_SUBJECT" };
  }
  // Two trusted persisted rows naming DIFFERENT payments is a genuine
  // contradiction about what is being asked, not something to arbitrate.
  if (internalIds.length > 1) {
    return { kind: "AMBIGUOUS_SUBJECT" };
  }
  const internalSubject = internalIds[0] ?? null;

  // Completeness gate. Without an exact trusted PROVIDER identity, a genuine
  // capture whose internal `payment_id` correlation is missing would be
  // invisible to the search — so no negative conclusion may be drawn.
  if (
    input.subjectRazorpayPaymentId === null ||
    !input.providerSearchPerformed
  ) {
    return { kind: "SEARCH_INCOMPLETE" };
  }

  const byId = new Map<string, SafeWebhookEvidence>();
  for (const candidate of input.candidates) {
    byId.set(candidate.id, candidate);
  }
  const candidates = [...byId.values()].sort((a, b) =>
    compareStrings(a.id, b.id),
  );

  // A candidate reached via the internal-FK search whose own provider identity
  // names a DIFFERENT payment is an identity conflict. Fail closed rather than
  // silently keeping or silently dropping it.
  for (const candidate of candidates) {
    if (
      candidate.razorpayPaymentId !== null &&
      candidate.razorpayPaymentId !== input.subjectRazorpayPaymentId
    ) {
      return { kind: "AMBIGUOUS", candidates };
    }
  }

  if (candidates.length === 0) {
    return { kind: "NONE_OBSERVED" };
  }
  if (candidates.length > 1) {
    return { kind: "AMBIGUOUS", candidates };
  }

  const webhook = candidates[0]!;
  if (internalSubject !== null && webhook.paymentId === internalSubject) {
    return { kind: "EXACTLY_ONE", webhook };
  }
  // Real provider capture evidence with a missing/mismatched internal link.
  // Stays visible — never discarded into NONE_OBSERVED.
  return { kind: "INCOMPLETE_INTERNAL_CORRELATION", webhook };
}

export type AuthoritativeOriginalResolution =
  | { readonly kind: "NONE"; readonly candidateCount: 0 }
  | {
      readonly kind: "EXACTLY_ONE";
      readonly candidateCount: 1;
      readonly attempt: ProcessingAttemptEvidence;
    }
  | { readonly kind: "AMBIGUOUS"; readonly candidateCount: number };

/**
 * Resolves the ONE authoritative original provider processing attempt from
 * the FULL original-attempt history (architect correction, Blocker 2).
 *
 * ============================================================================
 * WHY ARRAY LENGTH IS NOT THE TEST
 * ============================================================================
 *
 * A canonical `webhook_events` row may legitimately accumulate SEVERAL
 * `REAL_RAZORPAY_WEBHOOK` processing attempts over time — attempt 1 ends
 * `FAILED`, attempt 2 ends `SUCCEEDED`. That is ordinary retry history and it
 * is NOT ambiguous: exactly one of those attempts is the authoritative
 * original. Equally, a single attempt whose `status` is `FAILED` is NOT an
 * authoritative original merely because it is the only row present.
 *
 * Judging by `originalProcessingAttempts.length` therefore gets BOTH cases
 * wrong. The candidate rule below is applied to each attempt on its own
 * merits, and only the number of CANDIDATES decides the outcome.
 *
 * Candidate rule — all four must hold, read from persisted columns only:
 *
 *   sourceKind === "REAL_RAZORPAY_WEBHOOK"   genuine provider provenance
 *   chaosRunId === null                      not a chaos-linked attempt
 *   status === "SUCCEEDED"                   processing actually completed
 *   isDuplicateDelivery === false            not a duplicate re-delivery
 *
 * Deliberately NOT used, in any form: array position, insertion order, the
 * "latest" or "first" `startedAt`/`finished_at` timestamp, sorting, a
 * name-based heuristic, or any inference of provenance. Two candidates fail
 * closed as `AMBIGUOUS` rather than silently picking one.
 *
 * FAILED and duplicate attempts are NEVER removed from the caller's
 * `originalProcessingAttempts` array — retry history stays fully visible in
 * the bundle. This function only declines to call them authoritative.
 *
 * PURE and order-independent: the same set of attempts in any input order
 * yields the same resolution.
 */
export function resolveAuthoritativeOriginalProcessingAttempt(
  originalProcessingAttempts: readonly ProcessingAttemptEvidence[],
): AuthoritativeOriginalResolution {
  const candidates = originalProcessingAttempts.filter(
    (attempt) =>
      attempt.sourceKind === REAL_RAZORPAY_WEBHOOK &&
      attempt.chaosRunId === null &&
      attempt.status === PROCESSING_ATTEMPT_STATUS_SUCCEEDED &&
      attempt.isDuplicateDelivery === false,
  );

  if (candidates.length === 0) {
    return { kind: "NONE", candidateCount: 0 };
  }
  if (candidates.length === 1) {
    return {
      kind: "EXACTLY_ONE",
      candidateCount: 1,
      attempt: candidates[0]!,
    };
  }
  return { kind: "AMBIGUOUS", candidateCount: candidates.length };
}

// ============================================================================
// PROJECTIONS
// ============================================================================

function projectRun(row: RawChaosRunEvidenceRow): SafeChaosRunEvidence {
  return {
    id: row.id,
    scenarioId: row.scenario_id,
    status: row.status,
    outcome: row.outcome,
    faultType: row.fault_type,
    dataClassification: row.data_classification,
    orderId: row.order_id,
    paymentAttemptId: row.payment_attempt_id,
    paymentId: row.payment_id,
    sourceWebhookEventId: row.source_webhook_event_id,
    failedPrecheckId: row.failed_precheck_id,
    executionBlockCode: row.execution_block_code,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

function projectWebhook(row: RawWebhookEvidenceRow): SafeWebhookEvidence {
  return {
    id: row.id,
    razorpayEventId: row.razorpay_event_id,
    eventType: row.event_type,
    sourceKind: row.source_kind,
    signatureVerified: row.signature_verified,
    processingStatus: row.processing_status,
    duplicateDeliveryCount: row.duplicate_delivery_count,
    receivedAt: row.received_at,
    paymentAttemptId: row.payment_attempt_id,
    paymentId: row.payment_id,
    razorpayPaymentId: row.razorpay_payment_id,
    amountSubunits: row.amount_subunits,
    currency: row.currency,
  };
}

function projectProcessingAttempt(
  row: RawProcessingAttemptEvidenceRow,
): ProcessingAttemptEvidence {
  return {
    id: row.id,
    webhookEventId: row.webhook_event_id,
    chaosRunId: row.chaos_run_id,
    sourceKind: row.source_kind,
    status: row.status,
    isDuplicateDelivery: row.is_duplicate_delivery,
    paymentAttemptId: row.payment_attempt_id,
    paymentId: row.payment_id,
    errorCode: row.error_code,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    stateBefore: parseMerchantStateSnapshotV1(row.state_before),
    stateAfter: parseMerchantStateSnapshotV1(row.state_after),
  };
}

// ============================================================================
// EVIDENCE REF COLLECTION
// ============================================================================

function pushRef(
  into: EvidenceRef[],
  kind: EvidenceRefKind,
  id: string | null,
): void {
  if (id !== null) into.push({ kind, id });
}

/**
 * Adds the safe entity references a VALIDATED snapshot asserts. Only ids that
 * survived `parseMerchantStateSnapshotV1` contribute — an `INVALID` or
 * `NOT_CAPTURED` snapshot contributes nothing, so no reference is ever
 * created from unvalidated JSON or from a guessed correlation.
 */
function collectSnapshotRefs(
  into: EvidenceRef[],
  parsed: ParsedProcessingSnapshot,
): void {
  if (parsed.kind !== "CAPTURED") return;
  const { order, paymentAttempt, payment, fulfilments } = parsed.snapshot;
  pushRef(into, "ORDER", order?.id ?? null);
  pushRef(into, "PAYMENT_ATTEMPT", paymentAttempt?.id ?? null);
  pushRef(into, "PAYMENT", payment?.id ?? null);
  for (const fulfilment of fulfilments ?? []) {
    pushRef(into, "FULFILMENT", fulfilment.id);
  }
}

// ============================================================================
// GAP COLLECTION
// ============================================================================

function pushGap(
  into: EvidenceGap[],
  code: EvidenceGapCode,
  subjectId: string | null = null,
): void {
  into.push({ code, subjectId });
}

/**
 * Emits snapshot gaps for one processing attempt. Uniform across every
 * scenario and both attempt lists: a `NOT_CAPTURED` column is a
 * `MISSING_STATE_*` gap and an unparseable one is an `INVALID_STATE_*` gap.
 * This is exactly the shape every pre-Phase-3E historical attempt produces,
 * and that is EXPECTED — see the module doc comment's Historical Truth Rule.
 */
function collectSnapshotGaps(
  into: EvidenceGap[],
  attempt: ProcessingAttemptEvidence,
): void {
  if (attempt.stateBefore.kind === "NOT_CAPTURED") {
    pushGap(into, "MISSING_STATE_BEFORE", attempt.id);
  } else if (attempt.stateBefore.kind === "INVALID") {
    pushGap(into, "INVALID_STATE_BEFORE", attempt.id);
  }
  if (attempt.stateAfter.kind === "NOT_CAPTURED") {
    pushGap(into, "MISSING_STATE_AFTER", attempt.id);
  } else if (attempt.stateAfter.kind === "INVALID") {
    pushGap(into, "INVALID_STATE_AFTER", attempt.id);
  }
}

/**
 * Emits the source-webhook provenance/authenticity/correlation gaps shared by
 * every scenario that genuinely depends on a canonical source webhook (C01,
 * C07, C11). C03 never calls this: it legitimately has no source webhook, and
 * reporting one as "missing" would misrepresent its frozen architecture.
 */
function collectSourceWebhookGaps(
  into: EvidenceGap[],
  run: SafeChaosRunEvidence,
  sourceWebhook: SafeWebhookEvidence | null,
  canonicalSourceEventCount: number | null,
  expectedEventTypes: ReadonlySet<string>,
): void {
  if (run.sourceWebhookEventId === null) {
    pushGap(into, "MISSING_SOURCE_WEBHOOK_LINK");
    pushGap(into, "MISSING_CANONICAL_SOURCE_EVENT_COUNT");
    return;
  }
  if (sourceWebhook === null) {
    pushGap(into, "SOURCE_WEBHOOK_NOT_FOUND", run.sourceWebhookEventId);
    pushGap(into, "MISSING_CANONICAL_SOURCE_EVENT_COUNT");
    return;
  }
  if (sourceWebhook.sourceKind !== REAL_RAZORPAY_WEBHOOK) {
    pushGap(into, "SOURCE_PROVENANCE_MISMATCH", sourceWebhook.id);
  }
  if (sourceWebhook.signatureVerified !== true) {
    pushGap(into, "SOURCE_SIGNATURE_NOT_VERIFIED", sourceWebhook.id);
  }
  if (
    expectedEventTypes.size > 0 &&
    !expectedEventTypes.has(sourceWebhook.eventType)
  ) {
    pushGap(into, "SOURCE_EVENT_TYPE_UNEXPECTED", sourceWebhook.id);
  }
  // Authoritative provider evidence is complete only once the canonical event
  // itself finished processing. `RECEIVED`/`PROCESSING` means the source is
  // still in flight; `FAILED` means it never completed. Either way the source
  // is factually incomplete — which is an evidence-integrity fact, never a
  // money verdict.
  if (sourceWebhook.processingStatus !== WEBHOOK_PROCESSING_STATUS_PROCESSED) {
    pushGap(into, "SOURCE_PROCESSING_NOT_PROCESSED", sourceWebhook.id);
  }
  if (canonicalSourceEventCount === null) {
    pushGap(into, "MISSING_CANONICAL_SOURCE_EVENT_COUNT");
  } else if (canonicalSourceEventCount !== 1) {
    pushGap(into, "UNEXPECTED_CANONICAL_SOURCE_EVENT_COUNT", sourceWebhook.id);
  }
}

/**
 * Emits the authoritative-original gaps shared by C01, C07 and C11, and
 * returns the id of the resolved authoritative original (or `null`).
 *
 * Array LENGTH is deliberately never the test — see
 * `resolveAuthoritativeOriginalProcessingAttempt` for why.
 */
function collectAuthoritativeOriginalGaps(
  into: EvidenceGap[],
  originalProcessingAttempts: readonly ProcessingAttemptEvidence[],
): string | null {
  const resolution = resolveAuthoritativeOriginalProcessingAttempt(
    originalProcessingAttempts,
  );
  if (resolution.kind === "NONE") {
    pushGap(into, "MISSING_AUTHORITATIVE_ORIGINAL_PROCESSING_ATTEMPT");
    return null;
  }
  if (resolution.kind === "AMBIGUOUS") {
    pushGap(into, "AMBIGUOUS_AUTHORITATIVE_ORIGINAL_PROCESSING_ATTEMPT");
    return null;
  }
  return resolution.attempt.id;
}

/** Emits `PROCESSING_PROVENANCE_MISMATCH` for any chaos-linked attempt that is not a `PAYCHAOS_REPLAY`. A replay is never relabelled a provider delivery, and a provider delivery is never relabelled a replay. */
function collectChaosProvenanceGaps(
  into: EvidenceGap[],
  chaosProcessingAttempts: readonly ProcessingAttemptEvidence[],
): void {
  for (const attempt of chaosProcessingAttempts) {
    if (attempt.sourceKind !== PAYCHAOS_REPLAY) {
      pushGap(into, "PROCESSING_PROVENANCE_MISMATCH", attempt.id);
    }
  }
}

/**
 * Emits the factual gaps describing why an authoritative capture search could
 * not produce a usable result.
 *
 * Called ONLY by the scenarios that genuinely expect a payment correlation
 * (C01/C07/C11), mirroring how `collectMerchantCorrelationGaps` is already
 * scoped. C03 deliberately does not call it: C03 has no payment by design, so
 * a "missing capture subject" gap on every C03 run would be noise rather than
 * a finding-worthy fact.
 *
 * `NONE_OBSERVED` deliberately emits NO gap. A complete search that truthfully
 * found zero capture events is a VALID FACTUAL RESULT — it is precisely the
 * "capture-event search result" INV-003 §12 lists as required evidence.
 * Recording it as a gap would make INV-003 permanently UNKNOWN, which is the
 * exact defect this correction exists to remove.
 */
function collectCaptureEvidenceGaps(
  into: EvidenceGap[],
  resolution: AuthoritativeCaptureResolution,
): void {
  switch (resolution.kind) {
    case "NO_SUBJECT":
      pushGap(into, "MISSING_CAPTURE_SEARCH_SUBJECT");
      return;
    case "AMBIGUOUS_SUBJECT":
      pushGap(into, "AMBIGUOUS_CAPTURE_SEARCH_SUBJECT");
      return;
    case "SEARCH_INCOMPLETE":
      pushGap(into, "INCOMPLETE_CAPTURE_SEARCH");
      return;
    case "AMBIGUOUS":
      pushGap(into, "AMBIGUOUS_AUTHORITATIVE_CAPTURE_WEBHOOK");
      return;
    case "INCOMPLETE_INTERNAL_CORRELATION":
      pushGap(
        into,
        "INCOMPLETE_CAPTURE_INTERNAL_CORRELATION",
        resolution.webhook.id,
      );
      return;
    case "NONE_OBSERVED":
    case "EXACTLY_ONE":
      // Both are complete, usable factual results. No gap.
      return;
  }
}

/** Emits the merchant/provider correlation gaps for a scenario that genuinely requires all three FKs. */
function collectMerchantCorrelationGaps(
  into: EvidenceGap[],
  run: SafeChaosRunEvidence,
): void {
  if (run.orderId === null) pushGap(into, "MISSING_ORDER_REFERENCE");
  if (run.paymentAttemptId === null) {
    pushGap(into, "MISSING_PAYMENT_ATTEMPT_REFERENCE");
  }
  if (run.paymentId === null) pushGap(into, "MISSING_PAYMENT_REFERENCE");
}

// ============================================================================
// THE BUILDER
// ============================================================================

/**
 * Builds one deterministic `ChaosRunEvidenceBundleV1` from already-read
 * source rows.
 *
 * PURE: no I/O, no clock, no randomness, no `randomUUID`, no mutation of the
 * input. The bundle carries no `assembledAt` and no generated id precisely
 * so that the same persisted records always produce a deep-equal result —
 * only timestamps that are already persisted on the rows themselves are
 * returned.
 *
 * Assigns no PASS/FAIL/UNKNOWN/NOT_APPLICABLE/ERROR of any kind.
 */
export function buildChaosRunEvidenceBundle(
  source: ChaosRunEvidenceSource,
): ChaosRunEvidenceBundleV1 {
  const run = projectRun(source.run);
  const sourceWebhook = source.sourceWebhook
    ? projectWebhook(source.sourceWebhook)
    : null;

  const originalProcessingAttempts = source.originalProcessingAttempts
    .map(projectProcessingAttempt)
    .sort(compareProcessingAttempts);
  const chaosProcessingAttempts = source.chaosProcessingAttempts
    .map(projectProcessingAttempt)
    .sort(compareProcessingAttempts);

  const allAttempts = [
    ...originalProcessingAttempts,
    ...chaosProcessingAttempts,
  ];
  const observedReplayAttemptCount = chaosProcessingAttempts.filter(
    (attempt) => attempt.sourceKind === PAYCHAOS_REPLAY,
  ).length;

  const definition = getScenarioDefinition(run.scenarioId);
  const requiredInvariantIds: readonly InvariantId[] =
    definition?.requiredInvariants ?? [];
  const expectedEventTypes: ReadonlySet<string> = new Set(
    definition?.requiredSourceEventTypes ?? [],
  );

  const gaps: EvidenceGap[] = [];
  const refs: EvidenceRef[] = [];

  // --- run-level facts, common to every scenario -------------------------
  if (run.status !== "COMPLETED") {
    pushGap(gaps, "RUN_NOT_COMPLETED");
  }
  if (run.outcome === "BLOCKED") {
    pushGap(gaps, "RUN_BLOCKED_BEFORE_EXECUTION");
  }

  // The run's own persisted FK columns are trusted internal UUIDs asserted by
  // a trusted row — never guessed, never derived from unvalidated JSON.
  pushRef(refs, "CHAOS_RUN", run.id);
  pushRef(refs, "ORDER", run.orderId);
  pushRef(refs, "PAYMENT_ATTEMPT", run.paymentAttemptId);
  pushRef(refs, "PAYMENT", run.paymentId);
  if (sourceWebhook !== null) {
    pushRef(refs, "WEBHOOK_EVENT", sourceWebhook.id);
    pushRef(refs, "PAYMENT_ATTEMPT", sourceWebhook.paymentAttemptId);
    pushRef(refs, "PAYMENT", sourceWebhook.paymentId);
  }
  for (const attempt of allAttempts) {
    pushRef(refs, "PROCESSING_ATTEMPT", attempt.id);
    pushRef(refs, "WEBHOOK_EVENT", attempt.webhookEventId);
    pushRef(refs, "PAYMENT_ATTEMPT", attempt.paymentAttemptId);
    pushRef(refs, "PAYMENT", attempt.paymentId);
    collectSnapshotRefs(refs, attempt.stateBefore);
    collectSnapshotRefs(refs, attempt.stateAfter);
    collectSnapshotGaps(gaps, attempt);
  }

  // Resolved BEFORE scenario evidence so a scenario builder can emit its own
  // capture gaps, and so the resolution is available to every scenario without
  // being duplicated per scenario.
  const authoritativeCapture = resolveAuthoritativeCaptureEvidence({
    subjectRazorpayPaymentId: source.captureSubjectRazorpayPaymentId,
    subjectInternalPaymentIds: source.captureSubjectInternalPaymentIds,
    providerSearchPerformed: source.captureProviderSearchPerformed,
    candidates: source.captureCandidates.map(projectWebhook),
  });
  const authoritativeCaptureWebhook =
    authoritativeCapture.kind === "EXACTLY_ONE" ||
    authoritativeCapture.kind === "INCOMPLETE_INTERNAL_CORRELATION"
      ? authoritativeCapture.webhook
      : null;

  // Every capture webhook actually used as evidence becomes a structured
  // reference, including each AMBIGUOUS candidate — an ambiguous result must
  // stay traceable to the exact rows that made it ambiguous. Deduplication and
  // ordering are handled by the existing `dedupeAndSortEvidenceRefs` contract.
  if (authoritativeCaptureWebhook !== null) {
    pushRef(refs, "WEBHOOK_EVENT", authoritativeCaptureWebhook.id);
    pushRef(refs, "PAYMENT", authoritativeCaptureWebhook.paymentId);
    pushRef(
      refs,
      "PAYMENT_ATTEMPT",
      authoritativeCaptureWebhook.paymentAttemptId,
    );
  }
  if (authoritativeCapture.kind === "AMBIGUOUS") {
    for (const candidate of authoritativeCapture.candidates) {
      pushRef(refs, "WEBHOOK_EVENT", candidate.id);
    }
  }

  const scenarioEvidence = buildScenarioEvidence({
    run,
    rawFaultState: source.run.fault_state,
    authoritativeCapture,
    sourceWebhook,
    originalProcessingAttempts,
    chaosProcessingAttempts,
    observedReplayAttemptCount,
    canonicalSourceEventCount: source.canonicalSourceEventCount,
    expectedEventTypes,
    gaps,
  });

  return {
    version: CHAOS_RUN_EVIDENCE_BUNDLE_VERSION,
    run,
    requiredInvariantIds,
    sourceWebhook,
    originalProcessingAttempts,
    chaosProcessingAttempts,
    canonicalSourceEventCount: source.canonicalSourceEventCount,
    authoritativeCapture,
    authoritativeCaptureWebhook,
    scenarioEvidence,
    evidenceRefs: dedupeAndSortEvidenceRefs(refs),
    gaps: dedupeAndSortEvidenceGaps(gaps),
  };
}

interface ScenarioEvidenceInput {
  readonly run: SafeChaosRunEvidence;
  readonly rawFaultState: unknown;
  readonly authoritativeCapture: AuthoritativeCaptureResolution;
  readonly sourceWebhook: SafeWebhookEvidence | null;
  readonly originalProcessingAttempts: readonly ProcessingAttemptEvidence[];
  readonly chaosProcessingAttempts: readonly ProcessingAttemptEvidence[];
  readonly observedReplayAttemptCount: number;
  readonly canonicalSourceEventCount: number | null;
  readonly expectedEventTypes: ReadonlySet<string>;
  /** Appended to in place; deduplicated and sorted once by the caller. */
  readonly gaps: EvidenceGap[];
}

function buildScenarioEvidence(input: ScenarioEvidenceInput): ScenarioEvidence {
  switch (input.run.scenarioId) {
    case "C01":
      return buildC01Evidence(input);
    case "C03":
      return buildC03Evidence(input);
    case "C07":
      return buildC07Evidence(input);
    case "C11":
      return buildC11Evidence(input);
  }
}

/**
 * C01 — Duplicate Webhook Delivery (docs/CHAOS_SCENARIOS.md §13). Frozen
 * Mechanism B: the ONE verified source event is replayed through the internal
 * Event Processor exactly `C01_EXPECTED_REPLAY_ATTEMPT_COUNT` times as
 * `PAYCHAOS_REPLAY` attempts, and no additional `webhook_events` row is ever
 * created — hence the canonical row count of exactly one.
 *
 * This function assembles those relationships as FACTS. It does not evaluate
 * INV-001/INV-002/INV-006/INV-007 and does not decide whether C01 passed.
 */
function buildC01Evidence(input: ScenarioEvidenceInput): C01Evidence {
  const { run, gaps } = input;

  collectSourceWebhookGaps(
    gaps,
    run,
    input.sourceWebhook,
    input.canonicalSourceEventCount,
    input.expectedEventTypes,
  );
  const authoritativeOriginalProcessingAttemptId =
    collectAuthoritativeOriginalGaps(gaps, input.originalProcessingAttempts);
  collectChaosProvenanceGaps(gaps, input.chaosProcessingAttempts);
  collectMerchantCorrelationGaps(gaps, run);
  collectCaptureEvidenceGaps(gaps, input.authoritativeCapture);

  if (run.faultType !== "REPLAY_EVENT") {
    pushGap(gaps, "UNEXPECTED_FAULT_TYPE");
  }
  if (input.observedReplayAttemptCount !== C01_EXPECTED_REPLAY_ATTEMPT_COUNT) {
    pushGap(gaps, "UNEXPECTED_CHAOS_PROCESSING_ATTEMPT_COUNT");
  }

  return {
    scenarioId: "C01",
    expectedReplayAttemptCount: C01_EXPECTED_REPLAY_ATTEMPT_COUNT,
    observedReplayAttemptCount: input.observedReplayAttemptCount,
    chaosLinkedProcessingAttemptCount: input.chaosProcessingAttempts.length,
    originalProcessingAttemptCount: input.originalProcessingAttempts.length,
    authoritativeOriginalProcessingAttemptId,
  };
}

/**
 * C03 — Invalid Webhook Signature (docs/CHAOS_SCENARIOS.md §15). The special
 * case, assembled ONLY from its existing durable synthetic facts.
 *
 * C03 creates no canonical webhook row, no processing attempt, no merchant
 * mutation and no snapshot, and every merchant/provider FK on its chaos run
 * is NULL. Phase 3E-B does not fabricate any of those to force C03 into the
 * Phase 3E-A snapshot model, and it does not read current merchant tables to
 * synthesise a "before/after" it never had. Where Phase 3F later wants
 * evidence C03 genuinely does not have, this envelope reports the absence
 * honestly and Phase 3F decides what that means.
 *
 * An `UNEXPECTED_ACCEPTANCE` classification is recorded as a FACT and is
 * deliberately NOT a gap: a gap means "the input could not be established",
 * and here it was established perfectly well. Whether an unexpected
 * acceptance is a money failure is INV-005's decision, in Phase 3F.
 */
function buildC03Evidence(input: ScenarioEvidenceInput): C03Evidence {
  const { run, gaps } = input;

  const verificationChecks = parseC03VerificationChecks(input.rawFaultState);
  if (verificationChecks === null) {
    pushGap(gaps, "MISSING_C03_VERIFICATION_CHECKS");
  }

  const sourceWebhookLinked = run.sourceWebhookEventId !== null;
  const orderLinked = run.orderId !== null;
  const paymentAttemptLinked = run.paymentAttemptId !== null;
  const paymentLinked = run.paymentId !== null;

  if (
    sourceWebhookLinked ||
    orderLinked ||
    paymentAttemptLinked ||
    paymentLinked
  ) {
    pushGap(gaps, "UNEXPECTED_C03_PROVIDER_LINK");
  }
  if (run.faultType !== "INVALID_SIGNATURE_TEST") {
    pushGap(gaps, "UNEXPECTED_FAULT_TYPE");
  }
  // A valid C03 runtime evidence envelope is explicitly SYNTHETIC_DEMO: C03
  // never touches a real merchant order or a real provider event, so a run
  // claiming RECORDED_TEST_EVIDENCE contradicts its own frozen architecture.
  // Recorded as a factual integrity gap — never a FAIL, and never a reason to
  // fabricate provider evidence.
  if (run.dataClassification !== C03_REQUIRED_DATA_CLASSIFICATION) {
    pushGap(gaps, "UNEXPECTED_DATA_CLASSIFICATION");
  }
  if (input.chaosProcessingAttempts.length !== 0) {
    pushGap(gaps, "UNEXPECTED_CHAOS_PROCESSING_ATTEMPT_COUNT");
  }

  // The before/after merchant state INV-005 §6 requires, captured during this
  // run's own execution. Reported exactly as persisted — never reconstructed
  // from today's mutable merchant state, and never compared here.
  //
  // The already-approved historical C03 run carries the legacy `{checks}`
  // shape with no `mutationEvidence` key. It parses as `ABSENT`, which is the
  // authoritative "never captured": it stays INV-005 UNKNOWN forever and is
  // NOT backfilled, because a snapshot taken today would be a false claim
  // about a run that executed in the past.
  const parsedMutationEvidence = parseC03MutationEvidence(input.rawFaultState);
  let mutationEvidence: C03MutationEvidence | null = null;
  if (parsedMutationEvidence.kind === "ABSENT") {
    pushGap(gaps, "MISSING_C03_MUTATION_EVIDENCE");
  } else if (parsedMutationEvidence.kind === "INVALID") {
    pushGap(gaps, "INVALID_C03_MUTATION_EVIDENCE");
  } else {
    mutationEvidence = parsedMutationEvidence.evidence;
    // A truncated or partially-read snapshot cannot support a delta
    // comparison. Reported as an incompleteness FACT, never as a verdict and
    // never silently compared as a prefix.
    if (!isC03MutationEvidenceComplete(mutationEvidence)) {
      pushGap(gaps, "INCOMPLETE_C03_MUTATION_EVIDENCE");
    }
  }

  return {
    scenarioId: "C03",
    verificationChecks,
    sourceWebhookLinked,
    orderLinked,
    paymentAttemptLinked,
    paymentLinked,
    chaosLinkedProcessingAttemptCount: input.chaosProcessingAttempts.length,
    mutationEvidence,
  };
}

/**
 * C07 — Payment Succeeds but Client Confirmation Is Lost
 * (docs/CHAOS_SCENARIOS.md §19). Frozen facts: `DROP_CLIENT_CONFIRMATION`,
 * a server-owned `{armed, consumed}` fault state, genuine
 * `REAL_RAZORPAY_WEBHOOK` convergence evidence, and NO `PAYCHAOS_REPLAY`
 * execution of any kind.
 *
 * Assembles those relationships as facts. Does not evaluate
 * INV-002/INV-004/INV-011, does not run Checkout, does not suppress a
 * confirmation, does not reconcile the run and never substitutes present-day
 * order state for a missing snapshot.
 */
function buildC07Evidence(input: ScenarioEvidenceInput): C07Evidence {
  const { run, gaps } = input;

  collectSourceWebhookGaps(
    gaps,
    run,
    input.sourceWebhook,
    input.canonicalSourceEventCount,
    input.expectedEventTypes,
  );
  const authoritativeOriginalProcessingAttemptId =
    collectAuthoritativeOriginalGaps(gaps, input.originalProcessingAttempts);
  collectMerchantCorrelationGaps(gaps, run);
  collectCaptureEvidenceGaps(gaps, input.authoritativeCapture);

  if (run.faultType !== "DROP_CLIENT_CONFIRMATION") {
    pushGap(gaps, "UNEXPECTED_FAULT_TYPE");
  }

  const faultState = parseC07FaultStateEvidence(input.rawFaultState);
  if (faultState === null) {
    pushGap(gaps, "MISSING_C07_FAULT_STATE");
  } else if (faultState.consumed !== true) {
    pushGap(gaps, "C07_FAULT_NOT_CONSUMED");
  }

  // C07 performs no replay at all: ANY chaos-run-linked processing attempt is
  // an integrity gap, not merely a wrong count.
  if (input.chaosProcessingAttempts.length !== 0) {
    pushGap(gaps, "UNEXPECTED_CHAOS_PROCESSING_ATTEMPT_COUNT");
  }

  return {
    scenarioId: "C07",
    faultArmed: faultState === null ? null : faultState.armed,
    faultConsumed: faultState === null ? null : faultState.consumed,
    expectedReplayAttemptCount: 0,
    observedReplayAttemptCount: input.observedReplayAttemptCount,
    chaosLinkedProcessingAttemptCount: input.chaosProcessingAttempts.length,
    originalProcessingAttemptCount: input.originalProcessingAttempts.length,
    authoritativeOriginalProcessingAttemptId,
  };
}

/**
 * Deterministically classifies the OBSERVED C11 evidence shape from persisted
 * relationships alone (this task's Section 18). Never a money verdict, and
 * never a claim about operator intent.
 *
 * A positive classification requires a genuinely completed, non-`BLOCKED` run
 * with a resolved source webhook — so the `TEST_FIXTURE` mechanism, which
 * remains `PRECHECK-07` BLOCKED at runtime and therefore carries no provider
 * evidence at all, can never be classified as an observation or a replay.
 */
function classifyC11EvidenceShape(
  run: SafeChaosRunEvidence,
  sourceWebhook: SafeWebhookEvidence | null,
  chaosLinkedCount: number,
  replayCount: number,
): C11EvidenceShape {
  if (run.status !== "COMPLETED" || run.outcome === "BLOCKED") {
    return "AMBIGUOUS_OR_INCOMPLETE";
  }
  if (sourceWebhook === null) {
    return "AMBIGUOUS_OR_INCOMPLETE";
  }
  if (chaosLinkedCount === C11A_EXPECTED_REPLAY_ATTEMPT_COUNT) {
    return "A_OBSERVATION";
  }
  if (
    chaosLinkedCount === C11B_EXPECTED_REPLAY_ATTEMPT_COUNT &&
    replayCount === C11B_EXPECTED_REPLAY_ATTEMPT_COUNT
  ) {
    return "B_REPLAY";
  }
  return "AMBIGUOUS_OR_INCOMPLETE";
}

/**
 * C11 — Failed Payment Must Never Mark Order Paid (docs/CHAOS_SCENARIOS.md
 * §23). Two genuine runtime mechanisms: A (pure observation of an authentic
 * `payment.failed`, zero replays) and B (exactly one `PAYCHAOS_REPLAY` of an
 * authentic previously-persisted `payment.failed`).
 *
 * Assembles the source provenance, the original attempt and the replay
 * relationship as facts. Does not evaluate INV-003/INV-004/INV-011.
 */
function buildC11Evidence(input: ScenarioEvidenceInput): C11Evidence {
  const { run, gaps } = input;

  collectSourceWebhookGaps(
    gaps,
    run,
    input.sourceWebhook,
    input.canonicalSourceEventCount,
    input.expectedEventTypes,
  );
  const authoritativeOriginalProcessingAttemptId =
    collectAuthoritativeOriginalGaps(gaps, input.originalProcessingAttempts);
  collectChaosProvenanceGaps(gaps, input.chaosProcessingAttempts);
  collectMerchantCorrelationGaps(gaps, run);
  collectCaptureEvidenceGaps(gaps, input.authoritativeCapture);

  // C11 has no fault primitive of its own (`lib/chaos/registry.ts` —
  // `allowedFaultTypes: []`), so a non-NULL fault_type is itself an anomaly.
  if (run.faultType !== null) {
    pushGap(gaps, "UNEXPECTED_FAULT_TYPE");
  }

  const observedShape = classifyC11EvidenceShape(
    run,
    input.sourceWebhook,
    input.chaosProcessingAttempts.length,
    input.observedReplayAttemptCount,
  );

  const expectedReplayAttemptCount =
    observedShape === "A_OBSERVATION"
      ? C11A_EXPECTED_REPLAY_ATTEMPT_COUNT
      : observedShape === "B_REPLAY"
        ? C11B_EXPECTED_REPLAY_ATTEMPT_COUNT
        : null;

  if (observedShape === "AMBIGUOUS_OR_INCOMPLETE") {
    pushGap(gaps, "AMBIGUOUS_C11_EVIDENCE_SHAPE");
    if (
      input.chaosProcessingAttempts.length > C11B_EXPECTED_REPLAY_ATTEMPT_COUNT
    ) {
      pushGap(gaps, "UNEXPECTED_CHAOS_PROCESSING_ATTEMPT_COUNT");
    }
  }

  return {
    scenarioId: "C11",
    observedShape,
    expectedReplayAttemptCount,
    observedReplayAttemptCount: input.observedReplayAttemptCount,
    chaosLinkedProcessingAttemptCount: input.chaosProcessingAttempts.length,
    originalProcessingAttemptCount: input.originalProcessingAttempts.length,
    authoritativeOriginalProcessingAttemptId,
    sourceEventTypeIsPaymentFailed:
      input.sourceWebhook?.eventType === "payment.failed",
  };
}
