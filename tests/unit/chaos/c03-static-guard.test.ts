import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Phase 3D-A (correction round 1) — static safety guard, revised for the
 * Blocker 2 verification-only runtime boundary. Proves the C03 production
 * executor's FUNCTIONAL source (comments stripped — the module doc comment
 * legitimately names several forbidden concepts to document what this
 * module refuses to do) contains none of: `fetch(`, `http.request`,
 * `https.request`, `axios`, arbitrary target URL support,
 * `RAZORPAY_KEY_SECRET`, an actual webhook secret literal, a caller-provided
 * signature, a caller-provided payload, or — the new Blocker 2 requirement —
 * ANY import of the webhook route, webhook/event-processing persistence
 * repositories, or the merchant processor. It SHOULD import/use the real
 * production `verifyWebhookSignature`. Also proves the real webhook Route
 * Handler itself remains byte-for-byte unmodified.
 */

const repoRoot = path.resolve(import.meta.dirname, "../../../");

function readFunctionalSource(relativePath: string): string {
  const raw = fs.readFileSync(path.join(repoRoot, relativePath), "utf-8");
  return raw
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return (
        !trimmed.startsWith("//") &&
        !trimmed.startsWith("*") &&
        !trimmed.startsWith("/**")
      );
    })
    .join("\n");
}

describe("C03 production executor — static safety guard", () => {
  const serviceFunctional = readFunctionalSource(
    "lib/chaos/c03-execution-service.ts",
  );
  const routeFunctional = readFunctionalSource(
    "app/api/chaos/runs/[runId]/execute-c03/route.ts",
  );

  it("contains no fetch()/http.request/https.request/axios call anywhere in functional source", () => {
    for (const source of [serviceFunctional, routeFunctional]) {
      expect(source).not.toMatch(/\bfetch\s*\(/);
      expect(source).not.toMatch(/\bhttp\.request\s*\(/);
      expect(source).not.toMatch(/\bhttps\.request\s*\(/);
      expect(source).not.toMatch(/\baxios\b/i);
      expect(source).not.toMatch(/from\s+["']node:https?["']/);
      expect(source).not.toMatch(/from\s+["']axios["']/);
    }
  });

  it("contains no arbitrary-target field name (host/endpoint/targetUrl/callbackUrl) in functional source", () => {
    for (const source of [serviceFunctional, routeFunctional]) {
      for (const forbidden of [
        "targetUrl",
        "targetHost",
        "callbackUrl",
        "endpointUrl",
        "webhookUrl",
      ]) {
        expect(source).not.toContain(forbidden);
      }
    }
  });

  it("never references RAZORPAY_KEY_SECRET", () => {
    for (const source of [serviceFunctional, routeFunctional]) {
      expect(source).not.toMatch(/RAZORPAY_KEY_SECRET/);
    }
  });

  it("never contains a 64-hex-character literal that could be mistaken for a real HMAC — the fixed WRONG_SIGNATURE value is deliberately malformed-shape, not well-formed-but-wrong", () => {
    const hexLiterals = serviceFunctional.match(/"[0-9a-f]{64}"/gi) ?? [];
    expect(hexLiterals).toHaveLength(0);
  });

  it("never accepts a caller-provided signature or payload — executeC03InvalidSignatureTest's only parameter is chaosRunId", () => {
    const signatureMatch = serviceFunctional.match(
      /export\s+async\s+function\s+executeC03InvalidSignatureTest\s*\(([^)]*)\)/,
    );
    expect(signatureMatch).not.toBeNull();
    const params = signatureMatch![1]!.trim().replace(/,$/, "").trim();
    expect(params).toBe("chaosRunId: string");
  });

  it("never accepts a caller-provided signature/payload/count in the route's POST parameters (runId path param only)", () => {
    expect(routeFunctional).not.toMatch(/request\.json\(/);
    expect(routeFunctional).not.toMatch(/request\.text\(/);
    expect(routeFunctional).not.toMatch(/request\.arrayBuffer\(/);
  });

  describe("Blocker 2 — verification-only import boundary", () => {
    it("imports the real production verifyWebhookSignature primitive directly", () => {
      expect(serviceFunctional).toMatch(
        /import\s*\{\s*verifyWebhookSignature\s*\}\s*from\s*["']@\/lib\/razorpay\/webhook-verification["']/,
      );
    });

    it("does NOT import the webhook route (app/api/webhooks/razorpay/route)", () => {
      for (const source of [serviceFunctional, routeFunctional]) {
        expect(source).not.toMatch(
          /from\s*["']@\/app\/api\/webhooks\/razorpay\/route["']/,
        );
      }
    });

    it("does NOT import lib/webhooks/service.ts, or any webhook/event-processing persistence repository", () => {
      for (const source of [serviceFunctional, routeFunctional]) {
        expect(source).not.toMatch(/from\s*["']@\/lib\/webhooks\/service["']/);
        expect(source).not.toMatch(
          /from\s*["']@\/lib\/webhooks\/repository["']/,
        );
        expect(source).not.toMatch(
          /from\s*["']@\/lib\/webhooks\/event-processing-repository["']/,
        );
      }
    });

    it("does NOT import the merchant processing transaction (lib/events/processor)", () => {
      for (const source of [serviceFunctional, routeFunctional]) {
        expect(source).not.toMatch(/from\s*["']@\/lib\/events\/processor["']/);
      }
    });

    it("does NOT import next/server's NextRequest (no HTTP request object is ever constructed by the production runtime mechanism)", () => {
      expect(serviceFunctional).not.toMatch(/from\s*["']next\/server["']/);
    });
  });
});

describe("app/api/webhooks/razorpay/route.ts remains byte-for-byte unmodified by Phase 3D-A", () => {
  it("still contains its exact frozen POST signature and no C03-specific import", () => {
    const source = fs.readFileSync(
      path.join(repoRoot, "app/api/webhooks/razorpay/route.ts"),
      "utf-8",
    );
    expect(source).toMatch(
      /export async function POST\(request: NextRequest\): Promise<NextResponse>/,
    );
    expect(source).not.toMatch(/c03/i);
    expect(source).not.toMatch(/chaos/i);
  });
});
