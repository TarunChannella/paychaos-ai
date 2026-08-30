/**
 * Phase 4A-R1 — the Diagnosis Evidence Pack domain contract and its pure
 * builder.
 *
 * The frozen architecture is:
 *
 *   Invariant FAIL -> Finding -> Evidence Pack -> (Phase 4B signals)
 *
 * This module implements the third arrow and STOPS there. It contains no
 * signal extraction, no root-cause classification, no evidence-strength
 * judgement, no recommendation, no regression logic, no score and no
 * readiness rule. Those are Phase 4B and later
 * (docs/AI_DESIGN.md Sections 9-14; docs/PHASE_PLAN.md Section 8.7).
 *
 * WHY A NARROW PROJECTION RATHER THAN THE PHASE 3 BUNDLE.
 * `ChaosRunEvidenceBundleV1` exists to serve deterministic invariant
 * evaluation and carries more than diagnosis needs. docs/AI_DESIGN.md Section
 * 11 requires that "only fields needed for diagnosis should be loaded" and
 * that entire unrestricted database rows are never handed onward. Re-exposing
 * the whole bundle would also couple every later Phase 4 module to every
 * internal field of a frozen Phase 3 structure. This module therefore
 * projects a deliberately smaller, diagnosis-specific surface.
 *
 * PURITY. There are no value imports in this file at all — every import is
 * `import type` and is erased at compile time. The module performs no
 * database access, no network call, no environment read, no filesystem
 * access, no clock read and no randomness, and it calls no AI provider. The
 * same semantic input always produces the same semantic output. It never
 * mutates the caller's Finding or bundle: every array it returns is a fresh
 * copy, and nothing is sorted in place.
 *
 * EVIDENCE IS IMMUTABLE INPUT (docs/AI_DESIGN.md Section 13). This module
 * reads facts and rearranges them. It never rewrites webhook evidence,
 * invariant results, payment state, fulfilment records or processing history,
 * and it is structurally incapable of doing so.
 *
 * FACT VERSUS INFERENCE (CLAUDE.md Section 12; docs/MONEY_INVARIANTS.md
 * Section 40). Everything in the pack is a FACT copied from a persisted
 * record or a count already established by the frozen Phase 3 assembler.
 * Nothing here is an interpretation. In particular this module never compares
 * C03's before and after snapshots: that comparison is INV-005's decision and
 * belongs to the frozen Phase 3F engine, exactly as the Phase 3E assembler
 * documents.
 *
 * ABSENCE IS A FACT TOO. A missing optional record becomes `null` plus a
 * typed gap, never a fabricated `0`, `[]`, `{}` or an invented correlation.
 * The `null`-versus-empty distinction is preserved throughout, following the
 * frozen merchant-snapshot rule that `[]` is a positive claim that a
 * collection was read and was genuinely empty.
 */

import type { ChaosScenarioId } from "@/lib/chaos/types";
import type {
  AuthoritativeCaptureResolution,
  C03MutationEvidence,
  C03VerificationCase,
  C03VerificationClassification,
  C11EvidenceShape,
  ChaosRunEvidenceBundleV1,
  ParsedProcessingSnapshot,
  ProcessingAttemptEvidence,
  SafeWebhookEvidence,
} from "@/lib/evidence/chaos-run-evidence";
import type { FindingDetail } from "@/lib/findings/types";
import type {
  ChaosRunDataClassification,
  ChaosRunFaultType,
  ChaosRunOutcome,
  ChaosRunStatus,
  FindingStatus,
  InvariantResultEvidenceRef,
  InvariantResultInvariantId,
  InvariantResultSeverity,
  InvariantResultValue,
} from "@/lib/supabase/types";

/**
 * Pack envelope version. Bump ONLY when the projected shape changes in a way
 * a later Phase 4 consumer must branch on.
 *
 * The pack is an IN-MEMORY contract. It is never persisted: docs/DATABASE.md
 * states in three places that there is no generic evidence table, and its
 * phase/table matrix gives Phase 4 no evidence table to create. Phase 4A
 * therefore requires no migration.
 */
export const DIAGNOSIS_EVIDENCE_PACK_VERSION = 1 as const;

// ============================================================================
// ERROR MODEL
// ============================================================================

/**
 * Stable machine-readable failure codes.
 *
 * These describe an INTEGRITY CONTRADICTION in the supplied inputs — two facts
 * that cannot both be true. Ordinary factual absence is never an error here;
 * it becomes a gap (see `EvidencePackGapCode`). There is deliberately no
 * database-error code: this module performs no I/O and has no database error
 * to surface.
 */
export const EVIDENCE_PACK_ERROR_CODES = Object.freeze([
  /** The supplied invariant-result identity is not the one the Finding reports. */
  "EVIDENCE_PACK_INVARIANT_RESULT_MISMATCH",
  /** The persisted result is not `FAIL`, so it is not a diagnosis input at all. */
  "EVIDENCE_PACK_SOURCE_NOT_FAIL",
  /** Chaos evidence was supplied for a different run than the Finding correlates to. */
  "EVIDENCE_PACK_CHAOS_RUN_MISMATCH",
  /** The build input is structurally unusable. */
  "EVIDENCE_PACK_INPUT_INVALID",
] as const);

