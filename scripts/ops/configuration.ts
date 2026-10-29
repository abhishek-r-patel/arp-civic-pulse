// Read-only operator inspection; never exposes residents, ballot choices or credentials.
import { Client } from "pg";
import { z } from "zod";
import { parseEnvironment } from "../../src/server/config/environment.ts";
import { operationalDatabaseConfig } from "./database.ts";

const count = z.number().int().nonnegative().safe();
const counts = z.record(z.string(), count);
const snapshotSchema = z.strictObject({
  checkedAt: z.iso.datetime({ offset: true }),
  settings: z
    .strictObject({
      fullName: z.string(),
      alias: z.string(),
      timezone: z.string(),
      timezoneValid: z.boolean(),
      householdLabel: z.string(),
      identifierKind: z.enum(["NUMBER", "ID"]),
      accentPalette: z.enum(["TEAL", "BLUE", "FOREST", "PLUM", "SLATE"]),
      optionalFieldsProvided: z.record(z.string(), z.boolean()),
      placeholderFields: z.array(z.string()),
      defaultHouseholds: count,
      rwaPositions: count,
      listsValid: z.boolean(),
      missingApprovals: z.array(z.string()),
      missingRetention: z.array(z.string()),
      retentionDays: z.strictObject({
        vote: count.positive().nullable(),
        audit: count.positive().nullable(),
        inactiveProfile: count.positive().nullable(),
        rateLimit: count.positive().nullable(),
        backup: count.positive().nullable(),
      }),
    })
    .nullable(),
  accounts: z.strictObject({
    total: count,
    enabled: count,
    suspended: count,
    deleted: count,
    enabledAdmins: count,
    enabledObservers: count,
    enabledAppSupport: count,
    enabledResidents: count,
    conflictingRoles: count,
    enabledWithoutHousehold: count,
    households: count,
    eligibleHouseholds: count,
    readyHouseholds: count,
  }),
  votes: z.strictObject({
    byStatus: counts,
    byType: counts,
    drafts: count,
    readyDrafts: count,
    draftBlockers: counts,
    overdueScheduledVotes: count,
  }),
  operations: z.strictObject({
    settingsPresent: z.boolean(),
    policyReady: z.boolean(),
    activeVotes: count,
    overdueActiveVotes: count,
    invariantFailures: count,
    expiredVotesPending: count,
    expiredAuditPending: count,
    expiredRateBucketsPending: count,
  }),
});

export type ConfigurationSnapshot = z.infer<typeof snapshotSchema>;

export interface ConfigurationCheck {
  code: string;
  status: "pass" | "warn" | "fail";
  message: string;
}

