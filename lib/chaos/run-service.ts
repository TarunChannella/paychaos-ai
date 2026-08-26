/**
 * Phase 3B — server-only orchestration between the frozen Phase 3A safety
 * gate and durable `chaos_runs` persistence (this task's Section 11).
 *
 * `createChaosRun(rawInput)` is the single entry point. Its contract:
 *
 *   raw internal request
 *     -> the frozen `runChaosPrecheck(rawInput)` (lib/chaos/safety-gate.ts)
 *     -> inspect the deterministic result
 *     -> either persist PENDING, or persist an eligible BLOCKED attempt,
 *        or fail closed without ever pretending persistence succeeded
 *
 * This module never replays a webhook, injects a fault, calls Razorpay, or
 * mutates `orders`/`payment_attempts`/`payments`/`fulfilments`. It contains
 * no route and no UI. It is not a public entry point — it is a trusted
 * server-side library function, called only by trusted internal server
 * code (there is no untrusted caller boundary in Phase 3B at all, since no
 * route exists yet).
 *
 * TYPE-SAFETY RULE (this task's Section 11 "Important type-safety rule"):
 * `runChaosPrecheck` is the ONLY authoritative runtime validator for
 * `rawInput`. Once it returns `PRECHECK_PASSED`, this module is entitled to
 * narrow/assert `rawInput` to the frozen `ChaosPrecheckInput` union,
 * because the frozen gate has already performed exact runtime shape
 * validation (PRECHECK-10) before ever reaching that result. The same
 * reasoning applies to a `PRECHECK-07`/`PRECHECK-08` BLOCKED result, since
 * PRECHECK-10 already ran (and passed) earlier in the frozen deterministic
 * evaluation order for those two IDs. This module never re-implements or
 * competes with that shape validation — it only interprets already-trusted
 * fields where needed. For `PRECHECK-09`/`PRECHECK-10` BLOCKED results,
 * shape validation has NOT (yet, or ever) succeeded, so nothing from
 * `rawInput` is trusted except an independently re-confirmed, registered
 * `scenarioId` (see `extractTrustedScenarioId` below) — no mechanism, fault
 * type, or entity/evidence field is read from `rawInput` in that case.
 *
 * PERSISTENCE RULE (this task's Section 12): `PRECHECK-01`/`02`/`03`/`05`/
 * `06` are never persisted as a `chaos_runs` row — see the module doc
 * comment on `PERSISTABLE_BLOCKED_PRECHECK_IDS` below for why. Only
 * `PRECHECK-07`/`08`/`09`/`10` against an independently-reconfirmed
 * registered scenario are eligible, and only when the database write
 * itself actually succeeds.
 */
import "server-only";

import {
  getOrderBaseline,
  getWebhookEventById,
  loadC01SourceEvidence,
  loadC11RealWebhookFailureEvidence,
} from "@/lib/chaos/repository";
import { isRegisteredScenarioId } from "@/lib/chaos/registry";
import { runChaosPrecheck } from "@/lib/chaos/safety-gate";
import type {
  ChaosFaultType,
  ChaosPrecheckId,
  ChaosPrecheckInput,
  ChaosPrecheckResult,
  ChaosScenarioId,
} from "@/lib/chaos/types";
import {
  createBlockedChaosRun,
  createPendingChaosRun,
  type ChaosRunEntityLinks,
  type PersistableChaosRunFailedPrecheckId,
} from "@/lib/chaos/run-repository";
import { logEvent } from "@/lib/security/logger";
import type { ChaosRunDataClassification } from "@/lib/supabase/types";

/**
 * The Phase 3B service result. Deliberately not the Phase 3A
 * `ChaosPrecheckResult` shape — this is a distinct, audit-aware contract.
 * `NOT_PERSISTED_BLOCKED` NEVER carries a `chaosRunId` — there is nothing
 * to reference, and this module must never fabricate one. No PASS/FAIL
 * money-invariant outcome is represented here; that belongs to a later
 * phase's Money Invariant Engine.
 */
export type ChaosRunServiceResult =
  | {
      readonly kind: "PERSISTED_PENDING";
      readonly chaosRunId: string;
      readonly scenarioId: ChaosScenarioId;
    }
  | {
      readonly kind: "PERSISTED_BLOCKED";
      readonly chaosRunId: string;
      readonly scenarioId: ChaosScenarioId;
      readonly failedPrecheckId: ChaosPrecheckId;
      readonly reason: string;
    }
  | {
      readonly kind: "NOT_PERSISTED_BLOCKED";
      readonly reasonCategory: string;
      readonly reason: string;
    };

