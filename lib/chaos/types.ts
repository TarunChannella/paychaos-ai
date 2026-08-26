/**
 * Phase 3A — Chaos Engine static contracts.
 *
 * This module is intentionally value-free (no I/O, no Supabase, no
 * Razorpay) — it only defines the shared TypeScript shapes used by
 * `lib/chaos/registry.ts` and `lib/chaos/safety-gate.ts`. It carries no
 * `server-only` guard because it defines types only (types do not exist at
 * runtime and cannot leak a secret or an executable code path). That is
 * NOT a statement that the executable scenario registry is safe to import
 * from a client component — `lib/chaos/registry.ts` is the server-authoritative
 * executable registry and is itself guarded by `import "server-only"`. A
 * future UI may receive only a safe, server-generated projection of
 * scenario metadata; the browser must never become the authority for
 * executable scenario definitions (this task's Finding 5).
 *
 * Frozen scope (docs/CHAOS_SCENARIOS.md Sections 2/30/31, docs/PHASE_PLAN.md
 * Section 7, CLAUDE.md Section 9): exactly four P0 scenarios —
 * C01/C03/C07/C11 — and exactly three P0 fault primitives — `REPLAY_EVENT`,
 * `INVALID_SIGNATURE_TEST`, `DROP_CLIENT_CONFIRMATION`. Nothing in this file
 * may be used to construct a P1 scenario ID or a P1 fault primitive; the
 * string literal unions below are the enforcement mechanism — a P1 value
 * simply does not type-check as a member of these unions.
 *
 * `InvariantId` is restricted to the eight invariants the frozen P0
 * scenario-to-invariant mapping (docs/MONEY_INVARIANTS.md Section 14,
 * "Authoritative Scenario-to-Invariant Contract") actually references for
 * C01/C03/C07/C11: INV-001, INV-002, INV-003, INV-004, INV-005, INV-006,
 * INV-007, INV-011. INV-008/009/010/012 exist as P0 invariants but are not
 * mapped to any of the four Phase 3A scenarios, so they are deliberately
 * absent from this union — adding them here would misrepresent this file as
 * the invariant catalogue, which docs/MONEY_INVARIANTS.md alone owns. This
 * module never evaluates an invariant; it only names which invariant IDs a
 * scenario declares as "required" in its registry entry.
 */

/** The four frozen P0 chaos scenario IDs. No other value may appear here (docs/CHAOS_SCENARIOS.md Section 2). */
export type ChaosScenarioId = "C01" | "C03" | "C07" | "C11";

/**
 * The three authoritative primary chaos mechanisms (docs/CHAOS_SCENARIOS.md
 * Section 3, docs/CHAOS_SCENARIOS.md Section 30 "Chaos Scenario Registry
 * Contract"). There is no fourth mechanism category — a scenario that uses
 * more than one primary mechanism in a single flow (C07's "Mechanism A + C")
 * is represented as a fixed combination of these three values
 * (`ChaosMechanismSelector` below), never as an invented enum member.
 */
export type ChaosMechanism = "A" | "B" | "C";

/**
 * C07's documented "Mechanism A + C" combined scenario flow
 * (docs/CHAOS_SCENARIOS.md Section 19 Section 8: real Test Mode payment,
 * then a controlled client-confirmation drop) — represented as a fixed
 * 2-tuple of the two authoritative primary mechanisms it combines, so the
 * A/B/C vocabulary stays exactly three values and this is never mistaken for
 * "either A or B is acceptable" the way a plain array of independently
 * matched mechanisms would read.
 */
export type ChaosMechanismCombination = readonly ["A", "C"];

/**
 * Every value a scenario's `allowedMechanisms` may contain, and every value
 * a `ChaosPrecheckInput`/`ChaosPrecheckResult` may carry as `mechanism`: one
 * of the three primary mechanisms, or C07's fixed A+C combination.
 */
export type ChaosMechanismSelector = ChaosMechanism | ChaosMechanismCombination;

