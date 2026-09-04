"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Phase 5B — primary navigation for the operations console.
 *
 * THE ORDER IS THE PRODUCT LOOP. Overview, then the merchant under test,
 * then BREAK (chaos), DETECT (findings), READINESS — with administration
 * last. A reviewer following the demo can walk straight down the rail.
 *
 * EVERY DESTINATION IS REAL. There is no "Evidence" or "Regression" module
 * here, and that is deliberate: evidence lives on the chaos-run and finding
 * screens where it has context, and a regression belongs to the finding it
 * re-tests. A nav entry leading to an empty shell would be a fake product
 * module, which this project does not ship.
 *
 * CLIENT ONLY FOR THE ACTIVE STATE. The one thing this needs the browser for
 * is knowing which route is current; everything else is plain links.
 */

interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly icon: React.ReactNode;
}

/** Inline SVGs — no icon package is added for five glyphs. */
const ICON = {
  overview: (
    <path
      d="M3 12h4l3 8 4-16 3 8h4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  chaos: (
    <path
      d="M13 2 4.5 13H11l-1 9 8.5-11H12l1-9Z"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  findings: (
    <>
      <path d="M12 9v4" strokeLinecap="round" />
      <path d="M12 17h.01" strokeLinecap="round" />
      <path
        d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"
        strokeLinejoin="round"
      />
    </>
  ),
  reliability: (
    <>
      <path d="M12 3a9 9 0 1 0 9 9" strokeLinecap="round" />
      <path d="M12 12l5-5" strokeLinecap="round" />
    </>
  ),
  merchant: (
    <>
      <path d="M3 9h18" strokeLinecap="round" />
      <path
        d="M5 9V6a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3M4 9v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9"
        strokeLinejoin="round"
      />
      <path d="M9 13h6" strokeLinecap="round" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path
        d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 8.9 19a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 5 8.9a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9.6a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"
        strokeLinejoin="round"
      />
    </>
  ),
} as const;

const NAV_ITEMS: readonly NavItem[] = [
  { href: "/", label: "Overview", icon: ICON.overview },
  { href: "/demo-merchant", label: "Demo Merchant", icon: ICON.merchant },
  { href: "/chaos", label: "Chaos Runs", icon: ICON.chaos },
  { href: "/findings", label: "Findings", icon: ICON.findings },
  { href: "/reliability", label: "Reliability", icon: ICON.reliability },
  { href: "/settings", label: "Settings", icon: ICON.settings },
];

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function AppNav() {
  const pathname = usePathname() ?? "/";

  return (
    <nav
      aria-label="Primary"
      // VERTICAL AT EVERY WIDTH. This was `flex gap-1 overflow-x-auto` below
      // `md:`, which was correct for the shell's ORIGINAL mobile design — a
      // horizontal strip of links above the content. That shell is gone: the
      // rail is now a 276px off-canvas drawer at every width, and a
      // horizontal row inside a 276px column pushes most of the destinations
      // off the right edge. Measured on a 390px viewport, `nav-reliability`
      // sat at x=497 — outside the viewport entirely, reachable only by
      // horizontally scrolling a menu that gives no sign it scrolls.
      //
      // It survived because `toBeVisible()` passes for an element outside the
      // viewport and `.click()` scrolls one into view first, so the existing
      // coverage exercised links a human could not have found. The sticky
      // sidebar spec asserts `toBeInViewport()` instead, which is what caught
      // it.
      className="flex flex-col gap-1 md:gap-0.5"
    >
      {NAV_ITEMS.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
            className={[
              // The border is always present and merely transparent when
              // inactive, so selecting an item cannot shift the rail by 1px.
              "group flex min-h-[44px] shrink-0 items-center gap-2.5 rounded-[11px] border px-3 text-[13.5px]",
              "transition-colors duration-150",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
              active
                ? [
                    "border-sidebar-active-border bg-sidebar-active font-semibold",
                    "text-sidebar-accent-foreground",
                    // A single hairline of light along the top edge is what
                    // reads as glass; a drop shadow here would read as a
                    // button and compete with the page's real actions.
                    "shadow-[inset_0_1px_0_0_rgb(255_255_255/0.65)]",
                  ].join(" ")
                : [
                    // #475569 inactive, #172033 on hover: readable at rest,
                    // and clearly reactive without shouting.
                    "border-transparent text-[#475569]",
                    "hover:border-transparent hover:bg-sidebar-accent",
                    "hover:text-[#172033]",
                  ].join(" "),
            ].join(" ")}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              className={[
                "h-[18px] w-[18px] shrink-0 transition-colors",
                active
                  ? "text-sidebar-accent-foreground"
                  : "text-[#64748b] group-hover:text-[#172033]",
              ].join(" ")}
            >
              {item.icon}
            </svg>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