/**
 * The only Phase 3A `BLOCKED` results Phase 3B ever persists as a
 * `chaos_runs` audit row (this task's Section 12, architect-approved):
 *   - PRECHECK-01/02/03 are global server/config failures, before any
 *     trusted scenario decision exists — not scenario-specific, so there
 *     is nothing meaningful to attribute a row to.
 *   - PRECHECK-05 means the scenario itself is unregistered/disabled/
 *     malformed — persisting a row would let an unknown/invalid scenario
 *     become a trusted audit record, which is exactly what must never
 *     happen.
 *   - PRECHECK-06 means the authoritative audit database itself is
 *     unreachable — persistence cannot be guaranteed, so this module does
 *     not even attempt it (it would just fail again).
 * PRECHECK-04 is not listed because it is structurally satisfied in the
 * frozen implementation and currently cannot fail.
 */
/**
 * Real TypeScript type guard (architect correction, Finding 2) — narrows a
 * frozen `ChaosPrecheckId` to the Phase 3B repository's own
 * `PersistableChaosRunFailedPrecheckId` subset. After this guard returns
 * `true`, the value is safely assignable to `createBlockedChaosRun`'s
 * `failedPrecheckId` parameter without a cast.
 */
function isPersistableBlockedPrecheckId(
  id: ChaosPrecheckId,
): id is PersistableChaosRunFailedPrecheckId {
  return (
    id === "PRECHECK-07" ||
    id === "PRECHECK-08" ||
    id === "PRECHECK-09" ||
    id === "PRECHECK-10"
  );
}

function notPersistedBlocked(
  reasonCategory: string,
  reason: string,
): ChaosRunServiceResult {
  return { kind: "NOT_PERSISTED_BLOCKED", reasonCategory, reason };
}

/**
 * Minimal, independent re-confirmation that `rawInput.scenarioId` is one of
 * the four registered P0 scenarios — reads ONLY this one property, never
 * anything else from `rawInput`. Used for every BLOCKED case (the frozen
 * `ChaosPrecheckResult`'s BLOCKED variant does not itself carry a
 * `scenarioId`), and is the ONLY thing trusted from `rawInput` for
 * PRECHECK-09/10.
 */
function extractTrustedScenarioId(rawInput: unknown): ChaosScenarioId | null {
  if (typeof rawInput !== "object" || rawInput === null) {
    return null;
  }
  const scenarioId = (rawInput as Record<string, unknown>).scenarioId;
  return isRegisteredScenarioId(scenarioId) ? scenarioId : null;
}

interface ResolvedRunMetadata {
  readonly links: ChaosRunEntityLinks;
  readonly faultType: ChaosFaultType | null;
  readonly dataClassification: ChaosRunDataClassification;
}

/**
 * Resolves the entity links / fault type / data classification for a
 * `PRECHECK_PASSED` result, re-confirming evidence independently via the
 * frozen, read-only `lib/chaos/repository.ts` helpers (the same ones
 * `runChaosPrecheck` itself already used) rather than trusting anything
 * cached from the precheck call. Returns `null` if evidence that the
 * precheck already confirmed cannot be independently re-resolved right
 * now (e.g. a race since the precheck ran) — the caller must fail closed
 * rather than fabricate a PENDING row in that case.
 */
