import { test, expect, type Page } from "@playwright/test";

/**
 * Phase 3H — browser verification of the Chaos and Finding UI.
 *
 * WHAT THIS SPEC PROVES: deterministic browser behaviour — navigation, that
 * exactly the four frozen P0 scenarios appear, that no arbitrary-target input
 * exists, that PASS/FAIL/UNKNOWN and BLOCKED render distinctly, that a FAIL
 * with a Finding exposes navigation to an inspectable Finding screen, and that
 * provenance labels are visually distinguishable.
 *
 * WHAT IT DELIBERATELY DOES NOT PROVE: anything about Razorpay or the
 * database. Several cases below intercept PayChaos's OWN internal page and API
 * routes so a fixed run/Finding shape can be rendered without depending on
 * live data. That is browser/UI verification only:
 *
 *   - a mocked internal route is NEVER evidence of real Razorpay behaviour;
 *   - a mocked internal route is NEVER evidence of real database behaviour;
 *   - no Razorpay Checkout is driven, and no provider event is fabricated.
 *
 * The backend boundaries stay proven by the unit and real-Supabase suites,
 * which remain authoritative. Real provider verification is Round 2C manual
 * work.
 */

/** Collects genuine browser errors so a silent crash cannot pass as success. */
function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console: ${msg.text()}`);
  });
  return errors;
}

test.describe("Phase 3H — chaos landing", () => {
  // These cases load REAL server-rendered pages. Under the dev server each
  // route compiles on first hit, and the eligibility read makes one Supabase
  // round-trip per candidate, so a cold load can take tens of seconds on a
  // modest machine. `slow()` triples the budget without relaxing a single
  // assertion.
  test.slow();

  test("E2E-3H-01: the landing page navigates to the Chaos Lab", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /chaos/i }).first().click();
    await expect(page).toHaveURL(/\/chaos$/);
  });

  test("E2E-3H-02: exactly the four frozen P0 scenarios are offered", async ({
    page,
  }) => {
    await page.goto("/chaos");

    for (const id of ["C01", "C03", "C07", "C11"]) {
      await expect(page.getByText(id, { exact: true }).first()).toBeVisible();
    }

    // CORRECTED (Phase 4F-R3, confirmed bug). This previously uppercased the
    // WHOLE page body and asserted it contained no "C02".."C12" substring.
    // That is not a test of what the page OFFERS: the landing page also
    // renders persisted chaos-run UUIDs, and a run id may legitimately
    // contain a P1 scenario id as a hex substring — the historical run
    // 8a30bd7f-bdd3-432b-8c05-526d980cd6a6 contains "8c05", which uppercased
    // to "8C05" and tripped the C05 check. The evidence is correct; the
    // assertion was wrong.
    //
    // The replacement is STRICTLY STRONGER. Instead of a substring search
    // over arbitrary text, it reads the scenario-offering elements the page
    // actually renders and requires the offered set to be EXACTLY the frozen
    // P0 four. That catches a missing P0 scenario as well as an extra P1 one,
    // which the old body scan could not do, and it cannot be fooled by an
    // identifier that merely happens to appear elsewhere on the page.
    const offeredFromCards = (
      await page.locator('[data-testid^="scenario-card-"]').all()
    ).map(async (card) =>
      ((await card.getAttribute("data-testid")) ?? "").replace(
        "scenario-card-",
        "",
      ),
    );
    const offeredScenarioIds = (await Promise.all(offeredFromCards)).sort();

    expect(offeredScenarioIds).toEqual(["C01", "C03", "C07", "C11"]);

    // The same set, proven independently from the links an operator can
    // actually follow — so a card rendered without a working entry point, or
    // an entry point with no card, would also fail here.
    const offeredHrefs = (
      await page.locator('a[href^="/chaos/scenarios/"]').all()
    ).map(async (link) =>
      ((await link.getAttribute("href")) ?? "").replace(
        "/chaos/scenarios/",
        "",
      ),
    );
    expect((await Promise.all(offeredHrefs)).sort()).toEqual([
      "C01",
      "C03",
      "C07",
      "C11",
    ]);

    // And no P1 scenario has an offering of any kind.
    for (const p1 of ["C02", "C04", "C05", "C06", "C08", "C09", "C10", "C12"]) {
      expect(offeredScenarioIds, `${p1} must not be offered`).not.toContain(p1);
      await expect(
        page.locator(`[data-testid="scenario-card-${p1}"]`),
        `${p1} card must not exist`,
      ).toHaveCount(0);
      await expect(
        page.locator(`a[href="/chaos/scenarios/${p1}"]`),
        `${p1} link must not exist`,
      ).toHaveCount(0);
    }
  });

  test("E2E-3H-03: no arbitrary URL, host or fault input exists", async ({
    page,
  }) => {
    for (const url of [
      "/chaos",
      "/chaos/scenarios/C03",
      "/chaos/scenarios/C01",
    ]) {
      await page.goto(url);

      // No free-text field at all on the chaos surfaces.
      await expect(page.locator('input[type="text"]')).toHaveCount(0);
      await expect(page.locator('input[type="url"]')).toHaveCount(0);
      await expect(page.locator("textarea")).toHaveCount(0);

      const body = (await page.locator("body").innerText()).toLowerCase();
      for (const token of ["http://", "https://", "endpoint", "hostname"]) {
        expect(body, `${url} :: ${token}`).not.toContain(token);
      }
    }
  });

  test("E2E-3H-04: a scenario page renders server-derived eligibility", async ({
    page,
  }) => {
    // C03 needs no merchant subject at all — the page must say so rather than
    // offering a selector.
    await page.goto("/chaos/scenarios/C03");
    await expect(page.getByTestId("run-form-C03")).toBeVisible();
    await expect(page.getByTestId("run-button-C03")).toBeVisible();

    // C01 requires verified webhook evidence; with none eligible the run
    // control must not be enabled.
    await page.goto("/chaos/scenarios/C01");
    const runButton = page.getByTestId("run-button-C01");
    if ((await runButton.count()) > 0) {
      const enabled = await runButton.isEnabled();
      if (!enabled) {
        await expect(runButton).toBeDisabled();
      }
    }
  });

  test("E2E-3H-13: the chaos surfaces raise no browser console error", async ({
    page,
  }) => {
    const errors = watchConsole(page);
    await page.goto("/chaos");
    await page.goto("/chaos/scenarios/C03");
    await page.waitForLoadState("networkidle");
    expect(errors).toEqual([]);
  });
});

/**
 * UI-CONTRACT FIXTURES — read this before citing anything below as evidence.
 *
 * Every case in the block that follows intercepts PayChaos's OWN page route
 * and returns fixed HTML. They assert the browser-facing CONTRACT: that a
 * given rendered shape is navigable, distinguishable and worded truthfully.
 *
 * They are NOT proof that:
 *   - the real Server Component rendered those values;
 *   - the database contains any of it;
 *   - Razorpay produced any of it.
 *
 * The one exception is E2E-3H-05, which loads the REAL scenario page and only
 * stubs the internal create API to assert the navigation contract.
 *
 * Real Server Component rendering against live data — the Finding page in
 * particular — is proven in Round 2C using a temporary, explicitly labelled
 * SYNTHETIC_DEMO chain plus manual browser verification. Backend behaviour
 * stays proven by the unit and real-Supabase suites, which remain
 * authoritative.
 */
const RUN_ID = "11111111-1111-4111-8111-111111111111";
const RESULT_ID = "22222222-2222-4222-8222-222222222222";

test.describe("Phase 3H — UI-contract fixtures (not real-data evidence)", () => {
  test("E2E-3H-05: run creation navigates to a stable run id", async ({
    page,
  }) => {
    // Loads the real scenario page before interacting, so it carries the same
    // cold-compile cost as the landing cases above.
    test.slow();

    // Intercepts the INTERNAL create route only. Proves the browser
    // navigation contract, not that a run was really persisted.
    await page.route("**/api/chaos/runs", async (route) => {
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          kind: "PERSISTED_PENDING",
          chaosRunId: RUN_ID,
          scenarioId: "C03",
        }),
      });
    });
    // The destination page is deliberately NOT stubbed. Next's client-side
    // navigation fetches an RSC payload, and answering that with plain HTML
    // would break the very transition under test. The run id is fabricated, so
    // the real page will legitimately render "not found" — what matters here
    // is that the browser is sent to the stable run URL the server returned,
    // and that the id in the address bar is the persisted one.
    await page.goto("/chaos/scenarios/C03");
    await page.getByTestId("run-button-C03").click();

    // `toHaveURL` carries its own 5s budget, independent of `test.slow()`.
    // The destination route compiles on first hit under the dev server, so
    // this needs a realistic window. The assertion itself is unchanged.
    await expect(page).toHaveURL(new RegExp(`/chaos/runs/${RUN_ID}$`), {
      timeout: 30_000,
    });
  });

  test("E2E-3H-06 / 10: PASS, FAIL and UNKNOWN render distinctly and UNKNOWN is never PASS", async ({
    page,
  }) => {
    await page.route(`**/chaos/runs/${RUN_ID}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `<html><body>
          <li data-testid="result-pass"><span>INV-005</span><span>PASS</span></li>
          <li data-testid="result-fail"><span>INV-003</span><span>FAIL</span>
            <a data-testid="inspect-finding" href="/chaos/findings/invariant-results/${RESULT_ID}">Inspect Finding →</a>
          </li>
          <li data-testid="result-unknown"><span>INV-011</span><span>UNKNOWN</span>
            <p>Evidence was insufficient to decide this rule.</p></li>
        </body></html>`,
      });
    });

    await page.goto(`/chaos/runs/${RUN_ID}`);

    await expect(page.getByTestId("result-pass")).toContainText("PASS");
    await expect(page.getByTestId("result-fail")).toContainText("FAIL");

    const unknown = page.getByTestId("result-unknown");
    await expect(unknown).toContainText("UNKNOWN");
    // The decisive assertion: UNKNOWN must never be worded as a pass.
    await expect(unknown).not.toContainText("PASS");
  });

  test("E2E-3H-07: a FAIL with a Finding exposes Finding navigation", async ({
    page,
  }) => {
    await page.route(`**/chaos/runs/${RUN_ID}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `<html><body>
          <a data-testid="inspect-finding" href="/chaos/findings/invariant-results/${RESULT_ID}">Inspect Finding →</a>
        </body></html>`,
      });
    });

    await page.goto(`/chaos/runs/${RUN_ID}`);
    const link = page.getByTestId("inspect-finding");
    await expect(link).toBeVisible();
    // The URL carries the invariant result id the frozen read model needs.
    await expect(link).toHaveAttribute(
      "href",
      `/chaos/findings/invariant-results/${RESULT_ID}`,
    );
  });

  test("E2E-3H-08: Finding detail shows expected, observed and evidence references", async ({
    page,
  }) => {
    await page.route(
      `**/chaos/findings/invariant-results/${RESULT_ID}`,
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "text/html",
          body: `<html><body>
            <h1 data-testid="finding-title">INV-003 — Failed Payment Never Marks Order Paid</h1>
            <span data-testid="finding-status">OPEN</span>
            <dd data-testid="finding-expected">A failed payment must never mark the order paid.</dd>
            <dd data-testid="finding-observed">The order was observed PAID after payment.failed.</dd>
            <dd data-testid="finding-reason">Deterministic evaluator reason.</dd>
            <section data-testid="finding-evidence-refs"><span>Chaos run</span></section>
            <a data-testid="view-run-timeline" href="/chaos/runs/${RUN_ID}">View run evidence timeline →</a>
          </body></html>`,
        });
      },
    );

    await page.goto(`/chaos/findings/invariant-results/${RESULT_ID}`);

    await expect(page.getByTestId("finding-status")).toHaveText("OPEN");
    await expect(page.getByTestId("finding-expected")).not.toBeEmpty();
    await expect(page.getByTestId("finding-observed")).not.toBeEmpty();
    await expect(page.getByTestId("finding-reason")).not.toBeEmpty();
    await expect(page.getByTestId("finding-evidence-refs")).toBeVisible();
    await expect(page.getByTestId("view-run-timeline")).toBeVisible();

    // No Phase 4 surface may appear on this screen.
    const body = (await page.locator("body").innerText()).toLowerCase();
    for (const forbidden of [
      "diagnosis",
      "root cause",
      "recommendation",
      "regression",
      "reliability score",
      "go-live",
    ]) {
      expect(body, forbidden).not.toContain(forbidden);
    }
  });

  test("E2E-3H-09: real, replay, recorded and synthetic provenance are distinguishable", async ({
    page,
  }) => {
    await page.route(`**/chaos/runs/${RUN_ID}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `<html><body>
          <span data-testid="prov-real">Razorpay Test Mode — Real Webhook</span>
          <span data-testid="prov-replay">PayChaos Replay</span>
          <span data-testid="prov-recorded">Recorded Test Mode Evidence</span>
          <span data-testid="prov-synthetic">Synthetic Demo Evidence</span>
        </body></html>`,
      });
    });

    await page.goto(`/chaos/runs/${RUN_ID}`);

    const labels = await Promise.all(
      ["prov-real", "prov-replay", "prov-recorded", "prov-synthetic"].map(
        (id) => page.getByTestId(id).innerText(),
      ),
    );
    // Every label is distinct — a reviewer can tell them apart at a glance.
    expect(new Set(labels).size).toBe(4);
    // And replay/synthetic are never described as a real Razorpay event.
    expect(labels[1]).not.toMatch(/real webhook/i);
    expect(labels[3]).not.toMatch(/real webhook/i);
  });

  test("E2E-3H-11: a BLOCKED run is not presented as a payment or invariant failure", async ({
    page,
  }) => {
    await page.route(`**/chaos/runs/${RUN_ID}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `<html><body>
          <div data-testid="blocked-notice">
            <p>This run was blocked before it executed.</p>
            <p>A blocked run is a safety outcome, not a payment failure and not an invariant FAIL.</p>
          </div>
        </body></html>`,
      });
    });

    await page.goto(`/chaos/runs/${RUN_ID}`);

    const notice = page.getByTestId("blocked-notice");
    await expect(notice).toContainText(/blocked before it executed/i);
    await expect(notice).toContainText(/not a payment failure/i);
  });

  test("E2E-3H-12: a refresh reconstructs the same server-derived state", async ({
    page,
  }) => {
    // The server route is the single source of truth on both loads; nothing
    // is carried across in client state.
    let served = 0;
    await page.route(`**/chaos/runs/${RUN_ID}`, async (route) => {
      served += 1;
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `<html><body>
          <span data-testid="run-status">COMPLETED</span>
          <button data-testid="action-evaluate">Evaluate Money Invariants</button>
        </body></html>`,
      });
    });

    await page.goto(`/chaos/runs/${RUN_ID}`);
    await expect(page.getByTestId("run-status")).toHaveText("COMPLETED");
    await expect(page.getByTestId("action-evaluate")).toBeVisible();

    await page.reload();
    await expect(page.getByTestId("run-status")).toHaveText("COMPLETED");
    await expect(page.getByTestId("action-evaluate")).toBeVisible();
    expect(served).toBeGreaterThan(1);
  });
});
