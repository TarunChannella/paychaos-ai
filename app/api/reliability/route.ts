/**
 * Phase 4F-R3 — `GET /api/reliability`.
 *
 * The read surface for the deterministic Reliability Score (P4-AC-10/11),
 * mirroring the exact protections the Phase 4E regression routes use:
 * targeted cross-origin rejection, the existing access-gate session check
 * (fail-closed when misconfigured), and a typed service result mapped to a
 * safe response.
 *
 * ADAPTER ONLY. Every decision that matters — eligibility, `LATEST_SELECTION_V1`,
 * the state mapping, every deduction and the provenance label — belongs to
 * `lib/reliability/score.ts`, reached through `getCurrentReliabilityScore()`.
 * This file contains no arithmetic, no database access, no chaos knowledge
 * and no readiness logic whatsoever (docs/ARCHITECTURE.md Section 36: route
 * handlers delegate to domain services).
 *
 * THE CALLER CHOOSES NOTHING. There is no path parameter, no query string and
 * no body. A caller cannot select a scenario, a classification, an algorithm,
 * a workspace, a threshold or a target — the score is derived from persisted
 * evidence the same way for every request. `GET` is the only method.
 *
 * READ FAILURE IS NOT ABSENCE. A `ReliabilityRepositoryError` becomes a 503
 * carrying only its stable safe code. It is never turned into a score: an
 * outage rendered as four `NOT_RUN` rows and a confident 40 would be a
 * fabricated measurement.
 *
 * Runs in the Node.js runtime for the same reason every other session-using
 * route does (`lib/access/session.ts` uses `node:crypto`).
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  ACCESS_SESSION_COOKIE_NAME,
  verifySessionToken,
} from "@/lib/access/session";
import { getAccessGateEnv } from "@/lib/config/access-env";
import { ReliabilityRepositoryError } from "@/lib/reliability/repository";
import { getCurrentReliabilityScore } from "@/lib/reliability/service";
import { logEvent } from "@/lib/security/logger";

export const runtime = "nodejs";

/** The score is derived on demand; a cached response would be a stale verdict. */
export const dynamic = "force-dynamic";

const SAFE_ERROR_BODY = {
  error: "Reliability score could not be calculated.",
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
    logEvent("reliability_read_request", { outcome: "REJECTED_CROSS_ORIGIN" });
    return NextResponse.json(SAFE_UNAUTHORIZED_BODY, { status: 403 });
  }

  let env;
  try {
    env = getAccessGateEnv();
  } catch {
    // Fail closed, exactly as the chaos and regression routes do. The reason
    // is never echoed: it would describe the deployment's configuration.
    logEvent("reliability_read_request", { outcome: "REJECTED_MISCONFIGURED" });
    return NextResponse.json(SAFE_MISCONFIGURED_BODY, { status: 503 });
  }

  if (env.mode === "enabled") {
    const cookie = request.cookies.get(ACCESS_SESSION_COOKIE_NAME)?.value;
    if (
      cookie === undefined ||
      !verifySessionToken(env.sessionSecret as string, cookie)
    ) {
      logEvent("reliability_read_request", {
        outcome: "REJECTED_UNAUTHORIZED",
      });
      return NextResponse.json(SAFE_UNAUTHORIZED_BODY, { status: 401 });
    }
  }

  try {
    const model = await getCurrentReliabilityScore();

    logEvent("reliability_read_request", {
      outcome: "CALCULATED",
      algorithm_version: model.score.algorithmVersion,
    });
    // The trusted read model, serialized as-is. There is deliberately no
    // second DTO: a parallel shape could only ever drift from the engine's.
    return NextResponse.json(model, { status: 200 });
  } catch (error) {
    if (error instanceof ReliabilityRepositoryError) {
      // A failed read is reported AS a failed read — never as a score.
      logEvent("reliability_read_request", {
        outcome: "READ_FAILED",
        reason: error.code,
      });
      return NextResponse.json(
        {
          error: "Reliability evidence is currently unavailable.",
          code: error.code,
        },
        { status: 503 },
      );
    }

    // Never surface the underlying error: a typed domain error and an
    // unexpected fault look identical from outside.
    logEvent("reliability_read_request", { outcome: "FAILED" });
    return NextResponse.json(SAFE_ERROR_BODY, { status: 500 });
  }
}
