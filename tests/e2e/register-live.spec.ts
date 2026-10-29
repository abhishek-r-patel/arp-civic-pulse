import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import {
  activateVoteFor,
  asUser,
  freshCode,
  plusEmail,
  provisionAdmin,
  seedHousehold,
  signInThroughUi,
  stubCodeRequest,
} from "./support/live";
import { chooseDropdownOption } from "./support/dropdown";

/*
 * Real browser journeys against the dev server and YOUR disposable hosted
 * Supabase project (values from .env.local). Skipped unless LIVE_AUTH=1.
 * One-time codes come from the Auth admin API, so no inbox is needed. Codes for
 * registered addresses are never requested through the UI here, so no email is
 * sent.
 */
test.skip(
  process.env.LIVE_AUTH !== "1",
  "Set LIVE_AUTH=1 and fill .env.local to run against the hosted project.",
);

const WIDTHS = [320, 375, 768, 1280];

test("resident eligibility edits inline with cancel, failure and persistent save", async ({
  page,
}) => {
  const admin = await provisionAdmin();
  const resident = await seedHousehold();
  await signInThroughUi(page, admin.email, admin.code);
  const path = `/admin/residents/${resident.id}`;
  await page.goto(path);
  const panel = page.locator("#household");
  const change = panel.getByRole("button", {
    name: "Change eligibility",
    exact: true,
  });
  const editor = panel.getByRole("form", {
    name: "Voting eligibility",
    exact: true,
  });
  const checkbox = editor.getByRole("checkbox", {
    name: "Eligible to vote",
    exact: true,
  });
  const save = editor.getByRole("button", {
    name: "Save Changes",
    exact: true,
  });
  for (const width of [320, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await change.click();
    await expect(change).toHaveAttribute("aria-expanded", "true");
    await expect(checkbox).toBeChecked();
    await checkbox.uncheck();
    await expect(
      editor.getByText(
        "A vote that is already active keeps the electorate it started with.",
      ),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
    await editor.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(editor).toHaveCount(0);
    await expect(change).toBeFocused();
    await expect(panel.getByText("Eligible", { exact: true })).toBeVisible();
  }
  await change.click();
  await save.click();
  await expect(editor.getByText("There are no changes to save.")).toBeVisible();
  await checkbox.uncheck();
  const endpoint = `**/api/admin/households/${resident.householdId}`;
  await page.route(endpoint, (route) => route.abort("failed"));
  await save.click();
  await expect(editor.getByRole("alert")).toBeVisible();
  await expect(checkbox).not.toBeChecked();
  await expect(panel.getByText("Eligible", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${path}$`));
  await page.unroute(endpoint);
  await save.click();
  await expect(editor).toHaveCount(0);
  await expect(panel.getByText("Not eligible", { exact: true })).toBeVisible();
  await expect(
    panel.getByText(
      "Voting eligibility updated. Existing votes are unchanged.",
    ),
  ).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${path}$`));
  await page.reload();
  await expect(panel.getByText("Not eligible", { exact: true })).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Status", exact: true })
      .getByText("Enabled", { exact: true }),
  ).toBeVisible();
  await change.click();
  await checkbox.check();
  await save.click();
  await expect(panel.getByText("Eligible", { exact: true })).toBeVisible();
});

test("Source is an icon column with global sorting and its own filter", async ({
  page,
}) => {
  const admin = await provisionAdmin();
  await seedHousehold();
  await signInThroughUi(page, admin.email, admin.code);
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.goto("/admin/residents?isAdmin=all&limit=10&page=2");
  await expect(
    page
      .locator("[data-resident-toolbar]")
      .getByRole("link", { name: "Clear filters", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Sort Source ascending", exact: true })
    .click();
  await expect(page).toHaveURL(/sort=source/);
  await expect(page).not.toHaveURL(/[?&]page=/);
  const header = page.getByRole("columnheader", {
    name: "Source",
    exact: true,
  });
  await expect(header).toHaveAttribute("aria-sort", "ascending");
  await expect(
    page.getByRole("button", { name: "Filter Source", exact: true }),
  ).toHaveCount(1);
  const icon = page
    .locator("tbody details summary[title='Admin-registered']")
    .first();
  await expect(icon).toBeVisible();
  await expect(icon.locator(".sr-only")).toHaveText("Admin-registered");
  await icon.click();
  await expect(icon.locator("..")).toHaveAttribute("open");
  await icon.click();
  await page
    .getByRole("link", { name: "Sort Source descending", exact: true })
    .click();
  await expect(header).toHaveAttribute("aria-sort", "descending");
  for (const [label, value] of [
    ["Self-registered", "true"],
    ["Admin-registered", "false"],
  ] as const) {
    await page
      .getByRole("button", { name: "Filter Source", exact: true })
      .click();
    const panel = page.getByRole("dialog", {
      name: "Filter Source",
      exact: true,
    });
    await panel.getByRole("combobox", { name: "Source", exact: true }).click();
    await panel.getByRole("option", { name: label, exact: true }).click();
    await panel
      .getByRole("button", { name: "Apply Filters", exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`selfRegistered=${value}`));
    await expect(
      page.getByRole("heading", { name: "Residents", exact: true }),
    ).toBeVisible();
    await expect(
      page.locator("tbody details summary").filter({
        has: page.locator(".sr-only", {
          hasText:
            label === "Self-registered"
              ? "Admin-registered"
              : "Self-registered",
        }),
      }),
    ).toHaveCount(0);
  }
  await page.setViewportSize({ width: 320, height: 900 });
  await page
    .getByRole("button", { name: "Sort & Filter", exact: true })
    .click();
  const mobile = page.getByRole("dialog", {
    name: "Sort & Filter",
    exact: true,
  });
  await mobile.getByRole("combobox", { name: "Sort By", exact: true }).click();
  await mobile.getByRole("option", { name: "Source", exact: true }).click();
  await mobile
    .getByRole("button", { name: "Apply Filters", exact: true })
    .click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
});

test("configured welcome message stays on resident Votes, not administration screens", async ({
  page,
}) => {
  const admin = await provisionAdmin();
  await signInThroughUi(page, admin.email, admin.code);
  const branding = await asUser<{ welcomeMessage: string }>(
    admin.id,
    "public.get_rwa_branding()",
    [],
  );
  await page.goto("/");
  const message = page.getByRole("region", {
    name: "Message from your RWA",
    exact: true,
  });
  if (branding.welcomeMessage) {
    await expect(message).toHaveText(branding.welcomeMessage);
  } else {
    await expect(message).toHaveCount(0);
  }
  for (const path of ["/admin/residents", "/admin/votes"]) {
    await page.goto(path);
    await expect(
      page.getByRole("heading", {
        name: path.endsWith("residents") ? "Residents" : "Manage Votes",
        exact: true,
      }),
    ).toBeVisible();
    await expect(message).toHaveCount(0);
  }
  await page.goto("/admin/settings");
  await page
    .getByLabel("Information about Welcome Message", { exact: true })
    .click();
  await expect(
    page.getByText(
      "Appears only on the resident-facing Votes page, not administration screens",
      { exact: false },
    ),
  ).toBeVisible();
});

test("form-focused pages center their heading and controls while directories stay wide", async ({
  page,
}) => {
  const admin = await provisionAdmin();
  const resident = await seedHousehold();
  const draft = await asUser<{ id: string }>(
    admin.id,
    "public.create_draft($1)",
    ["PUBLIC"],
  );
  const active = await activateVoteFor(admin.id, [resident.householdId]);
  await signInThroughUi(page, admin.email, admin.code);
  const paths = [
    "/admin/residents/new",
    "/admin/residents/import",
    `/admin/residents/${resident.id}`,
    "/admin/settings",
    "/admin/votes/new",
    `/admin/votes/${draft.id}`,
    `/admin/votes/${draft.id}/preview`,
    `/votes/${active.id}`,
  ];
  for (const width of [320, 1280, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of paths) {
      await page.goto(path);
      const wrapper = page.locator("[data-form-page]");
      await expect(wrapper).toBeVisible();
      const layout = await wrapper.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
          width: rect.width,
          center: rect.left + rect.width / 2,
          viewport: document.documentElement.clientWidth,
          overflow: document.documentElement.scrollWidth > innerWidth,
        };
      });
      expect(layout.width).toBe(
        Math.min(640, layout.viewport - (width < 768 ? 32 : 48)),
      );
      expect(Math.abs(layout.center - layout.viewport / 2)).toBeLessThan(1);
      expect(layout.overflow).toBe(false);
      if (path === "/admin/residents/import" && width === 1280) {
        await page.getByLabel("Register CSV").setInputFiles({
          name: "preview.csv",
          mimeType: "text/csv",
          buffer: Buffer.from(
            [
              "identifier,representative_name,email,is_eligible",
              ...Array.from(
                { length: 5 },
                (_, index) =>
                  `DOC-${width}-${index + 1},Example Resident ${index + 1},preview-${width}-${index + 1}@example.test,true`,
              ),
            ].join("\n"),
          ),
        });
        await expect(
          page.getByText("Browse files", { exact: true }),
        ).toBeVisible();
        await expect(
          page.getByText("preview.csv", { exact: true }),
        ).toBeVisible();
        const preview = page.getByRole("region", {
          name: "Register import preview and results table",
        });
        await expect(preview).toHaveCount(0);
        await page.getByRole("button", { name: "Check Register" }).click();
        await expect(preview.getByRole("row")).toHaveCount(6);
        for (const previewWidth of [320, 1280, 1920]) {
          await page.setViewportSize({ width: previewWidth, height: 900 });
          const previewLayout = await preview.evaluate((element) => {
            const form = document.querySelector(".form-panel");
            return {
              formWidth: form?.getBoundingClientRect().width ?? 0,
              tableWidth: element.getBoundingClientRect().width,
              overflow: element.scrollWidth > element.clientWidth,
              pageOverflow: document.documentElement.scrollWidth > innerWidth,
            };
          });
          expect(previewLayout.overflow).toBe(false);
          expect(previewLayout.pageOverflow).toBe(false);
          if (previewWidth >= 768)
            expect(previewLayout.tableWidth).toBeGreaterThan(
              previewLayout.formWidth,
            );
        }
        await page.setViewportSize({ width, height: 900 });
      }
      if (path === `/admin/residents/${resident.id}`) {
        const status = page.getByRole("region", {
          name: "Status",
          exact: true,
        });
        const heading = await status
          .getByRole("heading", { name: "Status", exact: true })
          .boundingBox();
        const badge = await status
          .locator("span")
          .filter({ hasText: /^Enabled$/ })
          .boundingBox();
        if (!heading || !badge)
          throw new Error("Missing resident status heading or badge.");
        expect(
          Math.abs(heading.y + heading.height / 2 - badge.y - badge.height / 2),
        ).toBeLessThan(1);
        await expect(page.locator("form.form-panel")).toBeVisible();
        await expect(page.locator("#household.form-panel")).toBeVisible();
        const actions = page.locator("[data-resident-actions]");
        await expect(
          page.getByRole("link", {
            name: "Close resident details",
            exact: true,
          }),
        ).toHaveAttribute("href", "/admin/residents");
        await expect(actions.getByRole("link")).toHaveCount(0);
        await expect(
          actions.getByRole("button", { name: "Suspend Account", exact: true }),
        ).toHaveClass(/text-warning/);
        await expect(
          actions.getByRole("button", { name: "Delete Account", exact: true }),
        ).toHaveClass(/bg-error/);
        const suspend = actions.getByRole("button", {
          name: "Suspend Account",
          exact: true,
        });
        const remove = actions.getByRole("button", {
          name: "Delete Account",
          exact: true,
        });
        await expect(suspend).toHaveAttribute(
          "title",
          /cannot sign in, vote or view signed-in pages/,
        );
        await expect(suspend).toHaveAccessibleDescription(
          /enable the account again later.*Past votes remain unchanged/,
        );
        await expect(remove).toHaveAttribute(
          "title",
          /permanently loses account access/,
        );
        await expect(remove).toHaveAccessibleDescription(
          /cannot be restored.*Past votes and audit history are retained/,
        );
        if (width >= 1280) {
          const tops = await actions
            .locator("button, a")
            .evaluateAll((elements) =>
              elements.map((element) => element.getBoundingClientRect().top),
            );
          expect(tops).toHaveLength(3);
          expect(new Set(tops).size).toBe(1);
          const alignment = await actions.evaluate((element) => {
            const first = element
              .querySelector("button")
              ?.getBoundingClientRect();
            const form = element.closest("form");
            if (!first || !form)
              throw new Error("Missing resident action or form.");
            const formRect = form.getBoundingClientRect();
            return {
              actionLeft: first.left,
              contentLeft:
                formRect.left +
                Number.parseFloat(getComputedStyle(form).paddingLeft),
            };
          });
          expect(
            Math.abs(alignment.actionLeft - alignment.contentLeft),
          ).toBeLessThan(1);
        }
      }
    }
    await page.goto("/admin/residents");
    await expect(page.locator("[data-account-review]")).toBeVisible();
    expect(await page.locator("[data-form-page]").count()).toBe(0);
    if (width > 640) {
      const table = await page.locator("[data-data-table]").boundingBox();
      expect(table?.width).toBeGreaterThan(640);
    }
  }
});

// The dev server compiles each route on first use and every call crosses a
// corporate proxy to the hosted project, so allow generous time.
test.beforeEach(() => {
  test.setTimeout(240_000);
});
test.use({ actionTimeout: 30_000, navigationTimeout: 60_000 });

test("Add Resident keeps opt-ins inline inside a bordered responsive form", async ({
  page,
}) => {
  const admin = await provisionAdmin();
  await signInThroughUi(page, admin.email, admin.code);
  await page.goto("/admin/residents/new");
  const form = page.locator("[data-form-page] form");
  for (const width of [320, 375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const layout = await form.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        borders: [
          style.borderTopWidth,
          style.borderRightWidth,
          style.borderBottomWidth,
          style.borderLeftWidth,
        ],
        padding: parseFloat(style.paddingLeft),
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    expect(layout.borders).toEqual(["1px", "1px", "1px", "1px"]);
    expect(layout.padding).toBe(width < 768 ? 16 : 24);
    expect(layout.overflow).toBe(false);
    const requiredLabel = await form
      .locator('label[for="representativeName"]')
      .evaluate((element) => {
        const text = element.firstChild;
        const marker = element.querySelector('[aria-hidden="true"]');
        if (!text || !marker) {
          throw new Error("Resident name must have a required marker.");
        }
        const range = document.createRange();
        const label = text.textContent ?? "";
        range.setStart(text, label.lastIndexOf(" ") + 1);
        range.setEnd(text, label.length);
        return {
          wordTop: range.getBoundingClientRect().top,
          markerTop: marker.getBoundingClientRect().top,
          height: element.getBoundingClientRect().height,
          lineHeight: parseFloat(getComputedStyle(element).lineHeight),
        };
      });
    expect(requiredLabel.markerTop).toBe(requiredLabel.wordTop);
    if (width >= 768) {
      expect(requiredLabel.height).toBe(requiredLabel.lineHeight);
    }
    const eligible = form.getByRole("checkbox", {
      name: "Eligible to vote",
      exact: true,
    });
    const enable = form.getByRole("checkbox", {
      name: "Enable account now",
      exact: true,
    });
    await expect(eligible).toBeDisabled();
    await expect(enable).toBeDisabled();
    if (width >= 768) {
      const first = await eligible.boundingBox();
      const second = await enable.boundingBox();
      expect(first).not.toBeNull();
      expect(second).not.toBeNull();
      if (!first || !second) {
        throw new Error("Both resident opt-ins must have visible bounds.");
      }
      expect(first.y).toBe(second.y);
      expect(second.x).toBeGreaterThan(first.x + first.width);
    }
    for (const label of ["Eligible to vote", "Enable account now"]) {
      const help = form.getByLabel(`Information about ${label}`, {
        exact: true,
      });
      await help.click();
      await expect(help.locator("..")).toHaveAttribute("open");
      await help.click();
    }
  }
});

test("resident role options show names without internal codes", async ({
  page,
}) => {
  const { email, code } = await provisionAdmin();
  await signInThroughUi(page, email, code);
  for (const path of ["/admin/residents/new", "/admin/residents"]) {
    await page.goto(path);
    if (path === "/admin/residents") {
      const headers = page
        .getByRole("table", {
          name: "Account access and voting eligibility review",
        })
        .getByRole("columnheader");
      await expect(headers).toHaveCount(9);
      for (const [index, title] of [
        [1, "Representative"],
        [3, "Status"],
        [4, "Role"],
        [5, "Voting Eligibility"],
        [6, "Last Changed"],
        [7, "Source"],
      ] as const) {
        await expect(headers.nth(index)).toHaveAttribute("aria-label", title);
      }
      await page
        .getByRole("button", { name: "Filter Role", exact: true })
        .click();
      const filters = page.locator("form").filter({
        has: page.getByRole("button", { name: "Apply Filters", exact: true }),
      });
      await expect(
        filters.getByText("(optional)", { exact: true }),
      ).toHaveCount(0);
    }
    if (path.endsWith("/new")) {
      const summary = page.getByText("Before you add a resident", {
        exact: true,
      });
      const guidance = page.locator("details").filter({ has: summary });
      await expect(guidance).not.toHaveAttribute("open");
      await summary.click();
      await expect(guidance.getByRole("listitem")).toHaveCount(3);
      await expect(
        guidance.getByText(/eligibility is approved separately/),
      ).toBeVisible();
      await summary.click();
      await expect(guidance).not.toHaveAttribute("open");
    }
    await page.getByRole("combobox", { name: "Role", exact: true }).click();
    const menu = page.getByRole("listbox", { name: "Role", exact: true });
    await expect(menu.getByRole("option")).toHaveText(
      path.endsWith("/new")
        ? ["Voter", "RWA Admin", "RWA ReadOnly"]
        : ["All roles", "RWA Admin", "RWA ReadOnly", "Voter"],
    );
    await page.keyboard.press("Escape");
  }
});

test("resident table controls preserve global query state and fit phone viewports", async ({
  page,
}) => {
  const admin = await provisionAdmin();
  await signInThroughUi(page, admin.email, admin.code);
  await page.goto("/admin/residents?page=2&limit=10");
  const manage = page.locator('tbody a[href^="/admin/residents/"]').first();
  await expect(manage).toHaveAttribute("aria-label", /^Manage .+/);
  await expect(manage).toHaveAttribute("title", /^Manage .+/);
  await expect(manage).toHaveText("");
  await expect(manage.locator("svg")).toBeVisible();
  await page
    .getByRole("link", { name: "Sort Representative ascending", exact: true })
    .click();
  await expect(
    page.getByRole("columnheader", { name: "Representative", exact: true }),
  ).toHaveAttribute("aria-sort", "ascending");
  await expect(page).not.toHaveURL(/[?&]page=/);
  await expect(page).toHaveURL(/[?&]limit=10/);
  await page
    .getByRole("button", { name: "Filter Last Changed", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Changed From", exact: true })
    .fill("2000-01-01T00:00");
  await page
    .getByRole("textbox", { name: "Changed Before", exact: true })
    .fill("2100-01-01T00:00");
  await page
    .getByRole("button", { name: "Apply Filters", exact: true })
    .click();
  await expect(page).toHaveURL(/changedTo=/);
  await page.getByRole("button", { name: "Filter Role", exact: true }).click();
  await chooseDropdownOption(page, "Role", "All roles");
  await page
    .getByRole("button", { name: "Apply Filters", exact: true })
    .click();
  await expect(page).toHaveURL(/isAdmin=all/);
  await expect(page).toHaveURL(/changedFrom=/);
  await expect(
    page.getByText("Residents could not be loaded", { exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Filter Representative", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Representative", exact: true })
    .fill("no-synthetic-match-938574");
  await page
    .getByRole("button", { name: "Apply Filters", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "No residents match these filters",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Filter Representative", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 320, height: 740 });
  await page
    .getByRole("button", { name: "Sort & Filter", exact: true })
    .click();
  const panel = page.getByRole("dialog", {
    name: "Sort & Filter",
    exact: true,
  });
  await expect(panel).toBeVisible();
  const bounds = await panel.boundingBox();
  expect(bounds).not.toBeNull();
  expect(
    bounds &&
      bounds.x >= 0 &&
      bounds.y >= 0 &&
      bounds.x + bounds.width <= 320 &&
      bounds.y + bounds.height <= 740,
  ).toBe(true);
  await chooseDropdownOption(page, "Role", "Voter");
  await page
    .getByRole("textbox", { name: "Representative", exact: true })
    .fill("");
  await page
    .getByRole("button", { name: "Apply Filters", exact: true })
    .click();
  await expect(page).not.toHaveURL(/representative=/);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("link", { name: "Clear filters", exact: true }).click();
  await expect(page).toHaveURL(/sort=representative/);
  await expect(page).toHaveURL(/direction=asc/);
  await expect(page).toHaveURL(/limit=10/);
  await expect(page).not.toHaveURL(
    /(?:isAdmin|changedFrom|changedTo|representative)=/,
  );
  await expect(page).not.toHaveURL(/[?&]page=/);
  await expect(
    page.getByRole("columnheader", {
      name: "Representative",
      exact: true,
    }),
  ).toHaveAttribute("aria-sort", "ascending");
  await expect(page.getByText("0 selected", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 920 });
  const identifier = (
    await page
      .locator("tbody tr td:nth-child(3) > span.min-w-0")
      .first()
      .innerText()
  ).trim();
  const partial = identifier.slice(1).toLowerCase();
  const householdHeader = page.getByRole("columnheader").nth(2);
  await householdHeader.getByRole("button").click();
  const filterPanel = page.locator("[popover]:popover-open");
  await filterPanel.locator("input:not([type=hidden])").fill(partial);
  await page
    .getByRole("button", { name: "Apply Filters", exact: true })
    .click();
  await expect(page).toHaveURL(/identifier=/);
  await expect(
    page.getByText("Residents could not be loaded", { exact: true }),
  ).toHaveCount(0);
  const matches = await page
    .locator("tbody tr td:nth-child(3) > span.min-w-0")
    .allTextContents();
  expect(matches.length).toBeGreaterThan(0);
  expect(matches.every((value) => value.toLowerCase().includes(partial))).toBe(
    true,
  );
});

test.describe("sign-in screen", () => {
  test("shows a generic acknowledgement for an unregistered address and no code is sent", async ({
    page,
  }) => {
    await page.goto("/sign-in");
    await page
      .getByLabel(/Registered email address/)
      .fill(plusEmail().replace("+cp", "+unknown"));
    await page.getByRole("button", { name: "Send Sign-In Code" }).click();

    await expect(
      page.getByText("Check your email", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(/If this address can sign in/)).toBeVisible();
    // Never confirms registration.
    await expect(page.getByText(/not registered|no account/i)).toHaveCount(0);
  });

  test("the code field accepts paste, strips separators, keeps leading zeros and hints autofill", async ({
    page,
  }) => {
    await stubCodeRequest(page);
    await page.goto("/sign-in");
    await page
      .getByLabel(/Registered email address/)
      .fill("someone@example.com");
    await page.getByRole("button", { name: "Send Sign-In Code" }).click();

    const code = page.getByLabel(/Six-digit code/);
    await expect(code).toBeFocused();
    await expect(code).toHaveAttribute("autocomplete", "one-time-code");
    await expect(code).toHaveAttribute("inputmode", "numeric");
    await expect(code).toHaveAttribute("type", "text");

    await code.fill("012 345 99");
    await expect(code).toHaveValue("012345");
    const verify = page.getByRole("button", { name: "Verify and Sign In" });
    await expect(verify).toBeEnabled();

    await code.fill("0123");
    await expect(code).toHaveValue("0123");
    await expect(verify).toBeDisabled();
  });

  test("a wrong code gives guidance without revealing why, and keeps the typed email", async ({
    page,
  }) => {
    await stubCodeRequest(page);
    await page.goto("/sign-in");
    await page
      .getByLabel(/Registered email address/)
      .fill("someone@example.com");
    await page.getByRole("button", { name: "Send Sign-In Code" }).click();
    await page.getByLabel(/Six-digit code/).fill("000000");
    await page.getByRole("button", { name: "Verify and Sign In" }).click();

    await expect(page.getByText(/not valid or has expired/)).toBeVisible();
    await expect(page.getByText(/Sent to someone@example.com/)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Send a New Code" }),
    ).toBeDisabled();
  });

  test("a registered administrator signs in, sees navigation, and signs out", async ({
    page,
  }) => {
    const { email, code } = await provisionAdmin();
    await signInThroughUi(page, email, code);

    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(
      nav.getByRole("link", { name: "Votes", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(nav.getByRole("link", { name: "Residents" })).toBeVisible();
    await expect(
      nav.getByRole("link", { name: "Accounts", exact: true }),
    ).toHaveCount(0);
    await expect(
      nav.getByRole("link", { name: "Settings", exact: true }),
    ).toHaveCount(0);

    const settingsLink = page.getByRole("link", {
      name: "Settings",
      exact: true,
    });
    await expect(settingsLink).toHaveAttribute("href", "/admin/settings");
    await expect(settingsLink).toHaveAttribute("title", "Settings");
    await expect(settingsLink.locator("svg")).toBeVisible();

    const settingsBounds = await settingsLink.boundingBox();
    const signOutBounds = await page
      .getByRole("button", { name: "Sign Out" })
      .boundingBox();
    expect(settingsBounds).not.toBeNull();
    expect(signOutBounds).not.toBeNull();
    if (!settingsBounds || !signOutBounds) {
      throw new Error("Settings and Sign Out controls must be visible.");
    }
    expect(settingsBounds.x + settingsBounds.width).toBeLessThan(
      signOutBounds.x,
    );

    await page.getByRole("button", { name: "Sign Out" }).click();
    await expect(page).toHaveURL(/\/sign-in$/u);
    await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(0);

    // The session is really gone: protected pages bounce back to sign-in.
    await page.goto("/admin/residents");
    await expect(page).toHaveURL(/\/sign-in$/u);
  });
});

test.describe("register screens", () => {
  test("Residents supports no-flat filtering, pagination and responsive accessible layouts", async ({
    page,
  }) => {
    const admin = await provisionAdmin();
    await seedHousehold();
    await signInThroughUi(page, admin.email, admin.code);
    await page.goto("/admin/residents?isAdmin=all&isEligible=unassigned");
    await expect(
      page.getByText("Not assigned", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Residents could not be loaded" }),
    ).toHaveCount(0);
    await page.goto("/admin/residents?isAdmin=all&limit=1");
    const first = await page
      .locator("[data-account-review] tbody a")
      .getAttribute("href");
    await page.getByRole("link", { name: "Next page" }).click();
    await expect(page).toHaveURL(/page=2/u);
    await expect(
      page.getByRole("navigation", { name: "Pagination" }),
    ).toContainText(/Page 2 of \d+/u);
    await expect(
      page.locator("[data-account-review] tbody a"),
    ).not.toHaveAttribute("href", first ?? "");
    await page.getByRole("link", { name: "First page" }).click();
    await expect(page.locator("[data-account-review] tbody a")).toHaveAttribute(
      "href",
      first ?? "",
    );
    const pagination = page.getByRole("navigation", { name: "Pagination" });
    await pagination.getByRole("link", { name: "Last page" }).click();
    await expect(
      pagination.getByLabel("Next page", { exact: true }),
    ).toHaveAttribute("aria-disabled", "true");
    await pagination.getByRole("link", { name: "Previous page" }).click();
    await expect(
      pagination.getByRole("link", { name: "Next page" }),
    ).toBeVisible();
    await chooseDropdownOption(page, "Per page", "10");
    await expect(page).toHaveURL(/[?&]limit=10(?:&|$)/u);
    await expect(page).toHaveURL(/limit=10/u);
    await expect(page).not.toHaveURL(/page=/u);
    await expect(pagination).toContainText(/Page 1 of \d+/u);

    for (const route of ["/admin/residents", "/admin/residents/new"]) {
      await page.goto(route);
      for (const mode of ["Light", "Dark"] as const) {
        const theme = page.locator("details[data-theme-control]");
        if ((await theme.getAttribute("open")) === null)
          await theme.locator("summary").click();
        await theme.getByRole("radio", { name: mode, exact: true }).check();
        await page.keyboard.press("Escape");
        for (const width of [320, 375, 768, 1280]) {
          await page.setViewportSize({ width, height: 900 });
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth > innerWidth,
            ),
            `${route}, ${mode}, ${width}px`,
          ).toBe(false);
        }
        await page.setViewportSize({ width: 375, height: 900 });
        const audit = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
          .analyze();
        expect(audit.violations, `${route}, ${mode}`).toEqual([]);
      }
    }
  });

  test("an administrator creates and manages a resident and flat together", async ({
    page,
  }) => {
    const { email, code } = await provisionAdmin();
    await signInThroughUi(page, email, code);

    await page
      .getByRole("navigation", { name: "Main" })
      .getByRole("link", { name: "Residents" })
      .click();
    await expect(page).toHaveURL(/\/admin\/residents$/u);

    // Create an account.
    await page.goto("/admin/residents/new");
    const residentEmail = plusEmail();
    await page.getByLabel(/Email address/).fill(residentEmail);
    await page.getByLabel(/Resident name/).fill("Browser Resident");
    await page.getByRole("button", { name: "Create Resident" }).click();
    await expect(page.getByText(/before creating a resident/)).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/residents\/new$/u);
    const identifier = `BR-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    await page.locator('[id="household.identifier"]').fill(identifier);
    await page.getByRole("button", { name: "Create Resident" }).click();

    await expect(
      page.getByRole("heading", { level: 1, name: "Browser Resident" }),
    ).toBeVisible();
    await expect(
      page.getByText("Account created.", { exact: false }),
    ).toBeVisible();
    // Earlier runs leave similar accounts behind, so return by URL, not by list position.
    const accountPath = new URL(page.url()).pathname;
    // Find the resident and flat together using the directory filters.
    await page.goto(
      `/admin/residents?identifier=${encodeURIComponent(identifier.toLowerCase())}&isEligible=false`,
    );
    await expect(page).toHaveURL(/\/admin\/residents\?/u);
    await expect(
      page.getByRole("link", { name: "Manage Browser Resident" }),
    ).toBeVisible();
    await expect(page.getByText(identifier, { exact: true })).toBeVisible();

    await page.goto(accountPath);
    await page.getByRole("link", { name: "Change eligibility" }).click();
    await page.getByLabel("Eligible to vote").check();
    await page.getByRole("button", { name: "Save Changes" }).click();
    await expect(page).toHaveURL(
      /\/admin\/residents\?notice=household-updated/u,
    );
    await page.goto(accountPath);
    await page.getByRole("button", { name: "Enable Account" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Enable Account" })
      .click();
    await expect(page.getByText("Account updated.")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Suspend Account" }),
    ).toBeVisible();

    // One step: account, household, eligibility and access together.
    const combined = `BC-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    await page.goto("/admin/residents/new");
    await page.getByLabel(/Email address/).fill(plusEmail());
    await page.getByLabel(/Resident name/).fill("Combined Resident");
    await page.locator('[id="household.identifier"]').fill(combined);
    await page.getByLabel("Eligible to vote").check();
    await page.getByLabel("Enable account now").check();
    await page.getByRole("button", { name: "Create Resident" }).click();
    await expect(page.getByText("Account created and enabled.")).toBeVisible();
    await expect(page.getByText(combined, { exact: true })).toBeVisible();
  });

  test("a duplicate household identifier is explained at the field", async ({
    page,
  }) => {
    const { email, code } = await provisionAdmin();
    await signInThroughUi(page, email, code);
    const identifier = `DUP-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

    for (const attempt of [1, 2]) {
      await page.goto("/admin/residents/new");
      await page.getByLabel(/Email address/).fill(plusEmail());
      await page.getByLabel(/Resident name/).fill(`Dup Resident ${attempt}`);
      await page
        .locator('[id="household.identifier"]')
        .fill(attempt === 1 ? identifier : ` ${identifier.toLowerCase()} `);
      await page.getByRole("button", { name: "Create Resident" }).click();
      if (attempt === 1) {
        // Let the first creation finish; navigating away would abort the request.
        await expect(page.getByRole("heading", { level: 1 })).toContainText(
          "Dup Resident",
        );
      }
    }

    await expect(
      page.getByText("This is already assigned to another account.").first(),
    ).toBeVisible();
    // Next.js adds its own route announcer with role="alert".
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "Please fix the highlighted fields" }),
    ).toBeFocused();
  });
});

test.describe("confirmation dialog", () => {
  test("Esc cancels without acting and returns focus to the control that opened it", async ({
    page,
  }) => {
    const { email, code } = await provisionAdmin();
    await signInThroughUi(page, email, code);

    // Manage a second account without performing the destructive action.
    await page.goto("/admin/residents/new");
    await page
      .getByRole("textbox", { name: /Email address/ })
      .fill(plusEmail());
    await page
      .getByRole("textbox", { name: /Resident name/ })
      .fill("Dialog Subject");
    await chooseDropdownOption(page, "Role", "RWA Admin");
    await page.getByRole("button", { name: "Create Resident" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Dialog Subject" }),
    ).toBeVisible();

    const opener = page.getByRole("button", { name: "Delete Account" });
    await opener.click();

    const dialog = page.getByRole("dialog", { name: "Delete this account?" });
    await expect(dialog).toBeVisible();
    // Cancel takes initial focus; a destructive action is never auto-focused.
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
    await expect(dialog.getByText(/cannot be undone/)).toBeVisible();
    await expect(
      dialog.getByText("Sign in to Civic Pulse.", { exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByText(
        "Cast a vote or change a response in an active PUBLIC poll.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      dialog.getByText("View votes, results or any other signed-in pages.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      dialog.getByText("Recommend: Suspend Account instead", { exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByText(/enable the account again later. Deletion is permanent/),
    ).toBeVisible();
    await expect(
      dialog.getByText(
        /does not erase their submitted votes, past records or audit history/,
      ),
    ).toBeVisible();

    for (const [width, height] of [
      [320, 640],
      [375, 812],
      [768, 1024],
      [1280, 900],
      [844, 390],
    ] as const) {
      await page.setViewportSize({ width, height });
      await expect
        .poll(
          async () =>
            dialog.evaluate((element) => {
              const box = element.getBoundingClientRect();
              return Math.max(
                Math.abs(box.left + box.width / 2 - innerWidth / 2),
                Math.abs(box.top + box.height / 2 - innerHeight / 2),
              );
            }),
          { message: `Dialog centered at ${width}x${height}` },
        )
        .toBeLessThanOrEqual(1);
      const bounds = await dialog.boundingBox();
      expect(bounds).not.toBeNull();
      if (!bounds) throw new Error("Visible dialog has no bounds.");
      expect(bounds.x).toBeGreaterThanOrEqual(16);
      expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width - 16);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(height);
    }

    // Synthetic DOM content exercises scrolling without changing application data.
    await dialog.evaluate((element) => {
      const content = document.createElement("p");
      content.textContent = "Synthetic long confirmation content. ".repeat(100);
      element.querySelector("h2")?.after(content);
    });
    await page.setViewportSize({ width: 375, height: 480 });
    expect(
      await dialog.evaluate(
        (element) => element.scrollHeight > element.clientHeight,
      ),
    ).toBe(true);
    await expect
      .poll(async () =>
        dialog.evaluate((element) => {
          const box = element.getBoundingClientRect();
          return Math.abs(box.top + box.height / 2 - innerHeight / 2);
        }),
      )
      .toBeLessThanOrEqual(1);
    await dialog
      .getByRole("button", { name: "Cancel" })
      .scrollIntoViewIfNeeded();
    await expect(
      dialog.getByRole("button", { name: "Cancel" }),
    ).toBeInViewport();

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
    await expect(page.getByText("Deleted")).toHaveCount(0);

    // Explicit cancel behaves the same.
    await opener.click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Cancel" })
      .click();
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(page.getByText("Deleted")).toHaveCount(0);
  });

  test("focus stays inside the open dialog", async ({ page }) => {
    const { email, code } = await provisionAdmin();
    await signInThroughUi(page, email, code);
    await page.goto("/admin/residents/new");
    await page.getByLabel(/Email address/).fill(plusEmail());
    await page.getByLabel(/Resident name/).fill("Focus Subject");
    await chooseDropdownOption(page, "Role", "RWA ReadOnly");
    await page.getByLabel("Enable account now").check();
    await page.getByRole("button", { name: "Create Resident" }).click();
    await expect(page.getByText("Account created and enabled.")).toBeVisible();
    await page.getByRole("button", { name: "Delete Account" }).click();

    const dialog = page.getByRole("dialog");
    // A modal dialog may hand focus to the browser itself (activeElement is then
    // the body), but never to a control on the inert page behind it.
    let inDialog = 0;
    for (let press = 0; press < 8; press += 1) {
      await page.keyboard.press("Tab");
      const where = await page.evaluate(() => {
        const active = document.activeElement;
        if (active?.closest("dialog")) {
          return "dialog";
        }
        return active === document.body ? "browser" : "page";
      });
      expect(where).not.toBe("page");
      if (where === "dialog") {
        inDialog += 1;
      }
    }
    expect(inDialog).toBeGreaterThan(0);
    await expect(dialog).toBeVisible();
  });
});

test.describe("responsive and accessible", () => {
  test("admin screens reflow, have no axe violations, and keep 48px targets", async ({
    page,
  }) => {
    const { email, code } = await provisionAdmin();
    await signInThroughUi(page, email, code);

    await page.goto("/admin/residents/new");
    await page.getByLabel(/Email address/).fill(plusEmail());
    await page
      .getByLabel(/Resident name/)
      .fill("Layout Subject With A Rather Long Name That Must Wrap Not Clip");
    await chooseDropdownOption(page, "Role", "RWA ReadOnly");
    await page.getByRole("button", { name: "Create Resident" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "Layout Subject",
    );
    const accountPath = new URL(page.url()).pathname;

    const paths = [
      "/",
      "/admin/residents",
      "/admin/residents/new",
      accountPath,
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

      // Every interactive control is at least 48px tall, and wide enough to tap.
      const undersized = await page.evaluate(() =>
        [
          ...document.querySelectorAll<HTMLElement>(
            "a[href], button, input:not([type=checkbox]), select, textarea",
          ),
        ]
          .filter((element) => {
            const box = element.getBoundingClientRect();
            const visible =
              box.width > 0 && box.height > 0 && !element.closest(".sr-only");
            return visible && (box.height < 47.5 || box.width < 47.5);
          })
          .map(
            (element) =>
              `${element.tagName.toLowerCase()}:${(element.textContent ?? "").trim().slice(0, 30)}`,
          ),
      );
      expect(undersized, `${path} touch targets`).toEqual([]);
    }
  });

  test("text can be enlarged to 200% without losing content or scrolling sideways", async ({
    page,
  }) => {
    const { email, code } = await provisionAdmin();
    await signInThroughUi(page, email, code);
    await page.setViewportSize({ width: 320, height: 900 });
    await page.goto("/admin/residents");
    await page.addStyleTag({ content: "html { font-size: 200% !important; }" });

    await expect(
      page.getByRole("heading", { level: 1, name: "Residents" }),
    ).toBeVisible();
    const overflowing = await page.evaluate(() => {
      const width = document.documentElement.clientWidth;
      const offenders = [
        ...document.querySelectorAll<HTMLElement>("body *"),
      ].filter(
        (element) =>
          !element.closest('[class*="sr-only"]') &&
          element.getBoundingClientRect().right > width + 1,
      );
      // Report the innermost elements: ancestors overflow only because of them.
      return offenders
        .filter(
          (element) =>
            !offenders.some(
              (other) => other !== element && element.contains(other),
            ),
        )
        .slice(0, 6)
        .map((element) => {
          const box = element.getBoundingClientRect();
          return `${element.tagName.toLowerCase()}:${(element.textContent ?? "").trim().slice(0, 24)}@${Math.round(box.left)}-${Math.round(box.right)}`;
        });
    });
    expect(overflowing, "elements wider than the viewport").toEqual([]);
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
  });
});

test("a fresh code for the same address still verifies after the first was used", async ({
  page,
}) => {
  const { email, code } = await provisionAdmin();
  await signInThroughUi(page, email, code);
  await page.getByRole("button", { name: "Sign Out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/u);

  await signInThroughUi(page, email, await freshCode(email));
});
