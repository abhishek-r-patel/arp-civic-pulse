// Public rendering, accessibility, security boundaries and launch metadata checks.
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// Phone, tablet and laptop widths from docs/DESIGN_SYSTEM.md, plus intermediate sizes.
const widths = [320, 375, 430, 640, 768, 1024, 1280, 1440];

test("app pages publish the selected conversation-check favicon", async ({
  page,
  request,
}) => {
  await page.goto("/sign-in");
  const icon = page.locator('link[rel="icon"][type="image/svg+xml"]');
  await expect(icon).toHaveAttribute("href", /^\/icon\.svg/);
  await expect(icon).toHaveAttribute("sizes", "any");
  const href = await icon.getAttribute("href");
  if (!href) throw new Error("Missing favicon URL");
  const response = await request.get(href);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("image/svg+xml");
  const image = await response.text();
  expect(image).toContain('viewBox="0 0 64 64"');
  expect(image).toContain('d="M13 13h38v29H31L19 53V42h-6z"');
  expect(image).toContain('fill="#0f766e"');
});

test("footer opens the illustrated user guide with working contents and embedded screenshots", async ({
  page,
  request,
}) => {
  await page.goto("/sign-in");
  const guideLink = page
    .getByRole("navigation", { name: "Information" })
    .getByRole("link", { name: "User Guide", exact: true });
  await expect(guideLink).toHaveAttribute("href", "/user-guide.html");
  await guideLink.click();
  await expect(page).toHaveURL(/\/user-guide\.html$/);
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Civic Pulse - User Guide",
  );
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    "noindex, follow",
  );
  await expect(page.locator("script")).toHaveCount(0);
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute(
    "href",
    "/icon.svg",
  );
  await expect(
    page.locator(
      'a[href*="TECHNICAL_GUIDE"], a[href*="LAUNCH_AUDIT"], a[href$=".md"]',
    ),
  ).toHaveCount(0);
  const contents = page.getByRole("navigation", { name: "Contents" });
  await contents
    .getByRole("link", {
      name: "Shared Sign-In and Appearance",
      exact: true,
    })
    .click();
  await expect(page).toHaveURL(/#shared-sign-in-and-appearance$/);
  const screenshot = page.getByRole("img", {
    name: /^Resident 01: registered email sign-in/,
  });
  await screenshot.scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      screenshot.evaluate(
        (image: HTMLImageElement) => image.complete && image.naturalWidth > 0,
      ),
    )
    .toBe(true);
  await expect(screenshot).toHaveAttribute("alt", /registered email sign-in/);
  await expect(screenshot).toHaveAttribute("loading", "lazy");
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
      ),
    ).toBe(false);
    await page.screenshot({
      path: test.info().outputPath(`user-guide-${width}.png`),
    });
  }
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(result.violations).toEqual([]);
  expect((await request.get("/user-guide.html")).status()).toBe(200);
  expect(await page.locator('img[src^="data:image/"]').count()).toBeGreaterThan(
    100,
  );
  for (const name of [
    "RWA Admin 54: validated CSV import preview",
    "RWA ReadOnly 01: Votes home in Platinum with committee access",
  ]) {
    const updatedImage = page.getByRole("img", {
      name,
    });
    await expect(updatedImage).toHaveCount(1);
    await updatedImage.scrollIntoViewIfNeeded();
    await expect
      .poll(() =>
        updatedImage.evaluate(
          (image: HTMLImageElement) =>
            image.complete && image.naturalWidth > 0 && image.naturalHeight > 0,
        ),
      )
      .toBe(true);
  }
  await page.getByRole("link", { name: "Back to Civic Pulse" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
});

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

    const footer = page.getByRole("contentinfo");
    await expect(
      footer.getByRole("navigation", { name: "Information" }).getByRole("link"),
    ).toHaveText([
      "Sign In",
      "Register",
      "User Guide",
      "Privacy Policy",
      "Contact",
    ]);
    const credit = footer.getByText("Civic Pulse By Abhishek Patel", {
      exact: true,
    });
    await expect(credit).toBeVisible();
    const alignment = await credit.evaluate((element) => {
      const container = element.parentElement;
      if (!container) throw new Error("Missing footer layout container");
      const navigation = container.querySelector("nav");
      if (!navigation) throw new Error("Missing footer navigation");
      const bounds = element.getBoundingClientRect();
      const layout = container.getBoundingClientRect();
      return {
        stacked: bounds.top >= navigation.getBoundingClientRect().bottom,
        textAlign: getComputedStyle(element).textAlign,
        centerGap: Math.abs(
          (bounds.left + bounds.right - layout.left - layout.right) / 2,
        ),
        rightGap: Math.abs(layout.right - bounds.right),
      };
    });
    expect(alignment.textAlign).toBe(alignment.stacked ? "center" : "right");
    expect(
      alignment.stacked ? alignment.centerGap : alignment.rightGap,
    ).toBeLessThanOrEqual(1);

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
    "/admin/residents",
    "/admin/residents/new",
    "/admin/residents/import",
  ]) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/sign-in$/u);
  }
});