// Only projections and counts leave PostgreSQL. Reuse preview blockers and
// operational invariants without calling admin reads that reconcile lifecycle.
const SNAPSHOT_SQL = `
with drafts as materialized (
  select app_private.draft_blockers(v) as blockers
  from public.votes v where v.status = 'DRAFT'
)
select pg_catalog.jsonb_build_object(
  'checkedAt', pg_catalog.transaction_timestamp(),
  'settings', (
    select pg_catalog.jsonb_build_object(
      'fullName', s.full_name, 'alias', s.alias, 'timezone', s.timezone,
      'timezoneValid', app_private.is_valid_timezone(s.timezone),
      'householdLabel', s.household_label, 'identifierKind', s.identifier_kind,
      'accentPalette', s.accent_palette,
      'optionalFieldsProvided', pg_catalog.jsonb_build_object(
        'address', s.address <> '', 'email', s.email <> '', 'phone', s.phone <> '',
        'website', s.website <> '', 'welcomeMessage', s.welcome_message <> ''),
      'placeholderFields', (
        select coalesce(pg_catalog.jsonb_agg(field order by field), '[]'::jsonb)
        from (values
          ('fullName', s.full_name = 'Residents Welfare Association'),
          ('address', s.address = 'RWA Address'),
          ('email', s.email = 'rwa@email.com'),
          ('phone', s.phone = '+91 123 456 7890')
        ) as placeholders(field, present) where present),
      'defaultHouseholds', pg_catalog.cardinality(s.default_households),
      'rwaPositions', pg_catalog.cardinality(s.rwa_positions),
      'listsValid',
        app_private.is_valid_settings_list(s.default_households, 1000, 100)
        and app_private.is_valid_settings_list(s.rwa_positions, 50, 200),
      'retentionDays', pg_catalog.jsonb_build_object(
        'vote', s.vote_retention_days, 'audit', s.audit_retention_days,
        'inactiveProfile', s.inactive_profile_retention_days,
        'rateLimit', s.rate_limit_retention_days, 'backup', s.backup_retention_days),
      'missingApprovals', (
        select coalesce(pg_catalog.jsonb_agg(k order by k), '[]'::jsonb)
        from pg_catalog.unnest(array['A1','A2','A3','A4','A5','A6','A7']) k
        where not (s.policy_approvals ? k)),
      'missingRetention', (
        select coalesce(pg_catalog.jsonb_agg(field order by field), '[]'::jsonb)
        from (values
          ('vote_retention_days', s.vote_retention_days),
          ('audit_retention_days', s.audit_retention_days),
          ('inactive_profile_retention_days', s.inactive_profile_retention_days),
          ('rate_limit_retention_days', s.rate_limit_retention_days),
          ('backup_retention_days', s.backup_retention_days)
        ) as retention(field, days) where days is null)
    ) from public.rwa_settings s where s.id = 1),
  'accounts', (
    select pg_catalog.jsonb_build_object(
      'total', count(*),
      'enabled', count(*) filter (where p.status = 'ENABLED'),
      'suspended', count(*) filter (where p.status = 'SUSPENDED'),
      'deleted', count(*) filter (where p.status = 'DELETED'),
      'enabledAdmins', count(*) filter (where p.status = 'ENABLED' and p.is_admin),
      'enabledObservers', count(*) filter (
        where p.status = 'ENABLED' and p.is_readonly and not p.is_app_support),
      'enabledAppSupport', count(*) filter (where p.status = 'ENABLED' and p.is_app_support),
      'enabledResidents', count(*) filter (
        where p.status = 'ENABLED' and not p.is_admin and not p.is_readonly),
      'conflictingRoles', count(*) filter (where p.is_admin and p.is_readonly),
      'enabledWithoutHousehold', count(*) filter (
        where p.status = 'ENABLED' and not p.is_admin and not p.is_readonly and not exists (
          select 1 from public.households h where h.representative_profile_id = p.id)),
      'households', (select count(*) from public.households),
      'eligibleHouseholds', (select count(*) from public.households where is_eligible),
      'readyHouseholds', (
        select count(*) from public.households h join public.profiles r
          on r.id = h.representative_profile_id
        where h.is_eligible and r.status = 'ENABLED')
    ) from public.profiles p),
  'votes', pg_catalog.jsonb_build_object(
    'byStatus', (
      select coalesce(pg_catalog.jsonb_object_agg(status, n), '{}'::jsonb)
      from (select status, count(*) n from public.votes group by status) grouped),
    'byType', (
      select coalesce(pg_catalog.jsonb_object_agg(voting_type, n), '{}'::jsonb)
      from (select voting_type, count(*) n from public.votes group by voting_type) grouped),
    'drafts', (select count(*) from drafts),
    'readyDrafts', (select count(*) from drafts where blockers = '[]'::jsonb),
    'draftBlockers', (
      select coalesce(pg_catalog.jsonb_object_agg(code, n), '{}'::jsonb)
      from (
        select blocker ->> 'code' as code, count(*) n
        from drafts cross join lateral pg_catalog.jsonb_array_elements(blockers) blocker
        group by blocker ->> 'code'
      ) grouped),
    'overdueScheduledVotes', (
      select count(*) from public.votes where status = 'SCHEDULED'
        and opens_at < pg_catalog.transaction_timestamp() - interval '5 minutes')),
  'operations', public.operational_status()
) as snapshot
`;

export async function readConfigurationSnapshot(
  client: Pick<Client, "query">,
): Promise<ConfigurationSnapshot> {
  await client.query("begin isolation level repeatable read read only");
  try {
    // row_security=off fails on filtered reads rather than reporting false zeroes.
    // These local claims authorize only the existing count-only status routine.
    await client.query(`
      set local row_security = off;
      set local statement_timeout = '15s';
      set local lock_timeout = '3s';
      set local idle_in_transaction_session_timeout = '20s';
      select pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true)
    `);
    const result = await client.query<{ snapshot: unknown }>(SNAPSHOT_SQL);
    const parsed = snapshotSchema.safeParse(result.rows[0]?.snapshot);
    if (!parsed.success) {
      throw new Error("Configuration inspection returned an invalid report.");
    }
    return parsed.data;
  } finally {
    await client.query("rollback");
  }
}

