/**
 * Phase 3H — operator-facing provenance labelling.
 *
 * CLAUDE.md Section 24 requires every event/result shown in the product to be
 * truthfully classified. This module is the ONLY place a stored provenance
 * value becomes display text, so no screen can invent a friendlier label.
 *
 * The mapping is total over `TimelineProvenance` and deliberately conservative:
 *
 *   - a REPLAY is never described as a Razorpay delivery;
 *   - a RECORDED fixture is never described as live;
 *   - SYNTHETIC demo data says so in plain words;
 *   - an UNRECOGNISED stored value is surfaced AS unrecognised rather than
 *     guessed into one of the known buckets, because a wrong confident label
 *     is worse than an honest "this value is not understood".
 *
 * Pure and synchronous: no clock, no I/O, no database. Everything here is a
 * projection of a value that was already persisted.
 */
import type { TimelineProvenance } from "@/lib/evidence/timeline-model";

/**
 * How strongly a label may be presented.
 *
 * `AUTHENTIC` is reserved for genuine, signature-verified Razorpay Test Mode
 * deliveries. Nothing PayChaos generates can ever carry it.
 */
export type ProvenanceTone =
  "AUTHENTIC" | "REPLAY" | "RECORDED" | "SYNTHETIC" | "UNKNOWN";

export interface ProvenanceLabel {
  /** Short chip text. */
  readonly label: string;
  /** One sentence an operator can act on. Never marketing copy. */
  readonly description: string;
  readonly tone: ProvenanceTone;
  /**
   * `true` only for a genuine Razorpay Test Mode delivery. Screens use this to
   * decide whether "Razorpay" may appear as the actor — never to decide
   * whether a payment is correct.
   */
  readonly isRealRazorpayEvent: boolean;
}

const LABELS: Record<TimelineProvenance, ProvenanceLabel> = {
  REAL_RAZORPAY_WEBHOOK: {
    label: "Real Razorpay Test Mode Event",
    description:
      "A genuine, signature-verified webhook delivered by Razorpay Test Mode.",
    tone: "AUTHENTIC",
    isRealRazorpayEvent: true,
  },
  PAYCHAOS_REPLAY: {
    label: "PayChaos Controlled Replay",
    description:
      "PayChaos re-submitted an already-verified event through the internal processing boundary. Razorpay did not send this.",
    tone: "REPLAY",
    isRealRazorpayEvent: false,
  },
  RECORDED_TEST_EVIDENCE: {
    label: "Recorded Razorpay Test Mode Fixture",
    description:
      "Evidence captured earlier from Razorpay Test Mode and replayed from storage. Not a live delivery.",
    tone: "RECORDED",
    isRealRazorpayEvent: false,
  },
  SYNTHETIC_DEMO: {
    label: "Demo / Synthetic Data",
    description:
      "PayChaos-generated demo data. It represents no real payment and no real Razorpay activity.",
    tone: "SYNTHETIC",
    isRealRazorpayEvent: false,
  },
  UNRECOGNISED: {
    label: "Unrecognised Classification",
    description:
      "The stored classification is not one this build understands. It is shown unlabelled rather than guessed.",
    tone: "UNKNOWN",
    isRealRazorpayEvent: false,
  },
};

/** The label for a provenance value. Total — every variant has an entry. */
export function provenanceLabel(
  provenance: TimelineProvenance,
): ProvenanceLabel {
  return LABELS[provenance];
}
