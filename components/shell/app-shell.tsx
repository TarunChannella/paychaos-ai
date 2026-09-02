"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { AppNav } from "@/components/shell/app-nav";

/**
 * Phase 5B — the operations-console shell.
 *
 * THE LOGIN SCREEN GETS NO CHROME. `/access` renders bare: showing primary
 * navigation to someone who has not authenticated yet would offer links they
 * cannot follow, and a nav rail around a token prompt reads as a broken app
 * rather than a locked one.
 *
 * TEST MODE IS NEVER SUBTLE. The environment badge is in the top bar of every
 * screen. An operator must never have to wonder which mode they are looking
 * at, and a reviewer must be able to see at a glance that nothing here can
 * touch live money.
 *
 * NOTHING IS INVENTED IN THE CHROME. There is no "system status: healthy"
 * pill and no "last updated" clock, because neither is backed by a real
 * deterministic value. An always-green status light that is not measuring
 * anything is exactly the kind of decoration this product refuses.
 */
export function AppShell({ children }: { readonly children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  if (pathname.startsWith("/access")) return <>{children}</>;

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center justify-between gap-4 border-b border-border bg-background px-4">
        <Link
          href="/"
          className="flex items-center gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span
            aria-hidden="true"
            className="flex h-6 w-6 items-center justify-center rounded bg-foreground text-[12px] font-bold text-background"
          >
            P
          </span>
          <span className="text-sm font-semibold tracking-tight text-foreground">
            PayChaos AI
          </span>
          <span className="hidden text-xs text-muted-foreground sm:inline">
            Payment Reliability Console
          </span>
        </Link>

        {/* Test Mode is never subtle and never scrolls away. */}
        <span
          className="inline-flex items-center gap-1.5 rounded-md border border-blue-600/30 bg-blue-50 px-2.5 py-1 font-mono text-[11px] font-semibold uppercase tracking-wider text-blue-700 dark:border-blue-400/30 dark:bg-blue-950/40 dark:text-blue-300"
          data-testid="env-badge"
        >
          <span aria-hidden="true" className="text-[9px]">
            ●
          </span>
          RAZORPAY TEST MODE
        </span>
      </header>

      <div className="flex flex-1 flex-col md:flex-row">
        <aside className="shrink-0 border-b border-border bg-muted/20 px-3 py-3 md:w-56 md:border-b-0 md:border-r md:py-4">
          <p className="mb-2 hidden px-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground md:block">
            Reliability
          </p>
          <AppNav />
        </aside>

        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
