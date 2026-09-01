/**
 * Phase 4G — `GET /api/readiness`.
 *
 * The read surface for `GO-LIVE-READINESS-V1` (P4-AC-13), mirroring
 * `app/api/reliability/route.ts` exactly: targeted cross-origin rejection, the
 * existing access-gate session check (fail-closed when misconfigured), and a
 * typed service result mapped to a safe response.
 *
 * ADAPTER ONLY. Every decision belongs to `lib/readiness/readiness.ts`,
 * reached through `getCurrentGoLiveReadiness()`. This file contains no
 * readiness rules, no score arithmetic, no database access and no gate
 * derivation.
 *
 * THE CALLER CHOOSES NOTHING. No path parameter, no query string, no body —
 * so no request can influence the readiness decision. `GET` is the only
 * method.
 *
 * READ FAILURE IS NOT A CLEAN STATE. A `ReadinessRepositoryError` becomes a
 * 503 carrying only its stable safe code, and a reliability read failure does
 * the same. Neither is ever turned into a readiness verdict: an outage
 * rendered as "no unresolved findings" is how a false READY would be born.
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  ACCESS_SESSION_COOKIE_NAME,
  verifySessionToken,
} from "@/lib/access/session";
import { getAccessGateEnv } from "@/lib/config/access-env";
import { ReadinessRepositoryError } from "@/lib/readiness/repository";
import { getCurrentGoLiveReadiness } from "@/lib/readiness/service";
import { ReliabilityRepositoryError } from "@/lib/reliability/repository";
import { logEvent } from "@/lib/security/logger";

export const runtime = "nodejs";

/** Readiness is derived on demand; a cached response would be a stale verdict. */
export const dynamic = "force-dynamic";

const SAFE_ERROR_BODY = {
  error: "Go-Live Readiness could not be assessed.",
} as const;
const SAFE_UNAUTHORIZED_BODY = { error: "Unauthorized." } as const;
const SAFE_MISCONFIGURED_BODY = {
  error: "Access gate is misconfigured.",
} as const;

/** Same targeted cross-origin rejection as every other protected route. */
function isKnownCrossOriginRequest(request: NextRequest): boolean {
  const secFetchSite = request.headers.get("sec-fetch-site");
  if (secFetchSite === "cross-site") return true;
  const origin = request.headers.get("origin");
  return origin !== null && origin !== request.nextUrl.origin;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (isKnownCrossOriginRequest(request)) {
    logEvent("readiness_read_request", { outcome: "REJECTED_CROSS_ORIGIN" });
    return NextResponse.json(SAFE_UNAUTHORIZED_BODY, { status: 403 });
  }

  let env;
  try {
    env = getAccessGateEnv();
  } catch {
    // Fail closed. The reason is never echoed: it would describe the
    // deployment's configuration.
    logEvent("readiness_read_request", { outcome: "REJECTED_MISCONFIGURED" });
    return NextResponse.json(SAFE_MISCONFIGURED_BODY, { status: 503 });
  }

  if (env.mode === "enabled") {
    const cookie = request.cookies.get(ACCESS_SESSION_COOKIE_NAME)?.value;
    if (
      cookie === undefined ||
      !verifySessionToken(env.sessionSecret as string, cookie)
    ) {
      logEvent("readiness_read_request", { outcome: "REJECTED_UNAUTHORIZED" });
      return NextResponse.json(SAFE_UNAUTHORIZED_BODY, { status: 401 });
    }
  }

  try {
    const model = await getCurrentGoLiveReadiness();

    logEvent("readiness_read_request", {
      outcome: "ASSESSED",
      readiness_version: model.readiness.version,
      readiness_status: model.readiness.status,
    });
    return NextResponse.json(model, { status: 200 });
  } catch (error) {
    if (
      error instanceof ReadinessRepositoryError ||
      error instanceof ReliabilityRepositoryError
    ) {
      // A failed read is reported AS a failed read — never as a verdict.
      logEvent("readiness_read_request", {
        outcome: "READ_FAILED",
        reason: error.code,
      });
      return NextResponse.json(
        {
          error: "Readiness evidence is currently unavailable.",
          code: error.code,
        },
        { status: 503 },
      );
    }

    logEvent("readiness_read_request", { outcome: "FAILED" });
    return NextResponse.json(SAFE_ERROR_BODY, { status: 500 });
  }
}