export type EvidencePackErrorCode = (typeof EVIDENCE_PACK_ERROR_CODES)[number];

/**
 * A deterministic Evidence Pack failure.
 *
 * Carries a stable code and a fixed safe message. It never embeds a raw
 * database error, a payload, a secret or customer data — there is nowhere for
 * such a value to travel, because the constructor accepts neither.
 */
export class EvidencePackError extends Error {
  readonly code: EvidencePackErrorCode;

  constructor(code: EvidencePackErrorCode, message: string) {
    super(message);
    this.name = "EvidencePackError";
    this.code = code;
  }
}

// ============================================================================
// GAPS
// ============================================================================

/**
 * Deterministic factual gap codes, in their frozen ordering.
 *
 * Each one states that a specific optional input could not be established
 * from the supplied pure inputs. None of them is a money verdict, a root
 * cause, an evidence-strength judgement or free prose.
 *
 * A gap relevant to one fact must never poison unrelated facts: a run without
 * a source webhook still reports its scenario context, its processing
 * attempts and its counts truthfully.
 */
const GAP_CODES = Object.freeze([
  /** The Finding carries no chaos-run correlation, so no scenario context exists to project. */
  "NO_CHAOS_RUN_CORRELATION",
  /** The Finding correlates to a chaos run, but no evidence bundle was supplied for it. */
  "CHAOS_EVIDENCE_UNAVAILABLE",
  /** A bundle was supplied but resolved no source webhook, so provenance cannot be projected. */
  "SOURCE_WEBHOOK_UNAVAILABLE",
  /** No chaos-run projection was available, so scenario context is absent. */
  "SCENARIO_CONTEXT_UNAVAILABLE",
  /** The bundle carries a scenario family this pack version does not project. */
  "SCENARIO_EVIDENCE_UNSUPPORTED",
  /** C03's two frozen verification checks were not present in validated form. */
  "C03_VERIFICATION_CHECKS_UNAVAILABLE",
  /** C03's validated before/after merchant facts were not present. */
  "C03_MUTATION_FACTS_UNAVAILABLE",
  /** C07's validated armed/consumed facts were not present. */
  "C07_FAULT_FACTS_UNAVAILABLE",
  /** No safe money projection could be established from trusted webhook evidence. */
  "MONEY_CONTEXT_UNAVAILABLE",
  /** No authoritative-capture resolution was available to project. */
  "CAPTURE_CONTEXT_UNAVAILABLE",
  /** A persisted evidence reference could not be matched against the supplied evidence. */
  "EVIDENCE_REF_UNRESOLVED",
] as const);

export const EVIDENCE_PACK_GAP_CODES: readonly EvidencePackGapCode[] =
  GAP_CODES;

export type EvidencePackGapCode = (typeof GAP_CODES)[number];

/**
 * One factual gap. `subjectId` is the internal UUID the gap is about, or
 * `null` for a pack-level gap. Never free text, never a raw error, never a
 * verdict.
 */
export interface EvidencePackGap {
  readonly code: EvidencePackGapCode;
  readonly subjectId: string | null;
}

// ============================================================================
// PACK SECTIONS
// ============================================================================

/** Safe factual Finding fields. Diagnosis and recommendation fields are deliberately absent. */
export interface EvidencePackFinding {
  readonly findingId: string;
  readonly invariantResultId: string;
  readonly status: FindingStatus;
  readonly title: string;
  readonly createdAt: string;
}

/**
 * The authoritative deterministic verdict this pack is built from.
 *
 * `result` is narrowed to `"FAIL"` in the type, because a successfully built
 * diagnosis pack can only ever come from a persisted `FAIL`
 * (docs/MONEY_INVARIANTS.md Section 50; docs/AI_DESIGN.md Section 10).
 */
export interface EvidencePackInvariant {
  readonly invariantId: InvariantResultInvariantId;
  readonly invariantVersion: string;
  readonly result: "FAIL";
  readonly severity: InvariantResultSeverity;
  readonly expectedSummary: string;
  readonly observedSummary: string;
  readonly reason: string;
  readonly evaluatedAt: string;
}

/** Preserved verbatim from the persisted invariant result. A null is never filled in. */
export interface EvidencePackCorrelations {
  readonly chaosRunId: string | null;
  readonly orderId: string | null;
  readonly paymentAttemptId: string | null;
  readonly paymentId: string | null;
}

/**
 * Chaos-run context.
 *
 * `dataClassification` is one axis of provenance and is kept separate from
 * webhook and processing provenance on purpose (docs/DEMO_PLAN.md Section 51:
 * a replayed result shows a Source label AND a Processing label). The three
 * axes are never flattened into one value.
 */
export interface EvidencePackScenarioContext {
  readonly scenarioId: ChaosScenarioId;
  readonly faultType: ChaosRunFaultType | null;
  readonly dataClassification: ChaosRunDataClassification;
  readonly status: ChaosRunStatus;
  readonly outcome: ChaosRunOutcome | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
}

