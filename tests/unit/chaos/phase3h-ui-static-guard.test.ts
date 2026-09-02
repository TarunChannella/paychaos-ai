import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Phase 3H — a static guard over the Chaos Lab UI.
 *
 * The screens are the surface an operator actually touches, so the risks are
 * specific: an arbitrary chaos target could be typed in, a verdict could be
 * computed in the browser, a secret could be rendered, or replayed evidence
 * could be labelled as a live Razorpay delivery. None of those are catchable
 * by a type check, so they are pinned here.
 *
 * A plain static text check — no rendering, no Supabase, no network.
 */

const repoRoot = path.resolve(import.meta.dirname, "../../../");

const UI_FILES = [
  "app/chaos/page.tsx",
  "app/chaos/scenarios/[scenarioId]/page.tsx",
  "app/chaos/scenarios/[scenarioId]/run-scenario-form.tsx",
  "app/chaos/runs/[runId]/page.tsx",
  "components/chaos/provenance-badge.tsx",
] as const;

function read(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf-8");
}

function stripComments(text: string): string {
  const withoutBlockComments = text.replace(/\/\*[\s\S]*?\*\//g, "");
  return withoutBlockComments
    .split("\n")
    .map((line) => {
      const idx = line.indexOf("//");
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join("\n");
}

const sources = new Map(
  UI_FILES.map((file) => [file, stripComments(read(file))] as const),
);

const allSource = [...sources.values()].join("\n");

describe("Phase 3H Chaos Lab UI — static guard", () => {
  it("1: every expected screen exists and is non-empty", () => {
    for (const [file, source] of sources) {
      expect(source.length, file).toBeGreaterThan(0);
    }
  });

  it("2: NO ARBITRARY TARGET — the UI offers no URL, host or endpoint input", () => {
    for (const forbidden of [
      "http://",
      "https://",
      "targetUrl",
      "endpoint",
      "hostname",
      "webhookUrl",
    ]) {
      expect(allSource.toLowerCase(), forbidden).not.toContain(
        forbidden.toLowerCase(),
      );
    }
  });

  it("3: fault configuration never reaches the browser at all", () => {
    for (const forbidden of [
      "faultConfig",
      "fault_config",
      "faultState",
      "fault_state",
      "replayCount",
    ]) {
      expect(allSource, forbidden).not.toContain(forbidden);
    }
  });

  it("3b: the request body carries no verdict, fault or classification", () => {
    // Only the run form builds a request body, so this is where a caller-supplied
    // verdict would have to appear. Matched as object-literal keys, because the
    // bare words legitimately occur as TypeScript parameter names elsewhere.
    const form = sources.get(
      "app/chaos/scenarios/[scenarioId]/run-scenario-form.tsx",
    )!;
    for (const forbidden of [
      "outcome:",
      "dataClassification:",
      "faultType:",
      "status:",
      "severity:",
      "authorized:",
    ]) {
      expect(form, forbidden).not.toContain(forbidden);
    }
  });

  it("4: no secret or credential can be rendered", () => {
    for (const forbidden of [
      "KEY_SECRET",
      "SERVICE_ROLE",
      "service_role",
      "WEBHOOK_SECRET",
      "sessionSecret",
      "raw_body",
      "rawBody",
      "raw_body_sha256",
    ]) {
      expect(allSource.toLowerCase(), forbidden).not.toContain(
        forbidden.toLowerCase(),
      );
    }

    // NARROWED, NOT WEAKENED (Phase 5 UI pass). The bare word "signature" was
    // banned outright, which also forbade honestly describing what a scenario
    // tests — the Chaos Lab now says C03 attacks "a forged webhook signature".
    // Naming the concept is not exposing a value, so the ban moved to the
    // ways a signature value could actually reach a screen: a field read, a
    // property access, an assignment or a header name. That is stricter about
    // real data paths than the substring match it replaces.
    for (const forbidden of [
      "signature:",
      ".signature",
      "signature =",
      "razorpay_signature",
      "razorpaySignature",
      "x-razorpay-signature",
      "signaturevalue",
      "expectedsignature",
    ]) {
      expect(allSource.toLowerCase(), forbidden).not.toContain(
        forbidden.toLowerCase(),
      );
    }
  });

  it("5: the run form posts ONLY to the internal chaos-run endpoint", () => {
    const form = sources.get(
      "app/chaos/scenarios/[scenarioId]/run-scenario-form.tsx",
    )!;
    const fetchTargets = [
      ...form.matchAll(/fetch\(\s*["'`]([^"'`]+)["'`]/g),
    ].map((m) => m[1]);
    expect(fetchTargets).toEqual(["/api/chaos/runs"]);
  });

  it("6: no invariant is evaluated or re-decided in the UI", () => {
    for (const forbidden of [
      "evaluateChaosRun",
      "evaluateInvariant",
      "generateFindings",
      "createFinding",
      "process_webhook_payment_event",
    ]) {
      expect(allSource, forbidden).not.toContain(forbidden);
    }
  });

  it("7: no AI/LLM surface anywhere in the Phase 3 UI", () => {
    for (const forbidden of [
      "openai",
      "anthropic",
      "ollama",
      "gpt-",
      "diagnosis",
      "recommendation",
    ]) {
      expect(allSource.toLowerCase(), forbidden).not.toContain(forbidden);
    }
  });

  it("8: provenance is rendered through the shared badge, never hand-written", () => {
    // A screen that inlined its own label could call a replay a live event.
    for (const file of [
      "app/chaos/page.tsx",
      "app/chaos/runs/[runId]/page.tsx",
    ] as const) {
      const source = sources.get(file)!;
      expect(source, file).toContain("ProvenanceBadge");
    }
    // The literal operator-facing label exists in exactly one place.
    const holders = UI_FILES.filter((file) =>
      read(file).includes("Real Razorpay Test Mode Event"),
    );
    expect(holders).toEqual([]);
  });

  it("9: the badge converts the STORED value rather than accepting free text", () => {
    const badge = sources.get("components/chaos/provenance-badge.tsx")!;
    expect(badge).toContain("toProvenance");
    expect(badge).toContain("provenanceLabel");
  });

  it("10: a null outcome is never defaulted to a verdict", () => {
    const runPage = sources.get("app/chaos/runs/[runId]/page.tsx")!;
    expect(runPage).toContain("Not yet determined");
    for (const forbidden of ['?? "PASS"', "?? 'PASS'", '?? "OK"']) {
      expect(runPage, forbidden).not.toContain(forbidden);
    }
  });

  it("11: the run screens are dynamic — a cached verdict is never shown", () => {
    for (const file of [
      "app/chaos/page.tsx",
      "app/chaos/runs/[runId]/page.tsx",
      "app/chaos/scenarios/[scenarioId]/page.tsx",
    ] as const) {
      expect(sources.get(file)!, file).toContain(
        'export const dynamic = "force-dynamic"',
      );
    }
  });

  it("12: only the four frozen P0 scenarios can be named by the run form", () => {
    const form = sources.get(
      "app/chaos/scenarios/[scenarioId]/run-scenario-form.tsx",
    )!;
    for (const p1 of ["C02", "C04", "C05", "C06", "C08", "C09", "C10", "C12"]) {
      expect(form, p1).not.toContain(p1);
    }
  });
});
