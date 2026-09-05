/**
 * Phase 4E-R3-A — `POST /api/findings/{findingId}/regressions`.
 *
 * The untrusted boundary for starting a regression (P4-AC-06), mirroring the
 * exact protections `app/api/chaos/runs/[runId]/execute-c03/route.ts` uses:
 * path-shape validation, targeted cross-origin rejection, the existing
 * access-gate session check (fail-closed when misconfigured), and a typed
 * service result mapped to a safe response.
 *
 * ADAPTER ONLY. Every decision that matters — eligibility, converging a
 * previous conclusive verdict, rebuilding the original scenario, revalidating
 * its source, rejecting a reused historical order, the safety-gated chaos
 * run, execution, invariant evaluation and the Finding lifecycle — belongs to
 * `lib/regression/service.ts`. This file contains no payment logic, no money
 * logic, no database access and no chaos knowledge whatsoever
 * (docs/ARCHITECTURE.md Section 36: route handlers delegate to domain
 * services).
 *
 * THE CALLER CHOOSES ALMOST NOTHING. The only inputs are a Finding id in the
 * path and an optional `freshOrderId` selecting an EXISTING internal order
 * for the two provider-dependent scenarios. There is no way to supply a
 * scenario, a mechanism, a fault type, an invariant, a diagnosis, a result,
 * or any URL/host/endpoint — the scenario and its relevant invariant set are
 * re-derived server-side from persisted evidence every time.
 *
 * Runs in the Node.js runtime for the same reason every other session-using
 * route does (`lib/access/session.ts` uses `node:crypto`).
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  ACCESS_SESSION_COOKIE_NAME,
  verifySessionToken,
} from "@/lib/access/session";
import { getAccessGateEnv } from "@/lib/config/access-env";
import { startRegression } from "@/lib/regression/service";
import { logEvent } from "@/lib/security/logger";

export const runtime = "nodejs";

const SAFE_ERROR_BODY = {
  error: "Regression request could not be processed.",
} as const;
const SAFE_UNAUTHORIZED_BODY = { error: "Unauthorized." } as const;
const SAFE_MISCONFIGURED_BODY = {
  error: "Access gate is misconfigured.",
} as const;
const SAFE_MALFORMED_ID_BODY = { error: "Malformed finding id." } as const;
const SAFE_MALFORMED_BODY = { error: "Malformed request body." } as const;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The complete accepted key set. Anything else is a rejected request. */
const ALLOWED_KEYS = ["freshOrderId"] as const;

/** Same targeted cross-origin rejection as every other protected route. */
function isKnownCrossOriginRequest(request: NextRequest): boolean {
  const secFetchSite = request.headers.get("sec-fetch-site");
  if (secFetchSite === "cross-site") return true;
  const origin = request.headers.get("origin");
  return origin !== null && origin !== request.nextUrl.origin;
}

type ParsedBody = { readonly freshOrderId?: string };

/**
 * Exact-key allowlist, matching `app/api/chaos/runs/route.ts`'s
 * `hasExactKeys` discipline: an unknown key is a rejected request rather than
 * a silently ignored one, so a caller can never smuggle a scenario, an
 * invariant, or a target through an unvalidated field.
 */