/**
 * Safe source-event provenance.
 *
 * `sourceKind` is copied verbatim from the persisted canonical event. It is
 * never rewritten, and a replay is never relabelled as a new provider
 * delivery (docs/RAZORPAY_GUIDE.md Safety Rule 11).
 */
export interface EvidencePackSourceProvenance {
  readonly webhookEventId: string;
  readonly sourceKind: string;
  readonly signatureVerified: boolean;
  readonly eventType: string;
  readonly razorpayEventId: string;
  readonly receivedAt: string;
  readonly duplicateDeliveryCount: number;
}

/** Whether an attempt is the provider's own original processing or this chaos run's. */
export type EvidencePackProcessingRole = "ORIGINAL" | "CHAOS";

/**
 * One processing attempt, projected for diagnosis.
 *
 * There is deliberately NO evidence-kind string on this shape. The persisted
 * invariant vocabulary spells this entity `EVENT_PROCESSING_ATTEMPT` while the
 * frozen Phase 3 bundle uses the shorter historical `PROCESSING_ATTEMPT` for
 * its own internal list. Both spellings are frozen and neither is modified;
 * omitting the string entirely means this projection cannot leak one
 * vocabulary into the other's place.
 *
 * `stateBefore` and `stateAfter` keep the frozen three-way representation
 * exactly. A historical `NOT_CAPTURED` is authoritative absence and is never
 * reconstructed from current merchant state.
 */
export interface EvidencePackProcessingAttempt {
  readonly attemptId: string;
  readonly role: EvidencePackProcessingRole;
  readonly sourceKind: string;
  readonly status: string;
  readonly isDuplicateDelivery: boolean;
  readonly errorCode: string | null;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly stateBefore: ParsedProcessingSnapshot;
  readonly stateAfter: ParsedProcessingSnapshot;
}

/** Facts only. These are NOT diagnostic signals; Phase 4B derives signals from them. */
export interface EvidencePackCounts {
  readonly canonicalSourceEventCount: number | null;
  readonly originalAttemptCount: number;
  readonly chaosAttemptCount: number;
}

/**
 * Trusted normalized money terms, in integer smallest-currency subunits.
 *
 * A `null` is preserved exactly and is never defaulted to `0` or `"INR"`
 * (docs/MONEY_INVARIANTS.md INV-008 Section 16: an unestablished required
 * value is UNKNOWN, not PASS). No floating-point value ever appears here.
 */
export interface EvidencePackMoney {
  readonly amountSubunits: number | null;
  readonly currency: string | null;
}

/**
 * The authoritative captured-payment basis, as a fact about a search.
 *
 * `resolution` is the frozen resolution label copied verbatim. `webhook` is
 * populated only for the two resolutions that genuinely resolved one capture
 * event; `candidateCount` is populated only for the ambiguous resolution.
 * A negative resolution is never manufactured from a search that could not
 * have succeeded.
 */
export interface EvidencePackCaptureContext {
  readonly resolution: AuthoritativeCaptureResolution["kind"];
  readonly webhook: EvidencePackSourceProvenance | null;
  readonly candidateCount: number | null;
}

// ============================================================================
// SCENARIO-SPECIFIC EVIDENCE
// ============================================================================

/** C03's frozen verification check, projected unchanged. */
export interface EvidencePackC03VerificationCheck {
  readonly case: C03VerificationCase;
  readonly classification: C03VerificationClassification;
}

/**
 * Narrow discriminated scenario evidence for the four implemented P0
 * families.
 *
 * These are the safe, already-validated facts the frozen Phase 3 assembler
 * produced. C03 in particular cannot be understood from generic run metadata
 * alone, so its verification checks and its validated before/after merchant
 * facts are preserved here. The raw fault column is NOT projected: only the
 * assembler's validated envelope is, exactly as Phase 3E designed it.
 *
 * No field in this union is a root-cause interpretation.
 */
export type EvidencePackScenarioEvidence =
  | {
      readonly scenarioId: "C01";
      readonly expectedReplayAttemptCount: number;
      readonly observedReplayAttemptCount: number;
      readonly chaosLinkedProcessingAttemptCount: number;
      readonly originalProcessingAttemptCount: number;
      readonly authoritativeOriginalProcessingAttemptId: string | null;
    }
  | {
      readonly scenarioId: "C03";
      readonly verificationChecks:
        readonly EvidencePackC03VerificationCheck[] | null;
      readonly sourceWebhookLinked: boolean;
      readonly orderLinked: boolean;
      readonly paymentAttemptLinked: boolean;
      readonly paymentLinked: boolean;
      readonly chaosLinkedProcessingAttemptCount: number;
      /**
       * The validated before/after merchant facts captured during this run's
       * own execution, or `null` when the run predates that evidence or its
       * persisted value failed validation.
       *
       * The two sides are NEVER compared here. Whether the state changed is
       * INV-005's deterministic decision and belongs to the frozen Phase 3F
       * engine.
       */
      readonly merchantFacts: C03MutationEvidence | null;
    }
  | {
      readonly scenarioId: "C07";
      readonly faultArmed: boolean | null;
      readonly faultConsumed: boolean | null;
      readonly expectedReplayAttemptCount: number;
      readonly observedReplayAttemptCount: number;
      readonly chaosLinkedProcessingAttemptCount: number;
      readonly originalProcessingAttemptCount: number;
      readonly authoritativeOriginalProcessingAttemptId: string | null;
    }
  | {
      readonly scenarioId: "C11";
      readonly observedShape: C11EvidenceShape;
      readonly expectedReplayAttemptCount: number | null;
      readonly observedReplayAttemptCount: number;
      readonly chaosLinkedProcessingAttemptCount: number;
      readonly originalProcessingAttemptCount: number;
      readonly authoritativeOriginalProcessingAttemptId: string | null;
      readonly sourceEventTypeIsPaymentFailed: boolean;
    };

