import { beforeEach, describe, expect, it, vi } from "vitest";

// Phase 2G readiness: `middleware.ts` exercised against mocked
// `lib/config/access-env.ts` and `lib/access/session.ts` — proves the
// route's own job (protected-path check, session verification, fail-closed
// misconfiguration handling, redirect shape) without real cookies/crypto.

const getAccessGateEnvMock = vi.fn();
vi.mock("@/lib/config/access-env", () => ({
  getAccessGateEnv: getAccessGateEnvMock,
}));

const verifySessionTokenMock = vi.fn();
vi.mock("@/lib/access/session", () => ({
  ACCESS_SESSION_COOKIE_NAME: "paychaos_session",
  verifySessionToken: verifySessionTokenMock,
}));

const logEventMock = vi.fn();
vi.mock("@/lib/security/logger", () => ({
  logEvent: logEventMock,
}));

const FAKE_SECRET = "fake-session-secret-not-real-" + "x".repeat(10);

async function callMiddleware(url: string, cookieHeader?: string) {
  const { middleware } = await import("@/middleware");
  const { NextRequest } = await import("next/server");
  const headers = new Headers();
  if (cookieHeader) headers.set("cookie", cookieHeader);
  const request = new NextRequest(url, { headers });
  return middleware(request);
}

function isRedirect(response: { status: number }): boolean {
  return response.status === 307 || response.status === 308;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("middleware — protected-path scoping", () => {
  it("never touches the webhook route, even when the gate is enabled with no session", async () => {
    getAccessGateEnvMock.mockReturnValue({
      mode: "enabled",
      accessToken: "t",
      sessionSecret: FAKE_SECRET,
    });
    verifySessionTokenMock.mockReturnValue(false);

    const response = await callMiddleware(
      "http://localhost/api/webhooks/razorpay",
    );

    expect(isRedirect(response)).toBe(false);
    expect(response.status).not.toBe(503);
    expect(getAccessGateEnvMock).not.toHaveBeenCalled();
  });

  it("never touches the login route", async () => {
    getAccessGateEnvMock.mockReturnValue({
      mode: "enabled",
      accessToken: "t",
      sessionSecret: FAKE_SECRET,
    });

    const response = await callMiddleware("http://localhost/api/access/login");

    expect(isRedirect(response)).toBe(false);
    expect(getAccessGateEnvMock).not.toHaveBeenCalled();
  });

  it("never touches the home page", async () => {
    getAccessGateEnvMock.mockReturnValue({
      mode: "enabled",
      accessToken: "t",
      sessionSecret: FAKE_SECRET,
    });

    const response = await callMiddleware("http://localhost/");

    expect(isRedirect(response)).toBe(false);
    expect(getAccessGateEnvMock).not.toHaveBeenCalled();
  });
});

describe("middleware — gate disabled", () => {
  it("passes /demo-merchant through untouched", async () => {
    getAccessGateEnvMock.mockReturnValue({
      mode: "disabled",
      accessToken: null,
      sessionSecret: null,
    });

    const response = await callMiddleware("http://localhost/demo-merchant");

    expect(isRedirect(response)).toBe(false);
    expect(response.status).not.toBe(503);
  });
});

describe("middleware — gate enabled", () => {
  it("redirects to /access when no session cookie is present", async () => {
    getAccessGateEnvMock.mockReturnValue({
      mode: "enabled",
      accessToken: "t",
      sessionSecret: FAKE_SECRET,
    });

    const response = await callMiddleware("http://localhost/demo-merchant");

    expect(isRedirect(response)).toBe(true);
    const location = response.headers.get("location");
    expect(location).toContain("/access");
    expect(location).toContain("next=%2Fdemo-merchant");
  });

  it("redirects to /access when the session cookie fails verification", async () => {
    getAccessGateEnvMock.mockReturnValue({
      mode: "enabled",
      accessToken: "t",
      sessionSecret: FAKE_SECRET,
    });
    verifySessionTokenMock.mockReturnValue(false);

    const response = await callMiddleware(
      "http://localhost/demo-merchant",
      "paychaos_session=forged-or-expired",
    );

    expect(isRedirect(response)).toBe(true);
  });

  it("passes through when the session cookie verifies", async () => {
    getAccessGateEnvMock.mockReturnValue({
      mode: "enabled",
      accessToken: "t",
      sessionSecret: FAKE_SECRET,
    });
    verifySessionTokenMock.mockReturnValue(true);

    const response = await callMiddleware(
      "http://localhost/demo-merchant",
      "paychaos_session=valid-looking-token",
    );

    expect(isRedirect(response)).toBe(false);
    expect(response.status).not.toBe(503);
  });

  it("fails closed (503, no fall-open) when the gate config itself is invalid", async () => {
    getAccessGateEnvMock.mockImplementation(() => {
      throw new Error("misconfigured");
    });

    const response = await callMiddleware("http://localhost/demo-merchant");

    expect(isRedirect(response)).toBe(false);
    expect(response.status).toBe(503);
  });

  it("protects a nested demo-merchant sub-path the same way", async () => {
    getAccessGateEnvMock.mockReturnValue({
      mode: "enabled",
      accessToken: "t",
      sessionSecret: FAKE_SECRET,
    });

    const response = await callMiddleware(
      "http://localhost/demo-merchant/anything",
    );

    expect(isRedirect(response)).toBe(true);
  });
});

/**
 * Phase 3H — `/chaos` is the operator surface that can START a chaos run, so
 * it is gated exactly like `/demo-merchant`. docs/SECURITY.md lists
 * "unauthorized chaos execution" as a threat this project must defend
 * against; an unauthenticated Chaos Lab would be that threat realised.
 */
describe("middleware — Chaos Lab is protected (Phase 3H)", () => {
  it("redirects /chaos to /access when no session cookie is present", async () => {
    getAccessGateEnvMock.mockReturnValue({
      mode: "enabled",
      accessToken: "t",
      sessionSecret: FAKE_SECRET,
    });
    verifySessionTokenMock.mockReturnValue(false);

    const response = await callMiddleware("http://localhost/chaos");

    expect(isRedirect(response)).toBe(true);
  });

  it("protects every nested chaos sub-path — scenarios and runs alike", async () => {
    getAccessGateEnvMock.mockReturnValue({
      mode: "enabled",
      accessToken: "t",
      sessionSecret: FAKE_SECRET,
    });
    verifySessionTokenMock.mockReturnValue(false);

    for (const path of [
      "/chaos/scenarios/C01",
      "/chaos/scenarios/C11",
      "/chaos/runs/00000000-0000-4000-8000-000000000000",
    ]) {
      const response = await callMiddleware(`http://localhost${path}`);
      expect(isRedirect(response), path).toBe(true);
    }
  });

  it("passes /chaos through when the session cookie verifies", async () => {
    getAccessGateEnvMock.mockReturnValue({
      mode: "enabled",
      accessToken: "t",
      sessionSecret: FAKE_SECRET,
    });
    verifySessionTokenMock.mockReturnValue(true);

    const response = await callMiddleware(
      "http://localhost/chaos",
      "paychaos_session=valid",
    );

    expect(isRedirect(response)).toBe(false);
  });

  it("fails closed on /chaos when the gate config itself is invalid", async () => {
    getAccessGateEnvMock.mockImplementation(() => {
      throw new Error("bad config");
    });

    const response = await callMiddleware("http://localhost/chaos");

    expect(response.status).toBe(503);
  });

  it("does NOT gate a path that merely starts with the same letters", async () => {
    // `/chaos-public` is not a sub-path of `/chaos`; prefix matching must be
    // segment-aware or an unrelated future route would silently require login.
    getAccessGateEnvMock.mockReturnValue({
      mode: "enabled",
      accessToken: "t",
      sessionSecret: FAKE_SECRET,
    });

    const response = await callMiddleware("http://localhost/chaos-public");

    expect(isRedirect(response)).toBe(false);
    expect(getAccessGateEnvMock).not.toHaveBeenCalled();
  });
});

describe("middleware config matcher", () => {
  it("declares exactly the two mutation-capable operator surfaces", async () => {
    const { config } = await import("@/middleware");
    expect(config.matcher).toEqual(["/demo-merchant/:path*", "/chaos/:path*"]);
  });

  it("never declares the public webhook or the login route", async () => {
    const { config } = await import("@/middleware");
    const declared = config.matcher.join(" ");
    expect(declared).not.toContain("webhook");
    expect(declared).not.toContain("/api/access");
  });
});
