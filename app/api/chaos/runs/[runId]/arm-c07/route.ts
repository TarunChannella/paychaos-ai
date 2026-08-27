/**
 * Phase 3D-B — `POST /api/chaos/runs/{runId}/arm-c07`.
 *
 * An untrusted execution boundary for arming C07's client-confirmation-drop
 * fault, mirroring `app/api/chaos/runs/[runId]/execute-c03/route.ts`'s exact
 * protections. The ONLY execution input is the `runId` path segment — this
 * route never reads a request body, and never accepts
 * `authorized`/`target`/`url`/`host`/`endpoint`/`fault`/`scenarioId` from
 * the caller. All actual eligibility/security/execution logic lives in
 * `lib/chaos/c07-execution-service.ts`'s `armC07ClientConfirmationDrop` —
 * this route only validates the path shape, enforces the untrusted-caller
 * boundary (session authorization, same-origin — PRE-SEC-010), and maps the
 * service's typed result to a safe HTTP response.
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
import { armC07ClientConfirmationDrop } from "@/lib/chaos/c07-execution-service";
import { getAccessGateEnv } from "@/lib/config/access-env";
import { logEvent } from "@/lib/security/logger";

export const runtime = "nodejs";

const SAFE_ERROR_BODY = {
  error: "Chaos arm request could not be processed.",
} as const;
const SAFE_UNAUTHORIZED_BODY = { error: "Unauthorized." } as const;
const SAFE_NOT_STARTABLE_BODY = {
  error: "This chaos run cannot be armed.",
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
    logEvent("chaos_c07_arm_request", { outcome: "REJECTED_CROSS_ORIGIN" });
    return NextResponse.json(SAFE_UNAUTHORIZED_BODY, { status: 403 });
  }

  let env;
  try {
    env = getAccessGateEnv();
  } catch {
    logEvent("chaos_c07_arm_request", { outcome: "REJECTED_MISCONFIGURED" });
    return NextResponse.json(SAFE_MISCONFIGURED_BODY, { status: 503 });
  }

  if (env.mode === "enabled") {
    const cookie = request.cookies.get(ACCESS_SESSION_COOKIE_NAME)?.value;
    if (
      cookie === undefined ||
      !verifySessionToken(env.sessionSecret as string, cookie)
    ) {
      logEvent("chaos_c07_arm_request", { outcome: "REJECTED_UNAUTHORIZED" });
      return NextResponse.json(SAFE_UNAUTHORIZED_BODY, { status: 401 });
    }
  }

  try {
    const result = await armC07ClientConfirmationDrop(runId);

    if (result.kind === "ARMED") {
      logEvent("chaos_c07_arm_request", {
        outcome: "ARMED",
        chaos_run_id: result.chaosRunId,
      });
      return NextResponse.json(
        {
          chaosRunId: result.chaosRunId,
          status: "RUNNING",
          faultState: { armed: true, consumed: false },
        },
        { status: 200 },
      );
    }

    if (result.kind === "BLOCKED_PRE_SEC_007") {
      logEvent("chaos_c07_arm_request", {
        outcome: "BLOCKED_PRE_SEC_007",
        chaos_run_id: result.chaosRunId,
      });
      return NextResponse.json(
        {
          chaosRunId: result.chaosRunId,
          status: "COMPLETED",
          outcome: "BLOCKED",
          executionBlockCode: "PRE-SEC-007",
        },
        { status: 200 },
      );
    }

    if (result.kind === "BLOCK_PERSISTENCE_FAILED") {
      logEvent("chaos_c07_arm_request", {
        outcome: "BLOCK_PERSISTENCE_FAILED",
        chaos_run_id: result.chaosRunId,
      });
      return NextResponse.json(SAFE_ERROR_BODY, { status: 500 });
    }

    // result.kind === "NOT_STARTABLE"
    logEvent("chaos_c07_arm_request", {
      outcome: "NOT_STARTABLE",
      reason_category: result.reasonCategory,
    });
    return NextResponse.json(SAFE_NOT_STARTABLE_BODY, { status: 409 });
  } catch (err) {
    logEvent("chaos_c07_arm_request", {
      outcome: "ERROR",
      error_name: err instanceof Error ? err.name : "UnknownError",
    });
    return NextResponse.json(SAFE_ERROR_BODY, { status: 500 });
  }
}