// ============================================================================
// THE PACK
// ============================================================================

/**
 * One versioned, deterministic, in-memory Evidence Pack for exactly one
 * Finding.
 *
 * Contains no diagnosis code, no evidence strength, no recommendation, no
 * regression state, no score and no readiness label — by design.
 */
export interface DiagnosisEvidencePackV1 {
  readonly version: typeof DIAGNOSIS_EVIDENCE_PACK_VERSION;
  readonly finding: EvidencePackFinding;
  readonly invariant: EvidencePackInvariant;
  readonly correlations: EvidencePackCorrelations;
  /**
   * The persisted traceability pointers, preserved verbatim in the persisted
   * vocabulary. These are pointers, not facts: they are never rewritten,
   * never renamed and never dropped.
   *
   * TYPE CONTRACT. `kind` stays `string`, matching the database-facing
   * `InvariantResultEvidenceRef` this value originates from, rather than
   * being narrowed to the domain `InvariantEvidenceKind`. Narrowing would
   * need runtime validation, and the only two ways to get it both cost more
   * than they buy: importing the frozen `INVARIANT_EVIDENCE_KINDS` value
   * would give this module its first runtime dependency and end the
   * zero-runtime-import guarantee that makes its purity checkable, while a
   * local copy of the seven kinds would be a duplicated vocabulary free to
   * drift from the frozen one.
   *
   * Nothing is lost by staying wide. The persisted vocabulary is already
   * enforced on write by the frozen `canonicalizeEvidenceRefs`, which rejects
   * an unapproved kind before a row can exist; the seven approved kinds are
   * pinned here by test instead; and keeping the field wide is what lets the
   * "preserve verbatim" rule stay absolute — no validation step can reject,
   * rewrite or drop a reference that was genuinely persisted.
   *
   * Resolution is still kind-aware: see `isEvidenceRefResolved`.
   */
  readonly evidenceRefs: readonly InvariantResultEvidenceRef[];
  readonly scenario: EvidencePackScenarioContext | null;
  readonly provenance: EvidencePackSourceProvenance | null;
  readonly processing: readonly EvidencePackProcessingAttempt[];
  readonly counts: EvidencePackCounts | null;
  readonly money: EvidencePackMoney | null;
  readonly capture: EvidencePackCaptureContext | null;
  readonly scenarioEvidence: EvidencePackScenarioEvidence | null;
  readonly gaps: readonly EvidencePackGap[];
}

// ============================================================================
// BUILD INPUT
// ============================================================================

/**
 * The persisted invariant-result facts the builder needs in order to verify
 * the FAIL-only entry gate for itself.
 *
 * `FindingDetail` deliberately does not carry the persisted `result`, and this
 * module does not widen it. Supplying the identity and the result separately
 * lets the builder assert BOTH that the caller passed the right row and that
 * the row is genuinely a `FAIL`, rather than assuming it.
 */
export interface EvidencePackInvariantResultFacts {
  readonly id: string;
  readonly result: InvariantResultValue;
}

export interface EvidencePackBuildInputV1 {
  readonly finding: FindingDetail;
  readonly invariantResult: EvidencePackInvariantResultFacts;
  /** `null` when no chaos evidence was assembled for this Finding. */
  readonly chaosEvidence: ChaosRunEvidenceBundleV1 | null;
}

// ============================================================================
// DETERMINISTIC ORDERING HELPERS
// ============================================================================

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Nulls sort before values, so ordering is total even with absent subjects. */
function compareNullableStrings(a: string | null, b: string | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  return compareStrings(a, b);
}

const ROLE_RANK: Readonly<Record<EvidencePackProcessingRole, number>> =
  Object.freeze({ ORIGINAL: 0, CHAOS: 1 });

/**
 * Deterministic dedupe and sort for gaps: frozen code order, then subject.
 *
 * The input is copied first — a caller-owned array is never sorted in place.
 */
