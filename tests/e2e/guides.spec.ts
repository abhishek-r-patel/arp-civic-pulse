// Native guide coverage: public access, deep links, image delivery, discovery and accessible reflow.
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const guides = [
  ["/user-guide", "User Guide"],
  ["/user-guide/resident", "Resident Guide"],
  ["/user-guide/rwa-admin", "RWA Admin Guide"],
  ["/tech-guide", "Technical Guide"],
  ["/tech-guide/errors", "Error Logging and IDs"],
] as const;

for (const [path, title] of guides) {
  test(`${title} is public with working contents, images and responsive layout`, async ({
    page,
    request,
  }) => {
    test.slow();
    await page.goto(path);
    await expect(
      page.getByRole("heading", { level: 1, name: title, exact: true }),
    ).toBeVisible();
    await expect(page.locator("h1")).toHaveCount(1);
    const contents = page.getByRole("navigation", {
      name: "Contents",
      exact: true,
    });
    const links = contents.getByRole("link");
    expect(await links.count()).toBeGreaterThan(2);
    expect(
      await links.evaluateAll((anchors) =>
        anchors.every((anchor) => {
          const href = anchor.getAttribute("href");
          return (
            href?.startsWith("#") &&
            Boolean(document.getElementById(href.slice(1)))
          );
        }),
      ),
    ).toBe(true);
    const first = links.first();
    const fragment = await first.getAttribute("href");
    await first.click();
    expect(new URL(page.url()).hash).toBe(fragment);
    await page.reload();
    expect(new URL(page.url()).hash).toBe(fragment);
    await expect(
      page
        .getByRole("contentinfo")
        .getByRole("link", { name: "Technical Guide", exact: true }),
    ).toHaveCount(0);

    const screenshots = page.locator('article img[src^="/guides/"]');
    const sources = await screenshots.evaluateAll((images) =>
      images.map((image) => ({
        src: image.getAttribute("src"),
        alt: image.getAttribute("alt"),
        loading: image.getAttribute("loading"),
      })),
    );
    for (const image of sources) {
      expect(image.alt).toBeTruthy();
      expect(image.loading).toBe("lazy");
      if (!image.src) throw new Error("Missing screenshot source");
      const response = await request.get(image.src);
      expect(response.status(), image.src).toBe(200);
      expect(response.headers()["content-type"]).toContain("image/png");
    }
    if (path.includes("/user-guide/")) {
      expect(sources.length).toBeGreaterThan(10);
      const image = screenshots.first();
      await image.scrollIntoViewIfNeeded();
      await expect
        .poll(() =>
          image.evaluate(
            (element: HTMLImageElement) =>
              element.complete && element.naturalWidth > 0,
          ),
        )
        .toBe(true);
    }
    if (path.startsWith("/tech-guide")) {
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
        "content",
        "noindex, nofollow",
      );
      await expect(
        page.getByRole("navigation", { name: "Guide personas" }),
      ).toHaveCount(0);
      if (path === "/tech-guide") {
        await expect(page.locator("article")).toContainText(
          "CSV uses NAMED_RESPONSE and SUBMITTED_VOTER rows",
        );
        await expect(
          page.getByRole("img", {
            name: "Civic Pulse core entity relationship diagram",
          }),
        ).toHaveCount(1);
        await expect(
          page.getByRole("link", {
            name: "Open the dedicated Error Logging and IDs reference",
          }),
        ).toHaveAttribute("href", "/tech-guide/errors");
      }
      if (path === "/tech-guide/errors") {
        await expect(
          page.getByRole("region", { name: "API error catalogue table" }),
        ).toContainText("RESULTS_INTEGRITY_ERROR");
        await expect(page.locator("article")).toContainText("VOTEADMIN-");
        await expect(page.locator("article")).toContainText(
          "request.unhandled",
        );
      }
    } else {
      await expect(page.locator('a[href="/tech-guide"]')).toHaveCount(0);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
        "content",
        "index, follow",
      );
    }
    if (path === "/user-guide/resident") {
      await expect(page.locator("article")).toContainText("below the message");
      await expect(page.locator("article")).toContainText("RWA administrator");
      await expect(page.locator("article")).toContainText(
        "PUBLIC PDFs and CSVs include the current account email",
      );
      await expect(page.locator("article")).toContainText(
        "PRIVATE PDFs and CSVs include a separate roster",
      );
      await expect(page.locator("article")).toContainText(
        "press and hold the text",
      );
    }
    if (path === "/user-guide/rwa-admin") {
      await expect(page.locator("article")).toContainText(
        "PUBLIC PDFs and CSVs include current Auth emails",
      );
      await expect(page.locator("article")).toContainText(
        "PRIVATE PDFs and CSVs include a separate submitted-voter roster",
      );
      await expect(page.locator("article")).toContainText(
        "deployment operator through the agreed support channel",
      );
      await expect(page.locator("article")).toContainText(
        "never include PRIVATE choices",
      );
      await expect(
        contents.getByRole("link", {
          name: "14. Recover safely from admin failures",
        }),
      ).toHaveAttribute("href", "#admin-failure-recovery");
      await expect(page.locator("article")).toContainText(
        "completed rows are not rolled back",
      );
      await expect(page.locator("article")).toContainText(
        "Review Latest and Keep My Changes",
      );
      await expect(page.locator("article")).toContainText(
        "Discard My Changes and Load Latest",
      );
    }
    for (const width of [320, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(result.violations).toEqual([]);
  });
}

test("persona cross-links, sitemap and retired guide URLs are consistent", async ({
  page,
  request,
}) => {
  await page.goto("/user-guide");
  await page
    .getByRole("link", { name: "Go straight to registration", exact: true })
    .click();
  await expect(page).toHaveURL(/\/user-guide\/resident#registration$/);
  await expect(page.locator("#registration")).toBeVisible();
  const sitemap = await (await request.get("/sitemap.xml")).text();
  for (const [path] of guides.slice(0, 3))
    expect(sitemap).toContain(`${path}</loc>`);
  expect(sitemap).not.toContain("/tech-guide");
  expect(sitemap).not.toContain("/tech-guide/errors");
  for (const path of [
    "/user-guide.html",
    "/TECHNICAL_GUIDE.html",
    "/user-guide/rwa-readonly",
    "/user-guide/unknown",
  ]) {
    expect((await request.get(path)).status()).toBe(404);
  }
});
