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

## 2. Monitoring

`npm run ops -- status` prints **counts only** (no names, no choices) and exits non-zero on any of:

| Alert               | Meaning                                                                                             | Action                                                                                  |
| ------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `CRON_LATE`         | An active vote is more than five minutes past its deadline.                                         | Supabase Cron is paused or failing. Resident screens still refuse late ballots by the database clock and finalise on first view, but fix Cron. |
| `INVARIANT_FAILURE` | A started vote's participation, responses or counters no longer reconcile.                          | **Stop.** Results for that vote are already withheld (`RESULTS_INTEGRITY_ERROR`). Go to 6, do not repair by hand. |
| `POLICY_INCOMPLETE` | Approvals or retention values are missing.                                                          | Record them (docs/LOCAL_SETUP.md 7.3). Votes cannot be activated meanwhile.            |
| `BACKUP_STALE`      | No backup newer than `--max-backup-age-hours`.                                                      | Run a backup, then find out why the schedule did not.                                  |

`GET /api/internal/health` returns `{"data":{"status":"ok"|"unavailable"},"requestId":"..."}` (200 / 503) and nothing else: no versions, quotas or provider detail. It checks that the database answers a trivial call. It is for a monitor, **not** a keep-alive; do not poll it to stop a free-tier project pausing.

Run `status` and the health check from a scheduler you control (Windows Task Scheduler, cron, or a monitoring service) and alert on a non-zero exit. **Manual: no scheduler is configured by this repository.**

## 3. Retention (automatic)

Migration `20261024160000` schedules a Supabase Cron job, `civic-pulse-maintenance`, daily at 21:30 UTC (03:00 India). It runs `public.run_maintenance()` as the `cp_scheduler` role, which can run exactly two routines: due completion and this one. There is no HTTP endpoint and nothing to override.

Each run, in bounded batches and using the **current** approved settings (a missing value skips that task):

1. **Votes:** up to 10 completed/cancelled votes older than `vote_retention_days` are deleted coherently (responses or counters, participation, electorate, ballot, then the vote) in one transaction each, with a minimal audit event (`kind`, voting type, status). A failure rolls back that vote only and is reported.
2. **Audit events** older than `audit_retention_days` (up to 1000), leaving one count-only trace.
3. **Rate-limit buckets** expired for longer than `rate_limit_retention_days` (up to 5000). A bucket still inside its window is never touched.
4. **Deleted profiles** older than `inactive_profile_retention_days` that nothing refers to (no household, electorate row, authored vote or audit event). The profile is removed; its **Auth identity is then an orphan**.

Active and draft votes are never deleted, and a deletion is re-checked row by row by the database guards, not only by the routine.

**Removing orphaned Auth identities (manual, periodic):**

```powershell
npm run ops -- auth-orphans            # dry run: how many
npm run ops -- auth-orphans --apply    # delete through supported Auth administration
```

It never touches an identity younger than 24 hours (provisioning creates the Auth user before the profile). If an individual delete fails it is counted and reported; re-run later.

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

- **Secrets and keys:** the Supabase service-role key, `RATE_LIMIT_HMAC_KEY`, `BACKUP_ENCRYPTION_KEY`. Recover from the secret store.
- **External configuration:** the Auth settings (disabled signup, six-digit code, expiry), the custom SMTP provider and its templates, allowed redirect URLs, and any Cron job outside the database. Keep these in your configuration notes; the checklist in docs/LOCAL_SETUP.md section 4.2 and 8 lists them.
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
| Suspected leak of a backup file or key                   | The technical contact + committee  | Rotate `BACKUP_ENCRYPTION_KEY`, take a new backup, delete the old sets, and treat the contents (names, household identifiers, OPEN choices) as disclosed.                                              |
| Database or hosting outage                               | The technical contact              | Set `MAINTENANCE_MODE=1` if the app is misbehaving; otherwise leave it. Deadlines keep passing and are **never extended**; the database clock decides who got in. Tell residents what happened.       |
| Lost or wrong ballots after a restore                    | The committee                      | Section 5 step 3: cancel and replace. Never discard votes silently, extend a deadline, or reopen a finished vote.                                                                                     |
| Member loses access mid-vote                             | An administrator                   | Suspend/enable the account in **Accounts**; it takes effect on the next request even with a valid session.                                                                                            |

The technical contact, the committee decision-maker and the escalation route are people, not code. **Not decided: record them here before the pilot.**

## 7. Cancelling and replacing a vote

A vote cannot be reopened, edited or extended. If a vote must be redone (wrong electorate, wrong ballot, lost data):

1. **Manage votes → the vote → Cancel vote**, with a written reason. Residents see "Cancelled; results not valid." and no results or download is possible.
2. Create a new draft with the corrected ballot and electorate, preview it, activate it with a new deadline, and tell residents. The cancelled vote's data is removed by retention at the normal time.

## 8. Releases and migrations

Apply migrations with deployment-only credentials (`npx supabase db push`) outside an active vote; they are ordered, immutable, and tested on PostgreSQL 17 and on the hosted project. Prefer backward-compatible changes. **Never** restore an old database to roll back a release once ballots have been accepted: roll back to a schema-compatible build of the application, or ship a forward fix.
