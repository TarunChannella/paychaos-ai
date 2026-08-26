/**
 * Phase 3A — static, server-authoritative P0 Chaos Scenario Registry
 * (docs/CHAOS_SCENARIOS.md Sections 2/13/15/19/23/30, this task's Section 5).
 *
 * This is application code, not a database table (docs/DATABASE.md Section
 * 15: "There is no separate `chaos_scenarios` database table"). It is a
 * plain, frozen, in-memory object — no Supabase, no Razorpay.
 *
 * This is the server-authoritative EXECUTABLE scenario registry — the
 * browser must never become the authority for executable scenario
 * definitions (architect correction, Finding 5). `import "server-only"`
 * below makes a client-bundle import of this module fail at build time,
 * the same structural guarantee every I/O-touching module in this codebase
 * already uses. A future UI may receive only a safe, server-generated
 * projection of this data (e.g. via a server component or a route handler),
 * never this module itself.
 *
 * Contains EXACTLY the four frozen P0 scenarios — C01, C03, C07, C11 — and
 * nothing else. Do not add a P1 scenario (C02, C04-C06, C08-C10, C12-C15)
 * here; doing so would make it executable through this registry, which
 * CLAUDE.md Section 9 and docs/CHAOS_SCENARIOS.md Section 2 both forbid
 * without an approved scope change.
 */
import "server-only";

import type {
  ChaosScenarioDefinition,
  ChaosScenarioId,
} from "@/lib/chaos/types";

/**
 * The frozen scenario-to-invariant mapping (docs/MONEY_INVARIANTS.md
 * Section 14 "Authoritative Scenario-to-Invariant Contract" — authoritative
 * over the provisional mapping in an older revision of
 * docs/CHAOS_SCENARIOS.md; this task's Section 5 "Frozen invariant
 * mappings" already reflects the corrected values, so there is no
 * conflict to resolve here):
 *
 *   C01 -> INV-001, INV-002, INV-006, INV-007
 *   C03 -> INV-004, INV-005
 *   C07 -> INV-002, INV-004, INV-011
 *   C11 -> INV-003, INV-004, INV-011
 *
 * Phase 3A does not implement any of these invariants — it only records
 * which IDs each scenario declares as required, for Phase 3B's Money
 * Invariant Engine to consume later.
 */
