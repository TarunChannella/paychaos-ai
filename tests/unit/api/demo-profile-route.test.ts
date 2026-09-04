import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Phase 5 — `GET`/`POST /api/demo/profile`.
 *
 * The endpoint that enables the controlled C01 Demo Merchant vulnerability.
 * Enabling a deliberate defect is a state change, so it is gated exactly like
 * every other state change in the product — by the SAME Demo Access Code
 * session, never a second mechanism.
 *
 * These tests exist to prove the gate cannot be walked around, that reading
 * the mode stays public (docs/DEMO_PLAN.md Section 9 requires the vulnerable
 * path to be visible, not hidden), and that no request input reaches the
 * service except one of two enum values.
 */

const getAccessGateEnvMock = vi.fn();
vi.mock("@/lib/config/access-env", () => ({
  getAccessGateEnv: getAccessGateEnvMock,
}));

const verifySessionTokenMock = vi.fn();
vi.mock("@/lib/access/session", () => ({
  ACCESS_SESSION_COOKIE_NAME: "paychaos_session",
  verifySessionToken: verifySessionTokenMock,
}));

const setProfileMock = vi.fn();
const readProfileMock = vi.fn();
vi.mock("@/lib/demo-profile/service", async () => {
  // The real guard is reused deliberately: a test double for validation
  // would let the route accept a value the product rejects.
  const actual = await vi.importActual<
    typeof import("@/lib/demo-profile/service")
  >("@/lib/demo-profile/service");
  return {
    isC01IdempotencyProfile: actual.isC01IdempotencyProfile,
    setC01IdempotencyProfile: (...args: unknown[]) => setProfileMock(...args),
    readC01IdempotencyProfile: (...args: unknown[]) => readProfileMock(...args),
  };
});

const logEventMock = vi.fn();
vi.mock("@/lib/security/logger", () => ({ logEvent: logEventMock }));

vi.mock("server-only", () => ({}));

async function callPost(
  options: {
    secFetchSite?: string;
    origin?: string;
    body?: string;
    cookie?: string;
  } = {},
) {
  const { POST } = await import("@/app/api/demo/profile/route");
  const { NextRequest } = await import("next/server");

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (options.secFetchSite !== undefined)
    headers["sec-fetch-site"] = options.secFetchSite;
  if (options.origin !== undefined) headers["origin"] = options.origin;
  if (options.cookie !== undefined)
    headers["cookie"] = `paychaos_session=${options.cookie}`;

  const request = new NextRequest("http://localhost/api/demo/profile", {
    method: "POST",
    headers,
    body: options.body ?? JSON.stringify({ profile: "VULNERABLE_IDEMPOTENCY" }),
  });
  return POST(request);
}

/**
 * Warm the route module once, outside any test's 5s budget.
 *
 * `callPost` dynamically imports the route, and the FIRST import in a worker
 * pays the whole transform cost for the route and its transitive Next.js
 * imports. On a loaded machine that has been observed just past 5s, which
 * fails the first test in the file for a reason that has nothing to do with
 * what it asserts. Paying it here keeps the assertions honest instead of
 * inflating every individual timeout.
 */
beforeAll(async () => {
  await import("@/app/api/demo/profile/route");
}, 60_000);

beforeEach(() => {
  vi.clearAllMocks();
  getAccessGateEnvMock.mockReturnValue({ mode: "disabled" });
  verifySessionTokenMock.mockReturnValue(true);
  setProfileMock.mockResolvedValue({
    ok: true,
    profile: "VULNERABLE_IDEMPOTENCY",
    failureReason: null,
  });
  readProfileMock.mockResolvedValue({
    ok: true,
    profile: "SAFE",
    failureReason: null,
  });
});

describe("profile route — an unauthorized caller cannot enable the defect", () => {
  it("1: a gated request with no session is refused with 401", async () => {
    getAccessGateEnvMock.mockReturnValue({
      mode: "enabled",
      sessionSecret: "s".repeat(32),
      accessToken: "t".repeat(20),
    });

    const response = await callPost();

    expect(response.status).toBe(401);
    expect(setProfileMock).not.toHaveBeenCalled();
  });

  it("2: an invalid session cookie is refused with 401", async () => {
    getAccessGateEnvMock.mockReturnValue({
      mode: "enabled",
      sessionSecret: "s".repeat(32),
      accessToken: "t".repeat(20),
    });
    verifySessionTokenMock.mockReturnValue(false);

    const response = await callPost({ cookie: "forged" });

    expect(response.status).toBe(401);
    expect(setProfileMock).not.toHaveBeenCalled();
  });

  it("3: a valid session is accepted", async () => {
    getAccessGateEnvMock.mockReturnValue({
      mode: "enabled",
      sessionSecret: "s".repeat(32),
      accessToken: "t".repeat(20),
    });
    verifySessionTokenMock.mockReturnValue(true);

    const response = await callPost({ cookie: "valid" });

    expect(response.status).toBe(200);
    expect(setProfileMock).toHaveBeenCalledWith("VULNERABLE_IDEMPOTENCY");
  });

  it("4: a misconfigured gate fails closed with 503, never open", async () => {
    getAccessGateEnvMock.mockImplementation(() => {
      throw new Error("misconfigured");
    });

    const response = await callPost();

    expect(response.status).toBe(503);
    expect(setProfileMock).not.toHaveBeenCalled();
  });

  it("5: a cross-site request is refused before anything else", async () => {
    const response = await callPost({ secFetchSite: "cross-site" });

    expect(response.status).toBe(403);
    expect(setProfileMock).not.toHaveBeenCalled();
  });

  it("6: a foreign Origin header is refused", async () => {
    const response = await callPost({ origin: "https://evil.example" });

    expect(response.status).toBe(403);
    expect(setProfileMock).not.toHaveBeenCalled();
  });

  it("7: it uses the existing session mechanism, not a new one", async () => {
    getAccessGateEnvMock.mockReturnValue({
      mode: "enabled",
      sessionSecret: "s".repeat(32),
      accessToken: "t".repeat(20),
    });
    await callPost({ cookie: "valid" });

    // The same verifier as every other gated route. A second authentication
    // path is the thing most likely to drift out of step with the first.
    expect(verifySessionTokenMock).toHaveBeenCalledTimes(1);
  });
});

