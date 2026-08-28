/**
 * Phase 3D-D — `POST /api/chaos/runs/{runId}/execute-c11-b`.
 *
 * An untrusted execution boundary for C11-B's controlled `REAL_WEBHOOK_EVENT`
 * replay, mirroring the C01 replay route's security pattern exactly
 * (`app/api/chaos/runs/[runId]/replay/route.ts`). The ONLY input is the
 * `runId` path segment — this route never reads a request body, and never
 * accepts `authorized`/`target`/`url`/`host`/`endpoint`/`fault`/`count`/
 * `mechanism`/`scenarioId` from the caller. All actual
 * eligibility/security/execution logic lives in
 * `lib/chaos/c11-execution-service.ts`'s `executeC11RealWebhookReplay` —
 * this route only validates the path shape, enforces the untrusted-caller
 * boundary (session authorization, same-origin), and maps the service's
 * typed result to a safe HTTP response.
 *
 * Runs in the Node.js runtime for the same reason every other
 * session/HMAC-using route in this codebase does.
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  ACCESS_SESSION_COOKIE_NAME,
  verifySessionToken,
} from "@/lib/access/session";
import { executeC11RealWebhookReplay } from "@/lib/chaos/c11-execution-service";
import { getAccessGateEnv } from "@/lib/config/access-env";
import { logEvent } from "@/lib/security/logger";

export const runtime = "nodejs";

const SAFE_ERROR_BODY = {
  error: "Chaos C11-B execution request could not be processed.",
} as const;
const SAFE_UNAUTHORIZED_BODY = { error: "Unauthorized." } as const;
const SAFE_NOT_STARTABLE_BODY = {
  error: "This chaos run cannot be started.",
} as const;
const SAFE_MISCONFIGURED_BODY = {
  error: "Access gate is misconfigured.",
} as const;
const SAFE_MALFORMED_BODY = { error: "Malformed run id." } as const;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The smallest sufficient defense-in-depth check to reject a clearly
 * cross-origin POST — identical to the C01 replay route's own helper.
 */
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
    logEvent("chaos_c11b_execute_request", {
      outcome: "REJECTED_CROSS_ORIGIN",
    });
    return NextResponse.json(SAFE_UNAUTHORIZED_BODY, { status: 403 });
  }

  let env;
  try {
    env = getAccessGateEnv();
  } catch {
    // Fail closed: an enabled-but-invalid access gate must never fall open
    // for this execution-capable route (same philosophy as `middleware.ts`).
    logEvent("chaos_c11b_execute_request", {
      outcome: "REJECTED_MISCONFIGURED",
    });
    return NextResponse.json(SAFE_MISCONFIGURED_BODY, { status: 503 });
  }

  if (env.mode === "enabled") {
    const cookie = request.cookies.get(ACCESS_SESSION_COOKIE_NAME)?.value;
    // `env.sessionSecret` is guaranteed non-null when `env.mode === "enabled"`.
    if (
      cookie === undefined ||
      !verifySessionToken(env.sessionSecret as string, cookie)
    ) {
      logEvent("chaos_c11b_execute_request", {
        outcome: "REJECTED_UNAUTHORIZED",
      });
      return NextResponse.json(SAFE_UNAUTHORIZED_BODY, { status: 401 });
    }
  }
  // When the gate is disabled, this route follows the same existing
  // access-gate semantics as every other surface in this codebase — no
  // session is required, matching trusted local development.

  try {
    const result = await executeC11RealWebhookReplay(runId);

    if (result.kind === "COMPLETED") {
      logEvent("chaos_c11b_execute_request", {
        outcome: "COMPLETED",
        chaos_run_id: result.chaosRunId,
      });
      return NextResponse.json(
        {
          chaosRunId: result.chaosRunId,
          status: "COMPLETED",
          outcome: "UNKNOWN",
          replayAttemptCount: result.replayAttemptCount,
        },
        { status: 200 },
      );
    }

    if (result.kind === "NOT_STARTABLE") {
      logEvent("chaos_c11b_execute_request", {
        outcome: "NOT_STARTABLE",
        reason_category: result.reasonCategory,
      });
      return NextResponse.json(SAFE_NOT_STARTABLE_BODY, { status: 409 });
    }

    // result.kind === "FAILED" — a technical execution failure after
    // RUNNING was claimed; the run itself is durably marked FAILED/ERROR by
    // the service. Never expose the reason category or any underlying
    // error detail in the response.
    logEvent("chaos_c11b_execute_request", {
      outcome: "FAILED",
      chaos_run_id: result.chaosRunId,
      reason_category: result.reasonCategory,
    });
    return NextResponse.json(SAFE_ERROR_BODY, { status: 500 });
  } catch (err) {
    logEvent("chaos_c11b_execute_request", {
      outcome: "ERROR",
      error_name: err instanceof Error ? err.name : "UnknownError",
    });
    return NextResponse.json(SAFE_ERROR_BODY, { status: 500 });
  }
}
