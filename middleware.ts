/**
 * Phase 2G readiness — minimal single-workspace operator access-gate
 * enforcement (docs/SECURITY.md Section 17, docs/ARCHITECTURE.md ADR-A16,
 * docs/PHASE_PLAN.md Section 6.4 item 2/6.8 item 1).
 *
 * Protects the operator surfaces: the Demo Merchant (`/demo-merchant` and
 * every server action it posts to, which Next.js routes through that same
 * page URL), the Chaos Lab (`/chaos`) added in Phase 3H, which can start a
 * chaos run, and the Reliability Score page (`/reliability`) added in Phase
 * 4F-R3, which is read-only but exposes persisted chaos evidence and run
 * identifiers.
 * `POST /api/webhooks/razorpay` is deliberately NOT
 * protected: its trust boundary is the Razorpay webhook HMAC signature, not
 * an operator session (docs/SECURITY.md Section 28 "Webhook Exception",
 * ARCHITECTURE.md ADR-A16's explicit carve-out) — Razorpay itself must be
 * able to reach it with no login. `/api/access/login` and `/api/access/logout`
 * are also excluded (this IS how an operator establishes/clears a session).
 *
 * Defense in depth: this function checks the request pathname itself
 * (`isProtectedPath`) rather than relying solely on the exported `matcher`
 * below — if a future change ever widens the matcher, an unprotected path
 * still falls through untouched instead of silently starting to require
 * login (which would break the public webhook contract).
 *
 * Runs in the Node.js middleware runtime (`export const runtime =
 * "nodejs"`) because `lib/access/session.ts` uses `node:crypto`'s
 * `createHmac`/`timingSafeEqual` — the same reason
 * `app/api/webhooks/razorpay/route.ts` pins `runtime = "nodejs"`.
 *
 * When the access gate is disabled (`PAYCHAOS_ACCESS_GATE` unset or
 * `"disabled"` — the default, correct for trusted local development per
 * docs/SECURITY.md), every request passes through unchanged; this is a
 * deliberate, documented, non-default opt-in requirement, not a bypass —
 * `docs/SECURITY.md` states the gate "may be disabled only for trusted
 * local development" and "A public Vercel deployment must enable it",
 * which is a deployment-configuration responsibility (`PAYCHAOS_ACCESS_GATE=enabled`
 * plus real `PAYCHAOS_ACCESS_TOKEN`/`PAYCHAOS_SESSION_SECRET` values), not
 * something this code can detect or force on its own.
 *
 * Fails closed if the gate is enabled but misconfigured (missing/invalid
 * `PAYCHAOS_ACCESS_TOKEN`/`PAYCHAOS_SESSION_SECRET`): denies the protected
 * request outright (503) rather than ever falling open.
 */
import { NextResponse, type NextRequest } from "next/server";

import { getAccessGateEnv } from "@/lib/config/access-env";
import {
  ACCESS_SESSION_COOKIE_NAME,
  verifySessionToken,
} from "@/lib/access/session";
import { logEvent } from "@/lib/security/logger";

export const runtime = "nodejs";

/**
 * Phase 3H adds `/chaos`: the operator surface that can START a chaos run.
 * It is protected for the same reason `/demo-merchant` is — docs/SECURITY.md
 * lists "unauthorized chaos execution" as a threat this project must defend
 * against, and an unauthenticated Chaos Lab would be exactly that.
 *
 * `POST /api/chaos/runs` and the `[runId]` chaos routes additionally run
 * their own in-route gate, because this matcher deliberately does not cover
 * `/api/chaos` (widening it would also catch the public Razorpay webhook
 * path pattern in future). The two layers are independent on purpose.
 */
const PROTECTED_PATH_PREFIXES = [
  "/demo-merchant",
  "/chaos",
  // Phase 4F-R3: the Reliability Score page reads persisted chaos evidence
  // and names selected run identifiers, so it is an operator surface and is
  // gated exactly like the other two. `GET /api/reliability` additionally
  // runs its own in-route gate, for the same reason the chaos API routes do.
  "/reliability",
  // Phase 5B: both read persisted chaos/finding evidence and name internal
  // identifiers, so they are operator surfaces and are gated exactly like the
  // three above. `/settings` additionally hosts the Demo Reset control, whose
  // API runs its own in-route gate for the same reason the chaos routes do.
  "/findings",
  "/settings",
] as const;

function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

const SAFE_MISCONFIGURED_BODY = {
  error: "Access gate is misconfigured.",
} as const;

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  if (!isProtectedPath(pathname)) {
    return NextResponse.next();
  }

  let env;
  try {
    env = getAccessGateEnv();
  } catch {
    // Fail closed: an enabled-but-invalid access gate must never fall open
    // for a protected path (docs/SECURITY.md ENV-006/ENV-007 philosophy
    // applied to this config module too).
    logEvent("access_gate_check", {
      outcome: "ACCESS_DENIED",
      reason: "MISCONFIGURED",
      path: pathname,
    });
    return NextResponse.json(SAFE_MISCONFIGURED_BODY, { status: 503 });
  }

  if (env.mode === "disabled") {
    return NextResponse.next();
  }

  const cookie = request.cookies.get(ACCESS_SESSION_COOKIE_NAME)?.value;
  // `env.sessionSecret` is guaranteed non-null when `env.mode === "enabled"`
  // (see `lib/config/access-env.ts`'s `AccessGateEnv` contract).
  if (
    cookie !== undefined &&
    verifySessionToken(env.sessionSecret as string, cookie)
  ) {
    logEvent("access_gate_check", {
      outcome: "ACCESS_GRANTED",
      path: pathname,
    });
    return NextResponse.next();
  }

  logEvent("access_gate_check", {
    outcome: "ACCESS_DENIED",
    reason: "NO_VALID_SESSION",
    path: pathname,
  });

  const loginUrl = new URL("/access", request.url);
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    "/demo-merchant/:path*",
    "/chaos/:path*",
    "/reliability/:path*",
    "/findings/:path*",
    "/settings/:path*",
  ],
};
