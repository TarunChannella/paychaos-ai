import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Phase 1E — consolidated structural security proofs (docs instructions
 * Section 21). These are static source-text assertions (same pattern as
 * tests/unit/supabase/migration.test.ts and tests/unit/supabase/server.test.ts),
 * complementing the behavioral proofs in repository.test.ts / service.test.ts
 * / actions.test.ts.
 */

const repoRoot = path.resolve(import.meta.dirname, "../../../");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf-8");
}

describe("21A — server persistence module has a structural server-only boundary", () => {
  it("lib/demo-merchant/repository.ts imports server-only directly", () => {
    expect(read("lib/demo-merchant/repository.ts")).toMatch(
      /^import\s+["']server-only["'];/m,
    );
  });

  it("lib/demo-merchant/service.ts imports server-only directly", () => {
    expect(read("lib/demo-merchant/service.ts")).toMatch(
      /^import\s+["']server-only["'];/m,
    );
  });
});

describe("21C/21D — the create-order Server Action accepts no browser-controllable field", () => {
  const actionsSource = read("app/demo-merchant/actions.ts");

  it("'use server' is isolated to the top of actions.ts", () => {
    expect(actionsSource).toMatch(/^"use server";/);
  });

  it("createDemoMerchantOrderAction is declared with an empty parameter list", () => {
    expect(actionsSource).toMatch(
      /export async function createDemoMerchantOrderAction\(\s*\)/,
    );
  });

  it("the action's actual code (outside its explanatory doc comment) never references payment_status/business_status as a value it accepts", () => {
    // The leading doc comment deliberately NAMES these fields to explain
    // why they are absent as accepted input — check only the real code
    // after that comment block, not the prose explaining the omission.
    const codeAfterLeadingComment = actionsSource.slice(
      actionsSource.indexOf("*/") + 2,
    );
    for (const forbidden of [
      "payment_status",
      "business_status",
      "paymentStatus",
      "businessStatus",
    ]) {
      expect(codeAfterLeadingComment).not.toContain(forbidden);
    }
  });
});

describe("21D — order creation uses only the fixed, server-owned product (no client-supplied money terms)", () => {
  it("lib/demo-merchant/service.ts's createDemoMerchantOrder reads DEMO_MERCHANT_PRODUCT, not a function parameter", () => {
    const serviceSource = read("lib/demo-merchant/service.ts");
    expect(serviceSource).toMatch(
      /export async function createDemoMerchantOrder\(\s*\)/,
    );
    expect(serviceSource).toMatch(/DEMO_MERCHANT_PRODUCT\.amountSubunits/);
    expect(serviceSource).toMatch(/DEMO_MERCHANT_PRODUCT\.currency/);
  });
});

describe("21E — existing Phase 1C anon-denial tests remain untouched", () => {
  it("tests/integration/supabase/04-anon-rls.integration.test.ts still exists", () => {
    expect(
      fs.existsSync(
        path.join(
          repoRoot,
          "tests/integration/supabase/04-anon-rls.integration.test.ts",
        ),
      ),
    ).toBe(true);
  });
});
