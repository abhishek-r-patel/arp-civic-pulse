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
 * The seed covers every account and vote state; visitors may change anything
 * until the next reset. Prints counts only; no credentials, codes or personal data.
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

// Milliseconds between activating the deadline-completed tie vote and its deadline.
// The rest of the seed runs meanwhile; the reset then waits out any remainder.
export const DEMO_DEADLINE_LEAD_MS = 90_000;

const office = (name: string, candidates: string[]) => ({ name, candidates });

/**
 * Fictional content covering every state the app can show (docs/OPERATIONS.md,
 * "Demo site"). Names and identifiers are invented. Residents 0-14 are enabled
 * with eligible flats and form the electorate; the last three demonstrate an
 * ineligible flat, a suspended resident and a deleted account.
 */
export function demoSeedPlan(now: Date) {
  const at = (days: number) =>
    new Date(now.getTime() + days * DAY).toISOString();
  const households = ["A", "B", "C"].flatMap((block) =>
    ["101", "102", "201", "202", "301", "302"].map(
      (flat) => `${block}-${flat}`,
    ),
  );
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
    "Ravi Demo",
    "Anita Demo",
    "Tenzin Demo",
    "Grace Demo",
    "Vikram Demo",
    "Zoya Demo",
  ];
  // Listed flats nobody holds yet: two pending self-registrations claim the
  // first two; the rest stay unclaimed (a household always needs a representative).
  const pendingRegistrations = [
    { name: "Rohan Demo", identifier: "D-101" },
    { name: "Sara Demo", identifier: "D-102" },
  ];
  const unclaimedHouseholds = ["D-201", "D-202"];
  return {
    profile: {
      fullName: "Green Meadows Residents' Association",
      alias: "Green Meadows (demo)",
      address: "1 Example Road, Sample Nagar (fictional)",
      email: "committee@example.com",
      phone: "+91 00000 00000",
      website: "https://example.com",
      accentPalette: "FOREST",
      welcomeMessage:
        "Welcome to the Civic Pulse demo. Everything here is fictional, shared with other visitors and reset regularly.",
      householdLabel: "Flat",
      identifierKind: "ID",
      defaultHouseholds: [
        ...households,
        ...pendingRegistrations.map((entry) => entry.identifier),
        ...unclaimedHouseholds,
      ],
      rwaPositions: ["President", "Secretary", "Treasurer"],
    },
    households,
    residents,
    electorateSize: 15,
    blockASize: 6,
    ineligibleIndex: 15,
    suspendedIndex: 16,
    deletedIndex: 17,
    pendingRegistrations,
    unclaimedHouseholds,
    votes: {
      openPoll: {
        title: "Should we add solar lights along the park walkway?",
        closesAt: at(28),
        options: ["Yes", "No", "Need more information"],
      },
      multiLimited: {
        title: "Pick up to two new amenities for the clubhouse",
        instructions:
          "Choose one or two. You can change your choice until the deadline.",
        closesAt: at(21),
        options: [
          "Library corner",
          "Table tennis",
          "Yoga room",
          "Kids' play area",
        ],
      },
      multiUnlimited: {
        title: "Which weekend activities would you join?",
        closesAt: at(25),
        options: [
          "Morning walk",
          "Cleanliness drive",
          "Gardening",
          "Movie night",
          "Book swap",
        ],
      },
      partial: {
        title: "Block A: replace the lift in the lobby?",
        instructions:
          "Only Block A flats are asked because only they share this lift.",
        closesAt: at(14),
        options: ["Replace this year", "Repair and review next year"],
      },
      election: {
        title: "Committee election 2026",
        instructions:
          "Choose one candidate for each position, or none of the above. Your choice is secret.",
        closesAt: at(28),
        offices: [
          office("Secretary", ["Meera Demo", "Kabir Demo"]),
          office("Treasurer", ["Farah Demo", "Joseph Demo"]),
        ],
      },
      closingSoon: {
        title: "Sports secretary by-election",
        instructions: "Choose one candidate. Your choice is secret.",
        closesAt: at(2),
        offices: [
          office("Sports secretary", [
            "Arjun Demo",
            "Neha Demo",
            "Sameer Demo",
          ]),
        ],
      },
      extended: {
        title: "Approve the new garbage collection timings?",
        closesAt: at(10),
        extendedTo: at(17),
        reason: "Extended so more flats can respond after the holiday (demo).",
        options: ["Approve", "Keep the current timings"],
      },
      completed: {
        title: "Weekend gym opening hours",
        closesAt: at(28),
        options: ["6am to 10pm", "7am to 9pm"],
      },
      completedTie: {
        title: "Colour for the main gate",
        options: ["Dark green", "Charcoal grey"],
      },
      completedNoVotes: {
        title: "Start a monthly newsletter?",
        closesAt: at(28),
        options: ["Yes", "No"],
      },
      completedElection: {
        title: "Committee election 2025",
        instructions:
          "Choose one candidate for each position, or none of the above. Your choice is secret.",
        closesAt: at(28),
        offices: [
          office("President", ["Ravi Demo", "Anita Demo"]),
          office("Secretary", ["Priya Demo", "Imran Demo"]),
          office("Treasurer", ["Divya Demo", "Tenzin Demo"]),
        ],
      },
      scheduled: {
        title: "Annual maintenance budget",
        opensAt: at(7),
        closesAt: at(21),
        options: ["Approve", "Reject"],
      },
      readyDraft: {
        title: "Install EV charging points in the basement?",
        closesAt: at(30),
        options: ["Yes", "No", "Only after a cost study"],
      },
      draft: { title: "Festival celebration plan" },
      withdrawn: {
        title: "Paint the boundary wall",
        opensAt: at(5),
        closesAt: at(19),
        reason: "Waiting for a second quotation (demo).",
        options: ["Approve", "Reject"],
      },
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
  eligible = true,
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
       values ($1, app_private.normalize_key($1), $2, $3) returning id`,
      [household, id, eligible],
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
        index !== plan.ineligibleIndex,
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
    await createProfile(
      db,
      admin,
      DEMO_PERSONAS.admin.email,
      DEMO_PERSONAS.admin.name,
      { isAdmin: true },
      adminId,
    );

    stage = "seeding account states";
    const updateProfile = (id: string, changes: object) =>
      asProfile(db, adminId, "public.update_profile($1, $2::jsonb)", [
        id,
        JSON.stringify(changes),
      ]);
    await updateProfile(pick(residentIds, plan.suspendedIndex), {
      status: "SUSPENDED",
    });
    await updateProfile(pick(residentIds, plan.deletedIndex), {
      status: "DELETED",
    });
    for (const [index, entry] of plan.pendingRegistrations.entries()) {
      const { data, error } = await admin.auth.admin.createUser({
        email: `demo-registration-${String(index + 1).padStart(2, "0")}@example.com`,
        email_confirm: true,
      });
      if (error || !data.user)
        throw new Error("Could not create a demo Auth user.");
      await asServiceRole(
        db,
        "select public.self_register_resident($1, $2, $3)",
        [data.user.id, entry.name, entry.identifier],
      );
    }

    const { votes } = plan;
    const electorate = householdIds.slice(0, plan.electorateSize);
    const voters = residentIds.slice(0, plan.electorateSize);
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
    const poll = (
      title: string,
      closesAt: string,
      labels: string[],
      extra: Record<string, unknown> = {},
    ) =>
      buildVote(db, adminId, "PUBLIC", {
        title,
        closesAt,
        options: positioned(labels),
        eligibleHouseholdIds: electorate,
        ...extra,
      });
    const election = (
      title: string,
      closesAt: string,
      offices: { name: string; candidates: string[] }[],
      extra: Record<string, unknown> = {},
    ) =>
      buildVote(db, adminId, "PRIVATE", {
        title,
        closesAt,
        offices: offices.map((entry, index) => ({
          name: entry.name,
          position: index + 1,
          candidates: entry.candidates.map((name, at) => ({
            name,
            position: at + 1,
          })),
        })),
        eligibleHouseholdIds: electorate,
        ...extra,
      });
    const completeEarly = (id: string, reason: string) =>
      asProfile(db, adminId, "public.complete_vote_early($1, true, $2)", [
        id,
        reason,
      ]);

    // Started first so its short deadline passes while the rest is seeded.
    stage = "seeding the deadline-completed tie";
    const tieDeadline = new Date(Date.now() + DEMO_DEADLINE_LEAD_MS);
    const tie = await activate(
      await poll(
        votes.completedTie.title,
        tieDeadline.toISOString(),
        votes.completedTie.options,
      ),
    );
    for (const [n, voter] of voters.slice(1, 5).entries()) {
      await cast(voter, tie.id, { optionId: pick(tie.options, n % 2).id });
    }

    stage = "seeding open polls";
    // Single choice: some neighbours have voted; the resident persona has not.
    const single = await activate(
      await poll(
        votes.openPoll.title,
        votes.openPoll.closesAt,
        votes.openPoll.options,
      ),
    );
    for (const [n, voter] of voters.slice(1, 8).entries()) {
      await cast(voter, single.id, {
        optionId: pick(single.options, n % 3).id,
      });
    }

    // Up to two choices: the persona voted, then changed the response.
    const limited = await activate(
      await poll(
        votes.multiLimited.title,
        votes.multiLimited.closesAt,
        votes.multiLimited.options,
        {
          instructions: votes.multiLimited.instructions,
          openSelectionMode: "MULTIPLE",
          openSelectionLimit: 2,
        },
      ),
    );
    for (const [n, voter] of voters.slice(0, 10).entries()) {
      await cast(voter, limited.id, {
        optionIds: [
          pick(limited.options, n % 4).id,
          pick(limited.options, (n + 1) % 4).id,
        ],
      });
    }
    await cast(pick(voters, 0), limited.id, {
      optionIds: [pick(limited.options, 2).id],
    });

    // Any number of choices; the persona has not voted.
    const unlimited = await activate(
      await poll(
        votes.multiUnlimited.title,
        votes.multiUnlimited.closesAt,
        votes.multiUnlimited.options,
        { openSelectionMode: "MULTIPLE", openSelectionLimit: null },
      ),
    );
    for (const [n, voter] of voters.slice(2, 9).entries()) {
      await cast(voter, unlimited.id, {
        optionIds: (unlimited.options ?? [])
          .slice(n % 3, (n % 3) + 1 + (n % 4))
          .map((option) => option.id),
      });
    }

    // Partial electorate: only Block A flats are eligible.
    const partial = await activate(
      await poll(
        votes.partial.title,
        votes.partial.closesAt,
        votes.partial.options,
        {
          instructions: votes.partial.instructions,
          eligibleHouseholdIds: householdIds.slice(0, plan.blockASize),
        },
      ),
    );
    for (const [n, voter] of voters.slice(1, 4).entries()) {
      await cast(voter, partial.id, {
        optionId: pick(partial.options, n === 2 ? 1 : 0).id,
      });
    }

    // Deadline changed after opening, with a recorded reason.
    const extended = await activate(
      await poll(
        votes.extended.title,
        votes.extended.closesAt,
        votes.extended.options,
      ),
    );
    for (const [n, voter] of voters.slice(1, 6).entries()) {
      await cast(voter, extended.id, {
        optionId: pick(extended.options, n % 2).id,
      });
    }
    await asProfile(
      db,
      adminId,
      "public.change_vote_deadline($1, $2, true, $3)",
      [extended.id, votes.extended.extendedTo, votes.extended.reason],
    );

    stage = "seeding secret elections";
    // The persona already voted, choosing none of the above for one office.
    const secret = await activate(
      await election(
        votes.election.title,
        votes.election.closesAt,
        votes.election.offices,
        { instructions: votes.election.instructions },
      ),
    );
    for (const [n, voter] of voters.slice(0, 6).entries()) {
      await cast(voter, secret.id, {
        selections: (secret.offices ?? []).map((entry, index) => ({
          officeId: entry.id,
          candidateId:
            n === 0 && index === 1 ? null : pick(entry.candidates, n % 2).id,
        })),
      });
    }

    // Closes in two days; the persona has not voted.
    const soon = await activate(
      await election(
        votes.closingSoon.title,
        votes.closingSoon.closesAt,
        votes.closingSoon.offices,
        { instructions: votes.closingSoon.instructions },
      ),
    );
    for (const [n, voter] of voters.slice(1, 5).entries()) {
      await cast(voter, soon.id, {
        selections: (soon.offices ?? []).map((entry) => ({
          officeId: entry.id,
          candidateId: pick(entry.candidates, n % 3).id,
        })),
      });
    }

    stage = "seeding completed votes";
    // Closed early with a clear leader.
    const completed = await activate(
      await poll(
        votes.completed.title,
        votes.completed.closesAt,
        votes.completed.options,
      ),
    );
    for (const [n, voter] of voters.slice(0, 10).entries()) {
      await cast(voter, completed.id, {
        optionId: pick(completed.options, n % 3 === 0 ? 1 : 0).id,
      });
    }
    await completeEarly(completed.id, "Enough households voted (demo).");

    // Closed with no responses.
    const noVotes = await activate(
      await poll(
        votes.completedNoVotes.title,
        votes.completedNoVotes.closesAt,
        votes.completedNoVotes.options,
      ),
    );
    await completeEarly(
      noVotes.id,
      "Dropped after the general meeting (demo).",
    );

    // Offices with a leader, a tie and no winner (everyone chose none of the above).
    const past = await activate(
      await election(
        votes.completedElection.title,
        votes.completedElection.closesAt,
        votes.completedElection.offices,
        { instructions: votes.completedElection.instructions },
      ),
    );
    const [president, secretary, treasurer] = past.offices ?? [];
    if (!president || !secretary || !treasurer)
      throw new Error("A seed step returned an unexpected shape.");
    for (const [n, voter] of voters.slice(0, 8).entries()) {
      await cast(voter, past.id, {
        selections: [
          {
            officeId: president.id,
            candidateId: pick(president.candidates, n < 5 ? 0 : 1).id,
          },
          {
            officeId: secretary.id,
            candidateId: pick(secretary.candidates, n % 2).id,
          },
          { officeId: treasurer.id, candidateId: null },
        ],
      });
    }
    await completeEarly(
      past.id,
      "Every flat that planned to vote has voted (demo).",
    );

    stage = "seeding scheduled, draft and cancelled votes";
    const scheduledId = await poll(
      votes.scheduled.title,
      votes.scheduled.closesAt,
      votes.scheduled.options,
      { opensAt: votes.scheduled.opensAt },
    );
    await asProfile(db, adminId, "public.schedule_vote($1, 2, true, $2)", [
      scheduledId,
      votes.scheduled.opensAt,
    ]);

    // Scheduled, then withdrawn back to a draft with a reason.
    const withdrawnId = await poll(
      votes.withdrawn.title,
      votes.withdrawn.closesAt,
      votes.withdrawn.options,
      { opensAt: votes.withdrawn.opensAt },
    );
    await asProfile(db, adminId, "public.schedule_vote($1, 2, true, $2)", [
      withdrawnId,
      votes.withdrawn.opensAt,
    ]);
    await asProfile(
      db,
      adminId,
      "public.withdraw_vote_schedule($1, true, $2)",
      [withdrawnId, votes.withdrawn.reason],
    );

    // A complete draft ready to start, and an unfinished one.
    await poll(
      votes.readyDraft.title,
      votes.readyDraft.closesAt,
      votes.readyDraft.options,
    );
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
      await poll(
        votes.cancelled.title,
        votes.cancelled.closesAt,
        votes.cancelled.options,
      ),
    );
    await cast(pick(voters, 1), cancelled.id, {
      optionId: pick(cancelled.options, 0).id,
    });
    await asProfile(db, adminId, "public.cancel_vote($1, true, $2)", [
      cancelled.id,
      "Withdrawn for more discussion (demo).",
    ]);

    stage = "completing the deadline vote";
    const remaining = tieDeadline.getTime() - Date.now() + 2_000;
    if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
    // The scheduled job may already have completed it; this is then a no-op.
    await db.query("begin");
    try {
      await db.query("set local role cp_scheduler");
      await db.query("select public.complete_due_votes()");
      await db.query("commit");
    } catch (error) {
      await db.query("rollback");
      throw error;
    }

    const counts = await db.query<Record<string, string>>(
      `select (select count(*) from public.profiles) profiles,
              (select count(*) from public.households) households,
              (select count(*) from public.votes) votes,
              (select count(*) from public.votes where status = 'ACTIVE') "votesActive",
              (select count(*) from public.votes where status = 'COMPLETED') "votesCompleted",
              (select count(*) from public.votes where status = 'SCHEDULED') "votesScheduled",
              (select count(*) from public.votes where status = 'DRAFT') "votesDraft",
              (select count(*) from public.votes where status = 'CANCELLED') "votesCancelled",
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
