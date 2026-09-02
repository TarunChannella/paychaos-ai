import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { EvidenceRail } from "@/components/chaos/evidence-rail";

import type { EvidenceTimeline } from "@/lib/evidence/timeline-model";

/**
 * Phase 5 UI — the evidence rail.
 *
 * The rail renders the EXISTING Phase 3H timeline model. These tests exist to
 * prove it stayed a renderer: one visual item per real item, gaps still
 * explicit, and no invented stage filling the space where evidence is
 * missing. A timeline that quietly completes itself is worse than no timeline.
 */

const TIMELINE = {
  items: [
    {
      kind: "SOURCE_WEBHOOK",
      subjectId: "evt_abc",
      occurredAt: "2026-09-01T00:00:00.000Z",
      provenance: "REAL_RAZORPAY_WEBHOOK",
      label: "Source webhook event",
      details: ["payment.captured"],
    },
    {
      kind: "PAYCHAOS_REPLAY_ATTEMPT",
      subjectId: "att_1",
      occurredAt: "2026-09-01T00:01:00.000Z",
      provenance: "PAYCHAOS_REPLAY",
      label: "PayChaos replay attempt",
      details: [],
    },
    {
      kind: "INVARIANT_EVALUATED",
      subjectId: "res_1",
      occurredAt: null,
      provenance: "PAYCHAOS_REPLAY",
      label: "INV-002 evaluated — FAIL",
      details: [],
    },
  ],
  gaps: [
    {
      kind: "NOT_CAPTURED",
      code: "STATE_SNAPSHOT_MISSING",
      subjectId: "att_1",
      label: "STATE_SNAPSHOT_MISSING",
    },
  ],
} as unknown as EvidenceTimeline;

function render(timeline: EvidenceTimeline): string {
  return renderToStaticMarkup(<EvidenceRail timeline={timeline} />);
}

describe("evidence rail — it renders the model, nothing more", () => {
  it("1: one visual item per real timeline item", () => {
    const markup = render(TIMELINE);
    const items = markup.match(/data-testid="timeline-item"/g) ?? [];
    expect(items).toHaveLength(TIMELINE.items.length);
  });

  it("2: each item shows its persisted label and subject", () => {
    const markup = render(TIMELINE);

    expect(markup).toContain("Source webhook event");
    expect(markup).toContain("PayChaos replay attempt");
    expect(markup).toContain("INV-002 evaluated — FAIL");
    expect(markup).toContain("evt_abc");
  });

  it("3: a missing timestamp says so rather than inventing one", () => {
    expect(render(TIMELINE)).toContain("No timestamp recorded");
  });

  it("4: evidence gaps stay explicit", () => {
    const markup = render(TIMELINE);

    expect(markup).toContain('data-testid="timeline-gaps"');
    expect(markup).toContain("Evidence not captured");
    expect(markup).toContain("STATE_SNAPSHOT_MISSING");
    expect(markup).toContain("PayChaos does not fill a gap with an assumption");
  });

  it("5: a gap is never rendered as a timeline item", () => {
    // The decisive property: absence must not be drawn as an event.
    const markup = render(TIMELINE);
    const gapsBlock = markup.slice(markup.indexOf("timeline-gaps"));
    expect(gapsBlock).not.toContain('data-testid="timeline-item"');
  });

  it("6: a timeline with no gaps renders no gap block", () => {
    const markup = render({
      ...TIMELINE,
      gaps: [],
    } as unknown as EvidenceTimeline);

    expect(markup).not.toContain('data-testid="timeline-gaps"');
  });

  it("7: it builds no timeline of its own", () => {
    const source = readFileSync(
      join(process.cwd(), "components", "chaos", "evidence-rail.tsx"),
      "utf8",
    );
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split(String.fromCharCode(10))
      .filter((line) => !line.trimStart().startsWith("//"))
      .join(String.fromCharCode(10));

    for (const forbidden of [
      "buildEvidenceTimeline",
      "getSupabaseServerClient",
      ".sort(",
      ".filter(",
      "new Date(",
      "Date.now(",
      "setInterval",
      "setTimeout",
      "useEffect",
    ]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });
});
