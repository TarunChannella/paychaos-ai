import { ProvenanceBadge } from "@/components/chaos/provenance-badge";
import { Card, FieldLabel } from "@/components/ui/page";

import type {
  EvidenceTimeline,
  TimelineItem,
} from "@/lib/evidence/timeline-model";

/**
 * Phase 5 UI — the evidence rail.
 *
 * IT IS A RENDERER, NOT A TIMELINE ENGINE. Every item, label, timestamp,
 * provenance value and gap comes from the existing Phase 3H
 * `buildEvidenceTimeline` model. This component adds no stage, infers no
 * ordering and computes no state — it draws the causal chain the evidence
 * already describes.
 *
 * THE RAIL IS THE POINT. A flat list of bordered cards hides the thing that
 * matters: that these events CAUSED one another. A connected vertical rail
 * with one marker per event reads as a chain, which is what the evidence is.
 *
 * GAPS ARE LOUD, NOT HIDDEN. "Evidence not captured" is rendered as a
 * first-class part of the record rather than tucked away. Honest gaps are a
 * product strength: a timeline that quietly omits what was never recorded is
 * indistinguishable from one that is complete.
 *
 * NOTHING STREAMS. This is a persisted record rendered once. No stage is
 * shown as in-progress, and no missing step is drawn as completed.
 */

/** One glyph per timeline kind. Text, so no icon dependency is added. */
const KIND_GLYPH: Record<string, string> = {
  SOURCE_WEBHOOK: "↓",
  ORIGINAL_PROCESSING_ATTEMPT: "▸",
  PAYCHAOS_REPLAY_ATTEMPT: "⟳",
  STATE_SNAPSHOT: "◉",
  SCENARIO_EVIDENCE: "⚡",
  INVARIANT_EVALUATED: "⚖",
  FINDING_CREATED: "!",
  NOT_CAPTURED: "∅",
  INVALID: "✕",
};

/** Short, factual explanation of what each stage means. */
const KIND_MEANING: Record<string, string> = {
  SOURCE_WEBHOOK: "The provider event this run replayed or observed.",
  ORIGINAL_PROCESSING_ATTEMPT:
    "The merchant's own first processing of that event.",
  PAYCHAOS_REPLAY_ATTEMPT:
    "A PayChaos-controlled re-delivery of the same event.",
  STATE_SNAPSHOT: "Merchant state captured around processing.",
  SCENARIO_EVIDENCE: "The controlled scenario execution itself.",
  INVARIANT_EVALUATED: "A deterministic money invariant was evaluated.",
  FINDING_CREATED: "A finding was recorded from a failed invariant.",
};

function RailItem({ item }: { readonly item: TimelineItem }) {
  return (
    <li
      className="relative flex gap-4 pb-6 last:pb-0"
      data-testid="timeline-item"
    >
      {/* The connecting rail. */}
      <div className="flex flex-col items-center">
        <span
          aria-hidden="true"
          className="z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-card text-xs text-muted-foreground"
        >
          {KIND_GLYPH[item.kind] ?? "•"}
        </span>
        <span
          aria-hidden="true"
          className="mt-1 w-px flex-1 bg-border last:hidden"
        />
      </div>

      <div className="min-w-0 flex-1 pt-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-card-foreground">
            {item.label}
          </span>
          <ProvenanceBadge storedValue={item.provenance} />
        </div>

        {KIND_MEANING[item.kind] !== undefined && (
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
            {KIND_MEANING[item.kind]}
          </p>
        )}

        <p className="mt-1 font-mono text-[11px] text-muted-foreground">
          {item.occurredAt ?? "No timestamp recorded"}
        </p>

        <p className="font-mono text-[11px] break-all text-muted-foreground/70">
          {item.subjectId}
        </p>

        {item.details.length > 0 && (
          <ul className="mt-2 flex flex-col gap-0.5 border-l border-border pl-3">
            {item.details.map((line) => (
              <li
                key={line}
                className="text-xs leading-5 text-muted-foreground"
              >
                {line}
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

export function EvidenceRail({
  timeline,
}: {
  readonly timeline: EvidenceTimeline;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <ol className="flex flex-col">
          {timeline.items.map((item, index) => (
            <RailItem
              key={`${item.kind}-${item.subjectId}-${index}`}
              item={item}
            />
          ))}
        </ol>
      </Card>

      {timeline.gaps.length > 0 && (
        <Card tone="muted" data-testid="timeline-gaps">
          <div className="flex flex-wrap items-center gap-2">
            <span
              aria-hidden="true"
              className="font-mono text-sm text-muted-foreground"
            >
              ∅
            </span>
            <FieldLabel>Evidence not captured</FieldLabel>
          </div>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            These are stated as gaps rather than rendered as events, because the
            data was never recorded. PayChaos does not fill a gap with an
            assumption.
          </p>
          <ul className="mt-3 flex flex-col gap-1.5">
            {timeline.gaps.map((gap, index) => (
              <li
                key={`${gap.kind}-${gap.subjectId ?? index}`}
                className="flex flex-wrap items-baseline gap-2 text-xs"
              >
                <span className="font-mono font-semibold text-card-foreground">
                  {gap.label}
                </span>
                {gap.subjectId !== null && (
                  <span className="font-mono text-[11px] break-all text-muted-foreground">
                    {gap.subjectId}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
