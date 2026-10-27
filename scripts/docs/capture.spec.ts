// Explicitly opted-in, synthetic documentation captures; screenshots redact emails and codes.
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { instantToLocalInput } from "../../src/shared/time/zoned";
import {
  asUser,
  ensureFixturePolicy,
  freshCode,
  plusEmail,
  provisionAdmin,
  seedHousehold,
  unusedIdentifier,
  signInThroughUi,
  stubCodeRequest,
} from "../../tests/e2e/support/live";

test.skip(
  process.env.DOC_SCREENSHOTS !== "1" || process.env.LIVE_AUTH !== "1",
  "Opt in with DOC_SCREENSHOTS=1 and LIVE_AUTH=1 on the disposable test project only.",
);

const images = join(process.cwd(), "docs", "images", "user-guide");

async function capture(page: Page, name: string, dialogOnly = false, viewportOnly = false) {
  await page.waitForLoadState("networkidle");
  // Only email/code fields holding a value are redacted, so an intentionally
  // blank optional field (such as the RWA email) is shown as blank.
  await page.evaluate(() => {
    for (const input of document.querySelectorAll<HTMLInputElement>(
      'input[type="email"], input[autocomplete="one-time-code"]',
    )) {
      input.toggleAttribute("data-doc-mask", input.value !== "");
    }
  });
  const target = dialogOnly ? page.getByRole("dialog") : page;
  await target.screenshot({
    path: join(images, `${name}.png`),
    ...(dialogOnly ? {} : { fullPage: !viewportOnly }),
    animations: "disabled",
    style: "nextjs-portal { display: none !important; }",
    mask: [
      page.getByText(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu),
      page.locator("[data-doc-mask]"),
    ],
    maskColor: "#CBD5E1",
  });
}

