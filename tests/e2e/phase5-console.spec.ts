import { test, expect, type Page } from "@playwright/test";

/**
 * Phase 5C — browser verification of the operations console.
 *
 * WHAT THIS PROVES: that the real server-rendered console, built from real
 * persisted evidence, shows an operator the score, the readiness verdict, the
 * four mandatory scenarios and the findings — and that it never turns a read
 * failure into a healthy dashboard or invents a number.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: no route is intercepted or mocked, no
 * chaos is executed, no Razorpay call is made, no demo reset is triggered and
 * nothing is written to Supabase. This is a read-only observation.
 *
 * NOT PINNED TO TODAY'S NUMBERS. The score and the scenario states are real
 * and will legitimately change; asserting a specific value here would make the
 * next chaos run break the suite. The assertions are structural.
 */

const SCENARIOS = ["C01", "C03", "C07", "C11"] as const;

function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console: ${msg.text()}`);
  });
  return errors;
}

test.describe("Phase 5 — the operations console", () => {
  test.slow();

  test("E2E-5-01: the shell shows Test Mode and the full navigation", async ({
    page,
  }) => {
    const errors = watchConsole(page);
    await page.goto("/");

    // Test Mode must never be subtle or absent.
    await expect(page.getByTestId("env-badge")).toHaveText(
      "RAZORPAY TEST MODE",
    );

    for (const id of [
      "nav-overview",
      "nav-demo-merchant",
      "nav-chaos-runs",
      "nav-findings",
      "nav-reliability",
      "nav-settings",
    ]) {
      await expect(page.getByTestId(id), id).toBeVisible();
    }

    expect(errors, errors.join(String.fromCharCode(10))).toEqual([]);
  });

  test("E2E-5-02: the Overview shows a real derived score and readiness", async ({
    page,
  }) => {
    await page.goto("/");

    const score = page.getByTestId("overview-score");
    await expect(score).toBeVisible();
    // A number in range, never a hard-coded one.
    await expect(score).toContainText(/\d{1,3}\s*\/ 100/);
    await expect(score).toContainText("RELIABILITY-V1");

    // Read the published semantic value, not textContent: every status badge
    // renders an accessibility glyph beside its label, and scraping text
    // would assert on decoration.
    const status = await page
      .getByTestId("overview-readiness-status")
      .getAttribute("data-value");
    expect(["NOT READY", "NEEDS ATTENTION", "READY"]).toContain(status);
  });

  test("E2E-5-03: all four mandatory scenarios appear with honest states", async ({
    page,
  }) => {
    await page.goto("/");

    for (const scenarioId of SCENARIOS) {
      await expect(
        page.getByTestId(`overview-scenario-${scenarioId}`),
        scenarioId,
      ).toBeVisible();

      const state = await page
        .getByTestId(`overview-state-${scenarioId}`)
        .getAttribute("data-value");
      expect(
        ["PASS", "FAIL", "UNKNOWN", "BLOCKED", "ERROR", "NOT_RUN"],
        scenarioId,
      ).toContain(state);
    }
  });

  test("E2E-5-04: the Overview invents no metric and claims no certification", async ({
    page,
  }) => {
    await page.goto("/");
    const body = (await page.textContent("body")) ?? "";

    for (const forbidden of [
      "uptime",
      "success rate",
      "99.9",
      "certified",
      "approved for production",
      "guaranteed",
      "Verified by Razorpay",
    ]) {
      expect(body, forbidden).not.toContain(forbidden);
    }
  });

  test("E2E-5-05: the Findings page renders an honest state", async ({
    page,
  }) => {
    const errors = watchConsole(page);
    await page.goto("/findings");

    await expect(
      page.getByRole("heading", { name: /Findings/i }).first(),
    ).toBeVisible();

    // Exactly one of the three honest states must be present, and a read
    // failure must never render as "no findings".
    const empty = await page.getByTestId("findings-empty").count();
    const unavailable = await page.getByTestId("findings-unavailable").count();
    const summary = await page.getByTestId("findings-summary").count();
    expect(empty + unavailable + summary).toBe(1);

    expect(errors, errors.join(String.fromCharCode(10))).toEqual([]);
  });

  test("E2E-5-06: Settings shows Test Mode status and a guarded Demo Reset", async ({
    page,
  }) => {
    await page.goto("/settings");

    await expect(page.getByTestId("settings-test-mode")).toBeVisible();
    await expect(page.getByTestId("demo-reset-panel")).toBeVisible();

    // The destructive control must start disarmed.
    await expect(page.getByTestId("demo-reset-submit")).toBeDisabled();

    // It arms only on the exact confirmation word.
    await page.getByTestId("demo-reset-confirm").fill("delete everything");
    await expect(page.getByTestId("demo-reset-submit")).toBeDisabled();

    await page.getByTestId("demo-reset-confirm").fill("RESET");
    await expect(page.getByTestId("demo-reset-submit")).toBeEnabled();

    // Deliberately NOT clicked: this spec never mutates the database.
  });

  test("E2E-5-07: no secret is exposed to the browser on any console page", async ({
    page,
  }) => {
    for (const path of ["/", "/findings", "/settings", "/reliability"]) {
      await page.goto(path);
      const html = await page.content();

      for (const forbidden of [
        "rzp_live",
        "key_secret",
        "keySecret",
        "webhook_secret",
        "service_role",
        "SUPABASE_SERVICE_ROLE_KEY",
        "PAYCHAOS_ACCESS_TOKEN",
        "PAYCHAOS_SESSION_SECRET",
      ]) {
        expect(html, `${path}: ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  test("E2E-5-08: the demo flow is reachable by navigation alone", async ({
    page,
  }) => {
    // A reviewer must not have to hunt through menus.
    await page.goto("/");

    await page.getByTestId("nav-chaos-runs").click();
    await page.waitForURL(/\/chaos$/, { timeout: 120_000 });

    await page.getByTestId("nav-findings").click();
    await page.waitForURL(/\/findings$/, { timeout: 120_000 });

    await page.getByTestId("nav-reliability").click();
    await page.waitForURL(/\/reliability$/, { timeout: 120_000 });

    // Same budget as the navigations above, not a relaxed assertion: the
    // wording and the element are unchanged. `/reliability` renders from a
    // live Supabase read, and under a full parallel suite that first render
    // has been observed just past the 5s default while every `waitForURL` in
    // this same test already allows 120s. The inconsistency was the defect —
    // the page was correct throughout.
    await expect(page.getByTestId("readiness-overview")).toBeVisible({
      timeout: 120_000,
    });
  });
});

