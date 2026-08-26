/**
 * Phase 3A — deterministic, read-only Chaos Run Precheck / Safety Gate
 * (docs/CHAOS_SCENARIOS.md Section 11 "Chaos Run Precheck", docs/SECURITY.md
 * "Security Pre-Flight Check" PRE-SEC-001..012, this task's Sections 6/8/9).
 *
 * `runChaosPrecheck(rawInput)` is the single entry point. It accepts
 * completely UNTRUSTED input (`unknown` — exactly what a future Phase 3B
 * API route would receive from the browser) and returns either
 * `PRECHECK_PASSED` or `BLOCKED` with a stable `failedPrecheckId` and a safe
 * reason (never a raw error message, never a secret value). It performs
 * ZERO business/payment mutation and ZERO external HTTP call under any
 * outcome — this module contains no `fetch`/webhook/Razorpay-API call of
 * any kind, and its only network I/O is the read-only Supabase reads in
 * `lib/chaos/repository.ts`.
 *
 * `PRECHECK_PASSED` means only "Phase 3A's ten deterministic
 * scenario/prerequisite safety checks passed". It is explicitly NOT
 * "chaos may now inject a fault" — PRE-SEC-007 (mechanism-specific required
 * server secrets), PRE-SEC-010 (operator/session authorization), and
 * PRE-SEC-011 (audit/chaos-run recording path availability) remain Phase
 * 3B's to establish before any replay/fault injection may occur (this
 * task's Section 13).
 *
 * DETERMINISTIC EVALUATION ORDER (this task's Section 9 — the official
 * PRECHECK-01..10 IDs are unchanged, but the actual evaluation sequence
 * ensures DB reachability is established before any DB-backed check runs):
 *
 *   1. PRECHECK-01 — Environment Is TEST
 *   2. PRECHECK-02 — Test Razorpay Key
 *   3. PRECHECK-03 — No Production Credentials
 *   4. PRECHECK-05 — Scenario Is Registered
 *   5. PRECHECK-09 — Fault Is Allowed
 *   6. PRECHECK-04 — Registered Demo Merchant Target
 *   7. PRECHECK-10 — No Arbitrary External Target
 *   8. PRECHECK-06 — Database Reachable
 *   9. PRECHECK-07 — Required Evidence Exists
 *  10. PRECHECK-08 — Known Demo State
 *
 * The FIRST failing check wins and short-circuits every later one — a
 * database outage always surfaces as PRECHECK-06, never a fabricated
 * PRECHECK-07 "evidence missing" (this task's Section 9).
 *
 * PRECHECK-01/02/03 collapse to one call to the existing Phase 2A
 * `getRazorpayEnv()` (`lib/config/razorpay-env.ts`) — this module does not
 * create a competing environment validator (this task's Section 10).
 * `getRazorpayEnv()` currently validates exactly two independently-failable
 * facts: `RAZORPAY_MODE === "test"` (PRECHECK-01) and a `rzp_test_`-prefixed
 * Key ID plus a non-empty Key Secret (PRECHECK-02 — "Test Razorpay Key").
 * There is no additional, independently-checkable "production credential"
 * signal in this application's current configuration surface beyond those
 * two facts (Phase 2A's own docstring: the `rzp_test_` prefix requirement
 * "structurally rejects a rzp_live_ Key ID"), so PRECHECK-03 ("No
 * Production Credentials") is satisfied precisely when PRECHECK-01 and
 * PRECHECK-02 both pass — it never independently produces the first
 * failure under this implementation. PRECHECK-03 is kept as a distinct,
 * explicitly-named step below (not silently folded away) so the code and
 * this module's audit trail stay traceable to the official ID, and so a
 * future distinct production-credential signal has an obvious place to
 * plug in without renumbering anything.
 *
 * PRECHECK-04 ("Registered Demo Merchant Target") is similarly a no-op
 * pass-through here, not because it is skipped, but because it is
 * structurally satisfied: `ChaosPrecheckInput` (lib/chaos/types.ts) has no
 * field of any kind that could carry a merchant identifier, so there is
 * only ever one possible target — the fixed internal Demo Merchant — for
 * every valid input shape (this task's Section 6). PRECHECK-10 (below) is
 * the check that actually rejects a malicious/oversized input shape.
 */
