/**
 * Phase 3F-A — Money Invariant Engine static contracts.
 *
 * This module is intentionally value-light and side-effect free: no I/O, no
 * Supabase, no Razorpay, no network, no LLM, no clock read, no randomness.
 * It defines the shared TypeScript shapes used by
 * `lib/invariants/registry.ts` and, later, by the Phase 3F-B deterministic
 * evaluators and the Phase 3F-C orchestration/persistence layer.
 *
 * It carries no `server-only` guard because it defines types plus a handful
 * of frozen, non-secret string tuples and pure guards — nothing here can
 * leak a secret or an executable payment code path. `lib/invariants/registry.ts`
 * is the server-authoritative catalogue and is itself `server-only`.
 *
 * NO EVALUATOR LIVES HERE. Phase 3F-A ships zero evaluator logic anywhere in
 * the repository: this module never inspects evidence, never compares money,
 * and never produces a PASS/FAIL/UNKNOWN for anything. Deciding an
 * invariant's result is Phase 3F-B.
 *
 * WHY THIS MODULE OWNS `MoneyInvariantId` RATHER THAN `lib/chaos/types.ts`.
 * The frozen `lib/chaos/types.ts` `InvariantId` union deliberately contains
 * only the EIGHT invariants the four P0 chaos scenarios actually reference
 * (INV-001/002/003/004/005/006/007/011). That file's own doc comment states
 * that widening it would misrepresent it as the invariant catalogue. The
 * full P0 catalogue is TWELVE invariants (docs/MONEY_INVARIANTS.md Section
 * 14), including INV-008/009/010/012, which no P0 chaos scenario maps to and
 * which are evaluated outside a chaos run. Phase 3F therefore owns the full
 * catalogue here and leaves the frozen chaos union byte-unchanged. Every
 * member of the chaos union is a member of `MoneyInvariantId` — a subset
 * relationship `tests/unit/invariants/registry.test.ts` proves explicitly.
 *
 * TWO-LAYER RESULT MODEL (docs/MONEY_INVARIANTS.md Section 33). An
 * evaluation produces an in-memory ENVELOPE whose disposition may be any of
 * five values; only three of those are authoritative payment truth and may
 * reach `public.invariant_results.result`. `NOT_APPLICABLE` ("the rule does
 * not logically apply") and `ERROR` ("the evaluation system itself failed")
 * are NOT payment truth and are unpersistable by construction — see
 * `InvariantEvaluationEnvelope` below, whose discriminated union makes an
 * accidental persistence a compile-time error, and the migration's `result`
 * CHECK, which makes it a database error too.
 */

/**
 * The twelve frozen P0 Money Invariant catalogue IDs
 * (docs/MONEY_INVARIANTS.md Section 14).
 *
 * Exactly twelve — no more, no fewer. P1 invariants (INV-013 "Duplicate
 * Successful Payment Protection", INV-014 "Checkout Verification Must Match
 * the Server-Trusted Order") are deliberately absent: they are not P0, are
 * not authorized in Phase 3F, and simply do not type-check as members here.
 */
export type MoneyInvariantId =
  | "INV-001"
  | "INV-002"
  | "INV-003"
  | "INV-004"
  | "INV-005"
  | "INV-006"
  | "INV-007"
  | "INV-008"
  | "INV-009"
  | "INV-010"
  | "INV-011"
  | "INV-012";

/**
 * Feature priority of one invariant (CLAUDE.md Section 8). Every one of the
 * twelve catalogue entries is `P0`; the union exists so a later P1 invariant
 * can be represented without changing this type's meaning, not because a P1
 * entry is allowed in the Phase 3F registry.
 */
export type InvariantPriority = "P0" | "P1" | "P2";

/**
 * The severity vocabulary PERSISTED in `invariant_results.severity`
 * (docs/DATABASE.md Section 16).
 *
 * Deliberately NOT the same type as the frozen `lib/chaos/types.ts`
 * `FailureSeverity` ("Critical" | "High" | "Medium" | "Low" | "Info"). That
 * union is title-case and includes `Info`; this one is upper-case and has no
 * `Info`, because those four upper-case values are exactly what the database
 * CHECK accepts. Reusing the chaos type here would let `"Info"` — a value the
 * database rejects — pass type-checking. `INFO` and `WARNING` are not
 * invented; they do not exist in this vocabulary.
 */
export type InvariantSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

/**
 * The ONLY three values that may be written to
 * `public.invariant_results.result`.
 *
 * `UNKNOWN` is authoritative, not a soft failure: it means the rule applied
 * but the required evidence was insufficient (docs/MONEY_INVARIANTS.md
 * Section 32). It must never be read, scored or displayed as `PASS`.
 */
export type PersistedInvariantResult = "PASS" | "FAIL" | "UNKNOWN";

/**
 * Every in-memory disposition an attempted evaluation can reach
 * (docs/MONEY_INVARIANTS.md Sections 31/32/36/37/38).
 *
 * `NOT_APPLICABLE` — the rule does not logically apply to this evidence.
 * `ERROR` — the evaluation system itself failed (evaluator exception,
 * failed query, invalid internal evidence structure). `ERROR` is explicitly
 * not payment truth and must never be silently treated as `PASS`.
 *
 * Both are representable in memory and neither is persistable as
 * `invariant_results.result`.
 */
