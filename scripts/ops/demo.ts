import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { DEMO_PERSONAS } from "../../src/shared/demo.ts";
import { operationalDatabaseClient } from "./database.ts";
import {
  asServiceRole,
  projectTarget,
  type Db,
  type ProjectTarget,
} from "./supabase-project.ts";

/*
 * `npm run ops -- demo-reset` (docs/OPERATIONS.md, "Demo site"). Wipes the
 * DEDICATED demo Supabase project and reseeds the fictional association the
 * public demo host shows. It never runs against a project that is not
 * explicitly confirmed and already marked as the demo (or `--initialize`d).
 * Prints counts only; no credentials, codes or personal data.
 */

// Recorded as the (fictional) policy approving authority, which only deployment
// scripts can write, so later resets can prove they target the demo project.
export const DEMO_MARKER = "DEMO ONLY: Civic Pulse demo (fictional data)";
export const DEMO_SEED_ADMIN_EMAIL = "demo-seed-admin@example.com";

// Every app table; truncated together in replica mode (bypasses the append-only guards).
export const DEMO_TABLES = [
  "audit_events",
  "candidates",
  "closed_tallies",
  "electorate",
  "households",
  "offices",
  "open_responses",
  "participation",
  "poll_options",
  "profiles",
  "rate_limit_buckets",
  "rwa_settings",
  "votes",
] as const;

export type DemoTarget = ProjectTarget;

/** Validates that every credential points at the one confirmed demo project. */
export function demoResetTarget(
  env: Readonly<Record<string, string | undefined>>,
  confirm: string | undefined,
): DemoTarget {
  const target = projectTarget(
    env,
    "DEMO_",
    confirm,
    "to erase and reseed the demo project",
  );
  const apiHost = new URL(target.supabaseUrl).hostname;
  // Guards against pasting the primary deployment's credentials by mistake.
  if (
    env.NEXT_PUBLIC_SUPABASE_URL &&
    URL.canParse(env.NEXT_PUBLIC_SUPABASE_URL) &&
    new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname === apiHost
  ) {
    throw new Error(
      "The demo project must not be the NEXT_PUBLIC_SUPABASE_URL project.",
    );
  }
  return target;
}

const DAY = 86_400_000;

/** Fictional content; names and identifiers are invented. */
export function demoSeedPlan(now: Date) {
  const at = (days: number) =>
    new Date(now.getTime() + days * DAY).toISOString();
  const households = [
    "A-101",
    "A-102",
    "A-201",
    "A-202",
    "B-101",
    "B-102",
    "B-201",
    "B-202",
    "C-101",
    "C-102",
    "C-201",
    "C-202",
  ];
  const residents = [
    DEMO_PERSONAS.resident.name,
    "Meera Demo",
    "Kabir Demo",
    "Farah Demo",
    "Joseph Demo",
    "Lakshmi Demo",
    "Arjun Demo",
    "Neha Demo",
    "Sameer Demo",
    "Priya Demo",
    "Imran Demo",
    "Divya Demo",
  ];
  return {
    profile: {
      fullName: "Green Meadows Residents' Association",
      alias: "Green Meadows (demo)",
      address: "1 Example Road, Sample Nagar (fictional)",
      email: "",
      phone: "",
      website: "",
      accentPalette: "FOREST",
      welcomeMessage:
        "Welcome to the Civic Pulse demo. Everything here is fictional and changes are turned off.",
      householdLabel: "Flat",
      identifierKind: "ID",
      defaultHouseholds: households,
      rwaPositions: ["President", "Secretary", "Treasurer"],
    },
    households,
    residents,
    votes: {
      openPoll: {
        title: "Should we add solar lights along the park walkway?",
        closesAt: at(28),
        options: ["Yes", "No", "Need more information"],
      },
      election: {
        title: "Committee election 2026",
        instructions:
          "Choose one candidate for each position. Your choice is secret.",
        closesAt: at(28),
        offices: [
          { name: "Secretary", candidates: ["Meera Demo", "Kabir Demo"] },
          { name: "Treasurer", candidates: ["Farah Demo", "Joseph Demo"] },
        ],
      },
      completed: {
        title: "Weekend gym opening hours",
        closesAt: at(28),
        options: ["6am to 10pm", "7am to 9pm"],
      },
      scheduled: {
        title: "Annual maintenance budget",
        opensAt: at(7),
        closesAt: at(21),
        options: ["Approve", "Reject"],
      },
      draft: { title: "Festival celebration plan" },
      cancelled: {
        title: "Change the visitor parking rules",
        closesAt: at(28),
        options: ["Yes", "No"],
      },
    },
  };
}

async function asProfile<T>(
  db: Db,
  profileId: string,
  sql: string,
  params: unknown[] = [],
): Promise<T> {
  await db.query("begin");
  try {
    await db.query("set local role authenticated");
    await db.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: profileId, role: "authenticated" }),
    ]);
    const result = await db.query<{ r: T }>(`select ${sql} as r`, params);
    await db.query("commit");
    return result.rows[0]?.r as T;
  } catch (error) {
    await db.query("rollback");
    throw error;
  }
}

