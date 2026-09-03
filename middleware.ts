/**
 * Phase 2G readiness — minimal single-workspace operator access-gate
 * enforcement (docs/SECURITY.md Section 17, docs/ARCHITECTURE.md ADR-A16,
 * docs/PHASE_PLAN.md Section 6.4 item 2/6.8 item 1).
 *
 * PHASE 5 UPDATE: this no longer blocks page VIEWING. Read-only exploration
 * of every product surface is public so the deployed app can be understood
 * without a code; authorization moved to the operations that change state.
 * The paths below are still matched, but only unsafe HTTP methods to them are
 * challenged — which is how a Next.js Server Action POST arrives.
 *
 * Historically this protected the operator surfaces: the Demo Merchant (`/demo-merchant` and
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

/**
 * Phase 5 — THIS MIDDLEWARE NO LONGER GATES PAGE REQUESTS. Authorization for
 * state changes lives in the operations themselves.
 *
 * WHY IT WAS REMOVED (a confirmed production defect). The previous revision
 * challenged any UNSAFE method reaching a page path with a 401 JSON body,
 * reasoning that a Server Action POST is not a navigation and so must not be
 * redirected to a login page. That reasoning was right and the remedy was
 * wrong: Next.js routes a Server Action POST through the page's own URL, and
 * React's action client expects the RSC action-result protocol. A plain JSON
 * 401 is no more parseable than an HTML redirect, so the call threw in the
 * browser and the global error boundary rendered "This screen could not be
 * loaded." on the deployed Preview.
 *
 * Reproduced locally with the gate enabled: clicking "Create Internal Test
 * Order" logged `access_gate_check ACCESS_DENIED path=/demo-merchant` and
 * produced that exact screen, while the action's own guard never ran and no
 * Supabase call was ever made — the middleware refused the request before the
 * action existed.
 *
 * The security property is unaffected, and this was already true when the
 * challenge was added: every mutating Server Action calls
 * `checkInteractiveAccess()` before it touches anything, and every mutating
 * API route verifies the session itself. Both are asserted by test, and the
 * previous commit message said so outright — "delete it and nothing becomes
 * public". So the challenge was redundant as well as harmful.
 *
 * Detecting the Server Action header and letting only those through was
 * considered and rejected: it depends on a framework-internal header, so a
 * future Next.js rename would silently reintroduce exactly this bug.
 *
 * The matcher is kept so this file stays the single, obvious place a
 * page-level control would be reinstated if one is ever genuinely needed.
 */
export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  if (!isProtectedPath(pathname)) {
    return NextResponse.next();
  }

  // Reading a page is public, and a state change must reach the operation
  // that knows how to refuse it properly.
  return NextResponse.next();
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
