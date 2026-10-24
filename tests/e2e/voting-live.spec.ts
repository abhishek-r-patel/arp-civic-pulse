import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  activateVoteFor,
  asUser,
  freshCode,
  provisionAdmin,
  seedHousehold,
  signInThroughUi,
} from "./support/live";

/*
 * Resident voting, results, monitoring and download in a real browser against
 * the dev server and YOUR disposable hosted Supabase project. Skipped unless
 * LIVE_AUTH=1. Policy approvals are FIXTURES on a disposable project.
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

// Whitespace-free text of every page, so layout differences cannot break an exact-content check.
async function pdfText(data: Buffer): Promise<string> {
  const doc = await getDocument({ data: new Uint8Array(data) }).promise;
  const parts: string[] = [];
  for (let n = 1; n <= doc.numPages; n += 1) {
    const content = await (await doc.getPage(n)).getTextContent();
    parts.push(content.items.map((i) => ("str" in i ? i.str : "")).join(" "));
  }
  return parts.join(" ").replace(/\s+/gu, "");
}

type Resident = Awaited<ReturnType<typeof seedHousehold>>;

async function signInResident(page: Page, resident: Resident) {
  await signInThroughUi(page, resident.email, await freshCode(resident.email));
}

const complete = (adminId: string, voteId: string) =>
  asUser(adminId, "public.complete_vote_early($1, true, 'E2E completion')", [
    voteId,
  ]);

const castFor = (userId: string, voteId: string, submission: unknown) =>
  asUser(userId, "public.cast_vote($1, $2::jsonb)", [
    voteId,
    JSON.stringify(submission),
  ]);

async function sql<T>(query: string, params: unknown[] = []): Promise<T[]> {
  const client = new Client({
    connectionString: process.env.LIVE_DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    return (await client.query(query, params)).rows as T[];
  } finally {
    await client.end();
  }
}

const participationCount = async (voteId: string) =>
  Number(
    (
      await sql<{ n: string }>(
        "select count(*)::text n from public.participation where vote_id = $1",
        [voteId],
      )
    )[0]?.n,
  );

async function suspend(profileId: string) {
  const client = new Client({
    connectionString: process.env.LIVE_DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    await client.query("begin");
    await client.query("set local role cp_owner");
    await client.query(
      "update public.profiles set status = 'SUSPENDED' where id = $1",
      [profileId],
    );
    await client.query("commit");
  } finally {
    await client.end();
  }
}

async function scan(page: Page, label: string) {
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
}

const overflows = (page: Page) =>
  page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
  );

// Minimal RFC 4180 reader so the CSV can be compared cell by cell.
function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const text = csv.replace(/^\uFEFF/u, "");
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] as string;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\r" && text[i + 1] === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i += 1;
    } else {
      cell += ch;
    }
  }
  return rows;
}

test.describe("voting", () => {
  test("an OPEN vote: unselected choices, review, one submission, nothing kept", async ({
    page,
  }) => {
    const resident = await seedHousehold();
    const adminUser = await provisionAdmin();
    const vote = await activateVoteFor(adminUser.id, [resident.householdId]);
    await signInResident(page, resident);

    // Discovery: the vote is listed with its state and a deadline in the RWA zone.
    await expect(page.getByText("Not voted")).toBeVisible();
    await expect(page.getByText(/Closes .*IST/)).toBeVisible();
    await page.getByRole("link", { name: /Submission API vote/ }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Submission API vote" }),
    ).toBeVisible();
    await expect(page.getByText(/Your choice is not private/)).toBeVisible();
    await expect(page.getByText(/Your submission is final/)).toBeVisible();

    // Native radios, none selected.
    for (const label of ["Yes", "No"]) {
      await expect(page.getByRole("radio", { name: label })).not.toBeChecked();
    }

    // Reviewing without a choice is refused with a pointer to the problem.
    await page.getByRole("button", { name: "Review selections" }).click();
    await expect(
      page.getByText("Make a choice before reviewing"),
    ).toBeVisible();
    await expect(page.getByText("Choose one option.")).toBeVisible();

    await page.getByRole("radio", { name: "Yes" }).check();
    await page.getByRole("button", { name: "Review selections" }).click();
    await expect(
      page.getByRole("heading", { name: "Review your selections" }),
    ).toBeFocused();
    await expect(page.getByRole("definition")).toHaveText("Yes");

    // Back keeps the selection; nothing has been sent.
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByRole("radio", { name: "Yes" })).toBeChecked();
    await page.getByRole("button", { name: "Review selections" }).click();

    // Repeated activation sends exactly one request.
    const sent: string[] = [];
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        request.url().includes("/submission")
      ) {
        sent.push(request.url());
      }
    });
    await page.getByRole("button", { name: "Submit vote" }).dblclick();
    await expect(
      page.getByRole("heading", { name: "Vote submitted." }),
    ).toBeVisible();
    expect(sent).toHaveLength(1);
    expect(await participationCount(vote.id)).toBe(1);

    // The selection is nowhere: not in the page, the URL or browser storage.
    await expect(page.getByRole("radio")).toHaveCount(0);
    expect(page.url()).not.toContain(vote.options[0]?.id ?? "x");
    expect(
      await page.evaluate(() => localStorage.length + sessionStorage.length),
    ).toBe(0);

    // A reload shows the committed state, still without any selection.
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Vote submitted." }),
    ).toBeVisible();
    await expect(page.getByRole("radio")).toHaveCount(0);
    expect(await page.content()).not.toContain(vote.options[0]?.id ?? "x");
    await page.goto("/");
    await expect(page.getByText("Submitted", { exact: true })).toBeVisible();
  });

  test("a CLOSED vote: per-office abstain, review and a private submission", async ({
    page,
  }) => {
    const resident = await seedHousehold();
    const adminUser = await provisionAdmin();
    const vote = await activateVoteFor(
      adminUser.id,
      [resident.householdId],
      "CLOSED",
    );
    await signInResident(page, resident);
    await page.goto(`/votes/${vote.id}`);

    await expect(page.getByText(/Your selections are private/)).toBeVisible();
    await expect(
      page.getByText(/not against privileged infrastructure access/),
    ).toBeVisible();
    for (const name of ["Asha", "Ravi", "Abstain"]) {
      await expect(page.getByRole("radio", { name })).not.toBeChecked();
    }

    await page.getByRole("button", { name: "Review selections" }).click();
    await expect(
      page.getByText("Choose a candidate or Abstain."),
    ).toBeVisible();

    await page.getByRole("radio", { name: "Abstain" }).check();
    await page.getByRole("button", { name: "Review selections" }).click();
    await expect(page.getByRole("definition")).toHaveText("Abstain");
    await page.getByRole("button", { name: "Submit vote" }).click();
    await expect(
      page.getByRole("heading", { name: "Vote submitted." }),
    ).toBeVisible();

    // Participation is recorded; the counters hold the abstention, nothing identifies the voter.
    expect(await participationCount(vote.id)).toBe(1);
    const tallies = await sql<{ candidate_id: string | null; n: string }>(
      "select candidate_id, accepted_count::text n from public.closed_tallies where vote_id = $1",
      [vote.id],
    );
    expect(tallies.find((t) => t.candidate_id === null)?.n).toBe("1");
    await page.reload();
    expect(await page.content()).not.toContain(vote.offices[0]?.id ?? "x");
  });

  test("recovers from an unclear outcome by checking status before offering a retry", async ({
    page,
  }) => {
    const resident = await seedHousehold();
    const adminUser = await provisionAdmin();
    const first = await activateVoteFor(adminUser.id, [resident.householdId]);
    await signInResident(page, resident);

    const reviewYes = async (id: string) => {
      await page.goto(`/votes/${id}`);
      await page.getByRole("radio", { name: "Yes" }).check();
      await page.getByRole("button", { name: "Review selections" }).click();
    };

    // 1. The request never reaches the server: status says "not recorded", and a retry works.
    await reviewYes(first.id);
    await page.route("**/api/votes/*/submission", (route) => route.abort());
    await page.getByRole("button", { name: "Submit vote" }).click();
    await expect(
      page.getByRole("heading", {
        name: "Your vote has not been recorded yet",
      }),
    ).toBeVisible();
    expect(await participationCount(first.id)).toBe(0);
    await page.unroute("**/api/votes/*/submission");
    await page.getByRole("button", { name: "Review and try again" }).click();
    await page.getByRole("button", { name: "Submit vote" }).click();
    await expect(
      page.getByRole("heading", { name: "Vote submitted." }),
    ).toBeVisible();
    expect(await participationCount(first.id)).toBe(1);

    // 2. The server commits but the answer is lost: status finds it, no second attempt is made.
    const second = await activateVoteFor(adminUser.id, [resident.householdId]);
    await reviewYes(second.id);
    await page.route("**/api/votes/*/submission", async (route) => {
      await route.fetch();
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          error: { code: "INTERNAL_ERROR", message: "Lost" },
          requestId: "lost",
        }),
      });
    });
    await page.getByRole("button", { name: "Submit vote" }).click();
    await expect(
      page.getByRole("heading", { name: "Vote submitted." }),
    ).toBeVisible();
    expect(await participationCount(second.id)).toBe(1);
    await page.unroute("**/api/votes/*/submission");

    // 3. Neither the answer nor the status can be read: the state stays unknown, with no retry.
    const third = await activateVoteFor(adminUser.id, [resident.householdId]);
    await reviewYes(third.id);
    await page.route("**/api/votes/*/submission", (route) => route.abort());
    await page.route("**/api/votes/*/participation", (route) => route.abort());
    await page.getByRole("button", { name: "Submit vote" }).click();
    await expect(
      page.getByRole("heading", {
        name: "We could not confirm your submission",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Submit vote|Review and try again/ }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Check again" }),
    ).toBeVisible();

    // Once the status is readable again, it reports the truth.
    await page.unroute("**/api/votes/*/participation");
    await page.getByRole("button", { name: "Check again" }).click();
    await expect(
      page.getByRole("heading", {
        name: "Your vote has not been recorded yet",
      }),
    ).toBeVisible();
  });

  test("recovers from a malformed acknowledgement without submitting the ballot twice", async ({
    page,
  }) => {
    const resident = await seedHousehold();
    const adminUser = await provisionAdmin();
    const vote = await activateVoteFor(adminUser.id, [resident.householdId]);
    await signInResident(page, resident);
    await page.goto(`/votes/${vote.id}`);
    await page.getByRole("radio", { name: "Yes" }).check();
    await page.getByRole("button", { name: "Review selections" }).click();
    let submissions = 0;
    await page.route("**/api/votes/*/submission", async (route) => {
      submissions += 1;
      const actual = await route.fetch();
      expect(actual.status()).toBe(200);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "null",
      });
    });
    await page.getByRole("button", { name: "Submit vote" }).click();
    await expect(
      page.getByRole("heading", { name: "Vote submitted." }),
    ).toBeVisible();
    expect(submissions).toBe(1);
    expect(await participationCount(vote.id)).toBe(1);
  });

  test("ends the flow and keeps nothing when access is revoked mid-ballot", async ({
    page,
  }) => {
    const resident = await seedHousehold();
    const adminUser = await provisionAdmin();
    const vote = await activateVoteFor(adminUser.id, [resident.householdId]);
    await signInResident(page, resident);
    await page.goto(`/votes/${vote.id}`);
    await page.getByRole("radio", { name: "Yes" }).check();
    await page.getByRole("button", { name: "Review selections" }).click();

    await suspend(resident.id);
    await page.getByRole("button", { name: "Submit vote" }).click();
    await expect(
      page.getByRole("heading", { name: "You can no longer vote here" }),
    ).toBeVisible();
    await expect(page.getByRole("radio")).toHaveCount(0);
    expect(await participationCount(vote.id)).toBe(0);
  });

  test("answers 'not found' identically for votes the member cannot see", async ({
    page,
  }) => {
    const insider = await seedHousehold();
    const outsider = await seedHousehold();
    const adminUser = await provisionAdmin();
    const vote = await activateVoteFor(adminUser.id, [insider.householdId]);
    const draft = await asUser<{ id: string }>(
      adminUser.id,
      "public.create_draft('OPEN')",
    );
    await signInResident(page, outsider);

    for (const id of [vote.id, draft.id, "not-a-uuid"]) {
      // Streamed pages answer 200 with the not-found screen; what matters is that all three look alike.
      await page.goto(`/votes/${id}`);
      await expect(
        page.getByRole("heading", { level: 1, name: "Page not found" }),
        id,
      ).toBeVisible();
      await expect(page.getByRole("radio")).toHaveCount(0);
      const api = await page.request.get(`/api/votes/${id}`);
      expect(api.status(), id).toBe(404);
    }
    // The outsider's list never mentions the vote.
    await page.goto("/");
    await expect(page.getByText("No votes yet")).toBeVisible();
    await expect(page.getByText("Submission API vote")).toHaveCount(0);
  });
});

test.describe("results and download", () => {
  test("the screen, the API and the CSV agree exactly", async ({ page }) => {
    const [a, b, c, d] = [
      await seedHousehold(),
      await seedHousehold(),
      await seedHousehold(),
      await seedHousehold(),
    ] as const;
    const adminUser = await provisionAdmin();
    const vote = await activateVoteFor(
      adminUser.id,
      [a, b, c, d].map((r) => r.householdId),
    );
    const yes = vote.options[0]?.id;
    const no = vote.options[1]?.id;
    await castFor(a.id, vote.id, { confirmed: true, optionId: yes });
    await castFor(b.id, vote.id, { confirmed: true, optionId: yes });
    await castFor(c.id, vote.id, { confirmed: true, optionId: no });

    await signInResident(page, a);
    // Nothing is published while the vote is open.
    await page.goto(`/votes/${vote.id}/results`);
    await expect(page.getByText("Results are not available yet")).toBeVisible();
    expect(
      (await page.request.get(`/api/votes/${vote.id}/results`)).status(),
    ).toBe(409);
    expect(
      (await page.request.get(`/api/votes/${vote.id}/exports/csv`)).status(),
    ).toBe(409);
    expect(
      (await page.request.get(`/api/votes/${vote.id}/exports/pdf`)).status(),
    ).toBe(409);

    await complete(adminUser.id, vote.id);
    await page.goto(`/votes/${vote.id}/results`);
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: /Results: Submission API vote/,
      }),
    ).toBeVisible();
    await expect(page.getByText(/3 of 4/)).toBeVisible();
    await expect(
      page.getByText("Completed early by an administrator"),
    ).toBeVisible();
    await expect(page.getByText(/not a signature/)).toBeVisible();

    // Screen.
    const optionRows = page
      .getByRole("table", { name: "Votes for each option" })
      .getByRole("row");
    await expect(optionRows).toHaveCount(3); // header + two options
    const screen = await optionRows.allInnerTexts();
    expect(screen[1]).toMatch(/Yes\s+2\s+66\.67%/u);
    expect(screen[2]).toMatch(/No\s+1\s+33\.33%/u);
    for (const resident of [a, b, c]) {
      await expect(
        page.locator("#main-content").getByText(resident.name),
      ).toBeVisible();
    }
    await expect(page.locator("#main-content").getByText(d.name)).toHaveCount(
      0,
    );

    // API.
    const apiResponse = await page.request.get(`/api/votes/${vote.id}/results`);
    expect(apiResponse.status()).toBe(200);
    expect(apiResponse.headers()["cache-control"]).toMatch(/no-store/u);
    const api = (
      (await apiResponse.json()) as {
        data: {
          eligibleCount: string;
          submittedCount: string;
          turnout: { percent: string };
          options: { label: string; count: string; percent: string }[];
          outcome: string;
          namedResponses: { representativeName: string; optionLabel: string }[];
        };
      }
    ).data;
    expect(api.options.map((o) => [o.label, o.count, o.percent])).toEqual([
      ["Yes", "2", "66.67"],
      ["No", "1", "33.33"],
    ]);
    expect(api.eligibleCount).toBe("4");
    expect(api.submittedCount).toBe("3");
    expect(api.turnout.percent).toBe("75.00");
    expect(api.outcome).toBe("LEADER");

    // CSV (downloaded through the real button).
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: "Download CSV" }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(
      /^civic-pulse-results-\d{4}-\d{2}-\d{2}-[0-9a-f]{8}\.csv$/u,
    );
    const file = await download.path();
    const csv = parseCsv(await readFile(file, "utf8"));
    const header = csv[0] ?? [];
    const col = (name: string) => header.indexOf(name);
    const options = csv.filter((r) => r[col("recordType")] === "OPTION");
    expect(
      options.map((r) => [r[col("label")], r[col("count")], r[col("percent")]]),
    ).toEqual(api.options.map((o) => [o.label, o.count, o.percent]));
    const turnout = csv.find((r) => r[col("recordType")] === "TURNOUT");
    expect(turnout?.[col("numerator")]).toBe(api.submittedCount);
    expect(turnout?.[col("denominator")]).toBe(api.eligibleCount);
    expect(turnout?.[col("percent")]).toBe(api.turnout.percent);
    const named = csv
      .filter((r) => r[col("recordType")] === "NAMED_RESPONSE")
      .map((r) => `${r[col("representativeName")]}|${r[col("choice")]}`)
      .sort();
    expect(named).toEqual(
      api.namedResponses
        .map((n) => `${n.representativeName}|${n.optionLabel}`)
        .sort(),
    );
    expect(csv.every((r) => r.length === header.length)).toBe(true);
    // No emails anywhere in the file, and the early completion is labelled.
    const text = await readFile(file, "utf8");
    expect(text).not.toContain(a.email);
    expect(text).toContain("E2E completion");

    // PDF (downloaded through the real button) carries exactly the same facts.
    const [pdfDownload] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: "Download PDF" }).click(),
    ]);
    expect(pdfDownload.suggestedFilename()).toMatch(
      /^civic-pulse-results-\d{4}-\d{2}-\d{2}-[0-9a-f]{8}\.pdf$/u,
    );
    const pdf = await pdfText(await readFile(await pdfDownload.path()));
    expect(pdf).toContain("3of4eligiblehouseholds");
    expect(pdf).toContain("(75.00%)");
    for (const option of api.options) {
      expect(pdf).toContain(`${option.label}${option.count}${option.percent}%`);
    }
    for (const resident of [a, b, c]) {
      expect(pdf).toContain(resident.name.replace(/\s+/gu, ""));
    }
    expect(pdf).not.toContain(d.name.replace(/\s+/gu, ""));
    expect(pdf).toContain("E2Ecompletion");
    expect(pdf).not.toContain(a.email);
  });

  test("a CLOSED result shows totals and abstentions, with no names", async ({
    page,
  }) => {
    const a = await seedHousehold();
    const b = await seedHousehold();
    const adminUser = await provisionAdmin();
    const vote = await activateVoteFor(
      adminUser.id,
      [a, b].map((r) => r.householdId),
      "CLOSED",
    );
    const office = vote.offices[0];
    await castFor(a.id, vote.id, {
      confirmed: true,
      selections: [
        { officeId: office?.id, candidateId: office?.candidates[0]?.id },
      ],
    });
    await castFor(b.id, vote.id, {
      confirmed: true,
      selections: [{ officeId: office?.id, candidateId: null }],
    });
    await complete(adminUser.id, vote.id);

    await signInResident(page, b);
    await page.goto(`/votes/${vote.id}/results`);
    await expect(page.getByText("Totals only", { exact: true })).toBeVisible();
    await expect(page.getByText("Leading candidate")).toBeVisible();
    const table = page.getByRole("table", { name: "Results for Chair" });
    await expect(table.getByRole("row", { name: /Abstained/ })).toContainText(
      "1",
    );
    await expect(page.getByText("Who chose what")).toHaveCount(0);
    const main = await page.locator("#main-content").innerText();
    for (const resident of [a, b]) {
      expect(main).not.toContain(resident.name);
      expect(main).not.toContain(resident.identifier);
    }

    const csv = await (
      await page.request.get(`/api/votes/${vote.id}/exports/csv`)
    ).text();
    expect(csv).not.toContain("NAMED_RESPONSE");
    expect(csv).not.toContain(a.identifier);
    // PDF is included: control present, CLOSED document carries aggregates only; unknown formats are refused.
    await expect(
      page.getByRole("link", { name: "Download PDF" }),
    ).toBeVisible();
    const pdfResponse = await page.request.get(
      `/api/votes/${vote.id}/exports/pdf`,
    );
    expect(pdfResponse.status()).toBe(200);
    expect(pdfResponse.headers()["content-type"]).toBe("application/pdf");
    const closedText = await pdfText(await pdfResponse.body());
    expect(closedText).toContain("Chair");
    expect(closedText).toContain("Abstained");
    expect(closedText).not.toContain(a.identifier);
    expect(closedText).not.toContain(a.name.replace(/\s+/gu, ""));
    expect(
      (await page.request.get(`/api/votes/${vote.id}/exports/docx`)).status(),
    ).toBe(404);
  });

  test("a cancelled vote publishes nothing and offers no download", async ({
    page,
  }) => {
    const resident = await seedHousehold();
    const adminUser = await provisionAdmin();
    const vote = await activateVoteFor(adminUser.id, [resident.householdId]);
    await castFor(resident.id, vote.id, {
      confirmed: true,
      optionId: vote.options[0]?.id,
    });
    await asUser(adminUser.id, "public.cancel_vote($1, true, 'E2E cancel')", [
      vote.id,
    ]);

    await signInResident(page, resident);
    await page.goto(`/votes/${vote.id}`);
    await expect(
      page.getByText("Cancelled; results not valid.").first(),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "View results" })).toHaveCount(
      0,
    );

    await page.goto(`/votes/${vote.id}/results`);
    await expect(
      page.getByText("Cancelled; results not valid.").first(),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: /Download/ })).toHaveCount(0);
    expect(
      (await page.request.get(`/api/votes/${vote.id}/results`)).status(),
    ).toBe(409);
    expect(
      (await page.request.get(`/api/votes/${vote.id}/exports/csv`)).status(),
    ).toBe(409);
  });
});

test.describe("administrator monitoring", () => {
  test("shows participation without choices, and an audit history without secrets", async ({
    page,
  }) => {
    const a = await seedHousehold();
    const b = await seedHousehold();
    const adminUser = await provisionAdmin();
    const vote = await activateVoteFor(
      adminUser.id,
      [a, b].map((r) => r.householdId),
    );
    await castFor(a.id, vote.id, {
      confirmed: true,
      optionId: vote.options[0]?.id,
    });

    await signInThroughUi(
      page,
      adminUser.email,
      await freshCode(adminUser.email),
    );
    await page.goto(`/admin/votes/${vote.id}/participation`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Participation" }),
    ).toBeVisible();
    await expect(page.getByText(/1 of 2/)).toBeVisible();
    const table = page.getByRole("table", { name: "Household participation" });
    await expect(
      table.getByRole("row", { name: new RegExp(a.identifier) }),
    ).toContainText("Submitted");
    await expect(
      table.getByRole("row", { name: new RegExp(b.identifier) }),
    ).toContainText("Not voted");

    await page.getByLabel("Show").selectOption("false");
    await page.getByRole("button", { name: "Apply filter" }).click();
    await expect(page.getByText(b.identifier, { exact: true })).toBeVisible();
    await expect(page.getByText(a.identifier, { exact: true })).toHaveCount(0);

    // Participation JSON never carries a choice, email or time.
    const json = await (
      await page.request.get(`/api/admin/votes/${vote.id}/participation`)
    ).text();
    expect(json).not.toContain(vote.options[0]?.id ?? "x");
    expect(json).not.toContain("@");
    expect(json).not.toContain("accepted");

    await page.goto("/admin/audit");
    await expect(
      page.getByRole("heading", { level: 1, name: "Audit history" }),
    ).toBeVisible();
    const events = page.getByRole("table", { name: "Audit events" });
    await expect(events.getByText("Vote activated").first()).toBeVisible();
    await page.getByLabel("Action").selectOption("VOTE_ACTIVATED");
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(events.getByText("Vote activated").first()).toBeVisible();
    const auditText = await page.locator("#main-content").innerText();
    expect(auditText).not.toMatch(/optionId|\botp\b|ballot:/iu);
  });

  test("members cannot read monitoring or audit endpoints", async ({
    page,
  }) => {
    const resident = await seedHousehold();
    const adminUser = await provisionAdmin();
    const vote = await activateVoteFor(adminUser.id, [resident.householdId]);
    await signInResident(page, resident);
    expect(
      (
        await page.request.get(`/api/admin/votes/${vote.id}/participation`)
      ).status(),
    ).toBe(403);
    expect((await page.request.get("/api/admin/audit")).status()).toBe(403);
    await page.goto("/admin/audit");
    await expect(
      page.getByRole("heading", { level: 1, name: "Page not found" }),
    ).toBeVisible();
  });
});

test.describe("responsive and accessible", () => {
  test("resident screens reflow, pass axe, keep 48px targets and survive 200% text", async ({
    page,
    browserName,
  }) => {
    const resident = await seedHousehold();
    const adminUser = await provisionAdmin();
    const active = await activateVoteFor(adminUser.id, [resident.householdId]);
    const doneOpen = await activateVoteFor(adminUser.id, [
      resident.householdId,
    ]);
    const doneClosed = await activateVoteFor(
      adminUser.id,
      [resident.householdId],
      "CLOSED",
    );
    const cancelled = await activateVoteFor(adminUser.id, [
      resident.householdId,
    ]);
    await castFor(resident.id, doneOpen.id, {
      confirmed: true,
      optionId: doneOpen.options[0]?.id,
    });
    await castFor(resident.id, doneClosed.id, {
      confirmed: true,
      selections: [
        {
          officeId: doneClosed.offices[0]?.id,
          candidateId: doneClosed.offices[0]?.candidates[0]?.id,
        },
      ],
    });
    await complete(adminUser.id, doneOpen.id);
    await complete(adminUser.id, doneClosed.id);
    await asUser(adminUser.id, "public.cancel_vote($1, true, 'E2E cancel')", [
      cancelled.id,
    ]);
    await signInResident(page, resident);

    const paths = [
      "/",
      `/votes/${active.id}`,
      `/votes/${doneOpen.id}`,
      `/votes/${doneOpen.id}/results`,
      `/votes/${doneClosed.id}/results`,
      `/votes/${cancelled.id}`,
      `/votes/${cancelled.id}/results`,
    ];
    for (const path of paths) {
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        expect(await overflows(page), `${path} at ${width}px`).toBe(false);
      }
    }

    await page.setViewportSize({ width: 375, height: 900 });
    for (const path of paths) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await scan(page, path);
    }

    // Keyboard-driven ballot steps run in Chromium and Firefox. The automated WebKit build does not
    // deliver keyboard input to radios like Safari does; verify it on a real Safari (docs/PILOT_READINESS.md).
    if (browserName !== "webkit") {
      await page.goto(`/votes/${active.id}`);
      await page.getByRole("radio", { name: "Yes" }).focus();
      await page.keyboard.press("Space");
      await expect(page.getByRole("radio", { name: "Yes" })).toBeChecked();
      await page.getByRole("button", { name: "Review selections" }).focus();
      await page.keyboard.press("Enter");
      await expect(
        page.getByRole("heading", { name: "Review your selections" }),
      ).toBeFocused();
      await scan(page, "review step");
      await page.getByRole("button", { name: "Back" }).click();
      await page.getByRole("button", { name: "Review selections" }).click();
      await page.getByRole("button", { name: "Submit vote" }).click();
      await expect(
        page.getByRole("heading", { name: "Vote submitted." }),
      ).toBeFocused();
      await scan(page, "submitted state");
    }

    // 200% text at 320px: no element runs past the viewport.
    await page.setViewportSize({ width: 320, height: 900 });
    for (const path of [
      `/votes/${doneOpen.id}/results`,
      `/votes/${doneClosed.id}/results`,
      "/",
    ]) {
      await page.goto(path);
      await page.addStyleTag({
        content: "html { font-size: 200% !important; }",
      });
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const offenders = await page.evaluate(() => {
        const width = document.documentElement.clientWidth;
        return [...document.querySelectorAll<HTMLElement>("body *")]
          .filter(
            (el) =>
              !el.closest('[class*="sr-only"]') &&
              el.getBoundingClientRect().right > width + 1,
          )
          .slice(0, 6)
          .map(
            (el) =>
              `${el.tagName.toLowerCase()}:${(el.textContent ?? "").trim().slice(0, 24)}`,
          );
      });
      expect(offenders, `${path} at 200% text`).toEqual([]);
    }
  });

  test("administrator monitoring screens reflow, pass axe and keep 48px targets", async ({
    page,
  }) => {
    const resident = await seedHousehold();
    const adminUser = await provisionAdmin();
    const vote = await activateVoteFor(adminUser.id, [resident.householdId]);
    await signInThroughUi(
      page,
      adminUser.email,
      await freshCode(adminUser.email),
    );

    const paths = [`/admin/votes/${vote.id}/participation`, "/admin/audit"];
    for (const path of paths) {
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        expect(await overflows(page), `${path} at ${width}px`).toBe(false);
      }
    }
    await page.setViewportSize({ width: 375, height: 900 });
    for (const path of paths) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await scan(page, path);
    }
  });
});
