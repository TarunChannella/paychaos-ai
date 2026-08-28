/**
 * Phase 3D-E — `POST /api/chaos/runs/{runId}/cancel-c11-a`.
 *
 * An untrusted execution boundary for explicitly, operator-initiated
 * cancellation of a RUNNING C11-A failed-payment observation, mirroring
 * `app/api/chaos/runs/[runId]/cancel-c07/route.ts`'s exact protections. The
 * ONLY input is the `runId` path segment. All eligibility/transition logic
 * lives in `lib/chaos/c11-execution-service.ts`'s
 * `cancelRunningC11AObservation` — this route only validates the path
 * shape, enforces the untrusted-caller boundary (PRE-SEC-010), and maps the
 * service's typed result to a safe HTTP response.
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  ACCESS_SESSION_COOKIE_NAME,
  verifySessionToken,
} from "@/lib/access/session";
import { cancelRunningC11AObservation } from "@/lib/chaos/c11-execution-service";
import { getAccessGateEnv } from "@/lib/config/access-env";
import { logEvent } from "@/lib/security/logger";

export const runtime = "nodejs";

const SAFE_ERROR_BODY = {
  error: "Chaos cancel request could not be processed.",
} as const;
const SAFE_UNAUTHORIZED_BODY = { error: "Unauthorized." } as const;
const SAFE_NOT_CANCELLABLE_BODY = {
  error: "This chaos run cannot be cancelled.",
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
    logEvent("chaos_c11a_cancel_request", {
      outcome: "REJECTED_CROSS_ORIGIN",
    });
    return NextResponse.json(SAFE_UNAUTHORIZED_BODY, { status: 403 });
  }

  let env;
  try {
    env = getAccessGateEnv();
  } catch {
    logEvent("chaos_c11a_cancel_request", {
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
      logEvent("chaos_c11a_cancel_request", {
        outcome: "REJECTED_UNAUTHORIZED",
      });
      return NextResponse.json(SAFE_UNAUTHORIZED_BODY, { status: 401 });
    }
  }

  try {
    const result = await cancelRunningC11AObservation(runId);

    if (result.kind === "CANCELLED") {
      logEvent("chaos_c11a_cancel_request", {
        outcome: "CANCELLED",
        chaos_run_id: result.chaosRunId,
      });
      return NextResponse.json(
        {
          chaosRunId: result.chaosRunId,
          status: "FAILED",
          outcome: "ERROR",
        },
        { status: 200 },
      );
    }

    if (result.kind === "CANCEL_PERSISTENCE_FAILED") {
      // Never claim CANCELLED without independent proof of the durable
      // returned row. Never expose the chaos run id or any internal detail.
      logEvent("chaos_c11a_cancel_request", {
        outcome: "CANCEL_PERSISTENCE_FAILED",
        chaos_run_id: result.chaosRunId,
      });
      return NextResponse.json(SAFE_ERROR_BODY, { status: 500 });
    }

    // result.kind === "NOT_CANCELLABLE"
    logEvent("chaos_c11a_cancel_request", {
      outcome: "NOT_CANCELLABLE",
      reason_category: result.reasonCategory,
    });
    return NextResponse.json(SAFE_NOT_CANCELLABLE_BODY, { status: 409 });
  } catch (err) {
    logEvent("chaos_c11a_cancel_request", {
      outcome: "ERROR",
      error_name: err instanceof Error ? err.name : "UnknownError",
    });
    return NextResponse.json(SAFE_ERROR_BODY, { status: 500 });
  }
}
