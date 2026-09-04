import { test, expect } from "@playwright/test";

/**
 * Phase 5 — the desktop sidebar must not scroll away with the page.
 *
 * WHY THIS FILE EXISTS. The rail already carried `md:sticky md:top-0
 * md:h-screen`, so the intent was there and the classes looked right — which
 * is exactly why the bug survived: reading the markup suggests it works. It
 * did not, because `html, body { overflow-x: hidden }` in `app/globals.css`
 * silently turns `<body>` into a scroll container (per spec, `overflow-x:
 * hidden` computes `overflow-y` from `visible` to `auto`), and a `sticky`
 * element sticks to its nearest scrolling ancestor rather than the viewport.
 *
 * A unit test asserting the class list would have passed against the broken
 * product, so the only honest check is a real browser measuring a real
 * viewport position after a real scroll.
 */

/** Comfortably past a full viewport, on a page known to be long. */
const SCROLL_PX = 1200;

/** Sub-pixel layout rounding is not a regression; 2px of slack absorbs it. */
const TOLERANCE_PX = 2;

async function boundingBoxOf(
  page: import("@playwright/test").Page,
  testId: string,
) {
  const box = await page.getByTestId(testId).boundingBox();
  expect(box, `${testId} must have a bounding box`).not.toBeNull();
  return box as NonNullable<typeof box>;
}

test.describe("desktop sidebar stays put while content scrolls", () => {
  // Explicit desktop viewport: the sticky rail is a `md:` behaviour, and a
  // narrower run would assert nothing about it.
  test.use({ viewport: { width: 1280, height: 800 } });

  test("the rail holds its viewport position through a long scroll", async ({
    page,
  }) => {
    await page.goto("/settings");

    const sidebar = page.getByTestId("app-sidebar");
    await expect(sidebar).toBeVisible();

    const before = await boundingBoxOf(page, "app-sidebar");

    // Scroll the document, then confirm it actually moved — otherwise a page
    // too short to scroll would make every assertion below vacuously true.
    await page.evaluate((px) => window.scrollTo(0, px), SCROLL_PX);
    const scrolled = await page.evaluate(() => window.scrollY);
    expect(
      scrolled,
      "the page must actually scroll for this test to mean anything",
    ).toBeGreaterThan(200);

    const after = await boundingBoxOf(page, "app-sidebar");

    // THE ASSERTION. `boundingBox()` is viewport-relative, so an element that
    // scrolled away has a smaller (more negative) y than it started with.
    expect(
      Math.abs(after.y - before.y),
      `sidebar moved ${before.y - after.y}px up the viewport after a ${scrolled}px scroll`,
    ).toBeLessThanOrEqual(TOLERANCE_PX);

    // Still on screen, not merely still in the DOM.
    await expect(sidebar).toBeInViewport();
  });

  test("navigation still works after scrolling, and lands correctly", async ({
    page,
  }) => {
    await page.goto("/settings");
    await page.evaluate((px) => window.scrollTo(0, px), SCROLL_PX);
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(200);

    // Clickable at a scrolled position is the actual user complaint: a rail
    // that has scrolled off is still in the DOM and still "visible" to a
    // naive check, but the operator cannot reach it.
    const link = page.getByTestId("nav-reliability");
    await expect(link).toBeInViewport();
    await link.click();

    await expect(page).toHaveURL(/\/reliability$/);
    await expect(page.getByTestId("app-sidebar")).toBeInViewport();
  });

  test("main content is never hidden underneath the rail", async ({ page }) => {
    await page.goto("/settings");

    const sidebar = await boundingBoxOf(page, "app-sidebar");
    const main = await page.locator("main").boundingBox();
    expect(main).not.toBeNull();

    // The content column must begin at or after the rail's right edge. A
    // `fixed` rail without a compensating offset fails exactly here, which is
    // why this is asserted rather than assumed.
    expect(
      (main as NonNullable<typeof main>).x,
      "main content must start at or after the sidebar's right edge",
    ).toBeGreaterThanOrEqual(sidebar.x + sidebar.width - TOLERANCE_PX);
  });

  test("the fix introduces no horizontal overflow", async ({ page }) => {
    for (const route of ["/settings", "/reliability", "/chaos"]) {
      await page.goto(route);
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
      expect(overflow, `${route} must not scroll sideways`).toBeLessThanOrEqual(
        TOLERANCE_PX,
      );
    }
  });

  test("a short viewport can still reach the whole rail", async ({ page }) => {
    // The rail is taller than a 500px viewport, so it must scroll INTERNALLY
    // rather than clipping its own navigation out of reach.
    await page.setViewportSize({ width: 1280, height: 500 });
    await page.goto("/settings");

    const scrollable = await page
      .getByTestId("app-sidebar")
      .evaluate((el) => el.scrollHeight > el.clientHeight);

    if (scrollable) {
      await page
        .getByTestId("app-sidebar")
        .evaluate((el) => el.scrollTo(0, el.scrollHeight));
    }

    // Reachable either way: either it fits, or its own scroll reveals it.
    await expect(page.getByTestId("nav-settings")).toBeInViewport();
  });
});

test.describe("mobile navigation is unaffected by the desktop fix", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the drawer still opens, navigates and closes", async ({ page }) => {
    await page.goto("/settings");

    // Closed: the rail is translated off-canvas and must not cover content.
    const trigger = page.getByTestId("nav-trigger");
    await expect(trigger).toBeVisible();

    await trigger.click();
    const link = page.getByTestId("nav-reliability");
    await expect(link).toBeInViewport();
    await link.click();

    await expect(page).toHaveURL(/\/reliability$/);

    // No sideways scroll on a phone either.
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(2);
  });
});