test("capture Platinum and Obsidian first-slice documentation", async ({ browser }) => {
  test.setTimeout(300_000);
  const admin = await provisionAdmin("Appearance Review Administrator (example)");
  const resident = await seedHousehold();
  const neighbour = await seedHousehold();
  await ensureFixturePolicy(admin.id);
  const previous = await asUser<Record<string, unknown>>(admin.id, "public.get_rwa_profile()");
  const adminContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const residentContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const publicContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const a = await adminContext.newPage();
  const r = await residentContext.newPage();
  const p = await publicContext.newPage();
  const votes: string[] = [];
  async function appearance(page: Page, mode: "Light" | "Dark" | "System") {
    const menu = page.locator("details[data-theme-control]");
    if (await menu.getAttribute("open") === null) await menu.locator("summary").click();
    await menu.getByRole("radio", { name: mode, exact: true }).check();
    await page.keyboard.press("Escape");
    await page.evaluate(() => document.fonts.ready);
  }
  async function accessible(page: Page) {
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(result.violations).toEqual([]);
  }
  try {
    await asUser(admin.id, "public.update_rwa_profile($1::jsonb)", [JSON.stringify({ ...previous,
      fullName: "Lakeview Residents Welfare Association", alias: "Lakeview RWA",
      address: "1 Example Lake Road, Sample City 000000", email: "", phone: "+91 123 456 7890", website: "",
      householdLabel: "Flat", identifierKind: "NUMBER", accentPalette: "TEAL", welcomeMessage: "",
    })]);
    for (const type of ["PUBLIC", "PRIVATE"] as const) {
      const draft = await asUser<{ id: string }>(admin.id, "public.create_draft($1)", [type]);
      votes.push(draft.id);
      const prepared = await asUser<{ options: { id: string }[] }>(admin.id, "public.update_draft($1, 1, $2::jsonb)", [draft.id, JSON.stringify({
        title: type === "PUBLIC" ? "Should we repaint the clubhouse?" : "Elect your next committee",
        instructions: type === "PUBLIC" ? "Review the proposal before choosing your response." : "Choose one candidate or NOTA for every office.",
        closesAt: new Date(Date.now() + 172_800_000).toISOString(), eligibleHouseholdIds: [resident.householdId, neighbour.householdId],
        ...(type === "PUBLIC" ? { options: [{ label: "Yes", position: 1 }, { label: "No", position: 2 }] } : {
          offices: [{ name: "Chair", position: 1, candidates: [{ name: "Asha (example)", position: 1 }, { name: "Ravi (example)", position: 2 }] }],
        }),
      })]);
      await asUser(admin.id, "public.activate_vote($1, 2, true)", [draft.id]);
      if (type === "PUBLIC") {
        const option = prepared.options[0];
        if (!option) throw new Error("Synthetic PUBLIC option is missing.");
        await asUser(resident.id, "public.cast_vote($1, $2::jsonb)", [draft.id, JSON.stringify({ confirmed: true, optionId: option.id })]);
      }
    }
    const scheduled = await asUser<{ id: string }>(admin.id, "public.create_draft('PUBLIC')");
    votes.push(scheduled.id);
    await asUser(admin.id, "public.update_draft($1, 1, $2::jsonb)", [scheduled.id, JSON.stringify({
      title: "Which meeting date suits you?", closesAt: new Date(Date.now() + 259_200_000).toISOString(),
      options: [{ label: "Saturday", position: 1 }, { label: "Sunday", position: 2 }], eligibleHouseholdIds: [resident.householdId],
    })]);
    await asUser(admin.id, "public.schedule_vote($1, 2, true, $2)", [scheduled.id, new Date(Date.now() + 86_400_000).toISOString()]);
    await signInThroughUi(r, resident.email, await freshCode(resident.email));
    const overview = r.getByRole("region", { name: "Your vote overview" });
    await expect(overview.locator("dl > div").nth(0).locator("dd").first()).toHaveText("02");
    await expect(overview.locator("dl > div").nth(1).locator("dd").first()).toHaveText("01");
    await expect(overview.locator("dl > div").nth(2).locator("dd").first()).toHaveText("01");
    await expect(r.getByText("1 / 2", { exact: true })).toBeVisible();
    await expect(r.getByText("50% turnout", { exact: true })).toBeVisible();
    await expect(r.getByRole("link", { name: /^View Live Results/ })).toBeVisible();
    await expect(r.getByText("Asha (example)", { exact: true })).toHaveCount(0);
    await signInThroughUi(a, admin.email, admin.code);
    await expect(a.getByRole("region", { name: "Your vote overview" }).locator("dl > div").nth(0).locator("dd").first()).toHaveText("00");
    await a.goto("/admin/accounts?status=SUSPENDED");
    const selectable = a.locator("[data-account-review] tbody input[type=checkbox]:not(:disabled)").first();
    if (await selectable.count()) await selectable.check();
    for (const mode of ["Light", "Dark"] as const) {
      await appearance(r, mode); await appearance(a, mode);
      await accessible(r); await accessible(a);
      await capture(r, mode === "Light" ? "68-platinum-votes" : "69-obsidian-votes");
      await capture(a, mode === "Light" ? "70-platinum-accounts" : "71-obsidian-accounts", false, true);
      if (mode === "Light") await capture(a, "47-accounts-list", false, true);
    }
    await r.setViewportSize({ width: 390, height: 844 });
    await appearance(r, "Light"); await capture(r, "05-vote-list");
    await appearance(r, "Dark");
    await accessible(r); await capture(r, "72-obsidian-votes-mobile");
    await r.getByRole("navigation", { name: "Vote status" }).getByRole("link", { name: "Active", exact: true }).click();
    await r.locator("summary[aria-label='Voting type filter']").click();
    await r.getByLabel("Voting type", { exact: true }).selectOption("PRIVATE");
    await r.getByRole("button", { name: "Apply Filters", exact: true }).click();
    await expect(r.getByRole("heading", { name: "Should we repaint the clubhouse?", exact: true })).toHaveCount(0);
    await expect(r.getByRole("heading", { name: "Elect your next committee", exact: true })).toBeVisible();
    await expect(overview.locator("dl > div").nth(0).locator("dd").first()).toHaveText("02");
    await a.setViewportSize({ width: 390, height: 844 });
    await appearance(a, "Light");
    await a.locator("[data-account-review]").getByRole("checkbox").first().scrollIntoViewIfNeeded();
    await accessible(a); await capture(a, "73-platinum-accounts-mobile", false, true);
    await p.goto("/sign-in");
    await capture(p, "01-sign-in");
    await p.locator("summary[aria-label='Appearance']").click();
    await capture(p, "74-appearance-menu");
  } finally {
    for (const voteId of votes) {
      const vote = await asUser<{ status: string }>(admin.id, "public.get_admin_vote($1)", [voteId]);
      if (vote.status === "ACTIVE") await asUser(admin.id, "public.cancel_vote($1, true, 'Synthetic appearance capture completed')", [voteId]);
      if (vote.status === "SCHEDULED") await asUser(admin.id, "public.withdraw_vote_schedule($1, true, 'Synthetic appearance capture completed')", [voteId]);
    }
    await adminContext.close(); await residentContext.close(); await publicContext.close();
    await asUser(admin.id, "public.update_rwa_profile($1::jsonb)", [JSON.stringify(previous)]);
  }
});

