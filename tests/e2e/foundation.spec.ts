import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// Phone and laptop widths from docs/DESIGN_SYSTEM.md.
const widths = [320, 430, 1280, 1440];

for (const width of widths) {
  test(`home page reflows without horizontal scrolling at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");

    await expect(
      page.getByRole("heading", { level: 1, name: "Civic Pulse" }),
    ).toBeVisible();
    await expect(page.getByText("Project foundation is ready")).toBeVisible();

    const overflows = await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    );
    expect(overflows).toBe(false);
  });
}

test("home page has no automatically detectable accessibility violations", async ({
  page,
}) => {
  await page.goto("/");

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();

  expect(results.violations).toEqual([]);
});

test("skip link moves focus to the main content", async ({ page }) => {
  await page.goto("/");
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
