import { test, expect } from "@playwright/test";

/**
 * Phase 5 — the interactive-demo unlock flow, end to end.
 *
 * IT SKIPS WHEN THE GATE IS OFF, RATHER THAN PASSING VACUOUSLY.
 *
 * The access gate is disabled by default for trusted local development, which
 * is correct — and it means every action there is granted, so these
 * assertions would pass forever without exercising a single line of the gate.
 * A green tick for a control that never ran is worse than a skip.
 *
 * I tried running a second app instance with the gate enabled so this could
 * always be real. `next dev` refuses to start twice from one directory
 * ("Another next dev server is already running"), and forcing it would have
 * broken the entire suite — so the honest arrangement is this: the spec
 * detects the live gate state and states plainly when it did not run.
 *
 * In a gated environment (PAYCHAOS_ACCESS_GATE=enabled with a real code
 * supplied as PAYCHAOS_E2E_ACCESS_CODE) every assertion below executes.
 */

/** Never hardcoded: supplied by the environment running a gated instance. */
const TEST_CODE = process.env.PAYCHAOS_E2E_ACCESS_CODE ?? "";

/** The gate is on if an unauthenticated mutation is actually refused. */
async function gateIsEnabled(request: {
  post: (
    url: string,
    init: { data: unknown },
  ) => Promise<{ status: () => number }>;
}): Promise<boolean> {
  const response = await request.post("/api/demo/reset", { data: {} });
  return response.status() === 401 || response.status() === 403;
}

test.describe("interactive demo unlock", () => {
  test.slow();

  test("a visitor reads freely, is stopped at a state change, and unlocks once", async ({
    page,
    request,
  }) => {
    test.skip(
      !(await gateIsEnabled(request)),
      "Access gate is disabled in this environment, so the unlock flow cannot be exercised.",
    );
    test.skip(
      TEST_CODE.length === 0,
      "PAYCHAOS_E2E_ACCESS_CODE is not set, so the correct-code path cannot be exercised.",
    );
    // 1. Read-only exploration is public: no code, no redirect.
    await page.goto("/demo-merchant");
    await expect(page).toHaveURL(/\/demo-merchant$/);
    await expect(page.getByTestId("fixed-product-price")).toBeVisible();

    // Other product surfaces are readable too.
    for (const route of ["/", "/chaos", "/findings", "/reliability"]) {
      await page.goto(route);
      await expect(page).toHaveURL(
        new RegExp(`${route === "/" ? "/" : route}$`),
      );
    }

    // 2 & 3. A protected action opens the unlock dialog rather than failing
    // with an unexplained error.
    await page.goto("/demo-merchant");
    await page
      .getByRole("button", { name: /create internal test order/i })
      .click();
    const dialog = page.getByTestId("demo-unlock-dialog");
    await expect(dialog).toBeVisible({ timeout: 60_000 });

    // 4. A wrong code is refused, and says nothing about the real one.
    await page.getByTestId("demo-unlock-input").fill("definitely-not-the-code");
    await page.getByTestId("demo-unlock-submit").click();
    await expect(page.getByTestId("demo-unlock-error")).toHaveText(
      "Invalid Demo Access Code.",
    );
    // Still locked: the dialog is still up.
    await expect(dialog).toBeVisible();

    // 5 & 6. The correct code establishes a session, closes the dialog, and
    // the original action continues on its own.
    await page.getByTestId("demo-unlock-input").fill(TEST_CODE);
    await page.getByTestId("demo-unlock-submit").click();
    await expect(dialog).toBeHidden({ timeout: 60_000 });

    // The order the visitor asked for was actually created, which is the
    // proof that the intent was resumed rather than merely unblocked.
    await expect(page.getByTestId("demo-merchant-order").first()).toBeVisible({
      timeout: 60_000,
    });

    // 7. A SECOND protected action in the same session must not ask again.
    await page.goto("/settings");
    await expect(page.getByTestId("settings-interactive-status")).toHaveText(
      "UNLOCKED",
    );
  });

  test("an unauthenticated state change is refused by the server itself", async ({
    request,
  }) => {
    test.skip(
      !(await gateIsEnabled(request)),
      "Access gate is disabled in this environment.",
    );
    // The dialog is a courtesy; this is the control. A direct POST with no
    // session must be refused whether or not any UI was involved.
    for (const path of [
      "/api/chaos/runs",
      "/api/demo/reset",
      "/api/findings/00000000-0000-4000-8000-000000000000/regressions",
    ]) {
      const response = await request.post(path, { data: {} });
      expect(
        [401, 403].includes(response.status()),
        `${path} returned ${response.status()}`,
      ).toBe(true);
    }
  });

  test("the access code never reaches the browser", async ({ page }) => {
    await page.goto("/settings");

    const html = await page.content();
    if (TEST_CODE.length > 0) expect(html).not.toContain(TEST_CODE);
    expect(html).not.toContain("PAYCHAOS_ACCESS_TOKEN");
    expect(html).not.toContain("PAYCHAOS_SESSION_SECRET");

    // The session cookie must not be readable by script.
    const scriptVisibleCookies = await page.evaluate(() => document.cookie);
    expect(scriptVisibleCookies).not.toContain("paychaos_session");
  });
});
