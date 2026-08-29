import "server-only";

import {
  getScenarioDefinition,
  isRegisteredScenarioId,
  listScenarioDefinitions,
} from "@/lib/chaos/registry";
import type {
  ChaosMechanismSelector,
  ChaosScenarioDefinition,
  ChaosScenarioId,
} from "@/lib/chaos/types";

/**
 * Phase 3H — the SAFE, UI-facing projection of the frozen scenario registry.
 *
 * ONE CATALOGUE. This module derives everything from
 * `lib/chaos/registry.ts` and defines no scenario data of its own. A React
 * component must never hold a second list of scenario IDs, required
 * invariants, fault types or prerequisites: a duplicate would drift silently,
 * and the drifted copy would be the one the operator reads.
 *
 * WHAT IS DELIBERATELY ABSENT. There is no field here — and none can be added
 * without changing the frozen `ChaosPrecheckInput` union too — capable of
 * carrying a URL, host, IP, endpoint, script or raw fault configuration. The
 * DTO describes WHICH approved scenario exists, never WHERE to point it.
 *
 * `allowedFaultTypes` is deliberately not exposed either. The fault primitive
 * is server-chosen from the scenario ID; showing it invites a UI that submits
 * it, and the browser must never select a fault.
 */

/** One approved mechanism, in operator-readable form. */
export interface ChaosMechanismDto {
  /** The frozen selector, exactly as the registry stores it. */
  readonly mechanism: ChaosMechanismSelector;
  /** A short label the operator can act on. */
  readonly label: string;
}

export interface ChaosScenarioDto {
  readonly scenarioId: ChaosScenarioId;
  readonly name: string;
  readonly priority: "P0";
  readonly enabled: boolean;
  readonly mechanisms: readonly ChaosMechanismDto[];
  readonly requiredInvariantIds: readonly string[];
  readonly requiredSourceEventTypes: readonly string[];
  readonly requiresRealPayment: boolean;
  readonly requiresVerifiedWebhook: boolean;
  readonly requiresReset: boolean;
  /** Plain-language prerequisites, derived from the registry's own booleans. */
  readonly executionRequirements: readonly string[];
}

/**
 * Mechanism labels.
 *
 * C11 is the one scenario with two approved mechanisms, and they are exposed
 * as MECHANISMS of scenario `C11` — never as scenario IDs `C11A`/`C11B`. The
 * frozen registry says the scenario ID is `C11`, and inventing a sibling ID
 * would make the UI's catalogue disagree with the audit record.
 */
const MECHANISM_LABELS: Record<string, string> = {
  A: "Genuine Failure Observation",
  B: "Controlled Replay",
  C: "Internal Verification Only",
  // C07's frozen mechanism is the COMBINATION tuple ["A", "C"]; it is keyed
  // by its joined form so a combination never falls through to the generic
  // label and never renders as a bare "A,C".
  "A+C": "Observed Failure With Internal Verification",
};

/**
 * A stable key for either a single mechanism or a combination tuple.
 *
 * `Array.isArray` does not narrow a `readonly` tuple union in TypeScript, so
 * the check is written against the union's own shape instead of asserting.
 */
function mechanismKey(mechanism: ChaosMechanismSelector): string {
  return typeof mechanism === "string" ? mechanism : mechanism.join("+");
}

function mechanismLabel(
  scenarioId: ChaosScenarioId,
  mechanism: ChaosMechanismSelector,
): string {
  const key = mechanismKey(mechanism);
  const base = MECHANISM_LABELS[key] ?? "Approved Mechanism";
  // C11's two mechanisms are the only ones an operator must choose BETWEEN,
  // so they carry the documented C11-A / C11-B prefixes the project uses in
  // its own handoffs — without becoming scenario identifiers.
  if (scenarioId === "C11") {
    return `C11-${key} — ${base}`;
  }
  return base;
}

/** Prerequisites in plain language, derived — never hand-maintained. */
function executionRequirements(
  definition: ChaosScenarioDefinition,
): readonly string[] {
  const requirements: string[] = [];

  if (definition.requiresVerifiedWebhook) {
    requirements.push(
      "Requires an existing signature-verified Razorpay Test Mode webhook event.",
    );
  }
  if (definition.requiresRealPayment) {
    requirements.push(
      "Requires genuine Razorpay Test Mode payment evidence already in the database.",
    );
  }
  if (definition.requiredSourceEventTypes.length > 0) {
    requirements.push(
      `Accepted source event types: ${definition.requiredSourceEventTypes.join(", ")}.`,
    );
  }
  if (
    !definition.requiresVerifiedWebhook &&
    !definition.requiresRealPayment &&
    definition.requiredSourceEventTypes.length === 0
  ) {
    requirements.push(
      "Requires no merchant subject — this scenario verifies PayChaos's own internal webhook-verification path.",
    );
  }
  if (definition.requiresReset) {
    requirements.push(
      "May leave business effects that need the demo baseline restored afterwards.",
    );
  }

  return Object.freeze(requirements);
}

function toDto(definition: ChaosScenarioDefinition): ChaosScenarioDto {
  return Object.freeze({
    scenarioId: definition.scenarioId,
    name: definition.name,
    priority: definition.priority,
    enabled: definition.enabled,
    mechanisms: Object.freeze(
      definition.allowedMechanisms.map((mechanism) =>
        Object.freeze({
          mechanism,
          label: mechanismLabel(definition.scenarioId, mechanism),
        }),
      ),
    ),
    requiredInvariantIds: Object.freeze([...definition.requiredInvariants]),
    requiredSourceEventTypes: Object.freeze([
      ...definition.requiredSourceEventTypes,
    ]),
    requiresRealPayment: definition.requiresRealPayment,
    requiresVerifiedWebhook: definition.requiresVerifiedWebhook,
    requiresReset: definition.requiresReset,
    executionRequirements: executionRequirements(definition),
  });
}

/**
 * Every approved P0 scenario, in the registry's own order.
 *
 * Exactly four: C01, C03, C07, C11. A P1 scenario cannot appear here because
 * it does not exist in the frozen registry to begin with.
 */
export function listScenarioDtos(): readonly ChaosScenarioDto[] {
  return Object.freeze(listScenarioDefinitions().map(toDto));
}

/** One scenario, or `null` for an unknown or P1 identifier. Never guesses. */
export function getScenarioDto(scenarioId: unknown): ChaosScenarioDto | null {
  if (!isRegisteredScenarioId(scenarioId)) return null;
  const definition = getScenarioDefinition(scenarioId);
  return definition ? toDto(definition) : null;
}
