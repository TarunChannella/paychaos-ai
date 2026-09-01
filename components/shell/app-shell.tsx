"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { AppNav } from "@/components/shell/app-nav";
import { Badge } from "@/components/ui/badge";

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
      <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <Link
          href="/"
          className="flex items-center gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span
            aria-hidden="true"
            className="flex h-7 w-7 items-center justify-center rounded-md bg-foreground text-[13px] font-bold text-background"
          >
            P
          </span>
          <span className="text-sm font-semibold tracking-tight text-foreground">
            PayChaos AI
          </span>
        </Link>

        <Badge
          variant="outline"
          className="border-amber-500/40 font-mono text-[11px] tracking-wide text-amber-700 dark:text-amber-400"
          data-testid="env-badge"
        >
          RAZORPAY TEST MODE
        </Badge>
      </header>

      <div className="flex flex-1 flex-col md:flex-row">
        <aside className="shrink-0 border-b border-border px-3 py-3 md:w-56 md:border-b-0 md:border-r md:py-5">
          <AppNav />
        </aside>

        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
