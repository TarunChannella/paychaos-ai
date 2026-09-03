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
  it("5: safe methods pass, unsafe methods are challenged", () => {
    expect(MIDDLEWARE).toContain("SAFE_METHODS");
    expect(MIDDLEWARE).toContain('"GET"');
    expect(MIDDLEWARE).toContain("SAFE_METHODS.has(request.method)");
  });

  it("6: a refused action gets a 401, not an HTML redirect", () => {
    // Redirecting a Server Action POST hands the client an HTML document
    // where it expects an action result.
    expect(MIDDLEWARE).toContain("status: 401");
    expect(MIDDLEWARE).not.toContain("NextResponse.redirect");
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
