import { beforeEach, describe, expect, it, vi } from "vitest";

// Phase 3C: `app/api/chaos/runs/[runId]/replay/route.ts` exercised against
// mocked `lib/config/access-env.ts`, `lib/access/session.ts`, and
// `lib/chaos/replay-service.ts` — no real cookies-from-a-browser, no real
// Supabase. Proves only the route's own job: validate the runId shape,
// reject a known cross-origin request, enforce the access gate, delegate to
// the trusted service, and map its typed result to a safe response.

const getAccessGateEnvMock = vi.fn();
vi.mock("@/lib/config/access-env", () => ({
  getAccessGateEnv: getAccessGateEnvMock,
}));

const verifySessionTokenMock = vi.fn();
vi.mock("@/lib/access/session", () => ({
  ACCESS_SESSION_COOKIE_NAME: "paychaos_session",
  verifySessionToken: verifySessionTokenMock,
}));

const executeC01ReplayMock = vi.fn();
vi.mock("@/lib/chaos/replay-service", () => ({
  executeC01Replay: (...args: unknown[]) => executeC01ReplayMock(...args),
}));

const logEventMock = vi.fn();
vi.mock("@/lib/security/logger", () => ({ logEvent: logEventMock }));

const VALID_RUN_ID = "55555555-5555-5555-5555-555555555555";
const FAKE_SECRET = "fake-session-secret-not-real-" + "x".repeat(10);

async function callReplay(
  runId: string,
  options: { cookie?: string; origin?: string; secFetchSite?: string } = {},
) {
  const { POST } = await import("@/app/api/chaos/runs/[runId]/replay/route");
  const { NextRequest } = await import("next/server");
  const headers: Record<string, string> = {};
  if (options.cookie !== undefined) headers.cookie = options.cookie;
  if (options.origin !== undefined) headers.origin = options.origin;
  if (options.secFetchSite !== undefined)
    headers["sec-fetch-site"] = options.secFetchSite;

  const request = new NextRequest(
    `http://localhost/api/chaos/runs/${runId}/replay`,
    { method: "POST", headers },
  );
  return POST(request, { params: Promise.resolve({ runId }) });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/chaos/runs/[runId]/replay — input shape", () => {
  it("returns 400 for a malformed runId and never calls the service", async () => {
    getAccessGateEnvMock.mockReturnValue({ mode: "disabled" });
    const response = await callReplay("not-a-uuid");
    expect(response.status).toBe(400);
    expect(executeC01ReplayMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/chaos/runs/[runId]/replay — cross-origin rejection", () => {
  it("returns 403 when Sec-Fetch-Site is cross-site", async () => {
    getAccessGateEnvMock.mockReturnValue({ mode: "disabled" });
    const response = await callReplay(VALID_RUN_ID, {
      secFetchSite: "cross-site",
      origin: "http://localhost",
    });
    expect(response.status).toBe(403);
    expect(executeC01ReplayMock).not.toHaveBeenCalled();
  });

  it("returns 403 when the Origin header does not match the request's own origin", async () => {
    getAccessGateEnvMock.mockReturnValue({ mode: "disabled" });
    const response = await callReplay(VALID_RUN_ID, {
      origin: "https://evil.example.com",
    });
    expect(response.status).toBe(403);
    expect(executeC01ReplayMock).not.toHaveBeenCalled();
  });

  it("proceeds when Origin matches the request's own origin", async () => {
    getAccessGateEnvMock.mockReturnValue({ mode: "disabled" });
    executeC01ReplayMock.mockResolvedValue({
      kind: "COMPLETED",
      chaosRunId: VALID_RUN_ID,
      replayAttemptCount: 2,
    });
    const response = await callReplay(VALID_RUN_ID, {
      origin: "http://localhost",
    });
    expect(response.status).toBe(200);
  });

  it("proceeds when neither Origin nor Sec-Fetch-Site is present (same-origin server/test call)", async () => {
    getAccessGateEnvMock.mockReturnValue({ mode: "disabled" });
    executeC01ReplayMock.mockResolvedValue({
      kind: "COMPLETED",
      chaosRunId: VALID_RUN_ID,
      replayAttemptCount: 2,
    });
    const response = await callReplay(VALID_RUN_ID);
    expect(response.status).toBe(200);
  });
});

describe("POST /api/chaos/runs/[runId]/replay — access gate", () => {
  it("returns 503 when the gate is misconfigured, and never calls the service", async () => {
    getAccessGateEnvMock.mockImplementation(() => {
      throw new Error("misconfigured");
    });
    const response = await callReplay(VALID_RUN_ID);
    expect(response.status).toBe(503);
    expect(executeC01ReplayMock).not.toHaveBeenCalled();
  });

  it("returns 401 when the gate is enabled and no session cookie is present", async () => {
    getAccessGateEnvMock.mockReturnValue({
      mode: "enabled",
      sessionSecret: FAKE_SECRET,
    });
    const response = await callReplay(VALID_RUN_ID);
    expect(response.status).toBe(401);
    expect(executeC01ReplayMock).not.toHaveBeenCalled();
  });

  it("returns 401 when the gate is enabled and the session cookie is invalid", async () => {
    getAccessGateEnvMock.mockReturnValue({
      mode: "enabled",
      sessionSecret: FAKE_SECRET,
    });
    verifySessionTokenMock.mockReturnValue(false);
    const response = await callReplay(VALID_RUN_ID, {
      cookie: "paychaos_session=forged.value",
    });
    expect(response.status).toBe(401);
    expect(executeC01ReplayMock).not.toHaveBeenCalled();
  });

  it("never accepts a caller-supplied 'authorized' claim — only a verified session cookie", async () => {
    getAccessGateEnvMock.mockReturnValue({
      mode: "enabled",
      sessionSecret: FAKE_SECRET,
    });
    verifySessionTokenMock.mockReturnValue(false);
    const { POST } = await import("@/app/api/chaos/runs/[runId]/replay/route");
    const { NextRequest } = await import("next/server");
    const request = new NextRequest(
      `http://localhost/api/chaos/runs/${VALID_RUN_ID}/replay`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ authorized: true }),
      },
    );
    const response = await POST(request, {
      params: Promise.resolve({ runId: VALID_RUN_ID }),
    });
    expect(response.status).toBe(401);
    expect(executeC01ReplayMock).not.toHaveBeenCalled();
  });

  it("proceeds when the gate is enabled and the session cookie verifies", async () => {
    getAccessGateEnvMock.mockReturnValue({
      mode: "enabled",
      sessionSecret: FAKE_SECRET,
    });
    verifySessionTokenMock.mockReturnValue(true);
    executeC01ReplayMock.mockResolvedValue({
      kind: "COMPLETED",
      chaosRunId: VALID_RUN_ID,
      replayAttemptCount: 2,
    });
    const response = await callReplay(VALID_RUN_ID, {
      cookie: "paychaos_session=valid.token",
    });
    expect(response.status).toBe(200);
    expect(executeC01ReplayMock).toHaveBeenCalledWith(VALID_RUN_ID);
  });

  it("proceeds without any cookie when the gate is disabled (existing access-gate semantics)", async () => {
    getAccessGateEnvMock.mockReturnValue({ mode: "disabled" });
    executeC01ReplayMock.mockResolvedValue({
      kind: "COMPLETED",
      chaosRunId: VALID_RUN_ID,
      replayAttemptCount: 2,
    });
    const response = await callReplay(VALID_RUN_ID);
    expect(response.status).toBe(200);
  });
});

