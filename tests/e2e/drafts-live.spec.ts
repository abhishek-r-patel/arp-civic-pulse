import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  addOpenBallot,
  createDraftThroughUi as createDraft,
  provisionAdmin,
  saveDraft as save,
  seedHousehold,
  setDateTime,
  signInThroughUi,
} from "./support/live";
import { chooseDropdownOption } from "./support/dropdown";

/*
 * Draft setup and preview in a real browser against the dev server and YOUR
 * disposable hosted Supabase project. Skipped unless LIVE_AUTH=1. Nothing is
 * sent by email: codes come from the Auth admin API.
 */
test.skip(
  process.env.LIVE_AUTH !== "1",
  "Set LIVE_AUTH=1 and fill .env.local to run against the hosted project.",
);

const WIDTHS = [320, 375, 768, 1280];
const OPEN_NOTICE =
  /While voting is open, RWA members see only total counts\. You can change your vote until voting closes\. After that, RWA members can see your name, .+ and final vote in results and downloads\./;
const CLOSED_NOTICE = "Only totals are shown, never who chose what.";
const CLOSED_LIMITS =
  "People who run the system can still see the data. In very small votes, totals may reveal who chose what.";

test.beforeEach(() => {
  test.setTimeout(300_000);
});
test.use({ actionTimeout: 30_000, navigationTimeout: 60_000 });

async function signedInAdmin(page: Page) {
  const { email, code } = await provisionAdmin();
  await signInThroughUi(page, email, code);
}

