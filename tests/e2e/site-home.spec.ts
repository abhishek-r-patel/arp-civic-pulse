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
    const heroHeading = page.getByRole("heading", { level: 1 });
    const publicHeadingPosition = await heroHeading.boundingBox();
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "Online voting for every RWA decision.",
    );
    const typefaces = await page.evaluate(() => ({
      heading: getComputedStyle(document.querySelector("h1") ?? document.body)
        .fontFamily,
      body: getComputedStyle(document.body).fontFamily,
    }));
    expect(typefaces.heading).toContain("Manrope");
    expect(typefaces.heading).not.toContain("Sora");
    expect(typefaces.body).toContain("Manrope");
    await expect(page.locator("figcaption")).toContainText(
      "fictional data, not a live result",
    );
    const preview = page.locator("figure[data-voting-example]");
    await expect(preview).toContainText("Completed");
    await expect(preview).toContainText("90 of 120");
    const votingExample = preview.getByRole("group", {
      name: "Voting example",
    });
    const publicExample = votingExample.getByRole("button", {
      name: "PUBLIC poll",
    });
    const privateExample = votingExample.getByRole("button", {
      name: "PRIVATE election",
    });
    await expect(publicExample).toHaveAttribute("aria-pressed", "true");
    await privateExample.click();
    await expect(privateExample).toHaveAttribute("aria-pressed", "true");
    await expect(preview).toHaveAttribute("data-voting-example", "PRIVATE");
    const privateHeadingPosition = await heroHeading.boundingBox();
    expect(publicHeadingPosition).not.toBeNull();
    expect(privateHeadingPosition).not.toBeNull();
    expect(
      Math.abs(
        (privateHeadingPosition?.y ?? 0) - (publicHeadingPosition?.y ?? 0),
      ),
    ).toBeLessThanOrEqual(1);
    await expect(preview).toContainText("Choose a committee chair");
    await expect(preview).toContainText(
      "82 of 120 eligible homes participated",
    );
    await expect(preview).toContainText("Individual ballots are never shown");
    await expect(preview).not.toContainText("Who chose what");
    await publicExample.click();
    await expect(publicExample).toHaveAttribute("aria-pressed", "true");
    await expect(preview).toHaveAttribute("data-voting-example", "PUBLIC");
    await expect(preview.locator("a, input")).toHaveCount(0);
    await expect(preview.getByRole("button")).toHaveCount(2);
    await expect(page.getByText(/not cryptographic anonymity/u)).toBeVisible();
    await expect(page.locator("[data-theme-control]")).toHaveCount(1);
    await expect(page.locator("#faq .product-faq-item")).toHaveCount(7);
    await expect(
      page.getByText("An audit history that cannot be edited or deleted"),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Read the privacy notice" }),
    ).toHaveAttribute("href", "/privacy");

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
      ["Vote examples", "examples"],
      ["Benefits", "features"],
      ["How it works", "how-it-works"],
      ["Annual plan", "pricing"],
      ["FAQ", "faq"],
    ] as const) {
      await page
        .getByRole("navigation", { name: "Main", exact: true })
        .getByRole("link", { name, exact: true })
        .click();
      await expect(page).toHaveURL(`${mainOrigin}/#${id}`);
      await expect(page.locator(`#${id}`)).toBeInViewport();
    }
    await page
      .locator(".product-hero")
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

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Open menu" }).click();
    const mobileMenu = page.locator("#product-mobile-menu");
    await expect(mobileMenu).toHaveAttribute("aria-hidden", "false");
    await expect(mobileMenu.getByRole("link").first()).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(mobileMenu).toHaveAttribute("aria-hidden", "true");
    await expect(page.getByRole("button", { name: "Open menu" })).toBeFocused();

    for (const path of ["/user-guide", "/sign-in", "/api/votes"]) {
      expect((await request.get(`${mainOrigin}${path}`)).status()).toBe(404);
    }
  });

  for (const mode of ["Light", "Dark"] as const) {
    test(`${mode} appearance is accessible and reflows from phone to desktop`, async ({
      page,
      browserName,
    }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(mainOrigin);
      await expect(page.locator("[data-scroll-reveal]").first()).toHaveClass(
        /is-visible/u,
      );
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

      for (const width of [320, 360, 390, 768, 1440]) {
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
