import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ReadinessOverview } from "@/components/reliability/readiness-overview";
import {
  READINESS_DISCLAIMER,
  READINESS_GATE_IDS,
} from "@/lib/readiness/types";

import type { GoLiveReadinessV1 } from "@/lib/readiness/types";

/**
 * Phase 4G — what the Go-Live Readiness panel actually SHOWS (P4-AC-13/14).
 *
 * Rendered with `react-dom/server`, matching the Phase 4F component test; no
 * new testing framework is introduced. The assertions are semantic, never
 * about CSS: an operator must be able to read the status, every reason it was
 * reached, and the state of every gate — and must not be able to mistake an
 * unverified gate for a passing one, or the assessment for a certification.
 *
 * The fixture is FIXED rather than live, so the presentation contract stays
 * proven while the database legitimately changes.
 */

function readiness(
  overrides: Partial<GoLiveReadinessV1> = {},
): GoLiveReadinessV1 {
  return {
    version: "GO-LIVE-READINESS-V1",
    status: "NEEDS ATTENTION",
    blockingReasons: [],
    attentionReasons: [
      {
        code: "NA_SCORE_BELOW_100",
        subject: null,
        text: "The Reliability Score is below 100.",
      },
      {
        code: "NA_REQUIRED_VERIFICATION_INCOMPLETE",
        subject: "BUILD_VERIFICATION",
        text: "A required verification step is not complete.",
      },
    ],
    gates: READINESS_GATE_IDS.map((gateId) => ({
      gateId,
      state:
        gateId === "TEST_MODE_SECURITY"
          ? ("PASS" as const)
          : ("UNKNOWN" as const),
      detail: `Detail for ${gateId}.`,
    })),
    disclaimer: READINESS_DISCLAIMER,
    ...overrides,
  } as GoLiveReadinessV1;
}

function render(model: GoLiveReadinessV1): string {
  return renderToStaticMarkup(<ReadinessOverview readiness={model} />);
}

describe("readiness panel — the verdict", () => {
  it("1: shows the status verbatim", () => {
    for (const status of ["NOT READY", "NEEDS ATTENTION", "READY"] as const) {
      const html = render(readiness({ status }));
      expect(html, status).toContain(status);
    }
  });

  it("2: shows the algorithm version, so the rule set is identifiable", () => {
    expect(render(readiness())).toContain("GO-LIVE-READINESS-V1");
  });

  it("3: renders every gate in the frozen checklist", () => {
    const html = render(readiness());
    for (const gateId of READINESS_GATE_IDS) {
      expect(html, gateId).toContain(gateId);
    }
  });

  it("4: renders each gate's detail, not just its state", () => {
    const html = render(readiness());
    expect(html).toContain("Detail for TEST_MODE_SECURITY.");
    expect(html).toContain("Detail for MANUAL_VERIFICATION.");
  });
});

describe("readiness panel — it shows WHY", () => {
  it("5: every blocking reason is rendered", () => {
    const html = render(
      readiness({
        status: "NOT READY",
        blockingReasons: [
          {
            code: "NR_MANDATORY_SCENARIO_FAILED",
            subject: "C01",
            text: "A mandatory P0 scenario's current state is FAIL.",
          },
          {
            code: "NR_UNRESOLVED_HIGH_RISK_FINDING",
            subject: "finding-9",
            text: "An unresolved CRITICAL or HIGH P0 finding remains.",
          },
        ],
      }),
    );

    expect(html).toContain(
      "A mandatory P0 scenario&#x27;s current state is FAIL.",
    );
    expect(html).toContain(
      "An unresolved CRITICAL or HIGH P0 finding remains.",
    );
    // The subject is what makes a reason actionable rather than abstract.
    expect(html).toContain("C01");
    expect(html).toContain("finding-9");
  });

  it("6: every attention reason is rendered", () => {
    const html = render(readiness());
    expect(html).toContain("The Reliability Score is below 100.");
    expect(html).toContain("A required verification step is not complete.");
    expect(html).toContain("BUILD_VERIFICATION");
  });

  it("7: a status is never shown without the reasons behind it", () => {
    // A bare verdict with no visible justification is exactly what this
    // project forbids.
    const html = render(
      readiness({
        status: "NOT READY",
        blockingReasons: [
          {
            code: "NR_TEST_MODE_SECURITY_FAILED",
            subject: null,
            text: "Test Mode or security enforcement did not pass.",
          },
        ],
        attentionReasons: [],
      }),
    );

    expect(html).toContain("NOT READY");
    expect(html).toContain("Test Mode or security enforcement did not pass.");
  });

  it("8: an empty reason list renders no empty heading", () => {
    const html = render(
      readiness({
        status: "READY",
        blockingReasons: [],
        attentionReasons: [],
      }),
    );

    expect(html).not.toContain("Blocking reasons");
    expect(html).not.toContain("Attention reasons");
  });
});

describe("readiness panel — UNKNOWN is never dressed up", () => {
  it("9: an UNKNOWN gate reads as unverified, not as passing", () => {
    const html = render(readiness());
    expect(html).toContain("Not verified by the current runtime evidence");
  });

  it("10: an UNKNOWN gate is never labelled PASS or FAILED", () => {
    // Every gate but TEST_MODE_SECURITY is UNKNOWN in this fixture, so exactly
    // one PASS badge may appear and no FAILED badge at all.
    const html = render(readiness());

    expect(html.match(/>PASS</g) ?? []).toHaveLength(1);
    expect(html).not.toContain(">FAILED<");
  });

  it("11: a genuinely failed gate is labelled FAILED", () => {
    const html = render(
      readiness({
        gates: READINESS_GATE_IDS.map((gateId) => ({
          gateId,
          state:
            gateId === "TEST_MODE_SECURITY"
              ? ("FAIL" as const)
              : ("UNKNOWN" as const),
          detail: "d",
        })),
      }),
    );

    expect(html).toContain(">FAILED<");
  });
});

describe("readiness panel — NOT A CERTIFICATION", () => {
  it("12: the frozen disclaimer is always rendered, in every status", () => {
    for (const status of ["NOT READY", "NEEDS ATTENTION", "READY"] as const) {
      const html = render(readiness({ status }));
      expect(html, status).toContain(
        "is an engineering assessment from the implemented PayChaos test suite",
      );
      expect(html, status).toContain("It is not Razorpay certification.");
    }
  });

  it("13: the panel never claims approval, certification or guaranteed safety", () => {
    const html = render(readiness({ status: "READY" })).toLowerCase();

    for (const claim of [
      "certified",
      "approved for production",
      "guaranteed",
      "safe for production",
      "production ready",
      "razorpay approved",
    ]) {
      expect(html, claim).not.toContain(claim);
    }
  });

  it("14: READY is still framed as an assessment, not an authorisation", () => {
    const html = render(readiness({ status: "READY" }));
    expect(html).toContain("not an approval");
  });

  it("15: the disclaimer is taken from the model, never paraphrased locally", () => {
    // A screen must not be able to soften the wording.
    const html = render(
      readiness({
        disclaimer:
          "SENTINEL DISCLAIMER TEXT" as GoLiveReadinessV1["disclaimer"],
      }),
    );
    expect(html).toContain("SENTINEL DISCLAIMER TEXT");
  });
});
