import Link from "next/link";

import { LogoLockup } from "@/components/brand/logo";
import { AppNav } from "@/components/shell/app-nav";

/**
 * PayChaos AI — the left rail.
 *
 * ONE ELEMENT, TWO SHAPES. This is a full-height sticky column on desktop and
 * a horizontal strip above the content on mobile — the same DOM either way.
 * It is deliberately NOT a desktop rail plus a hidden mobile copy: that
 * pattern duplicates every `data-testid`, every link and the primary
 * navigation landmark, which is a defect this shell has already shipped once
 * and now has a regression test against.
 *
 * ICY GLASS, NOT DECORATION. The tint comes entirely from `--sidebar-*`
 * tokens, which nothing outside this rail consumes. The console's neutral
 * palette is therefore untouched: a page, a card, a table and a status badge
 * all render exactly as before.
 *
 * NOTHING HERE IS MEASURED. The rail states what environment the deployment
 * is bound to and what the product does. There is no uptime pill, no health
 * light and no chart — the flourish at the bottom is an abstract curve with
 * no axis, no scale and no value, because a decorative line that looks like a
 * metric is a fabricated metric.
 */
export function AppSidebar() {
  return (
    <aside
      data-testid="app-sidebar"
      className={[
        "flex shrink-0 flex-col border-b border-sidebar-border bg-sidebar text-sidebar-foreground",
        "supports-[backdrop-filter]:bg-sidebar/85 supports-[backdrop-filter]:backdrop-blur-xl",
        // Desktop: a sticky, full-height rail that never scrolls away.
        "md:sticky md:top-0 md:h-screen md:w-[248px] md:border-b-0 md:border-r",
      ].join(" ")}
    >
      {/* ---- BRAND ------------------------------------------------------ */}
      <div className="px-4 py-3.5 md:px-5 md:py-5">
        <Link
          href="/"
          className="inline-flex rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          aria-label="PayChaos AI — Overview"
          data-testid="app-brand"
        >
          {/* Exactly one lockup. The `lg` variant reflows itself across
              breakpoints rather than shipping a second hidden copy. */}
          <LogoLockup size="lg" subtitle />
        </Link>
      </div>

      {/* ---- NAVIGATION ------------------------------------------------- */}
      <div className="px-3 pb-3 md:px-3.5 md:pb-2">
        <p className="mb-2 hidden px-2.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-sidebar-muted md:block">
          Console
        </p>
        <AppNav />
      </div>

      {/* ---- ENVIRONMENT BINDING ---------------------------------------- */}
      {/* Complementary to the Test Mode badge pinned in the top bar, not a
          second copy of it: that badge is the standing safety flag, this
          states what the deployment is actually bound to. */}
      <div className="hidden px-3.5 pt-1 md:block">
        <div
          className="rounded-[14px] border border-sidebar-card-border bg-sidebar-card px-3.5 py-3"
          data-testid="sidebar-environment"
        >
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500"
            />
            <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-sidebar-foreground">
              Test Mode
            </span>
          </div>
          <div className="mt-2.5 flex items-baseline justify-between gap-2">
            <span className="text-[11.5px] text-sidebar-muted">
              Environment
            </span>
            <span className="font-mono text-[11.5px] font-semibold text-sidebar-accent-foreground">
              Test
            </span>
          </div>
        </div>
      </div>

      {/* ---- BREATHING ROOM --------------------------------------------- */}
      <div className="hidden md:block md:flex-1" />

      {/* ---- AUTONOMOUS BY DESIGN --------------------------------------- */}
      <div className="hidden px-3.5 pb-4 md:block">
        <div className="overflow-hidden rounded-[14px] border border-sidebar-card-border bg-sidebar-card px-3.5 pb-3 pt-3">
          <p className="text-[12.5px] font-semibold tracking-tight text-sidebar-foreground">
            Autonomous by Design
          </p>
          <p className="mt-1.5 text-[11px] leading-[1.5] text-sidebar-muted">
            Continuously testing, verifying and hardening your payment
            integrations.
          </p>

          {/*
            PURELY DECORATIVE. An abstract curve with no axis, no scale, no
            labels and no data behind it. The product refuses invented
            metrics, so this must never be mistakable for one: it is hidden
            from assistive technology and carries nothing a reader could
            misread as a measurement.
          */}
          <svg
            aria-hidden="true"
            focusable="false"
            data-testid="sidebar-flourish"
            viewBox="0 0 200 34"
            preserveAspectRatio="none"
            className="mt-3 h-8 w-full"
          >
            <defs>
              <linearGradient id="pc-rail-accent" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="oklch(0.62 0.15 259)" />
                <stop offset="100%" stopColor="oklch(0.62 0.15 300)" />
              </linearGradient>
            </defs>
            <path
              d="M0 27 C 26 27, 34 9, 58 9 S 92 25, 116 22 S 158 5, 200 12"
              fill="none"
              stroke="url(#pc-rail-accent)"
              strokeWidth="1.75"
              strokeLinecap="round"
              opacity="0.85"
            />
          </svg>
        </div>
      </div>
    </aside>
  );
}
