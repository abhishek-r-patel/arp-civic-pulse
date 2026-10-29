/* Real-browser appearance persistence, System mode, storage recovery, contrast and print checks. */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const KEY = "civic-pulse-theme";
test("page shells use available viewport width with responsive gutters", async ({
  page,
}) => {
  for (const width of [320, 1280, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/privacy");
    const layout = await page.locator("main").evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        width: rect.width,
        left: rect.left,
        padding: parseFloat(style.paddingLeft),
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    expect(layout.width).toBe(width);
    expect(layout.left).toBe(0);
    expect(layout.padding).toBe(width < 768 ? 16 : 24);
    expect(layout.overflow).toBe(false);
    const header = page.locator("[data-page-header] > div").first();
    expect(
      await header.evaluate((element) => getComputedStyle(element).maxWidth),
    ).toBe("none");
  }
});

async function choose(page: Page, mode: "Light" | "Dark" | "System") {
  const menu = page.locator("details[data-theme-control]");
  if ((await menu.getAttribute("open")) === null)
    await menu.locator("summary").click();
  await menu.getByRole("radio", { name: mode, exact: true }).check();
  await page.keyboard.press("Escape");
}

test("public forms and information pages retain centered readable content", async ({
  page,
}) => {
  for (const width of [320, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ["/sign-in", "/register", "/contact", "/privacy"]) {
      await page.goto(path);
      const layout = await page
        .locator("main > .max-w-ballot")
        .evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return {
            width: rect.width,
            center: rect.left + rect.width / 2,
            viewport: document.documentElement.clientWidth,
          };
        });
      expect(layout.width).toBe(
        Math.min(640, layout.viewport - (width < 768 ? 32 : 48)),
      );
      expect(Math.abs(layout.center - layout.viewport / 2)).toBeLessThan(1);
    }
  }
});

test("appearance defaults to System, follows live device changes and remembers explicit preference", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/sign-in");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const control = page.locator("summary[aria-label='Appearance']");
  await control.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("group", { name: "Appearance mode" }),
  ).toBeVisible();
  await page.getByRole("radio", { name: "Light", exact: true }).check();
  await page.keyboard.press("Escape");
  await expect(control).toBeFocused();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBe(
    "light",
  );
  await choose(page, "System");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("corrupted preferences recover to System and browser tabs synchronize", async ({
  page,
  context,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.addInitScript((key) => {
    localStorage.setItem(key, "invalid");
  }, KEY);
  await page.goto("/sign-in");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const second = await context.newPage();
  await second.goto("/sign-in");
  await choose(page, "Dark");
  await expect(second.locator("html")).toHaveAttribute("data-theme", "dark");
  await choose(page, "Light");
  await expect(second.locator("html")).toHaveAttribute("data-theme", "light");
  await second.close();
});

test("blocked storage retains an in-memory choice and reloads safely to System", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.addInitScript(() => {
    for (const method of ["getItem", "setItem"])
      Object.defineProperty(Storage.prototype, method, {
        configurable: true,
        value() {
          throw new DOMException("Storage blocked", "SecurityError");
        },
      });
  });
  await page.goto("/sign-in");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await choose(page, "Light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("both modes reflow accessibly, use self-hosted fonts and print light", async ({
  page,
}) => {
  const externalFonts: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      url.hostname === "fonts.googleapis.com" ||
      url.hostname === "fonts.gstatic.com"
    )
      externalFonts.push(request.url());
  });
  await page.goto("/sign-in");
  await page.evaluate(() => document.fonts.ready);
  for (const mode of ["Light", "Dark"] as const) {
    await choose(page, mode);
    for (const width of [320, 375, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
      ).toBe(false);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(results.violations).toEqual([]);
      await page.screenshot({
        path: test
          .info()
          .outputPath(`appearance-${mode.toLowerCase()}-${width}.png`),
        fullPage: true,
      });
    }
  }
  expect(externalFonts).toEqual([]);
  expect(
    await page
      .locator("h1")
      .evaluate((element) => getComputedStyle(element).fontFamily),
  ).toContain("Sora");
  expect(
    await page
      .locator("body")
      .evaluate((element) => getComputedStyle(element).fontFamily),
  ).toContain("Manrope");
  await page.emulateMedia({ media: "print" });
  await expect(page.locator("details[data-theme-control]")).toBeHidden();
  expect(
    await page
      .locator("body")
      .evaluate((element) => getComputedStyle(element).backgroundColor),
  ).toBe("rgb(255, 255, 255)");
  expect(
    await page
      .locator("html")
      .evaluate((element) => getComputedStyle(element).colorScheme),
  ).toBe("light");
});