test.describe("creating a draft", () => {
  test("requires an explicit voting type and explains both before choosing", async ({
    page,
  }) => {
    await signedInAdmin(page);
    await page.goto("/admin/votes/new");

    // Nothing is preselected, and each type is explained with its resident notice.
    await expect(page.getByRole("radio", { checked: true })).toHaveCount(0);
    await expect(page.getByText(OPEN_NOTICE)).toBeVisible();
    await expect(page.getByText(CLOSED_NOTICE)).toBeVisible();

    await page.getByRole("button", { name: "Create Draft" }).click();
    await expect(
      page.getByText("Choose PUBLIC or PRIVATE voting to continue."),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/votes\/new$/u);

    await page.getByRole("radio", { name: /^PRIVATE Voting/ }).check();
    await page.getByRole("button", { name: "Create Draft" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Untitled draft" }),
    ).toBeVisible();
    await expect(page.getByText(/Draft created\./)).toBeVisible();
    await expect(
      page.getByRole("radio", { name: /^PRIVATE Voting/ }),
    ).toBeChecked();
  });
});

test.describe("setting up a PUBLIC vote", () => {
  test("saves every section, shows the deadline in the RWA zone, and previews exactly that version", async ({
    page,
  }) => {
    const household = await seedHousehold();
    await signedInAdmin(page);
    const editor = await createDraft(page, "PUBLIC");

    await addOpenBallot(page, "Repaint the clubhouse?");
    await page
      .getByLabel(/^Background/)
      .fill("Read the quote first.\nThen decide.");

    await page.getByLabel(/^Find a /).fill(household.identifier);
    await page
      .getByRole("checkbox", { name: new RegExp(household.identifier) })
      .check();
    await expect(page.getByText("1 selected")).toBeVisible();

    await setDateTime(page, "Voting closes", "2099-06-01T18:00");
    await expect(
      page.getByText(/Residents will see: .* 1 Jun 2099, 6:00 PM IST\./),
    ).toBeVisible();

    // One click saves the edits, then previews exactly the new saved version.
    await page.getByRole("button", { name: "Save and Preview" }).click();
    await expect(page).toHaveURL(/\/preview\?revision=2$/u);
    await expect(
      page.getByRole("heading", { level: 1, name: "Preview Ballot" }),
    ).toBeVisible();
    await expect(page.getByText(/previewing version 2/)).toBeVisible();

    // The resident-facing ballot, with the approved copy and unselected, read-only choices.
    const ballot = page.getByRole("article");
    await expect(
      ballot.getByRole("heading", { name: "Repaint the clubhouse?" }),
    ).toBeVisible();
    await expect(
      ballot.getByText("PUBLIC Voting", { exact: true }),
    ).toBeVisible();
    await expect(ballot.getByText("Draft", { exact: true })).toBeVisible();
    await expect(ballot.getByText(OPEN_NOTICE)).toBeVisible();
    await expect(
      ballot.getByText(/You can change your vote until voting closes/),
    ).toBeVisible();
    await expect(
      ballot.getByText(/Voting closes .* 1 Jun 2099, 6:00 PM IST/),
    ).toBeVisible();
    await expect(ballot.getByText("Then decide.")).toBeVisible();
    const radios = ballot.getByRole("radio");
    await expect(radios).toHaveCount(2);
    for (const radio of await radios.all()) {
      await expect(radio).toBeDisabled();
      await expect(radio).not.toBeChecked();
    }

    // Who Can Vote is summarised on the preview.
    await expect(page.getByText(/1 household selected/)).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Ready to start" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Back to Editing" }),
    ).toHaveCount(1);
    await expect(
      page.getByText(
        "Set Voting opens in the draft's Deadline section, then save the draft to enable scheduling.",
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Schedule Vote" }),
    ).toBeDisabled();

    // Previewing changed nothing: still version 2.
    await page.goto(editor);
    await expect(page.getByText(/Draft, version 2\./)).toBeVisible();
    await expect(page.getByLabel(/^Question/)).toHaveValue(
      "Repaint the clubhouse?",
    );
    await expect(page.locator('input[name="closesLocal"]')).toHaveValue(
      "2099-06-01T18:00:00",
    );
  });

  test("schedules using the opening time saved in the draft", async ({
    page,
  }) => {
    const household = await seedHousehold();
    await signedInAdmin(page);
    await createDraft(page, "PUBLIC");
    await addOpenBallot(page, "Schedule this vote?");
    await page.getByLabel(/^Find a /).fill(household.identifier);
    await page
      .getByRole("checkbox", { name: new RegExp(household.identifier) })
      .check();
    await setDateTime(page, "Voting opens", "2099-06-01T17:00");
    await setDateTime(page, "Voting closes", "2099-06-01T18:00");
    await save(page, 2);

    await page.getByRole("link", { name: "Preview Ballot" }).click();
    await expect(
      page.getByRole("heading", { name: "Ready to start" }),
    ).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "Voting opens at" }),
    ).toHaveCount(0);
    const summary = page.getByRole("complementary", {
      name: "Preview summary and actions",
    });
    await expect(summary).toContainText("Voting opens1 Jun 2099, 5:00 PM IST");
    await expect(summary).toContainText("Voting closes1 Jun 2099, 6:00 PM IST");

    // The resident view collapses without affecting the start actions.
    await page.getByText("What residents will see").click();
    await expect(page.getByRole("article")).toBeHidden();
    await expect(
      page.getByRole("button", { name: "Activate Vote" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Schedule Vote" }).click();
    const confirmation = page.getByRole("dialog", {
      name: "Schedule this vote?",
    });
    await expect(confirmation).toContainText(
      "Voting opens 1 Jun 2099, 5:00 PM IST and closes 1 Jun 2099, 6:00 PM IST.",
    );
    await confirmation.getByRole("button", { name: "Cancel" }).click();
  });

  test("lists, filters and sorts votes from their column headings", async ({
    page,
  }) => {
    await signedInAdmin(page);
    await createDraft(page, "PUBLIC");
    await page.getByLabel(/^Question/).fill("Listed question");
    await setDateTime(page, "Voting closes", "2099-07-04T09:30");
    await save(page, 2);

    await page.goto("/admin/votes");
    await expect(
      page.getByRole("heading", { level: 1, name: "Manage Votes" }),
    ).toBeVisible();
    const row = page.getByRole("link", { name: /Listed question/ }).first();
    await expect(row).toBeVisible();

    await page.getByRole("button", { name: "Filter Type" }).click();
    await chooseDropdownOption(page, "Voting Type", "PRIVATE Voting");
    await page.getByRole("button", { name: "Apply Filter" }).click();
    await expect(
      page.getByRole("link", { name: /Listed question/ }),
    ).toHaveCount(0);

    await page.getByRole("link", { name: "Clear filters" }).click();
    await expect(
      page.getByRole("link", { name: /Listed question/ }).first(),
    ).toBeVisible();
    await page.getByRole("button", { name: "Filter Vote" }).click();
    await page.getByLabel("Vote title").fill("Listed question");
    await page.getByRole("button", { name: "Apply Filter" }).click();
    await expect(
      page.getByRole("link", { name: /Listed question/ }),
    ).toBeVisible();

    await page.getByRole("link", { name: "Clear filters" }).click();
    await page.getByRole("link", { name: "Sort Vote ascending" }).click();
    await expect(page).toHaveURL(/sort=title&direction=asc/u);
    await expect(
      page.getByRole("columnheader", { name: "Vote" }),
    ).toHaveAttribute("aria-sort", "ascending");
  });
});

