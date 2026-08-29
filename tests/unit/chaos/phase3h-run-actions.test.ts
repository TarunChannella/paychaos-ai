import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

vi.mock("server-only", () => ({}));

import { availableActions } from "@/app/chaos/runs/[runId]/run-actions";

/**
 * Phase 3H Round 2B — the run-action state machine and its static safety.
 *
 * The state machine is the security-relevant part: it decides which frozen
 * chaos route the operator can reach. Proving it through the DOM alone would
 * be weaker, so it is exported and tested directly, with a static guard over
 * the component source for the properties behaviour cannot show.
 */

const base = {
  runId: "99999999-9999-4999-8999-999999999999",
  scenarioId: "C03",
  status: "PENDING",
  hasSourceWebhook: false,
  hasOrder: false,
  isBlocked: false,
  hasInvariantResults: false,
};

const paths = (props: Partial<typeof base>) =>
  availableActions({ ...base, ...props }).map((a) => a.path);

describe("Phase 3H run actions — each scenario reaches only its own routes", () => {
  it("1: a PENDING C01 run offers replay and nothing else", () => {
    expect(paths({ scenarioId: "C01" })).toEqual(["replay"]);
  });

  it("2: a PENDING C03 run offers execute-c03 and nothing else", () => {
    expect(paths({ scenarioId: "C03" })).toEqual(["execute-c03"]);
  });

  it("3: a PENDING C07 run offers arm-c07 only — never reconcile before arming", () => {
    expect(paths({ scenarioId: "C07" })).toEqual(["arm-c07"]);
  });

  it("4: a RUNNING C07 run offers reconcile and cancel", () => {
    expect(paths({ scenarioId: "C07", status: "RUNNING" })).toEqual([
      "reconcile-c07",
      "cancel-c07",
    ]);
  });

  it("5: C11-B is identified by its source webhook and offers execute-c11-b", () => {
    expect(paths({ scenarioId: "C11", hasSourceWebhook: true })).toEqual([
      "execute-c11-b",
    ]);
  });

  it("6: C11-A is identified by the ABSENCE of a source webhook", () => {
    expect(
      paths({ scenarioId: "C11", hasSourceWebhook: false, hasOrder: true }),
    ).toEqual(["start-c11-a"]);
  });

  it("7: a RUNNING C11-A run offers reconcile and cancel", () => {
    expect(
      paths({
        scenarioId: "C11",
        status: "RUNNING",
        hasOrder: true,
        hasSourceWebhook: false,
      }),
    ).toEqual(["reconcile-c11-a", "cancel-c11-a"]);
  });

  it("8: C11-B is NEVER routed through C01 replay or the C11-A workflow", () => {
    const c11b = paths({ scenarioId: "C11", hasSourceWebhook: true });
    expect(c11b).not.toContain("replay");
    expect(c11b).not.toContain("start-c11-a");
    expect(c11b).not.toContain("reconcile-c11-a");
    // And a RUNNING C11-B offers nothing — it completes in one call.
    expect(
      paths({ scenarioId: "C11", status: "RUNNING", hasSourceWebhook: true }),
    ).toEqual([]);
  });

  it("9: no scenario can reach another scenario's routes", () => {
    const forbidden: Record<string, string[]> = {
      C01: ["execute-c03", "arm-c07", "start-c11-a", "execute-c11-b"],
      C03: ["replay", "arm-c07", "start-c11-a", "execute-c11-b"],
      C07: ["replay", "execute-c03", "execute-c11-b", "start-c11-a"],
    };
    for (const [scenarioId, banned] of Object.entries(forbidden)) {
      const offered = paths({ scenarioId });
      for (const route of banned) {
        expect(offered, `${scenarioId} must not reach ${route}`).not.toContain(
          route,
        );
      }
    }
  });

  it("10: an unknown scenario offers nothing", () => {
    expect(paths({ scenarioId: "C02" })).toEqual([]);
    expect(paths({ scenarioId: "" })).toEqual([]);
  });
});

describe("Phase 3H run actions — evaluation", () => {
  it("11: evaluation is offered only once the run is COMPLETED", () => {
    expect(paths({ status: "COMPLETED" })).toEqual(["evaluate"]);
    for (const status of ["PENDING", "RUNNING", "FAILED"]) {
      expect(paths({ scenarioId: "C01", status }), status).not.toContain(
        "evaluate",
      );
    }
  });

  it("12: a completed run with results offers re-evaluation, still on the same route", () => {
    const actions = availableActions({
      ...base,
      status: "COMPLETED",
      hasInvariantResults: true,
    });
    expect(actions.map((a) => a.path)).toEqual(["evaluate"]);
    expect(actions[0]!.label).toMatch(/re-run/i);
  });

  it("13: every COMPLETED scenario evaluates through the SAME frozen route", () => {
    for (const scenarioId of ["C01", "C03", "C07", "C11"]) {
      expect(paths({ scenarioId, status: "COMPLETED" })).toEqual(["evaluate"]);
    }
  });
});

