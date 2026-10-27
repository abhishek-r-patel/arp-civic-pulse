/* Disposable-project journey for committee reads, disabled controls and preserved household voting. */
import { expect, test } from "@playwright/test";
import {
  activateVoteFor,
  asUser,
  freshCode,
  provisionAdmin,
  seedHousehold,
  signInThroughUi,
} from "./support/live";

test.use({ trace: "off", video: "off", screenshot: "off" });

test("committee observers can read management pages and still cast their own ballot", async ({
  page,
}) => {
  test.skip(
    process.env.LIVE_AUTH !== "1",
    "Explicitly opt in only on the confirmed disposable project.",
  );
  const admin = await provisionAdmin("Readonly Role Test Admin (example)");
  const observer = await seedHousehold();
  const vote = await activateVoteFor(admin.id, [observer.householdId]);
  const role = await asUser(admin.id, "public.update_profile($1,$2::jsonb)", [
    observer.id,
    JSON.stringify({ isReadonly: true }),
  ]);
  expect(role).toMatchObject({ isReadonly: true, isAdmin: false });
  await signInThroughUi(page, observer.email, await freshCode(observer.email));

  await page.getByRole("link", { name: "Accounts" }).click();
  await expect(
    page.getByText("Management changes require the RWA Admin role."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Enable Selected" }),
  ).toBeDisabled();
  await page.goto("/admin/accounts/new");
  await expect(page.getByLabel("Email address")).toBeDisabled();
  await page.goto("/admin/votes/new");
  await expect(
    page.getByRole("radio", { name: /PUBLIC voting/ }),
  ).toBeDisabled();

  await page.goto(`/votes/${vote.id}`);
  await page.getByRole("radio", { name: "Yes" }).check();
  await page.getByRole("button", { name: "Review Selections" }).click();
  await page.getByRole("button", { name: "Submit Vote" }).click();
  await expect(
    page.getByRole("heading", { name: "Your vote is recorded." }),
  ).toBeVisible();
  await asUser(
    admin.id,
    "public.complete_vote_early($1,true,'Synthetic test complete')",
    [vote.id],
  );
  await page.goto(`/votes/${vote.id}/results`);
  const csvDownload = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download CSV" }).click();
  expect((await csvDownload).suggestedFilename()).toMatch(/\.csv$/u);
  const pdfLink = page.getByRole("link", { name: "Download PDF" });
  if ((await pdfLink.count()) > 0) {
    const pdfDownload = page.waitForEvent("download");
    await pdfLink.click();
    expect((await pdfDownload).suggestedFilename()).toMatch(/\.pdf$/u);
  }
});