test("removed Accounts and Flats UI routes return 404 without redirects", async ({
  request,
}) => {
  const id = "00000000-0000-4000-8000-000000000001";
  for (const path of [
    "/admin/accounts",
    "/admin/accounts?status=SUSPENDED",
    "/admin/accounts/new",
    `/admin/accounts/${id}`,
    "/admin/households",
    "/admin/households?identifier=A-101",
    "/admin/households/import",
    `/admin/households/${id}`,
    `/admin/residents/households/${id}`,
  ]) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status(), path).toBe(404);
    expect(response.headers()["location"], path).toBeUndefined();
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

test("public pages render unique crawlable metadata, one H1, schema and canonical links", async ({
  page,
  request,
  baseURL,
}) => {
  const titles = new Set<string>();
  const descriptions = new Set<string>();
  for (const [path, heading] of [
    ["/sign-in", "Sign in"],
    ["/privacy", "Privacy policy"],
    ["/contact", "Contact"],
  ]) {
    const html = await (await request.get(path ?? "")).text();
    expect(html).toMatch(new RegExp(`<h1[^>]*>${heading}</h1>`));
    await page.goto(path ?? "");
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page).toHaveTitle(`${heading} | Civic Pulse`);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      `${baseURL}${path}`,
    );
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      "index, follow",
    );
    await expect(
      page.locator('meta[property="og:image"]').first(),
    ).toHaveAttribute("content", /\/opengraph-image/);
    const description = await page
      .locator('meta[name="description"]')
      .getAttribute("content");
    expect(description).toBeTruthy();
    titles.add(await page.title());
    descriptions.add(description ?? "");
    const schemas = await page
      .locator('script[type="application/ld+json"]')
      .allTextContents();
    expect(
      schemas.some((schema) =>
        JSON.parse(schema)["@graph"].some(
          (entry: { "@type": string }) => entry["@type"] === "Organization",
        ),
      ),
    ).toBe(true);
    await expect(
      page.getByRole("navigation", { name: "Breadcrumb" }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("navigation", { name: "Information" })
        .getByRole("link", { name: "Privacy Policy" }),
    ).toBeVisible();
    expect(await page.locator("img:not([alt])").count()).toBe(0);
  }
  expect(titles.size).toBe(3);
  expect(descriptions.size).toBe(3);
  if (process.env.GOOGLE_SITE_VERIFICATION) {
    await expect(
      page.locator('meta[name="google-site-verification"]'),
    ).toHaveAttribute("content", process.env.GOOGLE_SITE_VERIFICATION);
  }
});

test("robots and sitemap expose only the public information routes", async ({
  request,
  baseURL,
}) => {
  const robots = await request.get("/robots.txt");
  expect(robots.status()).toBe(200);
  const text = await robots.text();
  expect(text).toContain("Disallow: /");
  expect(text).toContain("Allow: /sign-in$");
  expect(text).toContain(`Sitemap: ${baseURL}/sitemap.xml`);
  const sitemap = await request.get("/sitemap.xml");
  expect(sitemap.status()).toBe(200);
  const xml = await sitemap.text();
  expect(xml.match(/<loc>/g)).toHaveLength(3);
  for (const path of ["/sign-in", "/privacy", "/contact"])
    expect(xml).toContain(`${baseURL}${path}</loc>`);
  expect(xml).not.toContain("/admin");
  expect(xml).not.toContain("/votes");
});

