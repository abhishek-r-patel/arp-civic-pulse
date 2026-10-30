// Synthetic browser fixtures for explicitly opted-in disposable projects; database TLS is verified.
import { randomBytes, randomInt } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { expect, type Page } from "@playwright/test";
import type { Client } from "pg";
import { operationalDatabaseClient } from "../../../scripts/ops/database";

/*
 * Helpers for the LIVE_AUTH browser specs. They talk to YOUR disposable hosted
 * Supabase project through the service-role key from .env.local, and obtain
 * one-time codes through the Auth admin API instead of an inbox.
 */
function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export function plusEmail(): string {
  const [local, domain] = (process.env.LIVE_TEST_EMAIL ?? "")
    .toLowerCase()
    .split("@");
  return `${local}+cp${randomBytes(4).toString("hex")}@${domain}`;
}

export async function freshCode(email: string): Promise<string> {
  const link = await admin().auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  const code = link.data?.properties?.email_otp;
  expect(code, link.error?.message).toMatch(/^\d{6}$/u);
  return code ?? "";
}

export async function provisionAdmin(
  name = "Browser Admin",
): Promise<{ id: string; email: string; code: string }> {
  const client = admin();
  const email = plusEmail();

  const created = await client.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  const id = created.data.user?.id;
  expect(id, created.error?.message).toBeTruthy();

  const provisioned = await client.rpc("provision_profile", {
    p_auth_user_id: id,
    p_representative_name: name,
    p_is_admin: true,
    p_actor_profile_id: null,
  });
  expect(provisioned.error).toBeNull();
  const enabled = await client.rpc("enable_profile", {
    p_profile_id: id,
    p_actor_profile_id: null,
  });
  expect(enabled.error).toBeNull();

  return { id: id ?? "", email, code: await freshCode(email) };
}

// Stands in for the code request so no email is sent; verification afterwards is real.
export async function stubCodeRequest(page: Page): Promise<void> {
  await page.route("**/api/auth/code", (route) =>
    route.fulfill({
      status: 202,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({
        data: {
          message:
            "If this address can sign in, a code may arrive shortly. If it does not, wait before requesting another code or contact the administrator.",
          resendAfterSeconds: 60,
        },
        requestId: "00000000-0000-4000-8000-000000000000",
      }),
    }),
  );
}

export async function signInThroughUi(
  page: Page,
  email: string,
  code: string,
): Promise<void> {
  await stubCodeRequest(page);
  await page.goto("/sign-in");
  await page
    .getByRole("textbox", { name: /^Registered email address/ })
    .fill(email);
  await page.getByRole("button", { name: "Send Sign-In Code" }).click();
  await page.getByRole("textbox", { name: /^Six-digit code/ }).fill(code);
  await page.getByRole("button", { name: "Verify and Sign In" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Votes" }),
  ).toBeVisible();
}

// A realistic flat-style identifier such as "H-513" (block, floor, unit).
function realisticIdentifier(): string {
  const block = "ABCDEFGHJK"[randomInt(10)];
  return `${block}-${randomInt(1, 20)}${String(randomInt(1, 21)).padStart(2, "0")}`;
}

function liveSql(): Client {
  return operationalDatabaseClient(process.env.LIVE_DATABASE_URL ?? "");
}

/**
 * Returns `preferred` when no household uses it yet, otherwise an unused
 * realistic identifier, so repeated runs on the same project do not collide.
 */
export async function unusedIdentifier(preferred?: string): Promise<string> {
  const sql = liveSql();
  await sql.connect();
  try {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const candidate =
        attempt === 0 && preferred ? preferred : realisticIdentifier();
      const taken = await sql.query(
        "select 1 from public.households where identifier_normalized = app_private.normalize_key($1)",
        [candidate],
      );
      if (taken.rowCount === 0) {
        return candidate;
      }
    }
  } finally {
    await sql.end();
  }
  throw new Error("No unused synthetic identifier was found.");
}

/**
 * An enabled resident with an eligible household, so a draft can select it.
 * Synthetic data only; the disposable project is reset afterwards.
 */
