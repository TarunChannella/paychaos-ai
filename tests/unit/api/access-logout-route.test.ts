import { describe, expect, it, vi } from "vitest";

// Phase 2G readiness: this route transitively imports
// lib/access/session.ts, a server-only module (same rationale as every
// other server-only-adjacent route test in this repo).
vi.mock("server-only", () => ({}));

describe("POST /api/access/logout", () => {
  it("always returns ok and clears the session cookie", async () => {
    const { POST } = await import("@/app/api/access/logout/route");

    const response = await POST();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ ok: true });

    const setCookie = response.headers.get("set-cookie");
    expect(setCookie).not.toBeNull();
    expect(setCookie).toContain("paychaos_session=");
    expect(setCookie).toMatch(/Max-Age=0/i);
  });
});