function dedupeAndSortGaps(
  gaps: readonly EvidencePackGap[],
): readonly EvidencePackGap[] {
  const seen = new Map<string, EvidencePackGap>();
  for (const gap of gaps) {
    seen.set(`${gap.code}::${gap.subjectId ?? ""}`, {
      code: gap.code,
      subjectId: gap.subjectId,
    });
  }
  return [...seen.values()].sort((a, b) => {
    const ka = GAP_CODES.indexOf(a.code);
    const kb = GAP_CODES.indexOf(b.code);
    if (ka !== kb) return ka - kb;
    return compareNullableStrings(a.subjectId, b.subjectId);
  });
}

/**
 * Deterministic ordering for processing attempts: original provider activity
 * first, then this run's activity, each ordered by start time and then by id
 * so the ordering is total even when two attempts share a timestamp.
 */
function sortProcessing(
  attempts: readonly EvidencePackProcessingAttempt[],
): readonly EvidencePackProcessingAttempt[] {
  return [...attempts].sort((a, b) => {
    const ra = ROLE_RANK[a.role];
    const rb = ROLE_RANK[b.role];
    if (ra !== rb) return ra - rb;
    const started = compareStrings(a.startedAt, b.startedAt);
    if (started !== 0) return started;
    return compareStrings(a.attemptId, b.attemptId);
  });
}

// ============================================================================
// SAFE PROJECTIONS
// ============================================================================

function projectProvenance(
  webhook: SafeWebhookEvidence,
): EvidencePackSourceProvenance {
  return {
    webhookEventId: webhook.id,
    sourceKind: webhook.sourceKind,
    signatureVerified: webhook.signatureVerified,
    eventType: webhook.eventType,
    razorpayEventId: webhook.razorpayEventId,
    receivedAt: webhook.receivedAt,
    duplicateDeliveryCount: webhook.duplicateDeliveryCount,
  };
}

function projectAttempt(
  attempt: ProcessingAttemptEvidence,
  role: EvidencePackProcessingRole,
): EvidencePackProcessingAttempt {
  return {
    attemptId: attempt.id,
    role,
    sourceKind: attempt.sourceKind,
    status: attempt.status,
    isDuplicateDelivery: attempt.isDuplicateDelivery,
    errorCode: attempt.errorCode,
    startedAt: attempt.startedAt,
    finishedAt: attempt.finishedAt,
    stateBefore: attempt.stateBefore,
    stateAfter: attempt.stateAfter,
  };
}

function projectCapture(
  resolution: AuthoritativeCaptureResolution,
): EvidencePackCaptureContext {
  if (
    resolution.kind === "EXACTLY_ONE" ||
    resolution.kind === "INCOMPLETE_INTERNAL_CORRELATION"
  ) {
    return {
      resolution: resolution.kind,
      webhook: projectProvenance(resolution.webhook),
      candidateCount: null,
    };
  }
  if (resolution.kind === "AMBIGUOUS") {
    return {
      resolution: resolution.kind,
      webhook: null,
      candidateCount: resolution.candidates.length,
    };
  }
  return { resolution: resolution.kind, webhook: null, candidateCount: null };
}

/**
 * Projects the frozen scenario envelope into the narrow pack union and
 * records any scenario-specific factual gaps.
 *
 * Returns `null` for a scenario family this pack version does not project.
 * There is no `any` escape hatch and nothing is guessed.
 */
function projectScenarioEvidence(
  bundle: ChaosRunEvidenceBundleV1,
  gaps: EvidencePackGap[],
): EvidencePackScenarioEvidence | null {
  const evidence = bundle.scenarioEvidence;
  const runId = bundle.run.id;

  switch (evidence.scenarioId) {
    case "C01":
      return {
        scenarioId: "C01",
        expectedReplayAttemptCount: evidence.expectedReplayAttemptCount,
        observedReplayAttemptCount: evidence.observedReplayAttemptCount,
        chaosLinkedProcessingAttemptCount:
          evidence.chaosLinkedProcessingAttemptCount,
        originalProcessingAttemptCount: evidence.originalProcessingAttemptCount,
        authoritativeOriginalProcessingAttemptId:
          evidence.authoritativeOriginalProcessingAttemptId,
      };

    case "C03": {
      if (evidence.verificationChecks === null) {
        gaps.push({
          code: "C03_VERIFICATION_CHECKS_UNAVAILABLE",
          subjectId: runId,
        });
      }
      if (evidence.mutationEvidence === null) {
        gaps.push({
          code: "C03_MUTATION_FACTS_UNAVAILABLE",
          subjectId: runId,
        });
      }
      return {
        scenarioId: "C03",
        verificationChecks:
          evidence.verificationChecks === null
            ? null
            : evidence.verificationChecks.map((check) => ({
                case: check.case,
                classification: check.classification,
              })),
        sourceWebhookLinked: evidence.sourceWebhookLinked,
        orderLinked: evidence.orderLinked,
        paymentAttemptLinked: evidence.paymentAttemptLinked,
        paymentLinked: evidence.paymentLinked,
        chaosLinkedProcessingAttemptCount:
          evidence.chaosLinkedProcessingAttemptCount,
        merchantFacts: evidence.mutationEvidence,
      };
    }

    case "C07": {
      if (evidence.faultArmed === null || evidence.faultConsumed === null) {
        gaps.push({ code: "C07_FAULT_FACTS_UNAVAILABLE", subjectId: runId });
      }
      return {
        scenarioId: "C07",
        faultArmed: evidence.faultArmed,
        faultConsumed: evidence.faultConsumed,
        expectedReplayAttemptCount: evidence.expectedReplayAttemptCount,
        observedReplayAttemptCount: evidence.observedReplayAttemptCount,
        chaosLinkedProcessingAttemptCount:
          evidence.chaosLinkedProcessingAttemptCount,
        originalProcessingAttemptCount: evidence.originalProcessingAttemptCount,
        authoritativeOriginalProcessingAttemptId:
          evidence.authoritativeOriginalProcessingAttemptId,
      };
    }

    case "C11":
      return {
        scenarioId: "C11",
        observedShape: evidence.observedShape,
        expectedReplayAttemptCount: evidence.expectedReplayAttemptCount,
        observedReplayAttemptCount: evidence.observedReplayAttemptCount,
        chaosLinkedProcessingAttemptCount:
          evidence.chaosLinkedProcessingAttemptCount,
        originalProcessingAttemptCount: evidence.originalProcessingAttemptCount,
        authoritativeOriginalProcessingAttemptId:
          evidence.authoritativeOriginalProcessingAttemptId,
        sourceEventTypeIsPaymentFailed: evidence.sourceEventTypeIsPaymentFailed,
      };

    default: {
      // Unreachable while the frozen union holds exactly four families. Kept
      // so a future family degrades to an honest gap instead of a guess.
      gaps.push({ code: "SCENARIO_EVIDENCE_UNSUPPORTED", subjectId: runId });
      return null;
    }
  }
}

