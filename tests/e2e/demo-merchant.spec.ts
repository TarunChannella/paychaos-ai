import { expect, test } from "@playwright/test";

import { getE2ETestServiceRoleClient } from "./support/service-role-client";

/**
 * Phase 1E — Demo Merchant flow: open app -> navigate to Demo Merchant ->
 * fixed product shown -> create an internal order -> persisted order
 * visible (UNPAID/OPEN/0 fulfilments/CREATED, correct amount/currency) ->
 * no Razorpay Checkout UI is present.
 *
 * This test creates a REAL row in the real Supabase project via the real
 * UI. It captures the created order's ID from the rendered page and
 * deletes exactly that row afterward via a trusted Node-process-only
 * service-role client (tests/e2e/support/service-role-client.ts) — never
 * exposed to the browser or any application route.
 */
test("Demo Merchant: fixed product, create internal order, persisted UNPAID/OPEN/0/CREATED state, no Razorpay Checkout UI", async ({
  page,
}) => {
  // Per-test timeout override only (Phase 2B test-gate correction) — not a
  // change to playwright.config.ts's global test timeout. This machine's
  // current, already-documented severe memory pressure has been observed to
  // push the cold-compile navigation plus the order-creation round trip
  // beyond the default 30s test budget; 60s gives this specific real-DB,
  // real-navigation test enough room without loosening any other spec.
  test.setTimeout(60_000);

  let createdOrderId: string | undefined;

  try {
    await page.goto("/");
    await page.getByRole("link", { name: /demo merchant/i }).click();
    // Extended timeout (Phase 2B test-gate correction): this is the first
    // ever navigation to /demo-merchant in this webServer process, so
    // Next.js dev mode must compile that route on demand. Under this
    // environment's already-documented low-memory conditions that cold
    // compile can exceed Playwright's default 5000ms assertion timeout even
    // though the navigation itself is correct — a hidden timing assumption,
    // not a product defect. No other assertion in this suite waits on a
    // route's first-ever compile, so this override is scoped to this line
    // only.
    await expect(page).toHaveURL(/\/demo-merchant$/, { timeout: 20_000 });

    // Fixed product is shown. Scoped to the fixed product card's own
    // testid (Phase 2B test-gate correction): a plain text locator for
    // "₹500.00" becomes ambiguous once a historical order of the same
    // fixed amount appears in "Recent Internal Orders" — which the Demo
    // Merchant is expected to accumulate over time, including real
    // manual-verification orders that must never be deleted by this test.
    await expect(page.getByText("PayChaos Test Product")).toBeVisible();
    await expect(page.getByTestId("fixed-product-price")).toContainText(
      "₹500.00",
    );

    // Test Mode messaging + explicit "not connected yet" statement.
    await expect(page.getByText(/Razorpay Test Mode/i).first()).toBeVisible();
    await expect(
      page.getByText(/Razorpay Checkout is not connected in Phase 1/i),
    ).toBeVisible();

    // No fake Razorpay Checkout UI of any kind.
    await expect(page.getByRole("button", { name: /checkout/i })).toHaveCount(
      0,
    );
    await expect(page.getByRole("button", { name: /pay now/i })).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /mark as paid/i }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /simulate payment/i }),
    ).toHaveCount(0);

    // Create an internal order. Capture whichever order (if any) is
    // currently first BEFORE clicking (Phase 2B test-gate correction): once
    // "Recent Internal Orders" is non-empty — which is now the normal,
    // expected long-term state, not a corner case — `.first()` right after
    // the click cannot be trusted as "the order I just created" the instant
    // it becomes visible. The click's server action still has to revalidate
    // and re-render the list, and under a slow/cold dev-mode compile that
    // render can briefly still show the previously-first order. Waiting for
    // the first order-id to actually change (or simply appear, if the list
    // was empty) is the real signal that the new order has arrived.
    const orderIdLocator = page.getByTestId("order-id").first();
    const previousFirstOrderId =
      (await orderIdLocator.count()) > 0
        ? (await orderIdLocator.innerText()).trim()
        : null;

    await page
      .getByRole("button", { name: /create internal test order/i })
      .click();

    if (previousFirstOrderId) {
      await expect(orderIdLocator).not.toHaveText(previousFirstOrderId, {
        timeout: 40_000,
      });
    } else {
      await expect(orderIdLocator).toBeVisible({ timeout: 40_000 });
    }
    createdOrderId = (await orderIdLocator.innerText()).trim();
    expect(createdOrderId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );

    // Phase 2C correction: scope every remaining per-order assertion to
    // THIS test's own order card, identified by the stable
    // data-order-id attribute — never by list position (`.first()`) and
    // never by a page-wide search. "Recent Internal Orders" is expected to
    // legitimately contain historical orders — including a real manual-
    // verification order with an eligible ORDER_CREATED payment attempt,
    // which correctly DOES render its own "Pay with Razorpay" button. A
    // page-wide assertion that no such button exists anywhere would be
    // wrong; only THIS test's freshly-created, attempt-less order must not
    // show one.
    const orderCard = page.locator(
      `[data-testid="demo-merchant-order"][data-order-id="${createdOrderId}"]`,
    );
    await expect(orderCard).toBeVisible();

    // The PERSISTED order's own `currency` field is rendered (not merely
    // re-derived from the fixed product card's separate "INR" text above).
    await expect(orderCard.getByTestId("order-currency")).toHaveText("INR");

    await expect(orderCard.getByTestId("order-payment-status")).toHaveText(
      "UNPAID",
    );
    await expect(orderCard.getByTestId("order-business-status")).toHaveText(
      "OPEN",
    );
    await expect(orderCard.getByTestId("order-fulfilment-count")).toHaveText(
      /0 effect/,
    );
    await expect(orderCard.getByTestId("order-conceptual-state")).toHaveText(
      "Created",
    );

    // This order was created via "Create Internal Test Order" only — no
    // Razorpay Order attempt exists for it yet, so no "Pay with Razorpay"
    // button may appear WITHIN THIS ORDER'S OWN CARD. A legitimate
    // historical order elsewhere on the page may correctly show one — that
    // is not asserted against here. Deliberately network-free: this test
    // never calls the real Razorpay API (that requires real Test Mode
    // credentials and is manual-verification-only per docs/TESTING.md
    // "PLAYWRIGHT RULE").
    await expect(orderCard.getByTestId("pay-with-razorpay-button")).toHaveCount(
      0,
    );
    // No Checkout signature (or any secret-shaped value) is ever rendered
    // anywhere on the page, historical orders included.
    await expect(page.locator("body")).not.toContainText("razorpay_signature");

    // Refresh: durable persisted order is still visible (server-side read
    // on every render, not React state/localStorage). Re-locate by the
    // same stable data-order-id after reload — never by list position.
    await page.reload();
    const orderCardAfterReload = page.locator(
      `[data-testid="demo-merchant-order"][data-order-id="${createdOrderId}"]`,
    );
    await expect(orderCardAfterReload.getByTestId("order-id")).toHaveText(
      createdOrderId,
    );
    await expect(
      orderCardAfterReload.getByTestId("order-payment-status"),
    ).toHaveText("UNPAID");
  } finally {
    // Cleanup deletes ONLY the exact captured order id. If no order was ever
    // created (e.g. the test failed before creation), createdOrderId stays
    // undefined and NO cleanup call is made — there is nothing to delete.
    if (createdOrderId) {
      const client = getE2ETestServiceRoleClient();

      const { error: deleteError } = await client
        .from("orders")
        .delete()
        .eq("id", createdOrderId);
      if (deleteError) {
        throw new Error(
          `e2e cleanup: delete failed for the test-created order (id captured, delete call returned an error).`,
        );
      }

      // Prove the row is actually gone — a delete call returning no error is
      // not itself proof of deletion (e.g. an RLS policy could silently
      // match zero rows). Read back by the exact same id and assert zero
      // rows remain.
      const { data: remaining, error: verifyError } = await client
        .from("orders")
        .select("id")
        .eq("id", createdOrderId);
      if (verifyError) {
        throw new Error(
          `e2e cleanup: post-delete verification query failed for the test-created order.`,
        );
      }
      if (remaining && remaining.length > 0) {
        throw new Error(
          `e2e cleanup: the test-created order still exists after delete (cleanup did not actually remove it).`,
        );
      }
    }
  }
});