export function configurationReport(
  snapshot: ConfigurationSnapshot,
  environment: Readonly<Record<string, string | undefined>>,
) {
  const checks: ConfigurationCheck[] = [];
  function check(
    code: string,
    passed: boolean,
    message: string,
    failure: "warn" | "fail" = "fail",
  ) {
    checks.push({ code, status: passed ? "pass" : failure, message });
  }

  try {
    parseEnvironment({ ...environment, NODE_ENV: "production" });
    check(
      "ENVIRONMENT",
      true,
      "Injected environment passes production shape validation; deployed values and delivery are not verified.",
    );
  } catch (error) {
    check(
      "ENVIRONMENT",
      false,
      error instanceof Error ? error.message : "Environment validation failed.",
    );
  }

  const settings = snapshot.settings;
  check(
    "SETTINGS_PRESENT",
    settings !== null,
    "RWA settings must be initialized.",
  );
  if (settings) {
    check(
      "TIMEZONE",
      settings.timezoneValid,
      "The configured time zone must be recognized by PostgreSQL.",
    );
    check(
      "SETTINGS_LISTS",
      settings.listsValid,
      "Default identifiers and positions must satisfy the database list rules.",
    );
    check(
      "PLACEHOLDER_PROFILE",
      settings.placeholderFields.length === 0,
      "Review any migration placeholder fields listed in settings; optional blank contact fields are allowed.",
      "warn",
    );
    check(
      "POLICY_APPROVALS",
      settings.missingApprovals.length === 0,
      "All A1-A7 approval records must be present; their authority and continued applicability require manual review.",
    );
    check(
      "RETENTION",
      settings.missingRetention.length === 0,
      "All five approved retention periods must be recorded.",
    );
  }

  const accounts = snapshot.accounts;
  check(
    "ENABLED_ADMIN",
    accounts.enabledAdmins > 0,
    "At least one enabled RWA administrator is required.",
  );
  check(
    "EXCLUSIVE_ROLES",
    accounts.conflictingRoles === 0,
    "Administrator and observer roles must remain exclusive.",
  );
  check(
    "ACCOUNT_ASSIGNMENTS",
    accounts.enabledWithoutHousehold === 0,
    "Enabled residents must have a register assignment; RWA Admin, RWA ReadOnly and App Support accounts may have none, because roles never confer voting.",
  );
  check(
    "APP_SUPPORT_ACCESS",
    accounts.enabledAppSupport === 0,
    "App Support Access is on; the RWA should turn it off in Settings once support is complete.",
    "warn",
  );
  check(
    "READY_ELECTORATE",
    accounts.readyHouseholds > 0,
    "At least one eligible register entry with an enabled representative is needed to prepare a vote.",
    "warn",
  );
  check(
    "ELIGIBLE_ACCOUNT_STATUS",
    accounts.eligibleHouseholds === accounts.readyHouseholds,
    "Review eligible register entries whose representatives are suspended or deleted.",
    "warn",
  );
  check(
    "VOTES_PRESENT",
    Object.values(snapshot.votes.byStatus).some((n) => n > 0),
    "No votes means adoption cannot yet be assessed; this is not proof of no visits.",
    "warn",
  );
  check(
    "DRAFT_READINESS",
    snapshot.votes.drafts === snapshot.votes.readyDrafts,
    "Incomplete drafts are allowed. Review aggregate draft blocker codes before activation.",
    "warn",
  );
  check(
    "SCHEDULED_OPENING",
    snapshot.votes.overdueScheduledVotes === 0,
    "No scheduled vote should remain unopened more than five minutes after its opening time.",
  );
  check(
    "DUE_COMPLETION",
    snapshot.operations.overdueActiveVotes === 0,
    "No active vote should remain uncompleted more than five minutes after its deadline.",
  );
  check(
    "VOTE_INVARIANTS",
    snapshot.operations.invariantFailures === 0,
    "Started votes must reconcile. Do not repair responses or counters manually.",
  );

  return {
    formatVersion: 1,
    ok: checks.every((entry) => entry.status !== "fail"),
    productionReady: false,
    checkedAt: snapshot.checkedAt,
    checks,
    settings,
    accounts,
    votes: snapshot.votes,
    operations: snapshot.operations,
    localFlags: {
      maintenanceMode: environment.MAINTENANCE_MODE === "1",
      pdfExportEnabled: environment.PDF_EXPORT_ENABLED !== "0",
    },
    unverified: [
      "Database target must be independently matched to the intended deployment; injected environment variables are not hosted configuration evidence.",
      "SMTP/OTP and contact delivery, Auth/provider configuration, trusted ingress/IP limiting, Cron execution, capacity and accessibility require external verification.",
      "Approval authenticity, provider/region acceptance, backup freshness, off-site automation and restore completeness remain manual launch gates.",
      "No logins, last-seen timestamps, visitor tracking, resident details or ballot choices are collected or reported.",
    ],
  };
}

export async function inspectConfiguration(
  environment: Readonly<Record<string, string | undefined>>,
) {
  const url = environment.CONFIG_DATABASE_URL;
  if (!url?.trim()) {
    throw new Error(
      "CONFIG_DATABASE_URL is required for operator-only configuration inspection.",
    );
  }
  // Never forward pg/provider errors: they can contain credentials or row values.
  try {
    const client = new Client({
      ...operationalDatabaseConfig(url),
      application_name: "civic-pulse-config-check",
      connectionTimeoutMillis: 5_000,
      query_timeout: 20_000,
    });
    try {
      await client.connect();
      return configurationReport(
        await readConfigurationSnapshot(client),
        environment,
      );
    } finally {
      await client.end();
    }
  } catch {
    throw new Error(
      "Configuration inspection unavailable. Check CONFIG_DATABASE_URL, verified TLS, current migrations and operator read permissions. No configuration was verified.",
    );
  }
}
