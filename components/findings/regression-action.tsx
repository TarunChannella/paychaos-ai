"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  isLockedStatus,
  isUnavailableStatus,
  UNAVAILABLE_MESSAGE,
  useDemoUnlock,
} from "@/components/access/use-demo-unlock";

/**
 * Phase 5B correction — the regression control (P4-AC-06).
 *
 * AN ADAPTER, NOT AN ENGINE. This component POSTs to the frozen Phase 4E
 * routes and renders what they return. It contains no eligibility rule, no
 * scenario selection, no chaos execution, no invariant evaluation, no finding
 * lifecycle decision and no score arithmetic. Every one of those stays in the
 * Phase 4E service, which is the only thing allowed to decide them.
 *
 * THE SERVER DERIVES THE SCENARIO. Only the internal finding id is sent. The
 * caller cannot choose a scenario, a target, a chaos run or an order, so no
 * eligibility or safety gate can be bypassed from the browser.
 *
 * IT NEVER FABRICATES COMPLETION. `AWAITING_EXTERNAL_ACTION` is reported as
 * exactly that — a real Test Mode action is still required, and the UI says
 * so rather than quietly turning it into a pass. `FIX VERIFIED` is never
 * rendered here at all; it is rendered by the casefile panel, and only from a
 * persisted `RESOLVED` status.
 *
 * NO DOUBLE SUBMIT. The button disables on the first click and an in-flight
 * ref rejects a duplicate even if an event races the disabled attribute —
 * two concurrent starts would otherwise race the active-regression guard and
 * produce an orphan run.
 */

/** The lifecycle kinds the Phase 4E routes can return. */
const KIND_MESSAGE: Record<string, string> = {
  COMPLETED: "The regression reached a verdict. The result is shown below.",
  AWAITING_EXTERNAL_ACTION:
    "The regression is waiting for the required Razorpay Test Mode action. It is NOT complete, and no result will be claimed until that genuine action produces evidence.",
  IN_PROGRESS: "The regression is running. No verdict has been reached yet.",
  SUPERSEDED:
    "This attempt reached a verdict, but a newer attempt has since been recorded for this finding. The newer attempt stands.",
  ERRORED:
    "The regression could not be completed. This is an execution error, not a passing result.",
  NOT_STARTED:
    "The server refused to start a regression for this finding. No regression was created.",
  ORPHAN_START:
    "Another regression start won the race for this finding. The safety-gated run it created is preserved as audit evidence and was never executed.",
};

type Phase = "idle" | "running";

export function RegressionAction({
  findingId,
  activeRegressionRunId,
}: {
  readonly findingId: string;
  /** Set when a PENDING/RUNNING regression already exists for this finding. */
  readonly activeRegressionRunId: string | null;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [kind, setKind] = useState<string | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const inFlight = useRef(false);
  const { requestUnlock, unlockDialog } = useDemoUnlock();

  const isBusy = phase === "running";

  async function post(url: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setPhase("running");
    setKind(null);
    setReason(null);
    setFailed(false);

    try {
      const response = await fetch(url, { method: "POST" });
      const body: unknown = await response.json().catch(() => null);
      const record =
        body !== null && typeof body === "object"
          ? (body as Record<string, unknown>)
          : {};

      const returnedKind =
        typeof record["kind"] === "string" ? (record["kind"] as string) : null;
      const returnedReason =
        typeof record["reason"] === "string"
          ? (record["reason"] as string)
          : null;

      // The in-flight guard is released before offering the code, or the
      // resumed request would be rejected as a duplicate submit.
      if (isLockedStatus(response.status)) {
        inFlight.current = false;
        setPhase("idle");
        requestUnlock(() => void post(url));
        return;
      }
      if (isUnavailableStatus(response.status)) {
        setFailed(true);
        setReason(UNAVAILABLE_MESSAGE);
        return;
      }
      if (!response.ok) {
        // A 409 carries a real domain refusal (NOT_STARTED / ORPHAN_START);
        // anything else is reported as a plain failure. Neither is success.
        setFailed(true);
        setKind(returnedKind);
        setReason(
          returnedReason ??
            (typeof record["error"] === "string"
              ? (record["error"] as string)
              : null),
        );
        return;
      }

      setKind(returnedKind);
      // The casefile is server-derived, so the persisted status, the
      // before/after evidence and the finding lifecycle are re-read rather
      // than patched locally from this response.
      router.refresh();
    } catch {
      setFailed(true);
      setReason("The regression request could not be sent.");
    } finally {
      setPhase("idle");
      inFlight.current = false;
    }
  }

  const hasActive = activeRegressionRunId !== null;

  return (
    <div
      className="flex flex-col gap-3 border-t border-border pt-4"
      data-testid="regression-action"
    >
      {unlockDialog}
      <div className="flex flex-wrap items-center gap-3">
        {hasActive ? (
          <button
            type="button"
            onClick={() =>
              void post(`/api/regressions/${activeRegressionRunId}/advance`)
            }
            disabled={isBusy}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
            data-testid="regression-advance"
          >
            {isBusy ? "Advancing…" : "Advance regression"}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void post(`/api/findings/${findingId}/regressions`)}
            disabled={isBusy}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
            data-testid="regression-start"
          >
            {isBusy ? "Starting regression…" : "Run Regression Test"}
          </button>
        )}

        <span className="text-xs text-muted-foreground">
          {hasActive
            ? "A regression is already open for this finding. PayChaos advances the existing attempt rather than starting a second one."
            : "Re-runs this finding's scenario against the merchant and evaluates the same money invariants again."}
        </span>
      </div>

      {(kind !== null || reason !== null) && (
        <div
          role={failed ? "alert" : "status"}
          aria-live="polite"
          className={
            failed
              ? "rounded-md border border-destructive/40 p-3 text-xs text-destructive"
              : "rounded-md border border-border p-3 text-xs text-muted-foreground"
          }
          data-testid="regression-action-result"
        >
          {kind !== null && (
            <span
              className="font-mono font-semibold"
              data-testid="regression-action-kind"
            >
              {kind}
            </span>
          )}
          <p className="mt-1">
            {(kind !== null ? KIND_MESSAGE[kind] : null) ??
              reason ??
              "The regression request did not succeed."}
          </p>
          {reason !== null && kind !== null && (
            <p
              className="mt-1 font-mono"
              data-testid="regression-action-reason"
            >
              {reason}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