export type EvaluationDisposition =
  PersistedInvariantResult | "NOT_APPLICABLE" | "ERROR";

/** Frozen tuple of the three persistable results, in documentation order. */
export const PERSISTED_INVARIANT_RESULTS: readonly PersistedInvariantResult[] =
  Object.freeze(["PASS", "FAIL", "UNKNOWN"] as const);

/** Frozen tuple of the two dispositions that must NEVER reach the database. */
export const NON_PERSISTABLE_DISPOSITIONS: readonly EvaluationDisposition[] =
  Object.freeze(["NOT_APPLICABLE", "ERROR"] as const);

/** Frozen tuple of all five in-memory dispositions. */
export const EVALUATION_DISPOSITIONS: readonly EvaluationDisposition[] =
  Object.freeze([
    "PASS",
    "FAIL",
    "UNKNOWN",
    "NOT_APPLICABLE",
    "ERROR",
  ] as const);

/** Frozen tuple of the four persisted severity values, ascending. */
export const INVARIANT_SEVERITIES: readonly InvariantSeverity[] = Object.freeze(
  ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const,
);

/** Frozen, ordered tuple of the twelve P0 catalogue IDs. */
export const MONEY_INVARIANT_IDS: readonly MoneyInvariantId[] = Object.freeze([
  "INV-001",
  "INV-002",
  "INV-003",
  "INV-004",
  "INV-005",
  "INV-006",
  "INV-007",
  "INV-008",
  "INV-009",
  "INV-010",
  "INV-011",
  "INV-012",
] as const);

/**
 * Runtime type guard: is `value` one of the twelve P0 catalogue IDs?
 *
 * A P1 ID (`"INV-013"`), an unknown ID, or a non-string returns `false`.
 * Fails closed — it never guesses or normalizes a near-miss.
 */
export function isMoneyInvariantId(value: unknown): value is MoneyInvariantId {
  return (
    typeof value === "string" &&
    (MONEY_INVARIANT_IDS as readonly string[]).includes(value)
  );
}

/**
 * Runtime type guard: may this disposition be written to
 * `invariant_results.result`?
 *
 * Returns `false` for `NOT_APPLICABLE` and `ERROR`, and for any unknown
 * value. This is the runtime counterpart of the compile-time protection in
 * `InvariantEvaluationEnvelope`; the database CHECK is the third,
 * authoritative layer.
 */
export function isPersistedInvariantResult(
  value: unknown,
): value is PersistedInvariantResult {
  return (
    typeof value === "string" &&
    (PERSISTED_INVARIANT_RESULTS as readonly string[]).includes(value)
  );
}

/** Runtime type guard for the persisted severity vocabulary. */
export function isInvariantSeverity(
  value: unknown,
): value is InvariantSeverity {
  return (
    typeof value === "string" &&
    (INVARIANT_SEVERITIES as readonly string[]).includes(value)
  );
}

/**
 * The evidence kinds an `evidence_refs` entry may name
 * (docs/MONEY_INVARIANTS.md Section 42).
 *
 * Each kind corresponds to an existing table — there is no generic evidence
 * table in this project. `EVENT_PROCESSING_ATTEMPT` is spelled to match the
 * real `event_processing_attempts` table; docs/DATABASE.md Section 16's
 * shorter illustrative list previously wrote `PROCESSING_ATTEMPT` for the
 * same thing, and has been reconciled to this spelling.
 */
export type InvariantEvidenceKind =
  | "ORDER"
  | "PAYMENT_ATTEMPT"
  | "PAYMENT"
  | "FULFILMENT"
  | "WEBHOOK_EVENT"
  | "EVENT_PROCESSING_ATTEMPT"
  | "CHAOS_RUN";

/** Frozen tuple of the seven approved evidence kinds. */
export const INVARIANT_EVIDENCE_KINDS: readonly InvariantEvidenceKind[] =
  Object.freeze([
    "ORDER",
    "PAYMENT_ATTEMPT",
    "PAYMENT",
    "FULFILMENT",
    "WEBHOOK_EVENT",
    "EVENT_PROCESSING_ATTEMPT",
    "CHAOS_RUN",
  ] as const);

/**
 * One structured reference to an existing record.
 *
 * A REFERENCE ONLY — never a copy of the evidence. A raw webhook payload,
 * `normalized_event`, signature, `raw_body_sha256`, secret, customer PII,
 * diagnosis text, recommendation text or AI output must never appear in an
 * `evidence_refs` entry. The shape has exactly two fields precisely so
 * there is nowhere for such a payload to be placed.
 */
export interface InvariantEvidenceRef {
  readonly kind: InvariantEvidenceKind;
  /** Internal PayChaos UUID of the referenced record. Never a provider ID, never a secret. */
  readonly id: string;
}

