import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  asUser,
  ensureFixturePolicy,
  freshCode,
  plusEmail,
  provisionAdmin,
  seedHousehold,
  signInThroughUi,
  stubCodeRequest,
} from "../../tests/e2e/support/live";

test.skip(
  process.env.DOC_SCREENSHOTS !== "1" || process.env.LIVE_AUTH !== "1",
  "Opt in with DOC_SCREENSHOTS=1 and LIVE_AUTH=1 on the disposable test project only.",
);

const images = join(process.cwd(), "docs", "images", "user-guide");

async function capture(page: Page, name: string) {
  await page.waitForLoadState("networkidle");
  await page.screenshot({
    path: join(images, `${name}.png`),
    fullPage: true,
    animations: "disabled",
    style: "nextjs-portal { display: none !important; }",
    mask: [
      page.getByText(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu),
      page.locator('input[type="email"], input[autocomplete="one-time-code"]'),
    ],
    maskColor: "#CBD5E1",
  });
}

test("capture the illustrated documentation journeys", async ({ browser }) => {
  test.setTimeout(900_000);
  await mkdir(images, { recursive: true });
  const admin = await provisionAdmin("Documentation Administrator");
  const resident = await seedHousehold();
  await asUser(admin.id, "public.update_profile($1, $2::jsonb)", [
    resident.id,
    JSON.stringify({ representativeName: "Maya Rao (example)" }),
  ]);
  await ensureFixturePolicy(admin.id);
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
    await m.getByRole("button", { name: "Send sign-in code" }).click();
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
    await m.getByRole("button", { name: "Verify and sign in" }).click();
    await expect(
      m.getByText(/code is not valid or has expired/i),
    ).toBeVisible();
    await capture(m, "03-code-error");
    await m.unroute("**/api/auth/verify");
    await m.getByLabel(/Six-digit code/).fill(await freshCode(resident.email));
    await m.getByRole("button", { name: "Verify and sign in" }).click();
    await expect(
      m.getByRole("heading", { level: 1, name: "Votes" }),
    ).toBeVisible();
    await capture(m, "04-empty-votes");
    await signInThroughUi(a, admin.email, admin.code);
    await capture(a, "15-admin-home");
    await a.goto("/admin/accounts/new");
    await capture(a, "16-create-account");
    const onboardingEmail = plusEmail();
    await a.getByLabel(/Email address/).fill(onboardingEmail);
    await a.getByLabel(/Representative name/).fill("Arun Shah (example)");
    await a.getByRole("button", { name: "Create account" }).click();
    await expect(
      a.getByRole("heading", { level: 1, name: "Arun Shah (example)" }),
    ).toBeVisible();
    const onboardingAccountPath = new URL(a.url()).pathname;
    await capture(a, "42-created-suspended");
    await a.getByRole("button", { name: "Enable account" }).click();
    await a
      .getByRole("dialog")
      .getByRole("button", { name: "Enable account" })
      .click();
    await expect(
      a.getByText("A household is needed first", { exact: true }),
    ).toBeVisible();
    await capture(a, "43-household-required");
    await a.goto("/admin/households/new");
    const newIdentifier = `DOC-${Date.now().toString(36).toUpperCase()}`;
    await a.getByLabel(/Household identifier/).fill(newIdentifier);
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
    await a.getByRole("button", { name: "Add household" }).click();
    await expect(a.getByText("Household added.")).toBeVisible();
    await a.goto(
      `/admin/households?identifier=${encodeURIComponent(newIdentifier)}`,
    );
    await capture(a, "44-household-created");
    await a.goto(onboardingAccountPath);
    await a.getByRole("button", { name: "Enable account" }).click();
    await capture(a, "45-enable-dialog");
    await a
      .getByRole("dialog")
      .getByRole("button", { name: "Enable account" })
      .click();
    await expect(
      a.getByRole("button", { name: "Suspend account" }),
    ).toBeVisible();
    await capture(a, "46-enabled-account");
    await a.goto("/admin/accounts");
    await capture(a, "47-accounts-list");
    await a.goto(`/admin/accounts/${resident.id}`);
    await capture(a, "17-account");
    await a.getByRole("button", { name: "Suspend account" }).click();
    await capture(a, "18-suspend-dialog");
    await a.keyboard.press("Escape");
    await a.getByRole("button", { name: "Delete account" }).click();
    await capture(a, "19-delete-dialog");
    await a.keyboard.press("Escape");
    await a.goto("/admin/households/new");
    await capture(a, "20-add-household");
    await a.goto(`/admin/households/${resident.householdId}`);
    await capture(a, "21-household");
    await a.goto("/admin/votes/new");
    await capture(a, "22-voting-types");
    await a.getByRole("radio", { name: /^OPEN voting/ }).check();
    await a.getByRole("button", { name: "Create draft" }).click();
    await expect(
      a.getByRole("heading", { level: 1, name: "Untitled draft" }),
    ).toBeVisible();
    const editor = new URL(a.url()).pathname;
    const voteId = editor.split("/").at(-1);
    expect(voteId).toBeTruthy();
    await a.getByRole("link", { name: "Preview ballot" }).click();
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
    await a.getByLabel("Find a household").fill(resident.identifier);
    await capture(a, "24-open-editor");
    await a.getByRole("link", { name: "Preview ballot" }).click();
    await expect(
      a.getByText("No problems found in this version"),
    ).toBeVisible();
    await capture(a, "25-ready-preview");
    await a.getByRole("button", { name: "Activate vote" }).click();
    await capture(a, "26-activate-dialog");
    await a
      .getByRole("dialog")
      .getByRole("button", { name: "Activate vote" })
      .click();
    await expect(
      a.getByText(/Vote activated\. Its type, ballot/),
    ).toBeVisible();
    await capture(a, "27-active-vote");
    await m.goto("/");
    await capture(m, "05-vote-list");
    await m.goto(`/votes/${voteId}`);
    await capture(m, "06-open-ballot");
    await m.getByRole("button", { name: "Review selections" }).click();
    await capture(m, "07-ballot-validation");
    await m.getByRole("radio", { name: "Yes" }).check();
    await m.getByRole("button", { name: "Review selections" }).click();
    await capture(m, "08-review");
    await m.route("**/api/votes/*/submission", (route) => route.abort());
    await m.route("**/api/votes/*/participation", (route) => route.abort());
    await m.getByRole("button", { name: "Submit vote" }).click();
    await expect(
      m.getByRole("heading", { name: "We could not confirm your submission" }),
    ).toBeVisible();
    await capture(m, "09-outcome-unknown");
    await m.unroute("**/api/votes/*/participation");
    await m.getByRole("button", { name: "Check again" }).click();
    await expect(
      m.getByRole("heading", { name: "Your vote has not been recorded yet" }),
    ).toBeVisible();
    await capture(m, "10-not-recorded");
    await m.unroute("**/api/votes/*/submission");
    await m.getByRole("button", { name: "Review and try again" }).click();
    await m.getByRole("button", { name: "Submit vote" }).click();
    await expect(
      m.getByRole("heading", { name: "Vote submitted." }),
    ).toBeVisible();
    await capture(m, "11-submitted");
    await m.goto(`/votes/${voteId}/results`);
    await capture(m, "12-results-not-ready");
    await a.goto(`${editor}/participation`);
    await capture(a, "28-participation");
    await a.goto(editor);
    await a.getByRole("button", { name: "Complete vote early" }).click();
    await a
      .getByRole("dialog")
      .getByRole("button", { name: "Complete vote early" })
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
      .getByRole("button", { name: "Complete vote early" })
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
      "public.create_draft('CLOSED')",
    );
    await asUser(admin.id, "public.update_draft($1, 1, $2::jsonb)", [
      closedDraft.id,
      JSON.stringify({
        title: "Committee election (example)",
        instructions: "Choose one candidate or Abstain for every office.",
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
    await a.getByLabel("Find a household").fill(resident.identifier);
    await capture(a, "32-closed-editor");
    await asUser(admin.id, "public.activate_vote($1, 2, true)", [
      closedDraft.id,
    ]);
    await m.goto(`/votes/${closedDraft.id}`);
    await capture(m, "33-closed-ballot");
    await m.getByRole("radio", { name: "Abstain" }).check();
    await m.getByRole("button", { name: "Review selections" }).click();
    await capture(m, "34-closed-review");
    await m.getByRole("button", { name: "Submit vote" }).click();
    await expect(
      m.getByRole("heading", { name: "Vote submitted." }),
    ).toBeVisible();
    await capture(m, "35-closed-submitted");
    await asUser(
      admin.id,
      "public.complete_vote_early($1, true, 'Documentation example completion')",
      [closedDraft.id],
    );
    await m.goto(`/votes/${closedDraft.id}/results`);
    await expect(m.getByText("Totals only", { exact: true })).toBeVisible();
    await capture(m, "36-closed-results");
    const cancelDraft = await asUser<{ id: string }>(
      admin.id,
      "public.create_draft('OPEN')",
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
    await a.getByRole("button", { name: "Cancel vote" }).click();
    await capture(a, "37-cancel-dialog");
    await a
      .getByLabel(/^Why is it being cancelled/)
      .fill("Example: the meeting dates need correction.");
    await a
      .getByRole("dialog")
      .getByRole("button", { name: "Cancel vote" })
      .click();
    await expect(a.getByText("Vote cancelled.", { exact: true })).toBeVisible();
    await m.goto(`/votes/${cancelDraft.id}`);
    await capture(m, "38-cancelled-member");
    await a.goto("/admin/audit");
    await capture(a, "39-audit");
    await m.goto("/admin/households");
    await capture(m, "40-no-admin-access");
    await m.goto("/");
    await m.getByRole("button", { name: "Sign out" }).click();
    await expect(
      m.getByRole("heading", { level: 1, name: "Sign in" }),
    ).toBeVisible();
    await capture(m, "41-signed-out");
  } finally {
    await memberContext.close();
    await adminContext.close();
  }
});
