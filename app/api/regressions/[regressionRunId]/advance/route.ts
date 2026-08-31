/**
 * Phase 4E-R3-A — `POST /api/regressions/{regressionRunId}/advance`.
 *
 * Resumes a persisted regression attempt. Mirrors the protections of every
 * other execution-capable route: path-shape validation, targeted cross-origin
 * rejection, the existing access-gate session check (fail-closed when
 * misconfigured), and a typed service result mapped to a safe response.
 *
 * NO OPERATIONAL INPUT AT ALL. The only input is the regression id in the
 * path. A request carrying any body key is refused rather than partially
 * honoured — there is deliberately no way to supply a scenario, an outcome, a
 * status, a continuation, a chaos run, an order, a payment, or a target. The
 * persisted `regression_runs` and `chaos_runs` rows are authoritative, and
 * `advanceRegression` alone decides what happens next from them.
 *
 * ADAPTER ONLY. This route creates no regression, creates no chaos run, calls
 * no scenario execution service, evaluates no invariant and writes no Finding
 * state.
 *
 * Runs in the Node.js runtime for the same reason every other session-using
 * route does (`lib/access/session.ts` uses `node:crypto`).
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { serializeOperation } from "@/app/api/findings/[findingId]/regressions/route";
import {
  ACCESS_SESSION_COOKIE_NAME,
  verifySessionToken,
} from "@/lib/access/session";
import { getAccessGateEnv } from "@/lib/config/access-env";
import { advanceRegression } from "@/lib/regression/service";
import { logEvent } from "@/lib/security/logger";

export const runtime = "nodejs";

const SAFE_ERROR_BODY = {
  error: "Regression request could not be processed.",
} as const;
const SAFE_UNAUTHORIZED_BODY = { error: "Unauthorized." } as const;
const SAFE_MISCONFIGURED_BODY = {
  error: "Access gate is misconfigured.",
} as const;
const SAFE_MALFORMED_ID_BODY = { error: "Malformed regression id." } as const;
const SAFE_MALFORMED_BODY = { error: "Malformed request body." } as const;
const SAFE_NOT_FOUND_BODY = { error: "Regression not found." } as const;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isKnownCrossOriginRequest(request: NextRequest): boolean {
  const secFetchSite = request.headers.get("sec-fetch-site");
  if (secFetchSite === "cross-site") return true;
  const origin = request.headers.get("origin");
  return origin !== null && origin !== request.nextUrl.origin;
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ regressionRunId: string }> },
): Promise<NextResponse> {
  const { regressionRunId } = await context.params;

  if (!UUID_PATTERN.test(regressionRunId)) {
    return NextResponse.json(SAFE_MALFORMED_ID_BODY, { status: 400 });
  }

  if (isKnownCrossOriginRequest(request)) {
    logEvent("regression_advance_request", {
      outcome: "REJECTED_CROSS_ORIGIN",
    });
    return NextResponse.json(SAFE_UNAUTHORIZED_BODY, { status: 403 });
  }

  let env;
  try {
    env = getAccessGateEnv();
  } catch {
    logEvent("regression_advance_request", {
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
      logEvent("regression_advance_request", {
        outcome: "REJECTED_UNAUTHORIZED",
      });
      return NextResponse.json(SAFE_UNAUTHORIZED_BODY, { status: 401 });
    }
  }

  // No body, or an empty JSON object. Anything carrying a key is refused —
  // this endpoint takes no operational input of any kind.
  const rawText = await request.text().catch(() => null);
  if (rawText === null) {
    return NextResponse.json(SAFE_MALFORMED_BODY, { status: 400 });
  }
  if (rawText.trim().length > 0) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      return NextResponse.json(SAFE_MALFORMED_BODY, { status: 400 });
    }
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed) ||
      Object.keys(parsed as Record<string, unknown>).length > 0
    ) {
      logEvent("regression_advance_request", { outcome: "REJECTED_MALFORMED" });
      return NextResponse.json(SAFE_MALFORMED_BODY, { status: 400 });
    }
  }

  try {
    const result = await advanceRegression(regressionRunId);

    logEvent("regression_advance_request", {
      outcome: result.kind,
      regression_run_id: result.attempt.regressionRunId,
      chaos_run_id: result.attempt.chaosRunId,
    });
    return NextResponse.json(serializeOperation(result), { status: 200 });
  } catch (error) {
    // The service raises a typed error for an unknown regression id; the
    // existing convention is to answer with the safe not-found body rather
    // than the generic failure, and never to echo the underlying message.
    if (
      typeof error === "object" &&
      error !== null &&
      (error as { code?: unknown }).code === "REGRESSION_SERVICE_RUN_NOT_FOUND"
    ) {
      logEvent("regression_advance_request", { outcome: "NOT_FOUND" });
      return NextResponse.json(SAFE_NOT_FOUND_BODY, { status: 404 });
    }
    logEvent("regression_advance_request", { outcome: "FAILED" });
    return NextResponse.json(SAFE_ERROR_BODY, { status: 500 });
  }
}
