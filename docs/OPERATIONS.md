# Civic Pulse operations runbook

Who does what when the service is running, being maintained, or has to be recovered. Everything here has a command or a test behind it unless it says **manual** or **not decided**.

Commands run from the project root with Node on `PATH`:

```powershell
npm run ops -- <command> [options]      # = node --env-file-if-exists=.env.local scripts/ops/cli.ts
```

## 1. Settings that belong to operations

| Variable                                | Used by                | Meaning                                                                                                                                                                                  |
| --------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BACKUP_DATABASE_URL`                   | `backup`, `auth-orphans`, `recovery-record` | A **direct** (not transaction-pooled) connection for a dedicated backup login. See 3.1.                                                                          |
| `BACKUP_ENCRYPTION_KEY`                 | all backup commands    | 64 hex characters (`npm run ops -- generate-key`). Keep it in the approved secret store, **never beside the backups or in the database**. Lose it and every backup is unreadable.          |
| `BACKUP_DIR`                            | `backup`, `prune`, `status` | The destination folder. The operator makes it off-site (a synced/mounted folder, an object-store mount, a removable drive that leaves the building). **Which one is not decided.** |
| `BACKUP_MAX_AGE_HOURS`                  | `status`               | Alert if the newest backup is older than this.                                                                                                                                           |
| `RESTORE_DATABASE_URL`                  | `restore`              | An **isolated** database that already has the reviewed migrations applied. Never the live one.                                                                                           |
| `MAINTENANCE_MODE=1`                    | the app                | Pages show a maintenance notice (HTTP 503), every API route answers 503, and `/api/internal/health` reports `unavailable`.                                                                |
| `PDF_EXPORT_ENABLED=0`                  | the app                | Switches the PDF download off (the control disappears; the endpoint answers `EXPORT_FORMAT_UNAVAILABLE`). On by default.                                                                  |
| `PG_BIN_DIR`                            | backup tools           | Folder holding `pg_dump`/`pg_restore` (PostgreSQL 17 client tools, matching Supabase). Optional if they are on `PATH`.                                                                     |
| `RESEND_API_KEY`, `CONTACT_EMAIL_FROM`, `CONTACT_EMAIL_TO` | contact route | Optional server-only support-mail settings; set all three together. Separate from Supabase OTP SMTP. Restore from the secret/configuration store, not a database backup. |
| `GOOGLE_ANALYTICS_ID`, `GOOGLE_SITE_VERIFICATION` | public pages | Optional public identifiers. GA4 is consent-gated on privacy/contact only; verification is not proof of Google property ownership. Set at build/runtime and rebuild after changes. |

## 2. Monitoring

The all-screen visual rollout changes shared UI surfaces, not operational
endpoints, rates, retention, permissions or counting. Native ballot submission,
unknown-outcome recovery and export routes are unchanged. The User Guide now
documents Resident (`voter`), RWA Admin (`rwa-admin`) and RWA ReadOnly (`rwa-readonly`) separately. Its screenshots are
persona-grouped.
Capture tests use synthetic records on the approved disposable project with
redacted email/code fields. Captures demonstrate those fixtures only and do not
prove production readiness or real email delivery.

The concept-aligned Votes overview adds three exact RLS head-count reads per
authorized page, plus bounded-concurrency existing-result reads for active-card
turnout. Standard read budgets still apply; measure the added latency and quotas
on the approved host rather than claiming the previous page timing covers it.
Count/turnout read failures show unavailable, not fabricated zero. No choice
payloads, identity data or unsafe provider details are logged by this helper.
The UI change adds no migration or write operation.

Appearance choice is a non-sensitive browser-local key, not an operational RWA
setting. Clearing `civic-pulse-theme` restores System; blocked storage keeps a
choice only in memory until reload. Do not copy identity/vote information into
this key or log browser storage. RWA accent settings, Auth cookies, backups and
results remain independent. Fonts are self-hosted; a theme outage must not add
external font/analytics calls to sign-in or voting. Print/PDF stay light.

The existing minute-based due-vote job also opens scheduled votes under the vote
lock. Authorized member list/detail/submission and administrator detail reads
reconcile openings as well; neither Cron nor the UI countdown permits early
admission. If a database resumes after an entire window elapsed, the schedule
completes at its original deadline without accepting a late ballot. Verify this
job in the chosen hosted environment; local PostgreSQL tests invoke the routine
but do not prove hosted scheduling. Do not manually update scheduled states.

Bulk import uses a separate provisional 1200-request/hour budget per admin and
independent provider quotas. On a partial/unknown outcome, stop and recheck rows;
do not delete Auth identities as rollback or enable a partially assigned profile.
New import entries remain suspended until reviewed and explicitly enabled, either
individually or through the Accounts table's page-local Enable Selected action.
Make Eligible is separate and never enables sign-in. Residents are the default
role filter; administrators require explicit inclusion and an access warning.
The same per-record audit, current-admin checks and 60-mutation/minute budget
apply; a bulk UI action is not one transaction. The exclusive `rwa-readonly`
role can inspect authorized management data but cannot change roles or register
state; assign it only to an account with a household before enabling it. Role
transitions are audited and retain the final-enabled-admin safeguard. Stop on
failure, preserve completed outcomes and refresh before retrying an uncertain row. Existing
records and frozen scheduled/active electorates are never overwritten by import.

`npm run ops -- status` prints **counts only** (no names, no choices) and exits non-zero on any of:

| Alert               | Meaning                                                                                             | Action                                                                                  |
| ------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `CRON_LATE`         | An active vote is more than five minutes past its deadline.                                         | Supabase Cron is paused or failing. Resident screens still refuse late ballots by the database clock and finalise on first view, but fix Cron. |
| `INVARIANT_FAILURE` | A started vote's participation, responses or counters no longer reconcile.                          | **Stop.** Results for that vote are already withheld (`RESULTS_INTEGRITY_ERROR`). Go to 6, do not repair by hand. |
| `POLICY_INCOMPLETE` | Approvals or retention values are missing.                                                          | Record them (docs/LOCAL_SETUP.md 7.3). Votes cannot be activated meanwhile.            |
| `BACKUP_STALE`      | No backup newer than `--max-backup-age-hours`.                                                      | Run a backup, then find out why the schedule did not.                                  |

`GET /api/internal/health` returns `{"data":{"status":"ok"|"unavailable"},"requestId":"..."}` (200 / 503) and nothing else: no versions, quotas or provider detail. It checks that the database answers a trivial call. It is for a monitor, **not** a keep-alive; do not poll it to stop a free-tier project pausing.

The probe aborts its outstanding database HTTP request after three seconds and clears its timer when the check finishes. Failures are reported through allowlisted operational logging without provider messages or credentials; the public response remains only a status and support ID.

Run `status` and the health check from a scheduler you control (Windows Task Scheduler, cron, or a monitoring service) and alert on a non-zero exit. **Manual: no scheduler is configured by this repository.**

### Public contact and discovery checks (manual)

The health probe checks the database, **not** Resend, inbox receipt, Google
collection/ownership or policy approval. Periodically check the public privacy
and contact pages, the footer's `/user-guide.html` link and its embedded images,
canonical `APP_ORIGIN`, robots/sitemap and the share image on
the approved deployment. Do not add private record URLs to crawler checks.

When contact is enabled, verify a synthetic enquiry reaches the approved test
inbox and Reply-To works; a `202` only proves provider acceptance. Watch provider
rejections, quotas, spam handling and the shared email/global budgets without
capturing messages or addresses in application logs. A send timeout is uncertain:
do not retry automatically. A contact outage does not invalidate an accepted
ballot and must not introduce a provider dependency into vote acceptance.

If Google settings are enabled, check consent refusal/withdrawal and a fresh
sign-in document without tracking, and keep Enhanced Measurement/advertising
disabled in GA4. Treat analytics, Search Console, mailbox retention and legal
operator details as external configuration requiring named owners. No provider
alerts or delivery webhooks are implemented by this manual checklist. Activation
and actual delivery evidence are in
[Deployment](./DEPLOYMENT.md#public-site-integrations).

## 3. Retention (automatic)

Migration `20261024160000` schedules a Supabase Cron job, `civic-pulse-maintenance`, daily at 21:30 UTC (03:00 India). It runs `public.run_maintenance()` as the `cp_scheduler` role, which can run exactly two routines: due completion and this one. There is no HTTP endpoint and nothing to override.

Each run, in bounded batches and using the **current** approved settings (a missing value skips that task):

1. **Votes:** up to 10 completed/cancelled votes older than `vote_retention_days` are deleted coherently (responses or counters, participation, electorate, ballot, then the vote) in one transaction each, with a minimal audit event (`kind`, voting type, status). A failure rolls back that vote only and is reported.
2. **Audit events** older than `audit_retention_days` (up to 1000), leaving one count-only trace.
3. **Rate-limit buckets** expired for longer than `rate_limit_retention_days` (up to 5000). A bucket still inside its window is never touched.
4. **Deleted profiles** older than `inactive_profile_retention_days` that nothing refers to (no household, electorate row, authored vote or audit event). The profile is removed; its **Auth identity is then an orphan**.

Scheduled, active and draft votes are never deleted, and a deletion is re-checked row by row by the database guards, not only by the routine.

**Removing orphaned Auth identities (manual, periodic):**

```powershell
npm run ops -- auth-orphans            # dry run: how many
npm run ops -- auth-orphans --apply    # delete through supported Auth administration
```

It never touches an identity younger than 24 hours (provisioning creates the Auth user before the profile). If an individual delete fails it is counted and reported; re-run later. A failed resident self-registration deletes the identity it just created; if that best-effort cleanup itself fails (logged as `self_registration.identity_cleanup_failed`), the leftover identity has no profile and grants no access, and this command removes it. Self-registered profiles that an administrator leaves suspended are not deleted automatically; review them on **Accounts → Source: Self-registered** and set unwanted ones to Deleted.

Deletion from the live database does **not** erase copies in existing backups; they leave when their own expiry passes (`backup_retention_days`).

## 4. Backups

### 4.1 One-time set-up (manual)

1. `npm run ops -- generate-key`, store the result in the approved secret store, and set `BACKUP_ENCRYPTION_KEY` where the backup runs. Keep a second copy of the key somewhere separate from the backups. **Test restoring with the stored copy, not the one in your shell.**
2. Create a dedicated login for backups, with only what it needs (run once as the database owner; choose the password yourself and do not put it in the repository):

   ```sql
   create role cp_backup login password '<choose one>' noinherit;
   grant usage on schema public, app_private to cp_backup;
   grant select on all tables in schema public to cp_backup;
   grant select on auth.users, auth.identities to cp_backup;  -- Auth identities
   ```

   On Supabase's hosted project use the **direct** connection string (not the transaction pooler: the snapshot needs one session). If the platform refuses a grant, use the project's database owner role instead and record why.
3. Choose and approve the off-site destination and its expiry. **Not decided.** Supabase Free does not include automatic backups or point-in-time recovery, and Supabase Cron is not an off-site backup.

### Operational connection security

All operational PostgreSQL connections (backup, recovery record, restore/reconciliation and orphan cleanup) and native dump/restore tools require **certificate and hostname verification** for remote hosts. Use a PostgreSQL URL with `?sslmode=verify-full`; omitted TLS mode also selects `verify-full` remotely. Insecure or weaker explicit modes are rejected, not silently upgraded or retried without TLS. Plaintext is permitted only for the literal loopback hosts `localhost`, `127.0.0.1` and `::1`, for local development.

For a provider-specific CA, use `sslrootcert=<URL-encoded path to the approved CA file>` or set `PGSSLROOTCERT` to that file. Otherwise system certificate roots are used. `NODE_EXTRA_CA_CERTS` can extend Node's system roots, but does not configure libpq; set the approved `PGSSLROOTCERT` when the native tools need a custom CA. Optional client certificates use `sslcert`/`sslkey` (or `PGSSLCERT`/`PGSSLKEY`). These four TLS parameters are the only supported connection-URL query options; duplicates and host/SSL override parameters are rejected. Do not disable certificate validation to work around a connection failure.

Credentials reach native tools through their environment, never command-line arguments. Inherited `PGSERVICE`, `PGSERVICEFILE` and `PGHOSTADDR` cannot redirect these connections. Use the same approved CA and hostname for Node and PostgreSQL tools, and confirm the real hosted backup/restore connection before release.

Backup manifests are bounded, strictly validated metadata: each must name exactly its own application, Auth and counts files, with unique roles, valid hashes, matching timestamps and expiry. Traversal paths, alternate streams, cross-set filenames and symbolic-link manifests/data reads are refused. Failed same-timestamp backups preserve the existing set. AES-GCM authenticates encrypted file contents; it does **not** authenticate the plaintext manifest or prevent rollback of a whole valid backup. Protect the destination and retain a trusted inventory/recovery point separately.

### 4.2 Taking a backup

```powershell
npm run ops -- backup
```

It opens one consistent snapshot and, from that snapshot, writes **four files** into `BACKUP_DIR`:

| File                      | Content                                                                                       |
| ------------------------- | --------------------------------------------------------------------------------------------- |
| `cp-backup-<time>.app.enc`    | `pg_dump` (custom format) of the `public` and `app_private` schemas: data, tables, grants, policies, routines. |
| `cp-backup-<time>.auth.enc`   | Data of `auth.users`, `auth.identities`, the migration history and the Cron schedules (where they exist). |
| `cp-backup-<time>.counts.enc` | Row counts of every table and a digest per started vote (participation, choices, counters, electorate), taken at the same snapshot. |
| `cp-backup-<time>.manifest.json` | Names, sizes, SHA-256 hashes, creation and expiry. No data.                                |

Everything with data is AES-256-GCM encrypted with a fresh random IV per file. Plaintext is never written to disk by the backup. Expiry is `backup_retention_days` from the settings; **a backup refuses to run if it is not approved**. The command then verifies the set (hashes, decryption, and that the dump has a data section for every table, the Auth tables and the application routines) and deletes sets past their expiry, always keeping the newest.

Run it on a schedule you choose (daily is typical) from a machine that is not the database host. **Manual: no schedule is configured here.** Check `npm run ops -- verify --manifest <path>` any time.

### 4.3 What a backup does not contain (recover these separately)

- **Secrets and keys:** the Supabase service-role key, `RATE_LIMIT_HMAC_KEY`, `BACKUP_ENCRYPTION_KEY` and optional `RESEND_API_KEY`. Recover from the secret store.
- **External configuration:** the Auth settings (disabled signup, six-digit code, expiry), the custom SMTP provider and its templates, allowed redirect URLs, and any Cron job outside the database. Keep these in your configuration notes; the checklist in docs/LOCAL_SETUP.md section 4.2 and 8 lists them.
- **Public integrations:** contact sender/recipient, verified domain/DNS, Resend access and mailbox retention; Google identifiers/property settings, disabled Enhanced Measurement, consent behavior and Search Console verification. Recover from approved configuration notes and recheck after deployment; database restore does not restore them.
- **The application itself:** redeploy the reviewed build; never use a database restore as an application rollback.

## 5. Restore rehearsal and real restore

A restore is always into an **isolated** database first.

1. Create a new project/database. Apply the reviewed migrations (`npx supabase db push`). Leave the application tables empty. Put the app in maintenance mode (`MAINTENANCE_MODE=1`) so nobody reaches it.
2. `npm run ops -- restore --manifest <path>` with `RESTORE_DATABASE_URL` pointing at it. It restores the Auth identities and then the application data in one transaction each (guard triggers are not fired during a data restore) and **reconciles**:
   - every table's row count equals the count taken at backup time;
   - every started vote reproduces its recorded participation, choices, counters and electorate (digest);
   - every started vote passes the same invariants that guard completion and publication;
   - every profile has an Auth identity; row-level security is on for every table; no anonymous caller can run any routine.
3. Read the result:
   - `consistent: false` → **stop**, the backup or the restore is damaged. Do not resume. Try an older backup.
   - **warnings** (active votes at backup time; votes already past their deadline) mean ballots acknowledged after the backup are **not** in it. They complete at their deadline with what was restored. Decide with the committee: usually **cancel and replace** (section 7).
   - `resumeAllowed` is `true` only when the restore is consistent, nothing is active or overdue, **and** you passed `--completeness-confirmed` to say you have independently established that nothing acknowledged is missing. A consistent but possibly incomplete backup never authorises resuming an election.
4. **Replay later administrative actions.** The database you restored lacks everything after the backup. Before the old database went away, `npm run ops -- recovery-record --since <backup time> --out recovery.enc` exports (encrypted, administrative facts only) the suspensions, role changes, household edits and deletions since then. Re-apply suspensions and removals first, so nobody whose access was revoked regains it.
5. Auth identities: existing sign-in sessions are not part of the backup and do not carry over; everybody signs in again with a fresh code. If the Auth service has to be rebuilt, use Supabase's supported recovery and then check every enabled profile still has its identity (the reconciliation does).
6. Only when the above is satisfied and a person has signed off: point the application at the restored database and clear maintenance mode.

**Tested:** this procedure is rehearsed automatically (`tests/integration/restore.test.ts`): a populated database is backed up with `pg_dump`, encrypted, verified, restored into a separately migrated database and reconciled, including a tampered file, a wrong key, a lost ballot, an elapsed deadline and the recovery record. A backup of the hosted project was also created and verified once (all four files, Auth identities included). **Not yet done:** a full restore of the hosted project into a second Supabase project, and a restore from the real off-site location with the stored key. Do both before the pilot (docs/PILOT_READINESS.md).

## 6. Incidents

| Situation                                                | Who                                | What                                                                                                                                                                                                  |
| -------------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Results show "temporarily unavailable pending a review"  | The technical contact              | `INVARIANT_FAILURE`. Do **not** edit counters or responses. Preserve a backup first, then investigate from the audit history and a restore of the last good backup. Decide with the committee whether to cancel the vote. |
| Suspected leak of a backup file or key                   | The technical contact + committee  | Rotate `BACKUP_ENCRYPTION_KEY`, take a new backup, delete the old sets, and treat the contents (names, household identifiers, PUBLIC choices) as disclosed.                                              |
| Database or hosting outage                               | The technical contact              | Set `MAINTENANCE_MODE=1` if the app is misbehaving; otherwise leave it. Deadlines keep passing and are **never extended automatically**; the database clock decides who got in. If the committee agrees, an admin can move the deadline of a still-Active vote with **Change Deadline**. Tell residents what happened. |
| Lost or wrong ballots after a restore                    | The committee                      | Section 5 step 3: cancel and replace. Never discard votes silently, extend a deadline, or reopen a finished vote.                                                                                     |
| Member loses access mid-vote                             | An administrator                   | Suspend/enable the account in **Accounts**; it takes effect on the next request even with a valid session.                                                                                            |

The technical contact, the committee decision-maker and the escalation route are people, not code. **Not decided: record them here before the pilot.**

## 7. Cancelling and replacing a vote

A finished vote cannot be reopened, and an active vote cannot be edited; only its deadline can be moved (**Change Deadline**, with a reason, while it is still Active). If a vote must be redone (wrong electorate, wrong ballot, lost data):

1. **Manage Votes → the vote → Cancel Vote**, with a written reason. Residents see "Cancelled; results not valid." and no results or download is possible.
2. Create a new draft with the corrected ballot and electorate, preview it, activate it with a new deadline, and tell residents. The cancelled vote's data is removed by retention at the normal time.

## 8. Releases and migrations

Apply migrations with deployment-only credentials (`npx supabase db push`) outside an active vote; they are ordered, immutable, and tested on PostgreSQL 17 and on the hosted project. Prefer backward-compatible changes. **Never** restore an old database to roll back a release once ballots have been accepted: roll back to a schema-compatible build of the application, or ship a forward fix.