export async function seedHousehold(
  options: { identifier?: string } = {},
): Promise<{
  identifier: string;
  name: string;
  id: string;
  email: string;
  householdId: string;
}> {
  const client = admin();
  const email = plusEmail();
  const identifier = await unusedIdentifier(options.identifier);
  const name = `Resident ${identifier}`;

  const created = await client.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  const id = created.data.user?.id;
  expect(id, created.error?.message).toBeTruthy();

  const provisioned = await client.rpc("provision_profile", {
    p_auth_user_id: id,
    p_representative_name: name,
    p_is_admin: false,
    p_actor_profile_id: null,
  });
  expect(provisioned.error).toBeNull();

  const sql = liveSql();
  await sql.connect();
  let householdId = "";
  try {
    const inserted = await sql.query<{ id: string }>(
      `insert into public.households (identifier, identifier_normalized, representative_profile_id, is_eligible)
       values ($1, app_private.normalize_key($1), $2, true) returning id`,
      [identifier, id],
    );
    householdId = inserted.rows[0]?.id ?? "";
  } finally {
    await sql.end();
  }

  const enabled = await client.rpc("enable_profile", {
    p_profile_id: id,
    p_actor_profile_id: null,
  });
  expect(enabled.error).toBeNull();
  return { identifier, name, id: id ?? "", email, householdId };
}

/**
 * Runs one guarded routine exactly as a signed-in API request does (the
 * authenticated role with that user's claims), committed on its own.
 */
export async function asUser<T>(
  userId: string,
  sql: string,
  params: unknown[] = [],
): Promise<T> {
  const client = liveSql();
  await client.connect();
  try {
    await client.query("begin");
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: userId, role: "authenticated" }),
    ]);
    const result = await client.query<{ r: T }>(`select ${sql} as r`, params);
    await client.query("commit");
    return result.rows[0]?.r as T;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
}

/** Creates and ACTIVATES a vote whose electorate is the given households. */
export async function activateVoteFor(
  adminId: string,
  householdIds: string[],
  type: "PUBLIC" | "PRIVATE" = "PUBLIC",
  closesInMs = 3_600_000,
): Promise<{
  id: string;
  options: { id: string; label: string }[];
  offices: { id: string; candidates: { id: string }[] }[];
}> {
  await ensureFixturePolicy(adminId);
  const draft = await asUser<{ id: string }>(
    adminId,
    "public.create_draft($1)",
    [type],
  );
  const closesAt = new Date(Date.now() + closesInMs).toISOString();
  const changes =
    type === "PUBLIC"
      ? {
          title: "Submission API vote",
          closesAt,
          options: [
            { label: "Yes", position: 1 },
            { label: "No", position: 2 },
          ],
          eligibleHouseholdIds: householdIds,
        }
      : {
          title: "Submission API election",
          instructions: "One per office.",
          closesAt,
          offices: [
            {
              name: "Chair",
              position: 1,
              candidates: [
                { name: "Asha", position: 1 },
                { name: "Ravi", position: 2 },
              ],
            },
          ],
          eligibleHouseholdIds: householdIds,
        };
  await asUser(adminId, "public.update_draft($1, 1, $2::jsonb)", [
    draft.id,
    JSON.stringify(changes),
  ]);
  return asUser(adminId, "public.activate_vote($1, 2, true)", [draft.id]);
}

/**
 * Records FIXTURE policy approvals and retention on the disposable project so
 * activation can be exercised. These are not real approvals and must never be
 * copied to a real deployment. Idempotent.
 */
export async function ensureFixturePolicy(adminId: string): Promise<void> {
  const sql = liveSql();
  await sql.connect();
  try {
    const settings = await sql.query("select 1 from public.rwa_settings");
    if (settings.rowCount === 0) {
      await sql.query(
        "select app_private.deployment_initialize_settings('Live RWA', 'Asia/Kolkata')",
      );
    }
    for (const key of ["A1", "A2", "A3", "A4", "A5", "A6", "A7"]) {
      const have = await sql.query(
        "select 1 from public.rwa_settings where policy_approvals ? $1",
        [key],
      );
      if (have.rowCount === 0) {
        await sql.query(
          "select app_private.deployment_record_policy_approval($1, 'fixture-v1', now(), $2, 'FIXTURE ONLY (disposable project)', 'APPROVED')",
          [key, adminId],
        );
      }
    }
    await sql.query(
      `update public.rwa_settings
          set vote_retention_days = coalesce(vote_retention_days, 365),
              audit_retention_days = coalesce(audit_retention_days, 365),
              inactive_profile_retention_days = coalesce(inactive_profile_retention_days, 365),
              rate_limit_retention_days = coalesce(rate_limit_retention_days, 30),
              backup_retention_days = coalesce(backup_retention_days, 90)
        where id = 1`,
    );
  } finally {
    await sql.end();
  }
}