async function deleteAllAuthUsers(admin: SupabaseClient): Promise<number> {
  let removed = 0;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 200,
    });
    if (error) throw new Error("Could not list demo Auth users.");
    if (data.users.length === 0) return removed;
    for (const user of data.users) {
      const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
      if (deleteError) throw new Error("Could not delete a demo Auth user.");
      removed += 1;
    }
  }
}

/** Residents need a household before they can be enabled; returns both ids. */
async function createProfile(
  db: Db,
  admin: SupabaseClient,
  email: string,
  name: string,
  role: { isAdmin?: boolean; isReadonly?: boolean },
  actorId: string | null,
  household?: string,
): Promise<{ id: string; householdId?: string }> {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (error || !data.user)
    throw new Error("Could not create a demo Auth user.");
  const id = data.user.id;
  await asServiceRole(
    db,
    "select public.provision_profile($1, $2, $3, $4, $5)",
    [id, name, role.isAdmin ?? false, actorId, role.isReadonly ?? false],
  );
  let householdId: string | undefined;
  if (household) {
    const row = await db.query<{ id: string }>(
      `insert into public.households
         (identifier, identifier_normalized, representative_profile_id, is_eligible)
       values ($1, app_private.normalize_key($1), $2, true) returning id`,
      [household, id],
    );
    householdId = pick(row.rows, 0).id;
  }
  await asServiceRole(db, "select public.enable_profile($1, $2)", [
    id,
    actorId,
  ]);
  return { id, householdId };
}

interface ActivatedVote {
  id: string;
  options?: { id: string; label: string }[];
  offices?: { id: string; candidates: { id: string }[] }[];
}

async function buildVote(
  db: Db,
  adminId: string,
  type: "PUBLIC" | "PRIVATE",
  changes: Record<string, unknown>,
): Promise<string> {
  const draft = await asProfile<{ id: string }>(
    db,
    adminId,
    "public.create_draft($1)",
    [type],
  );
  await asProfile(db, adminId, "public.update_draft($1, 1, $2::jsonb)", [
    draft.id,
    JSON.stringify(changes),
  ]);
  return draft.id;
}

const positioned = (labels: string[]) =>
  labels.map((label, index) => ({ label, position: index + 1 }));

function pick<T>(items: readonly T[] | undefined, index: number): T {
  const item = items?.[index];
  if (item === undefined) {
    throw new Error("A seed step returned an unexpected shape.");
  }
  return item;
}

