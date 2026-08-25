/**
 * Phase 2G readiness — `POST /api/access/logout`.
 *
 * Clears the operator session cookie unconditionally. Safe/idempotent
 * regardless of access-gate mode or whether a session currently exists —
 * always returns `{ ok: true }` and a cookie-clearing response.
 */
import { NextResponse } from "next/server";

import { ACCESS_SESSION_COOKIE_NAME } from "@/lib/access/session";

export const runtime = "nodejs";

export async function POST(): Promise<NextResponse> {
  const response = NextResponse.json({ ok: true }, { status: 200 });
  response.cookies.set(ACCESS_SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
