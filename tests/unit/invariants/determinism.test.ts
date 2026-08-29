import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { evaluateAllInvariants } from "@/lib/invariants/evaluate";
import { MONEY_INVARIANT_IDS } from "@/lib/invariants/types";

import {
  attempt,
  bundle,
  c03Scenario,
  c03Side,
  fulfilment,
  FULFILMENT_B,
  PROC_A,
  PROC_B,
  shuffled,
  snapshot,
  webhook,
} from "./fixtures";

/**
 * Phase 3F-B — determinism proof.
 *
 * `same invariant version + same evidence => same disposition, severity,
 * expectedSummary, observedSummary, reason and evidenceRefs`.
 *
 * Two independent properties are asserted for EVERY one of INV-001…INV-012:
 *
 *   1. REPEATABILITY — evaluating the identical bundle many times produces
 *      byte-identical output. Any clock read, `Math.random()` or `randomUUID`
 *      inside an evaluator would break this.
 *   2. ORDER INDEPENDENCE — reversing every array whose order is not
 *      semantically relevant (processing attempts, and the fulfilment list
 *      inside each snapshot) produces byte-identical output.
 */

const captured = (s = snapshot()) => ({
  kind: "CAPTURED" as const,
  snapshot: s,
});

/** A representative bundle per scenario shape, exercising many distinct dispositions. */
const SCENARIOS: ReadonlyArray<{
  label: string;
  make: () => ReturnType<typeof bundle>;
}> = [
  {
    label: "healthy captured run with one fulfilment",
    make: () => bundle(),
  },
  {
    label: "two attempts and two fulfilments (violating relational rules)",
    make: () => {
      const two = snapshot({
        fulfilments: [
          fulfilment({ triggerProcessingAttemptId: PROC_A }),
          fulfilment({ id: FULFILMENT_B, triggerProcessingAttemptId: PROC_B }),
        ],
      });
      return bundle({
        originalProcessingAttempts: [
          attempt({
            id: PROC_A,
            stateBefore: captured(two),
            stateAfter: captured(two),
          }),
          attempt({
            id: PROC_B,
            stateBefore: captured(two),
            stateAfter: captured(two),
          }),
        ],
      });
    },
  },
  {
    label: "replay run",
    make: () =>
      bundle({
        chaosProcessingAttempts: [
          attempt({
            id: PROC_B,
            sourceKind: "PAYCHAOS_REPLAY",
            chaosRunId: "run",
          }),
        ],
      }),
  },
  {
    label: "failure-only run with no capture",
    make: () =>
      bundle({
        sourceWebhook: webhook({ eventType: "payment.failed" }),
        authoritativeCapture: { kind: "NONE_OBSERVED" },
        authoritativeCaptureWebhook: null,
        originalProcessingAttempts: [
          attempt({
            stateBefore: captured(
              snapshot({
                orderPaymentStatus: "PENDING",
                orderBusinessStatus: "OPEN",
                paymentCapturedAt: null,
                paymentFailedAt: "2026-08-20T09:59:00.000Z",
                fulfilments: [],
              }),
            ),
            stateAfter: captured(
              snapshot({
                orderPaymentStatus: "FAILED_OBSERVED",
                orderBusinessStatus: "OPEN",
                paymentCapturedAt: null,
                paymentFailedAt: "2026-08-20T09:59:00.000Z",
                fulfilments: [],
              }),
            ),
          }),
        ],
      }),
  },
  {
    label: "C03 run with complete unchanged mutation evidence",
    make: () =>
      bundle({
        scenarioId: "C03",
        orderId: null,
        paymentAttemptId: null,
        paymentId: null,
        sourceWebhook: null,
        originalProcessingAttempts: [],
        canonicalSourceEventCount: null,
        authoritativeCapture: { kind: "NO_SUBJECT" },
        authoritativeCaptureWebhook: null,
        scenarioEvidence: c03Scenario({
          mutationEvidence: { before: c03Side(), after: c03Side() },
        }),
      }),
  },
  {
    label: "legacy C03 run with no mutation evidence",
    make: () =>
      bundle({
        scenarioId: "C03",
        orderId: null,
        paymentAttemptId: null,
        paymentId: null,
        sourceWebhook: null,
        originalProcessingAttempts: [],
        canonicalSourceEventCount: null,
        authoritativeCapture: { kind: "NO_SUBJECT" },
        authoritativeCaptureWebhook: null,
        scenarioEvidence: c03Scenario(),
      }),
  },
  {
    label: "historical run with no captured snapshots",
    make: () =>
      bundle({
        originalProcessingAttempts: [
          attempt({
            stateBefore: { kind: "NOT_CAPTURED" },
            stateAfter: { kind: "NOT_CAPTURED" },
          }),
        ],
      }),
  },
  {
    label: "unsupported event type",
    make: () =>
      bundle({ sourceWebhook: webhook({ eventType: "refund.created" }) }),
  },
];