test("capture bulk account review documentation", async ({ browser }) => {
  test.setTimeout(300_000);
  const operator = await provisionAdmin("Account Review Operator (example)");
  const resident = await seedHousehold();
  const other = await seedHousehold();
  const untouched = await seedHousehold();
  const administrator = await provisionAdmin("Review Administrator (example)");
  await asUser(operator.id, "public.update_profile($1, $2::jsonb)", [resident.id, JSON.stringify({ status: "SUSPENDED", representativeName: "Review Resident (example)" })]);
  await asUser(operator.id, "public.update_profile($1, $2::jsonb)", [other.id, JSON.stringify({ status: "SUSPENDED", representativeName: "Second Review Resident (example)" })]);
  await asUser(operator.id, "public.update_profile($1, $2::jsonb)", [untouched.id, JSON.stringify({ status: "SUSPENDED", representativeName: "Unselected Resident (example)" })]);
  await asUser(operator.id, "public.update_household($1, $2::jsonb)", [other.householdId, JSON.stringify({ isEligible: false })]);
  await asUser(operator.id, "public.update_household($1, $2::jsonb)", [resident.householdId, JSON.stringify({ isEligible: false })]);
  await asUser(operator.id, "public.update_profile($1, $2::jsonb)", [administrator.id, JSON.stringify({ status: "SUSPENDED" })]);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  const accountRow = (id: string) => page.getByRole("row").filter({ has: page.locator(`a[href="/admin/accounts/${id}"]`) });
  async function findAccount(id: string, url: string) {
    await page.goto(url);
    for (let index = 0; index < 30; index += 1) {
      if (await accountRow(id).count()) return;
      const next = page.getByRole("link", { name: /Next page/i });
      if (!await next.count()) break;
      await next.click();
    }
    throw new Error("Synthetic review account was not found in the paginated register.");
  }
  try {
    await signInThroughUi(page, operator.email, operator.code);
    await page.goto("/admin/accounts");
    await expect(page.getByLabel(/^Role/)).toHaveValue("false");
    await capture(page, "47-accounts-list");
    await findAccount(resident.id, "/admin/accounts?status=SUSPENDED&limit=100");
    await expect(accountRow(administrator.id)).toHaveCount(0);
    await accountRow(resident.id).getByRole("checkbox").check();
    await capture(page, "63-account-review");
    await page.getByRole("button", { name: "Make Eligible (1)", exact: true }).click();
    await capture(page, "64-make-eligible", true);
    await page.getByRole("dialog").getByRole("button", { name: "Make Eligible", exact: true }).click();
    await expect(page.getByText("1 completed", { exact: true })).toBeVisible();
    const state = await asUser<{ status: string; eligible: boolean }>(operator.id, "jsonb_build_object('status', (select status from public.profiles where id=$1), 'eligible', (select is_eligible from public.households where id=$2))", [resident.id, resident.householdId]);
    expect(state).toEqual({ status: "SUSPENDED", eligible: true });
    await accountRow(resident.id).getByRole("checkbox").check();
    await accountRow(other.id).getByRole("checkbox").check();
    await page.getByRole("button", { name: "Enable Selected (2)", exact: true }).click();
    await capture(page, "65-enable-selected", true);
    await page.getByRole("dialog").getByRole("button", { name: "Enable Selected", exact: true }).click();
    await expect(page.getByText("2 completed", { exact: true })).toBeVisible();
    await capture(page, "66-account-review-result");
    expect(await asUser(operator.id, "(select status from public.profiles where id=$1)", [resident.id])).toBe("ENABLED");
    expect(await asUser(operator.id, "(select status from public.profiles where id=$1)", [other.id])).toBe("ENABLED");
    expect(await asUser(operator.id, "(select is_eligible from public.households where id=$1)", [other.householdId])).toBe(false);
    expect(await asUser(operator.id, "(select status from public.profiles where id=$1)", [untouched.id])).toBe("SUSPENDED");
    await findAccount(administrator.id, "/admin/accounts?status=SUSPENDED&isAdmin=all&limit=100");
    await expect(page.getByLabel(/^Role/)).toHaveValue("all");
    await expect(page.getByText("0 selected", { exact: true })).toBeVisible();
    await accountRow(administrator.id).getByRole("checkbox").check();
    await page.getByRole("button", { name: "Enable Selected (1)", exact: true }).click();
    await expect(page.getByText("Administrator access", { exact: true })).toBeVisible();
    await capture(page, "67-enable-admin-warning", true);
    await page.getByRole("dialog").getByRole("button", { name: "Enable Selected", exact: true }).click();
    await expect(page.getByText("1 completed", { exact: true })).toBeVisible();
    expect(await asUser(operator.id, "(select status from public.profiles where id=$1)", [administrator.id])).toBe("ENABLED");
    await findAccount(untouched.id, "/admin/accounts?status=SUSPENDED&limit=100");
    await page.route(`**/api/admin/accounts/${untouched.id}`, (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "DEPENDENCY_UNAVAILABLE", message: "Synthetic provider outage." }, requestId: "documentation-failure-example" }) }));
    await accountRow(untouched.id).getByRole("checkbox").check();
    await page.getByRole("button", { name: "Enable Selected (1)", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Enable Selected", exact: true }).click();
    await expect(page.getByText("Review before retrying", { exact: true })).toBeVisible();
    expect(await asUser(operator.id, "(select status from public.profiles where id=$1)", [untouched.id])).toBe("SUSPENDED");
  } finally { await context.close(); }
});