test.describe("reordering and removing PUBLIC options", () => {
  test("reorders by drag and removes with an adjacent icon button", async ({
    page,
  }) => {
    await signedInAdmin(page);
    await createDraft(page, "PUBLIC");
    await addOpenBallot(page, "Reorder these options?");

    const options = page.locator('[data-sortable-group="options"]');
    const handle = page.getByRole("button", { name: "Reorder option 2" });
    const optionLabel = page.getByText("Opt 2", { exact: true });
    const optionInput = page.getByLabel(/^Option 2/);
    const removeButton = page.getByRole("button", {
      name: "Remove option 2",
    });
    const handleBox = await handle.boundingBox();
    const targetBox = await options.nth(0).boundingBox();
    const labelBox = await optionLabel.boundingBox();
    const inputBox = await optionInput.boundingBox();
    const removeBox = await removeButton.boundingBox();
    expect(handleBox).not.toBeNull();
    expect(targetBox).not.toBeNull();
    expect(labelBox).not.toBeNull();
    expect(inputBox).not.toBeNull();
    expect(removeBox).not.toBeNull();
    if (!handleBox || !targetBox || !labelBox || !inputBox || !removeBox) {
      throw new Error("Could not locate the option drag handle and target.");
    }
    expect(handleBox.x).toBeLessThan(labelBox.x);
    expect(labelBox.x).toBeLessThan(inputBox.x);
    expect(inputBox.x).toBeLessThan(removeBox.x);

    await page.mouse.move(
      handleBox.x + handleBox.width / 2,
      handleBox.y + handleBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      targetBox.x + targetBox.width / 2,
      targetBox.y + targetBox.height / 2,
      { steps: 8 },
    );
    await page.mouse.up();

    await expect(page.getByLabel(/^Option 1/)).toHaveValue("No");
    await expect(page.getByLabel(/^Option 2/)).toHaveValue("Yes");
    await page.getByRole("button", { name: "Remove option 1" }).click();
    await expect(page.getByLabel(/^Option/)).toHaveCount(1);
  });
});