import "server-only";

import { EnvValidationError } from "@/lib/config/env-validation";
import { getRazorpayEnv } from "@/lib/config/razorpay-env";

import {
  checkChaosDatabaseReachable,
  getOrderBaseline,
  isFreshBaseline,
  loadC01SourceEvidence,
  loadC11RealWebhookFailureEvidence,
  loadC11TestFixtureFailureEvidence,
} from "@/lib/chaos/repository";
import {
  getScenarioDefinition,
  isRegisteredScenarioId,
} from "@/lib/chaos/registry";
import type {
  ChaosMechanismSelector,
  ChaosPrecheckId,
  ChaosPrecheckInput,
  ChaosPrecheckResult,
  ChaosScenarioId,
} from "@/lib/chaos/types";

function blocked(
  failedPrecheckId: ChaosPrecheckId,
  reasonCode: string,
  reason: string,
): ChaosPrecheckResult {
  return { status: "BLOCKED", failedPrecheckId, reasonCode, reason };
}

/**
 * PRECHECK-01/02/03 — see module doc comment. Never includes the raw
 * `EnvValidationError` message or the offending value; only a stable safe
 * reason string, matching every other Phase 2 fail-closed config check in
 * this codebase.
 */
function checkRazorpayTestModeConfig(): ChaosPrecheckResult | null {
  try {
    getRazorpayEnv();
    return null;
  } catch (err) {
    if (err instanceof EnvValidationError && err.variable === "RAZORPAY_MODE") {
      return blocked(
        "PRECHECK-01",
        "RAZORPAY_MODE_NOT_TEST",
        "Application is not configured for Razorpay Test Mode.",
      );
    }
    // RAZORPAY_KEY_ID (wrong/live-shaped prefix) or RAZORPAY_KEY_SECRET
    // (missing) both surface as the "Test Razorpay Key" precheck.
    return blocked(
      "PRECHECK-02",
      "RAZORPAY_KEY_NOT_TEST_MODE",
      "Configured Razorpay Test Mode credentials are missing or invalid.",
    );
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** `true` iff `obj`'s own enumerable keys are EXACTLY `allowed` (same length, every allowed key present) — the exact-key/type validator required for PRECHECK-10 (this task's Section 6 "PRECHECK-10"). Any extra key (an attacker's `url`/`host`/`ip`/`webhook_url`/`callback_url`/`target_endpoint`, or anything else) makes this `false`. */
function hasExactKeys(
  obj: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  const keys = Object.keys(obj);
  if (keys.length !== allowed.length) return false;
  return allowed.every((key) => Object.prototype.hasOwnProperty.call(obj, key));
}

/**
 * `true` iff `value` is a structurally valid mechanism selector — one of the
 * three authoritative primary mechanisms (`"A"`/`"B"`/`"C"`), or C07's fixed
 * `["A","C"]` combination. There is no fourth mechanism category (architect
 * correction, Finding 2) — an array of any other shape (wrong length, wrong
 * elements, more than 2 elements) is rejected here, before it ever reaches a
 * registry `allowedMechanisms` comparison.
 */
function isValidMechanismShape(
  value: unknown,
): value is ChaosMechanismSelector {
  if (value === "A" || value === "B" || value === "C") return true;
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value[0] === "A" &&
    value[1] === "C"
  );
}

/** Structural equality for `ChaosMechanismSelector` — two primary-mechanism strings, or two A/C combinations, compared element-wise. */
function mechanismsEqual(
  a: ChaosMechanismSelector,
  b: ChaosMechanismSelector,
): boolean {
  const aIsArray = Array.isArray(a);
  const bIsArray = Array.isArray(b);
  if (aIsArray !== bIsArray) return false;
  if (aIsArray && bIsArray) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  return a === b;
}

/**
 * PRECHECK-10 structural validator: given an ALREADY-confirmed registered
 * `scenarioId` and an already-allowlisted `mechanism`, deterministically
 * narrows the raw untrusted object into a `ChaosPrecheckInput`, or returns
 * `null` if the object's shape does not exactly match one of the five
 * closed variants in `lib/chaos/types.ts`. This is the ONLY place raw input
 * is trusted to become a typed `ChaosPrecheckInput` — no other code path
 * constructs one from untrusted data.
 */
function validateExactShape(
  scenarioId: ChaosScenarioId,
  mechanism: ChaosMechanismSelector,
  obj: Record<string, unknown>,
): ChaosPrecheckInput | null {
  switch (scenarioId) {
    case "C01": {
      if (mechanism !== "B") return null;
      if (
        !hasExactKeys(obj, [
          "scenarioId",
          "mechanism",
          "faultType",
          "sourceWebhookEventId",
        ])
      ) {
        return null;
      }
      if (obj.faultType !== "REPLAY_EVENT") return null;
      if (!isNonEmptyString(obj.sourceWebhookEventId)) return null;
      return {
        scenarioId: "C01",
        mechanism: "B",
        faultType: "REPLAY_EVENT",
        sourceWebhookEventId: obj.sourceWebhookEventId,
      };
    }
    case "C03": {
      if (mechanism !== "C") return null;
      if (!hasExactKeys(obj, ["scenarioId", "mechanism", "faultType"])) {
        return null;
      }
      if (obj.faultType !== "INVALID_SIGNATURE_TEST") return null;
      return {
        scenarioId: "C03",
        mechanism: "C",
        faultType: "INVALID_SIGNATURE_TEST",
      };
    }
    case "C07": {
      if (
        !Array.isArray(mechanism) ||
        mechanism[0] !== "A" ||
        mechanism[1] !== "C"
      ) {
        return null;
      }
      const hasFreshOrderId = Object.prototype.hasOwnProperty.call(
        obj,
        "freshOrderId",
      );
      const allowed = hasFreshOrderId
        ? ["scenarioId", "mechanism", "faultType", "freshOrderId"]
        : ["scenarioId", "mechanism", "faultType"];
      if (!hasExactKeys(obj, allowed)) return null;
      if (obj.faultType !== "DROP_CLIENT_CONFIRMATION") return null;
      if (hasFreshOrderId && !isNonEmptyString(obj.freshOrderId)) return null;
      return {
        scenarioId: "C07",
        mechanism: ["A", "C"],
        faultType: "DROP_CLIENT_CONFIRMATION",
        freshOrderId: hasFreshOrderId
          ? (obj.freshOrderId as string)
          : undefined,
      };
    }
    case "C11": {
      if (mechanism === "A") {
        const hasFreshOrderId = Object.prototype.hasOwnProperty.call(
          obj,
          "freshOrderId",
        );
        const allowed = hasFreshOrderId
          ? ["scenarioId", "mechanism", "freshOrderId"]
          : ["scenarioId", "mechanism"];
        if (!hasExactKeys(obj, allowed)) return null;
        if (hasFreshOrderId && !isNonEmptyString(obj.freshOrderId)) return null;
        return {
          scenarioId: "C11",
          mechanism: "A",
          freshOrderId: hasFreshOrderId
            ? (obj.freshOrderId as string)
            : undefined,
        };
      }
      if (mechanism === "B") {
        if (
          !hasExactKeys(obj, ["scenarioId", "mechanism", "failureEvidence"])
        ) {
          return null;
        }
        const fe = obj.failureEvidence;
        if (typeof fe !== "object" || fe === null) return null;
        const feObj = fe as Record<string, unknown>;
        if (feObj.kind === "REAL_WEBHOOK_EVENT") {
          if (!hasExactKeys(feObj, ["kind", "webhookEventId"])) return null;
          if (!isNonEmptyString(feObj.webhookEventId)) return null;
          return {
            scenarioId: "C11",
            mechanism: "B",
            failureEvidence: {
              kind: "REAL_WEBHOOK_EVENT",
              webhookEventId: feObj.webhookEventId,
            },
          };
        }
        if (feObj.kind === "TEST_FIXTURE") {
          if (!hasExactKeys(feObj, ["kind", "fixtureId"])) return null;
          if (!isNonEmptyString(feObj.fixtureId)) return null;
          return {
            scenarioId: "C11",
            mechanism: "B",
            failureEvidence: {
              kind: "TEST_FIXTURE",
              fixtureId: feObj.fixtureId,
            },
          };
        }
        return null;
      }
      return null;
    }
    default:
      return null;
  }
}

/**
 * PRECHECK-07 + PRECHECK-08, scenario/mechanism-specific
 * (docs/CHAOS_SCENARIOS.md Section 11, this task's Section 12). Returns
 * `null` when both pass; otherwise the first `BLOCKED` result.
 */
async function evaluateEvidenceAndBaseline(
  input: ChaosPrecheckInput,
): Promise<ChaosPrecheckResult | null> {
  switch (input.scenarioId) {
    case "C01": {
      const evidence = await loadC01SourceEvidence(input.sourceWebhookEventId);
      if (!evidence) {
        return blocked(
          "PRECHECK-07",
          "C01_SOURCE_EVIDENCE_UNAVAILABLE",
          "No suitable verified payment.captured/order.paid webhook evidence was found for replay.",
        );
      }
      if (!(
        evidence.baseline.paymentStatus === "PAID" &&
        evidence.baseline.fulfilmentCount === 1
      )) {
        return blocked(
          "PRECHECK-08",
          "C01_BASELINE_NOT_PAID_ONE_FULFILMENT",
          "The correlated order is not in the required PAID-with-exactly-one-fulfilment baseline.",
        );
      }
      return null;
    }
    case "C03": {
      // No evidence/baseline dependency (this task's Section 12: "PRECHECK-07
      // should therefore not invent a requirement for an existing real
      // webhook").
      return null;
    }
    case "C07": {
      // PRECHECK-08 ("Known Demo State") must actually verify a known
      // baseline before PRECHECK_PASSED can be returned — omitting
      // `freshOrderId` is a valid SHAPE (PRECHECK-10 already accepted it),
      // but it means Phase 3A has no known baseline to confirm, which is a
      // PRECHECK-08 failure, not a silent pass (architect correction,
      // Finding 3). Phase 3A never creates the order itself — it remains
      // read-only; Phase 3B may create a fresh order first and then call
      // this precheck with its id.
      if (!input.freshOrderId) {
        return blocked(
          "PRECHECK-08",
          "C07_NO_ORDER_SELECTED",
          "No candidate order was supplied — a known fresh UNPAID/OPEN/zero-fulfilment baseline cannot be confirmed.",
        );
      }
      const baseline = await getOrderBaseline(input.freshOrderId);
      if (!baseline) {
        return blocked(
          "PRECHECK-08",
          "C07_ORDER_NOT_FOUND",
          "The supplied order does not exist.",
        );
      }
      if (!isFreshBaseline(baseline)) {
        return blocked(
          "PRECHECK-08",
          "C07_BASELINE_NOT_FRESH",
          "The supplied order is not in the required fresh UNPAID/OPEN/zero-fulfilment baseline.",
        );
      }
      return null;
    }
    case "C11": {
      if (input.mechanism === "A") {
        // Same PRECHECK-08 rule as C07 above (architect correction, Finding
        // 3): a known fresh order must exist before PRECHECK_PASSED — no
        // order selection is a BLOCKED/PRECHECK-08 result, not a silent
        // pass. Phase 3A does not create the order itself.
        if (!input.freshOrderId) {
          return blocked(
            "PRECHECK-08",
            "C11_NO_ORDER_SELECTED",
            "No candidate order was supplied — a known fresh UNPAID/OPEN/zero-fulfilment baseline cannot be confirmed.",
          );
        }
        const baseline = await getOrderBaseline(input.freshOrderId);
        if (!baseline) {
          return blocked(
            "PRECHECK-08",
            "C11_ORDER_NOT_FOUND",
            "The supplied order does not exist.",
          );
        }
        if (!isFreshBaseline(baseline)) {
          return blocked(
            "PRECHECK-08",
            "C11_BASELINE_NOT_FRESH",
            "The supplied order is not in the required fresh UNPAID/OPEN/zero-fulfilment baseline.",
          );
        }
        return null;
      }

      // Mechanism B.
      const evidence =
        input.failureEvidence.kind === "REAL_WEBHOOK_EVENT"
          ? await loadC11RealWebhookFailureEvidence(
              input.failureEvidence.webhookEventId,
            )
          : await loadC11TestFixtureFailureEvidence(
              input.failureEvidence.fixtureId,
            );
      if (!evidence) {
        return blocked(
          "PRECHECK-07",
          "C11_FAILURE_EVIDENCE_UNAVAILABLE",
          "No suitable authentic payment.failed evidence is available.",
        );
      }
      if (evidence.baseline.paymentStatus === "PAID") {
        return blocked(
          "PRECHECK-08",
          "C11_BASELINE_ALREADY_PAID",
          "The correlated order is already PAID; the failed-payment guard baseline no longer applies.",
        );
      }
      return null;
    }
    default:
      return null;
  }
}

/**
 * The Phase 3A Chaos Run Precheck / Safety Gate entry point. Accepts
 * completely untrusted `rawInput` and returns a deterministic
 * `ChaosPrecheckResult` — either `PRECHECK_PASSED` or the FIRST `BLOCKED`
 * check found, in the fixed evaluation order documented above. Performs no
 * mutation and no external network call under any outcome.
 */
export async function runChaosPrecheck(
  rawInput: unknown,
): Promise<ChaosPrecheckResult> {
  // PRECHECK-01/02/03.
  const configResult = checkRazorpayTestModeConfig();
  if (configResult) return configResult;

  if (
    typeof rawInput !== "object" ||
    rawInput === null ||
    Array.isArray(rawInput)
  ) {
    return blocked(
      "PRECHECK-05",
      "SCENARIO_INPUT_INVALID",
      "Chaos request input is not a valid object.",
    );
  }
  const obj = rawInput as Record<string, unknown>;

  // PRECHECK-05 — Scenario Is Registered.
  const scenarioIdRaw = obj.scenarioId;
  if (!isRegisteredScenarioId(scenarioIdRaw)) {
    return blocked(
      "PRECHECK-05",
      "SCENARIO_NOT_REGISTERED",
      "Requested scenario is not a registered P0 scenario.",
    );
  }
  const scenario = getScenarioDefinition(scenarioIdRaw);
  if (!scenario || !scenario.enabled) {
    return blocked(
      "PRECHECK-05",
      "SCENARIO_DISABLED",
      "Requested scenario is not currently enabled.",
    );
  }

  // PRECHECK-09 — Fault Is Allowed (mechanism + fault primitive).
  const mechanismRaw = obj.mechanism;
  if (
    !isValidMechanismShape(mechanismRaw) ||
    !scenario.allowedMechanisms.some((m) => mechanismsEqual(m, mechanismRaw))
  ) {
    return blocked(
      "PRECHECK-09",
      "MECHANISM_NOT_ALLOWED",
      "Requested mechanism is not allowed for this scenario.",
    );
  }
  const mechanism = mechanismRaw;

  const faultTypeRaw = obj.faultType;
  if (scenario.allowedFaultTypes.length > 0) {
    if (
      typeof faultTypeRaw !== "string" ||
      !(scenario.allowedFaultTypes as readonly string[]).includes(faultTypeRaw)
    ) {
      return blocked(
        "PRECHECK-09",
        "FAULT_NOT_ALLOWED",
        "Requested fault primitive is not allowed for this scenario.",
      );
    }
  } else if (faultTypeRaw !== undefined) {
    return blocked(
      "PRECHECK-09",
      "FAULT_NOT_ALLOWED",
      "This scenario does not accept a fault primitive.",
    );
  }
  // PRECHECK-04 — Registered Demo Merchant Target: structurally satisfied
  // (see module doc comment) — no check to perform.

  // PRECHECK-10 — No Arbitrary External Target (exact-key/type shape).
  const narrowed = validateExactShape(scenario.scenarioId, mechanism, obj);
  if (!narrowed) {
    return blocked(
      "PRECHECK-10",
      "INPUT_SHAPE_REJECTED",
      "Chaos request input contains unsupported, missing, or extra fields.",
    );
  }

  // PRECHECK-06 — Database Reachable.
  try {
    await checkChaosDatabaseReachable();
  } catch {
    return blocked(
      "PRECHECK-06",
      "DATABASE_UNREACHABLE",
      "The database is not reachable.",
    );
  }

  // PRECHECK-07 + PRECHECK-08.
  const evidenceResult = await evaluateEvidenceAndBaseline(narrowed);
  if (evidenceResult) return evidenceResult;

  return {
    status: "PRECHECK_PASSED",
    scenarioId: scenario.scenarioId,
    mechanism,
  };
}
