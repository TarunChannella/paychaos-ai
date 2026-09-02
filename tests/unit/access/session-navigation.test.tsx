import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// `lib/access/session` is server-only; this file also imports the client
// login page, so the guard has to be stubbed for both to coexist here.
vi.mock("server-only", () => ({}));

import AccessLoginPage from "@/app/access/page";
import { ACCESS_SESSION_COOKIE_NAME } from "@/lib/access/session";

/**
 * Operator access — session persistence across navigation.
 *
 * The reported bug was that a CORRECT token was accepted and the session
 * cookie was written, but protected navigation was not reliably unlocked: the
 * operator could be bounced back through the access flow. Authentication was
 * never broken — the failure was entirely in client-side navigation, where a
 * soft App Router transition could replay the middleware redirect that the
 * Router Cache had captured while the operator was still unauthenticated.
 *
 * These tests pin the corrected behaviour and the security properties that
 * must survive it.
 */

const PAGE_SOURCE = readFileSync(
  join(process.cwd(), "app", "access", "page.tsx"),
  "utf8",
);

/** Documentation naming a construct must never satisfy a code assertion. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(String.fromCharCode(10))
    .filter((line) => !line.trimStart().startsWith("//"))
    .join(String.fromCharCode(10));
}

const PAGE_CODE = code(PAGE_SOURCE);

describe("access page — post-login navigation", () => {
  it("1: a successful login triggers a FULL document navigation", () => {
    // The fix. A full navigation makes the browser re-request the target with
    // the fresh cookie attached, so middleware evaluates it server-side and
    // the client Router Cache is rebuilt from an authenticated response.
    expect(PAGE_CODE).toContain("window.location.replace(resolveNextPath())");
  });

  it("2: the stale soft-navigation path is gone", () => {
    // A soft transition could be served from the Router Cache, which by this
    // point usually holds the middleware redirect captured pre-login.
    expect(PAGE_CODE).not.toContain("router.replace");
    expect(PAGE_CODE).not.toContain("router.push");
    expect(PAGE_CODE).not.toContain("router.refresh");
    expect(PAGE_CODE).not.toContain("useRouter");
  });

  it("3: `replace` is used, not `assign`, so Back never returns to login", () => {
    expect(PAGE_CODE).toContain("window.location.replace");
    expect(PAGE_CODE).not.toContain("window.location.assign");
    expect(PAGE_CODE).not.toContain("window.location.href =");
  });

  it("4: navigation only ever targets the guarded internal path", () => {
    // The open-redirect guard is what makes a full navigation safe.
    expect(PAGE_CODE).toContain('next.startsWith("/")');
    expect(PAGE_CODE).toContain('!next.startsWith("//")');
    expect(PAGE_CODE).toContain('"/demo-merchant"');
    // Nothing may navigate to a caller-supplied absolute URL.
    expect(PAGE_CODE).not.toContain("window.location.replace(next)");
  });

  it("5: double submit is still impossible", () => {
    expect(PAGE_CODE).toContain("if (inFlight.current) return");
    expect(PAGE_CODE).toContain("disabled={isBusy}");
  });

  it("6: a failed login does NOT navigate and re-enables the form", () => {
    const failureBranch = PAGE_CODE.slice(
      PAGE_CODE.indexOf("if (!response.ok)"),
      PAGE_CODE.indexOf("window.location.replace"),
    );
    expect(failureBranch).toContain('setPhase("idle")');
    expect(failureBranch).toContain("inFlight.current = false");
    expect(failureBranch).toContain("return");
  });
});

describe("access page — no client-visible credential", () => {
  it("7: the token is never persisted in browser storage", () => {
    for (const forbidden of [
      "localStorage",
      "sessionStorage",
      "document.cookie",
      "indexedDB",
    ]) {
      expect(PAGE_CODE, forbidden).not.toContain(forbidden);
    }
  });

  it("8: no secret or env value is rendered", () => {
    const markup = renderToStaticMarkup(<AccessLoginPage />);

    for (const forbidden of [
      "PAYCHAOS_ACCESS_TOKEN",
      "PAYCHAOS_SESSION_SECRET",
      "SUPABASE_SERVICE_ROLE_KEY",
      "RAZORPAY_KEY_SECRET",
      ACCESS_SESSION_COOKIE_NAME,
    ]) {
      expect(markup, forbidden).not.toContain(forbidden);
    }
  });

  it("9: the token input is a password field that never autocompletes", () => {
    const markup = renderToStaticMarkup(<AccessLoginPage />);
    expect(markup).toContain('type="password"');
    expect(markup).toContain('autoComplete="off"');
  });
});

describe("middleware — current operator surfaces are all protected", () => {
  it("10: every privileged UI route is in the matcher", async () => {
    const { config } = await import("@/middleware");

    // Exact equality: a new operator surface cannot appear ungated.
    expect(config.matcher).toEqual([
      "/demo-merchant/:path*",
      "/chaos/:path*",
      "/reliability/:path*",
      "/findings/:path*",
      "/settings/:path*",
    ]);
  });

  it("11: the Razorpay webhook is never behind operator auth", async () => {
    const { config } = await import("@/middleware");
    const declared = config.matcher.join(" ");

    // Putting the webhook behind the gate would silently break real Razorpay
    // delivery — signature verification is its protection, not a session.
    expect(declared).not.toContain("webhook");
    expect(declared).not.toContain("/api/");
  });

  it("12: the login route itself is never gated", async () => {
    const { config } = await import("@/middleware");
    const declared = config.matcher.join(" ");

    // /access is how a session is created; gating it is a deadlock.
    expect(declared).not.toContain("/access");
  });
});
