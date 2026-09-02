import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The shell is a client component that reads the current route.
const pathname = vi.hoisted(() => ({ value: "/" }));
vi.mock("next/navigation", () => ({
  usePathname: () => pathname.value,
}));

import { AppShell } from "@/components/shell/app-shell";

/**
 * PayChaos AI — the console shell.
 *
 * WHY THIS FILE EXISTS. A responsive shell is unusually easy to get wrong in a
 * way that every other gate waves through: rendering the sidebar twice and
 * hiding one copy with `md:hidden` typechecks, lints, builds and looks correct
 * in a browser at both widths. It is still wrong — every `data-testid`, every
 * nav link and the primary navigation landmark itself exist twice in the DOM.
 * That defect shipped once and was caught only by Playwright strict mode
 * ("resolved to 2 elements"), several minutes into an end-to-end run. These
 * assertions catch it in milliseconds.
 */

function shellMarkup(route: string): string {
  pathname.value = route;
  return renderToStaticMarkup(
    <AppShell>
      <p>page content</p>
    </AppShell>,
  );
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("app shell — exactly one of each landmark", () => {
  it("1: every navigation testid appears exactly once", () => {
    const markup = shellMarkup("/");

    for (const id of [
      "nav-overview",
      "nav-demo-merchant",
      "nav-chaos-runs",
      "nav-findings",
      "nav-reliability",
      "nav-settings",
    ]) {
      expect(occurrences(markup, `data-testid="${id}"`), id).toBe(1);
    }
  });

  it("2: there is one primary navigation landmark, not two", () => {
    const markup = shellMarkup("/");
    expect(occurrences(markup, 'aria-label="Primary"')).toBe(1);
  });

  it("3: the brand lockup and its home link appear exactly once", () => {
    const markup = shellMarkup("/findings");
    expect(occurrences(markup, 'data-testid="app-brand"')).toBe(1);
    expect(occurrences(markup, 'aria-label="PayChaos AI — Overview"')).toBe(1);
  });

  it("4: the Test Mode badge appears exactly once, and is not optional", () => {
    const markup = shellMarkup("/chaos");
    expect(occurrences(markup, 'data-testid="env-badge"')).toBe(1);
    expect(occurrences(markup, "RAZORPAY TEST MODE")).toBe(1);
  });
});

describe("app shell — the rail survives a scrolling page", () => {
  it("5: the rail is sticky and full height on desktop", () => {
    const markup = shellMarkup("/");
    // Navigation must not scroll away from an operator reading a long
    // evidence page; this is the whole point of the rail.
    expect(markup).toContain("md:sticky");
    expect(markup).toContain("md:h-screen");
  });

  it("6: Test Mode is pinned to the top bar at every width", () => {
    const markup = shellMarkup("/");
    const header = markup.slice(markup.indexOf("<header"));
    expect(header).toContain("sticky top-0");
    expect(header).toContain("RAZORPAY TEST MODE");
    // It must never be hidden at a breakpoint.
    const badge = header.slice(header.indexOf('data-testid="env-badge"') - 700);
    expect(badge).not.toContain("md:hidden");
  });
});

describe("app shell — the login screen is deliberately bare", () => {
  it("7: /access renders no navigation and no brand chrome", () => {
    const markup = shellMarkup("/access");

    // Offering links an unauthenticated visitor cannot follow reads as a
    // broken app rather than a locked one.
    expect(markup).not.toContain('aria-label="Primary"');
    expect(markup).not.toContain('data-testid="app-brand"');
    expect(markup).not.toContain('data-testid="env-badge"');
    expect(markup).toContain("page content");
  });

  it("8: a nested /access path is bare too", () => {
    expect(shellMarkup("/access?next=/findings")).not.toContain(
      'aria-label="Primary"',
    );
  });
});
