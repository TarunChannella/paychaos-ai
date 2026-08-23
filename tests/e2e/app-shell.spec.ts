import { test, expect } from "@playwright/test";

// Phase 1A smoke test: proves the Next.js app boots under Playwright and
// renders the PayChaos AI shell with visible Razorpay Test Mode messaging.
// No Demo Merchant flow exists yet (Phase 1E introduces that).
test("app shell boots and identifies itself as PayChaos AI in Test Mode", async ({
  page,
}) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: /PayChaos AI/i }),
  ).toBeVisible();

  await expect(page.getByText(/Razorpay Test Mode/i).first()).toBeVisible();
});