/**
 * The entity correlations an evaluation may truthfully carry.
 *
 * Every field is nullable, mirroring the corrected `invariant_results`
 * schema. C03 legitimately has `orderId`, `paymentAttemptId` and `paymentId`
 * all `null` and only a `chaosRunId` — a correlation must NEVER be invented
 * to fill one of these (CLAUDE.md Section 12; docs/MONEY_INVARIANTS.md
 * Section 12). `chaosRunId: null` means a baseline, non-chaos evaluation.
 */
export interface InvariantCorrelations {
  readonly orderId: string | null;
  readonly paymentAttemptId: string | null;
  readonly paymentId: string | null;
  readonly chaosRunId: string | null;
}

/** Fields every evaluation envelope carries, whatever its disposition. */
interface InvariantEvaluationEnvelopeBase {
  readonly invariantId: MoneyInvariantId;
  readonly invariantVersion: string;
  readonly correlations: InvariantCorrelations;
  /** Deterministic evaluator explanation. Never AI-generated, never secret-bearing. */
  readonly reason: string;
  readonly evidenceRefs: readonly InvariantEvidenceRef[];
}

/**
 * An evaluation whose disposition IS authoritative payment truth and is
 * therefore eligible for persistence.
 *
 * `expectedSummary`/`observedSummary` are required here — a persistable
 * result must always be able to state what was expected and what was
 * observed (docs/MONEY_INVARIANTS.md Section 33.1, CLAUDE.md Section 12:
 * FACT/EVIDENCE separated from DIAGNOSIS/INFERENCE).
 */
export interface PersistableInvariantEvaluation extends InvariantEvaluationEnvelopeBase {
  readonly disposition: PersistedInvariantResult;
  readonly severity: InvariantSeverity;
  readonly expectedSummary: string;
  readonly observedSummary: string;
}

/**
 * An evaluation that did NOT reach payment truth.
 *
 * Structurally distinct from `PersistableInvariantEvaluation`: it has no
 * `severity`, no `expectedSummary` and no `observedSummary`, so it cannot be
 * passed where a persistable evaluation is expected. `NOT_APPLICABLE`/`ERROR`
 * therefore cannot reach `invariant_results` by accident — the compiler
 * rejects it before the database CHECK ever has to.
 */
export interface NonPersistableInvariantEvaluation extends InvariantEvaluationEnvelopeBase {
  readonly disposition: "NOT_APPLICABLE" | "ERROR";
}

/**
 * The full in-memory evaluation envelope (docs/MONEY_INVARIANTS.md Section
 * 33.1), as a discriminated union on `disposition`.
 *
 * Deliberately absent, and never to be added here: AI explanation,
 * confidence, diagnosis, root-cause code, recommendation, reliability score,
 * finding ID, regression state. Those belong to Phase 4 and are advisory —
 * they must never travel inside the deterministic invariant envelope.
 *
 * `evaluatedAt` is also deliberately absent: this module reads no clock. The
 * evaluation timestamp is supplied by the Phase 3F-C persistence layer (or
 * defaulted by `invariant_results.evaluated_at`), keeping every Phase 3F-A/B
 * module pure and deterministic.
 */
export type InvariantEvaluationEnvelope =
  PersistableInvariantEvaluation | NonPersistableInvariantEvaluation;

/**
 * Narrowing helper: is this envelope eligible for persistence as an
 * authoritative `invariant_results` row?
 *
 * Pure. Performs no I/O and asserts nothing about whether the result is
 * correct — only about whether its disposition is one the database may hold.
 */
export function isPersistableEvaluation(
  envelope: InvariantEvaluationEnvelope,
): envelope is PersistableInvariantEvaluation {
  return isPersistedInvariantResult(envelope.disposition);
}

/**
 * One immutable entry in the frozen P0 invariant catalogue
 * (`lib/invariants/registry.ts`).
 *
 * Metadata only. There is deliberately NO `evaluate` function field: Phase
 * 3F-A ships no evaluator, and a placeholder that returned `PASS` would be a
 * fabricated money verdict. Phase 3F-B attaches its deterministic evaluators
 * by looking entries up via `evaluatorKey`, which is a stable identifier
 * string, not executable code.
 */
export interface MoneyInvariantDefinition {
  readonly invariantId: MoneyInvariantId;
  /** Rule version. P0 begins at `"1"` (docs/MONEY_INVARIANTS.md Section 48). */
  readonly version: string;
  /** Catalogue name, verbatim from docs/MONEY_INVARIANTS.md Section 14. */
  readonly name: string;
  readonly priority: InvariantPriority;
  /**
   * Severity a violation of this invariant is recorded with by default.
   * Persisted as a SNAPSHOT on each result, so changing this value later
   * never rewrites history.
   */
  readonly defaultSeverity: InvariantSeverity;
  /** Short business meaning. Factual description, not diagnosis. */
  readonly description: string;
  /** Which existing records this invariant needs in order to be evaluable. */
  readonly requiredEvidence: readonly InvariantEvidenceKind[];
  /** Recommended remediation CATEGORY codes (docs/MONEY_INVARIANTS.md, each invariant's Section 14). */
  readonly remediationCategories: readonly string[];
  /** Stable metadata identifier the Phase 3F-B evaluator table will key on. Not executable code. */
  readonly evaluatorKey: string;
}
