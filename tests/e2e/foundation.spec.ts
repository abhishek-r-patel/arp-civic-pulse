import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// Phone, tablet and laptop widths from docs/DESIGN_SYSTEM.md, plus intermediate sizes.
const widths = [320, 375, 430, 640, 768, 1024, 1280, 1440];

for (const width of widths) {
  test(`sign-in page reflows without horizontal scrolling at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/sign-in");

    await expect(
      page.getByRole("heading", { level: 1, name: "Sign in" }),
    ).toBeVisible();
    await expect(page.getByLabel(/Registered email address/)).toBeVisible();

    const overflows = await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    );
    expect(overflows).toBe(false);
  });
}

test("signed-out visitors are sent to sign-in and see no navigation", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page).toHaveURL(/\/sign-in$/u);
  await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(0);
});

test("protected admin pages redirect signed-out visitors without revealing anything", async ({
  page,
}) => {
  for (const path of [
    "/admin/households",
    "/admin/households/new",
    "/admin/accounts",
    "/admin/accounts/new",
  ]) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/sign-in$/u);
  }
});

test("sign-in page has no automatically detectable accessibility violations", async ({
  page,
}) => {
  await page.goto("/sign-in");

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();

  expect(results.violations).toEqual([]);
});

test("skip link moves focus to the main content", async ({
  page,
  browserName,
}) => {
  // Safari does not Tab to links unless the user turns that on (or presses Option+Tab),
  // and the automated WebKit build cannot reproduce Option+Tab. Check it on a real Safari.
  test.skip(
    browserName === "webkit",
    "Needs a real Safari: see docs/PILOT_READINESS.md.",
  );
  await page.goto("/sign-in");
  await page.keyboard.press("Tab");

  const skipLink = page.getByRole("link", { name: "Skip to main content" });
  await expect(skipLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();
});

test("health endpoint reports readiness without protected data", async ({
  request,
}) => {
  const response = await request.get("/api/internal/health");

  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("private, no-store");
  const body: unknown = await response.json();
  expect(body).toEqual({
    data: { status: "ok" },
    requestId: response.headers()["x-request-id"],
  });
});

test("unknown routes show the not-found page", async ({ page }) => {
  const response = await page.goto("/does-not-exist");

  expect(response?.status()).toBe(404);
  await expect(
    page.getByRole("heading", { level: 1, name: "Page not found" }),
  ).toBeVisible();
});
