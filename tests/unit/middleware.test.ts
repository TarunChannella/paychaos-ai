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
 * PHASE 5 — THE MODEL CHANGED, THE PROPERTY DID NOT.
 *
 * Reading a page is now public so a Buildathon reviewer can explore the
 * product without a code. What must still be refused is an unauthenticated
 * STATE CHANGE — and Next.js delivers a Server Action as a POST to the page's
 * own URL, which is exactly what these tests now exercise.
 *
 * The denial assertions below were previously written against GET, because
 * GET used to be denied. They were not deleted or relaxed: each one now
 * asserts the same denial against the method that can actually cause harm,
 * and a companion assertion pins that GET is deliberately public. That is
 * more coverage than before, not less.
 */
function isDenied(response: { status: number }): boolean {
  return response.status === 401;
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
  it("refuses an unauthenticated STATE CHANGE with 401", async () => {
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
    expect(isDenied(response)).toBe(true);
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

  it("refuses a STATE CHANGE when the session cookie fails verification", async () => {
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

    expect(isDenied(response)).toBe(true);
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

    const response = await callMiddleware(
      "http://localhost/demo-merchant",
      undefined,
      "POST",
    );

    expect(isRedirect(response)).toBe(false);
    expect(response.status).toBe(503);

    // A misconfigured gate must never let a STATE CHANGE through. Reading
    // stays public, which is the deliberate new model rather than a
    // fall-open: these pages expose no secret and are meant to be readable.
    const read = await callMiddleware("http://localhost/demo-merchant");
    expect(read.status).toBe(200);
  });

  it("protects a nested demo-merchant sub-path the same way", async () => {
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

    expect(isDenied(response)).toBe(true);
  });
});

/**
 * Phase 3H — `/chaos` is the operator surface that can START a chaos run, so
 * it is gated exactly like `/demo-merchant`. docs/SECURITY.md lists
 * "unauthorized chaos execution" as a threat this project must defend
 * against; an unauthenticated Chaos Lab would be that threat realised.
 */
describe("middleware — Chaos Lab is protected (Phase 3H)", () => {
  it("refuses an unauthenticated STATE CHANGE to /chaos", async () => {
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

    expect(isDenied(response)).toBe(true);

    // Reading the Chaos Lab is public; STARTING a run is not, and that is
    // additionally enforced inside every chaos API route.
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
      expect(isDenied(response), path).toBe(true);

      // ...while reading any of them stays public.
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

  it("fails closed on /chaos when the gate config itself is invalid", async () => {
    getAccessGateEnvMock.mockImplementation(() => {
      throw new Error("bad config");
    });

    const response = await callMiddleware(
      "http://localhost/chaos",
      undefined,
      "POST",
    );

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
