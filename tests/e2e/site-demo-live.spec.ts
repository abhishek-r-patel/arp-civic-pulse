// S05/S06 hosted checks: the product website and the shared, writable synthetic
// demo on their own hosts. Needs a deployed directory with main and demo entries
// and a demo project seeded by `npm run ops -- demo-reset`. Read-only checks, so
// running them leaves the seeded demo unchanged.
import { expect, test } from "@playwright/test";
import { isErrorId } from "../../src/shared/observability/error-id";
import { DEMO_PERSONAS } from "../../src/shared/demo";

const mainOrigin = process.env.SITE_HTTP_MAIN_ORIGIN ?? "";
const demoOrigin = process.env.SITE_HTTP_DEMO_ORIGIN ?? "";

test.describe("product website and demo hosts", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(
    process.env.SITE_DEMO_HTTP_TEST !== "1" || !mainOrigin || !demoOrigin,
    "Set SITE_DEMO_HTTP_TEST=1, SITE_HTTP_MAIN_ORIGIN and SITE_HTTP_DEMO_ORIGIN.",
  );
  test.setTimeout(120_000);

  test("the product website serves only its own pages and no app API", async ({
    page,
    request,
  }) => {
    await page.goto(`${mainOrigin}/`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Try the demo/u }).first(),
    ).toHaveAttribute("href", new RegExp(`^${demoOrigin}`, "u"));
    await expect(
      page.getByText(/contact us for a quote/iu).first(),
    ).toBeVisible();

    for (const path of ["/contact", "/privacy"]) {
      expect(
        (
          await request.get(`${mainOrigin}${path}`, { timeout: 30_000 })
        ).status(),
      ).toBe(200);
    }
    for (const path of ["/sign-in", "/register", "/admin", "/user-guide"]) {
      expect(
        (
          await request.get(`${mainOrigin}${path}`, { timeout: 30_000 })
        ).status(),
      ).toBe(404);
    }
    const api = await request.get(`${mainOrigin}/api/votes`);
    expect(api.status()).toBe(404);
    expect(isErrorId((await api.json()).requestId)).toBe(true);
    expect(
      (await request.get(`${mainOrigin}/api/internal/health`)).status(),
    ).toBe(200);
    const sitemap = await (
      await request.get(`${mainOrigin}/sitemap.xml`)
    ).text();
    expect(sitemap).toContain(`${mainOrigin}/contact`);
    expect(sitemap).not.toContain(demoOrigin);
  });

  test("demo visitors sign in as a persona and cannot trigger email", async ({
    page,
    request,
  }) => {
    const robots = await (await request.get(`${demoOrigin}/robots.txt`)).text();
    expect(robots).toMatch(/Disallow: \/\s*$/mu);

    // Registration is replaced by a notice; nothing can be submitted.
    await page.goto(`${demoOrigin}/register`);
    await expect(
      page.getByText("Registration is turned off in the demo"),
    ).toBeVisible();

    await page.goto(`${demoOrigin}/sign-in`);
    await expect(page.getByText(/fictional/iu).first()).toBeVisible();
    await expect(page.getByLabel(/email/iu)).toHaveCount(0);
    await page
      .getByRole("button", { name: DEMO_PERSONAS.resident.label })
      .click();
    // A cold demo sign-in makes two Auth calls before redirecting.
    await expect(page).toHaveURL(`${demoOrigin}/`, { timeout: 30_000 });
    await expect(
      page.getByRole("link", { name: /solar lights/iu }).first(),
    ).toBeVisible();

    // The only refused writes are the email-sending routes.
    const email = await page.request.post(`${demoOrigin}/api/auth/code`, {
      headers: { origin: demoOrigin },
      data: { email: "someone@example.com" },
    });
    expect(email.status()).toBe(403);
    expect((await email.json()).error.code).toBe("DEMO_EMAIL_DISABLED");
  });

  test("the RWA admin persona sees seeded drafts and pending registrations", async ({
    page,
  }) => {
    await page.goto(`${demoOrigin}/sign-in`);
    await page.getByRole("button", { name: DEMO_PERSONAS.admin.label }).click();
    await expect(page).toHaveURL(`${demoOrigin}/`, { timeout: 30_000 });
    await page.goto(`${demoOrigin}/admin/votes`);
    await expect(
      page.getByText("Festival celebration plan").first(),
    ).toBeVisible();
    await page.goto(`${demoOrigin}/admin/residents?selfRegistered=true`);
    await expect(page.getByText("Rohan Demo").first()).toBeVisible();
  });

  test("the committee persona sees administration screens read-only", async ({
    page,
  }) => {
    await page.goto(`${demoOrigin}/sign-in`);
    await page
      .getByRole("button", { name: DEMO_PERSONAS.committee.label })
      .click();
    await expect(page).toHaveURL(`${demoOrigin}/`, { timeout: 30_000 });
    await page.goto(`${demoOrigin}/admin/votes`);
    await expect(
      page.getByText("Committee election 2026").first(),
    ).toBeVisible();
  });

  test("simultaneous visitors can all use the same persona", async ({
    browser,
  }) => {
    const contexts = await Promise.all(
      Array.from({ length: 4 }, () => browser.newContext()),
    );
    try {
      const pages = await Promise.all(contexts.map((c) => c.newPage()));
      await Promise.all(pages.map((p) => p.goto(`${demoOrigin}/sign-in`)));
      await Promise.all(
        pages.map((p) =>
          p.getByRole("button", { name: DEMO_PERSONAS.resident.label }).click(),
        ),
      );
      for (const p of pages) {
        await expect(p).toHaveURL(`${demoOrigin}/`, { timeout: 30_000 });
      }
    } finally {
      await Promise.all(contexts.map((c) => c.close()));
    }
  });

  test("main and demo pages fit a phone screen without sideways scrolling", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    for (const url of [
      `${mainOrigin}/`,
      `${mainOrigin}/contact`,
      `${mainOrigin}/privacy`,
      `${demoOrigin}/sign-in`,
      `${demoOrigin}/register`,
    ]) {
      await page.goto(url);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow, url).toBeLessThanOrEqual(0);
    }
  });
});