async function resolvePendingRunMetadata(
  input: ChaosPrecheckInput,
): Promise<ResolvedRunMetadata | null> {
  switch (input.scenarioId) {
    case "C01": {
      const [webhookEvent, evidence] = await Promise.all([
        getWebhookEventById(input.sourceWebhookEventId),
        loadC01SourceEvidence(input.sourceWebhookEventId),
      ]);
      if (!webhookEvent || !evidence || !webhookEvent.payment_attempt_id) {
        return null;
      }
      return {
        links: {
          orderId: evidence.orderId,
          paymentAttemptId: webhookEvent.payment_attempt_id,
          paymentId: webhookEvent.payment_id,
          sourceWebhookEventId: webhookEvent.id,
        },
        faultType: "REPLAY_EVENT",
        dataClassification: "RECORDED_TEST_EVIDENCE",
      };
    }
    case "C03":
      return {
        links: {},
        faultType: "INVALID_SIGNATURE_TEST",
        dataClassification: "SYNTHETIC_DEMO",
      };
    case "C07": {
      if (!input.freshOrderId) {
        return null;
      }
      // payment_attempt_id stays NULL: no frozen read-only helper resolves
      // "the payment attempt for order X", and a fresh order is not
      // guaranteed to have one yet (Checkout happens after the run is
      // requested) — never fabricated (this task's Section 13).
      return {
        links: { orderId: input.freshOrderId },
        faultType: "DROP_CLIENT_CONFIRMATION",
        dataClassification: "RECORDED_TEST_EVIDENCE",
      };
    }
    case "C11": {
      if (input.mechanism === "A") {
        if (!input.freshOrderId) {
          return null;
        }
        return {
          links: { orderId: input.freshOrderId },
          faultType: null,
          dataClassification: "RECORDED_TEST_EVIDENCE",
        };
      }
      // Mechanism B. TEST_FIXTURE can never reach PRECHECK_PASSED in the
      // frozen Phase 3A gate (no fixture store exists) — handled
      // defensively only, never fabricating evidence.
      if (input.failureEvidence.kind === "TEST_FIXTURE") {
        return null;
      }
      const [webhookEvent, evidence] = await Promise.all([
        getWebhookEventById(input.failureEvidence.webhookEventId),
        loadC11RealWebhookFailureEvidence(input.failureEvidence.webhookEventId),
      ]);
      if (!webhookEvent || !evidence || !webhookEvent.payment_attempt_id) {
        return null;
      }
      return {
        links: {
          orderId: evidence.orderId,
          paymentAttemptId: webhookEvent.payment_attempt_id,
          paymentId: webhookEvent.payment_id,
          sourceWebhookEventId: webhookEvent.id,
        },
        faultType: null,
        dataClassification: "RECORDED_TEST_EVIDENCE",
      };
    }
  }
}

/**
 * Resolves the safe, sanitized metadata for a persistable BLOCKED result
 * (PRECHECK-07/08/09/10 only — the caller has already filtered out
 * everything else). Implements this task's Section 15 "General blocked
 * record sanitization": entity/evidence FKs are NULL unless independently
 * reconfirmed as genuinely resolved evidence (never merely because they
 * appeared in `rawInput`); `fault_type` is NULL whenever it cannot be
 * trusted as one of the three canonical primitives; `data_classification`
 * is always server-derived, never caller-defined.
 */
/**
 * Independently re-confirms, via the frozen read-only `getOrderBaseline`,
 * that a `freshOrderId` supplied by the caller genuinely refers to an
 * existing `orders` row before it is ever persisted as `chaos_runs.order_id`
 * (architect correction, Finding 1). PRECHECK-08 can fail for C07/C11
 * Mechanism A for three distinct reasons — no order selected, the supplied
 * order does not exist, or it exists but is not fresh — so the mere
 * presence of `freshOrderId` proves nothing. Returns `{}` (no link) if the
 * ID is absent or does not resolve to a real row; returns
 * `{ orderId: baseline.orderId }` if it does, REGARDLESS of whether that
 * baseline is fresh — the purpose here is only to prove the FK target
 * genuinely exists, never to require it to be fresh, and never to mutate
 * it.
 */
async function resolveBlockedOrderLink(
  freshOrderId: string | undefined,
): Promise<ChaosRunEntityLinks> {
  if (!freshOrderId) {
    return {};
  }
  const baseline = await getOrderBaseline(freshOrderId);
  if (!baseline) {
    return {};
  }
  return { orderId: baseline.orderId };
}

