import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Phase 5 — the READ-IS-PUBLIC, CHANGE-IS-NOT access boundary.
 *
 * WHY THIS FILE EXISTS. Page-level protection was removed so a Buildathon
 * reviewer can explore the product without a code. That is only safe because
 * authorization moved to the operations that change state — and the failure
 * mode of getting this wrong is silent: the app looks identical whether the
 * Server Actions are gated or wide open.
 *
 * The specific hazard: Next.js routes a Server Action POST through the PAGE's
 * own URL. Opening `/demo-merchant` to the public without gating its actions
 * would have published order creation, Razorpay order creation, Checkout
 * preparation and Checkout verification to anyone with the URL.
 */

const ROOT = process.cwd();

function code(path: string): string {
  return readFileSync(join(ROOT, path), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
}

const ACTIONS = code("app/demo-merchant/actions.ts");
const MIDDLEWARE = code("middleware.ts");
const GUARD = code("lib/access/guard.ts");
const DIALOG = code("components/access/demo-unlock-dialog.tsx");

describe("interactive gate — every mutating server action is authorized", () => {
  it("1: all four Demo Merchant actions call the guard", () => {
    // Each action mutates: an order, a Razorpay order, a Checkout preparation
    // and a Checkout verification. All four are state changes.
    const exported = [...ACTIONS.matchAll(/export async function (\w+)/g)].map(
      (m) => m[1],
    );
    expect(exported).toHaveLength(4);

    // One guard call per exported action, and the guard itself is defined.
    const guardCalls = [...ACTIONS.matchAll(/await denyIfLocked\(\)/g)];
    expect(guardCalls).toHaveLength(exported.length);
    expect(ACTIONS).toContain("checkInteractiveAccess");
  });

  it("2: the guard runs BEFORE any mutation in each action", () => {
    // A check that runs after the write is not a check. For each action, the
    // guard must appear before the first service call inside its body.
    const bodies = ACTIONS.split(/export async function /).slice(1);
    expect(bodies).toHaveLength(4);

    for (const body of bodies) {
      const guardAt = body.indexOf("denyIfLocked()");
      expect(guardAt, body.slice(0, 60)).toBeGreaterThan(-1);

      for (const mutator of [
        "createDemoMerchantOrder(",
        "createRazorpayOrderForMerchantOrder(",
        "prepareCheckoutForPaymentAttempt(",
        "verifyCheckoutAndPersistPayment(",
      ]) {
        const mutateAt = body.indexOf(mutator);
        if (mutateAt === -1) continue;
        expect(
          guardAt,
          `${mutator} must not run before the guard`,
        ).toBeLessThan(mutateAt);
      }
    }
  });

  it("3: the guard fails closed on misconfiguration", () => {
    // An enabled-but-broken gate must deny, never fall open.
    expect(GUARD).toContain('return "misconfigured"');
    expect(GUARD).toContain('if (cookie === undefined) return "denied"');
    expect(GUARD).toContain("verifySessionToken");
  });
});

describe("interactive gate — every mutating API route still self-gates", () => {
  it("4: no mutation route relies on middleware alone", () => {
    // Page protection is gone, so a route that trusted it would now be open.
    const routes: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(join(ROOT, dir), {
        withFileTypes: true,
      })) {
        const next = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(next);
        else if (entry.name === "route.ts") routes.push(next);
      }
    };
    walk("app/api");

    // The only routes that legitimately have no operator session check.
    const PUBLIC_BY_DESIGN = [
      // Razorpay itself must reach this with no login; its trust boundary is
      // the webhook HMAC signature.
      "app/api/webhooks/razorpay/route.ts",
      // These ARE how a session is created and destroyed.
      "app/api/access/login/route.ts",
      "app/api/access/logout/route.ts",
    ];

    for (const route of routes) {
      if (PUBLIC_BY_DESIGN.includes(route)) continue;
      expect(code(route), `${route} must verify the session itself`).toContain(
        "verifySessionToken",
      );
    }

    // The parser found something, so the loop above was not vacuous.
    expect(routes.length).toBeGreaterThan(10);
  });
});

describe("interactive gate — middleware reads public, writes gated", () => {
  it("5: middleware NEVER answers a page request itself", () => {
    // CORRECTED after a confirmed production defect. Middleware used to
    // challenge unsafe methods with a 401 JSON body, which broke every
    // Server Action: React's action client cannot parse a JSON 401 any more
    // than an HTML redirect, so the click threw and the error boundary
    // rendered. Any response constructed here re-creates that bug.
    expect(MIDDLEWARE).not.toContain("status: 401");
    expect(MIDDLEWARE).not.toContain("status: 503");
    expect(MIDDLEWARE).not.toContain("NextResponse.redirect");
    expect(MIDDLEWARE).not.toContain("NextResponse.json");
  });

  it("6: middleware holds no authorization logic to drift from the guards", () => {
    // With the challenge gone, a session check here would be dead code that
    // looks authoritative — the worst kind, because a later reader may wire
    // it back in and reintroduce the defect.
    expect(MIDDLEWARE).not.toContain("verifySessionToken");
    expect(MIDDLEWARE).not.toContain("getAccessGateEnv");
    expect(MIDDLEWARE).toContain("NextResponse.next()");
  });

  it("7: the matcher still covers the page paths", () => {
    // Narrowing the matcher would silently stop challenging Server Action
    // POSTs to those pages.
    for (const path of [
      "/demo-merchant/:path*",
      "/chaos/:path*",
      "/reliability/:path*",
      "/findings/:path*",
      "/settings/:path*",
    ]) {
      expect(MIDDLEWARE, path).toContain(path);
    }
  });

  it("8: the Razorpay webhook is still never behind operator auth", () => {
    expect(MIDDLEWARE).not.toContain("webhook");
    expect(MIDDLEWARE).not.toContain("/api/");
  });
});

