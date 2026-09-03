"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { AppSidebar } from "@/components/shell/app-sidebar";

/**
 * PayChaos AI — the operations console shell.
 *
 * A STICKY RAIL, NOT A SCROLLING COLUMN. On desktop the sidebar is `sticky` at
 * full viewport height with its own overflow, so navigation stays put while a
 * long evidence page scrolls beside it. On an incident screen the operator
 * should never have to scroll back to the top to move somewhere else.
 *
 * ONE NAVIGATION, ONE BRAND — RENDERED ONCE. The rail (`AppSidebar`) is the
 * SAME element at every breakpoint: a full-height column on desktop, a
 * horizontal strip above the content on mobile. An earlier version of this
 * shell rendered a second copy of the lockup and `<AppNav/>` for mobile and
 * hid one with `md:hidden`. That duplicated every `data-testid` and every nav
 * link in the DOM, which is how it was caught: `getByTestId("nav-overview")`
 * resolved to two elements. Hiding a duplicate is not the same as not having
 * one — the markup, the ids and the landmark all existed twice. Reflowing one
 * element with CSS is both the simpler and the more honest structure.
 *
 * THE RAIL OWNS ITS OWN PALETTE. `AppSidebar` is tinted entirely through
 * `--sidebar-*` tokens that nothing else consumes, so the navigation can read
 * as light blue glass while every page, card, table and status badge keeps
 * the console's neutral palette unchanged.
 *
 * TEST MODE IS NEVER SUBTLE AND NEVER SCROLLS AWAY. The environment badge is
 * pinned in the sticky top bar on every protected screen, at every width.
 *
 * THE LOGIN SCREEN GETS NO CHROME. `/access` renders bare: offering primary
 * navigation to someone who has not authenticated yet would present links
 * they cannot follow, and a nav rail around a token prompt reads as a broken
 * app rather than a locked one.
 *
 * NOTHING IS INVENTED IN THE CHROME. No "system status: healthy" pill and no
 * "last updated" clock — neither is backed by a real measurement, and an
 * always-green light that measures nothing is exactly the decoration this
 * product refuses.
 */
export function AppShell({ children }: { readonly children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const [navOpen, setNavOpen] = useState(false);

  // Closing on navigation is handled where the navigation happens — the rail
  // calls `onNavigate` — rather than by reacting to a pathname change with
  // setState inside an effect, which renders twice and fights React.

  // Escape closes it, which is the behaviour anyone who has met a drawer
  // expects, and the only keyboard exit when focus is inside the panel.
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNavOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navOpen]);

  if (pathname.startsWith("/access")) return <>{children}</>;

  return (
    <div className="flex min-h-screen flex-col bg-muted/20 md:flex-row">
      {/* Scrim: mobile only, and only while the drawer is open. */}
      {navOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={() => setNavOpen(false)}
          className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-[2px] md:hidden"
        />
      )}

      <AppSidebar open={navOpen} onNavigate={() => setNavOpen(false)} />

      {/* ---- CONTENT ---------------------------------------------------- */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/75 md:px-6">
          {/* Mobile: the drawer trigger plus a text wordmark. Deliberately
              text, not a second lockup — the logo mark and its home link stay
              unique to the rail, so no testid or landmark is duplicated. */}
          <button
            type="button"
            onClick={() => setNavOpen(true)}
            aria-label="Open navigation"
            aria-expanded={navOpen}
            aria-controls="app-sidebar"
            className="-ml-1 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border border-border bg-card text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
            data-testid="nav-trigger"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              className="h-[18px] w-[18px]"
            >
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>

          <span className="text-sm font-semibold text-foreground md:hidden">
            PayChaos<span className="text-muted-foreground"> AI</span>
          </span>

          <span className="hidden text-sm text-muted-foreground sm:max-md:hidden md:inline">
            Payment Reliability Console
          </span>

          {/* A live status dot plus the words. It must read as a deliberate,
              trustworthy statement of which environment this is bound to —
              never as decoration, and never small enough to miss. */}
          <span
            className="ml-auto inline-flex shrink-0 items-center gap-2 rounded-[10px] border border-[#bfdbfe] bg-[#eff6ff] px-2.5 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-[#1d4ed8] dark:border-blue-400/30 dark:bg-blue-950/40 dark:text-blue-300"
            data-testid="env-badge"
          >
            <span
              aria-hidden="true"
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#2563eb]"
            />
            RAZORPAY TEST MODE
          </span>
        </header>

        <main className="min-w-0 flex-1 bg-background">{children}</main>
      </div>
    </div>
  );
}