/**
 * The three P0 fault primitives (docs/CHAOS_SCENARIOS.md Section 31,
 * CLAUDE.md Section 9). C11 has no unsafe fault primitive of its own
 * (CHAOS_SCENARIOS.md Section 23 Section 8: "C11 primarily uses genuine
 * verified failure evidence and does not need an unsafe merchant fault"),
 * so its registry entry's `allowedFaultTypes` is empty — this type exists
 * only to constrain what a *fault-bearing* scenario may request.
 */
export type ChaosFaultType =
  "REPLAY_EVENT" | "INVALID_SIGNATURE_TEST" | "DROP_CLIENT_CONFIRMATION";

/**
 * The P0 Razorpay webhook event types PayChaos's merchant processor
 * actually understands (docs/MONEY_INVARIANTS.md Section 27 Section 7:
 * "Supported P0 Razorpay events are: payment.captured, payment.failed,
 * order.paid"). Used only to describe which source event types a scenario
 * may require/consume — never to accept an arbitrary caller-supplied event
 * type string.
 */
export type SupportedSourceEventType =
  "payment.captured" | "payment.failed" | "order.paid";

/**
 * The invariant IDs the frozen P0 scenario-to-invariant mapping actually
 * references (see module doc comment above). `MONEY_INVARIANTS.md` remains
 * authoritative for what each ID means and how it is evaluated — this type
 * only lets a registry entry *name* one.
 */
export type InvariantId =
  | "INV-001"
  | "INV-002"
  | "INV-003"
  | "INV-004"
  | "INV-005"
  | "INV-006"
  | "INV-007"
  | "INV-011";

/** Finding-severity vocabulary (docs/CHAOS_SCENARIOS.md Section 8). Phase 3A never creates a Finding — this is only the scenario registry's declared default. */
export type FailureSeverity = "Critical" | "High" | "Medium" | "Low" | "Info";

/**
 * The frozen 12-field static scenario registry contract
 * (docs/CHAOS_SCENARIOS.md Section 30, this task's Section 5). This is
 * application code, not a database row — there is no `chaos_scenarios`
 * table (docs/DATABASE.md Section 15).
 */
export interface ChaosScenarioDefinition {
  readonly scenarioId: ChaosScenarioId;
  readonly name: string;
  readonly priority: "P0";
  readonly enabled: boolean;
  readonly allowedMechanisms: readonly ChaosMechanismSelector[];
  readonly requiredSourceEventTypes: readonly SupportedSourceEventType[];
  readonly allowedFaultTypes: readonly ChaosFaultType[];
  readonly requiredInvariants: readonly InvariantId[];
  readonly defaultFailureSeverity: FailureSeverity;
  readonly requiresRealPayment: boolean;
  readonly requiresVerifiedWebhook: boolean;
  readonly requiresReset: boolean;
}

/**
 * A narrow reference to authentic P0 failure evidence for C11 Mechanism B
 * (this task's Section 7 "Important C11 requirement"). `REAL_WEBHOOK_EVENT`
 * points at an existing canonical `webhook_events` row (by internal id).
 * `TEST_FIXTURE` is a placeholder reference kind for a future sanitized
 * authentic `payment.failed` fixture — Phase 3A does not implement a
 * fixture store, so this kind can never currently resolve to real evidence
 * and every lookup against it deterministically returns "unavailable"
 * (`lib/chaos/repository.ts`'s `loadC11TestFixtureFailureEvidence`) rather
 * than fabricating one (docs/CHAOS_SCENARIOS.md Section 23 Section 8: "Do
 * not invent a real Razorpay failure").
 */
export type ChaosFailureEvidenceRef =
  | { readonly kind: "REAL_WEBHOOK_EVENT"; readonly webhookEventId: string }
  | { readonly kind: "TEST_FIXTURE"; readonly fixtureId: string };

