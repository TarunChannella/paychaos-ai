import { Badge } from "@/components/ui/badge";
import {
  provenanceLabel,
  type ProvenanceTone,
} from "@/lib/evidence/provenance-label";
import { toProvenance } from "@/lib/evidence/timeline-model";

/**
 * Phase 3H — the single component that states where a piece of evidence came
 * from (CLAUDE.md Section 24).
 *
 * It takes the RAW STORED value and converts it here, so a screen cannot pass
 * a hand-written string and label replayed evidence as a live Razorpay event.
 */

// Only the authentic variant gets the solid/primary treatment. Everything
// PayChaos produced is visually distinct from a genuine Razorpay delivery, so
// the distinction survives a screenshot in the demo.
const TONE_VARIANT: Record<
  ProvenanceTone,
  "default" | "secondary" | "outline" | "destructive"
> = {
  AUTHENTIC: "default",
  REPLAY: "secondary",
  RECORDED: "outline",
  SYNTHETIC: "outline",
  UNKNOWN: "destructive",
};

export function ProvenanceBadge({
  storedValue,
  className,
}: {
  /** The persisted classification, exactly as the database holds it. */
  readonly storedValue: string;
  readonly className?: string;
}) {
  const label = provenanceLabel(toProvenance(storedValue));

  return (
    <Badge
      variant={TONE_VARIANT[label.tone]}
      className={className}
      title={label.description}
      data-testid="provenance-badge"
      data-tone={label.tone}
    >
      {label.label}
    </Badge>
  );
}
