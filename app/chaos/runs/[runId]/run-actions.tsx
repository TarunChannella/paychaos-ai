"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

/**
 * Phase 3H Round 2B — the operator's run controls.
 *
 * WHAT THIS COMPONENT IS ALLOWED TO DO. POST to one of a CLOSED set of
 * internal chaos routes that already exist and already enforce their own
 * operator access gate, then refresh the server-rendered page. That is all.
 *
 * THE ACTION SET IS DERIVED FROM PERSISTED STATE, NEVER FROM CLICK HISTORY.
 * Which control appears is computed from `scenarioId`, `status` and the two
 * safe correlations the Round 1 read model already exposes. Nothing here
 * remembers "I pressed Arm, therefore it is armed" — after every mutation the
 * page re-renders from the database, and a browser refresh reconstructs the
 * same controls from the same persisted row. A UI that trusted its own local
 * state could show "armed" for a run the server never armed.
 *
 * NO ARBITRARY TARGET. Every endpoint is a template literal built from a
 * hard-coded suffix and the run's own UUID. There is no URL, host, endpoint,
 * method or action-name prop — a caller cannot point this component anywhere,
 * and no request carries a body at all, because none of these frozen routes
 * accepts one.
 *
 * NO FAULT CONFIGURATION AND NO VERDICT. The browser never sends a fault type,
 * a classification, a mechanism or a result. The server derives all of them.
 * This component also never decides PASS/FAIL/UNKNOWN — it asks the frozen
 * evaluate route and then re-reads what was persisted.
 *
 * C11 MECHANISM. C11-A and C11-B share `scenario_id = "C11"` and both carry
 * `fault_type = null`, so the mechanism cannot come from the fault type. The
 * frozen repository itself separates them by correlation — C11-B starts only
 * when `source_webhook_event_id IS NOT NULL`, C11-A only when it IS NULL — so
 * this component uses exactly that already-safe distinction rather than
 * inventing a new field or asking Round 1 to expose one.
 */

/** The closed set of suffixes this component may ever call. */
const ACTION_PATHS = {
  REPLAY: "replay",
  EXECUTE_C03: "execute-c03",
  EXECUTE_C11B: "execute-c11-b",
  ARM_C07: "arm-c07",
  RECONCILE_C07: "reconcile-c07",
  CANCEL_C07: "cancel-c07",
  START_C11A: "start-c11-a",
  RECONCILE_C11A: "reconcile-c11-a",
  CANCEL_C11A: "cancel-c11-a",
  EVALUATE: "evaluate",
} as const;

type ActionPath = (typeof ACTION_PATHS)[keyof typeof ACTION_PATHS];

interface RunAction {
  readonly path: ActionPath;
  readonly label: string;
  readonly testId: string;
  /** `true` for the destructive/abandon control, styled as secondary. */
  readonly secondary?: boolean;
}

export interface RunActionsProps {
  readonly runId: string;
  readonly scenarioId: string;
  readonly status: string;
  readonly hasSourceWebhook: boolean;
  readonly hasOrder: boolean;
  readonly isBlocked: boolean;
  readonly hasInvariantResults: boolean;
}

/**
 * Which C11 mechanism a persisted run actually is.
 *
 * `INCOMPLETE` is deliberate and important. Mechanism A is not simply "not B":
 * the frozen `startPendingC11ARunAtomically` requires `order_id IS NOT NULL`
 * **and** `source_webhook_event_id IS NULL`, so a run missing both correlations
 * satisfies neither mechanism's persisted shape. Treating that as A — because
 * it merely lacks a source webhook — would offer C11-A controls and C11-A
 * guidance for a run the server would refuse, and would assert a mechanism the
 * database does not support. When the shape is incomplete this component
 * offers nothing and claims nothing.
 */
type C11Mechanism = "B" | "A" | "INCOMPLETE";

function c11Mechanism(
  hasSourceWebhook: boolean,
  hasOrder: boolean,
): C11Mechanism {
  if (hasSourceWebhook) return "B";
  if (hasOrder) return "A";
  return "INCOMPLETE";
}

/**
 * The controls a run may legitimately offer right now.
 *
 * Exported for direct unit testing: the state machine is the security-relevant
 * part, and proving it through the DOM alone would be weaker.
 */