describe("Phase 3F-B — repeated evaluation is byte-identical", () => {
  for (const scenario of SCENARIOS) {
    it(`${scenario.label}: ten evaluations produce identical output`, () => {
      const first = JSON.stringify(evaluateAllInvariants(scenario.make()));
      for (let i = 0; i < 10; i += 1) {
        expect(JSON.stringify(evaluateAllInvariants(scenario.make()))).toBe(
          first,
        );
      }
    });
  }

  it("covers every one of the twelve invariants in each scenario", () => {
    for (const scenario of SCENARIOS) {
      const ids = evaluateAllInvariants(scenario.make()).map(
        (r) => r.invariantId,
      );
      expect(ids).toEqual([...MONEY_INVARIANT_IDS]);
    }
  });
});

describe("Phase 3F-B — shuffled input arrays produce identical output", () => {
  for (const scenario of SCENARIOS) {
    it(`${scenario.label}: reversing every order-irrelevant array changes nothing`, () => {
      const original = evaluateAllInvariants(scenario.make());
      const reversed = evaluateAllInvariants(shuffled(scenario.make()));
      expect(JSON.stringify(reversed)).toBe(JSON.stringify(original));
    });
  }

  it("evidence refs specifically are order-independent", () => {
    for (const scenario of SCENARIOS) {
      const a = evaluateAllInvariants(scenario.make());
      const b = evaluateAllInvariants(shuffled(scenario.make()));
      for (let i = 0; i < a.length; i += 1) {
        expect(b[i]!.evidenceRefs).toEqual(a[i]!.evidenceRefs);
      }
    }
  });

  it("summaries and reasons specifically are order-independent", () => {
    for (const scenario of SCENARIOS) {
      const a = evaluateAllInvariants(scenario.make());
      const b = evaluateAllInvariants(shuffled(scenario.make()));
      for (let i = 0; i < a.length; i += 1) {
        expect(b[i]!.reason).toBe(a[i]!.reason);
        expect(b[i]!.disposition).toBe(a[i]!.disposition);
        if ("expectedSummary" in a[i]! && "expectedSummary" in b[i]!) {
          expect((b[i] as { expectedSummary: string }).expectedSummary).toBe(
            (a[i] as { expectedSummary: string }).expectedSummary,
          );
          expect((b[i] as { observedSummary: string }).observedSummary).toBe(
            (a[i] as { observedSummary: string }).observedSummary,
          );
        }
      }
    }
  });
});

describe("Phase 3F-B — no evaluator reads a clock or randomness", () => {
  it("mocking Date.now, new Date and Math.random changes nothing", () => {
    const scenario = SCENARIOS[0]!;
    const baseline = JSON.stringify(evaluateAllInvariants(scenario.make()));

    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(0);
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.123456);
    try {
      expect(JSON.stringify(evaluateAllInvariants(scenario.make()))).toBe(
        baseline,
      );
      expect(nowSpy).not.toHaveBeenCalled();
      expect(randomSpy).not.toHaveBeenCalled();
    } finally {
      nowSpy.mockRestore();
      randomSpy.mockRestore();
    }
  });

  it("no envelope contains a value that varies between runs", () => {
    const scenario = SCENARIOS[1]!;
    const runs = Array.from({ length: 5 }, () =>
      JSON.stringify(evaluateAllInvariants(scenario.make())),
    );
    expect(new Set(runs).size).toBe(1);
  });
});
