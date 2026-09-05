import "server-only";

import { loadC01SourceEvidence } from "@/lib/chaos/repository";
import { listEligibleSources } from "@/lib/chaos/eligibility-service";
import type { ChaosRunRow } from "@/lib/chaos/run-repository";

/**
 * Phase 5 correction — choosing a FRESH C01 replay source for a regression.
 *
 * ============================================================================
 * WHY THIS EXISTS
 * ============================================================================
 *
 * C01's regression used to replay the ORIGINAL run's source webhook event.
 * That can never pass, and the deployed run proved it: the original C01
 * failure leaves more than one `FULFIL_ORDER` row on its order, those rows are
 * preserved evidence, and `PRECHECK-08` requires a
 * PAID-with-exactly-one-fulfilment baseline. The re-test was therefore blocked
 * (`C01_BASELINE_NOT_PAID_ONE_FULFILMENT`) and the regression terminalized as
 * ERROR.
 *
 * PRECHECK-08 is right. The subject is genuinely contaminated — by the exact
 * defect being re-tested. The orchestration was wrong to point at it.
 *
 * A re-test needs NEW genuine evidence, exactly as C07 already requires a
 * fresh order. This module picks that evidence, and only that evidence.
 *
 * ============================================================================
 * WHAT IT WILL NOT DO
 * ============================================================================
 *
 *   - It never deletes or rewrites the historical duplicate fulfilments.
 *   - It never mutates the original invariant result or Finding.
 *   - It never fabricates provider evidence: candidates come from the frozen
 *     eligibility service, which draws only from persisted, signature-verified
 *     `webhook_events` rows.
 *   - It accepts NO caller-supplied webhook id. The subject is derived
 *     server-side from trusted database relationships, so a client cannot
 *     nominate the evidence its own re-test will be judged on.
 *   - It never relaxes PRECHECK-08. It applies the SAME baseline rule when
 *     choosing, so a candidate that would be blocked is not offered.
 */

/** A fresh, server-verified C01 replay source. */
export interface FreshC01Source {
  readonly webhookEventId: string;
  readonly orderId: string;
}

/**
 * Resolves a fresh C01 source, or `null` when none exists yet.
 *
 * `null` is a normal, expected state — it means "no new Test Mode payment has
 * been made since the failure", not an error. The caller turns it into an
 * AWAITING result, never a failure verdict.
 */
export async function resolveFreshC01Source(
  originalRun: ChaosRunRow,
): Promise<FreshC01Source | null> {
  const subjects = await listEligibleSources({ scenarioId: "C01" });
  if (subjects.kind !== "WEBHOOK_SOURCES") return null;

  for (const candidate of subjects.candidates) {
    // 1. STRUCTURAL REUSE IS REFUSED FIRST, before any further work — the
    //    same order in which C07 refuses a reused order. Replaying the
    //    original event again would not be a re-test at all.
    if (candidate.webhookEventId === originalRun.source_webhook_event_id) {
      continue;
    }

    // 2. The original ORDER is excluded too, not just the original event.
    //    A second captured event correlated to the same contaminated order
    //    would carry the same poisoned fulfilment count, and excluding only
    //    the event id would let it through.
    if (
      originalRun.order_id !== null &&
      candidate.orderId === originalRun.order_id
    ) {
      continue;
    }

    // 3. The PRECHECK-08 baseline, applied through the FROZEN loader rather
    //    than re-implemented here, so this can never drift from the gate that
    //    will run moments later. `listC01Candidates` deliberately does not
    //    apply it — it offers anything the loader resolves — so a candidate
    //    still has to be checked here or the run would be created and then
    //    immediately BLOCKED, which is the bug this module exists to fix.
    const evidence = await loadC01SourceEvidence(candidate.webhookEventId);
    if (evidence === null) continue;
    if (evidence.baseline.paymentStatus !== "PAID") continue;
    if (evidence.baseline.fulfilmentCount !== 1) continue;

    return {
      webhookEventId: evidence.webhookEventId,
      orderId: evidence.orderId,
    };
  }

  return null;
}
