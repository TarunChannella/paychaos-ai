import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

vi.mock("server-only", () => ({}));

// --- mocked boundaries for the BEHAVIOURAL half of this file --------------
const createChaosRun = vi.fn();
vi.mock("@/lib/chaos/run-service", () => ({
  createChaosRun: (...a: unknown[]) => createChaosRun(...a),
}));

const revalidateEligibility = vi.fn();
vi.mock("@/lib/chaos/eligibility-service", () => ({
  revalidateEligibility: (...a: unknown[]) => revalidateEligibility(...a),
}));

// The access gate is left DISABLED, which is the documented trusted-local
// default. Its enabled/misconfigured paths are covered statically below.
vi.mock("@/lib/config/access-env", () => ({
  getAccessGateEnv: () => ({ mode: "disabled", sessionSecret: null }),
}));

vi.mock("@/lib/security/logger", () => ({ logEvent: () => {} }));

import { POST } from "@/app/api/chaos/runs/route";
import type { NextRequest } from "next/server";

/**
 * Phase 3H — static guard over the two NEW mutation routes.
 *
 * Three properties matter most and none is provable from behaviour alone:
 *
 *   1. Both routes enforce the operator access gate IN-ROUTE. `middleware.ts`
 *      matches only `/demo-merchant/:path*`, so an API route that trusted the
 *      middleware would be wide open.
 *   2. Neither route can accept an arbitrary target.
 *   3. The evaluate route COMPOSES the frozen services in the right order and
 *      reimplements no evaluator logic.
 *
 * Every assertion runs against COMMENT-STRIPPED source, so prose that names a
 * forbidden token cannot fail the guard, and a comment can never satisfy one.
 */

const repoRoot = path.resolve(import.meta.dirname, "../../../");

const CREATE_ROUTE = "app/api/chaos/runs/route.ts";
const EVALUATE_ROUTE = "app/api/chaos/runs/[runId]/evaluate/route.ts";