// ============================================================================
// EVIDENCE-REFERENCE RESOLUTION
// ============================================================================

/**
 * The internal ids the supplied evidence actually represents, separated by
 * the entity each one belongs to.
 *
 * A CORRELATION IS NOT EVIDENCE. A Finding may report `orderId = ORDER_A`,
 * and an evidence reference may point at `ORDER_A`, without the supplied
 * bundle containing any order evidence at all. Treating the correlation as
 * proof would let a later phase believe a record was observed when nothing
 * about it was ever loaded — the precise fabrication docs/MONEY_INVARIANTS.md
 * forbids. Correlations are preserved separately on `pack.correlations` and
 * deliberately take no part in resolution.
 *
 * For the same reason the chaos run's own correlation columns are excluded:
 * a run row carrying an order id is a pointer, not a projection of that
 * order. Only a real supplied projection counts.
 *
 * The sets are kept per kind rather than merged, so an id that genuinely
 * exists as one entity can never silently vouch for a reference of a
 * different kind.
 */
interface KnownEvidenceIds {
  readonly chaosRuns: ReadonlySet<string>;
  readonly webhookEvents: ReadonlySet<string>;
  readonly processingAttempts: ReadonlySet<string>;
  readonly orders: ReadonlySet<string>;
  readonly paymentAttempts: ReadonlySet<string>;
  readonly payments: ReadonlySet<string>;
  readonly fulfilments: ReadonlySet<string>;
}

/**
 * Reads the supplied bundle and reports only what it genuinely represents.
 *
 * This is a verification aid over the caller's own inputs, not a lookup: it
 * performs no I/O and can discover nothing that was not handed over.
 *
 * Merchant entities are admitted only from a `CAPTURED` snapshot, because
 * that is the one shape that carries an actual projected row. `NOT_CAPTURED`
 * and `INVALID` carry no rows and therefore vouch for nothing.
 *
 * C03's validated before/after collections are deliberately NOT used as a
 * resolution source. They are scenario-specific mutation facts rather than
 * the merchant-snapshot projection this resolver is defined over, and being
 * narrower here can only produce an honest gap, never a false resolution.
 */
