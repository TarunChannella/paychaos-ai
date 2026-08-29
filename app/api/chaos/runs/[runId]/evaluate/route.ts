import { NextResponse, type NextRequest } from "next/server";

import {
  ACCESS_SESSION_COOKIE_NAME,
  verifySessionToken,
} from "@/lib/access/session";
import { getAccessGateEnv } from "@/lib/config/access-env";
import { generateFindingsForChaosRun } from "@/lib/findings/service";
import { evaluateChaosRun } from "@/lib/invariants/service";
import { logEvent } from "@/lib/security/logger";

export const runtime = "nodejs";

/**
 * Phase 3H — the missing EVALUATION + FINDING orchestration endpoint.
 *
 * Both frozen services already existed and both had zero callers anywhere in
 * the application: `evaluateChaosRun` (Phase 3F-C) and
 * `generateFindingsForChaosRun` (Phase 3G) could only be reached from an
 * integration test. This route is the thin additive layer ABOVE them that
 * makes the documented chain reachable:
 *
 *   completed chaos run
 *     -> deterministic invariant evaluation   (frozen Phase 3F-C)
 *       -> Finding generation from persisted FAIL results  (frozen Phase 3G)
 *
 * IT DECIDES NOTHING. No evaluator logic is reimplemented here. It does not
 * inspect payment state, does not determine `FAIL`, does not edit an invariant
 * result, does not create or update a Finding itself, and accepts no verdict
 * from the browser. The only input is the run ID in the path.
 *
 * ORDERING IS DELIBERATE. Findings are generated only AFTER evaluation
 * succeeds. The frozen evaluator aborts the whole run before any write if any
 * evaluator reports `ERROR`, so a failed evaluation must never be followed by
 * Finding generation over a half-written result set.
 *
 * IDEMPOTENCY IS INHERITED, NOT ADDED. Repeating this POST is safe because
 * both frozen services are already idempotent: evaluation reuses equivalent
 * persisted results and returns `ALREADY_FINAL`, and Finding generation
 * returns `ALREADY_PRESENT` for an existing Finding. This route adds no
 * dedupe logic of its own, so it cannot drift from theirs.
 *
 * LIFECYCLE IS NOT WEAKENED. The frozen evaluator refuses a run that is not
 * `COMPLETED`; that refusal is surfaced as 409, never bypassed.
 */

const SAFE_MALFORMED_BODY = { error: "Malformed request." } as const;
const SAFE_UNAUTHORIZED_BODY = { error: "Unauthorized." } as const;
const SAFE_MISCONFIGURED_BODY = {
  error: "Access gate is misconfigured.",
} as const;
const SAFE_NOT_EVALUABLE_BODY = {
  error: "This chaos run is not in an evaluable state.",
} as const;
const SAFE_ERROR_BODY = {
  error: "Chaos run evaluation could not be completed.",
} as const;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isKnownCrossOriginRequest(request: NextRequest): boolean {
  const secFetchSite = request.headers.get("sec-fetch-site");
  if (secFetchSite === "cross-site") return true;
  const origin = request.headers.get("origin");
  return origin !== null && origin !== request.nextUrl.origin;
}

/** Error codes the frozen evaluator raises for a run that may not be evaluated. */
const NOT_EVALUABLE_CODES = new Set([
  "CHAOS_RUN_NOT_EVALUABLE",
  "FINDING_CHAOS_RUN_ID_INVALID",
]);

function errorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ runId: string }> },
): Promise<NextResponse> {
  const { runId } = await context.params;

  if (!UUID_PATTERN.test(runId)) {
    return NextResponse.json(SAFE_MALFORMED_BODY, { status: 400 });
  }

  if (isKnownCrossOriginRequest(request)) {
    logEvent("chaos_run_evaluate_request", {
      outcome: "REJECTED_CROSS_ORIGIN",
    });
    return NextResponse.json(SAFE_UNAUTHORIZED_BODY, { status: 403 });
  }

  let env;
  try {
    env = getAccessGateEnv();
  } catch {
    // Fail closed, exactly as every other chaos route does.
    logEvent("chaos_run_evaluate_request", {
      outcome: "REJECTED_MISCONFIGURED",
    });
    return NextResponse.json(SAFE_MISCONFIGURED_BODY, { status: 503 });
  }

  if (env.mode === "enabled") {
    const cookie = request.cookies.get(ACCESS_SESSION_COOKIE_NAME)?.value;
    if (
      cookie === undefined ||
      !verifySessionToken(env.sessionSecret as string, cookie)
    ) {
      logEvent("chaos_run_evaluate_request", {
        outcome: "REJECTED_UNAUTHORIZED",
      });
      return NextResponse.json(SAFE_UNAUTHORIZED_BODY, { status: 401 });
    }
  }

  try {
    // --- 1. frozen deterministic evaluation -----------------------------
    const evaluation = await evaluateChaosRun(runId);

    // --- 2. frozen Finding generation, only after evaluation succeeded ---
    const findings = await generateFindingsForChaosRun(runId);

    logEvent("chaos_run_evaluate_request", {
      outcome: "COMPLETED",
      aggregateOutcome: evaluation.aggregateOutcome,
      failedResultCount: findings.failedResultCount,
    });

    return NextResponse.json(
      {
        kind: "EVALUATED",
        chaosRunId: evaluation.chaosRunId,
        scenarioId: evaluation.scenarioId,
        aggregateOutcome: evaluation.aggregateOutcome,
        outcomeFinalization: evaluation.outcomeFinalization,
        evaluations: evaluation.evaluations.map((e) => ({
          invariantId: e.invariantId,
          disposition: e.disposition,
        })),
        findings: {
          evaluatedResultCount: findings.evaluatedResultCount,
          failedResultCount: findings.failedResultCount,
          created: findings.findings.filter((f) => f.kind === "CREATED").length,
          alreadyPresent: findings.findings.filter(
            (f) => f.kind === "ALREADY_PRESENT",
          ).length,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    const code = errorCode(error);

    if (code !== null && NOT_EVALUABLE_CODES.has(code)) {
      logEvent("chaos_run_evaluate_request", {
        outcome: "REJECTED_NOT_EVALUABLE",
        code,
      });
      return NextResponse.json(SAFE_NOT_EVALUABLE_BODY, { status: 409 });
    }

    // Every other failure — including an evaluator ERROR, which the frozen
    // service already turned into a typed abort with nothing persisted —
    // surfaces as a fixed safe message. No raw database text, no stack.
    logEvent("chaos_run_evaluate_request", {
      outcome: "ERROR",
      code: code ?? "UNTYPED",
    });
    return NextResponse.json(SAFE_ERROR_BODY, { status: 500 });
  }
}