/**
 * The complete, closed set of valid chaos precheck inputs (this task's
 * Section 7). Every variant always carries `scenarioId` + `mechanism`, plus
 * only the typed evidence/entity selector that scenario/mechanism
 * genuinely needs. There is no field anywhere in this union capable of
 * carrying a URL, host, hostname, IP, webhook URL, callback URL, or target
 * endpoint — the structural guarantee required by CLAUDE.md Section 6 and
 * docs/SECURITY.md's "no arbitrary target" rule. `sourceWebhookEventId`,
 * `freshOrderId`, and `failureEvidence.webhookEventId` are internal
 * database entity selections (an existing record this trusted server
 * process will look up), never network destinations.
 */
export type ChaosPrecheckInput =
  | {
      readonly scenarioId: "C01";
      readonly mechanism: "B";
      readonly faultType: "REPLAY_EVENT";
      readonly sourceWebhookEventId: string;
    }
  | {
      readonly scenarioId: "C03";
      readonly mechanism: "C";
      readonly faultType: "INVALID_SIGNATURE_TEST";
    }
  | {
      readonly scenarioId: "C07";
      readonly mechanism: ChaosMechanismCombination;
      readonly faultType: "DROP_CLIENT_CONFIRMATION";
      // Optional at the SHAPE level deliberately: omitting it is a
      // validly-shaped request that PRECHECK-10 must still accept — its
      // absence is then rejected by PRECHECK-08 ("Known Demo State" cannot be
      // confirmed without a candidate order), not misreported as a shape
      // violation (docs/CHAOS_SCENARIOS.md Section 19 Section 6/7; this
      // task's Finding 3).
      readonly freshOrderId?: string;
    }
  | {
      readonly scenarioId: "C11";
      readonly mechanism: "A";
      // Same PRECHECK-08 semantics as C07's `freshOrderId` above: optional at
      // the shape level, but its absence is a PRECHECK-08 failure, not a
      // silent pass (docs/CHAOS_SCENARIOS.md Section 23 Section 7; this
      // task's Finding 3).
      readonly freshOrderId?: string;
    }
  | {
      readonly scenarioId: "C11";
      readonly mechanism: "B";
      readonly failureEvidence: ChaosFailureEvidenceRef;
    };

/** The ten official Chaos Run Precheck IDs (docs/CHAOS_SCENARIOS.md Section 11). Kept complete even though this implementation's deterministic evaluation order (this task's Section 9) means PRECHECK-03/04 never independently produce the FIRST failure given this application's current configuration surface — see `lib/chaos/safety-gate.ts` module doc comment for why. */
export type ChaosPrecheckId =
  | "PRECHECK-01"
  | "PRECHECK-02"
  | "PRECHECK-03"
  | "PRECHECK-04"
  | "PRECHECK-05"
  | "PRECHECK-06"
  | "PRECHECK-07"
  | "PRECHECK-08"
  | "PRECHECK-09"
  | "PRECHECK-10";

/**
 * Phase 3A's own result contract (this task's Section 8) — deliberately
 * NOT `PASS`/`FAIL`/`UNKNOWN`/`ERROR` and no `chaos_run_id`. Those belong to
 * the actual chaos run/invariant-evaluation lifecycle (Phase 3B+), which
 * Phase 3A does not implement. `PRECHECK_PASSED` means only "Phase 3A's ten
 * deterministic scenario/prerequisite safety checks passed" — it is
 * explicitly not "chaos may now inject a fault" (this task's Section 13;
 * PRE-SEC-007/010/011 remain Phase 3B's to establish).
 */
export type ChaosPrecheckResult =
  | {
      readonly status: "PRECHECK_PASSED";
      readonly scenarioId: ChaosScenarioId;
      readonly mechanism: ChaosMechanismSelector;
    }
  | {
      readonly status: "BLOCKED";
      readonly failedPrecheckId: ChaosPrecheckId;
      readonly reasonCode: string;
      readonly reason: string;
    };
