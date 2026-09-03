import { test, expect } from "@playwright/test";

/**
 * Phase 5 UI — responsive verification.
 *
 * The rule this pins: the DOCUMENT must never scroll sideways. Wide technical
 * tables and code may scroll inside their own container, but a page that
 * scrolls horizontally on a phone is broken, and it is the single most common
 * way a "responsive" dashboard turns out not to be.
 */
const WIDTHS = [375, 390, 430, 768, 820, 1024, 1280, 1440, 1920];
const ROUTES = [
  "/",
  "/demo-merchant",
  "/chaos",
  "/findings",
  "/reliability",
  "/settings",
];

test.describe("responsive — no horizontal page overflow", () => {
  test.slow();

  for (const width of WIDTHS) {
    test(`viewport ${width}px has no document overflow`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });

      for (const route of ROUTES) {
        await page.goto(route, { timeout: 120_000 });
        await page.waitForLoadState("domcontentloaded");

        const overflow = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));

        expect(
          overflow.scrollWidth,
          `${route} at ${width}px overflows: ${overflow.scrollWidth} > ${overflow.clientWidth}`,
        ).toBeLessThanOrEqual(overflow.clientWidth + 1);
      }
    });
  }
});

test.describe("responsive — mobile navigation is a drawer, not a strip", () => {
  test.slow();

  test("the rail is off-canvas on a phone and opens on demand", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");

    const trigger = page.getByTestId("nav-trigger");
    await expect(trigger).toBeVisible();

    // Closed: the panel must reserve NO usable width, or a phone loses a
    // quarter of its viewport to navigation that is not being used.
    const sidebar = page.getByTestId("app-sidebar");
    const closed = await sidebar.boundingBox();
    expect(closed, "the rail must exist even when closed").not.toBeNull();
    expect(closed!.x + closed!.width).toBeLessThanOrEqual(1);

    // Open: it slides fully into view and the nav becomes reachable.
    // Polled, because the panel animates for 200ms and a link is visible
    // before the transform settles — measuring instantly would assert on a
    // mid-slide frame rather than on the open state.
    await trigger.click();
    await expect(page.getByTestId("nav-findings")).toBeVisible();
    await expect
      .poll(async () => (await sidebar.boundingBox())?.x ?? -999)
      .toBeGreaterThanOrEqual(-1);

    // Escape closes it again, fully.
    await page.keyboard.press("Escape");
    await expect
      .poll(async () => {
        const box = await sidebar.boundingBox();
        return box === null ? 0 : box.x + box.width;
      })
      .toBeLessThanOrEqual(1);
  });

  test("following a link closes the drawer", async ({ page }) => {
    // REGRESSION GUARD. The close-on-navigate handler was wired to a prop
    // that silently never reached the markup, so the panel stayed open over
    // the page the operator had just asked for. Escape still worked, which is
    // exactly why the first version of this suite did not catch it.
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");

    await page.getByTestId("nav-trigger").click();
    const findings = page.getByTestId("nav-findings");
    await expect(findings).toBeVisible();

    await findings.click();
    await page.waitForURL(/\/findings$/, { timeout: 120_000 });

    const sidebar = page.getByTestId("app-sidebar");
    await expect
      .poll(async () => {
        const box = await sidebar.boundingBox();
        return box === null ? 0 : box.x + box.width;
      })
      .toBeLessThanOrEqual(1);
  });

  test("the rail is persistent on a desktop viewport", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");

    // No trigger, and navigation is visible without any interaction.
    await expect(page.getByTestId("nav-trigger")).toBeHidden();
    await expect(page.getByTestId("nav-findings")).toBeVisible();
  });
});
