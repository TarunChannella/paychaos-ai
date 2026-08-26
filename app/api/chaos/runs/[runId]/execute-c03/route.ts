/**
 * Phase 3D-A — `POST /api/chaos/runs/{runId}/execute-c03`.
 *
 * An untrusted execution boundary for the C03 chaos mechanism
 * (docs/SECURITY.md; this task's Section 11), mirroring
 * `app/api/chaos/runs/[runId]/replay/route.ts`'s exact protections. The
 * ONLY execution input is the `runId` path segment — this route never reads
 * a request body, and never accepts `authorized`/`target`/`url`/`host`/
 * `endpoint`/`fault`/`count`/`mechanism`/`scenarioId` from the caller. All
 * actual eligibility/security/execution logic lives in
 * `lib/chaos/c03-execution-service.ts`'s `executeC03InvalidSignatureTest` —
 * this route only validates the path shape, enforces the untrusted-caller
 * boundary (session authorization, same-origin — PRE-SEC-010), and maps the
 * service's typed result to a safe HTTP response (docs/ARCHITECTURE.md
 * Section 36 "Important Module Rule": route handlers delegate to domain
 * services).
 *
 * Runs in the Node.js runtime for the same reason every other
 * session/HMAC-using route in this codebase does
 * (`lib/access/session.ts` uses `node:crypto`).
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  ACCESS_SESSION_COOKIE_NAME,
  verifySessionToken,
} from "@/lib/access/session";
import { executeC03InvalidSignatureTest } from "@/lib/chaos/c03-execution-service";
import { getAccessGateEnv } from "@/lib/config/access-env";
import { logEvent } from "@/lib/security/logger";

export const runtime = "nodejs";

const SAFE_ERROR_BODY = {
  error: "Chaos execution request could not be processed.",
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
 * Same targeted cross-origin rejection as
 * `app/api/chaos/runs/[runId]/replay/route.ts`'s
 * `isKnownCrossOriginRequest` — no existing project same-origin/CSRF helper
 * exists, and this task explicitly forbids introducing a generic CSRF
 * framework/dependency for it.
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
    logEvent("chaos_c03_execute_request", {
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
    logEvent("chaos_c03_execute_request", {
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
      logEvent("chaos_c03_execute_request", {
        outcome: "REJECTED_UNAUTHORIZED",
      });
      return NextResponse.json(SAFE_UNAUTHORIZED_BODY, { status: 401 });
    }
  }
  // When the gate is disabled, this route follows the same existing
  // access-gate semantics as every other surface in this codebase — no
  // session is required, matching trusted local development.

  try {
    const result = await executeC03InvalidSignatureTest(runId);

    if (result.kind === "COMPLETED") {
      logEvent("chaos_c03_execute_request", {
        outcome: "COMPLETED",
        chaos_run_id: result.chaosRunId,
      });
      return NextResponse.json(
        {
          chaosRunId: result.chaosRunId,
          status: "COMPLETED",
          outcome: "UNKNOWN",
          checks: result.checks,
        },
        { status: 200 },
      );
    }

    if (result.kind === "BLOCKED_PRE_SEC_007") {
      logEvent("chaos_c03_execute_request", {
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
      // Blocker 1 correction: the PRE-SEC-007 block could not be durably
      // proven (threw, returned null, lost a race, or an unexpected shape).
      // Never claim BLOCKED here — verified persisted state is
      // authoritative, and this result means that proof does not exist.
      // Never expose the run id or any internal detail.
      logEvent("chaos_c03_execute_request", {
        outcome: "BLOCK_PERSISTENCE_FAILED",
        chaos_run_id: result.chaosRunId,
      });
      return NextResponse.json(SAFE_ERROR_BODY, { status: 500 });
    }

    if (result.kind === "NOT_STARTABLE") {
      logEvent("chaos_c03_execute_request", {
        outcome: "NOT_STARTABLE",
        reason_category: result.reasonCategory,
      });
      return NextResponse.json(SAFE_NOT_STARTABLE_BODY, { status: 409 });
    }

    // result.kind === "FAILED" — a technical execution failure after
    // RUNNING was claimed; the run itself is durably marked FAILED/ERROR by
    // the service. Never expose the reason category or any underlying
    // error detail in the response.
    logEvent("chaos_c03_execute_request", {
      outcome: "FAILED",
      chaos_run_id: result.chaosRunId,
      reason_category: result.reasonCategory,
    });
    return NextResponse.json(SAFE_ERROR_BODY, { status: 500 });
  } catch (err) {
    logEvent("chaos_c03_execute_request", {
      outcome: "ERROR",
      error_name: err instanceof Error ? err.name : "UnknownError",
    });
    return NextResponse.json(SAFE_ERROR_BODY, { status: 500 });
  }
}