describe("interactive gate — the access code never reaches the client", () => {
  it("9: the dialog holds no code and no configuration", () => {
    for (const forbidden of [
      "PAYCHAOS_ACCESS_TOKEN",
      "PAYCHAOS_SESSION_SECRET",
      "process.env",
      "localStorage",
      "sessionStorage",
      "document.cookie",
    ]) {
      expect(DIALOG, forbidden).not.toContain(forbidden);
    }
  });

  it("10: the code is POSTed in a body, never a URL", () => {
    expect(DIALOG).toContain('method: "POST"');
    // A code in a query string lands in history, logs and referrers.
    expect(DIALOG).not.toContain("searchParams");
    expect(DIALOG).not.toContain("?token=");
  });

  it("11: the dialog reveals nothing about why a code was rejected", () => {
    expect(DIALOG).toContain("Invalid Demo Access Code.");

    // Scanned against the strings a VISITOR can read, not the whole source:
    // `code.trim().length` is ordinary logic, and banning the word "length"
    // from the file would be matching implementation rather than copy.
    const literals = [...DIALOG.matchAll(/"([^"\n]{12,})"/g)]
      .map((m) => (m[1] ?? "").toLowerCase())
      // Class attributes are not prose.
      .filter((text) => !text.includes("rounded-") && !text.includes("flex"));

    expect(literals.length).toBeGreaterThan(0);
    for (const text of literals) {
      for (const leak of [
        "characters",
        "configured",
        "hash",
        "secret",
        "env",
        "expected",
      ]) {
        expect(text, `${leak} in "${text}"`).not.toContain(leak);
      }
    }
  });

  it("12: the guard never logs or returns the code", () => {
    expect(GUARD).not.toContain("logEvent");
    expect(GUARD).not.toContain("accessToken");
  });
});

describe("interactive gate — every visible control offers the unlock", () => {
  /**
   * The nine user-visible controls that change state. Each is already
   * refused server-side; this asserts the UI also OFFERS the code rather than
   * leaving a reviewer with an unexplained error.
   *
   * Listed explicitly rather than discovered, so ADDING a tenth control is a
   * deliberate decision that fails this test until it is wired — the failure
   * mode otherwise is silent and only shows up in a live demo.
   *
   * The ninth arrived with Phase 5's controlled C01 vulnerable profile.
   * Enabling a deliberate defect is a state change like any other, so it is
   * gated by the same Demo Access Code and offers the same dialog.
   */
  const CONTROLS = [
    "app/demo-merchant/create-order-button.tsx",
    "app/demo-merchant/create-razorpay-order-button.tsx",
    "app/demo-merchant/pay-with-razorpay-button.tsx",
    "app/chaos/runs/[runId]/run-actions.tsx",
    "app/chaos/scenarios/[scenarioId]/run-scenario-form.tsx",
    "components/findings/regression-action.tsx",
    "components/findings/diagnose-action.tsx",
    "components/demo/demo-reset-panel.tsx",
    "components/demo/c01-profile-panel.tsx",
  ] as const;

  it("13: each control uses the shared hook and renders its dialog", () => {
    for (const control of CONTROLS) {
      const source = code(control);
      expect(source, `${control} must use the shared unlock hook`).toContain(
        "useDemoUnlock",
      );
      expect(source, `${control} must render the dialog`).toContain(
        "{unlockDialog}",
      );
    }
  });

  it("14: each control detects the locked signal before reporting a failure", () => {
    for (const control of CONTROLS) {
      const source = code(control);
      // Either family: a 401 from an API, or the Server Action's own message.
      const detects =
        source.includes("isLockedStatus") || source.includes("LOCKED_MESSAGE");
      expect(detects, `${control} must detect the locked signal`).toBe(true);
      expect(source, `${control} must resume the action`).toContain(
        "requestUnlock(",
      );
    }
  });

  it("15: no control implements its own dialog", () => {
    // Eight copies of this flow would be eight chances to get the "lock vs
    // real failure" decision subtly wrong.
    for (const control of CONTROLS) {
      expect(code(control), control).not.toContain("DemoUnlockDialog");
    }
  });

  it("16: the hook never treats an ordinary failure as a lock", () => {
    const hook = code("components/access/use-demo-unlock.tsx");
    // 401 is the lock. 503 is explicitly NOT, because asking for a code that
    // cannot be verified sends a reviewer round a loop they cannot exit.
    expect(hook).toContain("status === 401");
    expect(hook).toContain("status === 503");
    expect(hook).not.toContain("!response.ok");
  });
});
