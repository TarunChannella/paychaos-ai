import { NextResponse, type NextRequest } from "next/server";

import {
  ACCESS_SESSION_COOKIE_NAME,
  verifySessionToken,
} from "@/lib/access/session";
import {
  revalidateEligibility,
  type EligibilityRequest,
} from "@/lib/chaos/eligibility-service";
import { isRegisteredScenarioId } from "@/lib/chaos/registry";
import { createChaosRun } from "@/lib/chaos/run-service";
import { getAccessGateEnv } from "@/lib/config/access-env";
import { logEvent } from "@/lib/security/logger";

export const runtime = "nodejs";

/**
 * Phase 3H — the missing chaos-run CREATION endpoint.
 *
 * Until now `createChaosRun` had no caller anywhere in the application: every
 * chaos route was `[runId]`-scoped and presupposed a run only an integration
 * test could create. This route closes that gap and nothing else — it does not
 * execute a fault, evaluate an invariant or create a Finding.
 *
 * NO ARBITRARY TARGET. The accepted body is a closed discriminated union of
 * four P0 scenarios. There is no URL, host, IP, endpoint, script, replay
 * count, fault-config or data-classification field, and none can be added
 * without also changing the frozen `ChaosPrecheckInput` union this route
 * translates into. A caller cannot supply a verdict, a classification, a
 * required-invariant list or an authorization flag.
 *
 * DEFENCE IN DEPTH ON ELIGIBILITY. Where a scenario needs a subject, this
 * route re-confirms it through `revalidateEligibility` BEFORE handing it to
 * `createChaosRun` — because a candidate listed a minute ago may have stopped
 * being fresh. `createChaosRun` then still runs the full frozen ten-check
 * precheck; this is an extra gate, never a replacement for one.
 *
 * ACCESS. Follows the established in-route gate pattern used by every other
 * chaos route, deliberately rather than relying on `middleware.ts`, whose
 * matcher does not cover `/api/chaos`.
 */

const SAFE_MALFORMED_BODY = { error: "Malformed request." } as const;
const SAFE_UNAUTHORIZED_BODY = { error: "Unauthorized." } as const;
const SAFE_MISCONFIGURED_BODY = {
  error: "Access gate is misconfigured.",
} as const;
const SAFE_INELIGIBLE_BODY = {
  error: "The selected source is not eligible for this scenario.",
} as const;
const SAFE_ERROR_BODY = { error: "Chaos run could not be created." } as const;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The ONLY accepted request shapes. Each maps 1:1 onto a variant of the frozen
 * `ChaosPrecheckInput` union; the fault type and mechanism are chosen HERE
 * from the scenario, never accepted from the caller.
 */
type CreateRunRequest =
  | { readonly scenarioId: "C01"; readonly sourceWebhookEventId: string }
  | { readonly scenarioId: "C03" }
  | { readonly scenarioId: "C07"; readonly freshOrderId: string }
  | {
      readonly scenarioId: "C11";
      readonly mechanism: "A";
      readonly freshOrderId: string;
    }
  | {
      readonly scenarioId: "C11";
      readonly mechanism: "B";
      readonly sourceWebhookEventId: string;
    };

/**
 * The EXACT key set each variant permits. Nothing else may appear.
 *
 * An allowlist of expected keys is not enough on its own: a body carrying an
 * unexpected `url`, `faultType`, `replayCount`, `host` or `dataClassification`
 * would silently pass while the route quietly ignored it. On an endpoint that
 * can start a chaos run, an ignored field is a field somebody believes is
 * doing something — so the shape must be exact in BOTH directions.
 */
const EXACT_KEYS = {
  C01: ["scenarioId", "sourceWebhookEventId"],
  C03: ["scenarioId"],
  C07: ["scenarioId", "freshOrderId"],
  "C11:A": ["scenarioId", "mechanism", "freshOrderId"],
  "C11:B": ["scenarioId", "mechanism", "sourceWebhookEventId"],
} as const;

/**
 * `true` only when `raw`'s own keys are EXACTLY `allowed` — no extra, none
 * missing. Order is irrelevant; membership is not.
 */
function hasExactKeys(
  raw: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  const actual = Object.keys(raw);
  if (actual.length !== allowed.length) return false;
  return actual.every((key) => allowed.includes(key));
}

