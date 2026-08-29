import { describe, expect, it } from "vitest";

import {
  provenanceLabel,
  type ProvenanceTone,
} from "@/lib/evidence/provenance-label";
import {
  toProvenance,
  type TimelineProvenance,
} from "@/lib/evidence/timeline-model";

/**
 * Phase 3H — CLAUDE.md Section 24 requires every displayed event to be
 * truthfully classified. These tests pin the ONE property that matters most:
 * nothing PayChaos generated may ever be described as a live Razorpay event.
 */

const ALL: readonly TimelineProvenance[] = [
  "REAL_RAZORPAY_WEBHOOK",
  "PAYCHAOS_REPLAY",
  "RECORDED_TEST_EVIDENCE",
  "SYNTHETIC_DEMO",
  "UNRECOGNISED",
];

describe("Phase 3H provenance labelling", () => {
  it("1: the mapping is total — every provenance value has a label", () => {
    for (const provenance of ALL) {
      const label = provenanceLabel(provenance);
      expect(label.label, provenance).toBeTruthy();
      expect(label.description, provenance).toBeTruthy();
    }
  });

  it("2: ONLY a genuine Razorpay delivery is marked as a real Razorpay event", () => {
    const real = ALL.filter((p) => provenanceLabel(p).isRealRazorpayEvent);
    expect(real).toEqual(["REAL_RAZORPAY_WEBHOOK"]);
  });

  it("3: ONLY a genuine Razorpay delivery carries the AUTHENTIC tone", () => {
    const authentic = ALL.filter(
      (p) => provenanceLabel(p).tone === "AUTHENTIC",
    );
    expect(authentic).toEqual(["REAL_RAZORPAY_WEBHOOK"]);
  });

  it("4: every tone is distinct, so two classifications never look alike", () => {
    const tones = ALL.map((p) => provenanceLabel(p).tone);
    expect(new Set<ProvenanceTone>(tones).size).toBe(ALL.length);
  });

  it("5: replayed and recorded evidence never claim Razorpay SENT it", () => {
    // The words must actively disclaim a live delivery, not merely omit it.
    expect(provenanceLabel("PAYCHAOS_REPLAY").description).toContain(
      "Razorpay did not send this",
    );
    expect(provenanceLabel("RECORDED_TEST_EVIDENCE").description).toContain(
      "Not a live delivery",
    );
  });

  it("6: synthetic demo data says it represents no real payment", () => {
    const label = provenanceLabel("SYNTHETIC_DEMO");
    expect(label.label).toContain("Synthetic");
    expect(label.description).toContain("no real payment");
  });

  it("7: an unrecognised stored value is surfaced, never guessed into a bucket", () => {
    const label = provenanceLabel(toProvenance("SOMETHING_NEW"));
    expect(label.tone).toBe("UNKNOWN");
    expect(label.isRealRazorpayEvent).toBe(false);
    expect(label.label).toContain("Unrecognised");
  });

  it("8: an unknown value is NOT quietly promoted to a real Razorpay event", () => {
    for (const rogue of [
      "REAL_RAZORPAY",
      "real_razorpay_webhook",
      "LIVE",
      "",
      "PAYCHAOS_SIMULATION",
    ]) {
      expect(
        provenanceLabel(toProvenance(rogue)).isRealRazorpayEvent,
        rogue,
      ).toBe(false);
    }
  });

  it("9: no label markets the result or states a verdict", () => {
    for (const provenance of ALL) {
      const text =
        `${provenanceLabel(provenance).label} ${provenanceLabel(provenance).description}`.toLowerCase();
      for (const forbidden of ["pass", "fail", "safe", "secure", "healthy"]) {
        expect(text, `${provenance} :: ${forbidden}`).not.toContain(forbidden);
      }
    }
  });
});
