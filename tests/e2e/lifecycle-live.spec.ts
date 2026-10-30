import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  buildReadyOpenDraft,
  provisionAdmin,
  signInThroughUi,
  openPreview,
} from "./support/live";

/*
 * Activation and ending a vote in a real browser against the dev server and
 * YOUR disposable hosted Supabase project. Skipped unless LIVE_AUTH=1. Policy
 * approvals used here are FIXTURES on a disposable project, not real approvals.
 */
test.skip(
  process.env.LIVE_AUTH !== "1",
  "Set LIVE_AUTH=1 and fill .env.local to run against the hosted project.",
);

const WIDTHS = [320, 375, 768, 1280];

test.beforeEach(() => {
  test.setTimeout(420_000);
});
test.use({ actionTimeout: 30_000, navigationTimeout: 60_000 });

async function readyAndActivated(
  page: Page,
  closesLocal?: string,
): Promise<{ editor: string }> {
  const admin = await provisionAdmin();
  await signInThroughUi(page, admin.email, admin.code);
  const editor = await buildReadyOpenDraft(page, admin.id, closesLocal);
  await openPreview(page);
  await expect(
    page.getByText("No problems found in this version"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Activate Vote" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Activate Vote" })
    .click();
  await expect(
    page.getByText(/Vote activated\. Its type, ballot/),
  ).toBeVisible();
  return { editor };
}

