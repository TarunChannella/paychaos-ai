import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * Phase 5 correction — a C01 regression must re-test FRESH evidence.
 *
 * ============================================================================
 * THE CONFIRMED PRODUCTION DEFECT THIS FILE PINS
 * ============================================================================
 *
 * Observed on the deployed instance, with real Razorpay Test Mode evidence:
 *
 *   SAFE baseline payment            -> 1 fulfilment
 *   VULNERABLE_IDEMPOTENCY + C01     -> 3 fulfilments (two replay attempts)
 *   INV-001/002/006/007              -> FAIL, 4 Findings created
 *   switch back to SAFE
 *   Run Regression Test              -> chaos run BLOCKED, PRECHECK-08,
 *                                       "C01_BASELINE_NOT_PAID_ONE_FULFILMENT"
 *                                    -> regression status ERROR
 *
 * The regression replayed the ORIGINAL run's source event, against the
 * ORIGINAL order — which now permanently carries three FULFIL_ORDER rows.
 * PRECHECK-08 requires a PAID-with-exactly-one-fulfilment baseline, so that
 * subject can never pass again.
 *
 * PRECHECK-08 IS CORRECT AND IS NOT TOUCHED. The historical fulfilments are
 * preserved evidence and are not deleted. INV-002 keeps its total-count rule
 * and is not converted to a delta. The original FAIL and Finding are never
 * rewritten. The fix is orchestration only: re-test new evidence, exactly as
 * C07 already re-tests a fresh order.
 */

const ROOT = process.cwd();

