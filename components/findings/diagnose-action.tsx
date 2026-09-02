"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Phase 4H-0 — the Diagnose Finding control.
 *
 * AN ADAPTER, NOT AN ENGINE. It POSTs the finding id and re-reads the
 * server-derived page. It contains no classification rule, no recommendation
 * mapping, no evidence assembly and no scoring — every decision belongs to the
 * frozen Phase 4C/4D services behind the route.
 *
 * IDEMPOTENT, SO REPEATABLE. The services perform guarded writes: a repeated
 * request performs no second write and keeps the original `diagnosedAt`. The
 * button therefore stays available after success rather than pretending the
 * action is spent.
 *
 * NO DOUBLE SUBMIT. Disabled on click plus an in-flight guard, so a duplicate
 * event cannot race the request.
 *
 * A REFUSAL IS NOT A FAILURE. The Phase 4 services legitimately refuse to
 * diagnose a finding whose evidence cannot support one. That returns a stable
 * code, which is shown as a refusal with its reason — never as a crash, and
 * never as a diagnosis.
 */

/** Deterministic wording for the domain refusals the services can return. */
const CODE_MESSAGE: Record<string, string> = {
  EVIDENCE_PACK_FINDING_NOT_FOUND: "No finding exists for this identifier.",
  EVIDENCE_PACK_INVARIANT_NOT_FAILED:
    "This invariant result is not a FAIL, so there is nothing to diagnose.",
  EVIDENCE_PACK_READ_FAILED:
    "The evidence required to diagnose this finding could not be read.",
  RECOMMENDATION_DIAGNOSIS_MISMATCH:
    "The diagnosis changed while the recommendation was being written. Try again.",
};

type Phase = "idle" | "running";

export function DiagnoseAction({
  findingId,
  alreadyDiagnosed,
}: {
  readonly findingId: string;
  readonly alreadyDiagnosed: boolean;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const inFlight = useRef(false);

  const isBusy = phase === "running";

  async function handleDiagnose() {
    if (inFlight.current) return;
    inFlight.current = true;
    setPhase("running");
    setMessage(null);
    setFailed(false);

    try {
      const response = await fetch(`/api/findings/${findingId}/diagnose`, {
        method: "POST",
      });
      const body: unknown = await response.json().catch(() => null);
      const record =
        body !== null && typeof body === "object"
          ? (body as Record<string, unknown>)
          : {};

      if (!response.ok) {
        const code =
          typeof record["code"] === "string"
            ? (record["code"] as string)
            : null;
        setFailed(true);
        setMessage(
          code === null
            ? "The finding could not be diagnosed."
            : (CODE_MESSAGE[code] ??
                `The finding could not be diagnosed (${code}).`),
        );
        return;
      }

      // The persisted diagnosis is authoritative, so the page is re-read
      // rather than patched from this response.
      setMessage("Diagnosis recorded.");
      router.refresh();
    } catch {
      setFailed(true);
      setMessage("The diagnosis request could not be sent.");
    } finally {
      setPhase("idle");
      inFlight.current = false;
    }
  }

  return (
    <div className="flex flex-col gap-2" data-testid="diagnose-action">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void handleDiagnose()}
          disabled={isBusy}
          className="inline-flex items-center justify-center rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
          data-testid="diagnose-submit"
        >
          {isBusy
            ? "Diagnosing…"
            : alreadyDiagnosed
              ? "Re-run diagnosis"
              : "Diagnose finding"}
        </button>
        <span className="text-xs text-muted-foreground">
          Runs the deterministic root-cause rules over this finding&apos;s
          persisted evidence. No model is involved.
        </span>
      </div>

      {message !== null && (
        <p
          role={failed ? "alert" : "status"}
          aria-live="polite"
          className={
            failed
              ? "text-xs text-destructive"
              : "text-xs text-muted-foreground"
          }
          data-testid="diagnose-message"
        >
          {message}
        </p>
      )}
    </div>
  );
}
