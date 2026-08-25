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

describe("middleware config matcher", () => {
  it("only declares the Demo Merchant path", async () => {
    const { config } = await import("@/middleware");
    expect(config.matcher).toEqual(["/demo-merchant/:path*"]);
  });
});