test.describe("activation", () => {
  test("is offered only when ready, explains what freezes, cancels cleanly, then freezes the vote", async ({
    page,
  }) => {
    const admin = await provisionAdmin();
    await signInThroughUi(page, admin.email, admin.code);

    // An incomplete draft has no activation control at all.
    await page.goto("/admin/votes/new");
    await page.getByRole("radio", { name: /^PUBLIC Voting/ }).check();
    await page.getByRole("button", { name: "Create Draft" }).click();
    await openPreview(page);
    await expect(
      page.getByText(/^Fix \d+ things? before starting$/),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Activate Vote" }),
    ).toHaveCount(0);

    // A ready draft can be activated, after an explicit confirmation.
    const editor = await buildReadyOpenDraft(page, admin.id);
    await openPreview(page);
    await expect(
      page.getByText("No problems found in this version"),
    ).toBeVisible();
    await page.getByRole("button", { name: "Activate Vote" }).click();

    const dialog = page.getByRole("dialog", { name: "Activate this vote?" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
    await expect(dialog.getByText(/exactly as previewed/)).toBeVisible();
    await expect(dialog.getByText(/cannot be reopened/)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    // Cancelling activated nothing.
    await page.goto(editor);
    await expect(
      page.getByRole("button", { name: "Save Draft" }),
    ).toBeVisible();

    await openPreview(page);
    await page.getByRole("button", { name: "Activate Vote" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Activate Vote" })
      .click();

    // The vote is now frozen: no editor, lifecycle facts, and end-of-vote controls.
    await expect(
      page.getByText(/Vote activated\. Its type, ballot/),
    ).toBeVisible();
    await expect(
      page.getByText("Active", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Lifecycle", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(/Voting ends automatically at the deadline/),
    ).toBeVisible();
    await expect(page.getByRole("timer")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save Draft" })).toHaveCount(
      0,
    );
    await expect(page.getByLabel(/^Question/)).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Complete Vote Early" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Cancel Vote" }),
    ).toBeVisible();

    // A stale preview link can no longer be used for anything.
    await page.goto(`${editor}/preview?revision=2`);
    await expect(page).toHaveURL(new RegExp(`${editor}$`, "u"));
  });

  test("refuses to activate a revision that changed after the preview", async ({
    page,
    context,
  }) => {
    const admin = await provisionAdmin();
    await signInThroughUi(page, admin.email, admin.code);
    const editor = await buildReadyOpenDraft(page, admin.id);
    await openPreview(page);
    await expect(
      page.getByText("No problems found in this version"),
    ).toBeVisible();

    // Someone else edits the draft after this preview was rendered.
    const other = await context.newPage();
    await other.goto(editor);
    await other.getByLabel(/^Question/).fill("Edited after the preview");
    await other.getByRole("button", { name: "Save Draft" }).click();
    await expect(other.getByText("Draft saved as version 3.")).toBeVisible();
    await other.close();

    await page.getByRole("button", { name: "Activate Vote" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Activate Vote" })
      .click();
    // The refusal refreshes the page into an honest "out of date" state rather than
    // leaving an activation button for content that is no longer what was previewed.
    await expect(page.getByText("This preview is out of date")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Activate Vote" }),
    ).toHaveCount(0);

    await page.goto(editor);
    await expect(
      page.getByRole("button", { name: "Save Draft" }),
    ).toBeVisible();
  });
});

test.describe("ending a vote", () => {
  test("completes early only with a reason, and records it", async ({
    page,
  }) => {
    await readyAndActivated(page);

    await page.getByRole("button", { name: "Complete Vote Early" }).click();
    const dialog = page.getByRole("dialog", {
      name: "Complete this vote early?",
    });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/cannot be undone/)).toBeVisible();

    // No reason: refused inline, and the dialog stays open.
    await dialog.getByRole("button", { name: "Complete Vote Early" }).click();
    await expect(
      dialog.getByText("Enter a reason. It is recorded with the vote."),
    ).toBeVisible();
    await expect(dialog).toBeVisible();

    await dialog
      .getByLabel(/^Why is it being completed early/)
      .fill("Everyone has voted.");
    await dialog.getByRole("button", { name: "Complete Vote Early" }).click();

    await expect(
      page.getByText("Vote completed early.", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Completed early by an administrator"),
    ).toBeVisible();
    await expect(page.getByText("Everyone has voted.")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Complete Vote Early" }),
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Cancel Vote" })).toHaveCount(
      0,
    );
  });

  test("cancels with a reason and shows the invalid-result notice", async ({
    page,
  }) => {
    await readyAndActivated(page);

    await page.getByRole("button", { name: "Cancel Vote" }).click();
    const dialog = page.getByRole("dialog", { name: "Cancel this vote?" });
    await expect(dialog.getByText(/results not valid/)).toBeVisible();
    await dialog
      .getByLabel(/^Why is it being cancelled/)
      .fill("The option list was wrong.");
    await dialog.getByRole("button", { name: "Cancel Vote" }).click();

    await expect(
      page.getByText("Vote cancelled.", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Cancelled; results not valid.")).toBeVisible();
    await expect(page.getByText("The option list was wrong.")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Complete Vote Early" }),
    ).toHaveCount(0);
  });

  test("an overdue vote completes at its deadline and the late action is refused", async ({
    page,
  }) => {
    // Deadline 1-2 minutes ahead, in the RWA time zone, then wait for it to pass.
    const target = new Date(Date.now() + 120_000);
    const local = target
      .toLocaleString("sv-SE", { timeZone: "Asia/Kolkata" })
      .replace(" ", "T")
      .slice(0, 16);
    // The page refreshes itself when its countdown reaches zero; freezing the
    // browser clock keeps it stale so the server's refusal is what is tested.
    await page.clock.setFixedTime(new Date());
    await readyAndActivated(page, local);

    // Wait until the deadline has certainly passed WITHOUT reloading, so the page
    // still offers the action, exactly like a stale tab would.
    await page.waitForTimeout(
      Math.max(0, target.getTime() - Date.now()) + 4_000,
    );

    await page.getByRole("button", { name: "Complete Vote Early" }).click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByLabel(/^Why is it being completed early/)
      .fill("Too late to matter");
    await dialog.getByRole("button", { name: "Complete Vote Early" }).click();

    await expect(
      page
        .getByText(/deadline had already passed|already been completed/)
        .first(),
    ).toBeVisible();
    await page.reload();
    await expect(page.getByText("Ran to its deadline")).toBeVisible();
    await expect(
      page.getByText("Completed early by an administrator"),
    ).toHaveCount(0);
  });
});

test.describe("responsive and accessible", () => {
  test("activation and lifecycle screens reflow, pass axe, and keep 48px targets", async ({
    page,
  }) => {
    const { editor } = await readyAndActivated(page);

    const paths = [editor];
    for (const path of paths) {
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        const overflow = await page.evaluate(
          () =>
            document.documentElement.scrollWidth >
            document.documentElement.clientWidth,
        );
        expect(overflow, `${path} at ${width}px`).toBe(false);
      }
    }

    await page.setViewportSize({ width: 375, height: 900 });
    await page.goto(editor);
    const scan = async (label: string) => {
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(results.violations, label).toEqual([]);
      const undersized = await page.evaluate(() => {
        const failures: string[] = [];
        for (const element of document.querySelectorAll<HTMLElement>(
          "a[href], button, input, select, textarea",
        )) {
          if (
            element.closest('[class*="sr-only"]') ||
            element.hasAttribute("disabled")
          ) {
            continue;
          }
          const box = element.getBoundingClientRect();
          if (
            box.width > 0 &&
            box.height > 0 &&
            (box.height < 47.5 || box.width < 47.5)
          ) {
            const input = element as HTMLInputElement;
            const choice = input.type === "checkbox" || input.type === "radio";
            const target = choice
              ? input.labels?.[0]?.getBoundingClientRect()
              : box;
            if (target && (target.height < 47.5 || target.width < 47.5)) {
              failures.push(
                `${element.tagName.toLowerCase()}:${(element.textContent ?? "").trim().slice(0, 30)}`,
              );
            }
          }
        }
        return failures;
      });
      expect(undersized, `${label} touch targets`).toEqual([]);
    };

    await scan("active vote");

    // The confirmation dialog on a phone, including its reason field.
    await page.getByRole("button", { name: "Cancel Vote" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await scan("cancel dialog open");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(
      page.getByRole("button", { name: "Cancel Vote" }),
    ).toBeFocused();
  });
});