describe("POST /api/chaos/runs/[runId]/replay — service result mapping", () => {
  beforeEach(() => {
    getAccessGateEnvMock.mockReturnValue({ mode: "disabled" });
  });

  it("maps COMPLETED to 200 with safe metadata only", async () => {
    executeC01ReplayMock.mockResolvedValue({
      kind: "COMPLETED",
      chaosRunId: VALID_RUN_ID,
      replayAttemptCount: 2,
    });
    const response = await callReplay(VALID_RUN_ID);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      chaosRunId: VALID_RUN_ID,
      status: "COMPLETED",
      outcome: "UNKNOWN",
      replayAttemptCount: 2,
    });
  });

  it("maps NOT_STARTABLE to 409 without leaking the reason category in the body", async () => {
    executeC01ReplayMock.mockResolvedValue({
      kind: "NOT_STARTABLE",
      reasonCategory: "ALREADY_STARTED_OR_NOT_PENDING",
    });
    const response = await callReplay(VALID_RUN_ID);
    expect(response.status).toBe(409);
    const text = await response.clone().text();
    expect(text).not.toContain("ALREADY_STARTED_OR_NOT_PENDING");
  });

  it("maps FAILED to 500 without leaking the reason category, chaos run id internals, or any raw error", async () => {
    executeC01ReplayMock.mockResolvedValue({
      kind: "FAILED",
      chaosRunId: VALID_RUN_ID,
      reasonCategory: "EXECUTION_FAILED",
    });
    const response = await callReplay(VALID_RUN_ID);
    expect(response.status).toBe(500);
    const text = await response.clone().text();
    expect(text).not.toContain("EXECUTION_FAILED");
  });

  it("maps a thrown error to a safe 500, never exposing the error message", async () => {
    executeC01ReplayMock.mockRejectedValue(
      new Error("raw-postgres-detail-that-must-never-leak"),
    );
    const response = await callReplay(VALID_RUN_ID);
    expect(response.status).toBe(500);
    const text = await response.clone().text();
    expect(text).not.toContain("raw-postgres-detail-that-must-never-leak");
  });
});

describe("app/api/chaos/runs/[runId]/replay/route.ts — module surface", () => {
  it("never reads a request body (no request.json()/request.text() call anywhere)", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(
      path.resolve(
        import.meta.dirname,
        "../../../app/api/chaos/runs/[runId]/replay/route.ts",
      ),
      "utf-8",
    );
    expect(source).not.toMatch(/request\.json\(/);
    expect(source).not.toMatch(/request\.text\(/);
    expect(source).not.toMatch(/request\.arrayBuffer\(/);
  });

  it("has no arbitrary target/authorization field name in the FUNCTIONAL code (the module doc comment legitimately names these fields to document what the route refuses to accept, so only non-comment lines are checked here)", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(
      path.resolve(
        import.meta.dirname,
        "../../../app/api/chaos/runs/[runId]/replay/route.ts",
      ),
      "utf-8",
    );
    const functionalSource = source
      .split("\n")
      .filter((line) => {
        const trimmed = line.trim();
        return !trimmed.startsWith("*") && !trimmed.startsWith("//");
      })
      .join("\n");
    for (const forbidden of [
      "targetUrl",
      "targetHost",
      "endpoint",
      "faultString",
      "replayCount",
      "scenarioId",
      "authorized:",
    ]) {
      expect(functionalSource).not.toContain(forbidden);
    }
  });
});
