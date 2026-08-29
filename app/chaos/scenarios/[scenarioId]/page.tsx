import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import {
  listEligibleSources,
  type EligibilityRequest,
  type EligibilityResult,
} from "@/lib/chaos/eligibility-service";
import { getScenarioDto } from "@/lib/chaos/scenario-dto";

import { RunScenarioForm } from "./run-scenario-form";

/**
 * Phase 3H — scenario detail and run action (docs/PHASE_PLAN.md Section 7.13).
 *
 * Eligible subjects are resolved SERVER-side. The browser never queries for
 * candidates and never names a target: it may only echo back one identifier
 * this page already offered, and `POST /api/chaos/runs` re-validates it before
 * `createChaosRun` runs the full frozen precheck.
 */
export const dynamic = "force-dynamic";

/**
 * C11 is the one scenario with two approved mechanisms, so it needs two
 * candidate lists. Every other scenario has exactly one request shape.
 *
 * These are MECHANISMS of scenario C11 — never scenario IDs `C11A`/`C11B`,
 * which would make the screen disagree with the audit record.
 */
function eligibilityRequests(
  scenarioId: string,
): readonly EligibilityRequest[] {
  if (scenarioId === "C11") {
    return [
      { scenarioId: "C11", mechanism: "A" },
      { scenarioId: "C11", mechanism: "B" },
    ];
  }
  if (scenarioId === "C01") return [{ scenarioId: "C01" }];
  if (scenarioId === "C03") return [{ scenarioId: "C03" }];
  return [{ scenarioId: "C07" }];
}

function mechanismOf(request: EligibilityRequest): "A" | "B" | null {
  return request.scenarioId === "C11" ? request.mechanism : null;
}

export default async function ChaosScenarioPage({
  params,
}: {
  params: Promise<{ scenarioId: string }>;
}) {
  const { scenarioId } = await params;

  // An unknown or P1 identifier is a 404, never a partially-rendered runner.
  const scenario = getScenarioDto(scenarioId);
  if (scenario === null) {
    notFound();
  }

  const requests = eligibilityRequests(scenario.scenarioId);
  const sections: Array<{
    readonly request: EligibilityRequest;
    readonly result: EligibilityResult;
  }> = [];
  for (const request of requests) {
    sections.push({ request, result: await listEligibleSources(request) });
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-16">
      <Link
        href="/chaos"
        className="text-xs text-muted-foreground hover:underline"
      >
        ← Back to Chaos Lab
      </Link>

      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-lg font-semibold text-foreground">
            {scenario.scenarioId}
          </span>
          <Badge variant="outline">{scenario.priority}</Badge>
          {!scenario.enabled && <Badge variant="destructive">Disabled</Badge>}
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {scenario.name}
        </h1>
      </header>

      <section className="rounded-lg border border-border bg-card p-5">
        <h2 className="text-sm font-semibold text-card-foreground">
          Approved mechanisms
        </h2>
        <ul className="mt-2 flex flex-col gap-1">
          {scenario.mechanisms.map((mechanism) => (
            <li key={mechanism.label} className="text-xs text-muted-foreground">
              • {mechanism.label}
            </li>
          ))}
        </ul>

        <h2 className="mt-5 text-sm font-semibold text-card-foreground">
          Prerequisites
        </h2>
        <ul className="mt-2 flex flex-col gap-1">
          {scenario.executionRequirements.map((requirement) => (
            <li key={requirement} className="text-xs text-muted-foreground">
              • {requirement}
            </li>
          ))}
        </ul>

        <h2 className="mt-5 text-sm font-semibold text-card-foreground">
          Invariants evaluated
        </h2>
        <p className="mt-2 font-mono text-xs text-muted-foreground">
          {scenario.requiredInvariantIds.join(", ") || "—"}
        </p>
      </section>

      {sections.map(({ request, result }) => (
        <RunScenarioForm
          key={`${scenario.scenarioId}-${mechanismOf(request) ?? "single"}`}
          scenarioId={scenario.scenarioId}
          mechanism={mechanismOf(request)}
          eligibility={result}
          enabled={scenario.enabled}
        />
      ))}
    </div>
  );
}
