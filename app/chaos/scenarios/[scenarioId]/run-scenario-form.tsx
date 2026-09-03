"use client";

/**
 * Phase 3H — the run action.
 *
 * NO ARBITRARY TARGET. This component has no URL, host, endpoint, fault,
 * replay-count or classification input. It can post exactly one of the five
 * frozen request shapes, and the only free value it carries is an identifier
 * the SERVER already listed as eligible on this page.
 *
 * It also never renders a verdict. Creating a run produces an audit record;
 * whether an invariant passed is decided later by the deterministic engine and
 * read from the run screen.
 */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { EligibilityResult } from "@/lib/chaos/eligibility-service";

import {
  isLockedStatus,
  isUnavailableStatus,
  UNAVAILABLE_MESSAGE,
  useDemoUnlock,
} from "@/components/access/use-demo-unlock";

const DEFAULT_ERROR =
  "Could not start the chaos run. Please re-check prerequisites and try again.";

/** Copy for the two "nothing to select" states, kept factual. */
const NO_CANDIDATES =
  "No eligible subject exists right now. Create a fresh Test Mode payment, then reload this page.";

function mechanismHeading(mechanism: "A" | "B" | null): string {
  if (mechanism === "A") return "Mechanism C11-A — Genuine Failure Observation";
  if (mechanism === "B") return "Mechanism C11-B — Controlled Replay";
  return "Run scenario";
}

export function RunScenarioForm({
  scenarioId,
  mechanism,
  eligibility,
  enabled,
}: {
  readonly scenarioId: string;
  readonly mechanism: "A" | "B" | null;
  readonly eligibility: EligibilityResult;
  readonly enabled: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const { requestUnlock, unlockDialog } = useDemoUnlock();
  const [selected, setSelected] = useState<string | null>(null);

  const needsSubject = eligibility.kind !== "NO_SOURCE_REQUIRED";
  const candidates =
    eligibility.kind === "WEBHOOK_SOURCES"
      ? eligibility.candidates
      : eligibility.kind === "ORDER_SUBJECTS"
        ? eligibility.candidates
        : [];

  const canRun = enabled && !isPending && (!needsSubject || selected !== null);

  /** Builds exactly one of the five accepted bodies. Never a generic map. */
  function requestBody(): Record<string, string> | null {
    if (scenarioId === "C03") return { scenarioId: "C03" };
    if (selected === null) return null;
    if (scenarioId === "C01") {
      return { scenarioId: "C01", sourceWebhookEventId: selected };
    }
    if (scenarioId === "C07") {
      return { scenarioId: "C07", freshOrderId: selected };
    }
    if (mechanism === "A") {
      return { scenarioId: "C11", mechanism: "A", freshOrderId: selected };
    }
    return {
      scenarioId: "C11",
      mechanism: "B",
      sourceWebhookEventId: selected,
    };
  }

  function handleRun() {
    setError(null);
    const body = requestBody();
    if (body === null) return;

    startTransition(async () => {
      try {
        const response = await fetch("/api/chaos/runs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const result = (await response.json()) as {
          kind?: string;
          chaosRunId?: string;
          reason?: string;
        };

        // Offer the code and resume this exact run request. Checked before
        // the BLOCKED branch because an unauthorized call never persisted a
        // run to navigate to.
        if (isLockedStatus(response.status)) {
          requestUnlock(handleRun);
          return;
        }
        if (isUnavailableStatus(response.status)) {
          setError(UNAVAILABLE_MESSAGE);
          return;
        }

        // A BLOCKED run that was still persisted is a real, inspectable audit
        // record — navigate to it rather than reporting a failure.
        if (result.chaosRunId) {
          router.push(`/chaos/runs/${result.chaosRunId}`);
          return;
        }
        setError(result.reason ?? DEFAULT_ERROR);
      } catch {
        setError(DEFAULT_ERROR);
      }
    });
  }

  return (
    <section
      className="rounded-lg border border-border bg-card p-5"
      data-testid={`run-form-${scenarioId}${mechanism ?? ""}`}
    >
      {unlockDialog}
      <h2 className="text-sm font-semibold text-card-foreground">
        {mechanismHeading(mechanism)}
      </h2>

      {!needsSubject && (
        <p className="mt-2 text-xs text-muted-foreground">
          This scenario verifies PayChaos&apos;s own internal path and takes no
          payment or event as a subject.
        </p>
      )}

      {needsSubject && candidates.length === 0 && (
        <p
          className="mt-2 text-xs text-muted-foreground"
          data-testid="no-candidates"
        >
          {NO_CANDIDATES}
        </p>
      )}

      {needsSubject && candidates.length > 0 && (
        <fieldset className="mt-3 flex flex-col gap-2">
          <legend className="sr-only">Choose an eligible subject</legend>
          {candidates.map((candidate) => {
            const id =
              candidate.kind === "WEBHOOK_EVENT"
                ? candidate.webhookEventId
                : candidate.orderId;
            return (
              <label
                key={id}
                className="flex cursor-pointer items-start gap-2 rounded-md border border-border p-3 text-xs"
              >
                <input
                  type="radio"
                  name={`subject-${scenarioId}-${mechanism ?? "single"}`}
                  value={id}
                  checked={selected === id}
                  onChange={() => setSelected(id)}
                  className="mt-0.5"
                />
                <span className="flex flex-col gap-0.5">
                  <span className="font-mono text-foreground">{id}</span>
                  {candidate.kind === "WEBHOOK_EVENT" ? (
                    <span className="text-muted-foreground">
                      {candidate.eventType} · received {candidate.receivedAt} ·
                      classification {candidate.sourceKind}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">
                      payment {candidate.paymentStatus} · business{" "}
                      {candidate.businessStatus} · fulfilments{" "}
                      {candidate.fulfilmentCount}
                    </span>
                  )}
                </span>
              </label>
            );
          })}
        </fieldset>
      )}

      <button
        type="button"
        onClick={handleRun}
        disabled={!canRun}
        data-testid={`run-button-${scenarioId}${mechanism ?? ""}`}
        className="mt-4 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
      >
        {isPending ? "Starting chaos run…" : "Start chaos run"}
      </button>

      {error && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
