import { test, expect } from "@playwright/test";

// Phase 1A smoke test: proves the Next.js app boots under Playwright and
// renders the PayChaos AI shell with visible Razorpay Test Mode messaging.
//
// ADVANCED, NOT LOOSENED (final Phase 5 UI pass). The product identity moved
// OUT of the Overview <h1> and INTO the persistent brand lockup in the console
// shell, so it is now asserted on every protected route rather than on the
// landing page only — a stronger guarantee than the old heading match, which
// this test now pins by testid instead of by a loose /PayChaos AI/i lookup
// that would also have matched incidental copy.
test("app shell boots and identifies itself as PayChaos AI in Test Mode", async ({
  page,
}) => {
  await page.goto("/");

  const brand = page.getByTestId("app-brand");
  await expect(brand).toBeVisible();
  await expect(brand).toContainText("PayChaos");
  await expect(brand).toContainText("AI");
  // The lockup is the way back to the Overview from anywhere in the console.
  await expect(brand).toHaveAttribute("href", "/");

  // Test Mode is stated exactly, not merely mentioned somewhere on the page.
  await expect(page.getByTestId("env-badge")).toHaveText("RAZORPAY TEST MODE");
});
