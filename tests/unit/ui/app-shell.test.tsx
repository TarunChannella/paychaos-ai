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

    // The link being unique is not enough: the LOCKUP inside it must be too.
    // A responsive rail is tempting to build as a compact copy plus a large
    // copy with `md:hidden` between them, which puts the wordmark and the
    // logo in the DOM twice while every testid above still reads as unique.
    // `LogoMark` labels itself, so counting that label counts lockups.
    expect(occurrences(markup, 'aria-label="PayChaos AI"')).toBe(1);
    expect(occurrences(markup, "Reliability Engineer")).toBe(1);
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

    // CORRECTED (sidebar round). This previously sliced a fixed 700-character
    // window BEFORE the badge to inspect its classes. When the badge sits
    // nearer the start than that, `indexOf(...) - 700` goes negative and
    // String.slice reads from the END of the string instead — so the test was
    // quietly inspecting the wrong region and would have passed on a badge
    // that WAS hidden at a breakpoint. Read the badge's own opening tag.
    const badgeTag = /<span[^>]*data-testid="env-badge"[^>]*>/.exec(header);
    expect(badgeTag, "the env badge must be a real element").not.toBeNull();
    expect(badgeTag?.[0]).not.toContain("md:hidden");
    expect(badgeTag?.[0]).not.toContain("sm:hidden");
    expect(badgeTag?.[0]).not.toContain("lg:hidden");
    expect(badgeTag?.[0]).not.toMatch(/(^|["' ])hidden(["' ])/);
  });
});

describe("app shell — the rail's own furniture", () => {
  it("9: the rail states the environment binding without inventing status", () => {
    const markup = shellMarkup("/");
    expect(markup).toContain('data-testid="sidebar-environment"');
    expect(markup).toContain("Test Mode");

    // Nothing in the rail may imply live/production capability.
    for (const forbidden of [
      "Live Mode",
      "LIVE MODE",
      "Production",
      "rzp_live",
    ]) {
      expect(markup, forbidden).not.toContain(forbidden);
    }
  });

  it("10: the branding card claims nothing that is not true", () => {
    const markup = shellMarkup("/");
    expect(markup).toContain("Autonomous by Design");

    // "learning" would imply a runtime ML capability this product does not
    // ship; docs/AI_DESIGN.md records ML as an explicit NO-GO.
    expect(markup).not.toContain("learning");
    expect(markup).toContain("verifying");
  });

  it("11: the decorative curve is not presented as a measurement", () => {
    const markup = shellMarkup("/");
    // The decorative curve specifically must be hidden from assistive
    // technology: a line that announces itself is indistinguishable from a
    // chart, and this product does not ship invented metrics.
    const flourish = /<svg[^>]*data-testid="sidebar-flourish"[^>]*>/.exec(
      markup,
    );
    expect(flourish, "the rail's decorative curve must exist").not.toBeNull();
    expect(flourish?.[0]).toContain('aria-hidden="true"');

    // The general rule this encodes: a graphic either declares itself a
    // meaningful image (the brand mark, which SHOULD be announced) or it is
    // hidden. Nothing may sit in between, unlabelled and exposed.
    for (const svg of markup.match(/<svg[^>]*>/g) ?? []) {
      if (svg.includes('role="img"')) {
        expect(svg, svg).toContain("aria-label=");
      } else {
        expect(svg, svg).toContain('aria-hidden="true"');
      }
    }

    // No axis label inside the graphic itself.
    expect(markup).not.toContain("<text");

    // And nothing the READER sees may look like a measurement. This is
    // checked against visible text, not raw markup: the curve's gradient
    // legitimately carries offset="0%" / "100%", which is SVG syntax rather
    // than a number shown to anyone.
    const visibleText = markup.replace(/<[^>]*>/g, " ");
    for (const forbidden of ["%", "uptime", "trend", "score"]) {
      expect(visibleText.toLowerCase(), forbidden).not.toContain(forbidden);
    }
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