/**
 * Strict parse. Anything unrecognised — an unknown scenario, a P1 identifier,
 * an extra field, a missing field, a non-UUID subject — is rejected rather
 * than coerced or ignored.
 */
function parseRequest(body: unknown): CreateRunRequest | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return null;
  }
  const raw = body as Record<string, unknown>;

  const scenarioId = raw.scenarioId;
  // P1 and unknown identifiers never reach the registry lookup as valid.
  if (!isRegisteredScenarioId(scenarioId)) return null;

  const uuid = (value: unknown): string | null =>
    typeof value === "string" && UUID_PATTERN.test(value) ? value : null;

  if (scenarioId === "C01") {
    if (!hasExactKeys(raw, EXACT_KEYS.C01)) return null;
    const id = uuid(raw.sourceWebhookEventId);
    return id === null ? null : { scenarioId: "C01", sourceWebhookEventId: id };
  }

  if (scenarioId === "C03") {
    // C03 verifies PayChaos's own internal path and takes no subject at all,
    // so `scenarioId` must be the ONLY key present.
    if (!hasExactKeys(raw, EXACT_KEYS.C03)) return null;
    return { scenarioId: "C03" };
  }

  if (scenarioId === "C07") {
    if (!hasExactKeys(raw, EXACT_KEYS.C07)) return null;
    const id = uuid(raw.freshOrderId);
    return id === null ? null : { scenarioId: "C07", freshOrderId: id };
  }

  // C11 — the mechanism decides which evidence applies. It is a mechanism,
  // never a scenario ID: the audit row still records scenario `C11`.
  if (raw.mechanism === "A") {
    if (!hasExactKeys(raw, EXACT_KEYS["C11:A"])) return null;
    const id = uuid(raw.freshOrderId);
    return id === null
      ? null
      : { scenarioId: "C11", mechanism: "A", freshOrderId: id };
  }
  if (raw.mechanism === "B") {
    if (!hasExactKeys(raw, EXACT_KEYS["C11:B"])) return null;
    const id = uuid(raw.sourceWebhookEventId);
    return id === null
      ? null
      : { scenarioId: "C11", mechanism: "B", sourceWebhookEventId: id };
  }
  return null;
}

/** The eligibility question this request implies. */
function eligibilityRequest(request: CreateRunRequest): EligibilityRequest {
  if (request.scenarioId === "C11") {
    return request.mechanism === "A"
      ? { scenarioId: "C11", mechanism: "A" }
      : { scenarioId: "C11", mechanism: "B" };
  }
  return { scenarioId: request.scenarioId };
}

/** The chosen subject, or `null` for C03 which has none. */
function subjectId(request: CreateRunRequest): string | null {
  switch (request.scenarioId) {
    case "C01":
      return request.sourceWebhookEventId;
    case "C03":
      return null;
    case "C07":
      return request.freshOrderId;
    default:
      return request.mechanism === "A"
        ? request.freshOrderId
        : request.sourceWebhookEventId;
  }
}

/**
 * Translates a validated request into the frozen precheck input.
 *
 * The mechanism and fault type are derived from the scenario here, on the
 * server. They are never read from the request body.
 */
function toPrecheckInput(request: CreateRunRequest): unknown {
  switch (request.scenarioId) {
    case "C01":
      return {
        scenarioId: "C01",
        mechanism: "B",
        faultType: "REPLAY_EVENT",
        sourceWebhookEventId: request.sourceWebhookEventId,
      };
    case "C03":
      return {
        scenarioId: "C03",
        mechanism: "C",
        faultType: "INVALID_SIGNATURE_TEST",
      };
    case "C07":
      return {
        // C07's frozen mechanism is the COMBINATION tuple ["A", "C"], not a
        // string — `ChaosMechanismCombination` in lib/chaos/types.ts.
        scenarioId: "C07",
        mechanism: ["A", "C"] as const,
        faultType: "DROP_CLIENT_CONFIRMATION",
        freshOrderId: request.freshOrderId,
      };
    default:
      return request.mechanism === "A"
        ? {
            scenarioId: "C11",
            mechanism: "A",
            freshOrderId: request.freshOrderId,
          }
        : {
            scenarioId: "C11",
            mechanism: "B",
            failureEvidence: {
              kind: "REAL_WEBHOOK_EVENT",
              webhookEventId: request.sourceWebhookEventId,
            },
          };
  }
}