function collectEvidenceIdsByKind(
  bundle: ChaosRunEvidenceBundleV1,
): KnownEvidenceIds {
  const chaosRuns = new Set<string>([bundle.run.id]);
  const webhookEvents = new Set<string>();
  const processingAttempts = new Set<string>();
  const orders = new Set<string>();
  const paymentAttempts = new Set<string>();
  const payments = new Set<string>();
  const fulfilments = new Set<string>();

  // Webhook evidence counts only where a safe projection genuinely exists.
  // A run's source-webhook pointer alone never resolves a webhook reference.
  if (bundle.sourceWebhook !== null) {
    webhookEvents.add(bundle.sourceWebhook.id);
  }
  if (bundle.authoritativeCaptureWebhook !== null) {
    webhookEvents.add(bundle.authoritativeCaptureWebhook.id);
  }
  if (bundle.authoritativeCapture.kind === "AMBIGUOUS") {
    for (const candidate of bundle.authoritativeCapture.candidates) {
      webhookEvents.add(candidate.id);
    }
  }

  for (const attempt of [
    ...bundle.originalProcessingAttempts,
    ...bundle.chaosProcessingAttempts,
  ]) {
    processingAttempts.add(attempt.id);

    // These two correlations are carried ON the supplied attempt projection
    // itself, so they are factual evidence that the attempt referenced them.
    if (attempt.paymentAttemptId !== null) {
      paymentAttempts.add(attempt.paymentAttemptId);
    }
    if (attempt.paymentId !== null) {
      payments.add(attempt.paymentId);
    }

    for (const side of [attempt.stateBefore, attempt.stateAfter]) {
      if (side.kind !== "CAPTURED") continue;
      const snapshot = side.snapshot;
      if (snapshot.order !== null) orders.add(snapshot.order.id);
      if (snapshot.paymentAttempt !== null) {
        paymentAttempts.add(snapshot.paymentAttempt.id);
      }
      if (snapshot.payment !== null) payments.add(snapshot.payment.id);
      if (snapshot.fulfilments !== null) {
        for (const fulfilment of snapshot.fulfilments) {
          fulfilments.add(fulfilment.id);
        }
      }
    }
  }

  return {
    chaosRuns,
    webhookEvents,
    processingAttempts,
    orders,
    paymentAttempts,
    payments,
    fulfilments,
  };
}

/**
 * Is this persisted reference represented by the supplied evidence?
 *
 * Each reference is checked against its OWN kind. A kind outside the seven
 * approved persisted values resolves to `false` rather than throwing: the
 * reference is still preserved verbatim, and an unexpected vocabulary is a
 * data oddity to report as a gap, not a contradiction that should destroy an
 * otherwise valid pack.
 */
function isEvidenceRefResolved(
  ref: InvariantResultEvidenceRef,
  known: KnownEvidenceIds,
): boolean {
  switch (ref.kind) {
    case "CHAOS_RUN":
      return known.chaosRuns.has(ref.id);
    case "WEBHOOK_EVENT":
      return known.webhookEvents.has(ref.id);
    case "EVENT_PROCESSING_ATTEMPT":
      return known.processingAttempts.has(ref.id);
    case "ORDER":
      return known.orders.has(ref.id);
    case "PAYMENT_ATTEMPT":
      return known.paymentAttempts.has(ref.id);
    case "PAYMENT":
      return known.payments.has(ref.id);
    case "FULFILMENT":
      return known.fulfilments.has(ref.id);
    default:
      return false;
  }
}

// ============================================================================
// BUILDER
// ============================================================================

/**
 * Builds the deterministic Evidence Pack for one Finding.
 *
 * Integrity contradictions throw a typed `EvidencePackError`. Factual absence
 * does not: it produces a valid pack carrying `null` and an explicit gap, so
 * a later phase can distinguish "not observed" from "observed as zero" and
 * reach `INSUFFICIENT_EVIDENCE` honestly rather than guessing.
 *
 * Performs no I/O of any kind and mutates neither argument.
 */
