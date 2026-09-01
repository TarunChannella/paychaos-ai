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

    const status = (
      await page.getByTestId("overview-readiness-status").textContent()
    )?.trim();
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

      const state = (
        await page.getByTestId(`overview-state-${scenarioId}`).textContent()
      )?.trim();
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

    await expect(page.getByTestId("readiness-overview")).toBeVisible();
  });
});