const REGISTRY: Readonly<Record<ChaosScenarioId, ChaosScenarioDefinition>> = {
  C01: {
    scenarioId: "C01",
    name: "Duplicate Webhook Delivery",
    priority: "P0",
    enabled: true,
    // Mechanism B — replay of previously verified authentic evidence
    // (docs/CHAOS_SCENARIOS.md Section 13 Section 8).
    allowedMechanisms: ["B"],
    requiredSourceEventTypes: ["payment.captured", "order.paid"],
    allowedFaultTypes: ["REPLAY_EVENT"],
    requiredInvariants: ["INV-001", "INV-002", "INV-006", "INV-007"],
    defaultFailureSeverity: "Critical",
    requiresRealPayment: true,
    // PRECHECK-07 requires a genuine, signature-verified source webhook for
    // C01 (docs/CHAOS_SCENARIOS.md Section 13 Section 6 preconditions).
    requiresVerifiedWebhook: true,
    // A vulnerable run can leave duplicate business effects behind
    // (docs/CHAOS_SCENARIOS.md Section 13 Section 22: "Restore baseline
    // through Demo Reset if vulnerable mode intentionally produced
    // duplicates") — unlike C03, which normally produces zero mutation on
    // the correct path, C01 replays against a real PAID+one-fulfilment
    // baseline and so genuinely carries a reset-back-to-baseline step in its
    // lifecycle (architect correction, Finding 4).
    requiresReset: true,
  },
  C03: {
    scenarioId: "C03",
    name: "Invalid Webhook Signature",
    priority: "P0",
    enabled: true,
    // Mechanism C — PayChaos-controlled fault against its own fixed
    // internal webhook verification path (docs/CHAOS_SCENARIOS.md Section
    // 15 Section 8). No real webhook is required or produced.
    allowedMechanisms: ["C"],
    requiredSourceEventTypes: [],
    allowedFaultTypes: ["INVALID_SIGNATURE_TEST"],
    requiredInvariants: ["INV-004", "INV-005"],
    defaultFailureSeverity: "Critical",
    requiresRealPayment: false,
    // Explicitly false — this task's Section 12: "C03: Do NOT require a
    // genuine Razorpay webhook."
    requiresVerifiedWebhook: false,
    requiresReset: false,
  },
  C07: {
    scenarioId: "C07",
    name: "Payment Succeeds but Client Confirmation Is Lost",
    priority: "P0",
    enabled: true,
    // Mechanism A+C as one combined scenario flow (docs/CHAOS_SCENARIOS.md
    // Section 19 Section 8): a real Test Mode payment, plus a controlled
    // client-confirmation-drop fault. Represented as the fixed A/C
    // combination, not an invented fourth mechanism category (architect
    // correction, Finding 2).
    allowedMechanisms: [["A", "C"]],
    requiredSourceEventTypes: ["payment.captured", "order.paid"],
    allowedFaultTypes: ["DROP_CLIENT_CONFIRMATION"],
    requiredInvariants: ["INV-002", "INV-004", "INV-011"],
    defaultFailureSeverity: "High",
    requiresRealPayment: true,
    // true — C07 fundamentally depends on genuine verified webhook evidence
    // to converge merchant state (docs/CHAOS_SCENARIOS.md Section 19 Section
    // 10: "verified webhook evidence is persisted" is the expected correct
    // outcome). This does NOT mean a verified webhook must already exist
    // before precheck — C07 generates that evidence during scenario
    // execution; the timing remains scenario-specific gate/runner logic
    // (architect correction, Finding 4).
    requiresVerifiedWebhook: true,
    // The scenario consumes a fresh order and deliberately drives it to
    // PAID+fulfilled — re-running the demo cleanly afterward requires a
    // Demo Reset to obtain another fresh order (docs/CHAOS_SCENARIOS.md
    // Section 19 Section 22).
    requiresReset: true,
  },
  C11: {
    scenarioId: "C11",
    name: "Failed Payment Must Never Mark Order Paid",
    priority: "P0",
    enabled: true,
    // Mechanism A (preferred manual real-failure path) OR Mechanism B
    // (automated authentic failure-evidence replay) — docs/CHAOS_SCENARIOS.md
    // Section 23 Section 8.
    allowedMechanisms: ["A", "B"],
    requiredSourceEventTypes: ["payment.failed"],
    // C11 has no unsafe merchant fault primitive of its own (CLAUDE.md
    // Section 9, docs/CHAOS_SCENARIOS.md Section 31): it uses genuine
    // verified failure evidence, not a PayChaos-controlled fault.
    allowedFaultTypes: [],
    requiredInvariants: ["INV-003", "INV-004", "INV-011"],
    defaultFailureSeverity: "Critical",
    requiresRealPayment: true,
    // true — both mechanisms are ultimately grounded in verified webhook
    // evidence: Mechanism A processes verified failure evidence "when
    // supplied by Razorpay" (docs/CHAOS_SCENARIOS.md Section 23 Section 8),
    // and Mechanism B replays an authentic, signature-verified
    // `payment.failed` webhook. `lib/chaos/safety-gate.ts` implements the
    // real per-mechanism PRECHECK-07/08 rule; this flag only declares the
    // scenario-level dependency (architect correction, Finding 4).
    requiresVerifiedWebhook: true,
    // The correct-path outcome leaves the order UNCHANGED (still not PAID,
    // still zero fulfilments — docs/CHAOS_SCENARIOS.md Section 23 Section
    // 10) — unlike C07, a passing C11 run does not dirty demo state, so
    // Section 22 frames reset as optional ("if desired"), not required.
    requiresReset: false,
  },
};

/** The frozen, ordered list of every registered P0 scenario ID. */
export const P0_SCENARIO_IDS: readonly ChaosScenarioId[] = [
  "C01",
  "C03",
  "C07",
  "C11",
];

/** Runtime type guard: is `value` one of the four registered P0 scenario IDs? Unknown/P1 IDs (e.g. `"C02"`) return `false` — they are never registered here. */
export function isRegisteredScenarioId(
  value: unknown,
): value is ChaosScenarioId {
  return (
    typeof value === "string" &&
    (P0_SCENARIO_IDS as readonly string[]).includes(value)
  );
}

/** Looks up one scenario's frozen registry entry, or `undefined` if `scenarioId` is not registered. */
export function getScenarioDefinition(
  scenarioId: ChaosScenarioId,
): ChaosScenarioDefinition | undefined {
  return REGISTRY[scenarioId];
}

/** Returns every registered scenario definition, in `P0_SCENARIO_IDS` order. */
export function listScenarioDefinitions(): readonly ChaosScenarioDefinition[] {
  return P0_SCENARIO_IDS.map((id) => REGISTRY[id]);
}