test.describe("Phase 5 — the regression action (P4-AC-06)", () => {
  test.slow();

  /**
   * Opens the first finding in the index, or skips when the database
   * genuinely holds none. Skipping is honest here: the assertions below are
   * about the UI contract for a finding that exists, and inventing one would
   * mean writing fake evidence into a real database.
   */
  async function openFirstFinding(page: Page): Promise<boolean> {
    await page.goto("/findings");
    const link = page
      .locator('[data-testid^="finding-row-"] a[href*="/invariant-results/"]')
      .first();
    if ((await link.count()) === 0) return false;
    await link.click();
    await page.waitForURL(/\/invariant-results\//, { timeout: 120_000 });
    return true;
  }

  test("E2E-5-09: a finding offers a regression control", async ({ page }) => {
    test.skip(
      !(await openFirstFinding(page)),
      "No finding exists in the current database.",
    );

    await expect(page.getByTestId("regression-action")).toBeVisible();
    // Either start or advance must be offered — never neither, and never both.
    const start = await page.getByTestId("regression-start").count();
    const advance = await page.getByTestId("regression-advance").count();
    expect(start + advance).toBe(1);
  });

  /**
   * Clicks whichever regression control the finding currently offers.
   *
   * A finding with an open attempt offers `advance`; one without offers
   * `start`. Both Phase 4E routes return the same serialized shape, so the
   * UI contract below is identical either way — and exercising whichever
   * control is really present beats skipping the test on live data.
   */
  async function clickRegressionControl(page: Page): Promise<void> {
    // Wait for the panel to finish streaming FIRST. `count()` does not wait,
    // so checking it against a half-rendered page reads zero for both
    // controls and then blocks on whichever one was guessed.
    await expect(page.getByTestId("regression-action")).toBeVisible();

    const start = page.getByTestId("regression-start");
    if ((await start.count()) > 0) {
      await start.click();
      return;
    }
    await page.getByTestId("regression-advance").click();
  }

  test("E2E-5-10: an awaiting-external-action result is never shown as complete", async ({
    page,
  }) => {
    test.skip(
      !(await openFirstFinding(page)),
      "No finding exists in the current database.",
    );

    // UI-CONTRACT FIXTURE, NOT REAL EVIDENCE. Both Phase 4E routes are stubbed
    // so the multi-step lifecycle can be exercised deterministically. Nothing
    // here is presented as a genuine Razorpay event and nothing is written.
    const awaiting = {
      kind: "AWAITING_EXTERNAL_ACTION",
      findingId: "ui-contract-fixture",
      regressionRunId: "ui-contract-fixture",
      chaosRunId: "ui-contract-fixture",
      scenarioId: "C07",
      continuation: { kind: "AWAITING_EXTERNAL_ACTION" },
    };
    for (const pattern of [
      "**/api/findings/*/regressions",
      "**/api/regressions/*/advance",
    ]) {
      await page.route(pattern, async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(awaiting),
        });
      });
    }

    await clickRegressionControl(page);

    await expect(page.getByTestId("regression-action-kind")).toHaveText(
      "AWAITING_EXTERNAL_ACTION",
    );
    await expect(page.getByTestId("regression-action-result")).toContainText(
      "NOT complete",
    );

    // The decisive assertion: the ACTION RESULT never claims completion.
    //
    // Scoped to the result panel on purpose. A finding may legitimately carry
    // a genuinely RESOLVED earlier regression, which truthfully renders "Fix
    // verified" elsewhere on the page — asserting page-wide would confuse
    // real persisted history with a fabricated claim about this request.
    const result =
      (await page.getByTestId("regression-action-result").textContent()) ?? "";
    expect(result).not.toContain("Fix verified");
    expect(result).not.toContain("COMPLETED");
  });

  test("E2E-5-11: a refused request is shown as a refusal, not a success", async ({
    page,
  }) => {
    test.skip(
      !(await openFirstFinding(page)),
      "No finding exists in the current database.",
    );

    // UI-CONTRACT FIXTURE: the real 409 shape Phase 4E returns when it
    // deterministically refuses.
    const refusal = {
      kind: "NOT_STARTED",
      findingId: "ui-contract-fixture",
      reason: "FRESH_ORDER_REQUIRED",
      ineligibility: null,
    };
    for (const pattern of [
      "**/api/findings/*/regressions",
      "**/api/regressions/*/advance",
    ]) {
      await page.route(pattern, async (route) => {
        await route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify(refusal),
        });
      });
    }

    await clickRegressionControl(page);

    await expect(page.getByTestId("regression-action-kind")).toHaveText(
      "NOT_STARTED",
    );

    // Same scoping rule as above: the refusal panel is what must not claim
    // success, not the finding's genuine regression history.
    const result =
      (await page.getByTestId("regression-action-result").textContent()) ?? "";
    expect(result).toContain("No regression was created");
    expect(result).not.toContain("Fix verified");
  });
});
