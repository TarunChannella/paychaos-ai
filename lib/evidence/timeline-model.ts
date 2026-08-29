import type {
  ChaosRunEvidenceBundleV1,
  ProcessingAttemptEvidence,
  SafeWebhookEvidence,
} from "@/lib/evidence/chaos-run-evidence";
import type { FindingSummary } from "@/lib/findings/run-findings-read";
import type { SafeInvariantResultView } from "@/lib/chaos/run-read-model";

/**
 * Phase 3H — the PURE evidence-timeline model.
 *
 * No I/O, no clock, no client. It receives an already-assembled frozen
 * evidence bundle plus persisted invariant results and returns presentation
 * items. Being pure is what makes it testable and what stops it from quietly
 * reaching for data to fill a hole.
 *
 * ONE RULE ABOVE ALL: an item exists only when a persisted row supports it.
 * A gap stays a gap. This model never infers that a provider delivered an
 * event, never manufactures a timestamp, and never promotes a missing snapshot
 * into an assumed state. `NOT_CAPTURED`, `NO_SUBJECT` and `SEARCH_INCOMPLETE`
 * are shown as themselves, because a reliability tool that guesses is worse
 * than one that admits what it does not know.
 *
 * PROVENANCE IS READ, NOT DECIDED. Every `provenance` value below is copied
 * from a persisted column (`webhook_events.source_kind`,
 * `event_processing_attempts.source_kind`, `chaos_runs.data_classification`).
 * `PAYCHAOS_SIMULATION` is deliberately absent: no CHECK constraint in the
 * current schema accepts it, so nothing can legitimately carry it and this
 * model must never emit it.
 */

/** Exactly the provenance values the current schema can actually store. */
export type TimelineProvenance =
  | "REAL_RAZORPAY_WEBHOOK"
  | "PAYCHAOS_REPLAY"
  | "RECORDED_TEST_EVIDENCE"
  | "SYNTHETIC_DEMO"
  /** The persisted column held a value this model does not recognise. Shown as-is, never guessed. */
  | "UNRECOGNISED";

export type TimelineItemKind =
  | "SOURCE_WEBHOOK"
  | "ORIGINAL_PROCESSING_ATTEMPT"
  | "PAYCHAOS_REPLAY_ATTEMPT"
  | "SCENARIO_EVIDENCE"
  | "STATE_SNAPSHOT"
  | "INVARIANT_EVALUATED"
  | "FINDING_CREATED";

/** A factual note about evidence that does NOT exist. Never rendered as an event. */
export type TimelineGapKind =
  "NOT_CAPTURED" | "NO_SUBJECT" | "SEARCH_INCOMPLETE" | "INVALID";

export interface TimelineGapNote {
  readonly kind: TimelineGapKind;
  /** The frozen assembler's own gap code, when this note came from one. */
  readonly code: string | null;
  readonly subjectId: string | null;
  readonly label: string;
}

export interface TimelineItem {
  readonly kind: TimelineItemKind;
  /** The persisted row this item reports. */
  readonly subjectId: string;
  /**
   * The persisted timestamp, or `null` when the row genuinely carries none.
   * NEVER substituted with "now" or with a neighbouring item's time.
   */
  readonly occurredAt: string | null;
  readonly provenance: TimelineProvenance;
  readonly label: string;
  /** Short factual detail lines. No payload, no signature, no PII. */
  readonly details: readonly string[];
}

export interface EvidenceTimeline {
  readonly items: readonly TimelineItem[];
  readonly gaps: readonly TimelineGapNote[];
}

const KNOWN_PROVENANCE = new Set<string>([
  "REAL_RAZORPAY_WEBHOOK",
  "PAYCHAOS_REPLAY",
  "RECORDED_TEST_EVIDENCE",
  "SYNTHETIC_DEMO",
]);

/** Reads a persisted provenance value. Anything unknown is flagged, never mapped. */
export function toProvenance(storedValue: string): TimelineProvenance {
  return KNOWN_PROVENANCE.has(storedValue)
    ? (storedValue as TimelineProvenance)
    : "UNRECOGNISED";
}

