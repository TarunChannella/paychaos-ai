import { describe, expect, it, vi } from "vitest";

/**
 * Phase 3E-B — the PURE deterministic evidence-assembly domain
 * (`lib/evidence/chaos-run-evidence.ts`).
 *
 * No Supabase, no network, no mocks of the module under test — every test
 * here feeds already-read raw rows straight into the builder, which is the
 * whole point of separating the pure domain from the repository.
 *
 * These tests deliberately assert FACTS ONLY. Nothing here expects a `PASS`,
 * `FAIL`, `UNKNOWN`, `NOT_APPLICABLE` or `ERROR` money verdict, because
 * Phase 3E-B assigns none — that is Phase 3F's job.
 */
vi.mock("server-only", () => ({}));

import {
  C01_EXPECTED_REPLAY_ATTEMPT_COUNT,
  C11A_EXPECTED_REPLAY_ATTEMPT_COUNT,
  C11B_EXPECTED_REPLAY_ATTEMPT_COUNT,
  CHAOS_RUN_EVIDENCE_BUNDLE_VERSION,
  buildChaosRunEvidenceBundle,
  compareEvidenceGaps,
  compareEvidenceRefs,
  dedupeAndSortEvidenceGaps,
  dedupeAndSortEvidenceRefs,
  isC03MutationEvidenceComplete,
  parseC03MutationEvidence,
  parseC03VerificationChecks,
  parseC07FaultStateEvidence,
  parseMerchantStateSnapshotV1,
  resolveAuthoritativeCaptureEvidence,
  resolveAuthoritativeOriginalProcessingAttempt,
  type ChaosRunEvidenceBundleV1,
  type ChaosRunEvidenceSource,
  type EvidenceGapCode,
  type RawChaosRunEvidenceRow,
  type RawProcessingAttemptEvidenceRow,
  type RawWebhookEvidenceRow,
} from "@/lib/evidence/chaos-run-evidence";

// ---------------------------------------------------------------------------
// Fixed synthetic identifiers. Chosen so that natural sort order and
// insertion order deliberately DISAGREE, which is what makes the determinism
// assertions meaningful.
// ---------------------------------------------------------------------------
const RUN_ID = "10000000-0000-4000-8000-000000000001";
const ORDER_ID = "20000000-0000-4000-8000-000000000002";
const PAYMENT_ATTEMPT_ID = "30000000-0000-4000-8000-000000000003";
const PAYMENT_ID = "40000000-0000-4000-8000-000000000004";
const WEBHOOK_ID = "50000000-0000-4000-8000-000000000005";
const ORIGINAL_ATTEMPT_ID = "60000000-0000-4000-8000-000000000006";
const REPLAY_ATTEMPT_A_ID = "70000000-0000-4000-8000-00000000000a";
const REPLAY_ATTEMPT_B_ID = "70000000-0000-4000-8000-00000000000b";
const FULFILMENT_ID = "80000000-0000-4000-8000-000000000008";

function validSnapshot(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    version: 1,
    order: {
      id: ORDER_ID,
      paymentStatus: "PAID",
      businessStatus: "FULFILLED",
      amountSubunits: 75_000,
      currency: "INR",
    },
    paymentAttempt: {
      id: PAYMENT_ATTEMPT_ID,
      orderId: ORDER_ID,
      status: "CAPTURED",
      amountSubunits: 75_000,
      currency: "INR",
      razorpayOrderId: "order_synthetic",
      razorpayOrderStatus: "paid",
    },
    payment: {
      id: PAYMENT_ID,
      paymentAttemptId: PAYMENT_ATTEMPT_ID,
      razorpayPaymentId: "pay_synthetic",
      razorpayPaymentStatus: "captured",
      amountSubunits: 75_000,
      currency: "INR",
      checkoutSignatureVerified: true,
      capturedAt: "2026-08-01T00:00:00.000Z",
      failedAt: null,
    },
    fulfilments: [
      {
        id: FULFILMENT_ID,
        orderId: ORDER_ID,
        paymentId: PAYMENT_ID,
        triggerProcessingAttemptId: ORIGINAL_ATTEMPT_ID,
        effectType: "FULFIL_ORDER",
        appliedAt: "2026-08-01T00:00:01.000Z",
      },
    ],
    ...overrides,
  };
}

function runRow(
  overrides: Partial<RawChaosRunEvidenceRow> = {},
): RawChaosRunEvidenceRow {
  return {
    id: RUN_ID,
    scenario_id: "C01",
    status: "COMPLETED",
    outcome: "UNKNOWN",
    fault_type: "REPLAY_EVENT",
    data_classification: "RECORDED_TEST_EVIDENCE",
    order_id: ORDER_ID,
    payment_attempt_id: PAYMENT_ATTEMPT_ID,
    payment_id: PAYMENT_ID,
    source_webhook_event_id: WEBHOOK_ID,
    failed_precheck_id: null,
    execution_block_code: null,
    fault_state: {},
    started_at: "2026-08-01T00:00:00.000Z",
    completed_at: "2026-08-01T00:00:05.000Z",
    ...overrides,
  };
}

/** Matches the `razorpayPaymentId` inside `validSnapshot()`, so the trusted provider identity is self-consistent across the fixture. */
const RAZORPAY_PAYMENT_ID = "pay_synthetic";

function webhookRow(
  overrides: Partial<RawWebhookEvidenceRow> = {},
): RawWebhookEvidenceRow {
  return {
    id: WEBHOOK_ID,
    razorpay_event_id: "evt_synthetic",
    event_type: "payment.captured",
    source_kind: "REAL_RAZORPAY_WEBHOOK",
    signature_verified: true,
    processing_status: "PROCESSED",
    duplicate_delivery_count: 0,
    received_at: "2026-07-31T23:59:00.000Z",
    payment_attempt_id: PAYMENT_ATTEMPT_ID,
    payment_id: PAYMENT_ID,
    razorpay_payment_id: RAZORPAY_PAYMENT_ID,
    amount_subunits: 75_000,
    currency: "INR",
    ...overrides,
  };
}

type CaptureSearchInputs = Pick<
  ChaosRunEvidenceSource,
  | "captureSubjectRazorpayPaymentId"
  | "captureSubjectInternalPaymentIds"
  | "captureProviderSearchPerformed"
  | "captureCandidates"
>;

/**
 * The default capture-search inputs for a run that HAS a payment: an exact
 * trusted provider identity, the provider dimension actually searched, and
 * zero candidates. That resolves to `NONE_OBSERVED` — a complete, valid
 * negative search fact that emits no gap.
 */
function captureSearchDefaults(): CaptureSearchInputs {
  return {
    captureSubjectRazorpayPaymentId: RAZORPAY_PAYMENT_ID,
    captureSubjectInternalPaymentIds: [PAYMENT_ID],
    captureProviderSearchPerformed: true,
    captureCandidates: [],
  };
}

/** A run with no payment correlation at all (C03 by design; a BLOCKED run that never executed). */
function noCaptureSubject(): CaptureSearchInputs {
  return {
    captureSubjectRazorpayPaymentId: null,
    captureSubjectInternalPaymentIds: [],
    captureProviderSearchPerformed: false,
    captureCandidates: [],
  };
}

function attemptRow(
  overrides: Partial<RawProcessingAttemptEvidenceRow> = {},
): RawProcessingAttemptEvidenceRow {
  return {
    id: ORIGINAL_ATTEMPT_ID,
    webhook_event_id: WEBHOOK_ID,
    chaos_run_id: null,
    source_kind: "REAL_RAZORPAY_WEBHOOK",
    status: "SUCCEEDED",
    is_duplicate_delivery: false,
    payment_attempt_id: PAYMENT_ATTEMPT_ID,
    payment_id: PAYMENT_ID,
    error_code: null,
    started_at: "2026-08-01T00:00:00.000Z",
    finished_at: "2026-08-01T00:00:00.500Z",
    state_before: validSnapshot(),
    state_after: validSnapshot(),
    ...overrides,
  };
}

function replayRow(
  id: string,
  overrides: Partial<RawProcessingAttemptEvidenceRow> = {},
): RawProcessingAttemptEvidenceRow {
  return attemptRow({
    id,
    chaos_run_id: RUN_ID,
    source_kind: "PAYCHAOS_REPLAY",
    started_at: "2026-08-01T00:00:02.000Z",
    finished_at: "2026-08-01T00:00:02.500Z",
    ...overrides,
  });
}

function healthyC01Source(
  overrides: Partial<ChaosRunEvidenceSource> = {},
): ChaosRunEvidenceSource {
  return {
    run: runRow(),
    sourceWebhook: webhookRow(),
    originalProcessingAttempts: [attemptRow()],
    chaosProcessingAttempts: [
      replayRow(REPLAY_ATTEMPT_A_ID),
      replayRow(REPLAY_ATTEMPT_B_ID),
    ],
    canonicalSourceEventCount: 1,
    ...captureSearchDefaults(),
    ...overrides,
  };
}

function gapCodes(bundle: ChaosRunEvidenceBundleV1): EvidenceGapCode[] {
  return bundle.gaps.map((gap) => gap.code);
}

// ===========================================================================
// 1. Snapshot runtime validation
// ===========================================================================