test("capture bulk import and scheduled opening documentation", async ({ browser }) => {
  test.setTimeout(300_000);
  await mkdir(images, { recursive: true });
  const admin = await provisionAdmin("Documentation Administrator (example)");
  await ensureFixturePolicy(admin.id);
  const resident = await seedHousehold();
  const previousProfile = await asUser<Record<string, unknown>>(admin.id, "public.get_rwa_profile()");
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const a = await desktop.newPage();
  const m = await mobile.newPage();
  a.setDefaultTimeout(15_000);
  m.setDefaultTimeout(15_000);
  let scheduledId: string | undefined;
  try {
    await asUser(admin.id, "public.update_rwa_profile($1::jsonb)", [JSON.stringify({
      ...previousProfile,
      fullName: "Lakeview Residents Welfare Association", alias: "Lakeview RWA",
      address: "1 Example Lake Road, Sample City 000000", email: "", phone: "+91 123 456 7890", website: "",
      accentPalette: "TEAL", welcomeMessage: "Welcome to Lakeview RWA voting. Please vote before each displayed deadline.",
      householdLabel: "Flat", identifierKind: "NUMBER",
    })]);
    await signInThroughUi(a, admin.email, admin.code);
    await a.goto("/admin");
    await capture(a, "15-admin-home");
    await a.goto("/admin/households/import");
    const identifier = await unusedIdentifier();
    const importedEmail = plusEmail();
    const csv = `identifier,representative_name,email,is_eligible\n${identifier},Arun Shah (example),${importedEmail},true\n`;
    await a.getByLabel("Register CSV").setInputFiles({ name: "synthetic-register.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await a.getByRole("button", { name: "Check Register", exact: true }).click();
    await expect(a.getByText("Ready to import. New accounts remain suspended.", { exact: true })).toBeVisible();
    await capture(a, "54-import-preview");
    await a.getByRole("button", { name: "Import 1 Flats", exact: true }).click();
    await expect(a.getByRole("dialog")).toBeVisible();
    await capture(a, "55-import-confirm", true);
    await a.getByRole("dialog").getByRole("button", { name: "Import Suspended Accounts", exact: true }).click();
    await expect(a.getByRole("cell").filter({ hasText: "Imported with a suspended account. Review and enable the account separately." })).toBeVisible();
    await capture(a, "56-import-result");
    await a.getByRole("link", { name: "Review Account", exact: true }).click();
    await expect(a.getByRole("heading", { level: 1, name: "Arun Shah (example)" })).toBeVisible();
    await expect(a.getByRole("button", { name: "Enable Account", exact: true })).toBeVisible();
    await a.goto(`/admin/households?identifier=${encodeURIComponent(identifier)}`);
    await capture(a, "44-household-created");
    const mobileAdmin = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: await desktop.storageState() });
    try {
      const upload = await mobileAdmin.newPage();
      await upload.goto("/admin/households/import");
      await upload.getByLabel("Register CSV").setInputFiles({ name: "synthetic-register.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
      await upload.getByRole("button", { name: "Check Register", exact: true }).click();
      await expect(upload.getByRole("cell").filter({ hasText: "Exact match; no changes made. Review account access separately." })).toBeVisible();
      await capture(upload, "62-import-mobile");
    } finally { await mobileAdmin.close(); }

    const draft = await asUser<{ id: string }>(admin.id, "public.create_draft('PUBLIC')");
    scheduledId = draft.id;
    await asUser(admin.id, "public.update_draft($1, 1, $2::jsonb)", [draft.id, JSON.stringify({
      title: "Should we repaint the clubhouse?", instructions: "Example poll. Review the proposal before choosing.",
      closesAt: new Date(Date.now() + 172_800_000).toISOString(),
      options: [{ label: "Yes", position: 1 }, { label: "No", position: 2 }],
      eligibleHouseholdIds: [resident.householdId],
    })]);
    await a.goto(`/admin/votes/${draft.id}/preview`);
    await expect(a.getByText("No problems found in this version", { exact: true })).toBeVisible();
    await capture(a, "25-ready-preview");
    const display = await asUser<{ timezone: string }>(admin.id, "public.get_rwa_display()");
    const opening = new Date(Date.now() + 86_400_000).toISOString();
    await a.getByLabel(/^Voting opens at/).fill(instantToLocalInput(opening, display.timezone));
    await a.getByRole("button", { name: "Schedule Vote", exact: true }).click();
    await expect(a.getByRole("dialog")).toBeVisible();
    await capture(a, "57-schedule-confirm", true);
    await a.getByRole("dialog").getByRole("button", { name: "Freeze and Schedule", exact: true }).click();
    await expect(a.getByText(/^Vote scheduled\./)).toBeVisible();
    await capture(a, "58-scheduled-admin");
    await a.goto("/admin/votes?status=SCHEDULED");
    await capture(a, "31-admin-votes");
    await signInThroughUi(m, resident.email, await freshCode(resident.email));
    await m.goto(`/votes/${draft.id}`);
    await expect(m.getByText("Voting has not opened yet", { exact: true })).toBeVisible();
    await expect(m.getByRole("radio")).toHaveCount(0);
    await expect(m.getByRole("button", { name: "Review Selections", exact: true })).toHaveCount(0);
    await capture(m, "59-scheduled-member");
    await a.goto(`/admin/votes/${draft.id}`);
    await a.getByRole("button", { name: "Return to Draft", exact: true }).click();
    await a.getByLabel(/^Reason/).fill("Documentation example: correct the proposal before opening.");
    await capture(a, "60-withdraw-schedule", true);
    await a.getByRole("dialog").getByRole("button", { name: "Return to Draft", exact: true }).click();
    await expect(a.getByText(/^Schedule withdrawn\./)).toBeVisible();
    await capture(a, "61-schedule-withdrawn");
    await m.reload();
    await expect(m.getByRole("heading", { name: /not found/i })).toBeVisible();
    scheduledId = undefined;
  } finally {
    if (scheduledId) {
      const vote = await asUser<{ status: string }>(admin.id, "public.get_admin_vote($1)", [scheduledId]);
      if (vote.status === "SCHEDULED") await asUser(admin.id, "public.withdraw_vote_schedule($1, true, 'Documentation capture cleanup')", [scheduledId]);
    }
    await desktop.close(); await mobile.close();
    if (previousProfile) await asUser(admin.id, "public.update_rwa_profile($1::jsonb)", [JSON.stringify(previousProfile)]);
  }
});

test("capture the illustrated documentation journeys", async ({ browser }) => {
  test.setTimeout(900_000);
  await mkdir(images, { recursive: true });
  const admin = await provisionAdmin("Documentation Administrator");
  const resident = await seedHousehold({ identifier: "H-513" });
  await asUser(admin.id, "public.update_profile($1, $2::jsonb)", [
    resident.id,
    JSON.stringify({ representativeName: "Maya Rao (example)" }),
  ]);
  await ensureFixturePolicy(admin.id);
  // Synthetic RWA identity for the pictures; the previous profile is restored
  // afterwards so other disposable-project runs keep their own settings.
  const previousProfile = await asUser<Record<string, unknown>>(
    admin.id,
    "public.get_rwa_profile()",
  );
  await asUser(admin.id, "public.update_rwa_profile($1::jsonb)", [
    JSON.stringify({
      fullName: "Lakeview Residents Welfare Association",
      alias: "Lakeview RWA",
      address: "1 Example Lake Road, Sample City 000000",
      email: "",
      phone: "+91 123 456 7890",
      // Left blank so the pictures show empty optional fields being hidden.
      website: "",
      accentPalette: "TEAL",
      welcomeMessage:
        "Welcome to Lakeview RWA voting. Please vote before each displayed deadline.",
      householdLabel: "Flat",
      identifierKind: "NUMBER",
      defaultHouseholds: ["H-513", "H-514", "H-515", "H-516"],
      rwaPositions: [
        "President",
        "Vice-President",
        "Secretary",
        "Joint-Secretary",
        "Treasurer",
      ],
    }),
  ]);
  const adminContext = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const memberContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const a = await adminContext.newPage();
  const m = await memberContext.newPage();
  try {
    await stubCodeRequest(m);
    await m.goto("/sign-in");
    await capture(m, "01-sign-in");
    await m.getByLabel(/Registered email address/).fill(resident.email);
    await m.getByRole("button", { name: "Send Sign-In Code" }).click();
    await capture(m, "02-code-entry");
    await m.route("**/api/auth/verify", (route) =>
      route.fulfill({
        status: 422,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "CODE_INVALID_OR_EXPIRED",
            message:
              "The code is invalid or has expired. Request a new code and try again.",
          },
          requestId: "documentation-example",
        }),
      }),
    );
    await m.getByLabel(/Six-digit code/).fill("000000");
    await m.getByRole("button", { name: "Verify and Sign In" }).click();
    await expect(
      m.getByText(/code is not valid or has expired/i),
    ).toBeVisible();
    await capture(m, "03-code-error");
    await m.unroute("**/api/auth/verify");
    await m.getByLabel(/Six-digit code/).fill(await freshCode(resident.email));
    await m.getByRole("button", { name: "Verify and Sign In" }).click();
    await expect(
      m.getByRole("heading", { level: 1, name: "Votes" }),
    ).toBeVisible();
    await capture(m, "04-empty-votes");
    await signInThroughUi(a, admin.email, admin.code);
    await capture(a, "15-admin-home");
    await a.goto("/admin/settings");
    await expect(
      a.getByRole("heading", { level: 1, name: "RWA Settings" }),
    ).toBeVisible();
    await capture(a, "48-rwa-settings");
    await a.goto("/admin/accounts/new");
    await capture(a, "16-create-account");
    const onboardingEmail = plusEmail();
    await a.getByLabel(/Email address/).fill(onboardingEmail);
    await a.getByLabel(/Representative name/).fill("Arun Shah (example)");
    await a.getByRole("button", { name: "Create Account" }).click();
    await expect(
      a.getByRole("heading", { level: 1, name: "Arun Shah (example)" }),
    ).toBeVisible();
    const onboardingAccountPath = new URL(a.url()).pathname;
    await capture(a, "42-created-suspended");
    await a.getByRole("button", { name: "Enable Account" }).click();
    await a
      .getByRole("dialog")
      .getByRole("button", { name: "Enable Account" })
      .click();
    await expect(
      a.getByText("Flat needed first", { exact: true }),
    ).toBeVisible();
    await capture(a, "43-household-required");
    await a.goto("/admin/households/new");
    const newIdentifier = await unusedIdentifier("H-514");
    // The identifier input offers Default Households suggestions, so its role may be combobox.
    await a.getByLabel(/^Flat Number/).fill(newIdentifier);
    const representative = a.getByLabel(/Representative/);
    const offered = (
      await representative.locator("option").allTextContents()
    ).find((label) => label.includes(onboardingEmail));
    if (!offered) {
      throw new Error(
        "The synthetic onboarding account was not offered as a representative.",
      );
    }
    await representative.selectOption({ label: offered });
    await a.getByLabel("Eligible to vote").check();
    await a.getByRole("button", { name: "Add Flat" }).click();
    await expect(a.getByText("Flat added.")).toBeVisible();
    await a.goto(
      `/admin/households?identifier=${encodeURIComponent(newIdentifier)}`,
    );
    await capture(a, "44-household-created");
    await a.goto(onboardingAccountPath);
    await a.getByRole("button", { name: "Enable Account" }).click();
    await capture(a, "45-enable-dialog");
    await a
      .getByRole("dialog")
      .getByRole("button", { name: "Enable Account" })
      .click();
    await expect(
      a.getByRole("button", { name: "Suspend Account" }),
    ).toBeVisible();
    await capture(a, "46-enabled-account");
    await a.goto("/admin/accounts");
    await capture(a, "47-accounts-list");
    await a.goto(`/admin/accounts/${resident.id}`);
    await capture(a, "17-account");
    await a.getByRole("button", { name: "Suspend Account" }).click();
    await capture(a, "18-suspend-dialog");
    await a.keyboard.press("Escape");
    await a.getByRole("button", { name: "Delete Account" }).click();
    await capture(a, "19-delete-dialog");
    await a.keyboard.press("Escape");
    await a.goto("/admin/households/new");
    await capture(a, "20-add-household");
    await a.goto(`/admin/households/${resident.householdId}`);
    await capture(a, "21-household");
    await a.goto("/admin/votes/new");
    await capture(a, "22-voting-types");
    await a.getByRole("radio", { name: /^PUBLIC voting/ }).check();
    await a.getByRole("button", { name: "Create Draft" }).click();
    await expect(
      a.getByRole("heading", { level: 1, name: "Untitled draft" }),
    ).toBeVisible();
    const editor = new URL(a.url()).pathname;
    const voteId = editor.split("/").at(-1);
    expect(voteId).toBeTruthy();
    await a.getByRole("link", { name: "Preview Ballot" }).click();
    await expect(
      a.getByText(/before this vote can be activated/),
    ).toBeVisible();
    await capture(a, "23-incomplete-preview");
    await asUser(admin.id, "public.update_draft($1, 1, $2::jsonb)", [
      voteId,
      JSON.stringify({
        title: "Should we repaint the clubhouse?",
        instructions: "Example poll. Review the proposal before choosing.",
        closesAt: new Date(Date.now() + 86_400_000).toISOString(),
        options: [
          { label: "Yes", position: 1 },
          { label: "No", position: 2 },
        ],
        eligibleHouseholdIds: [resident.householdId],
      }),
    ]);
    await a.goto(editor);
    await a.getByLabel("Find a flat").fill(resident.identifier);
    await capture(a, "24-open-editor");
    await a.getByRole("link", { name: "Preview Ballot" }).click();
    await expect(
      a.getByText("No problems found in this version"),
    ).toBeVisible();
    await capture(a, "25-ready-preview");
    await a.getByRole("button", { name: "Activate Vote" }).click();
    await capture(a, "26-activate-dialog");
    await a
      .getByRole("dialog")
      .getByRole("button", { name: "Activate Vote" })
      .click();
    await expect(
      a.getByText(/Vote activated\. Its type, ballot/),
    ).toBeVisible();
    await capture(a, "27-active-vote");
    await a.getByRole("button", { name: "Change Deadline" }).click();
    const deadlineInput = a.getByLabel(/^New deadline/);
    // Wall-clock arithmetic on the RWA-zone input value: two days later.
    const extended = new Date(`${await deadlineInput.inputValue()}Z`);
    extended.setUTCDate(extended.getUTCDate() + 2);
    await deadlineInput.fill(extended.toISOString().slice(0, 16));
    await a
      .getByLabel(/^Why is the deadline changing/)
      .fill("Documentation example: low turnout, giving residents two more days.");
    await expect(a.getByText(/extended by 2 days/)).toBeVisible();
    await capture(a, "53-change-deadline");
    await a
      .getByRole("dialog")
      .getByRole("button", { name: "Change Deadline" })
      .click();
    await expect(a.getByText(/^Deadline changed\./)).toBeVisible();
    await m.goto("/");
    await capture(m, "05-vote-list");
    await m.goto(`/votes/${voteId}`);
    await capture(m, "06-open-ballot");
    await m.getByRole("button", { name: "Review Selections" }).click();
    await capture(m, "07-ballot-validation");
    await m.getByRole("radio", { name: "Yes" }).check();
    await m.getByRole("button", { name: "Review Selections" }).click();
    await capture(m, "08-review");
    await m.route("**/api/votes/*/submission", (route) => route.abort());
    await m.route("**/api/votes/*/participation", (route) => route.abort());
    await m.getByRole("button", { name: "Submit Vote" }).click();
    await expect(
      m.getByRole("heading", { name: "We could not confirm your submission" }),
    ).toBeVisible();
    await capture(m, "09-outcome-unknown");
    await m.unroute("**/api/votes/*/participation");
    await m.getByRole("button", { name: "Check Again" }).click();
    await expect(
      m.getByRole("heading", { name: "Your vote has not been recorded yet" }),
    ).toBeVisible();
    await capture(m, "10-not-recorded");
    await m.unroute("**/api/votes/*/submission");
    await m.getByRole("button", { name: "Review and Try Again" }).click();
    await m.getByRole("button", { name: "Submit Vote" }).click();
    await expect(
      m.getByRole("heading", { name: "Your vote is recorded." }),
    ).toBeVisible();
    await capture(m, "11-submitted");
    await m.goto(`/votes/${voteId}/results`);
    await capture(m, "12-results-not-ready");
    await a.goto(`${editor}/participation`);
    await capture(a, "28-participation");
    await a.goto(editor);
    await a.getByRole("button", { name: "Complete Vote Early" }).click();
    await a
      .getByRole("dialog")
      .getByRole("button", { name: "Complete Vote Early" })
      .click();
    await expect(
      a.getByText("Enter a reason. It is recorded with the vote."),
    ).toBeVisible();
    await capture(a, "29-complete-dialog");
    await a
      .getByLabel(/^Why is it being completed early/)
      .fill("Documentation example: the demonstration response is complete.");
    await a
      .getByRole("dialog")
      .getByRole("button", { name: "Complete Vote Early" })
      .click();
    await expect(
      a.getByText("Vote completed early.", { exact: true }),
    ).toBeVisible();
    await capture(a, "30-completed-admin");
    await m.goto(`/votes/${voteId}/results`);
    await expect(
      m.getByRole("heading", { name: "Download", exact: true }),
    ).toBeVisible();
    await capture(m, "13-open-results");
    await a.goto(`/votes/${voteId}/results`);
    await capture(a, "14-desktop-results");
    await a.goto("/admin/votes");
    await capture(a, "31-admin-votes");
    const closedDraft = await asUser<{ id: string }>(
      admin.id,
      "public.create_draft('PRIVATE')",
    );
    await asUser(admin.id, "public.update_draft($1, 1, $2::jsonb)", [
      closedDraft.id,
      JSON.stringify({
        title: "Committee election (example)",
        instructions: "Choose one candidate or NOTA for every office.",
        closesAt: new Date(Date.now() + 86_400_000).toISOString(),
        offices: [
          {
            name: "Chair",
            position: 1,
            candidates: [
              { name: "Asha (example)", position: 1 },
              { name: "Ravi (example)", position: 2 },
            ],
          },
        ],
        eligibleHouseholdIds: [resident.householdId],
      }),
    ]);
    await a.goto(`/admin/votes/${closedDraft.id}`);
    await a.getByLabel("Find a flat").fill(resident.identifier);
    await capture(a, "32-closed-editor");
    await asUser(admin.id, "public.activate_vote($1, 2, true)", [
      closedDraft.id,
    ]);
    await m.goto(`/votes/${closedDraft.id}`);
    await capture(m, "33-closed-ballot");
    await m.getByRole("button", { name: "About NOTA" }).click();
    await expect(m.getByText(/NOTA means “None of the Above\.”/)).toBeVisible();
    await capture(m, "52-nota-info");
    await m.keyboard.press("Escape");
    await m.getByRole("radio", { name: "NOTA (None of the Above)" }).check();
    await m.getByRole("button", { name: "Review Selections" }).click();
    await capture(m, "34-closed-review");
    await m.getByRole("button", { name: "Submit Vote" }).click();
    await expect(
      m.getByRole("heading", { name: "Vote submitted." }),
    ).toBeVisible();
    await capture(m, "35-closed-submitted");
    await m.goto(`/votes/${closedDraft.id}/results`);
    await expect(m.getByText(/turnout/i).first()).toBeVisible();
    await capture(m, "49-closed-live-turnout");
    await asUser(
      admin.id,
      "public.complete_vote_early($1, true, 'Documentation example completion')",
      [closedDraft.id],
    );
    await m.goto(`/votes/${closedDraft.id}/results`);
    await expect(m.getByText("Totals only", { exact: true })).toBeVisible();
    await capture(m, "36-closed-results");
    const multiDraft = await asUser<{ id: string }>(
      admin.id,
      "public.create_draft('PUBLIC')",
    );
    await asUser(admin.id, "public.update_draft($1, 1, $2::jsonb)", [
      multiDraft.id,
      JSON.stringify({
        title: "Which GBM dates suit you? (example)",
        instructions: "Select every date you can attend.",
        openSelectionMode: "MULTIPLE",
        openSelectionLimit: null,
        closesAt: new Date(Date.now() + 86_400_000).toISOString(),
        options: [
          { label: "Saturday 10:00 (example)", position: 1 },
          { label: "Sunday 10:00 (example)", position: 2 },
          { label: "Sunday 18:00 (example)", position: 3 },
        ],
        eligibleHouseholdIds: [resident.householdId],
      }),
    ]);
    await asUser(admin.id, "public.activate_vote($1, 2, true)", [
      multiDraft.id,
    ]);
    await m.goto(`/votes/${multiDraft.id}`);
    await m
      .getByRole("checkbox", { name: "Saturday 10:00 (example)" })
      .check();
    await m.getByRole("checkbox", { name: "Sunday 18:00 (example)" }).check();
    await capture(m, "50-multi-select-ballot");
    await m.getByRole("button", { name: "Review Selections" }).click();
    await m.getByRole("button", { name: "Submit Vote" }).click();
    await expect(
      m.getByRole("heading", { name: "Your vote is recorded." }),
    ).toBeVisible();
    await m.goto(`/votes/${multiDraft.id}/results`);
    await capture(m, "51-multi-live-results");
    const cancelDraft = await asUser<{ id: string }>(
      admin.id,
      "public.create_draft('PUBLIC')",
    );
    await asUser(admin.id, "public.update_draft($1, 1, $2::jsonb)", [
      cancelDraft.id,
      JSON.stringify({
        title: "Reschedule the community meeting? (example)",
        closesAt: new Date(Date.now() + 86_400_000).toISOString(),
        options: [
          { label: "Saturday", position: 1 },
          { label: "Sunday", position: 2 },
        ],
        eligibleHouseholdIds: [resident.householdId],
      }),
    ]);
    await asUser(admin.id, "public.activate_vote($1, 2, true)", [
      cancelDraft.id,
    ]);
    await a.goto(`/admin/votes/${cancelDraft.id}`);
    await a.getByRole("button", { name: "Cancel Vote" }).click();
    await capture(a, "37-cancel-dialog");
    await a
      .getByLabel(/^Why is it being cancelled/)
      .fill("Example: the meeting dates need correction.");
    await a
      .getByRole("dialog")
      .getByRole("button", { name: "Cancel Vote" })
      .click();
    await expect(a.getByText("Vote cancelled.", { exact: true })).toBeVisible();
    await m.goto(`/votes/${cancelDraft.id}`);
    await capture(m, "38-cancelled-member");
    await a.goto("/admin/audit");
    await capture(a, "39-audit");
    await m.goto("/admin/households");
    await capture(m, "40-no-admin-access");
    await m.goto("/");
    await m.getByRole("button", { name: "Sign Out" }).click();
    await expect(
      m.getByRole("heading", { level: 1, name: "Sign in" }),
    ).toBeVisible();
    await capture(m, "41-signed-out");
  } finally {
    await memberContext.close();
    await adminContext.close();
    if (previousProfile) {
      await asUser(admin.id, "public.update_rwa_profile($1::jsonb)", [
        JSON.stringify(previousProfile),
      ]);
    }
  }
});
