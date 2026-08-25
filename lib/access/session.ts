/**
 * Phase 2G readiness — signed operator session tokens for the minimal
 * single-workspace access gate (docs/SECURITY.md Section 17 "P0 Access
 * Gate").
 *
 * No user record exists (single workspace, per docs/SECURITY.md "No user
 * record is required") — a session token proves only "the operator
 * previously supplied the correct `PAYCHAOS_ACCESS_TOKEN`", carrying no
 * identity, just a signed expiry:
 *
 *   token = "<expiresAtMs>.<HMAC-SHA256(expiresAtMs, PAYCHAOS_SESSION_SECRET)>"
 *
 * Uses Node's built-in `crypto` directly with a timing-safe comparison —
 * matching `lib/razorpay/webhook-verification.ts`'s established pattern
 * (one HMAC comparison does not justify a new dependency, per CLAUDE.md
 * "do not add unnecessary frameworks").
 *
 * `import "server-only"`: this module is read by `middleware.ts` (Node
 * middleware runtime, `export const runtime = "nodejs"`, same reason the
 * webhook route needs it — see below) and
 * `app/api/access/login/route.ts`, never by client code.
 */
import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

/** Never sent to the browser except as this exact HttpOnly cookie. */
export const ACCESS_SESSION_COOKIE_NAME = "paychaos_session";

/**
 * Reasonable demo lifetime (docs/SECURITY.md "Session Requirements":
 * "short-lived/reasonable demo lifetime"). 12 hours comfortably covers one
 * manual verification/demo session without requiring re-login mid-task.
 */
export const SESSION_LIFETIME_SECONDS = 12 * 60 * 60;

const TOKEN_PATTERN = /^(\d+)\.([0-9a-f]{64})$/;

function sign(expiresAtMs: string, sessionSecret: string): string {
  return createHmac("sha256", sessionSecret).update(expiresAtMs).digest("hex");
}

export interface CreatedSessionToken {
  readonly token: string;
  readonly maxAgeSeconds: number;
}

/**
 * Creates one new signed session token, valid for
 * `SESSION_LIFETIME_SECONDS` from `now`. `now` is injectable for
 * deterministic tests; defaults to the real clock.
 */
export function createSessionToken(
  sessionSecret: string,
  now: number = Date.now(),
): CreatedSessionToken {
  const expiresAtMs = String(now + SESSION_LIFETIME_SECONDS * 1000);
  const signature = sign(expiresAtMs, sessionSecret);
  return {
    token: `${expiresAtMs}.${signature}`,
    maxAgeSeconds: SESSION_LIFETIME_SECONDS,
  };
}

/**
 * Verifies a session token: well-formed shape, signature matches (timing-
 * safe comparison), and not expired as of `now` (injectable for
 * deterministic tests). Returns a plain boolean — never throws, so a
 * missing/malformed/forged cookie is always treated as "not authenticated"
 * rather than a 500.
 */
export function verifySessionToken(
  sessionSecret: string,
  token: string | undefined | null,
  now: number = Date.now(),
): boolean {
  if (typeof token !== "string") {
    return false;
  }

  const match = TOKEN_PATTERN.exec(token);
  if (!match) {
    return false;
  }

  const expiresAtMsText = match[1];
  const receivedSignature = match[2];
  if (expiresAtMsText === undefined || receivedSignature === undefined) {
    return false;
  }

  const expectedSignature = sign(expiresAtMsText, sessionSecret);

  const expectedBuffer = Buffer.from(expectedSignature, "utf8");
  const receivedBuffer = Buffer.from(receivedSignature, "utf8");
  if (expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }
  if (!timingSafeEqual(expectedBuffer, receivedBuffer)) {
    return false;
  }

  const expiresAtMs = Number(expiresAtMsText);
  if (!Number.isSafeInteger(expiresAtMs)) {
    return false;
  }

  return expiresAtMs > now;
}
