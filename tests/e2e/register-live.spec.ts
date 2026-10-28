import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import {
  freshCode,
  plusEmail,
  provisionAdmin,
  seedHousehold,
  signInThroughUi,
  stubCodeRequest,
} from "./support/live";

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

// The dev server compiles each route on first use and every call crosses a
// corporate proxy to the hosted project, so allow generous time.
test.beforeEach(() => {
  test.setTimeout(240_000);
});
test.use({ actionTimeout: 30_000, navigationTimeout: 60_000 });

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
    await expect(page).toHaveURL(/cursor=/u);
    await expect(
      page.locator("[data-account-review] tbody a"),
    ).not.toHaveAttribute("href", first ?? "");
    await page.getByRole("link", { name: "First page" }).click();
    await expect(page.locator("[data-account-review] tbody a")).toHaveAttribute(
      "href",
      first ?? "",
    );

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
    await page.getByLabel(/Representative name/).fill("Browser Resident");
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
    await page.getByLabel(/Representative name/).fill("Combined Resident");
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
      await page
        .getByLabel(/Representative name/)
        .fill(`Dup Resident ${attempt}`);
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

    // Manage a second account: suspend is a destructive confirmation.
    await page.goto("/admin/residents/new");
    await page.getByLabel(/Email address/).fill(plusEmail());
    await page.getByLabel(/Representative name/).fill("Dialog Subject");
    await page.getByLabel("Management role").selectOption("rwa-admin");
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
    await page.getByLabel(/Representative name/).fill("Focus Subject");
    await page.getByLabel("Management role").selectOption("rwa-readonly");
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
      .getByLabel(/Representative name/)
      .fill("Layout Subject With A Rather Long Name That Must Wrap Not Clip");
    await page.getByLabel("Management role").selectOption("rwa-readonly");
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
