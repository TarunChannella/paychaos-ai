import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * Phase 5 — the Create Internal Test Order flow.
 *
 * WHY THIS FILE EXISTS. On the deployed Preview, clicking "Create Internal
 * Test Order" replaced the page with the global error boundary. The cause was
 * not the insert and not any Supabase query: middleware answered the Server
 * Action POST with a JSON 401, and React's action client cannot parse that,
 * so the call threw in the browser.
 *
 * Reproduced locally with the access gate enabled, then fixed by removing the
 * page-level challenge. These tests pin the properties whose absence made
 * that possible, so the flow cannot silently regress again.
 */

const ROOT = process.cwd();

function code(path: string): string {
  return readFileSync(join(ROOT, path), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
}

const MIDDLEWARE = code("middleware.ts");
const ACTIONS = code("app/demo-merchant/actions.ts");
const REPOSITORY = code("lib/demo-merchant/repository.ts");
const SERVICE = code("lib/demo-merchant/service.ts");

describe("create order — the Server Action must reach the action", () => {
  it("1: middleware returns only NextResponse.next()", () => {
    // The defect in one line: anything else here is a response React's action
    // client cannot parse, and the page dies instead of the action refusing.
    const responses = [...MIDDLEWARE.matchAll(/NextResponse\.(\w+)/g)].map(
      (m) => m[1],
    );
    expect(responses.length).toBeGreaterThan(0);
    expect(new Set(responses)).toEqual(new Set(["next"]));
  });

  it("2: an unauthorized action returns a RESULT, never a thrown response", () => {
    // The UI can only offer the unlock dialog if the action hands back a
    // value. Throwing would surface as the error boundary again.
    expect(ACTIONS).toContain("return { ok: false, error: denied.error }");
  });
});

describe("create order — what the insert actually writes", () => {
  it("3: the caller cannot set payment or business status", () => {
    // The insert supplies only amount and currency; UNPAID / OPEN come from
    // the database defaults, which is what keeps a freshly created order in
    // a state the projection recognises.
    const start = REPOSITORY.indexOf("export async function insertOrder");
    expect(start).toBeGreaterThan(-1);
    const body = REPOSITORY.slice(start, start + 900);

    expect(body).toContain("amount_subunits");
    expect(body).toContain("currency");
    for (const forbidden of [
      "payment_status:",
      "business_status:",
      "fulfilment",
      "id:",
    ]) {
      expect(body, forbidden).not.toContain(forbidden);
    }
  });

  it("4: creating an order contacts no Razorpay API", () => {
    // Create Internal Test Order is deliberately a local merchant record.
    // A Razorpay call here would make the button fail without network access
    // and would blur the boundary the demo depends on.
    const start = ACTIONS.indexOf(
      "export async function createDemoMerchantOrderAction",
    );
    expect(start).toBeGreaterThan(-1);
    // Bounded at the next export of ANY kind: an `export interface` sits
    // between the two actions, and slicing only to the next `export async
    // function` swept the neighbouring Razorpay types into this body.
    const next = ACTIONS.indexOf("\nexport ", start + 10);
    const body = ACTIONS.slice(start, next === -1 ? undefined : next);

    for (const forbidden of ["razorpay", "Razorpay", "fetch("]) {
      expect(body, forbidden).not.toContain(forbidden);
    }
    expect(body).toContain("createDemoMerchantOrder()");
  });
});

describe("create order — the post-insert re-read is safe", () => {
  it("5: the empty state short-circuits before the joined reads", () => {
    // This is why the page worked until the first order existed: with no
    // rows, the four follow-up reads never ran. Losing this early return
    // would change which queries a first-time visitor triggers.
    const start = SERVICE.indexOf(
      "export async function listDemoMerchantOrders",
    );
    const body = SERVICE.slice(start, start + 700);
    expect(body).toContain("if (rows.length === 0) return [];");
  });

  it("6: every joined read tolerates an empty id list", () => {
    // After the FIRST order there are no attempts and no payments, so two of
    // these are called with []. A PostgREST `in.()` on an empty list is a
    // 400, so each must return before querying.
    for (const fn of [
      "countFulfilmentsForOrderIds",
      "listLatestPaymentAttemptsForOrderIds",
      "listLatestPaymentsForAttemptIds",
    ]) {
      const start = REPOSITORY.indexOf(`export async function ${fn}`);
      expect(start, fn).toBeGreaterThan(-1);
      const next = REPOSITORY.indexOf("export async function", start + 10);
      const body = REPOSITORY.slice(start, next === -1 ? undefined : next);

      expect(body, `${fn} must early-return on an empty list`).toMatch(
        /\.length === 0\) return/,
      );
    }

    const webhooks = code("lib/webhooks/repository.ts");
    const start = webhooks.indexOf(
      "export async function listLatestWebhookEventsForPaymentIds",
    );
    expect(start).toBeGreaterThan(-1);
    expect(webhooks.slice(start, start + 400)).toMatch(
      /\.length === 0\) return/,
    );
  });

  it("7: a read failure still throws rather than returning empty data", () => {
    // Swallowing a read error would render as "no orders" — a false claim
    // about the merchant's money state, and far worse than an error screen.
    const start = REPOSITORY.indexOf("export async function listRecentOrders");
    const next = REPOSITORY.indexOf("export async function", start + 10);
    const body = REPOSITORY.slice(start, next === -1 ? undefined : next);

    expect(body).toContain("logSupabaseReadFailure");
    expect(body).toContain("throw new DemoMerchantRepositoryError");
    expect(body).not.toContain("return [];");
  });
});

describe("create order — a fresh order projects to CREATED", () => {
  it("8: UNPAID + OPEN + 0 fulfilments is a recognised state", async () => {
    // The exact combination the database defaults produce. If the projection
    // rejected it, every first order would blank the page — so this is the
    // assertion that a newly created order is renderable at all.
    const { projectConceptualOrderState } =
      await import("@/lib/demo-merchant/projection");

    expect(
      projectConceptualOrderState({
        paymentStatus: "UNPAID",
        businessStatus: "OPEN",
        fulfilmentCount: 0,
      }),
    ).toBe("CREATED");
  });

  it("9: the database defaults are exactly what the projection expects", () => {
    // Read from the migration, so a schema change that moved the defaults
    // away from UNPAID/OPEN would fail here rather than in production.
    const migration = readFileSync(
      join(
        ROOT,
        "supabase",
        "migrations",
        "20260823000000_phase1_foundation_schema.sql",
      ),
      "utf8",
    );

    expect(migration).toContain(
      "payment_status text not null default 'UNPAID'",
    );
    expect(migration).toContain("business_status text not null default 'OPEN'");
  });
});