function parseBody(body: unknown): ParsedBody | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return null;
  }
  const raw = body as Record<string, unknown>;
  const keys = Object.keys(raw);
  if (!keys.every((key) => (ALLOWED_KEYS as readonly string[]).includes(key))) {
    return null;
  }
  if (keys.length === 0) return {};
  const freshOrderId = raw.freshOrderId;
  if (typeof freshOrderId !== "string" || !UUID_PATTERN.test(freshOrderId)) {
    return null;
  }
  return { freshOrderId };
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ findingId: string }> },
): Promise<NextResponse> {
  const { findingId } = await context.params;

  if (!UUID_PATTERN.test(findingId)) {
    return NextResponse.json(SAFE_MALFORMED_ID_BODY, { status: 400 });
  }

  if (isKnownCrossOriginRequest(request)) {
    logEvent("regression_start_request", { outcome: "REJECTED_CROSS_ORIGIN" });
    return NextResponse.json(SAFE_UNAUTHORIZED_BODY, { status: 403 });
  }

  let env;
  try {
    env = getAccessGateEnv();
  } catch {
    // Fail closed, exactly as the chaos execution routes do.
    logEvent("regression_start_request", { outcome: "REJECTED_MISCONFIGURED" });
    return NextResponse.json(SAFE_MISCONFIGURED_BODY, { status: 503 });
  }

  if (env.mode === "enabled") {
    const cookie = request.cookies.get(ACCESS_SESSION_COOKIE_NAME)?.value;
    if (
      cookie === undefined ||
      !verifySessionToken(env.sessionSecret as string, cookie)
    ) {
      logEvent("regression_start_request", {
        outcome: "REJECTED_UNAUTHORIZED",
      });
      return NextResponse.json(SAFE_UNAUTHORIZED_BODY, { status: 401 });
    }
  }

  // An absent body is a valid "no fresh order" request; malformed JSON is not.
  let body: unknown = {};
  const rawText = await request.text().catch(() => null);
  if (rawText === null) {
    return NextResponse.json(SAFE_MALFORMED_BODY, { status: 400 });
  }
  if (rawText.trim().length > 0) {
    try {
      body = JSON.parse(rawText);
    } catch {
      return NextResponse.json(SAFE_MALFORMED_BODY, { status: 400 });
    }
  }

  const parsed = parseBody(body);
  if (parsed === null) {
    logEvent("regression_start_request", { outcome: "REJECTED_MALFORMED" });
    return NextResponse.json(SAFE_MALFORMED_BODY, { status: 400 });
  }

  try {
    const result = await startRegression({
      findingId,
      ...(parsed.freshOrderId !== undefined
        ? { freshOrderId: parsed.freshOrderId }
        : {}),
    });

    if (result.kind === "NOT_STARTED") {
      // A deterministic domain refusal, not a server fault: the Finding is
      // ineligible, a fresh order is required or reused, a source is stale, or
      // a previous verdict could not converge.
      logEvent("regression_start_request", {
        outcome: "NOT_STARTED",
        reason: result.reason,
      });
      return NextResponse.json(
        {
          kind: result.kind,
          findingId: result.findingId,
          reason: result.reason,
          ineligibility: result.ineligibility,
        },
        { status: 409 },
      );
    }

    if (result.kind === "AWAITING_EXTERNAL_PREREQUISITE") {
      // NOT a refusal and NOT an error. A genuine Razorpay Test Mode action
      // has to happen before this scenario can be re-tested, and nothing was
      // created — no chaos run, no regression run, no evaluation.
      //
      // 200, deliberately: the request was valid and the server did exactly
      // what it should. A 409 would tell the operator something went wrong,
      // when the honest message is "make the payment, then start it again".
      logEvent("regression_start_request", {
        outcome: "AWAITING_EXTERNAL_PREREQUISITE",
        reason: result.reason,
        continuation: result.continuation,
        scenario_id: result.scenarioId,
      });
      return NextResponse.json(
        {
          kind: result.kind,
          findingId: result.findingId,
          scenarioId: result.scenarioId,
          reason: result.reason,
          continuation: result.continuation,
        },
        { status: 200 },
      );
    }

    if (result.kind === "ORPHAN_START") {
      // A concurrent start won the active-regression race. The safety-gated
      // run it created is preserved as audit evidence, never executed.
      logEvent("regression_start_request", {
        outcome: "ORPHAN_START",
        finding_id: result.findingId,
        chaos_run_id: result.chaosRunId,
      });
      return NextResponse.json(
        {
          kind: result.kind,
          findingId: result.findingId,
          chaosRunId: result.chaosRunId,
          scenarioId: result.scenarioId,
          reason: result.reason,
        },
        { status: 409 },
      );
    }

    logEvent("regression_start_request", {
      outcome: result.kind,
      finding_id: result.attempt.findingId,
      regression_run_id: result.attempt.regressionRunId,
      chaos_run_id: result.attempt.chaosRunId,
      scenario_id: result.attempt.scenarioId,
    });
    return NextResponse.json(serializeOperation(result), { status: 200 });
  } catch {
    // Never surface the underlying error: a typed domain error and an
    // unexpected fault look identical from outside.
    logEvent("regression_start_request", { outcome: "FAILED" });
    return NextResponse.json(SAFE_ERROR_BODY, { status: 500 });
  }
}

/**
 * The safe projection of an in-flight or finished attempt.
 *
 * Exported so the advance route serializes identically. Only service-level
 * vocabulary and internal identifiers ever appear — never a database message,
 * detail, hint, stack, environment value, secret, raw payload or signature.
 */
export function serializeOperation(
  result: Extract<
    Awaited<ReturnType<typeof startRegression>>,
    { attempt: unknown }
  >,
): Record<string, unknown> {
  const base = {
    kind: result.kind,
    findingId: result.attempt.findingId,
    regressionRunId: result.attempt.regressionRunId,
    chaosRunId: result.attempt.chaosRunId,
    scenarioId: result.attempt.scenarioId,
  };

  if (result.kind === "COMPLETED") {
    return {
      ...base,
      regressionStatus: result.regressionStatus,
      findingAction: result.findingAction,
      decisionReason: result.decisionReason,
    };
  }
  if (result.kind === "AWAITING_EXTERNAL_ACTION") {
    return { ...base, continuation: result.continuation };
  }
  if (result.kind === "SUPERSEDED") {
    return {
      ...base,
      regressionStatus: result.regressionStatus,
      reason: result.reason,
    };
  }
  if (result.kind === "ERRORED") {
    return {
      ...base,
      reason: result.reason,
      failedPrecheckId: result.failedPrecheckId,
    };
  }
  // IN_PROGRESS — nothing further is known yet.
  return base;
}