test.describe("reordering PRIVATE offices", () => {
  test("moves offices by pointer drag", async ({ page }) => {
    await signedInAdmin(page);
    await createDraft(page, "PRIVATE");
    await page.getByRole("button", { name: "Add Office" }).click();
    await page
      .getByLabel(/^Office name/)
      .nth(0)
      .fill("Chairperson");
    await page.getByRole("button", { name: "Add Office" }).click();
    await page
      .getByLabel(/^Office name/)
      .nth(1)
      .fill("Treasurer");

    const offices = page.locator('[data-sortable-group="offices"]');
    const handle = page.getByRole("button", { name: "Reorder office 2" });
    const handleBox = await handle.boundingBox();
    const targetBox = await offices.nth(0).boundingBox();
    expect(handleBox).not.toBeNull();
    expect(targetBox).not.toBeNull();
    if (!handleBox || !targetBox) {
      throw new Error("Could not locate the office drag handle and target.");
    }

    await page.mouse.move(
      handleBox.x + handleBox.width / 2,
      handleBox.y + handleBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      targetBox.x + targetBox.width / 2,
      targetBox.y + targetBox.height / 2,
      { steps: 8 },
    );
    await page.mouse.up();

    await expect(page.getByLabel(/^Office name/).nth(0)).toHaveValue(
      "Treasurer",
    );
    await expect(page.getByLabel(/^Office name/).nth(1)).toHaveValue(
      "Chairperson",
    );
  });
});