describe("profile route — only the two approved values reach the service", () => {
  it("8: an unknown profile is rejected with 400", async () => {
    for (const body of [
      JSON.stringify({ profile: "VULNERABLE" }),
      JSON.stringify({ profile: "safe" }),
      JSON.stringify({ profile: "" }),
      JSON.stringify({ profile: null }),
      JSON.stringify({ profile: { toString: "SAFE" } }),
      JSON.stringify({}),
      JSON.stringify([]),
    ]) {
      setProfileMock.mockClear();
      const response = await callPost({ body });
      expect(response.status, body).toBe(400);
      expect(setProfileMock, body).not.toHaveBeenCalled();
    }
  });

  it("9: a malformed body is rejected, not thrown", async () => {
    const response = await callPost({ body: "{not json" });

    expect(response.status).toBe(400);
    expect(setProfileMock).not.toHaveBeenCalled();
  });

  it("10: both approved values are accepted", async () => {
    for (const profile of ["SAFE", "VULNERABLE_IDEMPOTENCY"]) {
      setProfileMock.mockClear();
      setProfileMock.mockResolvedValue({
        ok: true,
        profile,
        failureReason: null,
      });

      const response = await callPost({ body: JSON.stringify({ profile }) });

      expect(response.status, profile).toBe(200);
      expect(setProfileMock).toHaveBeenCalledWith(profile);
    }
  });

  it("11: the body is parsed only AFTER authorization", async () => {
    // An unauthorized caller must not reach the parser at all.
    getAccessGateEnvMock.mockReturnValue({
      mode: "enabled",
      sessionSecret: "s".repeat(32),
      accessToken: "t".repeat(20),
    });
    verifySessionTokenMock.mockReturnValue(false);

    const response = await callPost({ body: "{not json", cookie: "bad" });

    // 401 (unauthorized), NOT 400 (malformed): the gate ran first.
    expect(response.status).toBe(401);
  });
});

describe("profile route — Test Mode refusal is reported honestly", () => {
  it("12: a non-Test-Mode refusal is 403 with a clear reason", async () => {
    setProfileMock.mockResolvedValue({
      ok: false,
      profile: null,
      failureReason: "PROFILE_NOT_TEST_MODE",
    });

    const response = await callPost();
    const body = (await response.json()) as { error?: string };

    expect(response.status).toBe(403);
    expect(body.error).toContain("Test Mode");
  });

  it("13: a write failure is 500 and never claims success", async () => {
    setProfileMock.mockResolvedValue({
      ok: false,
      profile: null,
      failureReason: "PROFILE_WRITE_FAILED",
    });

    const response = await callPost();
    const body = (await response.json()) as { ok?: boolean; error?: string };

    expect(response.status).toBe(500);
    expect(body.ok).toBeUndefined();
    expect(body.error).toBeDefined();
  });
});

describe("profile route — reading the mode stays public", () => {
  it("14: GET reports the current mode without any session", async () => {
    const { GET } = await import("@/app/api/demo/profile/route");
    const response = await GET();
    const body = (await response.json()) as { profile?: string };

    expect(response.status).toBe(200);
    expect(body.profile).toBe("SAFE");
    // Reading must not consult the gate at all: the mode is deliberately
    // visible, per docs/DEMO_PLAN.md Section 9.
    expect(verifySessionTokenMock).not.toHaveBeenCalled();
  });

  it("15: an unreadable profile is 503, never a fabricated SAFE", async () => {
    readProfileMock.mockResolvedValue({
      ok: false,
      profile: null,
      failureReason: "PROFILE_TABLE_UNAVAILABLE",
    });

    const { GET } = await import("@/app/api/demo/profile/route");
    const response = await GET();
    const body = (await response.json()) as { profile?: string };

    expect(response.status).toBe(503);
    expect(body.profile).toBeUndefined();
  });
});

describe("profile route — nothing sensitive is logged", () => {
  it("16: no log call carries a cookie, token or secret", async () => {
    getAccessGateEnvMock.mockReturnValue({
      mode: "enabled",
      sessionSecret: "s".repeat(32),
      accessToken: "t".repeat(20),
    });
    await callPost({ cookie: "valid" });

    const serialized = JSON.stringify(logEventMock.mock.calls);
    expect(serialized).not.toContain("s".repeat(32));
    expect(serialized).not.toContain("t".repeat(20));
    expect(serialized.toLowerCase()).not.toContain("cookie");
    expect(serialized.toLowerCase()).not.toContain("paychaos_session");
  });

  it("17: the audit trail records that the profile changed", async () => {
    // The one fact worth keeping: a deliberate defect was switched on.
    await callPost();

    const serialized = JSON.stringify(logEventMock.mock.calls);
    expect(serialized).toContain("demo_profile_change");
    expect(serialized).toContain("VULNERABLE_IDEMPOTENCY");
  });
});
