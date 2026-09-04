/**
 * Phase 5 — the controlled C01 Demo Merchant profile endpoint.
 *
 * AUTHORIZATION IS THE EXISTING ONE, NOT A NEW ONE. This route deliberately
 * mirrors `app/api/demo/reset/route.ts` statement for statement: the same
 * cross-origin rejection, the same `getAccessGateEnv()` fail-closed
 * misconfiguration branch, the same signed HttpOnly session cookie verified
 * with `verifySessionToken`. Changing the profile changes how the merchant
 * behaves under replay, so it is a state change and is gated exactly like
 * every other state change in the product. No second authentication
 * mechanism is introduced.
 *
 * READ IS PUBLIC, CHANGE IS NOT — the product-wide rule (docs/SECURITY.md
 * Section 17). `GET` reports the current mode so a read-only visitor can see
 * what the merchant is configured to do, which is exactly the transparency
 * docs/DEMO_PLAN.md Section 9 requires ("The application must never hide the
 * fact that the vulnerable path exists"). `POST` changes it and requires a
 * session.
 *
 * The access code itself is never read, logged or returned here.
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  ACCESS_SESSION_COOKIE_NAME,
  verifySessionToken,
} from "@/lib/access/session";
import { getAccessGateEnv } from "@/lib/config/access-env";
import {
  isC01IdempotencyProfile,
  readC01IdempotencyProfile,
  setC01IdempotencyProfile,
} from "@/lib/demo-profile/service";
import { logEvent } from "@/lib/security/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SAFE_UNAUTHORIZED_BODY = { error: "Unauthorized." } as const;
const SAFE_MISCONFIGURED_BODY = {
  error: "Access gate is misconfigured.",
} as const;
const SAFE_INVALID_BODY = {
  error: "Unsupported profile.",
} as const;

function isKnownCrossOriginRequest(request: NextRequest): boolean {
  const secFetchSite = request.headers.get("sec-fetch-site");
  if (secFetchSite === "cross-site") return true;
  const origin = request.headers.get("origin");
  return origin !== null && origin !== request.nextUrl.origin;
}

/**
 * The current mode, for display. Never fails closed to `SAFE`: an unreadable
 * profile is reported as unavailable, because telling an operator the
 * merchant is safe without having read that fact would be a claim with no
 * evidence behind it.
 */
export async function GET(): Promise<NextResponse> {
  const result = await readC01IdempotencyProfile();

  if (!result.ok) {
    logEvent("demo_profile_read", {
      outcome: "FAILED",
      failure_reason: result.failureReason ?? "PROFILE_READ_FAILED",
    });
    return NextResponse.json(
      { error: "The controlled test profile could not be read." },
      { status: 503 },
    );
  }

  return NextResponse.json(
    { ok: true, profile: result.profile },
    {
      status: 200,
    },
  );
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (isKnownCrossOriginRequest(request)) {
    logEvent("demo_profile_change", { outcome: "REJECTED_CROSS_ORIGIN" });
    return NextResponse.json(SAFE_UNAUTHORIZED_BODY, { status: 403 });
  }

  let env;
  try {
    env = getAccessGateEnv();
  } catch {
    logEvent("demo_profile_change", { outcome: "REJECTED_MISCONFIGURED" });
    return NextResponse.json(SAFE_MISCONFIGURED_BODY, { status: 503 });
  }

  if (env.mode === "enabled") {
    const cookie = request.cookies.get(ACCESS_SESSION_COOKIE_NAME)?.value;
    if (
      cookie === undefined ||
      !verifySessionToken(env.sessionSecret as string, cookie)
    ) {
      logEvent("demo_profile_change", { outcome: "REJECTED_UNAUTHORIZED" });
      return NextResponse.json(SAFE_UNAUTHORIZED_BODY, { status: 401 });
    }
  }

  // Parse only after authorization, so an unauthorized caller never reaches
  // the body reader at all.
  let requested: unknown;
  try {
    const body: unknown = await request.json();
    requested =
      typeof body === "object" && body !== null
        ? (body as { profile?: unknown }).profile
        : undefined;
  } catch {
    logEvent("demo_profile_change", { outcome: "REJECTED_MALFORMED" });
    return NextResponse.json(SAFE_INVALID_BODY, { status: 400 });
  }

  if (!isC01IdempotencyProfile(requested)) {
    logEvent("demo_profile_change", { outcome: "REJECTED_INVALID_PROFILE" });
    return NextResponse.json(SAFE_INVALID_BODY, { status: 400 });
  }

  const result = await setC01IdempotencyProfile(requested);

  if (!result.ok) {
    // `PROFILE_NOT_TEST_MODE` is reported as a refusal rather than a server
    // error: the request was well-formed and authorized, and the answer is
    // that this capability does not exist outside Razorpay Test Mode.
    const notTestMode = result.failureReason === "PROFILE_NOT_TEST_MODE";
    logEvent("demo_profile_change", {
      outcome: notTestMode ? "REJECTED_NOT_TEST_MODE" : "FAILED",
      failure_reason: result.failureReason ?? "PROFILE_WRITE_FAILED",
      // The requested profile is a fixed enum value, never free text, so it
      // is safe to log and is the one fact worth having in an audit trail.
      requested_profile: requested,
    });
    return NextResponse.json(
      {
        error: notTestMode
          ? "Controlled test behavior is available in Razorpay Test Mode only."
          : "The controlled test profile could not be changed.",
      },
      { status: notTestMode ? 403 : 500 },
    );
  }

  logEvent("demo_profile_change", {
    outcome: "COMPLETED",
    requested_profile: requested,
  });

  return NextResponse.json(
    { ok: true, profile: result.profile },
    {
      status: 200,
    },
  );
}