describe("parseMerchantStateSnapshotV1", () => {
  it("1: NULL stays NOT_CAPTURED and is never reconstructed", () => {
    expect(parseMerchantStateSnapshotV1(null)).toEqual({
      kind: "NOT_CAPTURED",
    });
    expect(parseMerchantStateSnapshotV1(undefined)).toEqual({
      kind: "NOT_CAPTURED",
    });
  });

  it("2: a valid V1 snapshot parses", () => {
    const parsed = parseMerchantStateSnapshotV1(validSnapshot());
    expect(parsed.kind).toBe("CAPTURED");
    if (parsed.kind !== "CAPTURED") throw new Error("unreachable");
    expect(parsed.snapshot.version).toBe(1);
    expect(parsed.snapshot.order?.id).toBe(ORDER_ID);
    expect(parsed.snapshot.paymentAttempt?.amountSubunits).toBe(75_000);
    expect(parsed.snapshot.payment?.checkoutSignatureVerified).toBe(true);
    expect(parsed.snapshot.fulfilments).toHaveLength(1);
  });

  it("3: a wrong version is INVALID, never silently accepted", () => {
    expect(parseMerchantStateSnapshotV1(validSnapshot({ version: 2 }))).toEqual(
      { kind: "INVALID" },
    );
    expect(
      parseMerchantStateSnapshotV1(validSnapshot({ version: "1" })),
    ).toEqual({ kind: "INVALID" });
    const noVersion = validSnapshot();
    delete noVersion.version;
    expect(parseMerchantStateSnapshotV1(noVersion)).toEqual({
      kind: "INVALID",
    });
  });

  it("4: a scalar, an array or a non-object is INVALID", () => {
    for (const value of [42, "snapshot", true, [1, 2, 3], []]) {
      expect(parseMerchantStateSnapshotV1(value)).toEqual({ kind: "INVALID" });
    }
  });

  it("5: a missing required top-level key is INVALID", () => {
    for (const key of ["order", "paymentAttempt", "payment", "fulfilments"]) {
      const snapshot = validSnapshot();
      delete snapshot[key];
      expect(parseMerchantStateSnapshotV1(snapshot)).toEqual({
        kind: "INVALID",
      });
    }
  });

  it("6: a malformed nested field is INVALID", () => {
    expect(
      parseMerchantStateSnapshotV1(
        validSnapshot({ order: { id: 7, paymentStatus: "PAID" } }),
      ),
    ).toEqual({ kind: "INVALID" });
    expect(
      parseMerchantStateSnapshotV1(
        validSnapshot({
          payment: {
            ...(validSnapshot().payment as Record<string, unknown>),
            checkoutSignatureVerified: "true",
          },
        }),
      ),
    ).toEqual({ kind: "INVALID" });
    expect(
      parseMerchantStateSnapshotV1(
        validSnapshot({ fulfilments: [{ id: FULFILMENT_ID }] }),
      ),
    ).toEqual({ kind: "INVALID" });
    expect(
      parseMerchantStateSnapshotV1(validSnapshot({ fulfilments: "none" })),
    ).toEqual({ kind: "INVALID" });
  });

  it("7: a non-integer money amount is INVALID — money is integer subunits only", () => {
    expect(
      parseMerchantStateSnapshotV1(
        validSnapshot({
          order: {
            ...(validSnapshot().order as Record<string, unknown>),
            amountSubunits: 750.5,
          },
        }),
      ),
    ).toEqual({ kind: "INVALID" });
  });

  it("8: nullable entities stay null, and `fulfilments: null` stays distinct from `[]`", () => {
    const allNull = parseMerchantStateSnapshotV1({
      version: 1,
      order: null,
      paymentAttempt: null,
      payment: null,
      fulfilments: null,
    });
    expect(allNull).toEqual({
      kind: "CAPTURED",
      snapshot: {
        version: 1,
        order: null,
        paymentAttempt: null,
        payment: null,
        fulfilments: null,
      },
    });

    // `[]` is a POSITIVE observation of zero fulfilments, so it is only
    // meaningful when the owning order was actually resolved.
    const emptyArray = parseMerchantStateSnapshotV1(
      validSnapshot({ fulfilments: [] }),
    );
    expect(emptyArray.kind).toBe("CAPTURED");
    if (emptyArray.kind !== "CAPTURED") throw new Error("unreachable");
    expect(emptyArray.snapshot.fulfilments).toEqual([]);
    expect(emptyArray.snapshot.fulfilments).not.toBeNull();
  });

  /**
   * Architect correction, Blocker 1 — cross-field completeness. `order` and
   * `fulfilments` are not independent: NULL means NOT CAPTURED, `[]` means
   * positively observed zero rows, and Phase 3F must never receive a CAPTURED
   * snapshot that blurs the two.
   */
  it("8b (A): order present + fulfilments null is INVALID — a resolved order must carry an array", () => {
    expect(
      parseMerchantStateSnapshotV1(validSnapshot({ fulfilments: null })),
    ).toEqual({ kind: "INVALID" });
  });

  it("8c (B): order absent + fulfilments [] is INVALID — there is no order to claim zero fulfilments about", () => {
    expect(
      parseMerchantStateSnapshotV1({
        version: 1,
        order: null,
        paymentAttempt: null,
        payment: null,
        fulfilments: [],
      }),
    ).toEqual({ kind: "INVALID" });
  });

  it("8d (C): order absent + a non-empty fulfilment array is INVALID", () => {
    expect(
      parseMerchantStateSnapshotV1({
        version: 1,
        order: null,
        paymentAttempt: null,
        payment: null,
        fulfilments: [
          {
            id: FULFILMENT_ID,
            orderId: ORDER_ID,
            paymentId: PAYMENT_ID,
            triggerProcessingAttemptId: null,
            effectType: "FULFIL_ORDER",
            appliedAt: "2026-08-01T00:00:01.000Z",
          },
        ],
      }),
    ).toEqual({ kind: "INVALID" });
  });

  it("8e (D/E): order present + [] and order present + a valid array are both CAPTURED, and neither side is transformed", () => {
    const resolvedZero = parseMerchantStateSnapshotV1(
      validSnapshot({ fulfilments: [] }),
    );
    expect(resolvedZero.kind).toBe("CAPTURED");
    if (resolvedZero.kind !== "CAPTURED") throw new Error("unreachable");
    expect(resolvedZero.snapshot.fulfilments).toEqual([]);

    const resolvedOne = parseMerchantStateSnapshotV1(validSnapshot());
    expect(resolvedOne.kind).toBe("CAPTURED");
    if (resolvedOne.kind !== "CAPTURED") throw new Error("unreachable");
    expect(resolvedOne.snapshot.fulfilments).toHaveLength(1);

    // The parser never substitutes one representation for the other.
    const orderOnlyNull = parseMerchantStateSnapshotV1({
      version: 1,
      order: null,
      paymentAttempt: null,
      payment: null,
      fulfilments: null,
    });
    if (orderOnlyNull.kind !== "CAPTURED") throw new Error("unreachable");
    expect(orderOnlyNull.snapshot.fulfilments).toBeNull();
  });

  it("9: unknown fields never leak into the returned safe snapshot", () => {
    const polluted = validSnapshot({
      razorpaySignature: "should-never-appear",
      rawBody: { card: "4111111111111111", cvv: "123" },
      order: {
        ...(validSnapshot().order as Record<string, unknown>),
        customerEmail: "person@example.com",
      },
    });
    const parsed = parseMerchantStateSnapshotV1(polluted);
    expect(parsed.kind).toBe("CAPTURED");
    const serialized = JSON.stringify(parsed);
    expect(serialized).not.toContain("razorpaySignature");
    expect(serialized).not.toContain("should-never-appear");
    expect(serialized).not.toContain("4111111111111111");
    expect(serialized).not.toContain("customerEmail");
    expect(serialized).not.toContain("person@example.com");
  });

  it("10: fulfilments are re-sorted by id ascending regardless of the persisted array order", () => {
    const a = "aaaaaaaa-0000-4000-8000-00000000000a";
    const b = "bbbbbbbb-0000-4000-8000-00000000000b";
    const c = "cccccccc-0000-4000-8000-00000000000c";
    const entry = (id: string) => ({
      id,
      orderId: ORDER_ID,
      paymentId: PAYMENT_ID,
      triggerProcessingAttemptId: null,
      effectType: "FULFIL_ORDER",
      appliedAt: "2026-08-01T00:00:01.000Z",
    });

    const parsed = parseMerchantStateSnapshotV1(
      validSnapshot({ fulfilments: [entry(c), entry(a), entry(b)] }),
    );
    if (parsed.kind !== "CAPTURED") throw new Error("unreachable");
    expect(parsed.snapshot.fulfilments?.map((f) => f.id)).toEqual([a, b, c]);
  });

  it("11: never throws for any hostile input", () => {
    for (const value of [
      Symbol("x"),
      () => undefined,
      new Map(),
      NaN,
      Infinity,
    ]) {
      expect(() => parseMerchantStateSnapshotV1(value)).not.toThrow();
    }
  });
});

// ===========================================================================
// 2. Scenario fault_state validation
// ===========================================================================

describe("parseC03VerificationChecks", () => {
  it("12: parses exactly the frozen two-check shape and RETAINS the frozen order", () => {
    const parsed = parseC03VerificationChecks({
      checks: [
        { case: "WRONG_SIGNATURE", classification: "REJECTED" },
        { case: "MISSING_SIGNATURE", classification: "REJECTED" },
      ],
    });
    expect(parsed).toEqual([
      { case: "WRONG_SIGNATURE", classification: "REJECTED" },
      { case: "MISSING_SIGNATURE", classification: "REJECTED" },
    ]);
  });

  it("13: records UNEXPECTED_ACCEPTANCE as a fact, not an error", () => {
    const parsed = parseC03VerificationChecks({
      checks: [
        { case: "WRONG_SIGNATURE", classification: "UNEXPECTED_ACCEPTANCE" },
        { case: "MISSING_SIGNATURE", classification: "REJECTED" },
      ],
    });
    expect(parsed?.[0]?.classification).toBe("UNEXPECTED_ACCEPTANCE");
  });

  it("14: rejects a PENDING run's empty fault_state, extra keys, wrong order and bad literals", () => {
    expect(parseC03VerificationChecks({})).toBeNull();
    expect(parseC03VerificationChecks(null)).toBeNull();
    expect(parseC03VerificationChecks({ checks: [] })).toBeNull();
    expect(
      parseC03VerificationChecks({
        checks: [
          { case: "MISSING_SIGNATURE", classification: "REJECTED" },
          { case: "WRONG_SIGNATURE", classification: "REJECTED" },
        ],
      }),
    ).toBeNull();
    expect(
      parseC03VerificationChecks({
        checks: [
          { case: "WRONG_SIGNATURE", classification: "REJECTED" },
          { case: "MISSING_SIGNATURE", classification: "REJECTED" },
        ],
        extra: true,
      }),
    ).toBeNull();
    expect(
      parseC03VerificationChecks({
        checks: [
          { case: "WRONG_SIGNATURE", classification: "REJECTED", extra: 1 },
          { case: "MISSING_SIGNATURE", classification: "REJECTED" },
        ],
      }),
    ).toBeNull();
    expect(
      parseC03VerificationChecks({
        checks: [
          { case: "WRONG_SIGNATURE", classification: "MAYBE" },
          { case: "MISSING_SIGNATURE", classification: "REJECTED" },
        ],
      }),
    ).toBeNull();
  });
});

describe("parseC07FaultStateEvidence", () => {
  it("15: accepts exactly {armed:true, consumed:<boolean>} and nothing else", () => {
    expect(
      parseC07FaultStateEvidence({ armed: true, consumed: false }),
    ).toEqual({ armed: true, consumed: false });
    expect(parseC07FaultStateEvidence({ armed: true, consumed: true })).toEqual(
      {
        armed: true,
        consumed: true,
      },
    );
    expect(parseC07FaultStateEvidence({})).toBeNull();
    expect(parseC07FaultStateEvidence({ armed: false, consumed: true })).toBe(
      null,
    );
    expect(
      parseC07FaultStateEvidence({ armed: true, consumed: "true" }),
    ).toBeNull();
    expect(
      parseC07FaultStateEvidence({ armed: true, consumed: true, extra: 1 }),
    ).toBeNull();
    expect(parseC07FaultStateEvidence([])).toBeNull();
  });
});

// ===========================================================================
// 3. Deterministic ordering / deduplication
// ===========================================================================

describe("deterministic ordering and deduplication primitives", () => {
  it("16: evidence refs sort by kind then id, and duplicates collapse", () => {
    const refs = dedupeAndSortEvidenceRefs([
      { kind: "PAYMENT", id: "b" },
      { kind: "CHAOS_RUN", id: "z" },
      { kind: "PAYMENT", id: "a" },
      { kind: "PAYMENT", id: "b" },
      { kind: "CHAOS_RUN", id: "z" },
    ]);
    expect(refs).toEqual([
      { kind: "CHAOS_RUN", id: "z" },
      { kind: "PAYMENT", id: "a" },
      { kind: "PAYMENT", id: "b" },
    ]);
  });

  it("17: the ref comparator is a strict total order", () => {
    expect(
      compareEvidenceRefs(
        { kind: "ORDER", id: "a" },
        { kind: "ORDER", id: "a" },
      ),
    ).toBe(0);
    expect(
      compareEvidenceRefs(
        { kind: "CHAOS_RUN", id: "z" },
        { kind: "ORDER", id: "a" },
      ),
    ).toBeLessThan(0);
  });

  it("18: gaps sort by code then subjectId with a run-level null subject first, and duplicates collapse", () => {
    const gaps = dedupeAndSortEvidenceGaps([
      { code: "MISSING_STATE_AFTER", subjectId: "b" },
      { code: "MISSING_STATE_BEFORE", subjectId: "b" },
      { code: "MISSING_STATE_AFTER", subjectId: "a" },
      { code: "MISSING_STATE_AFTER", subjectId: null },
      { code: "MISSING_STATE_AFTER", subjectId: "a" },
    ]);
    expect(gaps).toEqual([
      { code: "MISSING_STATE_AFTER", subjectId: null },
      { code: "MISSING_STATE_AFTER", subjectId: "a" },
      { code: "MISSING_STATE_AFTER", subjectId: "b" },
      { code: "MISSING_STATE_BEFORE", subjectId: "b" },
    ]);
    expect(
      compareEvidenceGaps(
        { code: "RUN_NOT_COMPLETED", subjectId: null },
        { code: "RUN_NOT_COMPLETED", subjectId: null },
      ),
    ).toBe(0);
  });
});

// ===========================================================================
// 4. Bundle-level determinism and safety
// ===========================================================================

