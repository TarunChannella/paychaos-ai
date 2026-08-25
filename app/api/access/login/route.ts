/**
 * Phase 2G readiness — `POST /api/access/login`.
 *
 * The ONLY way an operator establishes a signed session for the access
 * gate defined in `middleware.ts`/`lib/access/session.ts`. Deliberately
 * excluded from `middleware.ts`'s protected-path check (`isProtectedPath`
 * only matches `/demo-merchant`) — this route must remain reachable without
 * an existing session, or no session could ever be created.
 *
 * Runs in the Node.js runtime for the same reason every other HMAC-using
 * route in this codebase does (`lib/access/session.ts` uses `node:crypto`).
 */
import { timingSafeEqual } from "node:crypto";

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getAccessGateEnv } from "@/lib/config/access-env";
import {
  ACCESS_SESSION_COOKIE_NAME,
  createSessionToken,
} from "@/lib/access/session";
import { logEvent } from "@/lib/security/logger";

export const runtime = "nodejs";

const SAFE_DISABLED_BODY = {
  error: "The access gate is not enabled on this deployment.",
} as const;
const SAFE_INVALID_BODY = { error: "Invalid access token." } as const;
const SAFE_MALFORMED_BODY = { error: "Malformed request body." } as const;

/**
 * Refuses an implausibly large request body before ever touching it —
 * defense against a trivial memory-exhaustion attempt against this
 * intentionally public-until-authenticated endpoint (docs/SECURITY.md
 * Section 33 "request-size bounds").
 */
const MAX_REQUEST_BODY_BYTES = 4096;

function timingSafeStringsEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, "utf8");
  const bufferB = Buffer.from(b, "utf8");
  if (bufferA.length !== bufferB.length) {
    return false;
  }
  return timingSafeEqual(bufferA, bufferB);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Re-validated on every call (not cached across requests beyond the
  // module-level cache `getAccessGateEnv()` already applies) so a
  // misconfigured gate never issues a session.
  let env;
  try {
    env = getAccessGateEnv();
  } catch {
    logEvent("access_gate_login", {
      outcome: "ACCESS_DENIED",
      reason: "MISCONFIGURED",
    });
    return NextResponse.json(SAFE_DISABLED_BODY, { status: 503 });
  }

  if (env.mode === "disabled") {
    // Never confirms/denies a token when there is no gate to log into —
    // this is a safe, generic "not available" response, not an oracle.
    return NextResponse.json(SAFE_DISABLED_BODY, { status: 404 });
  }

  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_REQUEST_BODY_BYTES) {
    return NextResponse.json(SAFE_MALFORMED_BODY, { status: 400 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return NextResponse.json(SAFE_MALFORMED_BODY, { status: 400 });
  }

  const suppliedToken =
    typeof parsed === "object" &&
    parsed !== null &&
    "token" in parsed &&
    typeof (parsed as Record<string, unknown>).token === "string"
      ? ((parsed as Record<string, unknown>).token as string)
      : null;

  if (suppliedToken === null || suppliedToken.length === 0) {
    return NextResponse.json(SAFE_MALFORMED_BODY, { status: 400 });
  }

  // `env.accessToken` is guaranteed non-null when `env.mode === "enabled"`.
  const matches = timingSafeStringsEqual(
    suppliedToken,
    env.accessToken as string,
  );

  if (!matches) {
    // Never logs the supplied token (docs/SECURITY.md "Access-Gate Audit":
    // "Do not log the access token").
    logEvent("access_gate_login", { outcome: "ACCESS_DENIED" });
    return NextResponse.json(SAFE_INVALID_BODY, { status: 401 });
  }

  logEvent("access_gate_login", { outcome: "ACCESS_GRANTED" });

  // `env.sessionSecret` is guaranteed non-null when `env.mode === "enabled"`.
  const { token: sessionToken, maxAgeSeconds } = createSessionToken(
    env.sessionSecret as string,
  );

  const response = NextResponse.json({ ok: true }, { status: 200 });
  response.cookies.set(ACCESS_SESSION_COOKIE_NAME, sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: maxAgeSeconds,
  });
  return response;
}