test.describe("setting up a PRIVATE vote", () => {
  test("builds offices and candidates, adds the built-in NOTA choice only in the preview", async ({
    page,
  }) => {
    await signedInAdmin(page);
    await createDraft(page, "PRIVATE");

    await page.getByLabel(/^Title/).fill("Committee election");
    await page
      .getByLabel(/^Instructions for voters/)
      .fill("Choose one per office.");
    await page.getByRole("button", { name: "Add Office" }).click();
    await page.getByLabel(/^Office name/).fill("Chairperson");
    await page
      .getByRole("button", { name: "Add Candidate to Office 1" })
      .click();
    await page.getByLabel(/^Candidate 1/).fill("Asha Rao");
    await page
      .getByRole("button", { name: "Add Candidate to Office 1" })
      .click();
    await page.getByLabel(/^Candidate 2/).fill("Ravi Iyer");

    // NOTA is built in: authors are told not to add it as a candidate.
    await expect(page.getByText(/NOTA is added automatically/)).toBeVisible();

    // The drag handle also supports keyboard reordering.
    await page
      .getByRole("button", { name: "Reorder candidate 2 of office 1" })
      .press("Alt+ArrowUp");
    await expect(page.getByLabel(/^Candidate 1/)).toHaveValue("Ravi Iyer");
    await save(page, 2);

    await page.getByRole("link", { name: "Preview Ballot" }).click();
    const ballot = page.getByRole("article");
    await expect(
      ballot.getByText("PRIVATE Voting", { exact: true }),
    ).toBeVisible();
    await expect(ballot.getByText(CLOSED_NOTICE)).toBeVisible();
    await expect(ballot.getByText(CLOSED_LIMITS)).toHaveCount(0);
    const office = ballot.getByRole("group", { name: "Chairperson" });
    await expect(office.getByRole("radio")).toHaveCount(3);
    const names = await office.locator("label").allTextContents();
    expect(names).toEqual([
      "Ravi Iyer",
      "Asha Rao",
      "NOTA (None of the Above)",
    ]);
    for (const radio of await office.getByRole("radio").all()) {
      await expect(radio).not.toBeChecked();
    }
  });

  test("explains blockers on an incomplete draft and links to where each is fixed", async ({
    page,
  }) => {
    await signedInAdmin(page);
    await createDraft(page, "PRIVATE");
    await page.getByRole("link", { name: "Preview Ballot" }).click();

    await expect(
      page.getByText(/before this vote can be activated/),
    ).toBeVisible();
    await expect(page.getByText("Add a title.")).toBeVisible();
    await expect(page.getByText("Add at least one office.")).toBeVisible();
    await expect(
      page.getByText("Select at least one eligible household."),
    ).toBeVisible();
    await expect(page.getByText("Set a deadline.")).toBeVisible();
    await page.getByRole("link", { name: /Fix this: Add a title\./ }).click();
    await expect(page).toHaveURL(/\/admin\/votes\/[^/]+#details-heading$/u);
  });
});

test.describe("draft voting type", () => {
  test("is selected on New Vote and not repeated in the editor", async ({
    page,
  }) => {
    await signedInAdmin(page);
    await createDraft(page, "PUBLIC");
    await expect(
      page.getByRole("heading", { level: 2, name: "1. Details" }),
    ).toBeVisible();
    await expect(
      page.getByRole("radiogroup", { name: "1. Voting type" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { level: 2, name: "2. Ballot" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: "3. Who Can Vote" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: "4. Deadline" }),
    ).toBeVisible();
    await expect(
      page.getByLabel("Voting opens", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByLabel("Voting closes", { exact: true }),
    ).toBeVisible();
    await expect(page.locator('label[for="opensLocal"]')).toHaveText(
      "Voting opens",
    );
    await expect(page.locator('label[for="closesLocal"]')).toHaveText(
      "Voting closes",
    );

    await setDateTime(page, "Voting opens", "2099-06-01T00:01:02");
    await setDateTime(page, "Voting closes", "2099-06-01T12:30:45");
    await expect(page.locator('input[name="opensLocal"]')).toHaveValue(
      "2099-06-01T00:01:02",
    );
    await expect(page.locator('input[name="closesLocal"]')).toHaveValue(
      "2099-06-01T12:30:45",
    );
    await expect(
      page.getByRole("button", { name: "Voting opens", exact: true }),
    ).toContainText("12:01:02 AM");
    await expect(
      page.getByRole("button", { name: "Voting closes", exact: true }),
    ).toContainText("12:30:45 PM");

    await page.getByRole("button", { name: "Voting opens" }).click();
    const picker = page.getByRole("dialog", {
      name: "Choose voting opens",
    });
    await expect(picker).toBeVisible();
    const pickerAxe = await new AxeBuilder({ page })
      .include("dialog[open]")
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(pickerAxe.violations).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(picker).toBeHidden();
  });
});

test.describe("stale edits", () => {
  test("keeps what was typed, merges another administrator's work, and never reverts it", async ({
    page,
    context,
  }) => {
    await signedInAdmin(page);
    const editor = await createDraft(page, "PUBLIC");
    await page.getByLabel(/^Question/).fill("Original question");
    await save(page, 2);

    // Someone else (a second tab) changes the question and saves first.
    const other = await context.newPage();
    await other.goto(editor);
    await other.getByLabel(/^Question/).fill("Their question");
    await other.getByRole("button", { name: "Save Draft" }).click();
    await expect(other.getByText("Draft saved as version 3.")).toBeVisible();

    // The first tab, still on version 2, edits a different section and saves.
    await page.getByLabel(/^Background/).fill("My background");
    await page.getByRole("button", { name: "Save Draft" }).click();
    await expect(
      page.getByText("Someone saved a newer version of this draft"),
    ).toBeVisible();
    await expect(page.getByLabel(/^Background/)).toHaveValue("My background");

    await page
      .getByRole("button", { name: "Review Latest and Keep My Changes" })
      .click();
    await expect(
      page.getByText("Latest version loaded (version 3)"),
    ).toBeVisible();
    await expect(page.getByLabel(/^Question/)).toHaveValue("Their question");
    await expect(page.getByLabel(/^Background/)).toHaveValue("My background");

    await save(page, 4);
    await page.reload();
    await expect(page.getByLabel(/^Question/)).toHaveValue("Their question");
    await expect(page.getByLabel(/^Background/)).toHaveValue("My background");
    await other.close();
  });

  test("can discard local edits and load the latest version instead", async ({
    page,
    context,
  }) => {
    await signedInAdmin(page);
    const editor = await createDraft(page, "PUBLIC");

    const other = await context.newPage();
    await other.goto(editor);
    await other.getByLabel(/^Question/).fill("Winning question");
    await other.getByRole("button", { name: "Save Draft" }).click();
    await expect(other.getByText("Draft saved as version 2.")).toBeVisible();

    await page.getByLabel(/^Question/).fill("Losing question");
    await page.getByRole("button", { name: "Save Draft" }).click();
    await expect(
      page.getByText("Someone saved a newer version of this draft"),
    ).toBeVisible();

    await page
      .getByRole("button", { name: "Discard My Changes and Load Latest" })
      .click();
    await expect(page.getByLabel(/^Question/)).toHaveValue("Winning question");
    await expect(
      page.getByText(/Loaded the latest version \(version 2\)/),
    ).toBeVisible();
    await other.close();
  });

  test("shows a stale preview as out of date instead of presenting it as current", async ({
    page,
  }) => {
    await signedInAdmin(page);
    const editor = await createDraft(page, "PUBLIC");
    await page.getByLabel(/^Question/).fill("Changing question");
    await save(page, 2);

    await page.goto(`${editor}/preview?revision=1`);
    await expect(page.getByText("This preview is out of date")).toBeVisible();
    await expect(page.getByRole("article")).toHaveCount(0);
    await page
      .getByRole("link", { name: "Preview the Latest Version" })
      .click();
    await expect(page.getByText(/previewing version 2/)).toBeVisible();
  });
});

test.describe("responsive and accessible", () => {
  test("setup and preview screens reflow, pass axe, and keep 48px targets", async ({
    page,
  }) => {
    const household = await seedHousehold();
    await signedInAdmin(page);
    const editor = await createDraft(page, "PRIVATE");
    await page
      .getByLabel(/^Title/)
      .fill(
        "A rather long committee election title that must wrap rather than clip",
      );
    await page
      .getByLabel(/^Instructions for voters/)
      .fill("Choose one per office.");
    await page.getByRole("button", { name: "Add Office" }).click();
    await page.getByLabel(/^Office name/).fill("Chairperson");
    await page
      .getByRole("button", { name: "Add Candidate to Office 1" })
      .click();
    await page.getByLabel(/^Candidate 1/).fill("Asha Rao");
    await page.getByLabel("Find a household").fill(household.identifier);
    await page
      .getByRole("checkbox", { name: new RegExp(household.identifier) })
      .check();
    await setDateTime(page, "Voting closes", "2099-06-01T18:00");
    await save(page, 2);

    const paths = [
      "/admin/votes",
      "/admin/votes/new",
      editor,
      `${editor}/preview?revision=2`,
    ];

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

      await page.setViewportSize({ width: 375, height: 900 });
      await page.goto(path);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(results.violations, path).toEqual([]);

      const undersized = await page.evaluate(() => {
        const small = (box: DOMRect) => box.height < 47.5 || box.width < 47.5;
        const failures: string[] = [];
        const controls = document.querySelectorAll<HTMLElement>(
          "a[href], button, input, select, textarea",
        );
        for (const element of controls) {
          if (
            element.closest('[class*="sr-only"]') ||
            element.hasAttribute("disabled")
          ) {
            continue;
          }
          const input = element as HTMLInputElement;
          const isChoice = input.type === "checkbox" || input.type === "radio";
          // A small native choice control is fine when its whole label is the target.
          const box = isChoice
            ? input.labels?.[0]?.getBoundingClientRect()
            : element.getBoundingClientRect();
          if (box && box.width > 0 && box.height > 0 && small(box)) {
            failures.push(
              `${element.tagName.toLowerCase()}:${(element.textContent ?? input.id ?? "").trim().slice(0, 30)}`,
            );
          }
        }
        return failures;
      });
      expect(undersized, `${path} touch targets`).toEqual([]);
    }
  });

  test("the editor works with text enlarged to 200% at 320px", async ({
    page,
  }) => {
    await signedInAdmin(page);
    const editor = await createDraft(page, "PUBLIC");
    await page.setViewportSize({ width: 320, height: 900 });
    await page.goto(editor);
    await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Save Draft" }),
    ).toBeVisible();
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
  });
});
