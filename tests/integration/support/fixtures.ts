import type { Client } from "pg";
import { newAuthUser, type TestDatabase } from "./database";

/*
 * Synthetic fixtures only. Rows are written as the restricted owner role, so
 * every guard trigger still runs; flags stand in for the guarded activation and
 * submission routines that later phases add.
 */
export interface Person {
  id: string;
  householdId: string | null;
}

export interface World {
  admin: Person;
  alice: Person;
  bob: Person;
  carol: Person;
  dave: Person;
}

async function createProfile(
  client: Client,
  id: string,
  name: string,
  options: {
    status: "ENABLED" | "SUSPENDED";
    isAdmin?: boolean;
    household?: string;
    eligible?: boolean;
  },
): Promise<Person> {
  await client.query(
    "insert into public.profiles (id, representative_name, status, is_admin) values ($1, $2, $3, $4)",
    [id, name, options.status, options.isAdmin ?? false],
  );
  if (!options.household) {
    return { id, householdId: null };
  }
  const household = await client.query<{ id: string }>(
    `insert into public.households (identifier, identifier_normalized, representative_profile_id, is_eligible)
     values ($1, app_private.normalize_key($1), $2, $3) returning id`,
    [options.household, id, options.eligible ?? true],
  );
  return { id, householdId: household.rows[0]?.id ?? null };
}

/** admin (no household), alice/bob/dave enabled residents, carol suspended. */
export async function seedWorld(db: TestDatabase): Promise<World> {
  // Auth identities belong to Supabase Auth; the application owner role cannot create them.
  const ids = await db.asSuperuser(async (client) => {
    const created: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      created.push(await newAuthUser(client));
    }
    return created as [string, string, string, string, string];
  });

  return db.asOwner(async (client) => ({
    admin: await createProfile(client, ids[0], "Asha Admin", {
      status: "ENABLED",
      isAdmin: true,
    }),
    alice: await createProfile(client, ids[1], "Alice Rao", {
      status: "ENABLED",
      household: "A-101",
    }),
    bob: await createProfile(client, ids[2], "Bob Iyer", {
      status: "ENABLED",
      household: "B-202",
    }),
    carol: await createProfile(client, ids[3], "Carol Das", {
      status: "SUSPENDED",
      household: "C-303",
    }),
    dave: await createProfile(client, ids[4], "Dave Nair", {
      status: "ENABLED",
      household: "D-404",
    }),
  }));
}

export interface VoteFixture {
  id: string;
  optionIds: string[];
  offices: { id: string; candidateIds: string[]; notaTallyId?: string }[];
}

export async function insertDraft(
  client: Client,
  adminId: string,
  type: "PUBLIC" | "PRIVATE",
  title = "Fixture vote",
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `insert into public.votes (voting_type, title, instructions, created_by_profile_id)
     values ($1, $2, 'Choose carefully.', $3) returning id`,
    [type, title, adminId],
  );
  const id = result.rows[0]?.id;
  if (!id) {
    throw new Error("Draft was not created.");
  }
  return id;
}

export async function addOptions(
  client: Client,
  voteId: string,
  labels: string[],
): Promise<string[]> {
  const ids: string[] = [];
  for (const [index, label] of labels.entries()) {
    const row = await client.query<{ id: string }>(
      "insert into public.poll_options (vote_id, label, position) values ($1, $2, $3) returning id",
      [voteId, label, index + 1],
    );
    ids.push(row.rows[0]?.id ?? "");
  }
  return ids;
}

export async function addOffice(
  client: Client,
  voteId: string,
  name: string,
  position: number,
  candidates: string[],
): Promise<{ id: string; candidateIds: string[] }> {
  const office = await client.query<{ id: string }>(
    "insert into public.offices (vote_id, name, position) values ($1, $2, $3) returning id",
    [voteId, name, position],
  );
  const officeId = office.rows[0]?.id ?? "";
  const candidateIds: string[] = [];
  for (const [index, candidate] of candidates.entries()) {
    const row = await client.query<{ id: string }>(
      "insert into public.candidates (office_id, name, position) values ($1, $2, $3) returning id",
      [officeId, candidate, index + 1],
    );
    candidateIds.push(row.rows[0]?.id ?? "");
  }
  return { id: officeId, candidateIds };
}

/** Selects households and takes the frozen representative snapshot (activation step 6). */
export async function snapshotElectorate(
  client: Client,
  voteId: string,
  people: Person[],
): Promise<void> {
  for (const person of people) {
    if (!person.householdId) {
      throw new Error("Only residents with a household can be entitled.");
    }
    await client.query(
      "insert into public.electorate (vote_id, household_id) values ($1, $2)",
      [voteId, person.householdId],
    );
    await client.query(
      `update public.electorate e
       set representative_profile_id = p.id,
           representative_name_snapshot = p.representative_name,
           household_identifier_snapshot = h.identifier
       from public.households h
       join public.profiles p on p.id = h.representative_profile_id
       where e.vote_id = $1 and e.household_id = $2 and h.id = e.household_id`,
      [voteId, person.householdId],
    );
  }
}

/** Stands in for the guarded activation routine: initialises counters, then flips status. */
export async function activate(
  client: Client,
  voteId: string,
  options: { closesInSeconds?: number } = {},
): Promise<void> {
  await client.query("select set_config('cp.activation', 'on', true)");
  await client.query(
    `insert into public.closed_tallies (vote_id, office_id, candidate_id)
     select o.vote_id, o.id, c.id from public.offices o
       join public.candidates c on c.office_id = o.id where o.vote_id = $1
     union all
     select o.vote_id, o.id, null from public.offices o where o.vote_id = $1`,
    [voteId],
  );
  await client.query(
    `update public.votes
     set closes_at = clock_timestamp() + make_interval(secs => $2),
         status = 'ACTIVE', activated_at = clock_timestamp() - interval '1 second',
         rwa_name_snapshot = 'Test RWA', timezone_snapshot = 'Asia/Kolkata',
         policy_versions_snapshot = '{"A1":"v1","A2":"v1","A3":"v1","A4":"v1","A5":"v1","A6":"v1","A7":"v1"}'
     where id = $1`,
    [voteId, options.closesInSeconds ?? 3600],
  );
  await client.query("select set_config('cp.activation', 'off', true)");
}

export async function fixtureOpenVote(
  db: TestDatabase,
  world: World,
  electors: Person[] = [world.alice, world.bob, world.dave],
  options: { closesInSeconds?: number } = {},
): Promise<VoteFixture> {
  return db.asOwner(async (client) => {
    const id = await insertDraft(client, world.admin.id, "PUBLIC");
    const optionIds = await addOptions(client, id, ["Approve", "Reject"]);
    await snapshotElectorate(client, id, electors);
    await activate(client, id, options);
    return { id, optionIds, offices: [] };
  });
}

export async function fixtureClosedVote(
  db: TestDatabase,
  world: World,
  electors: Person[] = [world.alice, world.bob, world.dave],
): Promise<VoteFixture> {
  return db.asOwner(async (client) => {
    const id = await insertDraft(client, world.admin.id, "PRIVATE");
    const president = await addOffice(client, id, "President", 1, [
      "Priya",
      "Quentin",
    ]);
    const treasurer = await addOffice(client, id, "Treasurer", 2, ["Rahul"]);
    await snapshotElectorate(client, id, electors);
    await activate(client, id);
    return { id, optionIds: [], offices: [president, treasurer] };
  });
}
