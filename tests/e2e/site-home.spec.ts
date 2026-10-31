// Read-only main-host landing checks; works against a local host relay or an opted-in deployment.
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const mainOrigin = process.env.SITE_HTTP_MAIN_ORIGIN ?? "";
const demoOrigin = process.env.SITE_HTTP_DEMO_ORIGIN ?? "";

test.describe("product homepage", () => {
  test.skip(
    process.env.SITE_HOME_HTTP_TEST !== "1" || !mainOrigin,
    "Set SITE_HOME_HTTP_TEST=1 and SITE_HTTP_MAIN_ORIGIN; optionally SITE_HTTP_DEMO_ORIGIN.",
  );

  test("preserves navigation, honest sample data and configured demo availability", async ({
    page,
    request,
  }) => {
    await page.goto(mainOrigin);
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "Stronger communities.",
    );
    await expect(page.locator("figcaption")).toContainText(
      "fictional data, not a live result",
    );
    await expect(page.locator("figure")).toContainText("Completed");
    await expect(page.locator("figure")).toContainText("90 of 120");
    await expect(
      page.locator("figure a, figure button, figure input"),
    ).toHaveCount(0);
    await expect(page.getByText(/not cryptographic anonymity/u)).toBeVisible();
    await expect(page.locator("[data-theme-control]")).toHaveCount(1);

    const demoLinks = page.getByRole("link", {
      name: "Try the demo",
      exact: true,
    });
    if (demoOrigin) {
      expect(await demoLinks.count()).toBeGreaterThan(0);
      for (const link of await demoLinks.all()) {
        await expect(link).toHaveAttribute("href", demoOrigin);
      }
    } else {
      await expect(demoLinks).toHaveCount(0);
      await expect(
        page.getByRole("link", { name: "Request a walkthrough" }),
      ).toHaveAttribute("href", "/contact");
      await expect(page.getByText(/is being prepared/u)).toBeVisible();
    }

    for (const [name, id] of [
      ["Features", "features"],
      ["Pricing", "pricing"],
    ] as const) {
      await page
        .getByRole("navigation", { name: "Main", exact: true })
        .getByRole("link", { name, exact: true })
        .click();
      await expect(page).toHaveURL(`${mainOrigin}/#${id}`);
      await expect(page.locator(`#${id}`)).toBeInViewport();
    }
    await page.getByRole("link", { name: "A simpler way forward" }).click();
    await expect(page.locator("#how-it-works")).toBeInViewport();

    await page
      .getByRole("link", { name: "Ask for a quote", exact: true })
      .click();
    await expect(page).toHaveURL(`${mainOrigin}/contact`);
    await expect(page.locator("h1")).toBeVisible();
    await page
      .getByRole("navigation", { name: "Information" })
      .getByRole("link", { name: "Privacy Notice" })
      .click();
    await expect(page).toHaveURL(`${mainOrigin}/privacy`);
    await expect(page.locator("h1")).toBeVisible();
    for (const path of ["/user-guide", "/sign-in", "/api/votes"]) {
      expect((await request.get(`${mainOrigin}${path}`)).status()).toBe(404);
    }
  });

  for (const mode of ["Light", "Dark"] as const) {
    test(`${mode} appearance is accessible and reflows from phone to desktop`, async ({
      page,
      browserName,
    }) => {
      await page.goto(mainOrigin);
      const appearance = page.getByRole("group").filter({
        has: page.getByLabel("Appearance", { exact: true }),
      });
      await expect(page.locator("[data-theme-ready=true]")).toBeVisible();
      await page.getByLabel("Appearance", { exact: true }).click();
      await page.getByRole("radio", { name: mode, exact: true }).check();
      await page.keyboard.press("Escape");
      await expect(
        page.getByLabel("Appearance", { exact: true }),
      ).toBeFocused();
      await expect(page.locator("html")).toHaveAttribute(
        "data-theme",
        mode.toLowerCase(),
      );
      await expect(appearance).not.toHaveAttribute("open", "");

      for (const width of [320, 360, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth - window.innerWidth,
          ),
          `${mode} at ${width}px`,
        ).toBeLessThanOrEqual(0);
        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
          .analyze();
        expect(results.violations, `${mode} at ${width}px`).toEqual([]);
      }
      await page.setViewportSize({ width: 320, height: 900 });
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "200%";
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        ),
        `${mode} at 200% text`,
      ).toBeLessThanOrEqual(0);
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "";
      });
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute(
        "data-theme",
        mode.toLowerCase(),
      );
      // Windows WebKit skips links with its default keyboard-navigation setting.
      if (browserName === "webkit") {
        await page.getByRole("link", { name: "Skip to main content" }).focus();
      } else {
        await page.keyboard.press("Tab");
      }
      await expect(
        page.getByRole("link", { name: "Skip to main content" }),
      ).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("main")).toBeFocused();
    });
  }
});
