/**
 * Phase 3D-E — `POST /api/chaos/runs/{runId}/reconcile-c11-a`.
 *
 * An untrusted execution boundary for reconciling C11-A's failed-payment
 * observation against authoritative provider evidence, mirroring
 * `app/api/chaos/runs/[runId]/reconcile-c07/route.ts`'s exact protections.
 * The ONLY input is the `runId` path segment. All eligibility/evidence/
 * completion logic lives in `lib/chaos/c11-execution-service.ts`'s
 * `reconcileC11AFailedPaymentObservation` — this route only validates the
 * path shape, enforces the untrusted-caller boundary (PRE-SEC-010), and maps
 * the service's typed result to a safe HTTP response. Safe to call
 * repeatedly (stateless CHECK NOW — this task's Section 17).
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  ACCESS_SESSION_COOKIE_NAME,
  verifySessionToken,
} from "@/lib/access/session";
import { reconcileC11AFailedPaymentObservation } from "@/lib/chaos/c11-execution-service";
import { getAccessGateEnv } from "@/lib/config/access-env";
import { logEvent } from "@/lib/security/logger";

export const runtime = "nodejs";

const SAFE_ERROR_BODY = {
  error: "Chaos reconcile request could not be processed.",
} as const;
const SAFE_UNAUTHORIZED_BODY = { error: "Unauthorized." } as const;
const SAFE_NOT_RECONCILABLE_BODY = {
  error: "This chaos run cannot be reconciled.",
} as const;
const SAFE_MISCONFIGURED_BODY = {
  error: "Access gate is misconfigured.",
} as const;
const SAFE_MALFORMED_BODY = { error: "Malformed run id." } as const;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isKnownCrossOriginRequest(request: NextRequest): boolean {
  const secFetchSite = request.headers.get("sec-fetch-site");
  if (secFetchSite === "cross-site") {
    return true;
  }
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== request.nextUrl.origin) {
    return true;
  }
  return false;
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
    logEvent("chaos_c11a_reconcile_request", {
      outcome: "REJECTED_CROSS_ORIGIN",
    });
    return NextResponse.json(SAFE_UNAUTHORIZED_BODY, { status: 403 });
  }

  let env;
  try {
    env = getAccessGateEnv();
  } catch {
    logEvent("chaos_c11a_reconcile_request", {
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
      logEvent("chaos_c11a_reconcile_request", {
        outcome: "REJECTED_UNAUTHORIZED",
      });
      return NextResponse.json(SAFE_UNAUTHORIZED_BODY, { status: 401 });
    }
  }

  try {
    const result = await reconcileC11AFailedPaymentObservation(runId);

    if (result.kind === "COMPLETED") {
      logEvent("chaos_c11a_reconcile_request", {
        outcome: "COMPLETED",
        chaos_run_id: result.chaosRunId,
      });
      return NextResponse.json(
        {
          chaosRunId: result.chaosRunId,
          status: "COMPLETED",
          outcome: "UNKNOWN",
        },
        { status: 200 },
      );
    }

    if (result.kind === "NOT_YET_CONVERGED") {
      logEvent("chaos_c11a_reconcile_request", {
        outcome: "NOT_YET_CONVERGED",
        chaos_run_id: result.chaosRunId,
      });
      return NextResponse.json(
        { chaosRunId: result.chaosRunId, status: "NOT_YET_CONVERGED" },
        { status: 200 },
      );
    }

    if (result.kind === "FAILED") {
      // A technical/ambiguous-evidence execution failure after RUNNING was
      // claimed; the run itself is durably marked FAILED/ERROR by the
      // service. Never expose the reason category or any underlying error
      // detail in the response.
      logEvent("chaos_c11a_reconcile_request", {
        outcome: "FAILED",
        chaos_run_id: result.chaosRunId,
        reason_category: result.reasonCategory,
      });
      return NextResponse.json(SAFE_ERROR_BODY, { status: 500 });
    }

    if (result.kind === "COMPLETION_PERSISTENCE_FAILED") {
      logEvent("chaos_c11a_reconcile_request", {
        outcome: "COMPLETION_PERSISTENCE_FAILED",
        chaos_run_id: result.chaosRunId,
      });
      return NextResponse.json(SAFE_ERROR_BODY, { status: 500 });
    }

    if (result.kind === "FAILURE_PERSISTENCE_FAILED") {
      // Architect correction round 1: a technical failure occurred, but the
      // durable FAILED/ERROR state could not be independently verified —
      // this is distinct from a confirmed `FAILED` run and must never be
      // reported as one. Same safe generic 500 as every other unverified/
      // internal-error outcome in this route; never exposes the reason
      // category, the persisted reason text, or any raw error detail.
      logEvent("chaos_c11a_reconcile_request", {
        outcome: "FAILURE_PERSISTENCE_FAILED",
        chaos_run_id: result.chaosRunId,
      });
      return NextResponse.json(SAFE_ERROR_BODY, { status: 500 });
    }

    // result.kind === "NOT_RECONCILABLE"
    logEvent("chaos_c11a_reconcile_request", {
      outcome: "NOT_RECONCILABLE",
      reason_category: result.reasonCategory,
    });
    return NextResponse.json(SAFE_NOT_RECONCILABLE_BODY, { status: 409 });
  } catch (err) {
    logEvent("chaos_c11a_reconcile_request", {
      outcome: "ERROR",
      error_name: err instanceof Error ? err.name : "UnknownError",
    });
    return NextResponse.json(SAFE_ERROR_BODY, { status: 500 });
  }
}
