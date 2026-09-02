/**
 * Phase 4H-0 — `POST /api/findings/[findingId]/diagnose`.
 *
 * THE MISSING TRIGGER, NOT A NEW ENGINE. Phases 4C and 4D built deterministic
 * diagnosis and recommendation and proved them against real Supabase, but
 * nothing in the running product ever invoked them: every Finding sat
 * permanently at "Not yet diagnosed", and the mandated demo story
 * Finding → Diagnosis → Recommended Fix could not be shown at all. This route
 * closes exactly that gap and adds nothing else.
 *
 * ONE CALL. `recommendFinding()` already invokes `diagnoseFinding()`
 * internally as its first step, so calling both here would run the diagnosis
 * twice. The adapter makes the single call the frozen service intends.
 *
 * IT DECIDES NOTHING. No classification rule, no recommendation mapping, no
 * evidence assembly, no invariant evaluation, no scoring. Every decision stays
 * in the frozen Phase 4A/4C/4D services.
 *
 * IDEMPOTENT BY CONSTRUCTION. Both services are guarded writes: a repeated
 * call performs no second write and returns the ORIGINAL `diagnosedAt`. The
 * route therefore needs no lock, no upsert and no "already diagnosed" branch.
 *
 * IT MUTATES NOTHING ELSE. Diagnosis and recommendation are advisory columns
 * on `findings`. This route never touches finding STATUS, never resolves or
 * reopens a finding, never creates a regression, never evaluates an invariant,
 * never executes chaos, and never alters payment, order, webhook or fulfilment
 * state.
 *
 * THE CALLER CHOOSES NOTHING beyond which Finding to diagnose. No body, no
 * query string is read — so no request can influence the classification.
 *
 * SAFE ERRORS. Upstream domain errors carry stable codes; none of their raw
 * text, and no PostgREST message, detail or hint, ever leaves this module.
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  ACCESS_SESSION_COOKIE_NAME,
  verifySessionToken,
} from "@/lib/access/session";
import { getAccessGateEnv } from "@/lib/config/access-env";
import { recommendFinding } from "@/lib/diagnosis/recommendation-service";
import { logEvent } from "@/lib/security/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SAFE_ERROR_BODY = {
  error: "The finding could not be diagnosed.",
} as const;
const SAFE_UNAUTHORIZED_BODY = { error: "Unauthorized." } as const;
const SAFE_MISCONFIGURED_BODY = {
  error: "Access gate is misconfigured.",
} as const;
const SAFE_MALFORMED_ID_BODY = { error: "Malformed finding id." } as const;

/** Same targeted cross-origin rejection as every other protected route. */
function isKnownCrossOriginRequest(request: NextRequest): boolean {
  const secFetchSite = request.headers.get("sec-fetch-site");
  if (secFetchSite === "cross-site") return true;
  const origin = request.headers.get("origin");
  return origin !== null && origin !== request.nextUrl.origin;
}

/** A stable domain code, or null for anything unrecognised. */
function safeCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
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
    logEvent("finding_diagnose_request", { outcome: "REJECTED_CROSS_ORIGIN" });
    return NextResponse.json(SAFE_UNAUTHORIZED_BODY, { status: 403 });
  }

  let env;
  try {
    env = getAccessGateEnv();
  } catch {
    // Fail closed. The reason is never echoed: it describes the deployment.
    logEvent("finding_diagnose_request", { outcome: "REJECTED_MISCONFIGURED" });
    return NextResponse.json(SAFE_MISCONFIGURED_BODY, { status: 503 });
  }

  if (env.mode === "enabled") {
    const cookie = request.cookies.get(ACCESS_SESSION_COOKIE_NAME)?.value;
    if (
      cookie === undefined ||
      !verifySessionToken(env.sessionSecret as string, cookie)
    ) {
      logEvent("finding_diagnose_request", {
        outcome: "REJECTED_UNAUTHORIZED",
      });
      return NextResponse.json(SAFE_UNAUTHORIZED_BODY, { status: 401 });
    }
  }

  try {
    // The single frozen entry point. It diagnoses, then recommends.
    const result = await recommendFinding(findingId);

    logEvent("finding_diagnose_request", {
      outcome: "COMPLETED",
      finding_id: findingId,
      diagnosis_code: result.diagnosis.persistence.diagnosisCode,
      recommendation_code: result.persistence.recommendationCode,
    });

    // Only service-level vocabulary is returned — never a raw row, an
    // evidence payload, a signature or a customer identifier.
    return NextResponse.json(
      {
        findingId,
        diagnosisCode: result.diagnosis.persistence.diagnosisCode,
        diagnosisStrength: result.diagnosis.persistence.diagnosisStrength,
        recommendationCode: result.persistence.recommendationCode,
      },
      { status: 200 },
    );
  } catch (error) {
    // A deterministic domain refusal (missing finding, non-FAIL invariant,
    // evidence gap) is reported with its stable code so the operator learns
    // WHY. Anything else is a generic failure.
    const code = safeCode(error);
    logEvent("finding_diagnose_request", {
      outcome: "FAILED",
      reason: code ?? "UNEXPECTED",
    });

    return NextResponse.json(
      code === null ? SAFE_ERROR_BODY : { ...SAFE_ERROR_BODY, code },
      { status: code === null ? 500 : 409 },
    );
  }
}
