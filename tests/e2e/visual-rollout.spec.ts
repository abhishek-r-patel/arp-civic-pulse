/* Real-screen visual/accessibility regression checks; temporary images only, never guide captures. */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  asUser,
  ensureFixturePolicy,
  freshCode,
  provisionAdmin,
  seedHousehold,
  signInThroughUi,
} from "./support/live";

test.use({
  trace: "off",
  video: "off",
  screenshot: "off",
  actionTimeout: 20000,
  navigationTimeout: 45000,
});

async function appearance(page: Page, mode: "Light" | "Dark") {
  const menu = page.locator("details[data-theme-control]");
  await expect(menu).toHaveAttribute("data-theme-ready", "true");
  if ((await menu.getAttribute("open")) === null)
    await menu.locator("summary").click();
  await menu.getByRole("radio", { name: mode, exact: true }).check();
  await page.keyboard.press("Escape");
  await expect(page.locator("html")).toHaveAttribute(
    "data-theme",
    mode.toLowerCase(),
  );
}

async function checkSurface(page: Page, label: string) {
  await page.evaluate(() => document.fonts.ready);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await expect(
    page.getByRole("heading", { level: 1, includeHidden: true }),
  ).toHaveCount(1);
  const audit = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(audit.violations, label).toEqual([]);
  await page.screenshot({
    path: test.info().outputPath(`${label}.png`),
    fullPage: true,
    animations: "disabled",
    mask: [
      page.getByText(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu),
      page.locator('input[type="email"], input[autocomplete="one-time-code"]'),
    ],
    maskColor: "#CBD5E1",
  });
}

test("public screens retain readable Platinum/Obsidian layouts", async ({
  page,
}) => {
  test.setTimeout(180000);
  for (const mode of ["Light", "Dark"] as const) {
    for (const width of [375, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      for (const route of [
        "/sign-in",
        "/privacy",
        "/contact",
        "/unknown-visual-route",
      ]) {
        await page.goto(route);
        await appearance(page, mode);
        await checkSurface(page, `public-${route.slice(1)}-${mode}-${width}`);
      }
    }
  }
});

test("all administrator and resident workflows share the approved visual language", async ({
  browser,
}) => {
  test.skip(
    process.env.LIVE_AUTH !== "1",
    "Explicitly opt in only on the confirmed disposable project.",
  );
  test.setTimeout(480000);
  const admin = await provisionAdmin("Visual Rollout Administrator (example)");
  const resident = await seedHousehold();
  await ensureFixturePolicy(admin.id);
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const members = await browser.newContext({
    viewport: { width: 375, height: 900 },
  });
  const page = await context.newPage();
  const member = await members.newPage();
  const drafts: { id: string; type: "PUBLIC" | "PRIVATE" }[] = [];
  try {
    for (const type of ["PUBLIC", "PRIVATE"] as const) {
      const draft = await asUser<{ id: string }>(
        admin.id,
        "public.create_draft($1)",
        [type],
      );
      drafts.push({ id: draft.id, type });
      await asUser(admin.id, "public.update_draft($1, 1, $2::jsonb)", [
        draft.id,
        JSON.stringify({
          title: `Visual ${type} example`,
          instructions: "Synthetic visual verification only.",
          closesAt: new Date(Date.now() + 172800000).toISOString(),
          eligibleHouseholdIds: [resident.householdId],
          ...(type === "PUBLIC"
            ? {
                openSelectionMode: "MULTIPLE",
                openSelectionLimit: 2,
                options: [
                  { label: "Saturday", position: 1 },
                  { label: "Sunday", position: 2 },
                ],
              }
            : {
                offices: [
                  {
                    name: "Chair",
                    position: 1,
                    candidates: [{ name: "Asha (example)", position: 1 }],
                  },
                ],
              }),
        }),
      ]);
    }
    await signInThroughUi(page, admin.email, admin.code);
    const publicVote = drafts[0];
    const privateVote = drafts[1];
    if (!publicVote || !privateVote)
      throw new Error("Visual fixtures are missing.");
    const adminRoutes = [
      "/admin",
      "/admin/accounts",
      "/admin/accounts/new",
      `/admin/accounts/${resident.id}`,
      "/admin/households",
      "/admin/households/import",
      `/admin/households/${resident.householdId}`,
      "/admin/settings",
      "/admin/audit",
      "/admin/votes",
      "/admin/votes/new",
      `/admin/votes/${publicVote.id}`,
      `/admin/votes/${privateVote.id}`,
      `/admin/votes/${publicVote.id}/preview`,
    ];
    for (const mode of ["Light", "Dark"] as const) {
      await page.setViewportSize({ width: 1280, height: 900 });
      for (const [index, route] of adminRoutes.entries()) {
        await page.goto(route);
        await appearance(page, mode);
        await checkSurface(page, `admin-${index}-${mode}-desktop`);
      }
    }
    await page.setViewportSize({ width: 375, height: 900 });
    for (const [index, route] of adminRoutes.entries()) {
      await page.goto(route);
      await appearance(page, "Dark");
      await checkSurface(page, `admin-${index}-dark-phone`);
    }
    for (const vote of drafts)
      await asUser(admin.id, "public.activate_vote($1, 2, true)", [vote.id]);
    await signInThroughUi(
      member,
      resident.email,
      await freshCode(resident.email),
    );
    for (const vote of drafts) {
      await member.goto(`/votes/${vote.id}`);
      await appearance(member, "Dark");
      await checkSurface(member, `${vote.type}-ballot-phone`);
      if (vote.type === "PUBLIC")
        await member
          .getByRole("checkbox", { name: "Saturday", exact: true })
          .check();
      else
        await member
          .getByRole("radio", { name: "NOTA (None of the Above)", exact: true })
          .check();
      await member
        .getByRole("button", { name: "Review Selections", exact: true })
        .click();
      await checkSurface(member, `${vote.type}-review-phone`);
      await member
        .getByRole("button", { name: "Submit Vote", exact: true })
        .click();
      await expect(
        member.getByRole("heading", {
          name:
            vote.type === "PUBLIC"
              ? "Your vote is recorded."
              : "Vote submitted.",
          exact: true,
        }),
      ).toBeVisible();
      await checkSurface(member, `${vote.type}-accepted-phone`);
      await member.goto(`/votes/${vote.id}/results`);
      await checkSurface(member, `${vote.type}-live-results-phone`);
      await page.goto(`/admin/votes/${vote.id}`);
      await checkSurface(page, `${vote.type}-active-management-phone`);
      await page
        .getByRole("button", { name: "Change Deadline", exact: true })
        .click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await checkSurface(page, `${vote.type}-deadline-dialog-phone`);
      await page.keyboard.press("Escape");
      await page.goto(`/admin/votes/${vote.id}/participation`);
      await checkSurface(page, `${vote.type}-participation-phone`);
      await asUser(
        admin.id,
        "public.complete_vote_early($1, true, 'Synthetic visual example completed')",
        [vote.id],
      );
      for (const mode of ["Light", "Dark"] as const) {
        await member.goto(`/votes/${vote.id}/results`);
        await appearance(member, mode);
        await checkSurface(
          member,
          `${vote.type}-completed-results-${mode}-phone`,
        );
      }
    }
  } finally {
    for (const vote of drafts) {
      const current = await asUser<{ status: string }>(
        admin.id,
        "public.get_admin_vote($1)",
        [vote.id],
      );
      if (current.status === "ACTIVE")
        await asUser(
          admin.id,
          "public.cancel_vote($1, true, 'Visual test cleanup')",
          [vote.id],
        );
    }
    await context.close();
    await members.close();
  }
});