/** Frozen assembler gap codes that mean "a snapshot was never captured". */
const SNAPSHOT_MISSING_CODES = new Set([
  "MISSING_STATE_BEFORE",
  "MISSING_STATE_AFTER",
  "MISSING_C03_MUTATION_EVIDENCE",
]);

const SNAPSHOT_INVALID_CODES = new Set([
  "INVALID_STATE_BEFORE",
  "INVALID_STATE_AFTER",
  "INVALID_C03_MUTATION_EVIDENCE",
]);

const NO_SUBJECT_CODES = new Set([
  "MISSING_ORDER_REFERENCE",
  "MISSING_PAYMENT_ATTEMPT_REFERENCE",
  "MISSING_PAYMENT_REFERENCE",
  "MISSING_SOURCE_WEBHOOK_LINK",
]);

function gapKind(code: string): TimelineGapKind {
  if (SNAPSHOT_INVALID_CODES.has(code)) return "INVALID";
  if (SNAPSHOT_MISSING_CODES.has(code)) return "NOT_CAPTURED";
  if (NO_SUBJECT_CODES.has(code)) return "NO_SUBJECT";
  return "SEARCH_INCOMPLETE";
}

function webhookItem(
  webhook: SafeWebhookEvidence,
  label: string,
): TimelineItem {
  return {
    kind: "SOURCE_WEBHOOK",
    subjectId: webhook.id,
    occurredAt: webhook.receivedAt,
    provenance: toProvenance(webhook.sourceKind),
    label,
    details: [
      `Event type: ${webhook.eventType}`,
      `Signature verified: ${webhook.signatureVerified ? "yes" : "no"}`,
      `Processing status: ${webhook.processingStatus}`,
      `Duplicate deliveries recorded: ${webhook.duplicateDeliveryCount}`,
    ],
  };
}

function attemptItem(
  attempt: ProcessingAttemptEvidence,
  kind: "ORIGINAL_PROCESSING_ATTEMPT" | "PAYCHAOS_REPLAY_ATTEMPT",
): TimelineItem {
  const details = [
    `Status: ${attempt.status}`,
    `Duplicate delivery: ${attempt.isDuplicateDelivery ? "yes" : "no"}`,
  ];
  if (attempt.errorCode !== null) {
    details.push(`Error code: ${attempt.errorCode}`);
  }
  return {
    kind,
    subjectId: attempt.id,
    occurredAt: attempt.startedAt,
    provenance: toProvenance(attempt.sourceKind),
    label:
      kind === "PAYCHAOS_REPLAY_ATTEMPT"
        ? "PayChaos replay processing attempt"
        : "Original processing attempt",
    details,
  };
}

/**
 * A snapshot item is emitted ONLY for a captured snapshot.
 *
 * `NOT_CAPTURED` and `INVALID` produce a gap note instead — never an item with
 * an assumed state, and never a silently omitted row that would let a reader
 * assume the state was fine.
 */
function snapshotItems(attempt: ProcessingAttemptEvidence): {
  items: TimelineItem[];
  gaps: TimelineGapNote[];
} {
  const items: TimelineItem[] = [];
  const gaps: TimelineGapNote[] = [];

  for (const [role, snapshot] of [
    ["before", attempt.stateBefore],
    ["after", attempt.stateAfter],
  ] as const) {
    if (snapshot.kind === "CAPTURED") {
      items.push({
        kind: "STATE_SNAPSHOT",
        subjectId: attempt.id,
        // A snapshot has no timestamp of its own; it belongs to its attempt.
        occurredAt: role === "before" ? attempt.startedAt : attempt.finishedAt,
        provenance: toProvenance(attempt.sourceKind),
        label: `Merchant state captured ${role} processing`,
        details: [],
      });
      continue;
    }
    gaps.push({
      kind: snapshot.kind === "INVALID" ? "INVALID" : "NOT_CAPTURED",
      code: null,
      subjectId: attempt.id,
      label:
        snapshot.kind === "INVALID"
          ? `Merchant state ${role} processing is present but unreadable`
          : `Merchant state ${role} processing was never captured`,
    });
  }

  return { items, gaps };
}

/**
 * Builds the timeline.
 *
 * Items are sorted by their persisted timestamp. Items with no timestamp keep
 * their input order and sort last, rather than being given an invented one.
 */