function isKnownCrossOriginRequest(request: NextRequest): boolean {
  const secFetchSite = request.headers.get("sec-fetch-site");
  if (secFetchSite === "cross-site") return true;
  const origin = request.headers.get("origin");
  return origin !== null && origin !== request.nextUrl.origin;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (isKnownCrossOriginRequest(request)) {
    logEvent("chaos_run_create_request", { outcome: "REJECTED_CROSS_ORIGIN" });
    return NextResponse.json(SAFE_UNAUTHORIZED_BODY, { status: 403 });
  }

  let env;
  try {
    env = getAccessGateEnv();
  } catch {
    // Fail closed: an enabled-but-invalid gate must never fall open for a
    // route that can create a chaos run.
    logEvent("chaos_run_create_request", { outcome: "REJECTED_MISCONFIGURED" });
    return NextResponse.json(SAFE_MISCONFIGURED_BODY, { status: 503 });
  }

  if (env.mode === "enabled") {
    const cookie = request.cookies.get(ACCESS_SESSION_COOKIE_NAME)?.value;
    if (
      cookie === undefined ||
      !verifySessionToken(env.sessionSecret as string, cookie)
    ) {
      logEvent("chaos_run_create_request", {
        outcome: "REJECTED_UNAUTHORIZED",
      });
      return NextResponse.json(SAFE_UNAUTHORIZED_BODY, { status: 401 });
    }
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(SAFE_MALFORMED_BODY, { status: 400 });
  }

  const parsed = parseRequest(body);
  if (parsed === null) {
    logEvent("chaos_run_create_request", { outcome: "REJECTED_MALFORMED" });
    return NextResponse.json(SAFE_MALFORMED_BODY, { status: 400 });
  }

  try {
    // Listing is not authorization — re-confirm the subject at execution time.
    const subject = subjectId(parsed);
    if (subject !== null) {
      const stillEligible = await revalidateEligibility(
        eligibilityRequest(parsed),
        subject,
      );
      if (!stillEligible) {
        logEvent("chaos_run_create_request", {
          outcome: "REJECTED_INELIGIBLE",
          scenarioId: parsed.scenarioId,
        });
        return NextResponse.json(SAFE_INELIGIBLE_BODY, { status: 409 });
      }
    }

    const result = await createChaosRun(toPrecheckInput(parsed));

    if (result.kind === "PERSISTED_PENDING") {
      logEvent("chaos_run_create_request", {
        outcome: "PERSISTED_PENDING",
        scenarioId: result.scenarioId,
      });
      return NextResponse.json(
        {
          kind: "PERSISTED_PENDING",
          chaosRunId: result.chaosRunId,
          scenarioId: result.scenarioId,
        },
        { status: 201 },
      );
    }

    if (result.kind === "PERSISTED_BLOCKED") {
      // A blocked run is a real, inspectable audit record — not an error.
      logEvent("chaos_run_create_request", {
        outcome: "PERSISTED_BLOCKED",
        scenarioId: result.scenarioId,
        failedPrecheckId: result.failedPrecheckId,
      });
      return NextResponse.json(
        {
          kind: "PERSISTED_BLOCKED",
          chaosRunId: result.chaosRunId,
          scenarioId: result.scenarioId,
          failedPrecheckId: result.failedPrecheckId,
          reason: result.reason,
        },
        { status: 201 },
      );
    }

    logEvent("chaos_run_create_request", {
      outcome: "NOT_PERSISTED_BLOCKED",
      reasonCategory: result.reasonCategory,
    });
    return NextResponse.json(
      {
        kind: "NOT_PERSISTED_BLOCKED",
        reasonCategory: result.reasonCategory,
        reason: result.reason,
      },
      { status: 409 },
    );
  } catch {
    // Never surface a raw Supabase/Postgres error to a browser.
    logEvent("chaos_run_create_request", { outcome: "ERROR" });
    return NextResponse.json(SAFE_ERROR_BODY, { status: 500 });
  }
}