function stripComments(text: string): string {
  const withoutBlockComments = text.replace(/\/\*[\s\S]*?\*\//g, "");
  return withoutBlockComments
    .split("\n")
    .map((line) => {
      const idx = line.indexOf("//");
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join("\n");
}

const sources = [CREATE_ROUTE, EVALUATE_ROUTE].map((relative) => {
  const raw = fs.readFileSync(path.join(repoRoot, relative), "utf-8");
  return { relative, raw, functional: stripComments(raw) };
});

const createRoute = sources.find((s) => s.relative === CREATE_ROUTE)!;
const evaluateRoute = sources.find((s) => s.relative === EVALUATE_ROUTE)!;

describe("Phase 3H routes — static safety guard", () => {
  it("1: both route files exist and are non-empty", () => {
    expect(sources).toHaveLength(2);
    for (const source of sources) {
      expect(source.raw.length).toBeGreaterThan(0);
    }
  });

  it("2: the guard is comment-blind", () => {
    // The evaluate route legitimately names `fault_config` in prose while
    // explaining that it never touches one.
    expect(createRoute.raw).toContain("fault-config");
    expect(createRoute.functional).not.toContain("fault-config");
  });

  it("3: BOTH routes enforce the access gate in-route, not via middleware", () => {
    for (const { relative, functional } of sources) {
      expect(functional, relative).toContain("getAccessGateEnv");
      expect(functional, relative).toContain("ACCESS_SESSION_COOKIE_NAME");
      expect(functional, relative).toContain("verifySessionToken");
      // Fails closed on misconfiguration.
      expect(functional, relative).toMatch(/status:\s*503/);
      // Rejects an unauthenticated caller when the gate is enabled.
      expect(functional, relative).toMatch(/status:\s*401/);
      // Rejects a known cross-origin caller.
      expect(functional, relative).toMatch(/status:\s*403/);
    }
  });

  it("4: neither route contains any arbitrary-target surface", () => {
    for (const { relative, functional } of sources) {
      const lower = functional.toLowerCase();
      for (const forbidden of [
        "http://",
        "https://",
        '"url"',
        "targeturl",
        '"host"',
        "hostname",
        '"ip"',
        "endpoint",
        '"script"',
        "callbackurl",
        "webhookurl",
      ]) {
        expect(lower, `${relative} :: ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("5: the create route never accepts a caller-supplied fault or classification", () => {
    const lower = createRoute.functional.toLowerCase();
    for (const forbidden of [
      "fault_config",
      "faultconfig",
      "fault_state",
      "faultstate",
      "data_classification",
      "dataclassification",
      "requiredinvariant",
      "replaycount",
    ]) {
      expect(lower, forbidden).not.toContain(forbidden);
    }
    // No caller-supplied authorization flag. Matched as a FIELD read, so the
    // route's own `SAFE_UNAUTHORIZED_BODY` and `REJECTED_UNAUTHORIZED` log
    // outcome — which are correct auth code — do not trip it.
    expect(createRoute.functional).not.toMatch(
      /raw\.(authorized|isAuthorized)/,
    );
    expect(createRoute.functional).not.toMatch(
      /body\.(authorized|isAuthorized)/,
    );
  });

  it("6: the create route derives the fault type and mechanism on the SERVER", () => {
    // Both appear as literals the route chooses from the scenario — never
    // read off the request body.
    expect(createRoute.functional).toContain('faultType: "REPLAY_EVENT"');
    expect(createRoute.functional).toContain(
      'faultType: "INVALID_SIGNATURE_TEST"',
    );
    expect(createRoute.functional).toContain(
      'faultType: "DROP_CLIENT_CONFIRMATION"',
    );
    expect(createRoute.functional).not.toMatch(/raw\.faultType/);
    expect(createRoute.functional).not.toMatch(/body\.faultType/);
  });

  it("7: the create route invokes the FROZEN createChaosRun", () => {
    expect(createRoute.functional).toContain('from "@/lib/chaos/run-service"');
    expect(createRoute.functional).toMatch(/await createChaosRun\(/);
  });

  it("8: the create route rejects unknown and P1 scenario IDs via the frozen guard", () => {
    expect(createRoute.functional).toContain("isRegisteredScenarioId");
    for (const p1 of ["C02", "C04", "C05", "C08", "C12"]) {
      expect(createRoute.functional, p1).not.toContain(`"${p1}"`);
    }
  });

  it("9: the create route re-validates eligibility before creating a run", () => {
    expect(createRoute.functional).toContain("revalidateEligibility");
    // The revalidation happens before the frozen creation call.
    const revalidateAt = createRoute.functional.indexOf(
      "await revalidateEligibility",
    );
    const createAt = createRoute.functional.indexOf("await createChaosRun");
    expect(revalidateAt).toBeGreaterThan(-1);
    expect(createAt).toBeGreaterThan(-1);
    expect(revalidateAt).toBeLessThan(createAt);
  });

  it("10: the evaluate route composes the two frozen services IN ORDER", () => {
    expect(evaluateRoute.functional).toContain(
      'from "@/lib/invariants/service"',
    );
    expect(evaluateRoute.functional).toContain('from "@/lib/findings/service"');

    const evaluateAt = evaluateRoute.functional.indexOf(
      "await evaluateChaosRun(",
    );
    const findingsAt = evaluateRoute.functional.indexOf(
      "await generateFindingsForChaosRun(",
    );
    expect(evaluateAt).toBeGreaterThan(-1);
    expect(findingsAt).toBeGreaterThan(-1);
    // Findings are generated only AFTER evaluation succeeds.
    expect(evaluateAt).toBeLessThan(findingsAt);
  });

  it("11: the evaluate route reimplements NO evaluator or Finding logic", () => {
    const lower = evaluateRoute.functional.toLowerCase();
    for (const forbidden of [
      "invariant_evaluators",
      "evaluateinvariant(",
      "persistinvariantresult",
      "finalizechaosrunoutcome",
      "insertopenfinding",
      "createfindingfrominvariantresult",
      "deterministicfindingtitle",
      "assemblechaosrunevidence",
    ]) {
      expect(lower, forbidden).not.toContain(forbidden);
    }
  });

  it("12: the evaluate route accepts NOTHING but the run id from the path", () => {
    // It never parses a request body at all, so a browser cannot smuggle a
    // verdict, a severity or an outcome into it. This is the property that
    // matters — the route DOES echo the frozen evaluator's own `disposition`
    // back in its response, which is reporting a decision, not accepting one.
    expect(evaluateRoute.functional).not.toMatch(/request\.json\(\)/);
    expect(evaluateRoute.functional).not.toMatch(
      /await\s+request\.(text|formData)\(/,
    );

    // Nothing is read off a request body anywhere.
    expect(evaluateRoute.functional).not.toMatch(/\bbody\b/);

    // And it never assigns a verdict of its own.
    expect(evaluateRoute.functional).not.toMatch(
      /(result|disposition|outcome)\s*=\s*["'`](PASS|FAIL|UNKNOWN)["'`]/,
    );
  });

  it("13: the evaluate route does not weaken the frozen lifecycle rule", () => {
    // A non-COMPLETED run must surface the frozen refusal, not bypass it.
    expect(evaluateRoute.functional).toContain("CHAOS_RUN_NOT_EVALUABLE");
    expect(evaluateRoute.functional).toMatch(/status:\s*409/);
  });

  it("14: neither route mutates a table directly", () => {
    for (const { relative, functional } of sources) {
      expect(functional, relative).not.toMatch(/\.from\(/);
      expect(functional, relative).not.toMatch(/\.insert\(/);
      expect(functional, relative).not.toMatch(/\.update\(/);
      expect(functional, relative).not.toMatch(/\.delete\(/);
      expect(functional, relative).not.toContain("getSupabaseServerClient");
    }
  });

  it("15: no secret, credential or raw evidence appears in either route", () => {
    for (const { relative, raw, functional } of sources) {
      for (const forbidden of [
        "SUPABASE_SERVICE_ROLE_KEY",
        "RAZORPAY_KEY_SECRET",
        "RAZORPAY_WEBHOOK_SECRET",
        "PAYCHAOS_ACCESS_TOKEN",
        "PAYCHAOS_SESSION_SECRET",
      ]) {
        expect(raw, `${relative} :: ${forbidden}`).not.toContain(forbidden);
      }
      for (const forbidden of [
        "raw_payload",
        "normalized_event",
        "raw_body_sha256",
        "x-razorpay-signature",
      ]) {
        expect(functional, `${relative} :: ${forbidden}`).not.toContain(
          forbidden,
        );
      }
    }
  });

  it("16: neither route touches Razorpay or the network", () => {
    for (const { relative, functional } of sources) {
      const lower = functional.toLowerCase();
      expect(lower, relative).not.toContain("razorpay");
      expect(functional, relative).not.toMatch(/\bfetch\s*\(/);
      expect(functional, relative).not.toMatch(/axios/);
      expect(functional, relative).not.toMatch(/node:https?/);
    }
  });

  it("17: no AI/LLM surface and no Phase 4 code", () => {
    for (const { relative, functional } of sources) {
      const lower = functional.toLowerCase();
      for (const forbidden of [
        "openai",
        "anthropic",
        "ollama",
        "diagnosis",
        "recommendation",
        "regression_run",
        "reliability_score",
      ]) {
        expect(lower, `${relative} :: ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("18: no route logs a raw DTO, evidence bundle or error object", () => {
    for (const { relative, functional } of sources) {
      expect(functional, relative).not.toMatch(
        /console\.(log|info|warn|error|debug)\(/,
      );
      // Structured logging only, and never the caught error itself.
      expect(functional, relative).not.toMatch(/logEvent\([^)]*,\s*error\s*\)/);
    }
  });

  it("19: every browser-facing error body is a fixed safe constant", () => {
    for (const { relative, functional } of sources) {
      const responses = [
        ...functional.matchAll(/NextResponse\.json\(\s*([A-Za-z_][\w.]*)/g),
      ].map((m) => m[1]!);
      for (const identifier of responses) {
        // Either a SAFE_* constant or an inline object literal built from
        // already-safe service output — never a raw error variable.
        expect(
          identifier.startsWith("SAFE_"),
          `${relative} returns non-SAFE identifier ${identifier}`,
        ).toBe(true);
      }
    }
  });

  it("20: both routes pin the Node.js runtime, like every other chaos route", () => {
    for (const { relative, functional } of sources) {
      expect(functional, relative).toMatch(/export const runtime = "nodejs"/);
    }
  });
});

// ==========================================================================
// BEHAVIOURAL PROOF — the create route's EXACT-KEY request validation.
//
// A static guard can show that no arbitrary-target FIELD is read. It cannot
// show that an UNEXPECTED field is REJECTED rather than ignored, and on an
// endpoint that starts a chaos run an ignored field is a field somebody
// believes is doing something. These tests drive the real POST handler.
//
// No network, no Supabase, no chaos execution: `createChaosRun` and
// `revalidateEligibility` are the mocked boundaries.
// ==========================================================================

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";

function request(body: unknown): NextRequest {
  return new Request("http://localhost/api/chaos/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  revalidateEligibility.mockResolvedValue(true);
  createChaosRun.mockResolvedValue({
    kind: "PERSISTED_PENDING",
    chaosRunId: "99999999-9999-4999-8999-999999999999",
    scenarioId: "C03",
  });
});

describe("Phase 3H create route — exact-key request validation", () => {
  it("21: an exact C03 body is accepted and reaches createChaosRun", async () => {
    const response = await POST(request({ scenarioId: "C03" }));

    expect(response.status).toBe(201);
    expect(createChaosRun).toHaveBeenCalledTimes(1);
    // C03 takes no subject, so eligibility revalidation does not apply.
    expect(revalidateEligibility).not.toHaveBeenCalled();
  });

  it("22: every other exact body is accepted too", async () => {
    for (const body of [
      { scenarioId: "C01", sourceWebhookEventId: UUID_A },
      { scenarioId: "C07", freshOrderId: UUID_A },
      { scenarioId: "C11", mechanism: "A", freshOrderId: UUID_A },
      { scenarioId: "C11", mechanism: "B", sourceWebhookEventId: UUID_A },
    ]) {
      createChaosRun.mockClear();
      const response = await POST(request(body));
      expect(response.status, JSON.stringify(body)).toBe(201);
      expect(createChaosRun).toHaveBeenCalledTimes(1);
    }
  });

  it("23: C03 + an extra url is 400 and NEVER creates a run", async () => {
    const response = await POST(
      request({ scenarioId: "C03", url: "https://anything.example" }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Malformed request.",
    });
    expect(createChaosRun).not.toHaveBeenCalled();
  });

  it("24: C03 + an extra faultType is 400 — the fault is server-derived", async () => {
    const response = await POST(
      request({ scenarioId: "C03", faultType: "INVALID_SIGNATURE_TEST" }),
    );
    expect(response.status).toBe(400);
    expect(createChaosRun).not.toHaveBeenCalled();
  });

  it("25: C01 + an extra replayCount is 400", async () => {
    const response = await POST(
      request({
        scenarioId: "C01",
        sourceWebhookEventId: UUID_A,
        replayCount: 999,
      }),
    );
    expect(response.status).toBe(400);
    expect(createChaosRun).not.toHaveBeenCalled();
  });

  it("26: C07 + an extra host is 400", async () => {
    const response = await POST(
      request({ scenarioId: "C07", freshOrderId: UUID_A, host: "example.com" }),
    );
    expect(response.status).toBe(400);
    expect(createChaosRun).not.toHaveBeenCalled();
  });

  it("27: C11-B + an extra dataClassification is 400", async () => {
    const response = await POST(
      request({
        scenarioId: "C11",
        mechanism: "B",
        sourceWebhookEventId: UUID_A,
        dataClassification: "RECORDED_TEST_EVIDENCE",
      }),
    );
    expect(response.status).toBe(400);
    expect(createChaosRun).not.toHaveBeenCalled();
  });

  it("28: an unknown or P1 scenario is 400", async () => {
    for (const scenarioId of ["C02", "C04", "C99", "c03", "", "C0"]) {
      createChaosRun.mockClear();
      const response = await POST(request({ scenarioId }));
      expect(response.status, scenarioId).toBe(400);
      expect(createChaosRun).not.toHaveBeenCalled();
    }
  });

  it("29: a MISSING required field is 400 — exactness runs both ways", async () => {
    for (const body of [
      { scenarioId: "C01" },
      { scenarioId: "C07" },
      { scenarioId: "C11", mechanism: "A" },
      { scenarioId: "C11", mechanism: "B" },
      { scenarioId: "C11", freshOrderId: UUID_A },
    ]) {
      createChaosRun.mockClear();
      const response = await POST(request(body));
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(createChaosRun).not.toHaveBeenCalled();
    }
  });

  it("30: a non-UUID subject is 400, never passed through", async () => {
    for (const body of [
      { scenarioId: "C01", sourceWebhookEventId: "not-a-uuid" },
      { scenarioId: "C07", freshOrderId: "https://example.com" },
      { scenarioId: "C11", mechanism: "B", sourceWebhookEventId: "" },
    ]) {
      createChaosRun.mockClear();
      const response = await POST(request(body));
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(createChaosRun).not.toHaveBeenCalled();
    }
  });

  it("31: a non-object body is 400", async () => {
    for (const body of [null, 42, "C03", ["C03"], true]) {
      createChaosRun.mockClear();
      const response = await POST(request(body));
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(createChaosRun).not.toHaveBeenCalled();
    }
  });

  it("32: an unparseable body is 400, not a crash", async () => {
    const bad = new Request("http://localhost/api/chaos/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{ not json",
    }) as unknown as NextRequest;

    const response = await POST(bad);
    expect(response.status).toBe(400);
    expect(createChaosRun).not.toHaveBeenCalled();
  });

  it("33: the fault type and mechanism handed to createChaosRun are SERVER-chosen", async () => {
    await POST(request({ scenarioId: "C03" }));
    expect(createChaosRun).toHaveBeenCalledWith({
      scenarioId: "C03",
      mechanism: "C",
      faultType: "INVALID_SIGNATURE_TEST",
    });

    createChaosRun.mockClear();
    await POST(request({ scenarioId: "C07", freshOrderId: UUID_B }));
    expect(createChaosRun).toHaveBeenCalledWith({
      scenarioId: "C07",
      mechanism: ["A", "C"],
      faultType: "DROP_CLIENT_CONFIRMATION",
      freshOrderId: UUID_B,
    });
  });

  it("34: an ineligible subject is 409 and never creates a run", async () => {
    revalidateEligibility.mockResolvedValue(false);

    const response = await POST(
      request({ scenarioId: "C01", sourceWebhookEventId: UUID_A }),
    );

    expect(response.status).toBe(409);
    expect(createChaosRun).not.toHaveBeenCalled();
  });

  it("35: eligibility is revalidated BEFORE the run is created", async () => {
    const order: string[] = [];
    revalidateEligibility.mockImplementation(async () => {
      order.push("revalidate");
      return true;
    });
    createChaosRun.mockImplementation(async () => {
      order.push("create");
      return {
        kind: "PERSISTED_PENDING",
        chaosRunId: UUID_B,
        scenarioId: "C01",
      };
    });

    await POST(request({ scenarioId: "C01", sourceWebhookEventId: UUID_A }));
    expect(order).toEqual(["revalidate", "create"]);
  });

  it("36: no response body ever echoes an unexpected caller field", async () => {
    const response = await POST(
      request({ scenarioId: "C03", url: "https://leak.example" }),
    );
    const serialized = JSON.stringify(await response.json());
    expect(serialized).not.toContain("leak.example");
    expect(serialized).not.toContain("url");
  });
});
