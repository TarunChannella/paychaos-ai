"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { LogoLockup } from "@/components/brand/logo";
import { AppNav } from "@/components/shell/app-nav";

/**
 * PayChaos AI — the operations console shell.
 *
 * A STICKY RAIL, NOT A SCROLLING COLUMN. On desktop the sidebar is `sticky` at
 * full viewport height with its own overflow, so navigation stays put while a
 * long evidence page scrolls beside it. On an incident screen the operator
 * should never have to scroll back to the top to move somewhere else.
 *
 * ONE NAVIGATION, ONE BRAND — RENDERED ONCE. The rail is the SAME element at
 * every breakpoint: a full-height column on desktop, a horizontal strip above
 * the content on mobile. An earlier version of this shell rendered a second
 * copy of the lockup and `<AppNav/>` for mobile and hid one with `md:hidden`.
 * That duplicated every `data-testid` and every nav link in the DOM, which is
 * how it was caught: `getByTestId("nav-overview")` resolved to two elements.
 * Hiding a duplicate is not the same as not having one — the markup, the ids
 * and the landmark all existed twice. Reflowing one element with CSS is both
 * the simpler and the more honest structure.
 *
 * BRANDED, QUIETLY. The lockup sits top-left inside the rail rather than in a
 * separate banner, which is what makes the product read as one application
 * instead of a header stapled to a page. The chrome is deliberately low
 * contrast: it should recede and let the evidence carry the screen.
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
  if (pathname.startsWith("/access")) return <>{children}</>;

  return (
    <div className="flex min-h-screen flex-col bg-muted/20 md:flex-row">
      {/* ---- THE RAIL --------------------------------------------------- */}
      <aside className="flex shrink-0 flex-col border-b border-border bg-background md:sticky md:top-0 md:h-screen md:w-60 md:border-b-0 md:border-r">
        <div className="flex h-14 items-center px-4 md:border-b md:border-border">
          <Link
            href="/"
            className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="PayChaos AI — Overview"
            data-testid="app-brand"
          >
            <LogoLockup />
          </Link>
        </div>

        <div className="px-3 pb-3 md:flex-1 md:overflow-y-auto md:py-4">
          <p className="mb-2 hidden px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70 md:block">
            Reliability
          </p>
          <AppNav />
        </div>

        <div className="hidden border-t border-border px-4 py-3 md:block">
          <p className="text-[11px] leading-4 text-muted-foreground">
            Deterministic money invariants.
            <br />
            Evidence over inference.
          </p>
        </div>
      </aside>

      {/* ---- CONTENT ---------------------------------------------------- */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/75 md:px-6">
          <span className="hidden text-sm text-muted-foreground sm:inline">
            Payment Reliability Console
          </span>

          <span
            className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-md border border-blue-600/30 bg-blue-50 px-2.5 py-1 font-mono text-[11px] font-semibold uppercase tracking-wider text-blue-700 dark:border-blue-400/30 dark:bg-blue-950/40 dark:text-blue-300"
            data-testid="env-badge"
          >
            RAZORPAY TEST MODE
          </span>
        </header>

        <main className="min-w-0 flex-1 bg-background">{children}</main>
      </div>
    </div>
  );
}