test("public Open Graph image is a real 1200 by 630 PNG", async ({
  request,
}) => {
  const response = await request.get("/opengraph-image");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("image/png");
  const image = await response.body();
  expect(image.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  expect(image.readUInt32BE(16)).toBe(1200);
  expect(image.readUInt32BE(20)).toBe(630);
});

for (const width of [375, 1280]) {
  test(`privacy, contact and register reflow and pass automated accessibility at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ["/privacy", "/contact", "/register"]) {
      await page.goto(path);
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth >
            document.documentElement.clientWidth,
        ),
      ).toBe(false);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(results.violations).toEqual([]);
      await page.screenshot({
        path: test.info().outputPath(`${width}-${path.slice(1)}.png`),
        fullPage: true,
      });
    }
  });
}

test("contact form preserves failed enquiries and acknowledges only accepted sends", async ({
  page,
}) => {
  await page.goto("/contact");
  if (await page.getByText("Online contact is not available yet").isVisible()) {
    await expect(
      page.getByRole("button", { name: "Send Message" }),
    ).toHaveCount(0);
    return;
  }
  await page.getByLabel("Name", { exact: false }).fill("Synthetic Resident");
  await page.getByLabel("Reply email address").fill("resident@example.test");
  await page
    .getByLabel("Message", { exact: false })
    .fill("Synthetic browser contact test message.");
  await page.route("**/api/contact", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "DEPENDENCY_UNAVAILABLE",
          message: "Sending is temporarily unavailable.",
        },
        requestId: "synthetic-support-id",
      }),
    }),
  );
  await page.getByRole("button", { name: "Send Message" }).click();
  await expect(
    page.getByText(
      "The service is temporarily unavailable. Try again in a moment.",
    ),
  ).toBeVisible();
  await expect(page.getByLabel("Message", { exact: false })).toHaveValue(
    "Synthetic browser contact test message.",
  );
  await page.unroute("**/api/contact");
  await page.route("**/api/contact", (route) =>
    route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          message:
            "Accepted by the email service; inbox delivery is not yet confirmed.",
        },
        requestId: "synthetic-support-id",
      }),
    }),
  );
  await page.getByRole("button", { name: "Send Message" }).click();
  await expect(page.getByRole("status")).toContainText("Message accepted");
  await expect(page.getByRole("button", { name: "Send Message" })).toHaveCount(
    0,
  );
});

test("analytics never loads before consent or on sign-in", async ({ page }) => {
  const trackingRequests: string[] = [];
  page.on("request", (request) => {
    if (/google-analytics|googletagmanager/.test(request.url()))
      trackingRequests.push(request.url());
  });
  await page.goto("/privacy");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.goto("/sign-in");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(trackingRequests).toEqual([]);
  await expect(page.locator('script[src*="googletagmanager"]')).toHaveCount(0);
});

test("optional analytics excludes query strings and is disabled on private workflows", async ({
  page,
}) => {
  await page.route("https://www.googletagmanager.com/**", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: "/* Controlled provider script; no external collection. */",
    }),
  );
  await page.route(
    (url) =>
      url.protocol === "https:" &&
      (url.hostname === "google-analytics.com" ||
        url.hostname.endsWith(".google-analytics.com")),
    (route) => route.abort(),
  );
  await page.goto("/privacy?email=synthetic-private-value");
  const toggle = page.getByRole("checkbox", {
    name: "Allow optional Google Analytics",
  });
  if (!(await toggle.isVisible())) return;
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  const script = page.locator('script[src*="googletagmanager"]');
  await expect(script).toHaveCount(1);
  await expect
    .poll(() => page.evaluate(() => JSON.stringify(window.dataLayer)))
    .toContain('"page_view"');
  const events = await page.evaluate(() => JSON.stringify(window.dataLayer));
  expect(events).not.toContain("synthetic-private-value");
  expect(events).toContain('"send_page_view":false');
  expect(events).toContain('"page_referrer":""');
  await page.evaluate(() => {
    document.cookie = "_ga=synthetic-cookie; Path=/";
  });
  await toggle.uncheck();
  expect(await page.evaluate(() => document.cookie)).not.toContain("_ga=");
  await toggle.check();
  await page
    .getByRole("navigation", { name: "Information" })
    .getByRole("link", { name: "Sign In", exact: true })
    .click();
  await expect(page).toHaveURL(/\/sign-in$/);
  expect(await page.evaluate(() => typeof window.gtag)).toBe("undefined");
  await expect(page.locator('script[src*="googletagmanager"]')).toHaveCount(0);
});