describe("Phase 3H run actions — blocked runs", () => {
  it("14: a blocked run offers NO action at all", () => {
    for (const scenarioId of ["C01", "C03", "C07", "C11"]) {
      expect(paths({ scenarioId, isBlocked: true }), scenarioId).toEqual([]);
    }
  });

  it("15: a blocked run is never offered evaluation, even if marked COMPLETED", () => {
    expect(
      paths({ scenarioId: "C03", status: "COMPLETED", isBlocked: true }),
    ).toEqual([]);
  });
});

describe("Phase 3H run actions — derived from persisted state only", () => {
  it("16: identical persisted state always yields identical actions", () => {
    // No click history, no local memory: the function is pure.
    const props = { scenarioId: "C07", status: "RUNNING" as const };
    const first = paths(props);
    for (let i = 0; i < 20; i += 1) {
      expect(paths(props)).toEqual(first);
    }
  });

  it("17: the C11 mechanism follows the correlation, not any caller flag", () => {
    // The frozen repository separates C11-A/C11-B by source_webhook_event_id;
    // flipping only that field must flip the offered action.
    expect(paths({ scenarioId: "C11", hasSourceWebhook: true })).toEqual([
      "execute-c11-b",
    ]);
    expect(
      paths({ scenarioId: "C11", hasSourceWebhook: false, hasOrder: true }),
    ).toEqual(["start-c11-a"]);
  });

  it("18: a C11 run with neither correlation offers nothing rather than guessing", () => {
    expect(
      paths({ scenarioId: "C11", hasSourceWebhook: false, hasOrder: false }),
    ).toEqual([]);
  });
});

