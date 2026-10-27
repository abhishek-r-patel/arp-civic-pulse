import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  addOpenBallot,
  createDraftThroughUi as createDraft,
  provisionAdmin,
  saveDraft as save,
  seedHousehold,
  signInThroughUi,
} from "./support/live";

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
  /While voting is open, eligible members, RWA Admins and RWA ReadOnly observers can see aggregate counts only\. You can change your selection until voting closes\. After it ends, your name, .+ and final selections are visible in authorized results and downloads\./;
const CLOSED_NOTICE =
  "Your selections are not shown to the Resident, RWA Admin or RWA ReadOnly personas through the app. Results show totals only.";
const CLOSED_LIMITS =
  "This protects choices within the app, not against privileged infrastructure access. Results from very small elections may allow people to infer choices.";

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

    await page.getByRole("radio", { name: /^PRIVATE voting/ }).check();
    await page.getByRole("button", { name: "Create Draft" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Untitled draft" }),
    ).toBeVisible();
    await expect(page.getByText(/Draft created\./)).toBeVisible();
    await expect(
      page.getByRole("radio", { name: /^PRIVATE voting/ }),
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

    await page.getByLabel(/^Voting closes/).fill("2099-06-01T18:00");
    await expect(
      page.getByText(/Residents will see: .* 1 Jun 2099, 6:00 PM IST\./),
    ).toBeVisible();

    // Unsaved edits cannot be previewed as if they were the saved draft.
    await expect(
      page.getByRole("button", { name: "Save to Preview" }),
    ).toBeDisabled();
    await save(page, 2);

    await page.getByRole("link", { name: "Preview Ballot" }).click();
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
      ballot.getByText("PUBLIC voting", { exact: true }),
    ).toBeVisible();
    await expect(ballot.getByText("Draft", { exact: true })).toBeVisible();
    await expect(ballot.getByText(OPEN_NOTICE)).toBeVisible();
    await expect(
      ballot.getByText(/You can change your selection until voting closes/),
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

    // Electorate is summarised on the preview.
    await expect(page.getByText(/1 household selected/)).toBeVisible();

    // Previewing changed nothing: still version 2.
    await page.goto(editor);
    await expect(page.getByText(/Draft, version 2\./)).toBeVisible();
    await expect(page.getByLabel(/^Question/)).toHaveValue(
      "Repaint the clubhouse?",
    );
    await expect(page.getByLabel(/^Voting closes/)).toHaveValue(
      "2099-06-01T18:00",
    );
  });

  test("lists the draft with its type, status and deadline, and filters by type", async ({
    page,
  }) => {
    await signedInAdmin(page);
    await createDraft(page, "PUBLIC");
    await page.getByLabel(/^Question/).fill("Listed question");
    await page.getByLabel(/^Voting closes/).fill("2099-07-04T09:30");
    await save(page, 2);

    await page.goto("/admin/votes");
    await expect(
      page.getByRole("heading", { level: 1, name: "Manage Votes" }),
    ).toBeVisible();
    const row = page.getByRole("link", { name: /Listed question/ }).first();
    await expect(row).toBeVisible();

    await page.getByLabel("Voting type").selectOption("PRIVATE");
    await page.getByRole("button", { name: "Apply Filters" }).click();
    await expect(
      page.getByRole("link", { name: /Listed question/ }),
    ).toHaveCount(0);
    await page.getByRole("link", { name: "Clear" }).click();
    await expect(
      page.getByRole("link", { name: /Listed question/ }).first(),
    ).toBeVisible();
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

    // Reordering is explicit and keyboard-operable.
    await page
      .getByRole("button", { name: "Move candidate 2 of office 1 up" })
      .click();
    await expect(page.getByLabel(/^Candidate 1/)).toHaveValue("Ravi Iyer");
    await save(page, 2);

    await page.getByRole("link", { name: "Preview Ballot" }).click();
    const ballot = page.getByRole("article");
    await expect(
      ballot.getByText("PRIVATE voting", { exact: true }),
    ).toBeVisible();
    await expect(ballot.getByText(CLOSED_NOTICE)).toBeVisible();
    await expect(ballot.getByText(CLOSED_LIMITS)).toBeVisible();
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

test.describe("changing the voting type", () => {
  test("asks first, cancels cleanly with Esc, and removes the other shape on confirm", async ({
    page,
  }) => {
    await signedInAdmin(page);
    await createDraft(page, "PUBLIC");
    await addOpenBallot(page, "Type change question");
    await save(page, 2);

    // The radio stays on PUBLIC until confirmed, so click rather than check().
    const closed = page.getByRole("radio", { name: /^PRIVATE voting/ });
    await closed.click();
    const dialog = page.getByRole("dialog", {
      name: "Change to PRIVATE voting?",
    });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByText(/removes the options you have entered/),
    ).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole("radio", { name: /^PUBLIC voting/ }),
    ).toBeChecked();
    await expect(page.getByLabel(/^Option 1/)).toHaveValue("Yes");

    await closed.click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Change Type" })
      .click();
    await expect(
      page.getByRole("radio", { name: /^PRIVATE voting/ }),
    ).toBeChecked();
    await expect(
      page.getByRole("button", { name: "Add Office" }),
    ).toBeVisible();
    await save(page, 3);

    await page.reload();
    await expect(
      page.getByRole("radio", { name: /^PRIVATE voting/ }),
    ).toBeChecked();
    await expect(page.getByLabel(/^Option 1/)).toHaveCount(0);
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
    await page.getByLabel(/^Voting closes/).fill("2099-06-01T18:00");
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