export function availableActions(props: RunActionsProps): readonly RunAction[] {
  const { scenarioId, status, isBlocked, hasSourceWebhook, hasOrder } = props;

  // A blocked run never executed and never will. Offering it an execute or
  // evaluate control would imply the opposite.
  if (isBlocked) return [];

  if (status === "PENDING") {
    switch (scenarioId) {
      case "C01":
        return [
          {
            path: ACTION_PATHS.REPLAY,
            label: "Run Duplicate Replay",
            testId: "action-replay",
          },
        ];
      case "C03":
        return [
          {
            path: ACTION_PATHS.EXECUTE_C03,
            label: "Run Invalid Signature Test",
            testId: "action-execute-c03",
          },
        ];
      case "C07":
        return [
          {
            path: ACTION_PATHS.ARM_C07,
            label: "Arm Client Confirmation Drop",
            testId: "action-arm-c07",
          },
        ];
      case "C11": {
        const mechanism = c11Mechanism(hasSourceWebhook, hasOrder);
        if (mechanism === "B") {
          return [
            {
              path: ACTION_PATHS.EXECUTE_C11B,
              label: "Run Controlled Replay (C11-B)",
              testId: "action-execute-c11-b",
            },
          ];
        }
        if (mechanism === "A") {
          return [
            {
              path: ACTION_PATHS.START_C11A,
              label: "Start Failure Observation (C11-A)",
              testId: "action-start-c11-a",
            },
          ];
        }
        // INCOMPLETE — neither persisted shape holds. Offer nothing.
        return [];
      }
      default:
        return [];
    }
  }

  // RUNNING is only reachable for the two STAGED scenarios, which wait on a
  // genuine Razorpay Test Mode action before they can be reconciled.
  if (status === "RUNNING") {
    if (scenarioId === "C07") {
      return [
        {
          path: ACTION_PATHS.RECONCILE_C07,
          label: "Reconcile C07",
          testId: "action-reconcile-c07",
        },
        {
          path: ACTION_PATHS.CANCEL_C07,
          label: "Cancel C07 Fault",
          testId: "action-cancel-c07",
          secondary: true,
        },
      ];
    }
    // A RUNNING C11 run gets the A-workflow controls only when the COMPLETE
    // mechanism-A shape holds — never merely because it is "not B".
    if (
      scenarioId === "C11" &&
      c11Mechanism(hasSourceWebhook, hasOrder) === "A"
    ) {
      return [
        {
          path: ACTION_PATHS.RECONCILE_C11A,
          label: "Reconcile C11-A",
          testId: "action-reconcile-c11-a",
        },
        {
          path: ACTION_PATHS.CANCEL_C11A,
          label: "Cancel C11-A",
          testId: "action-cancel-c11-a",
          secondary: true,
        },
      ];
    }
    return [];
  }

  // Evaluation is offered once the run has actually completed. The frozen
  // evaluator enforces this too and answers 409 otherwise; this only avoids
  // showing a control that could not succeed.
  if (status === "COMPLETED") {
    return [
      {
        path: ACTION_PATHS.EVALUATE,
        label: props.hasInvariantResults
          ? "Re-run Money Invariant Evaluation"
          : "Evaluate Money Invariants",
        testId: "action-evaluate",
      },
    ];
  }

  return [];
}

/** Factual guidance for the two scenarios that wait on a real Test Mode action. */
function stagedGuidance(props: RunActionsProps): string | null {
  if (props.status !== "RUNNING") return null;
  if (props.scenarioId === "C07") {
    return "The client-confirmation drop is armed. Complete the real Razorpay Test Mode payment for this run's order in the Demo Merchant, then reconcile. PayChaos does not make the payment for you.";
  }
  // Guidance is a claim about the mechanism, so it too requires the complete
  // persisted A-shape rather than the absence of a source webhook.
  if (
    props.scenarioId === "C11" &&
    c11Mechanism(props.hasSourceWebhook, props.hasOrder) === "A"
  ) {
    return "Observation has started. A genuine Razorpay Test Mode payment failure must occur through the Demo Merchant before this run can be reconciled. PayChaos never fabricates a provider failure.";
  }
  return null;
}

export function RunActions(props: RunActionsProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<ActionPath | null>(null);

  const actions = availableActions(props);
  const guidance = stagedGuidance(props);

  async function run(path: ActionPath) {
    setError(null);
    setBusy(path);
    try {
      // The URL is a fixed suffix plus this run's own id. Nothing about it is
      // caller-controlled, and no body is sent — these routes accept none.
      const response = await fetch(`/api/chaos/runs/${props.runId}/${path}`, {
        method: "POST",
      });

      if (!response.ok) {
        setError(
          response.status === 409
            ? "This run is no longer in a state that allows that action. Refresh to see its current state."
            : "That action could not be completed.",
        );
        return;
      }

      // Persisted state is the authority: re-read rather than assuming.
      startTransition(() => router.refresh());
    } catch {
      setError("That action could not be completed.");
    } finally {
      setBusy(null);
    }
  }

  if (actions.length === 0 && guidance === null) return null;

  return (
    <section
      className="rounded-lg border border-border bg-card p-5"
      data-testid="run-actions"
    >
      <h2 className="text-sm font-semibold text-card-foreground">
        Controlled actions
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Every action runs against this Demo Merchant only, in Razorpay Test
        Mode.
      </p>

      {guidance !== null && (
        <div
          className="mt-3 rounded-md border border-border p-3"
          data-testid="staged-guidance"
        >
          <p className="text-xs text-card-foreground">{guidance}</p>
          <Link
            href="/demo-merchant"
            className="mt-2 inline-block text-xs underline hover:no-underline"
            data-testid="demo-merchant-link"
          >
            Open Demo Merchant →
          </Link>
        </div>
      )}

      {actions.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {actions.map((action) => (
            <button
              key={action.path}
              type="button"
              data-testid={action.testId}
              disabled={pending || busy !== null}
              onClick={() => void run(action.path)}
              className={
                action.secondary
                  ? "rounded-md border border-border px-3 py-2 text-xs font-medium text-card-foreground disabled:opacity-50"
                  : "rounded-md bg-foreground px-3 py-2 text-xs font-medium text-background disabled:opacity-50"
              }
            >
              {busy === action.path ? "Working…" : action.label}
            </button>
          ))}
        </div>
      )}

      {error !== null && (
        <p className="mt-3 text-xs text-destructive" data-testid="action-error">
          {error}
        </p>
      )}
    </section>
  );
}
