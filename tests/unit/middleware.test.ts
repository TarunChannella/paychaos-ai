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

async function callMiddleware(
  url: string,
  cookieHeader?: string,
  method: "GET" | "POST" = "GET",
) {
  const { middleware } = await import("@/middleware");
  const { NextRequest } = await import("next/server");
  const headers = new Headers();
  if (cookieHeader) headers.set("cookie", cookieHeader);
  const request = new NextRequest(url, { headers, method });
  return middleware(request);
}

/**
 * PHASE 5 — CORRECTED AFTER A CONFIRMED PRODUCTION DEFECT.
 *
 * An earlier revision challenged unsafe methods here with a 401 JSON body.
 * That broke the deployed app: Next.js routes a Server Action POST through
 * the page's own URL, and React's action client cannot parse a JSON 401 any
 * more than it can parse an HTML redirect — so clicking "Create Internal Test
 * Order" threw in the browser and rendered the global error boundary.
 *
 * Reproduced locally with the gate enabled, then fixed by removing the
 * challenge. These tests are updated to the corrected contract rather than
 * deleted, and the SECURITY property they used to carry has not been dropped:
 * it lives in the action and route guards, which refuse the same requests and
 * are asserted in tests/unit/access/interactive-gate.test.ts (every mutating
 * Server Action calls the guard; every mutating API route verifies the
 * session itself). Middleware was always documented as defence in depth.
 *
 * What middleware must guarantee NOW is the thing whose absence broke
 * production: it must not interfere with a request at all.
 */
function passesThrough(response: { status: number }): boolean {
  return response.status === 200;
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
  it("does NOT intercept a Server Action POST — that broke production", async () => {
    getAccessGateEnvMock.mockReturnValue({
      mode: "enabled",
      accessToken: "t",
      sessionSecret: FAKE_SECRET,
    });

    const response = await callMiddleware(
      "http://localhost/demo-merchant",
      undefined,
      "POST",
    );

    // 401, not a redirect: a Server Action POST answered with an HTML login
    // page hands the client a document where it expects an action result.
    expect(passesThrough(response)).toBe(true);
    expect(isRedirect(response)).toBe(false);
  });

  it("lets an unauthenticated READ through — pages are public", async () => {
    getAccessGateEnvMock.mockReturnValue({
      mode: "enabled",
      accessToken: "t",
      sessionSecret: FAKE_SECRET,
    });

    const response = await callMiddleware("http://localhost/demo-merchant");

    expect(response.status).toBe(200);
    expect(isRedirect(response)).toBe(false);
  });

  it("does not intercept even when the session cookie is invalid", async () => {
    getAccessGateEnvMock.mockReturnValue({
      mode: "enabled",
      accessToken: "t",
      sessionSecret: FAKE_SECRET,
    });
    verifySessionTokenMock.mockReturnValue(false);

    const response = await callMiddleware(
      "http://localhost/demo-merchant",
      "paychaos_session=forged-or-expired",
      "POST",
    );

    // A forged cookie is refused by the action guard, not here.
    expect(passesThrough(response)).toBe(true);
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

  it("no longer reads config at all, so it cannot 503 a page request", async () => {
    getAccessGateEnvMock.mockImplementation(() => {
      throw new Error("misconfigured");
    });

    const response = await callMiddleware(
      "http://localhost/demo-merchant",
      undefined,
      "POST",
    );

    // CORRECTED. Middleware used to answer a misconfigured gate with 503,
    // which is what broke Server Actions. The fail-closed guarantee did not
    // disappear: `checkInteractiveAccess()` returns "misconfigured" and every
    // gated action refuses, and each mutating API route returns 503 itself —
    // asserted in tests/unit/access/interactive-gate.test.ts and the route
    // tests. Middleware's own job is now to stay out of the way.
    expect(isRedirect(response)).toBe(false);
    expect(passesThrough(response)).toBe(true);

    const read = await callMiddleware("http://localhost/demo-merchant");
    expect(read.status).toBe(200);
  });

  it("does not intercept a nested demo-merchant sub-path either", async () => {
    getAccessGateEnvMock.mockReturnValue({
      mode: "enabled",
      accessToken: "t",
      sessionSecret: FAKE_SECRET,
    });

    const response = await callMiddleware(
      "http://localhost/demo-merchant/anything",
      undefined,
      "POST",
    );

    expect(passesThrough(response)).toBe(true);
  });
});

/**
 * Phase 3H — `/chaos` is the operator surface that can START a chaos run, so
 * it is gated exactly like `/demo-merchant`. docs/SECURITY.md lists
 * "unauthorized chaos execution" as a threat this project must defend
 * against; an unauthenticated Chaos Lab would be that threat realised.
 */
describe("middleware — Chaos Lab is protected (Phase 3H)", () => {
  it("does not intercept a state change to /chaos either", async () => {
    getAccessGateEnvMock.mockReturnValue({
      mode: "enabled",
      accessToken: "t",
      sessionSecret: FAKE_SECRET,
    });
    verifySessionTokenMock.mockReturnValue(false);

    const response = await callMiddleware(
      "http://localhost/chaos",
      undefined,
      "POST",
    );

    // Starting a run is refused inside every chaos API route, which is where
    // the control belongs.
    expect(passesThrough(response)).toBe(true);

    const read = await callMiddleware("http://localhost/chaos");
    expect(read.status).toBe(200);
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
      const response = await callMiddleware(
        `http://localhost${path}`,
        undefined,
        "POST",
      );
      expect(passesThrough(response), path).toBe(true);

      // ...and reading any of them stays public.
      const read = await callMiddleware(`http://localhost${path}`);
      expect(read.status, path).toBe(200);
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

  it("does not 503 a /chaos page request either", async () => {
    getAccessGateEnvMock.mockImplementation(() => {
      throw new Error("bad config");
    });

    const response = await callMiddleware(
      "http://localhost/chaos",
      undefined,
      "POST",
    );

    // Same correction: the chaos API routes carry the 503, not this file.
    expect(passesThrough(response)).toBe(true);
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
  it("declares exactly the five gated operator surfaces", async () => {
    // Advanced in Phase 4F-R3 and again in Phase 5B, still an exact equality.
    // `/reliability`, `/findings` and `/settings` are read-only rather than
    // mutation-capable, but each exposes persisted chaos evidence and internal
    // identifiers — and `/settings` hosts the Demo Reset control — so all sit
    // behind the same operator gate. Exact equality is the point: a new
    // operator surface cannot appear ungated without failing here.
    const { config } = await import("@/middleware");
    expect(config.matcher).toEqual([
      "/demo-merchant/:path*",
      "/chaos/:path*",
      "/reliability/:path*",
      "/findings/:path*",
      "/settings/:path*",
    ]);
  });

  it("gates the reliability page exactly like the other operator surfaces", async () => {
    const { config } = await import("@/middleware");
    expect(config.matcher).toContain("/reliability/:path*");
  });

  it("never declares the public webhook or the login route", async () => {
    const { config } = await import("@/middleware");
    const declared = config.matcher.join(" ");
    expect(declared).not.toContain("webhook");
    expect(declared).not.toContain("/api/access");
  });
});