export function buildEvidenceTimeline(
  bundle: ChaosRunEvidenceBundleV1,
  invariantResults: readonly SafeInvariantResultView[],
  findings: readonly FindingSummary[] = [],
): EvidenceTimeline {
  const items: TimelineItem[] = [];
  const gaps: TimelineGapNote[] = [];

  // --- the run itself carries the scenario's classification ---------------
  //
  // A run only "started" if it has a persisted `startedAt`. A BLOCKED run was
  // stopped by a precheck and never executed, so its `startedAt` is NULL, and
  // claiming a start would be an invented event — the exact failure this model
  // exists to prevent. It is still a real audit record, so it is still shown;
  // only the wording changes, and NO timestamp is substituted for the NULL.
  const runStarted = bundle.run.startedAt !== null;
  items.push({
    kind: "SCENARIO_EVIDENCE",
    subjectId: bundle.run.id,
    occurredAt: bundle.run.startedAt,
    provenance: toProvenance(bundle.run.dataClassification),
    label: runStarted
      ? `Chaos run started — scenario ${bundle.run.scenarioId}`
      : `Chaos run record — scenario ${bundle.run.scenarioId} (never executed)`,
    details: [`Status: ${bundle.run.status}`, `Outcome: ${bundle.run.outcome}`],
  });

  // --- the genuine source webhook, when the run has one -------------------
  if (bundle.sourceWebhook !== null) {
    items.push(webhookItem(bundle.sourceWebhook, "Source webhook event"));
  }

  // --- the authoritative capture, when it is a DIFFERENT row --------------
  // One row legitimately fills both roles; emitting it twice would imply two
  // provider deliveries that never happened.
  if (
    bundle.authoritativeCaptureWebhook !== null &&
    bundle.authoritativeCaptureWebhook.id !== bundle.sourceWebhook?.id
  ) {
    items.push(
      webhookItem(
        bundle.authoritativeCaptureWebhook,
        "Authoritative capture webhook event",
      ),
    );
  }

  for (const attempt of bundle.originalProcessingAttempts) {
    items.push(attemptItem(attempt, "ORIGINAL_PROCESSING_ATTEMPT"));
    const snapshots = snapshotItems(attempt);
    items.push(...snapshots.items);
    gaps.push(...snapshots.gaps);
  }

  for (const attempt of bundle.chaosProcessingAttempts) {
    items.push(attemptItem(attempt, "PAYCHAOS_REPLAY_ATTEMPT"));
    const snapshots = snapshotItems(attempt);
    items.push(...snapshots.items);
    gaps.push(...snapshots.gaps);
  }

  // --- deterministic evaluation, one item per persisted result ------------
  for (const result of invariantResults) {
    items.push({
      kind: "INVARIANT_EVALUATED",
      subjectId: result.id,
      occurredAt: result.evaluatedAt,
      provenance: toProvenance(bundle.run.dataClassification),
      label: `${result.invariantId} evaluated — ${result.result}`,
      details: [
        `Severity: ${result.severity}`,
        `Expected: ${result.expectedSummary}`,
        `Observed: ${result.observedSummary}`,
      ],
    });
  }

  for (const finding of findings) {
    items.push({
      kind: "FINDING_CREATED",
      subjectId: finding.findingId,
      occurredAt: finding.createdAt,
      provenance: toProvenance(bundle.run.dataClassification),
      label: `Finding created — ${finding.title}`,
      details: [`Status: ${finding.status}`],
    });
  }

  // --- gaps the frozen assembler itself reported --------------------------
  for (const gap of bundle.gaps) {
    gaps.push({
      kind: gapKind(gap.code),
      code: gap.code,
      subjectId: gap.subjectId,
      label: gap.code,
    });
  }

  const ordered = [...items].sort((a, b) => {
    if (a.occurredAt === null && b.occurredAt === null) return 0;
    if (a.occurredAt === null) return 1;
    if (b.occurredAt === null) return -1;
    return a.occurredAt < b.occurredAt
      ? -1
      : a.occurredAt > b.occurredAt
        ? 1
        : 0;
  });

  return { items: Object.freeze(ordered), gaps: Object.freeze(gaps) };
}