describe("buildChaosRunEvidenceBundle — determinism and safety", () => {
  it("19: the same raw facts produce a deep-equal bundle every time", () => {
    const first = buildChaosRunEvidenceBundle(healthyC01Source());
    const second = buildChaosRunEvidenceBundle(healthyC01Source());
    const third = buildChaosRunEvidenceBundle(healthyC01Source());
    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("20: shuffled processing-attempt input order produces the identical ordered output", () => {
    const ordered = buildChaosRunEvidenceBundle(healthyC01Source());
    const shuffled = buildChaosRunEvidenceBundle(
      healthyC01Source({
        chaosProcessingAttempts: [
          replayRow(REPLAY_ATTEMPT_B_ID),
          replayRow(REPLAY_ATTEMPT_A_ID),
        ],
      }),
    );
    expect(shuffled).toEqual(ordered);
    expect(shuffled.chaosProcessingAttempts.map((a) => a.id)).toEqual([
      REPLAY_ATTEMPT_A_ID,
      REPLAY_ATTEMPT_B_ID,
    ]);
  });

  it("21: attempts sharing a started_at are still totally ordered, by id ascending", () => {
    const sameInstant = "2026-08-01T00:00:02.000Z";
    const bundle = buildChaosRunEvidenceBundle(
      healthyC01Source({
        chaosProcessingAttempts: [
          replayRow(REPLAY_ATTEMPT_B_ID, { started_at: sameInstant }),
          replayRow(REPLAY_ATTEMPT_A_ID, { started_at: sameInstant }),
        ],
      }),
    );
    expect(bundle.chaosProcessingAttempts.map((a) => a.id)).toEqual([
      REPLAY_ATTEMPT_A_ID,
      REPLAY_ATTEMPT_B_ID,
    ]);
  });

  it("22: no current timestamp, no random id and no verdict field is injected anywhere", () => {
    const bundle = buildChaosRunEvidenceBundle(healthyC01Source());
    const serialized = JSON.stringify(bundle);
    for (const forbidden of [
      "assembledAt",
      "assembled_at",
      "generatedAt",
      "evaluatedAt",
      "verdict",
      "result",
      "PASS",
      "NOT_APPLICABLE",
      "confidence",
      "rootCause",
      "recommendation",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    // Every timestamp in the bundle is one that was already on a source row.
    const persistedTimestamps = [
      "2026-08-01T00:00:00.000Z",
      "2026-08-01T00:00:00.500Z",
      "2026-08-01T00:00:01.000Z",
      "2026-08-01T00:00:02.000Z",
      "2026-08-01T00:00:02.500Z",
      "2026-08-01T00:00:05.000Z",
      "2026-07-31T23:59:00.000Z",
    ];
    for (const match of serialized.match(/\d{4}-\d{2}-\d{2}T[^"]+/g) ?? []) {
      expect(persistedTimestamps).toContain(match);
    }
  });

  it("23: no secret, raw payload, signature or PII field reaches the bundle", () => {
    const bundle = buildChaosRunEvidenceBundle(healthyC01Source());
    const serialized = JSON.stringify(bundle);
    for (const forbidden of [
      "raw_payload_redacted",
      "rawPayload",
      "raw_body_sha256",
      "rawBodySha256",
      "razorpay_signature",
      "signatureValue",
      "x-razorpay-signature",
      "normalized_event",
      "normalizedEvent",
      "secret",
      "cvv",
      "email",
      "phone",
      "cardNumber",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("24: the bundle is versioned and names the scenario's frozen required invariants without evaluating them", () => {
    const bundle = buildChaosRunEvidenceBundle(healthyC01Source());
    expect(bundle.version).toBe(CHAOS_RUN_EVIDENCE_BUNDLE_VERSION);
    expect(bundle.version).toBe(1);
    expect(bundle.requiredInvariantIds).toEqual([
      "INV-001",
      "INV-002",
      "INV-006",
      "INV-007",
    ]);
    expect(bundle).not.toHaveProperty("invariantResults");
    expect(bundle).not.toHaveProperty("findings");
  });

  it("25: the safe run projection never exposes a generic fault_state or fault_config blob", () => {
    const bundle = buildChaosRunEvidenceBundle(
      healthyC01Source({
        run: runRow({ fault_state: { leaked: "must-not-appear" } }),
      }),
    );
    expect(bundle.run).not.toHaveProperty("faultState");
    expect(bundle.run).not.toHaveProperty("fault_state");
    expect(bundle.run).not.toHaveProperty("faultConfig");
    expect(JSON.stringify(bundle)).not.toContain("must-not-appear");
  });

  /**
   * The frozen execution modules are NOT imported here — importing
   * `lib/chaos/replay-service.ts` would load the merchant processor and the
   * Supabase client into a pure-domain test. Lockstep with
   * `C01_REPLAY_ATTEMPT_COUNT = 2` / `C11_REPLAY_ATTEMPT_COUNT = 1` is proven
   * statically instead, by `tests/unit/evidence/phase3e-b-static-guard.test.ts`.
   */
  it("26: the restated frozen replay counts are exactly 2 / 1 / 0", () => {
    expect(C01_EXPECTED_REPLAY_ATTEMPT_COUNT).toBe(2);
    expect(C11B_EXPECTED_REPLAY_ATTEMPT_COUNT).toBe(1);
    expect(C11A_EXPECTED_REPLAY_ATTEMPT_COUNT).toBe(0);
  });
});

// ===========================================================================
// 5. C01 — Duplicate Webhook Delivery
// ===========================================================================

describe("C01 evidence assembly", () => {
  it("27: a healthy C01 shape assembles source, original, both replays and snapshots with zero gaps", () => {
    const bundle = buildChaosRunEvidenceBundle(healthyC01Source());

    expect(bundle.sourceWebhook?.id).toBe(WEBHOOK_ID);
    expect(bundle.sourceWebhook?.sourceKind).toBe("REAL_RAZORPAY_WEBHOOK");
    expect(bundle.sourceWebhook?.signatureVerified).toBe(true);
    expect(bundle.originalProcessingAttempts).toHaveLength(1);
    expect(bundle.originalProcessingAttempts[0]?.sourceKind).toBe(
      "REAL_RAZORPAY_WEBHOOK",
    );
    expect(bundle.chaosProcessingAttempts).toHaveLength(2);
    for (const attempt of bundle.chaosProcessingAttempts) {
      expect(attempt.sourceKind).toBe("PAYCHAOS_REPLAY");
      expect(attempt.chaosRunId).toBe(RUN_ID);
      expect(attempt.stateBefore.kind).toBe("CAPTURED");
      expect(attempt.stateAfter.kind).toBe("CAPTURED");
    }
    expect(bundle.canonicalSourceEventCount).toBe(1);
    expect(bundle.scenarioEvidence).toEqual({
      scenarioId: "C01",
      expectedReplayAttemptCount: 2,
      observedReplayAttemptCount: 2,
      chaosLinkedProcessingAttemptCount: 2,
      originalProcessingAttemptCount: 1,
      authoritativeOriginalProcessingAttemptId: ORIGINAL_ATTEMPT_ID,
    });
    expect(bundle.gaps).toEqual([]);
  });

  it("28: evidence refs are deduplicated, deterministically sorted and carry only kind + UUID", () => {
    const bundle = buildChaosRunEvidenceBundle(healthyC01Source());
    expect(bundle.evidenceRefs).toEqual([
      { kind: "CHAOS_RUN", id: RUN_ID },
      { kind: "FULFILMENT", id: FULFILMENT_ID },
      { kind: "ORDER", id: ORDER_ID },
      { kind: "PAYMENT", id: PAYMENT_ID },
      { kind: "PAYMENT_ATTEMPT", id: PAYMENT_ATTEMPT_ID },
      { kind: "PROCESSING_ATTEMPT", id: ORIGINAL_ATTEMPT_ID },
      { kind: "PROCESSING_ATTEMPT", id: REPLAY_ATTEMPT_A_ID },
      { kind: "PROCESSING_ATTEMPT", id: REPLAY_ATTEMPT_B_ID },
      { kind: "WEBHOOK_EVENT", id: WEBHOOK_ID },
    ]);
    for (const ref of bundle.evidenceRefs) {
      expect(Object.keys(ref).sort()).toEqual(["id", "kind"]);
    }
  });

  it("29: a missing source webhook link becomes gaps, never a fabricated source", () => {
    const bundle = buildChaosRunEvidenceBundle(
      healthyC01Source({
        run: runRow({ source_webhook_event_id: null }),
        sourceWebhook: null,
        originalProcessingAttempts: [],
        canonicalSourceEventCount: null,
      }),
    );
    expect(bundle.sourceWebhook).toBeNull();
    expect(gapCodes(bundle)).toContain("MISSING_SOURCE_WEBHOOK_LINK");
    expect(gapCodes(bundle)).toContain("MISSING_CANONICAL_SOURCE_EVENT_COUNT");
    expect(gapCodes(bundle)).toContain(
      "MISSING_AUTHORITATIVE_ORIGINAL_PROCESSING_ATTEMPT",
    );
  });

  it("30: a linked-but-unresolvable source webhook is SOURCE_WEBHOOK_NOT_FOUND", () => {
    const bundle = buildChaosRunEvidenceBundle(
      healthyC01Source({
        sourceWebhook: null,
        canonicalSourceEventCount: null,
      }),
    );
    expect(bundle.gaps).toContainEqual({
      code: "SOURCE_WEBHOOK_NOT_FOUND",
      subjectId: WEBHOOK_ID,
    });
  });

  it("31: wrong source provenance and an unverified signature each become their own gap", () => {
    const bundle = buildChaosRunEvidenceBundle(
      healthyC01Source({
        sourceWebhook: webhookRow({
          source_kind: "PAYCHAOS_REPLAY",
          signature_verified: false,
        }),
      }),
    );
    expect(gapCodes(bundle)).toContain("SOURCE_PROVENANCE_MISMATCH");
    expect(gapCodes(bundle)).toContain("SOURCE_SIGNATURE_NOT_VERIFIED");
    // The provenance is REPORTED as persisted — never relabelled to look real.
    expect(bundle.sourceWebhook?.sourceKind).toBe("PAYCHAOS_REPLAY");
  });

  it("32: an unexpected source event type becomes a gap", () => {
    const bundle = buildChaosRunEvidenceBundle(
      healthyC01Source({
        sourceWebhook: webhookRow({ event_type: "payment.failed" }),
      }),
    );
    expect(gapCodes(bundle)).toContain("SOURCE_EVENT_TYPE_UNEXPECTED");
  });

  it("33: a missing or ambiguous AUTHORITATIVE original REAL processing attempt becomes a gap", () => {
    const missing = buildChaosRunEvidenceBundle(
      healthyC01Source({ originalProcessingAttempts: [] }),
    );
    expect(gapCodes(missing)).toContain(
      "MISSING_AUTHORITATIVE_ORIGINAL_PROCESSING_ATTEMPT",
    );

    const ambiguous = buildChaosRunEvidenceBundle(
      healthyC01Source({
        originalProcessingAttempts: [
          attemptRow(),
          attemptRow({ id: "60000000-0000-4000-8000-000000000007" }),
        ],
      }),
    );
    expect(gapCodes(ambiguous)).toContain(
      "AMBIGUOUS_AUTHORITATIVE_ORIGINAL_PROCESSING_ATTEMPT",
    );
  });

  it("34: a replay count of 0, 1 or 3 all become UNEXPECTED_CHAOS_PROCESSING_ATTEMPT_COUNT", () => {
    const counts: Record<number, RawProcessingAttemptEvidenceRow[]> = {
      0: [],
      1: [replayRow(REPLAY_ATTEMPT_A_ID)],
      3: [
        replayRow(REPLAY_ATTEMPT_A_ID),
        replayRow(REPLAY_ATTEMPT_B_ID),
        replayRow("70000000-0000-4000-8000-00000000000c"),
      ],
    };
    for (const [count, attempts] of Object.entries(counts)) {
      const bundle = buildChaosRunEvidenceBundle(
        healthyC01Source({ chaosProcessingAttempts: attempts }),
      );
      expect(gapCodes(bundle)).toContain(
        "UNEXPECTED_CHAOS_PROCESSING_ATTEMPT_COUNT",
      );
      expect(bundle.scenarioEvidence).toMatchObject({
        observedReplayAttemptCount: Number(count),
      });
    }
  });

  it("35: a chaos-linked attempt with non-replay provenance is an integrity gap and is never relabelled", () => {
    const bundle = buildChaosRunEvidenceBundle(
      healthyC01Source({
        chaosProcessingAttempts: [
          replayRow(REPLAY_ATTEMPT_A_ID),
          replayRow(REPLAY_ATTEMPT_B_ID, {
            source_kind: "REAL_RAZORPAY_WEBHOOK",
          }),
        ],
      }),
    );
    expect(bundle.gaps).toContainEqual({
      code: "PROCESSING_PROVENANCE_MISMATCH",
      subjectId: REPLAY_ATTEMPT_B_ID,
    });
    expect(gapCodes(bundle)).toContain(
      "UNEXPECTED_CHAOS_PROCESSING_ATTEMPT_COUNT",
    );
    const relabelled = bundle.chaosProcessingAttempts.find(
      (a) => a.id === REPLAY_ATTEMPT_B_ID,
    );
    expect(relabelled?.sourceKind).toBe("REAL_RAZORPAY_WEBHOOK");
  });

  it("36: a missing state_before/state_after becomes a per-attempt gap and is NEVER reconstructed", () => {
    const bundle = buildChaosRunEvidenceBundle(
      healthyC01Source({
        chaosProcessingAttempts: [
          replayRow(REPLAY_ATTEMPT_A_ID, { state_before: null }),
          replayRow(REPLAY_ATTEMPT_B_ID, { state_after: null }),
        ],
      }),
    );
    expect(bundle.gaps).toContainEqual({
      code: "MISSING_STATE_BEFORE",
      subjectId: REPLAY_ATTEMPT_A_ID,
    });
    expect(bundle.gaps).toContainEqual({
      code: "MISSING_STATE_AFTER",
      subjectId: REPLAY_ATTEMPT_B_ID,
    });
    const a = bundle.chaosProcessingAttempts.find(
      (x) => x.id === REPLAY_ATTEMPT_A_ID,
    );
    expect(a?.stateBefore).toEqual({ kind: "NOT_CAPTURED" });
    expect(a?.stateAfter.kind).toBe("CAPTURED");
  });

  it("37: an invalid persisted snapshot becomes INVALID_STATE_*, never a silent acceptance", () => {
    const bundle = buildChaosRunEvidenceBundle(
      healthyC01Source({
        chaosProcessingAttempts: [
          replayRow(REPLAY_ATTEMPT_A_ID, {
            state_before: { version: 99, order: null },
            state_after: "not-an-object",
          }),
          replayRow(REPLAY_ATTEMPT_B_ID),
        ],
      }),
    );
    expect(bundle.gaps).toContainEqual({
      code: "INVALID_STATE_BEFORE",
      subjectId: REPLAY_ATTEMPT_A_ID,
    });
    expect(bundle.gaps).toContainEqual({
      code: "INVALID_STATE_AFTER",
      subjectId: REPLAY_ATTEMPT_A_ID,
    });
    // An invalid snapshot contributes NO evidence references.
    const bad = bundle.chaosProcessingAttempts.find(
      (x) => x.id === REPLAY_ATTEMPT_A_ID,
    );
    expect(bad?.stateBefore).toEqual({ kind: "INVALID" });
  });

  it("38: a canonical source event count other than one is a gap — a replay must never become a new canonical event", () => {
    const bundle = buildChaosRunEvidenceBundle(
      healthyC01Source({ canonicalSourceEventCount: 2 }),
    );
    expect(bundle.gaps).toContainEqual({
      code: "UNEXPECTED_CANONICAL_SOURCE_EVENT_COUNT",
      subjectId: WEBHOOK_ID,
    });
  });

  it("39: a non-COMPLETED run is reported as such, without any verdict", () => {
    const bundle = buildChaosRunEvidenceBundle(
      healthyC01Source({
        run: runRow({ status: "RUNNING", outcome: null, completed_at: null }),
      }),
    );
    expect(gapCodes(bundle)).toContain("RUN_NOT_COMPLETED");
    expect(bundle.run.status).toBe("RUNNING");
    expect(bundle.run.outcome).toBeNull();
  });
});

// ===========================================================================
// 6. C03 — Invalid Webhook Signature (the special case)
// ===========================================================================

/** One complete, valid C03 mutation snapshot side, as persisted by `lib/chaos/c03-mutation-snapshot.ts`. */
function c03SnapshotJson(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    version: 1,
    orders: {
      count: 1,
      complete: true,
      rows: [
        {
          id: ORDER_ID,
          paymentStatus: "UNPAID",
          businessStatus: "OPEN",
          amountSubunits: 75_000,
          currency: "INR",
        },
      ],
    },
    paymentAttempts: { count: 0, complete: true, rows: [] },
    payments: { count: 0, complete: true, rows: [] },
    fulfilments: { count: 0, complete: true, rows: [] },
    trustedWebhookEvents: { count: 0, complete: true, ids: [] },
    ...overrides,
  };
}

/** The corrected `fault_state.mutationEvidence` envelope. */
function c03MutationEvidenceJson(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    version: 1,
    before: c03SnapshotJson(),
    after: c03SnapshotJson(),
    ...overrides,
  };
}

/** The VALIDATED shape `c03SnapshotJson()` parses into (no `version` field — the envelope version is validated, not re-exposed). */
function expectedParsedC03Snapshot() {
  return {
    orders: {
      count: 1,
      complete: true,
      rows: [
        {
          id: ORDER_ID,
          paymentStatus: "UNPAID",
          businessStatus: "OPEN",
          amountSubunits: 75_000,
          currency: "INR",
        },
      ],
    },
    paymentAttempts: { count: 0, complete: true, rows: [] },
    payments: { count: 0, complete: true, rows: [] },
    fulfilments: { count: 0, complete: true, rows: [] },
    trustedWebhookEvents: { count: 0, complete: true, ids: [] },
  };
}

/** The LEGACY `fault_state` shape — exactly what the already-approved historical C03 run carries. */
function c03LegacyFaultState(): Record<string, unknown> {
  return {
    checks: [
      { case: "WRONG_SIGNATURE", classification: "REJECTED" },
      { case: "MISSING_SIGNATURE", classification: "REJECTED" },
    ],
  };
}

function c03Source(
  overrides: Partial<ChaosRunEvidenceSource> = {},
): ChaosRunEvidenceSource {
  return {
    run: runRow({
      scenario_id: "C03",
      fault_type: "INVALID_SIGNATURE_TEST",
      data_classification: "SYNTHETIC_DEMO",
      order_id: null,
      payment_attempt_id: null,
      payment_id: null,
      source_webhook_event_id: null,
      fault_state: {
        ...c03LegacyFaultState(),
        mutationEvidence: c03MutationEvidenceJson(),
      },
    }),
    sourceWebhook: null,
    originalProcessingAttempts: [],
    chaosProcessingAttempts: [],
    canonicalSourceEventCount: null,
    ...noCaptureSubject(),
    ...overrides,
  };
}

describe("C03 evidence assembly", () => {
  it("40: a valid completed synthetic C03 shape assembles its verification facts with zero gaps", () => {
    const bundle = buildChaosRunEvidenceBundle(c03Source());
    expect(bundle.run.dataClassification).toBe("SYNTHETIC_DEMO");
    expect(bundle.run.faultType).toBe("INVALID_SIGNATURE_TEST");
    expect(bundle.scenarioEvidence).toEqual({
      scenarioId: "C03",
      verificationChecks: [
        { case: "WRONG_SIGNATURE", classification: "REJECTED" },
        { case: "MISSING_SIGNATURE", classification: "REJECTED" },
      ],
      sourceWebhookLinked: false,
      orderLinked: false,
      paymentAttemptLinked: false,
      paymentLinked: false,
      chaosLinkedProcessingAttemptCount: 0,
      mutationEvidence: {
        before: expectedParsedC03Snapshot(),
        after: expectedParsedC03Snapshot(),
      },
    });
    expect(bundle.gaps).toEqual([]);
    expect(bundle.requiredInvariantIds).toEqual(["INV-004", "INV-005"]);
  });

  it("41: the C03 bundle contains NO fabricated webhook, processing attempt or merchant snapshot", () => {
    const bundle = buildChaosRunEvidenceBundle(c03Source());
    expect(bundle.sourceWebhook).toBeNull();
    expect(bundle.originalProcessingAttempts).toEqual([]);
    expect(bundle.chaosProcessingAttempts).toEqual([]);
    expect(bundle.canonicalSourceEventCount).toBeNull();
    // No before/after merchant state is invented for a scenario that never
    // produced one.
    const serialized = JSON.stringify(bundle);
    expect(serialized).not.toContain("stateBefore");
    expect(serialized).not.toContain("stateAfter");
    expect(bundle.evidenceRefs).toEqual([{ kind: "CHAOS_RUN", id: RUN_ID }]);
  });

  it("42: C03 never emits source-webhook or original-attempt gaps — it legitimately has neither", () => {
    const codes = gapCodes(buildChaosRunEvidenceBundle(c03Source()));
    for (const forbidden of [
      "MISSING_SOURCE_WEBHOOK_LINK",
      "SOURCE_WEBHOOK_NOT_FOUND",
      "MISSING_CANONICAL_SOURCE_EVENT_COUNT",
      "SOURCE_PROCESSING_NOT_PROCESSED",
      "MISSING_AUTHORITATIVE_ORIGINAL_PROCESSING_ATTEMPT",
      "MISSING_ORDER_REFERENCE",
      "MISSING_PAYMENT_REFERENCE",
    ]) {
      expect(codes).not.toContain(forbidden);
    }
  });

  it("43: a malformed C03 fault_state becomes MISSING_C03_VERIFICATION_CHECKS with null checks", () => {
    const bundle = buildChaosRunEvidenceBundle(
      c03Source({ run: runRow({ ...c03Source().run, fault_state: {} }) }),
    );
    expect(gapCodes(bundle)).toContain("MISSING_C03_VERIFICATION_CHECKS");
    expect(bundle.scenarioEvidence).toMatchObject({
      verificationChecks: null,
    });
  });

  it("44: an UNEXPECTED_ACCEPTANCE stays factual evidence — it is NOT a gap and NOT an automatic failure", () => {
    const bundle = buildChaosRunEvidenceBundle(
      c03Source({
        run: runRow({
          ...c03Source().run,
          fault_state: {
            checks: [
              {
                case: "WRONG_SIGNATURE",
                classification: "UNEXPECTED_ACCEPTANCE",
              },
              { case: "MISSING_SIGNATURE", classification: "REJECTED" },
            ],
            mutationEvidence: c03MutationEvidenceJson(),
          },
        }),
      }),
    );
    expect(bundle.gaps).toEqual([]);
    expect(bundle.scenarioEvidence).toMatchObject({
      verificationChecks: [
        { case: "WRONG_SIGNATURE", classification: "UNEXPECTED_ACCEPTANCE" },
        { case: "MISSING_SIGNATURE", classification: "REJECTED" },
      ],
    });
    expect(JSON.stringify(bundle)).not.toContain("FAIL");
  });

  it("45: an unexpected chaos-linked processing attempt is an integrity gap", () => {
    const bundle = buildChaosRunEvidenceBundle(
      c03Source({ chaosProcessingAttempts: [replayRow(REPLAY_ATTEMPT_A_ID)] }),
    );
    expect(gapCodes(bundle)).toContain(
      "UNEXPECTED_CHAOS_PROCESSING_ATTEMPT_COUNT",
    );
    expect(bundle.scenarioEvidence).toMatchObject({
      chaosLinkedProcessingAttemptCount: 1,
    });
  });

  it("46: an unexpectedly non-null provider/merchant FK is an integrity gap", () => {
    for (const link of [
      { order_id: ORDER_ID },
      { payment_attempt_id: PAYMENT_ATTEMPT_ID },
      { payment_id: PAYMENT_ID },
      { source_webhook_event_id: WEBHOOK_ID },
    ]) {
      const bundle = buildChaosRunEvidenceBundle(
        c03Source({ run: runRow({ ...c03Source().run, ...link }) }),
      );
      expect(gapCodes(bundle)).toContain("UNEXPECTED_C03_PROVIDER_LINK");
    }
  });

  it("47: a wrong fault primitive on a C03 run is an integrity gap", () => {
    const bundle = buildChaosRunEvidenceBundle(
      c03Source({
        run: runRow({ ...c03Source().run, fault_type: "REPLAY_EVENT" }),
      }),
    );
    expect(gapCodes(bundle)).toContain("UNEXPECTED_FAULT_TYPE");
  });
});

// ===========================================================================
// 7. C07 — Payment Succeeds but Client Confirmation Is Lost
// ===========================================================================

function c07Source(
  overrides: Partial<ChaosRunEvidenceSource> = {},
): ChaosRunEvidenceSource {
  return {
    run: runRow({
      scenario_id: "C07",
      fault_type: "DROP_CLIENT_CONFIRMATION",
      fault_state: { armed: true, consumed: true },
    }),
    sourceWebhook: webhookRow(),
    originalProcessingAttempts: [attemptRow()],
    chaosProcessingAttempts: [],
    canonicalSourceEventCount: 1,
    ...captureSearchDefaults(),
    ...overrides,
  };
}

describe("C07 evidence assembly", () => {
  it("48: a completed armed+consumed C07 shape assembles with zero gaps and zero replays", () => {
    const bundle = buildChaosRunEvidenceBundle(c07Source());
    expect(bundle.scenarioEvidence).toEqual({
      scenarioId: "C07",
      faultArmed: true,
      faultConsumed: true,
      expectedReplayAttemptCount: 0,
      observedReplayAttemptCount: 0,
      chaosLinkedProcessingAttemptCount: 0,
      originalProcessingAttemptCount: 1,
      authoritativeOriginalProcessingAttemptId: ORIGINAL_ATTEMPT_ID,
    });
    expect(bundle.chaosProcessingAttempts).toEqual([]);
    expect(bundle.originalProcessingAttempts[0]?.sourceKind).toBe(
      "REAL_RAZORPAY_WEBHOOK",
    );
    expect(bundle.originalProcessingAttempts[0]?.stateBefore.kind).toBe(
      "CAPTURED",
    );
    expect(bundle.originalProcessingAttempts[0]?.stateAfter.kind).toBe(
      "CAPTURED",
    );
    expect(bundle.gaps).toEqual([]);
    expect(bundle.requiredInvariantIds).toEqual([
      "INV-002",
      "INV-004",
      "INV-011",
    ]);
  });

  it("49: an unconsumed or malformed fault state becomes its own gap", () => {
    const unconsumed = buildChaosRunEvidenceBundle(
      c07Source({
        run: runRow({
          ...c07Source().run,
          fault_state: { armed: true, consumed: false },
        }),
      }),
    );
    expect(gapCodes(unconsumed)).toContain("C07_FAULT_NOT_CONSUMED");
    expect(unconsumed.scenarioEvidence).toMatchObject({ faultConsumed: false });

    const malformed = buildChaosRunEvidenceBundle(
      c07Source({
        run: runRow({ ...c07Source().run, fault_state: { armed: true } }),
      }),
    );
    expect(gapCodes(malformed)).toContain("MISSING_C07_FAULT_STATE");
    expect(malformed.scenarioEvidence).toMatchObject({
      faultArmed: null,
      faultConsumed: null,
    });
  });

  it("50: a missing, unverified or wrongly-provenanced source becomes a gap", () => {
    expect(
      gapCodes(
        buildChaosRunEvidenceBundle(
          c07Source({ sourceWebhook: null, canonicalSourceEventCount: null }),
        ),
      ),
    ).toContain("SOURCE_WEBHOOK_NOT_FOUND");

    expect(
      gapCodes(
        buildChaosRunEvidenceBundle(
          c07Source({
            sourceWebhook: webhookRow({ signature_verified: false }),
          }),
        ),
      ),
    ).toContain("SOURCE_SIGNATURE_NOT_VERIFIED");

    expect(
      gapCodes(
        buildChaosRunEvidenceBundle(
          c07Source({
            sourceWebhook: webhookRow({ source_kind: "PAYCHAOS_REPLAY" }),
          }),
        ),
      ),
    ).toContain("SOURCE_PROVENANCE_MISMATCH");
  });

  it("51: a missing authoritative original processing attempt becomes a gap", () => {
    expect(
      gapCodes(
        buildChaosRunEvidenceBundle(
          c07Source({ originalProcessingAttempts: [] }),
        ),
      ),
    ).toContain("MISSING_AUTHORITATIVE_ORIGINAL_PROCESSING_ATTEMPT");
  });

  it("52: a replay attempt unexpectedly linked to a C07 run is an integrity gap", () => {
    const bundle = buildChaosRunEvidenceBundle(
      c07Source({ chaosProcessingAttempts: [replayRow(REPLAY_ATTEMPT_A_ID)] }),
    );
    expect(gapCodes(bundle)).toContain(
      "UNEXPECTED_CHAOS_PROCESSING_ATTEMPT_COUNT",
    );
    expect(bundle.scenarioEvidence).toMatchObject({
      observedReplayAttemptCount: 1,
    });
  });

  it("53: NULL historical snapshots on the original attempt remain gaps and are never backfilled", () => {
    const bundle = buildChaosRunEvidenceBundle(
      c07Source({
        originalProcessingAttempts: [
          attemptRow({ state_before: null, state_after: null }),
        ],
      }),
    );
    expect(bundle.gaps).toContainEqual({
      code: "MISSING_STATE_BEFORE",
      subjectId: ORIGINAL_ATTEMPT_ID,
    });
    expect(bundle.gaps).toContainEqual({
      code: "MISSING_STATE_AFTER",
      subjectId: ORIGINAL_ATTEMPT_ID,
    });
    expect(bundle.originalProcessingAttempts[0]?.stateBefore).toEqual({
      kind: "NOT_CAPTURED",
    });
  });
});

// ===========================================================================
// 8. C11 — Failed Payment Must Never Mark Order Paid
// ===========================================================================

function c11Source(
  overrides: Partial<ChaosRunEvidenceSource> = {},
): ChaosRunEvidenceSource {
  return {
    run: runRow({ scenario_id: "C11", fault_type: null }),
    sourceWebhook: webhookRow({ event_type: "payment.failed" }),
    originalProcessingAttempts: [attemptRow()],
    chaosProcessingAttempts: [],
    canonicalSourceEventCount: 1,
    ...captureSearchDefaults(),
    ...overrides,
  };
}

describe("C11 evidence assembly", () => {
  it("54: C11-A (zero replays) is classified A_OBSERVATION with zero gaps", () => {
    const bundle = buildChaosRunEvidenceBundle(c11Source());
    expect(bundle.scenarioEvidence).toEqual({
      scenarioId: "C11",
      observedShape: "A_OBSERVATION",
      expectedReplayAttemptCount: 0,
      observedReplayAttemptCount: 0,
      chaosLinkedProcessingAttemptCount: 0,
      originalProcessingAttemptCount: 1,
      authoritativeOriginalProcessingAttemptId: ORIGINAL_ATTEMPT_ID,
      sourceEventTypeIsPaymentFailed: true,
    });
    expect(bundle.gaps).toEqual([]);
    expect(bundle.requiredInvariantIds).toEqual([
      "INV-003",
      "INV-004",
      "INV-011",
    ]);
  });

  it("55: C11-B (exactly one PAYCHAOS_REPLAY) is classified B_REPLAY with its replay snapshots", () => {
    const bundle = buildChaosRunEvidenceBundle(
      c11Source({ chaosProcessingAttempts: [replayRow(REPLAY_ATTEMPT_A_ID)] }),
    );
    expect(bundle.scenarioEvidence).toEqual({
      scenarioId: "C11",
      observedShape: "B_REPLAY",
      expectedReplayAttemptCount: 1,
      observedReplayAttemptCount: 1,
      chaosLinkedProcessingAttemptCount: 1,
      originalProcessingAttemptCount: 1,
      authoritativeOriginalProcessingAttemptId: ORIGINAL_ATTEMPT_ID,
      sourceEventTypeIsPaymentFailed: true,
    });
    expect(bundle.chaosProcessingAttempts[0]?.stateBefore.kind).toBe(
      "CAPTURED",
    );
    expect(bundle.gaps).toEqual([]);
  });

  it("56: more than one replay is AMBIGUOUS_OR_INCOMPLETE plus an unexpected-count gap", () => {
    const bundle = buildChaosRunEvidenceBundle(
      c11Source({
        chaosProcessingAttempts: [
          replayRow(REPLAY_ATTEMPT_A_ID),
          replayRow(REPLAY_ATTEMPT_B_ID),
        ],
      }),
    );
    expect(bundle.scenarioEvidence).toMatchObject({
      observedShape: "AMBIGUOUS_OR_INCOMPLETE",
      expectedReplayAttemptCount: null,
      observedReplayAttemptCount: 2,
    });
    expect(gapCodes(bundle)).toContain("AMBIGUOUS_C11_EVIDENCE_SHAPE");
    expect(gapCodes(bundle)).toContain(
      "UNEXPECTED_CHAOS_PROCESSING_ATTEMPT_COUNT",
    );
  });

  it("57: a wrong source event type is a gap and is reported honestly", () => {
    const bundle = buildChaosRunEvidenceBundle(
      c11Source({
        sourceWebhook: webhookRow({ event_type: "payment.captured" }),
      }),
    );
    expect(gapCodes(bundle)).toContain("SOURCE_EVENT_TYPE_UNEXPECTED");
    expect(bundle.scenarioEvidence).toMatchObject({
      sourceEventTypeIsPaymentFailed: false,
    });
  });

  it("58: wrong source provenance and a missing signature verification each become a gap", () => {
    const bundle = buildChaosRunEvidenceBundle(
      c11Source({
        sourceWebhook: webhookRow({
          event_type: "payment.failed",
          source_kind: "PAYCHAOS_REPLAY",
          signature_verified: false,
        }),
      }),
    );
    expect(gapCodes(bundle)).toContain("SOURCE_PROVENANCE_MISMATCH");
    expect(gapCodes(bundle)).toContain("SOURCE_SIGNATURE_NOT_VERIFIED");
  });

  it("59: a TEST_FIXTURE PRECHECK-07 BLOCKED row produces no fabricated provider evidence", () => {
    const bundle = buildChaosRunEvidenceBundle({
      run: runRow({
        scenario_id: "C11",
        fault_type: null,
        status: "COMPLETED",
        outcome: "BLOCKED",
        failed_precheck_id: "PRECHECK-07",
        order_id: null,
        payment_attempt_id: null,
        payment_id: null,
        source_webhook_event_id: null,
        started_at: null,
      }),
      sourceWebhook: null,
      originalProcessingAttempts: [],
      chaosProcessingAttempts: [],
      canonicalSourceEventCount: null,
      ...noCaptureSubject(),
    });

    expect(bundle.sourceWebhook).toBeNull();
    expect(bundle.originalProcessingAttempts).toEqual([]);
    expect(bundle.chaosProcessingAttempts).toEqual([]);
    expect(bundle.run.failedPrecheckId).toBe("PRECHECK-07");
    expect(bundle.scenarioEvidence).toMatchObject({
      observedShape: "AMBIGUOUS_OR_INCOMPLETE",
      expectedReplayAttemptCount: null,
      sourceEventTypeIsPaymentFailed: false,
    });
    expect(gapCodes(bundle)).toContain("RUN_BLOCKED_BEFORE_EXECUTION");
    expect(gapCodes(bundle)).toContain("MISSING_SOURCE_WEBHOOK_LINK");
    expect(bundle.evidenceRefs).toEqual([{ kind: "CHAOS_RUN", id: RUN_ID }]);
  });

  it("60: historical NULL snapshots on a C11 original attempt stay gaps, never backfilled", () => {
    const bundle = buildChaosRunEvidenceBundle(
      c11Source({
        originalProcessingAttempts: [
          attemptRow({ state_before: null, state_after: null }),
        ],
      }),
    );
    expect(bundle.gaps).toContainEqual({
      code: "MISSING_STATE_BEFORE",
      subjectId: ORIGINAL_ATTEMPT_ID,
    });
    expect(bundle.gaps).toContainEqual({
      code: "MISSING_STATE_AFTER",
      subjectId: ORIGINAL_ATTEMPT_ID,
    });
    // The classification is unaffected — a missing snapshot is a gap, not a
    // reason to reclassify the observed mechanism.
    expect(bundle.scenarioEvidence).toMatchObject({
      observedShape: "A_OBSERVATION",
    });
  });

  it("61: a C11 run carrying a fault primitive is an integrity gap — C11 has none", () => {
    const bundle = buildChaosRunEvidenceBundle(
      c11Source({
        run: runRow({
          scenario_id: "C11",
          fault_type: "DROP_CLIENT_CONFIRMATION",
        }),
      }),
    );
    expect(gapCodes(bundle)).toContain("UNEXPECTED_FAULT_TYPE");
  });
});

// ===========================================================================
// 9. AUTHORITATIVE ORIGINAL PROCESSING ATTEMPT
//    (architect correction, Blocker 2 — the bug lived here)
// ===========================================================================

const SECOND_ATTEMPT_ID = "60000000-0000-4000-8000-00000000000f";

describe("resolveAuthoritativeOriginalProcessingAttempt", () => {
  function project(
    rows: readonly RawProcessingAttemptEvidenceRow[],
  ): ChaosRunEvidenceBundleV1["originalProcessingAttempts"] {
    return buildChaosRunEvidenceBundle(
      healthyC01Source({ originalProcessingAttempts: rows }),
    ).originalProcessingAttempts;
  }

  it("62 (A): one SUCCEEDED, non-duplicate REAL original resolves as authoritative", () => {
    const resolution = resolveAuthoritativeOriginalProcessingAttempt(
      project([attemptRow()]),
    );
    expect(resolution.kind).toBe("EXACTLY_ONE");
    if (resolution.kind !== "EXACTLY_ONE") throw new Error("unreachable");
    expect(resolution.attempt.id).toBe(ORIGINAL_ATTEMPT_ID);
    expect(resolution.candidateCount).toBe(1);
  });

  it("63 (B): a lone FAILED REAL original is NOT authoritative — length one is not the test", () => {
    const resolution = resolveAuthoritativeOriginalProcessingAttempt(
      project([attemptRow({ status: "FAILED" })]),
    );
    expect(resolution).toEqual({ kind: "NONE", candidateCount: 0 });
  });

  it("64 (C): a lone SUCCEEDED but DUPLICATE-delivery REAL original is NOT authoritative", () => {
    const resolution = resolveAuthoritativeOriginalProcessingAttempt(
      project([attemptRow({ is_duplicate_delivery: true })]),
    );
    expect(resolution).toEqual({ kind: "NONE", candidateCount: 0 });
  });

  it("65 (D): FAILED retry history plus ONE SUCCEEDED non-duplicate resolves EXACTLY ONE — retries are not ambiguity", () => {
    const resolution = resolveAuthoritativeOriginalProcessingAttempt(
      project([
        attemptRow({ status: "FAILED" }),
        attemptRow({ id: SECOND_ATTEMPT_ID, status: "SUCCEEDED" }),
      ]),
    );
    expect(resolution.kind).toBe("EXACTLY_ONE");
    if (resolution.kind !== "EXACTLY_ONE") throw new Error("unreachable");
    expect(resolution.attempt.id).toBe(SECOND_ATTEMPT_ID);
  });

  it("66 (E): two SUCCEEDED non-duplicate REAL originals are AMBIGUOUS — never 'pick the latest'", () => {
    const resolution = resolveAuthoritativeOriginalProcessingAttempt(
      project([attemptRow(), attemptRow({ id: SECOND_ATTEMPT_ID })]),
    );
    expect(resolution).toEqual({ kind: "AMBIGUOUS", candidateCount: 2 });
  });

  it("67: a chaos-linked or non-REAL attempt can never be an authoritative original", () => {
    expect(
      resolveAuthoritativeOriginalProcessingAttempt(
        project([attemptRow({ chaos_run_id: RUN_ID })]),
      ),
    ).toEqual({ kind: "NONE", candidateCount: 0 });
    expect(
      resolveAuthoritativeOriginalProcessingAttempt(
        project([attemptRow({ source_kind: "PAYCHAOS_REPLAY" })]),
      ),
    ).toEqual({ kind: "NONE", candidateCount: 0 });
  });

  it("68 (F): the resolution is order-independent", () => {
    const rows = [
      attemptRow({ status: "FAILED" }),
      attemptRow({ id: SECOND_ATTEMPT_ID, status: "SUCCEEDED" }),
    ];
    const forward = resolveAuthoritativeOriginalProcessingAttempt(
      project(rows),
    );
    const reversed = resolveAuthoritativeOriginalProcessingAttempt(
      project([...rows].reverse()),
    );
    expect(reversed).toEqual(forward);
  });
});

describe("authoritative original processing attempt — bundle behavior", () => {
  it("69 (A): C01 with one SUCCEEDED non-duplicate original names it and emits no authoritative gap", () => {
    const bundle = buildChaosRunEvidenceBundle(healthyC01Source());
    expect(bundle.scenarioEvidence).toMatchObject({
      authoritativeOriginalProcessingAttemptId: ORIGINAL_ATTEMPT_ID,
      originalProcessingAttemptCount: 1,
    });
    expect(bundle.gaps).toEqual([]);
  });

  it("70 (B): C01 with a single FAILED original gets the missing-authoritative gap, and the FAILED row stays VISIBLE", () => {
    const bundle = buildChaosRunEvidenceBundle(
      healthyC01Source({
        originalProcessingAttempts: [attemptRow({ status: "FAILED" })],
      }),
    );
    expect(gapCodes(bundle)).toContain(
      "MISSING_AUTHORITATIVE_ORIGINAL_PROCESSING_ATTEMPT",
    );
    expect(bundle.scenarioEvidence).toMatchObject({
      authoritativeOriginalProcessingAttemptId: null,
    });
    // History is never hidden or deleted.
    expect(bundle.originalProcessingAttempts).toHaveLength(1);
    expect(bundle.originalProcessingAttempts[0]!.status).toBe("FAILED");
    expect(bundle.scenarioEvidence).toMatchObject({
      originalProcessingAttemptCount: 1,
    });
  });

  it("71 (C): C01 with a single SUCCEEDED duplicate-delivery original gets the missing-authoritative gap", () => {
    const bundle = buildChaosRunEvidenceBundle(
      healthyC01Source({
        originalProcessingAttempts: [
          attemptRow({ is_duplicate_delivery: true }),
        ],
      }),
    );
    expect(gapCodes(bundle)).toContain(
      "MISSING_AUTHORITATIVE_ORIGINAL_PROCESSING_ATTEMPT",
    );
    expect(bundle.scenarioEvidence).toMatchObject({
      authoritativeOriginalProcessingAttemptId: null,
    });
  });

  it("72 (D): C01 with FAILED + one SUCCEEDED non-duplicate resolves exactly one and emits NO ambiguity gap", () => {
    const bundle = buildChaosRunEvidenceBundle(
      healthyC01Source({
        originalProcessingAttempts: [
          attemptRow({ status: "FAILED" }),
          attemptRow({ id: SECOND_ATTEMPT_ID }),
        ],
      }),
    );
    expect(bundle.scenarioEvidence).toMatchObject({
      authoritativeOriginalProcessingAttemptId: SECOND_ATTEMPT_ID,
      originalProcessingAttemptCount: 2,
    });
    expect(gapCodes(bundle)).not.toContain(
      "AMBIGUOUS_AUTHORITATIVE_ORIGINAL_PROCESSING_ATTEMPT",
    );
    expect(gapCodes(bundle)).not.toContain(
      "MISSING_AUTHORITATIVE_ORIGINAL_PROCESSING_ATTEMPT",
    );
    // Both rows, including the FAILED one, remain in the bundle.
    expect(
      bundle.originalProcessingAttempts.map((a) => a.status).sort(),
    ).toEqual(["FAILED", "SUCCEEDED"]);
  });

  it("73 (E): C01 with two SUCCEEDED non-duplicate originals is ambiguous and names none", () => {
    const bundle = buildChaosRunEvidenceBundle(
      healthyC01Source({
        originalProcessingAttempts: [
          attemptRow(),
          attemptRow({ id: SECOND_ATTEMPT_ID }),
        ],
      }),
    );
    expect(gapCodes(bundle)).toContain(
      "AMBIGUOUS_AUTHORITATIVE_ORIGINAL_PROCESSING_ATTEMPT",
    );
    expect(bundle.scenarioEvidence).toMatchObject({
      authoritativeOriginalProcessingAttemptId: null,
    });
  });

  it("74 (F): shuffled original-attempt input yields the same authoritative result and the same bundle", () => {
    const rows = [
      attemptRow({ status: "FAILED" }),
      attemptRow({ id: SECOND_ATTEMPT_ID }),
    ];
    const forward = buildChaosRunEvidenceBundle(
      healthyC01Source({ originalProcessingAttempts: rows }),
    );
    const reversed = buildChaosRunEvidenceBundle(
      healthyC01Source({ originalProcessingAttempts: [...rows].reverse() }),
    );
    expect(reversed).toEqual(forward);
    expect(reversed.scenarioEvidence).toMatchObject({
      authoritativeOriginalProcessingAttemptId: SECOND_ATTEMPT_ID,
    });
  });

  it("75: C07 applies the identical authoritative rule — FAILED + one SUCCEEDED resolves one, a lone FAILED does not", () => {
    const resolved = buildChaosRunEvidenceBundle(
      c07Source({
        originalProcessingAttempts: [
          attemptRow({ status: "FAILED" }),
          attemptRow({ id: SECOND_ATTEMPT_ID }),
        ],
      }),
    );
    expect(resolved.scenarioEvidence).toMatchObject({
      authoritativeOriginalProcessingAttemptId: SECOND_ATTEMPT_ID,
    });
    expect(gapCodes(resolved)).not.toContain(
      "AMBIGUOUS_AUTHORITATIVE_ORIGINAL_PROCESSING_ATTEMPT",
    );

    const unresolved = buildChaosRunEvidenceBundle(
      c07Source({
        originalProcessingAttempts: [attemptRow({ status: "FAILED" })],
      }),
    );
    expect(gapCodes(unresolved)).toContain(
      "MISSING_AUTHORITATIVE_ORIGINAL_PROCESSING_ATTEMPT",
    );
    expect(unresolved.scenarioEvidence).toMatchObject({
      authoritativeOriginalProcessingAttemptId: null,
    });
  });

  it("76: C11 applies the identical authoritative rule", () => {
    const resolved = buildChaosRunEvidenceBundle(
      c11Source({
        originalProcessingAttempts: [
          attemptRow({ status: "FAILED" }),
          attemptRow({ id: SECOND_ATTEMPT_ID }),
        ],
      }),
    );
    expect(resolved.scenarioEvidence).toMatchObject({
      authoritativeOriginalProcessingAttemptId: SECOND_ATTEMPT_ID,
      observedShape: "A_OBSERVATION",
    });

    const ambiguous = buildChaosRunEvidenceBundle(
      c11Source({
        originalProcessingAttempts: [
          attemptRow(),
          attemptRow({ id: SECOND_ATTEMPT_ID }),
        ],
      }),
    );
    expect(gapCodes(ambiguous)).toContain(
      "AMBIGUOUS_AUTHORITATIVE_ORIGINAL_PROCESSING_ATTEMPT",
    );
    expect(ambiguous.scenarioEvidence).toMatchObject({
      authoritativeOriginalProcessingAttemptId: null,
    });
  });
});

// ===========================================================================
// 10. SOURCE WEBHOOK PROCESSING STATUS (architect correction 3)
// ===========================================================================

describe("source webhook processing status", () => {
  it("77: a PROCESSED source emits no processing-status gap", () => {
    const bundle = buildChaosRunEvidenceBundle(healthyC01Source());
    expect(bundle.sourceWebhook?.processingStatus).toBe("PROCESSED");
    expect(gapCodes(bundle)).not.toContain("SOURCE_PROCESSING_NOT_PROCESSED");
  });

  it("78: every valid non-PROCESSED literal emits SOURCE_PROCESSING_NOT_PROCESSED", () => {
    // The exact frozen vocabulary of
    // `webhook_events_processing_status_valid`.
    for (const status of ["RECEIVED", "PROCESSING", "FAILED"]) {
      const bundle = buildChaosRunEvidenceBundle(
        healthyC01Source({
          sourceWebhook: webhookRow({ processing_status: status }),
        }),
      );
      expect(bundle.gaps).toContainEqual({
        code: "SOURCE_PROCESSING_NOT_PROCESSED",
        subjectId: WEBHOOK_ID,
      });
      // The persisted status is reported honestly, never normalized.
      expect(bundle.sourceWebhook?.processingStatus).toBe(status);
    }
  });

  it("79: C07 and C11 apply the same source processing-status rule", () => {
    expect(
      gapCodes(
        buildChaosRunEvidenceBundle(
          c07Source({
            sourceWebhook: webhookRow({ processing_status: "RECEIVED" }),
          }),
        ),
      ),
    ).toContain("SOURCE_PROCESSING_NOT_PROCESSED");

    expect(
      gapCodes(
        buildChaosRunEvidenceBundle(
          c11Source({
            sourceWebhook: webhookRow({
              event_type: "payment.failed",
              processing_status: "FAILED",
            }),
          }),
        ),
      ),
    ).toContain("SOURCE_PROCESSING_NOT_PROCESSED");
  });
});

// ===========================================================================
// 11. C03 DATA CLASSIFICATION (architect correction 4)
// ===========================================================================

describe("C03 data classification", () => {
  it("80: a SYNTHETIC_DEMO C03 run emits no classification gap", () => {
    const bundle = buildChaosRunEvidenceBundle(c03Source());
    expect(bundle.run.dataClassification).toBe("SYNTHETIC_DEMO");
    expect(gapCodes(bundle)).not.toContain("UNEXPECTED_DATA_CLASSIFICATION");
  });

  it("81: a C03 run claiming RECORDED_TEST_EVIDENCE is a factual integrity gap, and no provider evidence is fabricated", () => {
    const bundle = buildChaosRunEvidenceBundle(
      c03Source({
        run: runRow({
          ...c03Source().run,
          data_classification: "RECORDED_TEST_EVIDENCE",
        }),
      }),
    );
    expect(gapCodes(bundle)).toContain("UNEXPECTED_DATA_CLASSIFICATION");
    // The classification is reported as persisted — never corrected.
    expect(bundle.run.dataClassification).toBe("RECORDED_TEST_EVIDENCE");
    // Still no fabricated webhook, attempt or merchant snapshot.
    expect(bundle.sourceWebhook).toBeNull();
    expect(bundle.originalProcessingAttempts).toEqual([]);
    expect(bundle.chaosProcessingAttempts).toEqual([]);
    expect(bundle.evidenceRefs).toEqual([{ kind: "CHAOS_RUN", id: RUN_ID }]);
    // And it is a gap, never a verdict.
    expect(JSON.stringify(bundle)).not.toContain("FAIL");
  });
});

// ===========================================================================
// Phase 3F evidence-compatibility correction
// ===========================================================================

describe("W-AA: trusted webhook money and provider-identity projection (INV-008)", () => {
  it("W: amount_subunits is projected exactly as a whole-subunit integer", () => {
    const bundle = buildChaosRunEvidenceBundle(
      healthyC01Source({
        sourceWebhook: webhookRow({ amount_subunits: 75_000 }),
      }),
    );
    expect(bundle.sourceWebhook!.amountSubunits).toBe(75_000);
    expect(Number.isInteger(bundle.sourceWebhook!.amountSubunits)).toBe(true);
  });

  it("X: currency is projected exactly, unmodified", () => {
    const bundle = buildChaosRunEvidenceBundle(
      healthyC01Source({ sourceWebhook: webhookRow({ currency: "USD" }) }),
    );
    expect(bundle.sourceWebhook!.currency).toBe("USD");
  });

  it("Y: NULL money values are preserved and never defaulted to 0 or INR", () => {
    const bundle = buildChaosRunEvidenceBundle(
      healthyC01Source({
        sourceWebhook: webhookRow({ amount_subunits: null, currency: null }),
      }),
    );
    expect(bundle.sourceWebhook!.amountSubunits).toBeNull();
    expect(bundle.sourceWebhook!.currency).toBeNull();
    expect(bundle.sourceWebhook!.amountSubunits).not.toBe(0);
    expect(bundle.sourceWebhook!.currency).not.toBe("INR");
  });

  it("Z: the trusted provider payment identity is projected, but razorpay_order_id is NOT (unused by the correlation contract)", () => {
    const bundle = buildChaosRunEvidenceBundle(healthyC01Source());
    expect(bundle.sourceWebhook!.razorpayPaymentId).toBe(RAZORPAY_PAYMENT_ID);
    expect(Object.keys(bundle.sourceWebhook!).sort()).toEqual([
      "amountSubunits",
      "currency",
      "duplicateDeliveryCount",
      "eventType",
      "id",
      "paymentAttemptId",
      "paymentId",
      "processingStatus",
      "razorpayEventId",
      "razorpayPaymentId",
      "receivedAt",
      "signatureVerified",
      "sourceKind",
    ]);
  });

  it("AA: no normalized_event or raw payload can reach the bundle", () => {
    const bundle = buildChaosRunEvidenceBundle(healthyC01Source());
    const json = JSON.stringify(bundle);
    expect(json).not.toContain("normalizedEvent");
    expect(json).not.toContain("normalized_event");
    expect(json).not.toContain("rawPayload");
    expect(json).not.toContain("raw_payload_redacted");
    expect(json).not.toContain("rawBodySha256");
  });
});

describe("AB-AQ: authoritative capture evidence resolution", () => {
  const CAPTURE_WEBHOOK_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";

  function captureWebhook(overrides: Partial<RawWebhookEvidenceRow> = {}) {
    return webhookRow({
      id: CAPTURE_WEBHOOK_ID,
      razorpay_event_id: "evt_capture",
      event_type: "payment.captured",
      ...overrides,
    });
  }

  it("AB: exactly one verified provider capture correlated to the internal payment resolves EXACTLY_ONE", () => {
    const bundle = buildChaosRunEvidenceBundle(
      healthyC01Source({ captureCandidates: [captureWebhook()] }),
    );
    expect(bundle.authoritativeCapture.kind).toBe("EXACTLY_ONE");
    expect(bundle.authoritativeCaptureWebhook!.eventType).toBe(
      "payment.captured",
    );
    expect(bundle.authoritativeCaptureWebhook!.sourceKind).toBe(
      "REAL_RAZORPAY_WEBHOOK",
    );
    expect(bundle.authoritativeCaptureWebhook!.signatureVerified).toBe(true);
    expect(gapCodes(bundle)).not.toContain(
      "INCOMPLETE_CAPTURE_INTERNAL_CORRELATION",
    );
  });

  it("AC: a complete search finding zero candidates is NONE_OBSERVED and emits NO gap (INV-003 valid negative search result)", () => {
    const bundle = buildChaosRunEvidenceBundle(
      c11Source({ captureCandidates: [] }),
    );
    expect(bundle.authoritativeCapture.kind).toBe("NONE_OBSERVED");
    expect(bundle.authoritativeCaptureWebhook).toBeNull();
    expect(gapCodes(bundle)).not.toContain("MISSING_CAPTURE_SEARCH_SUBJECT");
    expect(gapCodes(bundle)).not.toContain("INCOMPLETE_CAPTURE_SEARCH");
    expect(gapCodes(bundle)).not.toContain(
      "AMBIGUOUS_AUTHORITATIVE_CAPTURE_WEBHOOK",
    );
  });

  it("AD: a provider-identity match whose INTERNAL correlation is missing stays VISIBLE and is never collapsed into NONE_OBSERVED", () => {
    const bundle = buildChaosRunEvidenceBundle(
      c11Source({
        captureCandidates: [captureWebhook({ payment_id: null })],
      }),
    );
    expect(bundle.authoritativeCapture.kind).toBe(
      "INCOMPLETE_INTERNAL_CORRELATION",
    );
    expect(bundle.authoritativeCaptureWebhook).not.toBeNull();
    expect(bundle.authoritativeCaptureWebhook!.razorpayPaymentId).toBe(
      RAZORPAY_PAYMENT_ID,
    );
    expect(gapCodes(bundle)).toContain(
      "INCOMPLETE_CAPTURE_INTERNAL_CORRELATION",
    );
    expect(bundle.authoritativeCapture.kind).not.toBe("NONE_OBSERVED");
  });

  it("AD2: a provider match whose internal correlation names a DIFFERENT payment also stays visible, never NONE_OBSERVED", () => {
    const bundle = buildChaosRunEvidenceBundle(
      c11Source({
        captureCandidates: [
          captureWebhook({
            payment_id: "99999999-9999-9999-9999-999999999999",
          }),
        ],
      }),
    );
    expect(bundle.authoritativeCapture.kind).toBe(
      "INCOMPLETE_INTERNAL_CORRELATION",
    );
    expect(bundle.authoritativeCaptureWebhook).not.toBeNull();
  });

  it("AE: more than one candidate is AMBIGUOUS, never latest-wins, and every candidate stays traceable", () => {
    const secondId = "dddddddd-dddd-dddd-dddd-dddddddddddd";
    const second = captureWebhook({
      id: secondId,
      razorpay_event_id: "evt_capture_2",
      received_at: "2030-01-01T00:00:00.000Z",
    });
    const bundle = buildChaosRunEvidenceBundle(
      c11Source({ captureCandidates: [captureWebhook(), second] }),
    );
    expect(bundle.authoritativeCapture.kind).toBe("AMBIGUOUS");
    expect(bundle.authoritativeCaptureWebhook).toBeNull();
    expect(gapCodes(bundle)).toContain(
      "AMBIGUOUS_AUTHORITATIVE_CAPTURE_WEBHOOK",
    );
    const refIds = bundle.evidenceRefs
      .filter((r) => r.kind === "WEBHOOK_EVENT")
      .map((r) => r.id);
    expect(refIds).toContain(CAPTURE_WEBHOOK_ID);
    expect(refIds).toContain(secondId);
  });

  it("AF: NO trustworthy subject resolves NO_SUBJECT, never NONE_OBSERVED", () => {
    const bundle = buildChaosRunEvidenceBundle(
      c11Source({
        sourceWebhook: null,
        canonicalSourceEventCount: null,
        captureSubjectRazorpayPaymentId: null,
        captureSubjectInternalPaymentIds: [],
        captureProviderSearchPerformed: false,
        captureCandidates: [],
      }),
    );
    expect(bundle.authoritativeCapture.kind).toBe("NO_SUBJECT");
    expect(bundle.authoritativeCapture.kind).not.toBe("NONE_OBSERVED");
    expect(gapCodes(bundle)).toContain("MISSING_CAPTURE_SEARCH_SUBJECT");
  });

  it("AG: a subject with NO trusted provider identity is SEARCH_INCOMPLETE, so no negative conclusion is drawn from an internal-only search", () => {
    const bundle = buildChaosRunEvidenceBundle(
      c11Source({
        captureSubjectRazorpayPaymentId: null,
        captureProviderSearchPerformed: false,
      }),
    );
    expect(bundle.authoritativeCapture.kind).toBe("SEARCH_INCOMPLETE");
    expect(bundle.authoritativeCapture.kind).not.toBe("NONE_OBSERVED");
    expect(gapCodes(bundle)).toContain("INCOMPLETE_CAPTURE_SEARCH");
  });

  it("AH: conflicting trusted internal subjects resolve AMBIGUOUS_SUBJECT with no arbitration", () => {
    const bundle = buildChaosRunEvidenceBundle(
      c11Source({
        captureSubjectInternalPaymentIds: [
          PAYMENT_ID,
          "88888888-8888-8888-8888-888888888888",
        ],
      }),
    );
    expect(bundle.authoritativeCapture.kind).toBe("AMBIGUOUS_SUBJECT");
    expect(bundle.authoritativeCaptureWebhook).toBeNull();
    expect(gapCodes(bundle)).toContain("AMBIGUOUS_CAPTURE_SEARCH_SUBJECT");
  });

  it("AI: a candidate whose provider identity conflicts with the subject is AMBIGUOUS, never silently accepted", () => {
    const bundle = buildChaosRunEvidenceBundle(
      c11Source({
        captureCandidates: [
          captureWebhook({ razorpay_payment_id: "pay_some_other_payment" }),
        ],
      }),
    );
    expect(bundle.authoritativeCapture.kind).toBe("AMBIGUOUS");
    expect(bundle.authoritativeCaptureWebhook).toBeNull();
  });

  it("AJ: a payment.failed source stays the sourceWebhook and is never replaced by capture evidence", () => {
    const bundle = buildChaosRunEvidenceBundle(
      c11Source({ captureCandidates: [captureWebhook()] }),
    );
    expect(bundle.sourceWebhook!.eventType).toBe("payment.failed");
    expect(bundle.sourceWebhook!.id).toBe(WEBHOOK_ID);
    expect(bundle.authoritativeCaptureWebhook!.id).not.toBe(
      bundle.sourceWebhook!.id,
    );
    expect(bundle.authoritativeCaptureWebhook!.eventType).toBe(
      "payment.captured",
    );
  });

  it("AK: capture evidence retains its OWN provenance and processing status, never inherited and never filtered away", () => {
    const bundle = buildChaosRunEvidenceBundle(
      c11Source({
        captureCandidates: [captureWebhook({ processing_status: "FAILED" })],
      }),
    );
    expect(bundle.authoritativeCaptureWebhook!.processingStatus).toBe("FAILED");
    expect(bundle.authoritativeCaptureWebhook!.sourceKind).toBe(
      "REAL_RAZORPAY_WEBHOOK",
    );
  });

  it("AL: a PAYCHAOS_REPLAY row is never relabelled as provider capture evidence", () => {
    const bundle = buildChaosRunEvidenceBundle(
      c11Source({
        captureCandidates: [captureWebhook({ source_kind: "PAYCHAOS_REPLAY" })],
      }),
    );
    expect(bundle.authoritativeCaptureWebhook?.sourceKind).not.toBe(
      "REAL_RAZORPAY_WEBHOOK",
    );
    for (const attempt of bundle.chaosProcessingAttempts) {
      if (attempt.sourceKind === "PAYCHAOS_REPLAY") {
        expect(attempt.sourceKind).toBe("PAYCHAOS_REPLAY");
      }
    }
  });

  it("AM: the resolver is deterministic and collapses duplicate subject ids rather than calling them ambiguous", () => {
    const input = {
      subjectRazorpayPaymentId: RAZORPAY_PAYMENT_ID,
      subjectInternalPaymentIds: [PAYMENT_ID, PAYMENT_ID],
      providerSearchPerformed: true,
      candidates: [],
    };
    expect(resolveAuthoritativeCaptureEvidence(input)).toEqual(
      resolveAuthoritativeCaptureEvidence(input),
    );
    expect(resolveAuthoritativeCaptureEvidence(input).kind).toBe(
      "NONE_OBSERVED",
    );
  });

  it("AN: C03 never emits a capture gap because it has no payment by design", () => {
    const bundle = buildChaosRunEvidenceBundle(c03Source());
    expect(bundle.authoritativeCapture.kind).toBe("NO_SUBJECT");
    expect(gapCodes(bundle)).not.toContain("MISSING_CAPTURE_SEARCH_SUBJECT");
    expect(bundle.gaps).toEqual([]);
  });

  it("AO: the resolution never carries a money verdict", () => {
    const bundle = buildChaosRunEvidenceBundle(
      c11Source({ captureCandidates: [captureWebhook()] }),
    );
    const json = JSON.stringify(bundle.authoritativeCapture);
    for (const verdict of ["PASS", "FAIL", "NOT_APPLICABLE"]) {
      expect(json).not.toContain(verdict);
    }
  });
});

describe("A-V: C03 mutation evidence (INV-005 inputs)", () => {
  it("I: the LEGACY checks-only fault_state parses truthfully, mutationEvidence is null and reported as a gap, never reconstructed", () => {
    const bundle = buildChaosRunEvidenceBundle(
      c03Source({
        run: runRow({
          ...c03Source().run,
          fault_state: c03LegacyFaultState(),
        }),
      }),
    );
    expect(gapCodes(bundle)).toContain("MISSING_C03_MUTATION_EVIDENCE");
    expect(bundle.scenarioEvidence).toMatchObject({
      scenarioId: "C03",
      mutationEvidence: null,
      verificationChecks: [
        { case: "WRONG_SIGNATURE", classification: "REJECTED" },
        { case: "MISSING_SIGNATURE", classification: "REJECTED" },
      ],
    });
    expect(JSON.stringify(bundle)).not.toContain("backfill");
  });

  it("I2: parseC03MutationEvidence reports ABSENT for the legacy shape and PRESENT for the corrected one", () => {
    expect(parseC03MutationEvidence(c03LegacyFaultState()).kind).toBe("ABSENT");
    expect(
      parseC03MutationEvidence({
        ...c03LegacyFaultState(),
        mutationEvidence: c03MutationEvidenceJson(),
      }).kind,
    ).toBe("PRESENT");
  });

  it("I3: an invalid or wrong-version mutationEvidence is INVALID, never silently accepted or repaired", () => {
    const badValues: Record<string, unknown>[] = [
      { mutationEvidence: { version: 2, before: null, after: null } },
      { mutationEvidence: { version: 1, before: null } },
      { mutationEvidence: { version: 1, before: null, after: null, x: 1 } },
      { mutationEvidence: "not-an-object" },
      { mutationEvidence: { version: 1, before: { version: 9 }, after: null } },
    ];
    for (const bad of badValues) {
      expect(
        parseC03MutationEvidence({ ...c03LegacyFaultState(), ...bad }).kind,
      ).toBe("INVALID");
    }
  });

  it("I4: an arbitrary extra fault_state key is rejected outright, never a generic pass-through", () => {
    expect(
      parseC03VerificationChecks({
        ...c03LegacyFaultState(),
        mutationEvidence: c03MutationEvidenceJson(),
        somethingElse: true,
      }),
    ).toBeNull();
    expect(parseC03VerificationChecks(c03LegacyFaultState())).not.toBeNull();
    expect(
      parseC03VerificationChecks({
        ...c03LegacyFaultState(),
        mutationEvidence: c03MutationEvidenceJson(),
      }),
    ).not.toBeNull();
  });

  it("D-H: a state change between before and after is preserved verbatim so a later evaluator can detect it", () => {
    const mutated = c03SnapshotJson({
      orders: {
        count: 1,
        complete: true,
        rows: [
          {
            id: ORDER_ID,
            paymentStatus: "PAID",
            businessStatus: "FULFILLED",
            amountSubunits: 75_000,
            currency: "INR",
          },
        ],
      },
    });
    const bundle = buildChaosRunEvidenceBundle(
      c03Source({
        run: runRow({
          ...c03Source().run,
          fault_state: {
            ...c03LegacyFaultState(),
            mutationEvidence: c03MutationEvidenceJson({ after: mutated }),
          },
        }),
      }),
    );
    const evidence = (
      bundle.scenarioEvidence as unknown as {
        mutationEvidence: {
          before: {
            orders: { rows: { paymentStatus: string }[]; count: number };
          };
          after: {
            orders: { rows: { paymentStatus: string }[]; count: number };
          };
        };
      }
    ).mutationEvidence;
    expect(evidence.before.orders.rows[0]!.paymentStatus).toBe("UNPAID");
    expect(evidence.after.orders.rows[0]!.paymentStatus).toBe("PAID");
    expect(evidence.before.orders.count).toBe(evidence.after.orders.count);
    expect(JSON.stringify(bundle)).not.toContain("FAIL");
  });

  it("H2: a trusted canonical webhook insertion is detectable through the id set and the count", () => {
    const withWebhook = c03SnapshotJson({
      trustedWebhookEvents: { count: 1, complete: true, ids: ["w-new"] },
    });
    const bundle = buildChaosRunEvidenceBundle(
      c03Source({
        run: runRow({
          ...c03Source().run,
          fault_state: {
            ...c03LegacyFaultState(),
            mutationEvidence: c03MutationEvidenceJson({ after: withWebhook }),
          },
        }),
      }),
    );
    const evidence = (
      bundle.scenarioEvidence as unknown as {
        mutationEvidence: {
          before: { trustedWebhookEvents: { ids: string[]; count: number } };
          after: { trustedWebhookEvents: { ids: string[]; count: number } };
        };
      }
    ).mutationEvidence;
    expect(evidence.before.trustedWebhookEvents.ids).toEqual([]);
    expect(evidence.after.trustedWebhookEvents.ids).toEqual(["w-new"]);
    expect(evidence.after.trustedWebhookEvents.count).toBe(1);
  });

  it("I5: a truncated snapshot is reported INCOMPLETE and never compared as a prefix", () => {
    const truncated = c03SnapshotJson({
      orders: {
        count: 5_000,
        complete: false,
        rows: [
          {
            id: ORDER_ID,
            paymentStatus: "UNPAID",
            businessStatus: "OPEN",
            amountSubunits: 75_000,
            currency: "INR",
          },
        ],
      },
    });
    const bundle = buildChaosRunEvidenceBundle(
      c03Source({
        run: runRow({
          ...c03Source().run,
          fault_state: {
            ...c03LegacyFaultState(),
            mutationEvidence: c03MutationEvidenceJson({ before: truncated }),
          },
        }),
      }),
    );
    expect(gapCodes(bundle)).toContain("INCOMPLETE_C03_MUTATION_EVIDENCE");
  });

  it("I6: a null capture side is incomplete evidence, not an empty merchant state", () => {
    const bundle = buildChaosRunEvidenceBundle(
      c03Source({
        run: runRow({
          ...c03Source().run,
          fault_state: {
            ...c03LegacyFaultState(),
            mutationEvidence: c03MutationEvidenceJson({ after: null }),
          },
        }),
      }),
    );
    expect(gapCodes(bundle)).toContain("INCOMPLETE_C03_MUTATION_EVIDENCE");
    const evidence = (
      bundle.scenarioEvidence as unknown as {
        mutationEvidence: { after: unknown };
      }
    ).mutationEvidence;
    expect(evidence.after).toBeNull();
  });

  it("I7: isC03MutationEvidenceComplete requires both sides, every collection present, and every collection complete", () => {
    const complete = parseC03MutationEvidence({
      ...c03LegacyFaultState(),
      mutationEvidence: c03MutationEvidenceJson(),
    });
    expect(complete.kind).toBe("PRESENT");
    if (complete.kind === "PRESENT") {
      expect(isC03MutationEvidenceComplete(complete.evidence)).toBe(true);
    }

    const nullCollection = parseC03MutationEvidence({
      ...c03LegacyFaultState(),
      mutationEvidence: c03MutationEvidenceJson({
        before: c03SnapshotJson({ payments: null }),
      }),
    });
    expect(nullCollection.kind).toBe("PRESENT");
    if (nullCollection.kind === "PRESENT") {
      expect(isC03MutationEvidenceComplete(nullCollection.evidence)).toBe(
        false,
      );
    }
  });

  it("D: an UNEXPECTED_ACCEPTANCE remains a FACT in the evidence layer, with no FAIL verdict assigned here (ARCH-3F-013 is Phase 3F)", () => {
    const bundle = buildChaosRunEvidenceBundle(
      c03Source({
        run: runRow({
          ...c03Source().run,
          fault_state: {
            checks: [
              {
                case: "WRONG_SIGNATURE",
                classification: "UNEXPECTED_ACCEPTANCE",
              },
              { case: "MISSING_SIGNATURE", classification: "REJECTED" },
            ],
            mutationEvidence: c03MutationEvidenceJson(),
          },
        }),
      }),
    );
    expect(bundle.scenarioEvidence).toMatchObject({
      verificationChecks: [
        { case: "WRONG_SIGNATURE", classification: "UNEXPECTED_ACCEPTANCE" },
        { case: "MISSING_SIGNATURE", classification: "REJECTED" },
      ],
    });
    const json = JSON.stringify(bundle);
    expect(json).not.toContain("FAIL");
    expect(json).not.toContain("PASS");
    expect(bundle.gaps).toEqual([]);
  });

  it("J: C03 evidence never carries a raw payload, signature VALUE, secret or PII", () => {
    const bundle = buildChaosRunEvidenceBundle(c03Source());
    const json = JSON.stringify(bundle).toLowerCase();

    // Field names / payload carriers that must never appear at all.
    for (const needle of [
      "secret",
      "rawbody",
      "raw_body",
      "raw_payload",
      "rawpayload",
      "normalized_event",
      "normalizedevent",
      "idempotencykey",
      "idempotency_key",
      "cvv",
      "otp",
      "@",
      "authorization",
      "x-razorpay",
    ]) {
      expect(json).not.toContain(needle);
    }

    // The literal string "signature" DOES legitimately appear, but only ever
    // inside the frozen scenario/case identifiers — never as a signature
    // value. Every occurrence must be one of these three known tokens.
    const signatureTokens = json.match(/[a-z_]*signature[a-z_]*/g) ?? [];
    expect(signatureTokens.length).toBeGreaterThan(0);
    for (const token of signatureTokens) {
      expect([
        "invalid_signature_test",
        "wrong_signature",
        "missing_signature",
      ]).toContain(token);
    }

    // And no 64-hex HMAC-shaped value anywhere.
    expect(JSON.stringify(bundle)).not.toMatch(/[0-9a-f]{64}/i);
  });

  it("K-L: C03 still records zero webhook rows, zero processing attempts, no merchant or provider FK, and stays SYNTHETIC_DEMO", () => {
    const bundle = buildChaosRunEvidenceBundle(c03Source());
    expect(bundle.sourceWebhook).toBeNull();
    expect(bundle.originalProcessingAttempts).toEqual([]);
    expect(bundle.chaosProcessingAttempts).toEqual([]);
    expect(bundle.run.orderId).toBeNull();
    expect(bundle.run.paymentAttemptId).toBeNull();
    expect(bundle.run.paymentId).toBeNull();
    expect(bundle.run.sourceWebhookEventId).toBeNull();
    expect(bundle.run.dataClassification).toBe("SYNTHETIC_DEMO");
  });
});