/** Source with comments stripped — prose must never satisfy a behaviour check. */
function code(path: string): string {
  return readFileSync(join(ROOT, path), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
}

// ---------------------------------------------------------------------------
// Behavioural half: the fresh-source resolver, against mocked chaos services
// ---------------------------------------------------------------------------

const listEligibleSources = vi.fn();
const loadC01SourceEvidence = vi.fn();

vi.mock("@/lib/chaos/eligibility-service", () => ({
  listEligibleSources: (...a: unknown[]) => listEligibleSources(...a),
}));
vi.mock("@/lib/chaos/repository", () => ({
  loadC01SourceEvidence: (...a: unknown[]) => loadC01SourceEvidence(...a),
}));

const { resolveFreshC01Source } = await import("@/lib/regression/fresh-source");

const ORIGINAL_EVENT = "original-event-id";
const ORIGINAL_ORDER = "original-order-id";
const FRESH_EVENT = "fresh-event-id";
const FRESH_ORDER = "fresh-order-id";

/** The contaminated original run, shaped as the deployed row was. */
const originalRun = {
  id: "original-run-id",
  scenario_id: "C01",
  order_id: ORIGINAL_ORDER,
  source_webhook_event_id: ORIGINAL_EVENT,
} as never;

function candidate(webhookEventId: string, orderId: string) {
  return {
    kind: "WEBHOOK_EVENT" as const,
    webhookEventId,
    eventType: "payment.captured",
    receivedAt: "2026-09-05T00:00:00.000Z",
    orderId,
    sourceKind: "REAL_RAZORPAY_WEBHOOK",
  };
}

function evidence(
  webhookEventId: string,
  orderId: string,
  fulfilmentCount: number,
  paymentStatus = "PAID",
) {
  return {
    webhookEventId,
    orderId,
    baseline: { paymentStatus, fulfilmentCount },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("C01 fresh subject — the contaminated original is never re-used", () => {
  it("1: a contaminated original is never offered as the regression subject", async () => {
    // THE DEFECT, pinned. The original event is still a listed candidate — it
    // is genuine, signature-verified evidence — but its order now carries
    // three fulfilments, so it can never satisfy PRECHECK-08.
    listEligibleSources.mockResolvedValue({
      kind: "WEBHOOK_SOURCES",
      candidates: [candidate(ORIGINAL_EVENT, ORIGINAL_ORDER)],
    });
    loadC01SourceEvidence.mockResolvedValue(
      evidence(ORIGINAL_EVENT, ORIGINAL_ORDER, 3),
    );

    expect(await resolveFreshC01Source(originalRun)).toBeNull();
  });

  it("2: no fresh capture yields null — an awaiting state, never a subject", async () => {
    listEligibleSources.mockResolvedValue({
      kind: "WEBHOOK_SOURCES",
      candidates: [],
    });

    expect(await resolveFreshC01Source(originalRun)).toBeNull();
  });

  it("3: a genuinely fresh capture with a clean baseline is selected", async () => {
    listEligibleSources.mockResolvedValue({
      kind: "WEBHOOK_SOURCES",
      candidates: [
        candidate(ORIGINAL_EVENT, ORIGINAL_ORDER),
        candidate(FRESH_EVENT, FRESH_ORDER),
      ],
    });
    loadC01SourceEvidence.mockImplementation((id: string) =>
      Promise.resolve(
        id === FRESH_EVENT ? evidence(FRESH_EVENT, FRESH_ORDER, 1) : null,
      ),
    );

    expect(await resolveFreshC01Source(originalRun)).toEqual({
      webhookEventId: FRESH_EVENT,
      orderId: FRESH_ORDER,
    });
  });

  it("4: a DIFFERENT event on the SAME contaminated order is still refused", async () => {
    // Excluding only the event id would let this through, and it carries the
    // same poisoned fulfilment count.
    listEligibleSources.mockResolvedValue({
      kind: "WEBHOOK_SOURCES",
      candidates: [candidate("second-event-same-order", ORIGINAL_ORDER)],
    });
    loadC01SourceEvidence.mockResolvedValue(
      evidence("second-event-same-order", ORIGINAL_ORDER, 3),
    );

    expect(await resolveFreshC01Source(originalRun)).toBeNull();
    // Refused structurally, before the loader is even consulted.
    expect(loadC01SourceEvidence).not.toHaveBeenCalled();
  });

  it("5: the PRECHECK-08 baseline is applied when choosing, not after", async () => {
    // A fresh order that is not PAID-with-exactly-one-fulfilment must not be
    // offered, or the run would be created and then immediately BLOCKED —
    // which is precisely the production failure.
    for (const [fulfilments, status] of [
      [0, "PAID"],
      [2, "PAID"],
      [1, "UNPAID"],
      [1, "FAILED_OBSERVED"],
    ] as const) {
      vi.clearAllMocks();
      listEligibleSources.mockResolvedValue({
        kind: "WEBHOOK_SOURCES",
        candidates: [candidate(FRESH_EVENT, FRESH_ORDER)],
      });
      loadC01SourceEvidence.mockResolvedValue(
        evidence(FRESH_EVENT, FRESH_ORDER, fulfilments, status),
      );

      expect(
        await resolveFreshC01Source(originalRun),
        `${status}/${fulfilments}`,
      ).toBeNull();
    }
  });

  it("6: the subject is server-derived — no caller input is accepted", () => {
    // The resolver's only parameter is the ORIGINAL run, read from the
    // database. There is no webhook id, order id or any other selector a
    // browser could supply to nominate the evidence its own re-test is
    // judged on.
    expect(resolveFreshC01Source.length).toBe(1);

    const source = code("lib/regression/fresh-source.ts");
    expect(source).toContain("listEligibleSources");
    expect(source).toContain("loadC01SourceEvidence");
  });
});

describe("C01 fresh subject — nothing historical is deleted or rewritten", () => {
  const FRESH = code("lib/regression/fresh-source.ts");

  it("7: the resolver performs no write of any kind", async () => {
    for (const forbidden of [
      ".insert(",
      ".update(",
      ".upsert(",
      ".delete(",
      ".rpc(",
    ]) {
      expect(FRESH, forbidden).not.toContain(forbidden);
    }
  });

  it("8: no fulfilment, invariant result or finding is ever mutated", () => {
    for (const forbidden of [
      "fulfilments",
      "invariant_results",
      "findings",
      "idempotency_key",
    ]) {
      expect(FRESH, forbidden).not.toContain(forbidden);
    }
  });

  it("9: INV-002 keeps its total-count rule — no delta variant was added", () => {
    // The forbidden shortcut: re-scoping the invariant so the contaminated
    // subject could pass. The evaluator must be untouched.
    //
    // NARROWED after this assertion was written too broadly. It first banned
    // the word "delta" from the whole evaluators module, which failed on C03's
    // own user-facing prose ("regardless of any state delta") — a sentence
    // about a different invariant entirely. Banning a word from a 2,000-line
    // file matches vocabulary, not behaviour, and would have pushed a future
    // author to describe C03 less clearly to keep this green.
    const evaluators = code("lib/invariants/evaluators.ts");
    const start = evaluators.indexOf("export function evaluateInv002");
    expect(start).toBeGreaterThan(-1);
    const body = evaluators.slice(start, start + 3000);

    // The rule itself, stated as the operator sees it.
    expect(body).toContain(
      "FULFIL_ORDER fulfilments per correlated payment <= 1",
    );
    // And it still counts EVERY persisted fulfilment for the payment, rather
    // than only those created after some cut-off.
    expect(body).toContain("countFulfilOrderForPayment");
    for (const forbidden of [
      "sinceRegression",
      "newFulfilmentsOnly",
      "regressionOnly",
      "afterTimestamp",
    ]) {
      expect(body, forbidden).not.toContain(forbidden);
    }
  });

  it("10: PRECHECK-08 is unchanged and still demands a clean baseline", () => {
    const gate = code("lib/chaos/safety-gate.ts");
    expect(gate).toContain('evidence.baseline.paymentStatus === "PAID"');
    expect(gate).toContain("evidence.baseline.fulfilmentCount === 1");
  });
});

describe("C01 fresh subject — the scenario and provenance are unchanged", () => {
  const SERVICE = code("lib/regression/service.ts");

  it("11: REG-002 holds — the regression run is still scenario C01", () => {
    // Same scenario, same mechanism, same fault type. Only the subject is new.
    expect(SERVICE).toMatch(
      /scenarioId: "C01",\s*mechanism: "B",\s*faultType: "REPLAY_EVENT",\s*sourceWebhookEventId: fresh\.webhookEventId,/,
    );
  });

  it("12: the fresh source is still revalidated through the frozen gate", () => {
    // Being server-chosen is not a reason to skip the check every
    // operator-chosen source faces.
    // Whitespace-tolerant: the formatter is free to wrap this call, and an
    // exact-string match would fail on a reflow that changed no behaviour.
    expect(SERVICE).toMatch(
      /revalidateEligibility\(\s*\{\s*scenarioId:\s*"C01"\s*\},\s*fresh\.webhookEventId,?\s*\)/,
    );
  });

  it("13: replay provenance is untouched — still PAYCHAOS_REPLAY", () => {
    // The regression uses the same frozen replay service, which is the only
    // thing that writes a PAYCHAOS_REPLAY attempt.
    expect(SERVICE).toContain("executeC01Replay");
    const replay = code("lib/chaos/replay-repository.ts");
    expect(replay).toContain("PAYCHAOS_REPLAY");
  });

  it("14: no synthetic row is ever labelled REAL_RAZORPAY_WEBHOOK here", () => {
    const fresh = code("lib/regression/fresh-source.ts");
    expect(fresh).not.toContain("REAL_RAZORPAY_WEBHOOK");
  });

  it("15: C03, C07 and C11 branches are untouched by this change", () => {
    // C03 stays subject-free; C07 still requires a caller-supplied fresh
    // order; C11 still resolves its own path. Only C01 gained a resolver.
    expect(SERVICE).toContain('reason: "FRESH_ORDER_REQUIRED"');
    expect(SERVICE).toContain('reason: "FRESH_ORDER_REUSE_FORBIDDEN"');
    expect(SERVICE).toContain('scenarioId: "C03"');
    // The fresh-source resolver is consulted for C01 alone.
    const calls = [...SERVICE.matchAll(/resolveFreshC01Source\(/g)];
    expect(calls).toHaveLength(1);
  });
});

describe("C01 fresh subject — the awaiting state is honest", () => {
  const TYPES = code("lib/regression/types.ts");
  const ROUTE = code("app/api/findings/[findingId]/regressions/route.ts");
  const UI = code("components/findings/regression-action.tsx");

  it("16: the continuation vocabulary gained exactly one value", () => {
    expect(TYPES).toContain('"C01_TEST_MODE_FRESH_CAPTURE"');
    expect(TYPES).toContain('"C07_TEST_MODE_CHECKOUT"');
    expect(TYPES).toContain('"C11_A_TEST_MODE_FAILED_PAYMENT"');
  });

  it("17: the awaiting result carries no attempt, because none exists", () => {
    // Claiming a RegressionAttemptRef would be inventing a persisted row.
    const start = TYPES.indexOf('kind: "AWAITING_EXTERNAL_PREREQUISITE"');
    expect(start).toBeGreaterThan(-1);
    const block = TYPES.slice(start, start + 320);
    expect(block).toContain("findingId");
    expect(block).toContain("continuation");
    expect(block).not.toContain("attempt");
  });

  it("18: the route answers 200, not an error status", () => {
    const start = ROUTE.indexOf(
      'result.kind === "AWAITING_EXTERNAL_PREREQUISITE"',
    );
    expect(start).toBeGreaterThan(-1);
    const block = ROUTE.slice(start, start + 900);
    expect(block).toContain("status: 200");
    expect(block).not.toContain("status: 409");
    expect(block).not.toContain("status: 500");
  });

  it("19: the UI tells the operator what to actually do", () => {
    expect(UI).toContain("C01_TEST_MODE_FRESH_CAPTURE");
    expect(UI).toContain("Safe Idempotency Profile");
    // And says plainly that the original failure is preserved.
    expect(UI.toLowerCase()).toContain("preserved");
  });

  it("20: the UI never presents the awaiting state as a pass", () => {
    const start = UI.indexOf("AWAITING_EXTERNAL_PREREQUISITE:");
    expect(start).toBeGreaterThan(-1);
    const message = UI.slice(start, start + 260).toLowerCase();
    for (const forbidden of ["resolved", "passed", "verified", "complete."]) {
      expect(message, forbidden).not.toContain(forbidden);
    }
  });
});
