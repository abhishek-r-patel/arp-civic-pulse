// Explicitly opted-in, synthetic documentation captures; screenshots redact emails and codes.
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {
  activateVoteFor,
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
import { chooseDropdownOption } from "../../tests/e2e/support/dropdown";

test.skip(
  process.env.DOC_SCREENSHOTS !== "1" || process.env.LIVE_AUTH !== "1",
  "Opt in with DOC_SCREENSHOTS=1 and LIVE_AUTH=1 on the disposable test project only.",
);

const images = join(process.cwd(), "docs", "images", "user-guide");
const onlyScreenshot = process.env.DOC_SCREENSHOT_ONLY;
type Persona = "voter" | "rwa-admin" | "rwa-readonly";
const screenshotPersona = new WeakMap<Page, Persona>();

async function capture(page: Page, name: string, dialogOnly = false, viewportOnly = false) {
  if (onlyScreenshot && name !== onlyScreenshot) return;
  const persona = screenshotPersona.get(page) ?? "rwa-admin";
  const personaImages = join(images, persona);
  await mkdir(personaImages, { recursive: true });
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
  // Masks are drawn over the image, so a dialog-only capture must not inherit page masks behind it.
  const scope = dialogOnly ? page.getByRole("dialog") : page.locator("body");
  await target.screenshot({
    path: join(personaImages, `${name}.png`),
    ...(dialogOnly ? {} : { fullPage: !viewportOnly }),
    animations: "disabled",
    style: "nextjs-portal { display: none !important; }",
    mask: [
      scope.getByText(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu),
      scope.locator("[data-doc-mask]"),
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
  screenshotPersona.set(a, "rwa-admin");
  screenshotPersona.set(r, "voter");
  screenshotPersona.set(p, "voter");
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
    await a.goto("/admin/residents?status=SUSPENDED");
    const selectable = a.locator("[data-account-review] tbody input[type=checkbox]:not(:disabled)").first();
    if (await selectable.count()) await selectable.check();
    await r.setViewportSize({ width: 390, height: 844 });
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
    await chooseDropdownOption(r, "Voting type", "PRIVATE voting");
    await r.getByRole("button", { name: "Apply Filters", exact: true }).click();
    await expect(r.getByRole("heading", { name: "Should we repaint the clubhouse?", exact: true })).toHaveCount(0);
    await expect(r.getByRole("heading", { name: "Elect your next committee", exact: true })).toBeVisible();
    await expect(overview.locator("dl > div").nth(0).locator("dd").first()).toHaveText("02");
    await a.setViewportSize({ width: 390, height: 844 });
    await appearance(a, "Light");
    await a.locator("[data-account-review]").getByRole("checkbox").first().scrollIntoViewIfNeeded();
    await accessible(a);
    await p.goto("/sign-in");
    await capture(p, "01-sign-in");
    await p.locator("summary[aria-label='Appearance']").click();
    await capture(p, "74-appearance-menu");
    await p.goto("/privacy");
    await capture(p, "75-privacy-public");
    await p.goto("/contact");
    await capture(p, "76-contact-public");
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
  screenshotPersona.set(page, "rwa-admin");
  page.setDefaultTimeout(15_000);
  const accountRow = (id: string) => page.getByRole("row").filter({ has: page.locator(`a[href="/admin/residents/${id}"]`) });
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
    await page.goto("/admin/residents");
    await page.getByRole("button", { name: "Filter Role", exact: true }).click();
    await expect(page.getByRole("combobox", { name: "Role", exact: true })).toHaveText("Voter");
    await page.keyboard.press("Escape");
    await capture(page, "47-accounts-list");
    await findAccount(resident.id, "/admin/residents?status=SUSPENDED&limit=100");
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
    await findAccount(administrator.id, "/admin/residents?status=SUSPENDED&isAdmin=all&limit=100");
    await page.getByRole("button", { name: "Filter Role", exact: true }).click();
    await expect(page.getByRole("combobox", { name: "Role", exact: true })).toHaveText("All roles");
    await page.keyboard.press("Escape");
    await expect(page.getByText("0 selected", { exact: true })).toBeVisible();
    await accountRow(administrator.id).getByRole("checkbox").check();
    await page.getByRole("button", { name: "Enable Selected (1)", exact: true }).click();
    await expect(page.getByText("Administrator access", { exact: true })).toBeVisible();
    await capture(page, "67-enable-admin-warning", true);
    await page.getByRole("dialog").getByRole("button", { name: "Enable Selected", exact: true }).click();
    await expect(page.getByText("1 completed", { exact: true })).toBeVisible();
    expect(await asUser(operator.id, "(select status from public.profiles where id=$1)", [administrator.id])).toBe("ENABLED");
    await findAccount(untouched.id, "/admin/residents?status=SUSPENDED&limit=100");
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
  screenshotPersona.set(a, "rwa-admin");
  screenshotPersona.set(m, "voter");
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
    await a.goto("/admin/residents/import");
    const identifier = await unusedIdentifier();
    const importedEmail = plusEmail();
    const csv = `identifier,representative_name,email,is_eligible\n${identifier},Arun Shah (example),${importedEmail},true\n`;
    await a.getByLabel("Register CSV").setInputFiles({ name: "synthetic-register.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await a.getByRole("button", { name: "Check Register", exact: true }).click();
    await expect(a.getByText("Ready to import. New residents will have access suspended.", { exact: true })).toBeVisible();
    await capture(a, "54-import-preview");
    await a.getByRole("button", { name: "Import 1 Resident", exact: true }).click();
    await expect(a.getByRole("dialog")).toBeVisible();
    await capture(a, "55-import-confirm", true);
    await a.getByRole("dialog").getByRole("button", { name: "Import Residents", exact: true }).click();
    await expect(a.getByRole("cell").filter({ hasText: "Resident imported with access suspended. Review the resident to enable sign-in." })).toBeVisible();
    await capture(a, "56-import-result");
    await a.getByRole("link", { name: "Review Resident", exact: true }).click();
    await expect(a.getByRole("heading", { level: 1, name: "Arun Shah (example)" })).toBeVisible();
    await expect(a.getByRole("button", { name: "Enable Account", exact: true })).toBeVisible();
    await a.goto(`/admin/residents?identifier=${encodeURIComponent(identifier)}`);
    await capture(a, "44-household-created");
    const mobileAdmin = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: await desktop.storageState() });
    try {
      const upload = await mobileAdmin.newPage();
      screenshotPersona.set(upload, "rwa-admin");
      await upload.goto("/admin/residents/import");
      await upload.getByLabel("Register CSV").setInputFiles({ name: "synthetic-register.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
      await upload.getByRole("button", { name: "Check Register", exact: true }).click();
      await expect(upload.getByRole("cell").filter({ hasText: "Exact match; no changes made. Review resident access separately." })).toBeVisible();
      expect(
        await upload.evaluate(() =>
          document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
    } finally { await mobileAdmin.close(); }

    const opening = new Date(Date.now() + 86_400_000).toISOString();
    const draft = await asUser<{ id: string }>(admin.id, "public.create_draft('PUBLIC')");
    scheduledId = draft.id;
    await asUser(admin.id, "public.update_draft($1, 1, $2::jsonb)", [draft.id, JSON.stringify({
      title: "Should we repaint the clubhouse?", instructions: "Example poll. Review the proposal before choosing.",
      closesAt: new Date(Date.now() + 172_800_000).toISOString(),
      opensAt: opening,
      options: [{ label: "Yes", position: 1 }, { label: "No", position: 2 }],
      eligibleHouseholdIds: [resident.householdId],
    })]);
    await a.goto(`/admin/votes/${draft.id}/preview`);
    await expect(a.getByText("No problems found in this version", { exact: true })).toBeVisible();
    await capture(a, "25-ready-preview");
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

test("capture administrator assignment of exclusive management roles", async ({ browser }) => {
  test.setTimeout(300_000);
  const operator = await provisionAdmin("Role Assignment Administrator (example)");
  await ensureFixturePolicy(operator.id);
  const votingResident = await seedHousehold();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  screenshotPersona.set(page, "rwa-admin");
  const email = plusEmail();
  const name = "Committee Observer (example)";
  try {
    await signInThroughUi(page, operator.email, operator.code);
    await page.goto("/admin/residents/new");
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Resident name").fill(name);
    await chooseDropdownOption(
      page,
      "Role",
      "RWA ReadOnly",
    );
    await capture(page, "30-create-readonly-role");
    await page.getByRole("button", { name: "Create Resident" }).click();
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    const accountPath = new URL(page.url()).pathname;
    await capture(page, "31-readonly-account-suspended");
    await page.getByRole("button", { name: "Enable Account" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Enable Account" }).click();
    await expect(page.getByText(/Flat needed first/)).toBeVisible();
    await page.getByRole("button", { name: "Enable Account" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Enable Account" }).click();
    await expect(page.getByRole("button", { name: "Suspend Account" })).toBeVisible();
    await capture(page, "32-readonly-enabled-no-household");

    const identifier = await unusedIdentifier();
    await page.locator("#identifier").fill(identifier);
    // Leaving the field turns exact typed text into the list choice.
    await page.keyboard.press("Tab");
    await page.getByRole("button", { name: "Assign Flat" }).click();
    await expect(page.getByText(`Flat ${identifier} assigned.`)).toBeVisible();
    await page.getByRole("link", { name: "Change eligibility" }).click();
    await page.getByLabel("Eligible to vote").check();
    await page.getByRole("button", { name: "Save Changes" }).click();
    await expect(page.getByText("Flat updated.")).toBeVisible();
    await page.goto(accountPath);
    await expect(page.getByRole("button", { name: "Suspend Account" })).toBeVisible();
    await capture(page, "33-readonly-account-enabled");

    await chooseDropdownOption(page, "Role", "RWA Admin");
    await capture(page, "34-switch-to-admin-role");
    await page.getByRole("button", { name: "Save Changes" }).click();
    await expect(page.getByText("RWA Admin", { exact: true })).toBeVisible();
    await capture(page, "35-admin-role-assigned");

    const publicVote = await activateVoteFor(
      operator.id,
      [votingResident.householdId],
    );
    const publicOption = publicVote.options[0];
    if (!publicOption) throw new Error("Synthetic PUBLIC option is missing.");
    await asUser(votingResident.id, "public.cast_vote($1, $2::jsonb)", [
      publicVote.id,
      JSON.stringify({ confirmed: true, optionId: publicOption.id }),
    ]);
    await page.goto(`/votes/${publicVote.id}/results`);
    await capture(page, "36-admin-active-public-results");
    await asUser(
      operator.id,
      "public.complete_vote_early($1, true, 'Guide example completion')",
      [publicVote.id],
    );

    const privateVote = await activateVoteFor(
      operator.id,
      [votingResident.householdId],
      "PRIVATE",
    );
    await asUser(votingResident.id, "public.cast_vote($1, $2::jsonb)", [
      privateVote.id,
      JSON.stringify({
        confirmed: true,
        selections: privateVote.offices.map((office) => ({
          officeId: office.id,
          candidateId: office.candidates[0]?.id,
        })),
      }),
    ]);
    await page.goto(`/votes/${privateVote.id}/results`);
    await capture(page, "37-admin-active-private-turnout");
    await asUser(
      operator.id,
      "public.complete_vote_early($1, true, 'Guide example completion')",
      [privateVote.id],
    );
    await page.goto(`/votes/${privateVote.id}/results`);
    await capture(page, "38-admin-completed-private-results");
  } finally {
    await context.close();
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
  // Picked before the profile update so the flat picker (list mode) can offer it.
  const onboardingFlat = await unusedIdentifier("H-514");
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
      defaultHouseholds: [
        ...new Set(["H-513", "H-514", "H-515", "H-516", onboardingFlat]),
      ],
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
  screenshotPersona.set(a, "rwa-admin");
  screenshotPersona.set(m, "voter");
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
      a.getByRole("heading", { level: 1, name: "Settings" }),
    ).toBeVisible();
    const valueGuide = a
      .locator("details")
      .filter({ has: a.getByText("Where Each Value Appears", { exact: true }) });
    await expect(valueGuide).not.toHaveAttribute("open");
    await expect(a.getByText("Wording Only", { exact: true })).toHaveCount(0);
    await valueGuide.locator("summary").click();
    await expect(
      valueGuide.getByText(/Alias: the “Civic Pulse for/),
    ).toBeVisible();
    await valueGuide.locator("summary").click();
    const fullNameHelp = a.locator("#fullName-hint");
    await expect(
      fullNameHelp.getByText(/Your RWA’s official name, shown on vote pages/),
    ).toBeHidden();
    await a.getByLabel("Information about RWA Full Name").click();
    await expect(
      fullNameHelp.getByText(/Your RWA’s official name, shown on vote pages/),
    ).toBeVisible();
    await a.getByLabel("Information about RWA Full Name").click();
    await expect(a.locator('input[name="accentPalette"]')).toHaveCount(6);
    await expect(a.getByLabel("Information about Accent Colour")).toBeVisible();
    await expect(a.getByLabel("Information about Identifier Label")).toBeVisible();
    const helpIconAlignment = await Promise.all(
      ['label[for="fullName"]', "#accentPalette-label", "#identifierKind-label"].map(
        async (selector) =>
          a.locator(selector).evaluate((label) => {
            const summary = label.parentElement?.querySelector("details summary");
            if (!summary) return false;
            const labelBounds = label.getBoundingClientRect();
            const iconBounds = summary.getBoundingClientRect();
            return (
              Math.abs(
                labelBounds.top +
                  labelBounds.height / 2 -
                  (iconBounds.top + iconBounds.height / 2),
              ) < 1
            );
          }),
      ),
    );
    expect(helpIconAlignment).toEqual([true, true, true]);
    const accentColumns = await a
      .getByRole("radiogroup", { name: "Accent Colour" })
      .evaluate((element) => getComputedStyle(element).gridTemplateColumns);
    expect(accentColumns.trim().split(/\s+/u)).toHaveLength(3);
    await capture(a, "48-rwa-settings");
    const aliasHelp = a.getByLabel("Information about RWA Alias");
    const aliasField = a.locator("#alias");
    const aliasDetails = a
      .locator("details")
      .filter({ has: aliasHelp });
    await expect(aliasDetails).not.toHaveAttribute("open");
    await expect(aliasDetails.locator("#alias-hint")).toBeHidden();
    await aliasHelp.click();
    await expect(aliasDetails.locator("#alias-hint")).toBeVisible();
    await aliasHelp.click();
    const addressHelp = a.getByLabel("Information about RWA Address");
    const addressDetails = a
      .locator("details")
      .filter({ has: addressHelp });
    await expect(addressDetails.locator("#address-hint")).toBeHidden();
    await addressHelp.click();
    await expect(addressDetails.locator("#address-hint")).toBeVisible();
    await addressHelp.click();
    const labelBounds = await a.locator('label[for="alias"]').boundingBox();
    const inputBounds = await aliasField.boundingBox();
    expect(labelBounds).not.toBeNull();
    expect(inputBounds).not.toBeNull();
    expect(
      Math.abs(
        (labelBounds?.y ?? 0) +
          (labelBounds?.height ?? 0) / 2 -
          ((inputBounds?.y ?? 0) + (inputBounds?.height ?? 0) / 2),
      ),
    ).toBeLessThan(3);
    await a.setViewportSize({ width: 390, height: 844 });
    const mobileBounds = await a.evaluate(() => {
      const label = document.querySelector('label[for="alias"]');
      const input = document.querySelector("#alias");
      if (!label || !(input instanceof HTMLInputElement)) {
        throw new Error("Alias field did not render for the mobile layout check.");
      }
      return {
        label: label.getBoundingClientRect(),
        input: input.getBoundingClientRect(),
        pageWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
      };
    });
    expect(mobileBounds.label.x).toBe(mobileBounds.input.x);
    expect(mobileBounds.input.y).toBeGreaterThan(mobileBounds.label.y);
    expect(mobileBounds.pageWidth).toBeLessThanOrEqual(
      mobileBounds.viewportWidth,
    );
    await a.setViewportSize({ width: 1280, height: 900 });
    await a.goto("/admin/residents/new");
    await expect(a.getByLabel("Resident name")).toBeVisible();
    await expect(
      a.locator("form").getByText("Flat assignment", { exact: true }),
    ).toBeHidden();
    const checkboxHelpAlignment = await Promise.all(
      ["isEligible", "enable"].map(async (id) =>
        a.locator(`label[for="${id}"]`).evaluate((label) => {
          const summary = label.parentElement?.querySelector("details summary");
          if (!summary) return false;
          const labelBounds = label.getBoundingClientRect();
          const iconBounds = summary.getBoundingClientRect();
          return (
            Math.abs(
              labelBounds.top +
                labelBounds.height / 2 -
                (iconBounds.top + iconBounds.height / 2),
            ) < 1
          );
        }),
      ),
    );
    expect(checkboxHelpAlignment).toEqual([true, true]);
    await capture(a, "16-create-account");
    const onboardingEmail = plusEmail();
    await a.getByLabel(/Email address/).fill(onboardingEmail);
    await a.getByLabel(/Resident name/).fill("Arun Shah (example)");
    await a.getByRole("button", { name: "Create Resident" }).click();
    await expect(a.getByText(/before creating a resident/)).toBeVisible();
    await capture(a, "43-household-required");
    const newIdentifier = onboardingFlat;
    await a.locator('[id="household.identifier"]').fill(newIdentifier);
    await a.keyboard.press("Tab");
    await a.getByRole("button", { name: "Create Resident" }).click();
    await expect(
      a.getByRole("heading", { level: 1, name: "Arun Shah (example)" }),
    ).toBeVisible();
    const onboardingAccountPath = new URL(a.url()).pathname;
    await capture(a, "42-created-suspended");
    await a.getByRole("link", { name: "Change eligibility" }).click();
    await a.getByLabel("Eligible to vote").check();
    await a.getByRole("button", { name: "Save Changes" }).click();
    await expect(a.getByText("Flat updated.")).toBeVisible();
    await a.goto(
      `/admin/residents?identifier=${encodeURIComponent(newIdentifier)}`,
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
    await a.goto("/admin/residents");
    await capture(a, "47-accounts-list");
    await a.goto(`/admin/residents/${resident.id}`);
    await capture(a, "17-account");
    await a.getByRole("button", { name: "Suspend Account" }).click();
    await capture(a, "18-suspend-dialog");
    await a.keyboard.press("Escape");
    await a.getByRole("button", { name: "Delete Account" }).click();
    await capture(a, "19-delete-dialog");
    await a.keyboard.press("Escape");
    await a.goto("/admin/residents/new");
    await a.getByLabel(/Email address/).fill(plusEmail());
    await a.getByLabel(/Resident name/).fill("Meera Iyer (example)");
    await a.locator('[id="household.identifier"]').click();
    await capture(a, "20-add-household");
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
    await m.goto("/admin/residents");
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

test("capture the RWA ReadOnly persona", async ({ browser }) => {
  test.setTimeout(900_000);
  await mkdir(images, { recursive: true });
  const operator = await provisionAdmin("Readonly Guide Administrator (example)");
  const observer = await seedHousehold();
  const other = await seedHousehold();
  await ensureFixturePolicy(operator.id);
  await asUser(operator.id, "public.update_profile($1, $2::jsonb)", [
    observer.id,
    JSON.stringify({ isReadonly: true }),
  ]);
  const previousProfile = await asUser<Record<string, unknown>>(
    operator.id,
    "public.get_rwa_profile()",
  );
  await asUser(operator.id, "public.update_rwa_profile($1::jsonb)", [
    JSON.stringify({
      ...previousProfile,
      fullName: "Lakeview Residents Welfare Association",
      alias: "Lakeview RWA",
      address: "1 Example Lake Road, Sample City 000000",
      email: "",
      phone: "+91 123 456 7890",
      website: "",
      accentPalette: "TEAL",
      welcomeMessage: "Welcome to Lakeview RWA voting.",
      householdLabel: "Flat",
      identifierKind: "NUMBER",
      defaultHouseholds: ["H-513", "H-514", "H-515"],
      rwaPositions: ["President", "Secretary", "Treasurer"],
    }),
  ]);

  const activePublic = await activateVoteFor(operator.id, [observer.householdId]);
  const activePrivate = await activateVoteFor(
    operator.id,
    [observer.householdId],
    "PRIVATE",
  );
  const completedPublic = await activateVoteFor(operator.id, [other.householdId]);
  const publicOption = completedPublic.options[0];
  if (!publicOption) throw new Error("Completed PUBLIC option is missing.");
  await asUser(other.id, "public.cast_vote($1, $2::jsonb)", [
    completedPublic.id,
    JSON.stringify({ confirmed: true, optionId: publicOption.id }),
  ]);
  await asUser(
    operator.id,
    "public.complete_vote_early($1, true, 'Guide example completion')",
    [completedPublic.id],
  );
  const completedPrivate = await activateVoteFor(
    operator.id,
    [other.householdId],
    "PRIVATE",
  );
  await asUser(other.id, "public.cast_vote($1, $2::jsonb)", [
    completedPrivate.id,
    JSON.stringify({
      confirmed: true,
      selections: completedPrivate.offices.map((office) => ({
        officeId: office.id,
        candidateId: office.candidates[0]?.id,
      })),
    }),
  ]);
  await asUser(
    operator.id,
    "public.complete_vote_early($1, true, 'Guide example completion')",
    [completedPrivate.id],
  );

  const draft = await asUser<{ id: string }>(
    operator.id,
    "public.create_draft('PUBLIC')",
  );
  await asUser(operator.id, "public.update_draft($1, 1, $2::jsonb)", [
    draft.id,
    JSON.stringify({
      title: "Which clubhouse improvement should come first?",
      instructions: "Example draft for committee review.",
      closesAt: new Date(Date.now() + 172_800_000).toISOString(),
      options: [
        { label: "Lighting", position: 1 },
        { label: "Garden", position: 2 },
      ],
      eligibleHouseholdIds: [observer.householdId],
    }),
  ]);
  const scheduledDraft = await asUser<{ id: string }>(
    operator.id,
    "public.create_draft('PUBLIC')",
  );
  await asUser(operator.id, "public.update_draft($1, 1, $2::jsonb)", [
    scheduledDraft.id,
    JSON.stringify({
      title: "Choose a community meeting date",
      closesAt: new Date(Date.now() + 259_200_000).toISOString(),
      options: [
        { label: "Saturday", position: 1 },
        { label: "Sunday", position: 2 },
      ],
      eligibleHouseholdIds: [observer.householdId],
    }),
  ]);
  await asUser(
    operator.id,
    "public.schedule_vote($1, 2, true, $2)",
    [scheduledDraft.id, new Date(Date.now() + 86_400_000).toISOString()],
  );

  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  screenshotPersona.set(page, "rwa-readonly");
  page.setDefaultTimeout(20_000);

  async function appearance(mode: "Light" | "Dark") {
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

  try {
    await signInThroughUi(page, observer.email, await freshCode(observer.email));
    await expect(page.getByText("RWA ReadOnly", { exact: false }).first()).toBeVisible();
    await appearance("Light");
    await capture(page, "01-votes-home-light");
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Residents" })).toBeVisible();
    await page.getByText("Committee view", { exact: true }).click();
    await expect(
      page.getByText(/View the flats register, accounts and votes/i),
    ).toBeVisible();
    await appearance("Dark");
    await capture(page, "02-votes-home-dark");

    await page.goto("/admin/residents?isAdmin=all");
    await expect(page.getByRole("button", { name: "Enable Selected" })).toBeDisabled();
    await capture(page, "03-accounts-read-all-roles");
    await page.goto(`/admin/residents/${observer.id}`);
    await expect(page.getByLabel("Role", { exact: true })).toBeDisabled();
    await capture(page, "04-observer-account-detail");
    await page.goto("/admin/residents/new");
    await expect(page.getByLabel("Email address")).toBeDisabled();
    await capture(page, "05-create-account-disabled");

    await page.goto("/admin/residents");
    await expect(
      page.getByRole("link", { name: "Add Resident", exact: true }),
    ).toHaveAttribute("aria-disabled", "true");
    await capture(page, "06-household-register-read");
    await page.goto(`/admin/residents/${other.id}`);
    await expect(page.locator("#identifier")).toBeDisabled();
    await capture(page, "07-new-household-disabled");
    await page.goto("/admin/residents/import");
    await expect(page.getByLabel("Register CSV")).toBeDisabled();
    await capture(page, "09-register-import-disabled");

    await page.goto("/admin/settings");
    await expect(page.getByLabel("RWA Full Name")).toBeDisabled();
    await capture(page, "10-rwa-settings-read-light");
    await appearance("Dark");
    await capture(page, "11-rwa-settings-read-dark");

    await page.goto("/admin/votes");
    await expect(page.getByRole("link", { name: "New Vote" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await capture(page, "12-vote-list-read");
    await page.goto("/admin/votes/new");
    await expect(page.getByRole("radio", { name: /^PUBLIC voting/ })).toBeDisabled();
    await capture(page, "13-new-vote-disabled");
    await page.goto(`/admin/votes/${draft.id}`);
    await expect(page.getByRole("button", { name: "Save Draft" })).toBeDisabled();
    await capture(page, "14-draft-read-disabled-editor");
    await page.goto(`/admin/votes/${draft.id}/preview?revision=2`);
    await expect(page.getByRole("button", { name: "Activate Vote" })).toBeDisabled();
    await capture(page, "15-draft-preview-disabled-actions");
    await page.goto(`/admin/votes/${activePublic.id}`);
    await expect(page.getByRole("button", { name: "Complete Vote Early" })).toBeDisabled();
    await capture(page, "16-active-vote-disabled-lifecycle");
    await page.goto(`/admin/votes/${activePrivate.id}/participation`);
    await capture(page, "17-private-participation-read");
    await page.goto(`/admin/votes/${scheduledDraft.id}`);
    await expect(page.getByRole("button", { name: "Return to Draft" })).toBeDisabled();
    await capture(page, "18-scheduled-vote-disabled-withdrawal");
    await page.goto("/admin/audit");
    await capture(page, "19-audit-history-read");

    await page.goto(`/votes/${activePublic.id}`);
    await capture(page, "20-own-public-ballot");
    await page.getByRole("radio", { name: "Yes" }).check();
    await page.getByRole("button", { name: "Review Selections" }).click();
    await capture(page, "21-own-public-review");
    await page.getByRole("button", { name: "Submit Vote" }).click();
    await expect(page.getByRole("heading", { name: "Your vote is recorded." })).toBeVisible();
    await capture(page, "22-own-public-submitted");

    await page.goto(`/votes/${activePrivate.id}`);
    await capture(page, "23-own-private-ballot");
    const privateChoice = page.getByRole("radio", { name: /Asha/ }).first();
    await privateChoice.check();
    await page.getByRole("button", { name: "Review Selections" }).click();
    await capture(page, "24-own-private-review");
    await page.getByRole("button", { name: "Submit Vote" }).click();
    await expect(page.getByRole("heading", { name: "Vote submitted." })).toBeVisible();
    await capture(page, "25-own-private-submitted");

    await page.goto(`/votes/${activePublic.id}/results`);
    await capture(page, "26-own-live-public-results");
    await page.goto(`/votes/${completedPublic.id}/results`);
    await expect(page.getByRole("heading", { name: "Download" })).toBeVisible();
    await capture(page, "27-other-household-public-results");
    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download CSV" }).click();
    expect((await download).suggestedFilename()).toMatch(/\.csv$/u);
    await page.goto(`/votes/${completedPrivate.id}/results`);
    await capture(page, "28-completed-private-results");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await appearance("Light");
    expect(
      await page.evaluate(() =>
        document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await appearance("Dark");
    expect(
      await page.evaluate(() =>
        document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  } finally {
    await context.close();
    for (const voteId of [
      activePublic.id,
      activePrivate.id,
      scheduledDraft.id,
    ]) {
      const current = await asUser<{ status: string }>(
        operator.id,
        "public.get_admin_vote($1)",
        [voteId],
      );
      if (current.status === "ACTIVE")
        await asUser(operator.id, "public.cancel_vote($1, true, 'Readonly guide capture cleanup')", [voteId]);
      if (current.status === "SCHEDULED")
        await asUser(operator.id, "public.withdraw_vote_schedule($1, true, 'Readonly guide capture cleanup')", [voteId]);
    }
    if (previousProfile)
      await asUser(operator.id, "public.update_rwa_profile($1::jsonb)", [
        JSON.stringify(previousProfile),
      ]);
  }
});

test("capture full numbered pagination", async ({ browser }) => {
  test.setTimeout(240_000);
  const admin = await provisionAdmin("Pagination Administrator (example)");
  const resident = await seedHousehold();
  const neighbour = await seedHousehold();
  const vote = await activateVoteFor(admin.id, [resident.householdId, neighbour.householdId]);
  await activateVoteFor(admin.id, [resident.householdId]);
  for (const person of [resident, neighbour]) {
    await asUser(person.id, "public.cast_vote($1, $2::jsonb)", [
      vote.id, JSON.stringify({ confirmed: true, optionId: vote.options[0]?.id }),
    ]);
  }
  await asUser(admin.id, "public.complete_vote_early($1, true, 'Synthetic pagination documentation')", [vote.id]);
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const memberContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  let page = await context.newPage();
  screenshotPersona.set(page, "rwa-admin");
  try {
    await signInThroughUi(page, admin.email, admin.code);
    for (const [route, name] of [
      ["/admin/residents?isAdmin=all&limit=1&page=2", "47-accounts-list"],
      ["/admin/audit?action=VOTE_ACTIVATED&limit=1", "39-audit"],
      [`/admin/votes/${vote.id}/participation?limit=1`, "28-participation"],
      [`/votes/${vote.id}/results?limit=1`, "14-desktop-results"],
    ] as const) {
      await page.goto(route);
      await expect(page.getByRole("navigation", { name: "Pagination" })).toContainText(/Page \d+ of \d+/u);
      await capture(page, name);
    }
    await page.goto("/admin/residents?isAdmin=all&limit=1&page=2");
    await page.getByRole("navigation", { name: "Pagination" }).scrollIntoViewIfNeeded();
    await capture(page, "87-numbered-pagination-desktop", false, true);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("navigation", { name: "Pagination" }).scrollIntoViewIfNeeded();
    await capture(page, "88-numbered-pagination-phone", false, true);
    page = await memberContext.newPage();
    screenshotPersona.set(page, "voter");
    await signInThroughUi(page, resident.email, await freshCode(resident.email));
    await capture(page, "05-vote-list");
    await page.goto(`/votes/${vote.id}/results?limit=1`);
    await capture(page, "13-open-results");
  } finally {
    await context.close();
    await memberContext.close();
  }
});

test("capture centred confirmation dialogs", async ({ browser }) => {
  test.setTimeout(180_000);
  const admin = await provisionAdmin("Dialog Administrator (example)");
  const subject = await provisionAdmin("Dialog Subject (example)");
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  screenshotPersona.set(page, "rwa-admin");
  try {
    await signInThroughUi(page, admin.email, admin.code);
    await page.goto(`/admin/residents/${subject.id}`);
    await page.getByRole("button", { name: "Suspend Account" }).click();
    await capture(page, "18-suspend-dialog", false, true);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Delete Account" }).click();
    await capture(page, "19-delete-dialog", false, true);
    for (const [mode, name] of [["Light", "85-centred-dialog-phone"], ["Dark", "86-centred-dialog-phone-dark"]] as const) {
      await page.keyboard.press("Escape");
      const menu = page.locator("details[data-theme-control]");
      if (await menu.getAttribute("open") === null) await menu.locator("summary").click();
      await menu.getByRole("radio", { name: mode, exact: true }).check();
      await page.keyboard.press("Escape");
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole("button", { name: "Delete Account" }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await expect.poll(async () => page.getByRole("dialog").evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return Math.max(
          Math.abs(bounds.left + bounds.width / 2 - innerWidth / 2),
          Math.abs(bounds.top + bounds.height / 2 - innerHeight / 2),
        );
      })).toBeLessThanOrEqual(1);
      await capture(page, name, false, true);
    }
  } finally {
    await context.close();
  }
});

test("capture Residents management surfaces", async ({ browser }) => {
  test.setTimeout(180_000);
  const admin = await provisionAdmin("Residents Administrator (example)");
  const observer = await seedHousehold();
  await asUser(admin.id, "public.update_profile($1,$2::jsonb)", [observer.id, JSON.stringify({ isReadonly: true })]);
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const observerContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const observerPage = await observerContext.newPage();
  screenshotPersona.set(page, "rwa-admin");
  screenshotPersona.set(observerPage, "rwa-readonly");
  try {
    await signInThroughUi(page, admin.email, admin.code);
    await capture(page, "15-admin-home");
    await page.goto("/admin/residents/new");
    await capture(page, "16-create-account");
    await page.goto(`/admin/residents/${observer.id}`);
    await capture(page, "17-account");
    await signInThroughUi(observerPage, observer.email, await freshCode(observer.email));
    await observerPage.goto("/admin/residents?isAdmin=all");
    await capture(observerPage, "03-accounts-read-all-roles", false, true);
    await capture(observerPage, "06-household-register-read", false, true);
    await observerPage.goto(`/admin/residents/${observer.id}`);
    await capture(observerPage, "04-observer-account-detail");
    await capture(observerPage, "07-new-household-disabled");
    await observerPage.goto("/admin/residents/new");
    await expect(observerPage.getByLabel(/Email address/)).toBeDisabled();
    await capture(observerPage, "05-create-account-disabled");
    await observerPage.goto("/admin/residents/import");
    await capture(observerPage, "09-register-import-disabled");
  } finally {
    await context.close(); await observerContext.close();
  }
});

test("capture self-registration and one-step account onboarding", async ({ browser }) => {
  test.setTimeout(300_000);
  const admin = await provisionAdmin("Onboarding Administrator (example)");
  const previous = await asUser<Record<string, unknown>>(admin.id, "public.get_rwa_profile()");
  const publicContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const adminContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await publicContext.newPage();
  const a = await adminContext.newPage();
  screenshotPersona.set(p, "voter");
  screenshotPersona.set(a, "rwa-admin");
  const setDefaults = (defaultHouseholds: string[]) =>
    asUser(admin.id, "public.update_rwa_profile($1::jsonb)", [JSON.stringify({ ...previous,
      fullName: "Lakeview Residents Welfare Association", alias: "Lakeview RWA",
      householdLabel: "Flat", identifierKind: "NUMBER", defaultHouseholds,
    })]);
  async function register(name: string, email: string, flat?: string) {
    await p.goto("/register");
    await p.getByLabel(/^Full name/).fill(name);
    await p.getByLabel(/^Email address/).fill(email);
    if (flat !== undefined) await p.getByLabel(/^Flat Number/).fill(flat);
  }
  try {
    // Free-text mode: no Default Households configured.
    await setDefaults([]);
    const firstEmail = plusEmail();
    await register("Kavya Menon (example)", firstEmail, await unusedIdentifier("G-104"));
    await capture(p, "77-register");
    await p.getByRole("button", { name: "Register" }).click();
    await expect(p.getByText("Registration received")).toBeVisible();
    await capture(p, "78-register-received");
    await register("Kavya Menon (example)", firstEmail, await unusedIdentifier());
    await p.getByRole("button", { name: "Register" }).click();
    await expect(p.getByText(/This email address is already registered\./).first()).toBeVisible();
    await capture(p, "79-register-duplicate");

    // List mode: a synthetic, run-unique Default Households list (restored in finally).
    const listed = [...new Set(await Promise.all(
      ["C-101", "C-102", "C-103", "C-201", "C-202", "C-203", "D-101", "D-102"].map((item) => unusedIdentifier(item)),
    ))];
    await setDefaults(listed);
    await register("Imran Qureshi (example)", plusEmail());
    const picker = p.getByRole("combobox", { name: /Flat Number/ });
    await picker.fill(listed[0]?.slice(0, 2) ?? "");
    await expect(p.getByRole("listbox")).toBeVisible();
    await capture(p, "80-register-flat-picker", false, true);

    await signInThroughUi(a, admin.email, admin.code);
    await a.goto("/admin/residents/new");
    await a.getByLabel(/Email address/).fill(plusEmail());
    await a.getByLabel(/Resident name/).fill("Neha Joshi (example)");
    const adminPicker = a.getByRole("combobox", { name: /Flat Number/ });
    await adminPicker.click();
    await expect(a.getByRole("listbox")).toBeVisible();
    await capture(a, "81-add-account-flat-picker", false, true);
    const chosen = listed[1] ?? "";
    await a.getByRole("option", { name: chosen, exact: true }).click();
    await a.getByLabel("Eligible to vote").check();
    await a.getByLabel("Enable account now").check();
    await a.getByRole("button", { name: "Create Resident" }).click();
    await expect(a.getByText("Account created and enabled.")).toBeVisible();
    await expect(a.getByText(chosen, { exact: true })).toBeVisible();
    await capture(a, "82-account-created-with-flat");

    const moveTo = listed[2] ?? "";
    await a.getByRole("combobox", { name: /Flat Number/ }).click();
    await a.getByRole("option", { name: moveTo, exact: true }).click();
    await a.getByRole("button", { name: "Move Flat" }).click();
    await expect(a.getByRole("dialog")).toBeVisible();
    await capture(a, "83-move-flat-dialog", true);
    await a.getByRole("dialog").getByRole("button", { name: "Move Flat" }).click();
    await expect(a.getByText(`Moved to ${moveTo}.`)).toBeVisible();

    await a.goto("/admin/residents?status=SUSPENDED&selfRegistered=true");
    await expect(a.locator("[data-account-review]").getByText("Self-registered").first()).toBeVisible();
    await capture(a, "84-self-registered-accounts", false, true);
    await a.goto("/admin/residents");
    await expect(a.getByRole("heading", { level: 1, name: "Residents" })).toBeVisible();
    await capture(a, "47-accounts-list", false, true);
    await capture(a, "70-platinum-accounts", false, true);
    const themeMenu = a.locator("details[data-theme-control]");
    await themeMenu.locator("summary").click();
    await themeMenu.getByRole("radio", { name: "Dark", exact: true }).check();
    await a.keyboard.press("Escape");
    await capture(a, "71-obsidian-accounts", false, true);
  } finally {
    await publicContext.close(); await adminContext.close();
    await asUser(admin.id, "public.update_rwa_profile($1::jsonb)", [JSON.stringify(previous)]);
  }
});
