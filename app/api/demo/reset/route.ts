/**
 * Phase 5B — `POST /api/demo/reset`.
 *
 * The single administrative entry point for the documented Demo Reset. It
 * reuses the exact security posture of every other protected route: targeted
 * cross-origin rejection, then the existing operator access gate, which fails
 * closed when misconfigured.
 *
 * POST ONLY. A reset is a mutation and must never be reachable by navigation,
 * a prefetch, a crawler or an image tag. There is no `GET`.
 *
 * THE CALLER CHOOSES NOTHING. No path parameter, no query string, no body is
 * read. A request cannot name a table, widen the scope or reorder the
 * deletion — `runDemoReset()` takes no arguments at all. This is what keeps
 * the endpoint from being a generic database-deletion surface.
 *
 * INTENT IS CONFIRMED IN THE UI. The client requires an explicit typed
 * confirmation and disables itself while the request is in flight; the server
 * additionally refuses cross-origin callers. Both matter: the dialog stops an
 * accident, the gate stops an outsider.
 *
 * FAILURE IS REPORTED AS FAILURE — AND FAILURE NOW MEANS "NOTHING HAPPENED".
 * The reset runs as one PostgreSQL transaction, so it either fully applied or
 * did not apply at all. This route therefore reports `resetApplied: false` and
 * says so plainly, rather than naming a table it stopped at and listing what
 * was already cleared: that vocabulary described a partial reset, which is a
 * state the implementation can no longer produce. No raw database message is
 * ever forwarded.
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  ACCESS_SESSION_COOKIE_NAME,
  verifySessionToken,
} from "@/lib/access/session";
import { getAccessGateEnv } from "@/lib/config/access-env";
import { runDemoReset } from "@/lib/demo-reset/service";
import { logEvent } from "@/lib/security/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (isKnownCrossOriginRequest(request)) {
    logEvent("demo_reset_request", { outcome: "REJECTED_CROSS_ORIGIN" });
    return NextResponse.json(SAFE_UNAUTHORIZED_BODY, { status: 403 });
  }

  let env;
  try {
    env = getAccessGateEnv();
  } catch {
    logEvent("demo_reset_request", { outcome: "REJECTED_MISCONFIGURED" });
    return NextResponse.json(SAFE_MISCONFIGURED_BODY, { status: 503 });
  }

  if (env.mode === "enabled") {
    const cookie = request.cookies.get(ACCESS_SESSION_COOKIE_NAME)?.value;
    if (
      cookie === undefined ||
      !verifySessionToken(env.sessionSecret as string, cookie)
    ) {
      logEvent("demo_reset_request", { outcome: "REJECTED_UNAUTHORIZED" });
      return NextResponse.json(SAFE_UNAUTHORIZED_BODY, { status: 401 });
    }
  }

  try {
    const result = await runDemoReset();

    if (!result.ok) {
      logEvent("demo_reset_request", {
        outcome: "FAILED_ROLLED_BACK",
        reset_applied: false,
      });
      return NextResponse.json(
        {
          error: "The demo reset failed and no reset was applied.",
          resetApplied: false,
        },
        { status: 500 },
      );
    }

    logEvent("demo_reset_request", {
      outcome: "COMPLETED",
      reset_applied: true,
    });
    return NextResponse.json(
      { ok: true, resetApplied: true, deletedCounts: result.deletedCounts },
      { status: 200 },
    );
  } catch {
    logEvent("demo_reset_request", { outcome: "FAILED" });
    return NextResponse.json(
      {
        error: "The demo reset could not be performed.",
        resetApplied: false,
      },
      { status: 500 },
    );
  }
}