/** Erases the confirmed demo project and seeds the fictional association. */
export async function resetDemo(
  target: DemoTarget,
  options: { initialize: boolean; now?: Date },
): Promise<Record<string, number>> {
  const plan = demoSeedPlan(options.now ?? new Date());
  const admin = createClient(target.supabaseUrl, target.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const db = operationalDatabaseClient(target.databaseUrl);
  await db.connect();
  let stage = "checking the demo marker";
  try {
    const marker = await db.query<{ authority: string | null }>(
      "select policy_approvals -> 'A1' ->> 'approving_authority' as authority from public.rwa_settings",
    );
    if (marker.rows[0]?.authority !== DEMO_MARKER && !options.initialize) {
      throw new Error(
        "This project is not marked as the demo. Pass --initialize only for a new, dedicated demo project.",
      );
    }

    stage = "erasing app data";
    await db.query("begin");
    await db.query("set local session_replication_role = replica");
    await db.query(
      `truncate ${DEMO_TABLES.map((t) => `public.${t}`).join(", ")}`,
    );
    await db.query("commit");
    stage = "deleting Auth users";
    const authUsersRemoved = await deleteAllAuthUsers(admin);

    stage = "initializing settings and the seed admin";
    await db.query(
      "select app_private.deployment_initialize_settings($1, 'Asia/Kolkata')",
      [demoSeedPlan(new Date()).profile.fullName],
    );
    const { id: adminId } = await createProfile(
      db,
      admin,
      DEMO_SEED_ADMIN_EMAIL,
      "Demo Administrator",
      { isAdmin: true },
      null,
    );
    for (const key of ["A1", "A2", "A3", "A4", "A5", "A6", "A7"]) {
      await db.query(
        "select app_private.deployment_record_policy_approval($1, 'demo-v1', now(), $2, $3, 'APPROVED')",
        [key, adminId, DEMO_MARKER],
      );
    }
    await db.query(
      `update public.rwa_settings
          set vote_retention_days = 365, audit_retention_days = 365,
              inactive_profile_retention_days = 365,
              rate_limit_retention_days = 30, backup_retention_days = 90
        where id = 1`,
    );
    await asProfile(db, adminId, "public.update_rwa_profile($1::jsonb)", [
      JSON.stringify(plan.profile),
    ]);

    stage = "creating residents and households";
    const residentIds: string[] = [];
    const householdIds: string[] = [];
    for (const [index, name] of plan.residents.entries()) {
      const email =
        index === 0
          ? DEMO_PERSONAS.resident.email
          : `demo-resident-${String(index + 1).padStart(2, "0")}@example.com`;
      const created = await createProfile(
        db,
        admin,
        email,
        name,
        {},
        adminId,
        plan.households[index],
      );
      residentIds.push(created.id);
      if (!created.householdId) throw new Error("Household was not created.");
      householdIds.push(created.householdId);
    }
    await createProfile(
      db,
      admin,
      DEMO_PERSONAS.committee.email,
      DEMO_PERSONAS.committee.name,
      { isReadonly: true },
      adminId,
    );

    const { votes } = plan;
    const activate = (id: string) =>
      asProfile<ActivatedVote>(
        db,
        adminId,
        "public.activate_vote($1, 2, true)",
        [id],
      );
    const cast = (voterId: string, voteId: string, submission: object) =>
      asProfile(db, voterId, "public.cast_vote($1, $2::jsonb)", [
        voteId,
        JSON.stringify({ confirmed: true, ...submission }),
      ]);

    stage = "seeding the open poll";
    // Open poll: some neighbours have voted; the resident persona has not.
    const poll = await activate(
      await buildVote(db, adminId, "PUBLIC", {
        title: votes.openPoll.title,
        closesAt: votes.openPoll.closesAt,
        options: positioned(votes.openPoll.options),
        eligibleHouseholdIds: householdIds,
      }),
    );
    for (const [n, voter] of residentIds.slice(1, 8).entries()) {
      await cast(voter, poll.id, { optionId: pick(poll.options, n % 3).id });
    }

    stage = "seeding the secret election";
    // Secret election: the resident persona has already voted.
    const election = await activate(
      await buildVote(db, adminId, "PRIVATE", {
        title: votes.election.title,
        instructions: votes.election.instructions,
        closesAt: votes.election.closesAt,
        offices: votes.election.offices.map((office, index) => ({
          name: office.name,
          position: index + 1,
          candidates: office.candidates.map((name, at) => ({
            name,
            position: at + 1,
          })),
        })),
        eligibleHouseholdIds: householdIds,
      }),
    );
    for (const [n, voter] of residentIds.slice(0, 6).entries()) {
      await cast(voter, election.id, {
        selections: (election.offices ?? []).map((office) => ({
          officeId: office.id,
          candidateId: pick(office.candidates, n % 2).id,
        })),
      });
    }

    stage = "seeding the completed poll";
    // Completed poll with published results.
    const completed = await activate(
      await buildVote(db, adminId, "PUBLIC", {
        title: votes.completed.title,
        closesAt: votes.completed.closesAt,
        options: positioned(votes.completed.options),
        eligibleHouseholdIds: householdIds,
      }),
    );
    for (const [n, voter] of residentIds.slice(0, 10).entries()) {
      await cast(voter, completed.id, {
        optionId: pick(completed.options, n % 3 === 0 ? 1 : 0).id,
      });
    }
    await asProfile(db, adminId, "public.complete_vote_early($1, true, $2)", [
      completed.id,
      "Enough households voted (demo).",
    ]);

    stage = "seeding the scheduled vote";
    const scheduledId = await buildVote(db, adminId, "PUBLIC", {
      title: votes.scheduled.title,
      opensAt: votes.scheduled.opensAt,
      closesAt: votes.scheduled.closesAt,
      options: positioned(votes.scheduled.options),
      eligibleHouseholdIds: householdIds,
    });
    await asProfile(db, adminId, "public.schedule_vote($1, 2, true, $2)", [
      scheduledId,
      votes.scheduled.opensAt,
    ]);

    stage = "seeding the draft and cancelled votes";
    const draftId = (
      await asProfile<{ id: string }>(db, adminId, "public.create_draft($1)", [
        "PUBLIC",
      ])
    ).id;
    await asProfile(db, adminId, "public.update_draft($1, 1, $2::jsonb)", [
      draftId,
      JSON.stringify({ title: votes.draft.title }),
    ]);

    const cancelled = await activate(
      await buildVote(db, adminId, "PUBLIC", {
        title: votes.cancelled.title,
        closesAt: votes.cancelled.closesAt,
        options: positioned(votes.cancelled.options),
        eligibleHouseholdIds: householdIds,
      }),
    );
    await asProfile(db, adminId, "public.cancel_vote($1, true, $2)", [
      cancelled.id,
      "Withdrawn for more discussion (demo).",
    ]);

    const counts = await db.query<Record<string, string>>(
      `select (select count(*) from public.profiles) profiles,
              (select count(*) from public.households) households,
              (select count(*) from public.votes) votes,
              (select count(*) from public.participation) ballots`,
    );
    return {
      authUsersRemoved,
      ...Object.fromEntries(
        Object.entries(pick(counts.rows, 0)).map(([k, v]) => [k, Number(v)]),
      ),
    };
  } catch (error) {
    // Database errors here are fixed tokens (for example FORBIDDEN), never personal data.
    throw new Error(
      `demo-reset failed while ${stage}: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  } finally {
    await db.end();
  }
}
