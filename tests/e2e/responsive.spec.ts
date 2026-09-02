import { test, expect, devices } from "@playwright/test";

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