describe("Phase 3H run actions — C11 mechanism A is never inferred from 'not B'", () => {
  // The frozen `startPendingC11ARunAtomically` requires `order_id IS NOT NULL`
  // AND `source_webhook_event_id IS NULL`. A run missing BOTH correlations
  // satisfies neither mechanism's persisted shape, so claiming A would assert
  // a mechanism the database does not support.

  it("A: PENDING C11 with a source webhook is mechanism B", () => {
    expect(
      paths({ scenarioId: "C11", hasSourceWebhook: true, hasOrder: false }),
    ).toEqual(["execute-c11-b"]);
  });

  it("B: PENDING C11 with no source but an order is mechanism A", () => {
    expect(
      paths({ scenarioId: "C11", hasSourceWebhook: false, hasOrder: true }),
    ).toEqual(["start-c11-a"]);
  });

  it("C: PENDING C11 with NEITHER correlation offers no action", () => {
    expect(
      paths({ scenarioId: "C11", hasSourceWebhook: false, hasOrder: false }),
    ).toEqual([]);
  });

  it("D: RUNNING C11 with the COMPLETE A shape offers reconcile and cancel", () => {
    expect(
      paths({
        scenarioId: "C11",
        status: "RUNNING",
        hasSourceWebhook: false,
        hasOrder: true,
      }),
    ).toEqual(["reconcile-c11-a", "cancel-c11-a"]);
  });

  it("E: RUNNING C11 with an INCOMPLETE shape offers NO action", () => {
    // This is the corrected behaviour: absence of a source webhook alone is
    // not evidence of mechanism A.
    expect(
      paths({
        scenarioId: "C11",
        status: "RUNNING",
        hasSourceWebhook: false,
        hasOrder: false,
      }),
    ).toEqual([]);
  });

  it("F: an incomplete C11 shape shows NO staged C11-A guidance", () => {
    // Guidance is itself a claim about the mechanism, so it must follow the
    // same complete-shape rule as the controls.
    const incomplete = stripComments(componentRaw);
    expect(incomplete).toContain(
      'c11Mechanism(props.hasSourceWebhook, props.hasOrder) === "A"',
    );
    // And the guidance function must not test the source webhook alone.
    expect(incomplete).not.toMatch(/!isC11B\(/);
    expect(incomplete).not.toMatch(/!props\.hasSourceWebhook/);
  });

  it("G: C11-B never receives any C11-A control, in either status", () => {
    for (const status of ["PENDING", "RUNNING"]) {
      const offered = paths({
        scenarioId: "C11",
        status,
        hasSourceWebhook: true,
        hasOrder: true,
      });
      for (const forbidden of [
        "start-c11-a",
        "reconcile-c11-a",
        "cancel-c11-a",
      ]) {
        expect(offered, `${status} :: ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("H: the mechanism is never supplied by the caller — only correlations decide", () => {
    // There is no mechanism/action/url prop on the component at all.
    const functional = stripComments(componentRaw);
    expect(functional).not.toMatch(/mechanism\??:\s*("A"|"B"|string)/);
    for (const forbidden of [
      "actionUrl",
      "endpoint",
      "routePath",
      "method:",
      "faultConfig",
      "fault_config",
    ]) {
      if (forbidden === "method:") {
        // The single POST is hard-coded, never taken from a prop.
        expect(functional).toMatch(/method:\s*"POST"/);
        expect(functional).not.toMatch(/method:\s*props\./);
        continue;
      }
      expect(functional, forbidden).not.toContain(forbidden);
    }
  });
});

// ==========================================================================
// STATIC GUARD — properties the behaviour above cannot demonstrate.
// ==========================================================================

const repoRoot = path.resolve(import.meta.dirname, "../../../");
const COMPONENT = "app/chaos/runs/[runId]/run-actions.tsx";
const FINDING_PAGE =
  "app/chaos/findings/invariant-results/[invariantResultId]/page.tsx";

function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => {
      const idx = line.indexOf("//");
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join("\n");
}

const componentRaw = fs.readFileSync(path.join(repoRoot, COMPONENT), "utf-8");
const component = stripComments(componentRaw);
const findingPage = stripComments(
  fs.readFileSync(path.join(repoRoot, FINDING_PAGE), "utf-8"),
);

describe("Phase 3H run actions — static safety", () => {
  it("19: the only fetch target is a fixed suffix on this run's own id", () => {
    const fetches = [...component.matchAll(/fetch\(([^)]*)/g)].map(
      (m) => m[1]!,
    );
    expect(fetches).toHaveLength(1);
    expect(fetches[0]!).toContain("`/api/chaos/runs/${props.runId}/${path}`");
    // No absolute URL, host or caller-supplied endpoint anywhere.
    for (const forbidden of [
      "http://",
      "https://",
      "//",
      "baseUrl",
      "origin",
    ]) {
      expect(component, forbidden).not.toContain(forbidden);
    }
  });

  it("20: the action set is a closed literal set of frozen route suffixes", () => {
    // Scoped to the ACTION_PATHS table itself, so a `testId` value elsewhere
    // in the component cannot be mistaken for a route suffix.
    const table = component.match(
      /const ACTION_PATHS = \{([\s\S]*?)\} as const;/,
    )!;
    const suffixes = [...table[1]!.matchAll(/:\s*"([a-z0-9-]+)"/g)].map(
      (m) => m[1]!,
    );
    expect([...new Set(suffixes)].sort()).toEqual([
      "arm-c07",
      "cancel-c07",
      "cancel-c11-a",
      "evaluate",
      "execute-c03",
      "execute-c11-b",
      "reconcile-c07",
      "reconcile-c11-a",
      "replay",
      "start-c11-a",
    ]);
  });

  it("21: no request body, fault config, classification or verdict is ever sent", () => {
    expect(component).toMatch(/method:\s*"POST"/);
    // These frozen routes accept no body; sending one would be inventing a
    // payload field.
    expect(component).not.toMatch(/body:\s*JSON\.stringify/);
    for (const forbidden of [
      "fault_config",
      "faultConfig",
      "fault_state",
      "faultState",
      "data_classification",
      "dataClassification",
      "faultType",
      "replayCount",
    ]) {
      expect(component, forbidden).not.toContain(forbidden);
    }
  });

  it("22: the component never computes an invariant verdict", () => {
    for (const forbidden of [
      "evaluateInvariant",
      "INVARIANT_EVALUATORS",
      "deriveAggregateOutcome",
      "buildEvidenceTimeline",
    ]) {
      expect(component, forbidden).not.toContain(forbidden);
    }
    // It never assigns a result of its own either.
    expect(component).not.toMatch(
      /(result|outcome)\s*=\s*["'`](PASS|FAIL|UNKNOWN)["'`]/,
    );
  });

  it("23: persisted state is re-read after every mutation", () => {
    expect(component).toContain("router.refresh()");
  });

  it("24: no secret, credential or Supabase access appears in the client bundle", () => {
    for (const forbidden of [
      "SUPABASE_SERVICE_ROLE_KEY",
      "RAZORPAY_KEY_SECRET",
      "RAZORPAY_WEBHOOK_SECRET",
      "PAYCHAOS_ACCESS_TOKEN",
      "PAYCHAOS_SESSION_SECRET",
      "getSupabaseServerClient",
      "server-only",
      "process.env",
    ]) {
      expect(componentRaw, forbidden).not.toContain(forbidden);
    }
  });

  it("25: no Razorpay call is made from the browser", () => {
    expect(component.toLowerCase()).not.toContain("razorpay.com");
    expect(component).not.toContain("new Razorpay");
    // The staged guidance names Razorpay in prose only, and says PayChaos does
    // NOT perform the payment.
    expect(componentRaw).toMatch(/PayChaos does not make the payment/i);
    expect(componentRaw).toMatch(/never fabricates a provider failure/i);
  });
});

describe("Phase 3H Finding page — static safety", () => {
  it("26: it consumes the FROZEN Phase 3G read model", () => {
    expect(findingPage).toContain("getFindingDetailByInvariantResultId");
    expect(findingPage).toContain('from "@/lib/findings/service"');
  });

  it("27: it runs no query of its own — no second Finding join exists", () => {
    for (const forbidden of [
      "getSupabaseServerClient",
      '.from("findings")',
      '.from("invariant_results")',
      "listFindingSummariesForInvariantResults",
    ]) {
      expect(findingPage, forbidden).not.toContain(forbidden);
    }
  });

  it("28: it exposes NO Phase 4 surface", () => {
    const lower = findingPage.toLowerCase();
    for (const forbidden of [
      "diagnosis",
      "root cause",
      "rootcause",
      "recommendation",
      "regression",
      "reliability score",
      "go-live",
      "confidence",
    ]) {
      expect(lower, forbidden).not.toContain(forbidden);
    }
  });

  it("29: it renders expected, observed, reason and evidence references", () => {
    for (const required of [
      "expectedSummary",
      "observedSummary",
      "reason",
      "evidenceRefs",
    ]) {
      expect(findingPage, required).toContain(required);
    }
  });

  it("30: it links back to the run's evidence timeline rather than rebuilding it", () => {
    expect(findingPage).toContain("view-run-timeline");
    expect(findingPage).not.toContain("assembleChaosRunEvidence");
    expect(findingPage).not.toContain("buildEvidenceTimeline");
  });

  it("30b: ONLY genuine absence becomes a 404 — read/integrity failures do not", () => {
    // A blanket `catch { notFound(); }` would tell an operator that a
    // reliability issue does not exist because a SELECT failed.
    expect(findingPage).not.toMatch(/catch\s*\{\s*notFound\(\);?\s*\}/);
    expect(findingPage).not.toMatch(
      /catch\s*\([^)]*\)\s*\{\s*notFound\(\);?\s*\}/,
    );

    // The one condition that may 404 is the frozen absence code.
    expect(findingPage).toContain('"FINDING_NOT_FOUND"');

    // Everything else is re-thrown to Next's normal server error handling.
    expect(findingPage).toMatch(/throw error;/);

    // The read-failure and integrity codes are never mapped to notFound.
    const notFoundBlock = findingPage.match(
      /catch \(error\) \{([\s\S]*?)\n  \}/,
    );
    expect(notFoundBlock).not.toBeNull();
    for (const forbidden of [
      "FINDING_READ_FAILED",
      "FINDING_INTEGRITY_CONFLICT",
      "FINDING_INVARIANT_VERSION_MISMATCH",
      "FINDING_INVARIANT_UNKNOWN",
    ]) {
      expect(notFoundBlock![1]!, forbidden).not.toContain(forbidden);
    }
  });

  it("30c: no raw database message is ever rendered", () => {
    // The caught error is re-thrown, never interpolated into the page.
    expect(findingPage).not.toMatch(/\{\s*\(?error as Error\)?\.message/);
    expect(findingPage).not.toMatch(/\{String\(error\)\}/);
    expect(findingPage).not.toMatch(/\{error\}/);
    expect(findingPage).not.toContain(".stack");
  });

  it("31: no raw payload, signature VALUE or secret can reach this page", () => {
    // The page's own prose says "No payload, signature or customer data is
    // stored or shown here" — a true statement about what it omits. Banning
    // the bare word would flag that honesty, so this bans the FIELDS a leak
    // would actually travel in.
    for (const forbidden of [
      "raw_payload",
      "normalized_event",
      "raw_body_sha256",
      "x-razorpay-signature",
      "signatureVerified",
      "SERVICE_ROLE",
      "fault_config",
      "fault_state",
      "process.env",
    ]) {
      expect(findingPage, forbidden).not.toContain(forbidden);
    }
    // And no long hex run that could be a digest or signature.
    expect(findingPage).not.toMatch(/\b[0-9a-f]{32,}\b/);
  });
});
