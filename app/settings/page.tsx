import { DemoResetPanel } from "@/components/demo/demo-reset-panel";
import { Badge } from "@/components/ui/badge";
import { Card, PageHeader, PageShell, Section } from "@/components/ui/page";
import { getRazorpayEnv } from "@/lib/config/razorpay-env";

/**
 * Phase 5B — Settings: real configuration status and the Demo Reset control.
 *
 * THIS IS NOT A DECORATIVE MODULE. It exists because it holds two things an
 * operator genuinely needs: proof of which Razorpay mode the deployment is
 * bound to, and the documented Demo Reset. If it had held neither it would
 * not have been created — a nav entry leading to a placeholder is a fake
 * product module.
 *
 * NO SECRET IS EVER RENDERED. `getRazorpayEnv()` fails closed on any
 * non-Test-Mode key, so the fact that it RESOLVES is the Test Mode proof.
 * Nothing is read out of the result: no key id, no secret, no webhook secret,
 * no environment value.
 */
export const dynamic = "force-dynamic";

function readTestModeStatus(): "ENFORCED" | "UNAVAILABLE" {
  try {
    getRazorpayEnv();
    return "ENFORCED";
  } catch {
    return "UNAVAILABLE";
  }
}

export default function SettingsPage() {
  const testMode = readTestModeStatus();

  return (
    <PageShell>
      <PageHeader
        eyebrow="Configuration"
        title="Settings"
        lede="Deployment configuration status and demo administration."
      />

      <Section
        title="Environment"
        description="What this deployment is bound to. These are configuration facts, not measurements."
      >
        <Card
          className="flex flex-col gap-3"
          data-testid="settings-environment"
        >
          <h2 className="text-sm font-semibold text-card-foreground">
            Payment environment
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">
              Razorpay Test Mode
            </span>
            <Badge
              variant={testMode === "ENFORCED" ? "default" : "destructive"}
              data-testid="settings-test-mode"
            >
              {testMode}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            PayChaos refuses to start against a live key. Test Mode enforcement
            is a configuration check, not a display preference — when it reports
            UNAVAILABLE the payment configuration is invalid or forbidden, and
            no chaos scenario can run. No key, secret or environment value is
            shown on this page.
          </p>
        </Card>
      </Section>

      <Section
        title="Application"
        description="Static properties of this build. No secret, key or environment value is displayed anywhere on this page."
      >
        <Card>
          <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            {(
              [
                ["Product", "PayChaos AI"],
                ["Purpose", "Autonomous payment reliability engineering"],
                ["Payment boundary", "Razorpay Test Mode only"],
                ["Chaos target", "Internal Demo Merchant only"],
              ] as const
            ).map(([term, value]) => (
              <div key={term} className="flex flex-col gap-0.5">
                <dt className="text-muted-foreground">{term}</dt>
                <dd className="font-medium text-card-foreground">{value}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </Section>

      {/* ---- DANGER ZONE ------------------------------------------------ */}
      {/* Deliberately last, deliberately separated, and deliberately labelled.
          A destructive control sitting beside ordinary configuration is how
          an irreversible action gets clicked by someone who was only reading. */}
      <Section
        title="Danger zone"
        description="Irreversible administrative actions. These affect runtime evidence, never schema, migrations, RLS or configuration."
        className="rounded-2xl border border-destructive/30 bg-[var(--status-fail-bg)]/40 p-5"
      >
        <DemoResetPanel />
      </Section>
    </PageShell>
  );
}