export async function createDraftThroughUi(
  page: Page,
  type: "PUBLIC" | "PRIVATE",
): Promise<string> {
  await page.goto("/admin/votes/new");
  await page
    .getByRole("radio", { name: new RegExp(`^${type} Voting`) })
    .check();
  await page.getByRole("button", { name: "Create Draft" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Untitled draft" }),
  ).toBeVisible();
  return new URL(page.url()).pathname;
}

export async function addOpenBallot(
  page: Page,
  question: string,
): Promise<void> {
  await page.getByLabel(/^Question/).fill(question);
  await page.getByRole("button", { name: "Add Option" }).click();
  await page.getByLabel(/^Option 1/).fill("Yes");
  await page.getByRole("button", { name: "Add Option" }).click();
  await page.getByLabel(/^Option 2/).fill("No");
}

export async function saveDraft(
  page: Page,
  expectedVersion: number,
): Promise<void> {
  await page.getByRole("button", { name: "Save Draft" }).click();
  await expect(
    page.getByText(`Draft saved as version ${expectedVersion}.`),
  ).toBeVisible();
}

/**
 * Opens the preview from the editor. A draft with unsaved edits (including a
 * just-created draft's prefilled deadline) offers "Save and Preview" instead
 * of the "Preview Ballot" link.
 */
export async function openPreview(page: Page): Promise<void> {
  await page
    .getByRole("link", { name: "Preview Ballot" })
    .or(page.getByRole("button", { name: "Save and Preview" }))
    .click();
  await expect(page).toHaveURL(/\/preview(?:\?|$)/u);
}

export async function setDateTime(
  page: Page,
  label: "Voting opens" | "Voting closes",
  value: string,
): Promise<void> {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/u.exec(
    value,
  );
  expect(match, "A valid local date/time is required").not.toBeNull();
  const [, year, month, day, hour, minute, second] = match ?? [];
  const yearNumber = Number(year);
  const monthNumber = Number(month);
  const dayNumber = Number(day);
  const monthName = new Intl.DateTimeFormat("en", {
    month: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(yearNumber, monthNumber - 1, 1)));
  const fullDate = new Intl.DateTimeFormat("en", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(yearNumber, monthNumber - 1, dayNumber)));
  const dialog = page.getByRole("dialog", {
    name: `Choose ${label.toLowerCase()}`,
  });

  await page.getByRole("button", { name: label, exact: true }).click();
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole("region", { name: "Calendar" })
    .getByRole("button")
    .nth(1)
    .click();
  await dialog.getByLabel("Year").fill(year ?? "");
  await dialog.getByRole("button", { name: monthName, exact: true }).click();
  await dialog.getByRole("button", { name: fullDate, exact: true }).click();
  const hour24 = Number(hour);
  const hour12 = hour24 % 12 || 12;
  await dialog
    .getByLabel("Hour", { exact: true })
    .fill(String(hour12).padStart(2, "0"));
  await dialog.getByLabel("Minute", { exact: true }).fill(minute ?? "");
  await dialog.getByLabel("Second", { exact: true }).fill(second ?? "00");
  await dialog
    .getByRole("button", {
      name: hour24 >= 12 ? "PM" : "AM",
      exact: true,
    })
    .click();
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
}

/** A saved PUBLIC draft that previews as ready (one eligible household, a deadline, two options). */
export async function buildReadyOpenDraft(
  page: Page,
  adminId: string,
  closesLocal = "2099-06-01T18:00",
): Promise<string> {
  await ensureFixturePolicy(adminId);
  const household = await seedHousehold();
  const editor = await createDraftThroughUi(page, "PUBLIC");
  await addOpenBallot(page, "Lifecycle question");
  await page.getByLabel(/^Find a /).fill(household.identifier);
  await page
    .getByRole("checkbox", {
      name: new RegExp(`^${household.identifier}\\b`, "u"),
    })
    .check();
  await setDateTime(page, "Voting closes", closesLocal);
  await saveDraft(page, 2);
  return editor;
}