async function deriveSafeBlockedMetadata(
  scenarioId: ChaosScenarioId,
  failedPrecheckId: PersistableChaosRunFailedPrecheckId,
  rawInput: unknown,
): Promise<ResolvedRunMetadata> {
  // PRECHECK-09/10: shape validation has not succeeded — nothing beyond the
  // already independently-reconfirmed scenarioId may be trusted. The record
  // is an audit of a REJECTED request shape/mechanism, not evidence-backed
  // execution, so it is always SYNTHETIC_DEMO regardless of scenarioId
  // (architect correction, Finding 3) — never RECORDED_TEST_EVIDENCE, which
  // would incorrectly imply genuine provider evidence was established.
  if (
    failedPrecheckId === "PRECHECK-09" ||
    failedPrecheckId === "PRECHECK-10"
  ) {
    return {
      links: {},
      faultType: null,
      dataClassification: "SYNTHETIC_DEMO",
    };
  }

  // PRECHECK-07/08: PRECHECK-10 already passed earlier in the frozen
  // deterministic order, so rawInput's shape is trustworthy as a
  // ChaosPrecheckInput (this module's documented type-safety rule).
  const input = rawInput as ChaosPrecheckInput;

  switch (input.scenarioId) {
    case "C01": {
      if (failedPrecheckId === "PRECHECK-07") {
        // No evidence resolved at all — nothing to link (prefer missing
        // evidence over false evidence).
        return {
          links: {},
          faultType: "REPLAY_EVENT",
          dataClassification: "RECORDED_TEST_EVIDENCE",
        };
      }
      // PRECHECK-08: evidence WAS resolved by the precheck; only the
      // baseline state check failed. Re-confirm it still resolves before
      // linking — a genuinely resolved (if not-eligible) reference is
      // useful audit information, not fabricated evidence.
      const evidence = await loadC01SourceEvidence(input.sourceWebhookEventId);
      const webhookEvent = evidence
        ? await getWebhookEventById(input.sourceWebhookEventId)
        : null;
      return {
        links:
          evidence && webhookEvent
            ? {
                orderId: evidence.orderId,
                paymentAttemptId: webhookEvent.payment_attempt_id,
                paymentId: webhookEvent.payment_id,
                sourceWebhookEventId: webhookEvent.id,
              }
            : {},
        faultType: "REPLAY_EVENT",
        dataClassification: "RECORDED_TEST_EVIDENCE",
      };
    }
    case "C03":
      return {
        links: {},
        faultType: "INVALID_SIGNATURE_TEST",
        dataClassification: "SYNTHETIC_DEMO",
      };
    case "C07": {
      // C07 has no PRECHECK-07 dependency (only PRECHECK-08 applies).
      // PRECHECK-08 is reachable for THREE reasons — no order selected, the
      // supplied order does not exist, or it exists but is not fresh
      // (architect correction, Finding 1) — so `freshOrderId` being present
      // does NOT prove an `orders` row genuinely exists. Independently
      // re-confirm via the frozen, read-only `getOrderBaseline` before
      // linking; a nonexistent UUID must never reach the FK-constrained
      // `chaos_runs.order_id` column.
      const links = await resolveBlockedOrderLink(input.freshOrderId);
      return {
        links,
        faultType: "DROP_CLIENT_CONFIRMATION",
        dataClassification: "RECORDED_TEST_EVIDENCE",
      };
    }
    case "C11": {
      if (input.mechanism === "A") {
        // Same PRECHECK-08 rule as C07 above.
        const links = await resolveBlockedOrderLink(input.freshOrderId);
        return {
          links,
          faultType: null,
          dataClassification: "RECORDED_TEST_EVIDENCE",
        };
      }
      // Mechanism B.
      if (input.failureEvidence.kind === "TEST_FIXTURE") {
        // Architect-approved C11 TEST_FIXTURE model: always PRECHECK-07,
        // SYNTHETIC_DEMO, every FK NULL, no fabricated fixture/provider
        // evidence — this row records only that the requested TEST_FIXTURE
        // path was blocked.
        return {
          links: {},
          faultType: null,
          dataClassification: "SYNTHETIC_DEMO",
        };
      }
      if (failedPrecheckId === "PRECHECK-07") {
        return {
          links: {},
          faultType: null,
          dataClassification: "RECORDED_TEST_EVIDENCE",
        };
      }
      // PRECHECK-08: evidence resolved; the correlated order is already
      // PAID. Re-confirm before linking.
      const evidence = await loadC11RealWebhookFailureEvidence(
        input.failureEvidence.webhookEventId,
      );
      const webhookEvent = evidence
        ? await getWebhookEventById(input.failureEvidence.webhookEventId)
        : null;
      return {
        links:
          evidence && webhookEvent
            ? {
                orderId: evidence.orderId,
                paymentAttemptId: webhookEvent.payment_attempt_id,
                paymentId: webhookEvent.payment_id,
                sourceWebhookEventId: webhookEvent.id,
              }
            : {},
        faultType: null,
        dataClassification: "RECORDED_TEST_EVIDENCE",
      };
    }
  }
}

function logAuditPersistenceFailure(
  stage: "pending" | "blocked",
  scenarioId: ChaosScenarioId,
  err: unknown,
): void {
  // Only a safe category/name — never the raw Supabase error, a secret, the
  // full raw request, or any URL/host supplied by rejected input (this
  // task's Section 18).
  logEvent("chaos_run_audit_persistence_failed", {
    stage,
    scenario_id: scenarioId,
    error_name: err instanceof Error ? err.name : "UnknownError",
  });
}

