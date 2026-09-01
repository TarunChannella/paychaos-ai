import { test, expect, type Page } from "@playwright/test";

/**
 * Phase 4F-R3 — browser verification of the Reliability Score page.
 *
 * WHAT THIS SPEC PROVES: that the REAL server-rendered `/reliability` page,
 * calculated from REAL persisted evidence, actually shows an operator the
 * score, all four mandatory scenarios, each deduction and each provenance —
 * and that it never misrepresents a controlled simulation as genuine Razorpay
 * evidence or leaks a Phase 4G readiness verdict.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: no route is intercepted or mocked, no
 * chaos is executed, no Razorpay call is made, and nothing is written to
 * Supabase. This is a read-only browser observation of live data.
 *
 * NOT PINNED TO TODAY'S SCORE. The current figure is 85, but asserting that
 * here would make the next legitimate chaos run break the suite. The
 * assertions are structural; the exact-number visual contract is proven
 * deterministically in `tests/unit/reliability/reliability-overview.test.tsx`
 * against a fixed fixture.
 */

const SCENARIOS = ["C01", "C03", "C07", "C11"] as const;

/** Collects genuine browser errors so a silent crash cannot pass as success. */
function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console: ${msg.text()}`);
  });
  return errors;
}

test.describe("Phase 4F-R3 — the Reliability Score page", () => {
  // Real server-rendered page: under the dev server the route compiles on
  // first hit and the score makes Supabase round-trips, so a cold load can be
  // slow. `slow()` triples the budget without relaxing any assertion.
  test.slow();

  test("E2E-4F-01: the landing page navigates to the Reliability Score", async ({
    page,
  }) => {
    await page.goto("/");
    await page
      .getByRole("link", { name: /reliability/i })
      .first()
      .click();
    // Same assertion, a budget that matches reality: under the dev server the
    // target route compiles on first hit AND makes Supabase round-trips, which
    // routinely outlasts the 5s default. Nothing is relaxed except the wait.
    await page.waitForURL(/\/reliability$/, { timeout: 120_000 });
    await expect(page).toHaveURL(/\/reliability$/);
  });

  test("E2E-4F-02: the score, versions and all four scenarios are visible", async ({
    page,
  }) => {
    const errors = watchConsole(page);
    await page.goto("/reliability");

    await expect(
      page.getByRole("heading", { name: /Reliability Score/i }),
    ).toBeVisible();

    // The score renders as `<n> / 100` with n in range — never a hard-coded
    // number, so real evidence can legitimately change it.
    const scoreText = await page.getByTestId("reliability-score").textContent();
    expect(scoreText).toMatch(/^\s*\d{1,3}\s*\/\s*100\s*$/);
    const score = Number(scoreText!.split("/")[0]!.trim());
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);

    await expect(page.getByTestId("reliability-algorithm")).toHaveText(
      "RELIABILITY-V1",
    );
    await expect(page.getByTestId("reliability-selection")).toHaveText(
      "LATEST_SELECTION_V1",
    );
    await expect(page.getByTestId("reliability-total-deduction")).toBeVisible();

    for (const scenarioId of SCENARIOS) {
      await expect(
        page.getByTestId(`reliability-row-${scenarioId}`),
        scenarioId,
      ).toBeVisible();
    }

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("E2E-4F-03: every scenario shows a state and a deduction", async ({
    page,
  }) => {
    await page.goto("/reliability");

    for (const scenarioId of SCENARIOS) {
      const state = await page
        .getByTestId(`reliability-state-${scenarioId}`)
        .textContent();
      expect(
        ["PASS", "FAIL", "UNKNOWN", "BLOCKED", "ERROR", "NOT_RUN"],
        scenarioId,
      ).toContain(state?.trim());

      await expect(
        page.getByTestId(`reliability-deduction-${scenarioId}`),
        scenarioId,
      ).toContainText(/Deduction: \d+/);

      // P4-AC-11: every row explains itself and shows its candidate counts.
      await expect(
        page.getByTestId(`reliability-explanation-${scenarioId}`),
        scenarioId,
      ).toBeVisible();
      await expect(
        page.getByTestId(`reliability-diagnostics-${scenarioId}`),
        scenarioId,
      ).toContainText(/\d+ total, \d+ eligible, \d+ ineligible/);
    }
  });

  test("E2E-4F-04: C03 is visibly a controlled simulation, never a real event", async ({
    page,
  }) => {
    await page.goto("/reliability");

    const c03 = page.getByTestId("reliability-row-C03");
    await expect(c03).toBeVisible();

    // Only assert the selected-evidence wording when a run is actually
    // selected; "no eligible run" is a legitimate state.
    const hasRun = await page
      .getByTestId("reliability-run-C03")
      .count()
      .then((n) => n > 0);

    if (hasRun) {
      await expect(
        page.getByTestId("reliability-classification-C03"),
      ).toHaveText("SYNTHETIC_DEMO");
      await expect(page.getByTestId("reliability-provenance-C03")).toHaveText(
        "Controlled PayChaos security simulation",
      );
    }

    // And nowhere on the page is C03 dressed up as genuine provider evidence.
    const body = (await page.textContent("body")) ?? "";
    for (const forbidden of [
      "Real Razorpay Event",
      "real webhook delivery",
      "recorded provider evidence",
      "Verified by Razorpay",
      "Razorpay certified",
    ]) {
      expect(body, forbidden).not.toContain(forbidden);
    }
  });

  test("E2E-4F-05: P4-AC-12 — an UNKNOWN scenario is visibly not a PASS", async ({
    page,
  }) => {
    await page.goto("/reliability");

    const body = (await page.textContent("body")) ?? "";

    for (const scenarioId of SCENARIOS) {
      const state = (
        await page.getByTestId(`reliability-state-${scenarioId}`).textContent()
      )?.trim();

      if (state === "UNKNOWN") {
        // The deduction and the explicit not-a-pass wording must both show.
        await expect(
          page.getByTestId(`reliability-deduction-${scenarioId}`),
        ).toContainText("Deduction: 15");
        await expect(
          page.getByTestId(`reliability-explanation-${scenarioId}`),
        ).toContainText("not counted as PASS");
      }
    }

    // Nothing anywhere calls the current STATE healthy or production ready.
    //
    // Narrowed in Phase 4G. The bare word "healthy" is no longer bannable:
    // the readiness checklist legitimately names a gate called
    // HEALTHY_BASELINE and reports it as "The required healthy baseline is
    // not verified...". Naming a gate is not claiming the system is healthy,
    // so the ban now targets the CLAIM rather than the vocabulary.
    for (const forbidden of [
      "is healthy",
      "System is healthy",
      "All healthy",
      "looks healthy",
      "production ready",
      "Production Ready",
      "certified",
      "Certified",
    ]) {
      expect(body, forbidden).not.toContain(forbidden);
    }
  });

  test("E2E-4G-01: the Go-Live Readiness panel is rendered with a verdict", async ({
    page,
  }) => {
    // ADVANCED IN PHASE 4G. This assertion previously required that NO
    // readiness verdict appear on this page, which was correct while the
    // readiness engine did not exist. Phase 4G deliberately renders the
    // assessment beneath the score, so the guarantee is re-pointed rather
    // than dropped: a verdict must appear, and it must be one of the three
    // frozen statuses — never an invented one.
    await page.goto("/reliability");

    await expect(page.getByTestId("readiness-overview")).toBeVisible();
    await expect(page.getByTestId("readiness-version")).toHaveText(
      "GO-LIVE-READINESS-V1",
    );

    const status = (
      await page.getByTestId("readiness-status").textContent()
    )?.trim();
    expect(["NOT READY", "NEEDS ATTENTION", "READY"]).toContain(status);
  });

  test("E2E-4F-07: a selected run links to its existing chaos-run page", async ({
    page,
  }) => {
    await page.goto("/reliability");

    for (const scenarioId of SCENARIOS) {
      const link = page.getByTestId(`reliability-run-${scenarioId}`);
      if ((await link.count()) === 0) continue;

      const href = await link.getAttribute("href");
      expect(href, scenarioId).toMatch(/^\/chaos\/runs\/[0-9a-f-]{36}$/);
    }
  });
});

test.describe("Phase 4G — the Go-Live Readiness assessment", () => {
  // Same reasoning as the 4F block: a cold dev-server load compiles the route
  // and makes Supabase round-trips.
  test.slow();

  test("E2E-4G-02: the status is justified by visible reasons", async ({
    page,
  }) => {
    const errors = watchConsole(page);
    await page.goto("/reliability");

    const status = (
      await page.getByTestId("readiness-status").textContent()
    )?.trim();

    // A bare verdict with no visible justification is exactly what this
    // project forbids, so anything short of READY must show its reasons.
    if (status !== "READY") {
      const blocking = await page.getByTestId("readiness-blocking").count();
      const attention = await page.getByTestId("readiness-attention").count();
      expect(blocking + attention).toBeGreaterThan(0);
    }

    // Precedence is visible too: a blocking reason means NOT READY.
    if ((await page.getByTestId("readiness-blocking").count()) > 0) {
      expect(status).toBe("NOT READY");
    }

    expect(errors, errors.join(String.fromCharCode(10))).toEqual([]);
  });

  test("E2E-4G-03: every frozen gate is listed with an honest state", async ({
    page,
  }) => {
    await page.goto("/reliability");

    const gateIds = [
      "TEST_MODE_SECURITY",
      "HEALTHY_BASELINE",
      "MANDATORY_SCENARIOS",
      "SELECTED_RUN_INVARIANTS",
      "UNRESOLVED_FINDINGS",
      "RELIABILITY_SCORE",
      "REAL_RAZORPAY_MANUAL_VERIFICATION",
      "BUILD_VERIFICATION",
      "SECURITY_VERIFICATION",
      "AUTOMATED_TEST_VERIFICATION",
      "MANUAL_VERIFICATION",
    ] as const;

    for (const gateId of gateIds) {
      await expect(
        page.getByTestId(`readiness-gate-${gateId}`),
        gateId,
      ).toBeVisible();
    }
  });

  test("E2E-4G-04: an unverified gate is never displayed as a pass", async ({
    page,
  }) => {
    await page.goto("/reliability");
    const body = (await page.textContent("body")) ?? "";

    // Gates this runtime cannot establish must read as unverified. If any
    // UNKNOWN gate is present the wording must be visible, and READY must be
    // unreachable — absence of evidence is never evidence of correctness.
    const unverified = "Not verified by the current runtime evidence";
    if (body.includes(unverified)) {
      const status = (
        await page.getByTestId("readiness-status").textContent()
      )?.trim();
      expect(status).not.toBe("READY");
    }

    for (const forbidden of [
      "All gates passed",
      "Everything verified",
      "Verified by Razorpay",
      "Razorpay approved",
    ]) {
      expect(body, forbidden).not.toContain(forbidden);
    }
  });

  test("E2E-4G-05: the assessment is never presented as a certification", async ({
    page,
  }) => {
    await page.goto("/reliability");

    // P4-AC-14: the mandatory disclaimer is visible on the real page.
    await expect(page.getByTestId("readiness-disclaimer")).toContainText(
      "It is not Razorpay certification.",
    );

    const body = (await page.textContent("body")) ?? "";
    for (const forbidden of [
      "Razorpay certified",
      "certified by Razorpay",
      "approved for production",
      "guaranteed safe",
      "safe to go live",
      "cleared for launch",
    ]) {
      expect(body, forbidden).not.toContain(forbidden);
    }
  });

  test("E2E-4G-06: no secret or credential is exposed to the browser", async ({
    page,
  }) => {
    await page.goto("/reliability");
    const html = await page.content();

    for (const forbidden of [
      "rzp_live",
      "key_secret",
      "keySecret",
      "webhook_secret",
      "service_role",
      "SUPABASE_SERVICE_ROLE_KEY",
      "PAYCHAOS_SESSION_SECRET",
    ]) {
      expect(html, forbidden).not.toContain(forbidden);
    }
  });
});
