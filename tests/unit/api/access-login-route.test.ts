import { beforeEach, describe, expect, it, vi } from "vitest";

// Phase 2G readiness: `app/api/access/login/route.ts` exercised against a
// mocked `lib/config/access-env.ts` and `lib/access/session.ts` — no real
// cookies-from-a-browser, no real Supabase/Razorpay. Proves only the
// route's own job: validate the gate, timing-safe-compare the token, set
// (or refuse to set) the session cookie, and never leak the token/secret.

const getAccessGateEnvMock = vi.fn();
vi.mock("@/lib/config/access-env", () => ({
  getAccessGateEnv: getAccessGateEnvMock,
}));

const createSessionTokenMock = vi.fn();
vi.mock("@/lib/access/session", () => ({
  ACCESS_SESSION_COOKIE_NAME: "paychaos_session",
  createSessionToken: createSessionTokenMock,
}));

const logEventMock = vi.fn();
vi.mock("@/lib/security/logger", () => ({
  logEvent: logEventMock,
}));

const FAKE_TOKEN = "fake-access-token-not-real-abc123";
const FAKE_SECRET = "fake-session-secret-not-real-" + "x".repeat(10);

async function callLogin(body: string) {
  const { POST } = await import("@/app/api/access/login/route");
  const { NextRequest } = await import("next/server");
  const request = new NextRequest("http://localhost/api/access/login", {
    method: "POST",
    body,
    headers: { "content-type": "application/json" },
  });
  return POST(request);
}

beforeEach(() => {
  vi.clearAllMocks();
  createSessionTokenMock.mockReturnValue({
    token: "9999999999999.abc",
    maxAgeSeconds: 43200,
  });
});

describe("POST /api/access/login", () => {
  it("returns 404 and sets no cookie when the gate is disabled", async () => {
    getAccessGateEnvMock.mockReturnValue({
      mode: "disabled",
      accessToken: null,
      sessionSecret: null,
    });

    const response = await callLogin(JSON.stringify({ token: FAKE_TOKEN }));

    expect(response.status).toBe(404);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(createSessionTokenMock).not.toHaveBeenCalled();
  });

  it("returns 503 and sets no cookie when the gate is misconfigured", async () => {
    getAccessGateEnvMock.mockImplementation(() => {
      throw new Error("misconfigured");
    });

    const response = await callLogin(JSON.stringify({ token: FAKE_TOKEN }));

    expect(response.status).toBe(503);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("returns 200 and sets a session cookie for the correct token", async () => {
    getAccessGateEnvMock.mockReturnValue({
      mode: "enabled",
      accessToken: FAKE_TOKEN,
      sessionSecret: FAKE_SECRET,
    });

    const response = await callLogin(JSON.stringify({ token: FAKE_TOKEN }));

    expect(response.status).toBe(200);
    const setCookie = response.headers.get("set-cookie");
    expect(setCookie).not.toBeNull();
    expect(setCookie).toContain("paychaos_session=");
    expect(setCookie).toMatch(/HttpOnly/i);
    const body = await response.json();
    expect(body).toEqual({ ok: true });
  });

  it("returns 401 and sets no cookie for an incorrect token", async () => {
    getAccessGateEnvMock.mockReturnValue({
      mode: "enabled",
      accessToken: FAKE_TOKEN,
      sessionSecret: FAKE_SECRET,
    });

    const response = await callLogin(
      JSON.stringify({ token: "totally-wrong-token" }),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(createSessionTokenMock).not.toHaveBeenCalled();
  });

  it("returns 401 for a token that differs only in length from the real one", async () => {
    getAccessGateEnvMock.mockReturnValue({
      mode: "enabled",
      accessToken: FAKE_TOKEN,
      sessionSecret: FAKE_SECRET,
    });

    const response = await callLogin(
      JSON.stringify({ token: FAKE_TOKEN.slice(0, -1) }),
    );

    expect(response.status).toBe(401);
  });

  it("returns 400 for malformed JSON", async () => {
    getAccessGateEnvMock.mockReturnValue({
      mode: "enabled",
      accessToken: FAKE_TOKEN,
      sessionSecret: FAKE_SECRET,
    });

    const response = await callLogin("not json");

    expect(response.status).toBe(400);
  });

  it("returns 400 when the token field is missing", async () => {
    getAccessGateEnvMock.mockReturnValue({
      mode: "enabled",
      accessToken: FAKE_TOKEN,
      sessionSecret: FAKE_SECRET,
    });

    const response = await callLogin(JSON.stringify({}));

    expect(response.status).toBe(400);
  });

  it("returns 400 for an oversized request body without parsing it", async () => {
    getAccessGateEnvMock.mockReturnValue({
      mode: "enabled",
      accessToken: FAKE_TOKEN,
      sessionSecret: FAKE_SECRET,
    });

    const response = await callLogin(
      JSON.stringify({ token: "a".repeat(10_000) }),
    );

    expect(response.status).toBe(400);
  });

  it("never logs the supplied or configured token/secret on any path", async () => {
    getAccessGateEnvMock.mockReturnValue({
      mode: "enabled",
      accessToken: FAKE_TOKEN,
      sessionSecret: FAKE_SECRET,
    });

    await callLogin(JSON.stringify({ token: "wrong-token-value" }));
    await callLogin(JSON.stringify({ token: FAKE_TOKEN }));

    for (const call of logEventMock.mock.calls) {
      const serialized = JSON.stringify(call);
      expect(serialized).not.toContain(FAKE_TOKEN);
      expect(serialized).not.toContain(FAKE_SECRET);
      expect(serialized).not.toContain("wrong-token-value");
    }
  });

  it("the response body never contains the configured token or secret", async () => {
    getAccessGateEnvMock.mockReturnValue({
      mode: "enabled",
      accessToken: FAKE_TOKEN,
      sessionSecret: FAKE_SECRET,
    });

    const response = await callLogin(JSON.stringify({ token: FAKE_TOKEN }));
    const text = await response.clone().text();
    expect(text).not.toContain(FAKE_TOKEN);
    expect(text).not.toContain(FAKE_SECRET);
  });
});