async function persistPending(
  rawInput: unknown,
  result: Extract<ChaosPrecheckResult, { status: "PRECHECK_PASSED" }>,
): Promise<ChaosRunServiceResult> {
  const input = rawInput as ChaosPrecheckInput;

  const metadata = await resolvePendingRunMetadata(input);
  if (!metadata) {
    return notPersistedBlocked(
      "EVIDENCE_RESOLUTION_FAILED",
      "Required evidence could not be independently re-confirmed after the prerequisite checks passed.",
    );
  }

  try {
    const run = await createPendingChaosRun({
      scenarioId: result.scenarioId,
      faultType: metadata.faultType,
      dataClassification: metadata.dataClassification,
      orderId: metadata.links.orderId,
      paymentAttemptId: metadata.links.paymentAttemptId,
      paymentId: metadata.links.paymentId,
      sourceWebhookEventId: metadata.links.sourceWebhookEventId,
    });
    return {
      kind: "PERSISTED_PENDING",
      chaosRunId: run.id,
      scenarioId: result.scenarioId,
    };
  } catch (err) {
    logAuditPersistenceFailure("pending", result.scenarioId, err);
    return notPersistedBlocked(
      "AUDIT_PERSISTENCE_FAILED",
      "The chaos run could not be durably recorded.",
    );
  }
}

async function persistBlockedIfEligible(
  rawInput: unknown,
  result: Extract<ChaosPrecheckResult, { status: "BLOCKED" }>,
): Promise<ChaosRunServiceResult> {
  if (!isPersistableBlockedPrecheckId(result.failedPrecheckId)) {
    logEvent("chaos_run_precheck_not_persistable", {
      failed_precheck_id: result.failedPrecheckId,
    });
    return notPersistedBlocked(
      "NOT_PERSISTABLE_PRECHECK",
      "This precheck failure category is not persisted as a chaos-run audit record.",
    );
  }
  // `result.failedPrecheckId` is now narrowed to
  // `PersistableChaosRunFailedPrecheckId` for the remainder of this
  // function (architect correction, Finding 2).

  const scenarioId = extractTrustedScenarioId(rawInput);
  if (!scenarioId) {
    // Cannot happen in practice — PRECHECK-07..10 only occur after
    // PRECHECK-05 already confirmed a registered scenario earlier in the
    // frozen order — but fail closed rather than persist an unattributed
    // record if it ever did.
    return notPersistedBlocked(
      "SCENARIO_NOT_TRUSTED",
      "The requested scenario could not be independently re-confirmed as registered.",
    );
  }

  const metadata = await deriveSafeBlockedMetadata(
    scenarioId,
    result.failedPrecheckId,
    rawInput,
  );

  try {
    const run = await createBlockedChaosRun({
      scenarioId,
      failedPrecheckId: result.failedPrecheckId,
      safeReason: result.reason,
      dataClassification: metadata.dataClassification,
      faultType: metadata.faultType,
      orderId: metadata.links.orderId,
      paymentAttemptId: metadata.links.paymentAttemptId,
      paymentId: metadata.links.paymentId,
      sourceWebhookEventId: metadata.links.sourceWebhookEventId,
    });
    return {
      kind: "PERSISTED_BLOCKED",
      chaosRunId: run.id,
      scenarioId,
      failedPrecheckId: result.failedPrecheckId,
      reason: result.reason,
    };
  } catch (err) {
    logAuditPersistenceFailure("blocked", scenarioId, err);
    return notPersistedBlocked(
      "AUDIT_PERSISTENCE_FAILED",
      "The blocked chaos run could not be durably recorded.",
    );
  }
}

/**
 * The Phase 3B orchestration entry point. See the module doc comment above
 * for the full contract. Never executes chaos: no replay, no fault
 * injection, no Razorpay call, no order/payment/fulfilment mutation occurs
 * anywhere in this function or anything it calls.
 */
export async function createChaosRun(
  rawInput: unknown,
): Promise<ChaosRunServiceResult> {
  const precheckResult = await runChaosPrecheck(rawInput);

  if (precheckResult.status === "PRECHECK_PASSED") {
    return persistPending(rawInput, precheckResult);
  }

  return persistBlockedIfEligible(rawInput, precheckResult);
}
