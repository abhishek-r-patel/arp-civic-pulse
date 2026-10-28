// Real-browser full pagination across every authorized list surface on a disposable project.
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import {
  activateVoteFor,
  asUser,
  freshCode,
  provisionAdmin,
  seedHousehold,
  signInThroughUi,
} from "./support/live";

test.skip(
  process.env.LIVE_AUTH !== "1",
  "Requires explicit disposable-project opt-in.",
);
test("full pagination works across all six list screens", async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const admin = await provisionAdmin();
  const resident = await seedHousehold();
  const neighbour = await seedHousehold();
  const vote = await activateVoteFor(admin.id, [
    resident.householdId,
    neighbour.householdId,
  ]);
  await activateVoteFor(admin.id, [resident.householdId]);
  for (const person of [resident, neighbour]) {
    await asUser(person.id, "public.cast_vote($1, $2::jsonb)", [
      vote.id,
      JSON.stringify({ confirmed: true, optionId: vote.options[0]?.id }),
    ]);
  }
  await asUser(
    admin.id,
    "public.complete_vote_early($1, true, 'Synthetic pagination fixture')",
    [vote.id],
  );
  const context = await browser.newContext();
  const memberContext = await browser.newContext();
  let page = await context.newPage();
  page.setDefaultTimeout(30_000);
  try {
    await signInThroughUi(page, admin.email, admin.code);
    const adminRoutes = [
      "/admin/residents?isAdmin=all&limit=1",
      "/admin/votes?votingType=PUBLIC&limit=1",
      "/admin/audit?action=VOTE_ACTIVATED&limit=1",
      `/admin/votes/${vote.id}/participation?submitted=true&limit=1`,
      `/votes/${vote.id}/results?limit=1`,
    ];
    async function check(route: string) {
      await page.goto(route);
      const nav = page.getByRole("navigation", { name: "Pagination" });
      await expect(nav).toBeVisible();
      const summary = await nav.innerText();
      const total = Number(/· (\d+) results/u.exec(summary)?.[1]);
      expect(total).toBeGreaterThanOrEqual(2);
      await expect(nav).toContainText(`Page 1 of ${total}`);
      await nav.getByRole("link", { name: "Next page" }).click();
      await expect(nav).toContainText(`Page 2 of ${total}`);
      const url = new URL(page.url());
      for (const [key, value] of new URL(route, "http://example.test")
        .searchParams) {
        expect(url.searchParams.get(key)).toBe(value);
      }
      await nav.getByRole("link", { name: "Previous page" }).click();
      await expect(nav).toContainText(`Page 1 of ${total}`);
      await nav.getByRole("link", { name: "Last page" }).click();
      await expect(nav).toContainText(`Page ${total} of ${total}`);
      await expect(
        nav.getByLabel("Next page", { exact: true }),
      ).toHaveAttribute("aria-disabled", "true");
      await nav.getByRole("link", { name: "First page" }).click();
      await nav.getByLabel("Per page").selectOption("10");
      await expect(page).toHaveURL(/[?&]limit=10(?:&|$)/u);
      await expect(nav).toContainText("Page 1 of");
      expect(new URL(page.url()).searchParams.get("limit")).toBe("10");
      expect(new URL(page.url()).searchParams.has("page")).toBe(false);
    }
    for (const route of adminRoutes) await check(route);
    await page.goto("/admin/residents?isAdmin=all&limit=1");
    const firstCheckbox = page
      .locator("[data-account-review] tbody input[type=checkbox]")
      .first();
    if (await firstCheckbox.isEnabled()) {
      await firstCheckbox.check();
      await page.getByRole("link", { name: "Next page" }).click();
      await expect(
        page
          .locator("[data-account-review] tbody input[type=checkbox]")
          .first(),
      ).not.toBeChecked();
    }
    await page.goto("/admin/residents?identifier=NO-SYNTHETIC-MATCH");
    await expect(
      page.getByRole("navigation", { name: "Pagination" }),
    ).toContainText("Page 1 of 1 · 0 results");
    await page.goto("/admin/residents?isAdmin=all&limit=100&page=1000000");
    await expect(
      page
        .getByRole("navigation", { name: "Pagination" })
        .getByLabel("Next page", { exact: true }),
    ).toHaveAttribute("aria-disabled", "true");
    for (const mode of ["Light", "Dark"] as const) {
      const menu = page.locator("details[data-theme-control]");
      if ((await menu.getAttribute("open")) === null)
        await menu.locator("summary").click();
      await menu.getByRole("radio", { name: mode, exact: true }).check();
      await page.keyboard.press("Escape");
      for (const width of [320, 375, 768, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        const layout = await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth > innerWidth,
          elements: [...document.querySelectorAll("body *")]
            .filter(
              (element) =>
                element.getBoundingClientRect().right > innerWidth + 1,
            )
            .slice(0, 8)
            .map((element) => ({
              tag: element.tagName,
              class: element.className,
            })),
        }));
        expect(
          layout.overflow,
          `${mode} ${width}px: ${JSON.stringify(layout.elements)}`,
        ).toBe(false);
      }
      await page.setViewportSize({ width: 375, height: 900 });
      const audit = await new AxeBuilder({ page })
        .include('nav[aria-label="Pagination"]')
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(audit.violations).toEqual([]);
    }
    page = await memberContext.newPage();
    page.setDefaultTimeout(30_000);
    await signInThroughUi(
      page,
      resident.email,
      await freshCode(resident.email),
    );
    await check("/?limit=1");
  } finally {
    await context.close();
    await memberContext.close();
  }
});