export function buildDiagnosisEvidencePack(
  input: EvidencePackBuildInputV1,
): DiagnosisEvidencePackV1 {
  if (
    typeof input !== "object" ||
    input === null ||
    typeof input.finding !== "object" ||
    input.finding === null ||
    typeof input.invariantResult !== "object" ||
    input.invariantResult === null
  ) {
    throw new EvidencePackError(
      "EVIDENCE_PACK_INPUT_INVALID",
      "An evidence pack requires a finding and its persisted invariant-result facts.",
    );
  }

  const { finding, invariantResult, chaosEvidence } = input;

  // GATE 1 — the supplied row must be the one this Finding reports.
  if (finding.invariantResultId !== invariantResult.id) {
    throw new EvidencePackError(
      "EVIDENCE_PACK_INVARIANT_RESULT_MISMATCH",
      "The supplied invariant result is not the one this finding reports.",
    );
  }

  // GATE 2 — only a persisted FAIL is a diagnosis input.
  if (invariantResult.result !== "FAIL") {
    throw new EvidencePackError(
      "EVIDENCE_PACK_SOURCE_NOT_FAIL",
      "A diagnosis evidence pack can only be built from a persisted FAIL result.",
    );
  }

  // GATE 3 — evidence must belong to this Finding's run. Evidence from two
  // different runs is never combined.
  const chaosRunId = finding.correlations.chaosRunId;
  if (chaosEvidence !== null && chaosEvidence.run.id !== chaosRunId) {
    throw new EvidencePackError(
      "EVIDENCE_PACK_CHAOS_RUN_MISMATCH",
      "The supplied chaos evidence belongs to a different chaos run than this finding.",
    );
  }

  const gaps: EvidencePackGap[] = [];

  let scenario: EvidencePackScenarioContext | null = null;
  let provenance: EvidencePackSourceProvenance | null = null;
  let counts: EvidencePackCounts | null = null;
  let money: EvidencePackMoney | null = null;
  let capture: EvidencePackCaptureContext | null = null;
  let scenarioEvidence: EvidencePackScenarioEvidence | null = null;
  const processing: EvidencePackProcessingAttempt[] = [];

  if (chaosRunId === null) {
    // A baseline (non-chaos) evaluation. No scenario context exists to
    // project, and none is invented.
    gaps.push({ code: "NO_CHAOS_RUN_CORRELATION", subjectId: null });
    gaps.push({ code: "SCENARIO_CONTEXT_UNAVAILABLE", subjectId: null });
    gaps.push({ code: "MONEY_CONTEXT_UNAVAILABLE", subjectId: null });
    gaps.push({ code: "CAPTURE_CONTEXT_UNAVAILABLE", subjectId: null });
  } else if (chaosEvidence === null) {
    // The Finding correlates to a run, but its evidence was not supplied.
    // Nothing about that run is fabricated.
    gaps.push({ code: "CHAOS_EVIDENCE_UNAVAILABLE", subjectId: chaosRunId });
    gaps.push({ code: "SCENARIO_CONTEXT_UNAVAILABLE", subjectId: chaosRunId });
    gaps.push({ code: "MONEY_CONTEXT_UNAVAILABLE", subjectId: chaosRunId });
    gaps.push({ code: "CAPTURE_CONTEXT_UNAVAILABLE", subjectId: chaosRunId });
  } else {
    const run = chaosEvidence.run;

    scenario = {
      scenarioId: run.scenarioId,
      faultType: run.faultType,
      dataClassification: run.dataClassification,
      status: run.status,
      outcome: run.outcome,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
    };

    if (chaosEvidence.sourceWebhook === null) {
      gaps.push({ code: "SOURCE_WEBHOOK_UNAVAILABLE", subjectId: run.id });
      gaps.push({ code: "MONEY_CONTEXT_UNAVAILABLE", subjectId: run.id });
    } else {
      provenance = projectProvenance(chaosEvidence.sourceWebhook);
      money = {
        amountSubunits: chaosEvidence.sourceWebhook.amountSubunits,
        currency: chaosEvidence.sourceWebhook.currency,
      };
      if (money.amountSubunits === null && money.currency === null) {
        gaps.push({ code: "MONEY_CONTEXT_UNAVAILABLE", subjectId: run.id });
      }
    }

    for (const attempt of chaosEvidence.originalProcessingAttempts) {
      processing.push(projectAttempt(attempt, "ORIGINAL"));
    }
    for (const attempt of chaosEvidence.chaosProcessingAttempts) {
      processing.push(projectAttempt(attempt, "CHAOS"));
    }

    counts = {
      canonicalSourceEventCount: chaosEvidence.canonicalSourceEventCount,
      originalAttemptCount: chaosEvidence.originalProcessingAttempts.length,
      chaosAttemptCount: chaosEvidence.chaosProcessingAttempts.length,
    };

    capture = projectCapture(chaosEvidence.authoritativeCapture);
    scenarioEvidence = projectScenarioEvidence(chaosEvidence, gaps);
  }

  // Evidence references are preserved verbatim, in the persisted vocabulary.
  // Copying the entries keeps the caller's array untouched and stops later
  // mutation of the source from changing an already-built pack.
  const evidenceRefs: InvariantResultEvidenceRef[] =
    finding.invariant.evidenceRefs.map((ref) => ({
      kind: ref.kind,
      id: ref.id,
    }));

  // Only report an unmatched reference when there was evidence to match it
  // against. Without a bundle the absence is already stated once, at pack
  // level (`NO_CHAOS_RUN_CORRELATION` or `CHAOS_EVIDENCE_UNAVAILABLE`),
  // rather than repeated for every pointer — the reason is identical for all
  // of them, and one honest statement carries more information than a list of
  // duplicates. Every reference is still preserved either way.
  if (chaosEvidence !== null) {
    const known = collectEvidenceIdsByKind(chaosEvidence);
    for (const ref of evidenceRefs) {
      if (!isEvidenceRefResolved(ref, known)) {
        gaps.push({ code: "EVIDENCE_REF_UNRESOLVED", subjectId: ref.id });
      }
    }
  }

  return {
    version: DIAGNOSIS_EVIDENCE_PACK_VERSION,
    finding: {
      findingId: finding.findingId,
      invariantResultId: finding.invariantResultId,
      status: finding.status,
      title: finding.title,
      createdAt: finding.createdAt,
    },
    invariant: {
      invariantId: finding.invariant.invariantId,
      invariantVersion: finding.invariant.invariantVersion,
      result: "FAIL",
      severity: finding.invariant.severity,
      expectedSummary: finding.invariant.expectedSummary,
      observedSummary: finding.invariant.observedSummary,
      reason: finding.invariant.reason,
      evaluatedAt: finding.invariant.evaluatedAt,
    },
    correlations: {
      chaosRunId: finding.correlations.chaosRunId,
      orderId: finding.correlations.orderId,
      paymentAttemptId: finding.correlations.paymentAttemptId,
      paymentId: finding.correlations.paymentId,
    },
    evidenceRefs,
    scenario,
    provenance,
    processing: sortProcessing(processing),
    counts,
    money,
    capture,
    scenarioEvidence,
    gaps: dedupeAndSortGaps(gaps),
  };
}
