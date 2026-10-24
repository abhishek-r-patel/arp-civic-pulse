# Database: Civic Pulse

## 1. Scope and governing requirements

[PRD.md](./PRD.md) governs product behavior; [ARCHITECTURE.md](./ARCHITECTURE.md) governs implementation and privacy boundaries. This model supports one RWA, initially 500 eligible households and 100 concurrent users.

Use Supabase PostgreSQL as the authoritative store, with Supabase Auth, row-level security (RLS), guarded SQL RPCs, and versioned Supabase migrations. Normal database calls use a server-side Supabase client carrying the verified user's session; do not use raw `pg` or a service-role client for ordinary voting/results access. Require TLS, encrypted storage/backups, and the supported network restrictions for each connection path. Assume clients can call the Supabase API directly, even though browser application journeys go through Next.js.

The design implements assumptions A1-A7 provisionally. Production activation requires recorded approvals, including retention/recovery policy, CLOSED VOTING assurance, publication timing, the session policy, all-abstain behavior, and early completion. Under A7, optional printable exports are not signatures, legal certification, backups, or authoritative records; replacing physical signatures is not a version 1 requirement.

### Required boundaries

- One designated representative and one entitlement per household per vote.
- `OPEN` and `CLOSED` are voting types; `DRAFT`, `ACTIVE`, `COMPLETED`, and `CANCELLED` are separate lifecycle states.
- OPEN VOTING stores attributable single-choice responses. Publish identities and counts only after completion.
- CLOSED VOTING stores cumulative candidate/abstention counters, never individual ballots. Participation records contain no choices.
- Freeze ballot configuration, deadline, electorate, representative identity snapshots, and relevant RWA metadata at activation.
- One atomic, durable submission per entitlement. Terminal votes cannot reopen.
- Derive results, turnout, percentages, and reports from authoritative records; do not store duplicate editable results.
- CSV export is required for version 1. PDF is optional; its controls and acceptance checks apply only when implemented. Neither voting nor recovery depends on PDF generation.

There are no tenant, campaign, nomination, signature, attachment, notification, report-file, or individual closed-ballot tables. Supabase Auth owns authentication identities, OTPs, and sessions; do not add parallel application authentication tables. No Redis or separate identity service is required.

## 2. Conventions

| Concern | Convention |
|---|---|
| Identifiers | Internal entity IDs use database-generated UUIDs, except `profiles.id`, which references the Supabase Auth user ID. UUIDs are not authorization tokens. |
| Time | All instants use `timestamptz`; database connections use UTC. Display using the frozen IANA timezone. |
| Clock | Use `clock_timestamp()` after acquiring the vote lock for submission admission, not transaction-start `now()`. |
| Required columns | Every listed column is `NOT NULL` unless marked nullable. |
| Enumerations | Use `text` with explicit `CHECK` allowlists; no unconstrained status/type strings. |
| Strings | Store trimmed plain text. Reject empty required strings and control characters inappropriate to the field. Do not accept rich HTML. |
| Normalization | Use one versioned server/database-compatible normalization policy. Email: trim and lowercase consistently, without provider-specific rewriting. Household keys: trim, Unicode-normalize, and case-fold consistently. Preserve household display labels separately. |
| Deletion | Foreign keys use `ON DELETE RESTRICT` and `ON UPDATE RESTRICT` unless stated otherwise. Never cascade a live vote deletion. |
| Concurrency | Lock the parent vote before any electorate, ballot, participation, response, or counter write; lifecycle operations use the same order. |
| Counts | Aggregate counters use nonnegative `bigint`. Represent counts safely across the PostgreSQL/TypeScript boundary; do not silently coerce arbitrary `bigint` to JavaScript `number`. |

Proposed implementation bounds are 254 characters for email, 100 for household labels/keys, 200 for names and ballot labels, 300 for titles/questions, 10,000 for instructions/context, and 2,000 for reasons. Apply identical bounds in request validation and database checks. These are technical safeguards, not additional voting rules; verify them against pilot data before release.

## 3. Tables and columns

### 3.1 `rwa_settings`

Exactly one row, maintained through controlled setup and audited administrative operations.

| Column | Type | Keys / rules |
|---|---|---|
| `id` | `smallint` | PK; `CHECK (id = 1)`. |
| `name` | `text` | Non-empty RWA display name. |
| `timezone` | `text` | Valid IANA timezone, validated against PostgreSQL timezone names and supported application timezone data. |
| `policy_approvals` | `jsonb` | Object keyed exactly by A1-A7; empty object allowed during setup. Structure below. |
| `vote_retention_days` | `integer`, nullable | Positive approved period after completion/cancellation; null means unapproved, not unlimited. |
| `audit_retention_days` | `integer`, nullable | Positive approved period after event creation. |
| `inactive_profile_retention_days` | `integer`, nullable | Positive approved period after soft deletion, subject to historical references and coordinated Auth removal. |
| `rate_limit_retention_days` | `integer`, nullable | Positive cleanup period after bucket expiry. |
| `backup_retention_days` | `integer`, nullable | Positive approved backup expiry; must match provider configuration. |
| `updated_at` | `timestamptz` | Database-assigned modification time. |

Each approval entry contains a non-empty `version`, `approved_at`, `approved_by_profile_id`, `approving_authority`, and non-empty `decision`. Record the actual approving authority, not merely the administrator entering the record. The decision records the approved assumption and any operational qualification, not a ballot or secret. Validate JSON shape and allowed keys in the protected settings operation; verify the recording profile there. JSON profile references are historical attribution, not foreign keys. Audit policy changes and retain that evidence for the approved period.

Approvals are invalidated when their associated decision/version changes. Activation checks all seven current approvals and every required retention value. Provider, region, recovery objectives, and backup capability approval are deployment release gates, not extra application entities.

### 3.2 `profiles` and managed `auth.users`

Supabase owns `auth.users` and its authentication schema. Its user UUID and registered email are the identity source; do not recreate its tables, change their internal columns, or duplicate email/verification/session state in application tables. Provisioning normalizes registered email and rejects ambiguous identities through the supported Auth administrative API. Only the following application profile is defined here.

| Column | Type | Keys / rules |
|---|---|---|
| `id` | `uuid` | PK and FK to `auth.users.id`; `ON DELETE RESTRICT`. No independently generated profile ID. |
| `representative_name` | `text` | Non-empty current name. |
| `status` | `text` | `ENABLED`, `SUSPENDED`, or `DELETED`; default `SUSPENDED` until provisioning is complete. |
| `is_admin` | `boolean` | Default false; does not grant voting entitlement. |
| `created_at` | `timestamptz` | Database creation time. |
| `updated_at` | `timestamptz` | Database modification time. |
| `deleted_at` | `timestamptz`, nullable | Present exactly when status is `DELETED`. |

Keep profile IDs stable across email/register edits and suspension; do not create replacement identities to bypass frozen assignments. Current role/status come from this table, never user-editable Auth metadata. Members cannot update these fields directly. Historical electorate references remain stable. No passwords, date of birth, phone numbers, or ownership documents are application data requirements.

Suspension/soft deletion blocks application access immediately through profile checks in RLS and guarded functions, including with an already-issued JWT. Use supported Auth administrative operations for session revocation, bans, email changes, and identity removal as applicable; do not promise instant invalidation of every issued JWT. Auth administrative calls and profile changes are not one transaction: surface partial failures and use retry-safe operations. Keep a profile blocked throughout an identity-change workflow until the Auth identity and register association are verified consistent.

### 3.3 `households`

| Column | Type | Keys / rules |
|---|---|---|
| `id` | `uuid` | PK; stable across identifier edits. |
| `identifier` | `text` | Non-empty current display label. |
| `identifier_normalized` | `text` | Unique canonical household key. |
| `representative_profile_id` | `uuid` | FK to `profiles.id`; unique. |
| `is_eligible` | `boolean` | Current register eligibility; default false. |
| `created_at` | `timestamptz` | Database creation time. |
| `updated_at` | `timestamptz` | Database modification time. |

Each household has exactly one current representative; a profile represents at most one current household. Administrators may exist without a household. Reassignment affects future activation only. Current register eligibility changes never rewrite an activated electorate.

### 3.4 Managed authentication behavior (no application tables)

- Disable public signup. Request six-digit email OTPs through Supabase Auth with `shouldCreateUser: false` and the `{{ .Token }}` email template.
- Configure custom SMTP, code expiry, resend cooldown, and request/verification limits in Auth; validate same-day login bursts for 500 households. Do not assume built-in SMTP is production-ready.
- Return generic request acknowledgements and safe retry guidance without exposing account existence. Never persist or log codes, tokens, cookies, or email content in application records.
- Use `@supabase/ssr` and supported server-side identity verification/refresh. Do not authorize from an unverified cookie session object or invent parallel opaque sessions.
- Native time-boxing, idle timeout, and single-session controls require Supabase Pro or higher under the architecture's planning assumptions. Approve the actual persistent-session policy under A4; do not promise 30-minute idle or 12-hour absolute expiry on Free.
- Check current profile suspension/role on every protected operation. Sign-out or Auth administration alone may not immediately invalidate existing JWTs.
- Auth manages its own records and lifecycle through supported interfaces. Approve relevant Auth retention/provider controls without adding custom challenge/session cleanup SQL.

### 3.5 `votes`

| Column | Type | Keys / rules |
|---|---|---|
| `id` | `uuid` | PK. |
| `voting_type` | `text` | `OPEN` or `CLOSED`. |
| `status` | `text` | `DRAFT`, `ACTIVE`, `COMPLETED`, or `CANCELLED`; default `DRAFT`. |
| `title` | `text` | Title/question; may be empty while drafting, required at activation. |
| `instructions` | `text`, nullable | OPEN context or CLOSED instructions; non-empty CLOSED instructions required at activation. |
| `closes_at` | `timestamptz`, nullable | Required and strictly future at activation; frozen afterwards. |
| `draft_revision` | `integer` | Positive; increment on every draft edit, including child/electorate edits. |
| `created_by_profile_id` | `uuid` | FK to `profiles.id`. |
| `created_at` | `timestamptz` | Creation time. |
| `updated_at` | `timestamptz` | Modification time, including lifecycle transitions. |
| `activated_at` | `timestamptz`, nullable | Actual activation time. |
| `completed_at` | `timestamptz`, nullable | Effective completion: deadline or confirmed early-completion time. |
| `completion_mode` | `text`, nullable | `DEADLINE` or `EARLY`; present only when completed. |
| `completion_reason` | `text`, nullable | Non-empty for early completion; null for deadline completion. |
| `cancelled_at` | `timestamptz`, nullable | Effective cancellation time; present only when cancelled. |
| `cancellation_reason` | `text`, nullable | Non-empty exactly when cancelled. |
| `rwa_name_snapshot` | `text`, nullable | RWA name frozen at activation. |
| `timezone_snapshot` | `text`, nullable | IANA timezone frozen at activation. |
| `policy_versions_snapshot` | `jsonb`, nullable | Frozen object mapping A1-A7 to approved version strings; no mutable settings lookup for historical notices. |

State-dependent checks require activation/deadline/snapshot fields for non-drafts; completion fields only for `COMPLETED`; cancellation fields only for `CANCELLED`. Drafts have no terminal/activation fields. Require `activated_at < closes_at`; deadline completion has `completed_at = closes_at`; early completion and cancellation occur at or after activation and strictly before the deadline.

Only `DRAFT -> ACTIVE`, `ACTIVE -> COMPLETED`, and `ACTIVE -> CANCELLED` are legal. A transition operation records the actor, processing time, effective time, and reason in the audit event. This distinguishes delayed automatic processing from the effective deadline without an extra lifecycle history table.

### 3.6 `offices`

| Column | Type | Keys / rules |
|---|---|---|
| `id` | `uuid` | PK. |
| `vote_id` | `uuid` | FK to `votes.id`; parent must be CLOSED. |
| `name` | `text` | Non-empty office name. |
| `position` | `integer` | Positive display order; unique within vote. |

Add unique `(vote_id, id)` for composite references. Reject duplicate normalized office names within a vote through the protected draft editor/activation validation. OPEN votes have no offices.

### 3.7 `candidates`

| Column | Type | Keys / rules |
|---|---|---|
| `id` | `uuid` | PK. |
| `office_id` | `uuid` | FK to `offices.id`. |
| `name` | `text` | Non-empty candidate display name. |
| `position` | `integer` | Positive display order; unique within office. |

Add unique `(office_id, id)` for composite references. Candidates are ballot labels, not account references: candidacy does not require a login or confer eligibility. Reject indistinguishable normalized names within one office; administrators must disambiguate labels where necessary. Abstention is a built-in choice, not a fake candidate/account.

### 3.8 `poll_options`

| Column | Type | Keys / rules |
|---|---|---|
| `id` | `uuid` | PK. |
| `vote_id` | `uuid` | FK to `votes.id`; parent must be OPEN. |
| `label` | `text` | Non-empty option label. |
| `position` | `integer` | Positive display order; unique within vote. |

Add unique `(vote_id, id)` for composite references. Activation requires at least two distinct normalized labels. CLOSED votes have no poll options.

### 3.9 `electorate`

This table holds the administrator-selected household set while drafting and the frozen entitlement set after activation; a second draft-electorate table is unnecessary.

| Column | Type | Keys / rules |
|---|---|---|
| `vote_id` | `uuid` | PK component; FK to `votes.id`. |
| `household_id` | `uuid` | PK component; FK to `households.id`. |
| `representative_profile_id` | `uuid`, nullable | FK to `profiles.id`; populated at activation. |
| `representative_name_snapshot` | `text`, nullable | Populated from the register at activation. |
| `household_identifier_snapshot` | `text`, nullable | Household display label at activation. |

PK `(vote_id, household_id)` prevents duplicate household entitlements. Unique `(vote_id, representative_profile_id)` prevents multiple entitlements per representative in the same vote; draft nulls are allowed.

Activation requires a non-empty selected electorate; every selected household must currently be eligible with an enabled representative. Re-read and lock selected households/profiles consistently during activation so concurrent register changes cannot produce a mixed snapshot. Either a register edit precedes the snapshot or follows it.

All snapshot fields are null in drafts and non-null after activation, enforced by protected operations and parent-aware database guards. After activation, no electorate insert/update/delete is permitted except coherent approved retention deletion. Later suspension blocks access without deleting the entitlement or changing the turnout denominator.

### 3.10 `participation`

| Column | Type | Keys / rules |
|---|---|---|
| `vote_id` | `uuid` | PK component. |
| `household_id` | `uuid` | PK component. |
| `accepted_at` | `timestamptz` | Database acceptance time captured after admission checks. |

PK `(vote_id, household_id)` is also a composite FK to `electorate(vote_id, household_id)`. It is the authoritative exactly-once record and uncertainty-recovery lookup. No selected option, candidate, ballot identifier, request identifier, IP address, or session identifier is stored here.

Participation timestamps must never appear with CLOSED choice data. Administrators may monitor participation; members may query their own status. CLOSED result/export projections exclude household and participation lists.

### 3.11 `open_responses`

| Column | Type | Keys / rules |
|---|---|---|
| `vote_id` | `uuid` | PK component; vote must be OPEN. |
| `household_id` | `uuid` | PK component. |
| `option_id` | `uuid` | Required selected option. |

PK `(vote_id, household_id)` is a composite FK to `participation(vote_id, household_id)`. Composite FK `(vote_id, option_id)` references `poll_options(vote_id, id)`, preventing cross-vote choices.

Exactly one response accompanies every OPEN participation in the same transaction. Resolve respondent name/household from frozen electorate snapshots, not current profiles/register. Do not duplicate identity or submission timestamps in response rows. There are no editable responses or stored OPEN counters.

### 3.12 `closed_tallies`

| Column | Type | Keys / rules |
|---|---|---|
| `id` | `uuid` | PK; static counter identifier, never a ballot identifier. |
| `vote_id` | `uuid` | Parent vote; must be CLOSED. |
| `office_id` | `uuid` | Owning office. |
| `candidate_id` | `uuid`, nullable | Null denotes this office's explicit abstention counter. |
| `accepted_count` | `bigint` | Default 0; `CHECK (accepted_count >= 0)`. |

Composite FK `(vote_id, office_id)` references `offices(vote_id, id)`. Composite FK `(office_id, candidate_id)` references `candidates(office_id, id)` when candidate is non-null.

Create a unique partial index on `(office_id, candidate_id)` where candidate is non-null and a unique partial index on `(office_id)` where candidate is null. This produces one counter per candidate and exactly one abstention counter per office once activation initializes the full set.

Counters contain **no** account/household reference, shared ballot ID, response row, creation/update timestamp, actor, session, or per-update history. Initialize all counters to zero atomically at activation, then allow increments only through the submission routine. Counter IDs remain unchanged across submissions. No direct runtime reads or writes are allowed.

### 3.13 `audit_events`

| Column | Type | Keys / rules |
|---|---|---|
| `id` | `bigint GENERATED ALWAYS AS IDENTITY` | PK; append order, not a ballot identifier. |
| `actor_profile_id` | `uuid`, nullable | FK to `profiles.id`; null only for an identified system/deployment actor. |
| `actor_kind` | `text` | `PROFILE`, `SYSTEM`, or `DEPLOYMENT`; profile actor requires profile FK. |
| `action` | `text` | Allowlisted administrative action. |
| `target_type` | `text` | Allowlisted record category, including `VOTE`, `HOUSEHOLD`, `PROFILE`, `SETTINGS`, or `RETENTION`. |
| `target_id` | `text` | Stable affected record identifier; intentionally not a polymorphic FK. |
| `occurred_at` | `timestamptz` | Actual processing time. |
| `reason` | `text`, nullable | Required for cancellation and early completion; bounded and checked for inappropriate sensitive input. |
| `details` | `jsonb` | Default empty object; action-specific allowlisted metadata only. |

Actions cover controlled administrator bootstrap, register changes, role/status changes, draft edits, activation, completion, cancellation, policy changes, and retention deletion. Details may include revision, changed field names, effective lifecycle time, and approved policy version. Do not copy full records, emails, authentication material, or ballot payloads into JSON.

Application-database administrative mutation and audit insertion commit together; Auth administrative calls require the retry-safe cross-service workflow described below. Do not emit per-voter CLOSED submission audit events or counter deltas. Audit targets intentionally survive target deletion; events remain until their separate approved expiry. Profile FK restrictions may delay profile/Auth identity hard deletion until audit expiry.

### 3.14 `rate_limit_buckets`

| Column | Type | Keys / rules |
|---|---|---|
| `scope` | `text` | PK component; allowlisted endpoint/purpose and subject dimension. |
| `subject_digest` | `bytea` | PK component; 32-byte keyed HMAC of normalized email, trusted client IP, or authenticated profile identifier. |
| `digest_key_version` | `smallint` | PK component; positive rate-limit key version. |
| `window_start` | `timestamptz` | PK component; fixed-window start. |
| `expires_at` | `timestamptz` | End of enforcement window; greater than start. |
| `request_count` | `bigint` | Positive atomic counter. |

PK `(scope, subject_digest, digest_key_version, window_start)`. Use shared application counters only for limits needed beyond Supabase Auth controls, such as server endpoint/export limits and additional code-request abuse protection. Increment/check applicable buckets atomically before accepting an operation. Rate-limit failures must persist their counters independently of rejected domain transactions.

Use a dedicated secret-manager HMAC key for rate-limit subjects, not Auth signing material. Do not store raw IP addresses or raw unregistered emails. Key rotation must preserve enforcement for existing windows, not reset abuse budgets. Exact endpoint thresholds are controlled operational configuration validated during the pilot. Follow Supabase's supported trusted-IP forwarding setup for proxied Auth calls; never trust arbitrary forwarded headers. These counters do not replace Auth's own limits and must not be directly writable through the public API.

## 4. Relationships and ER diagram

```mermaid
erDiagram
    AUTH_USERS ||--o| PROFILES : managed_identity
    PROFILES ||--o| HOUSEHOLDS : currently_represents
    PROFILES ||--o{ VOTES : creates
    PROFILES o|--o{ AUDIT_EVENTS : acts
    VOTES ||--o{ OFFICES : closed_configuration
    OFFICES ||--o{ CANDIDATES : offers
    VOTES ||--o{ POLL_OPTIONS : open_configuration
    VOTES ||--o{ ELECTORATE : selects_then_freezes
    HOUSEHOLDS ||--o{ ELECTORATE : receives_entitlement
    PROFILES o|--o{ ELECTORATE : frozen_representative
    ELECTORATE ||--o| PARTICIPATION : submits_once
    PARTICIPATION ||--o| OPEN_RESPONSES : open_only
    POLL_OPTIONS ||--o{ OPEN_RESPONSES : selected_option
    VOTES ||--o{ CLOSED_TALLIES : closed_aggregates
    OFFICES ||--o{ CLOSED_TALLIES : counted_per_office
    CANDIDATES o|--o{ CLOSED_TALLIES : candidate_or_abstention
```

`rwa_settings` is a singleton, not a tenant parent. `rate_limit_buckets` has no identifying foreign keys. The ER diagram shows structural optionality, including incomplete drafts; activation enforces required office/candidate/option/electorate cardinalities. For CLOSED elections, each candidate has exactly one initialized counter and each office also has one null-candidate abstention counter. There is deliberately no edge from participation to CLOSED choices.

## 5. Integrity, validation, and transaction boundaries

### Database enforcement

Use primary/unique/foreign keys and local `CHECK` constraints for row-local rules. PostgreSQL `CHECK` constraints do not enforce cross-table or aggregate rules: use protected routines and database triggers for parent type/state, freezing, lifecycle transitions, and aggregate consistency. Parent-aware write guards acquire the parent vote lock before checking state, including draft edits.

Use deferred constraint triggers to verify submission consistency at transaction end:

- OPEN participation count equals response count, with one response per participating entitlement and no CLOSED responses.
- For each CLOSED office, sum of candidate counters plus abstention equals participation count.
- CLOSED counter membership exactly matches the frozen candidate set plus one abstention per office; OPEN votes have no closed counters.

Limit checks to affected votes, and validate again at completion/read publication. All mutation paths use the parent lock so checks cannot race another writer. Constraint failures roll back the whole operation; they must not be converted into success or silent repairs.

### Draft editing and activation

1. Authenticate an enabled current administrator; lock the vote.
2. Require `DRAFT` and the previewed `draft_revision`; reject stale edits/activation.
3. Validate type-specific configuration, normalized distinct labels, deadline, and selected eligible households.
4. Lock/re-read selected register rows and settings in a documented consistent order shared with register/policy operations.
5. Require approved A1-A7 decisions and retention settings.
6. Snapshot representatives, labels, RWA name/timezone, and approved policy versions; initialize CLOSED counters.
7. Recheck the future deadline using the database clock and atomically set `ACTIVE`, activation time, and audit event.

Draft edits, including voting-type changes, are allowed only while no submission can exist. A type change removes incompatible draft children atomically; activation rejects mixed ballot shapes. Non-draft configuration and snapshots cannot be updated even by ordinary administrative database operations.

### Submission

1. In `cast_vote`, require non-null `auth.uid()` from the verified JWT context; lock the vote, then the caller's profile, and recheck enabled status and frozen entitlement. Profile locking serializes admission against suspension/deletion. Do not lock or modify Supabase-managed session tables.
2. Reconcile overdue lifecycle state. Require `ACTIVE` and database time strictly before `closes_at` after acquiring locks.
3. Resolve the household from the frozen electorate and authenticated profile, not client-provided identity.
4. Reject existing participation. For CLOSED, validate exactly one candidate or explicit abstention for every office, no omissions, repeated offices, foreign candidates, or extra fields. For OPEN, validate exactly one owned option.
5. Insert participation and either one OPEN response or all CLOSED counter increments in the same transaction. Lock offices/counters in stable ID order.
6. Commit durably before returning a participation-only acknowledgement.

Per-vote serialization is intentional at the stated scale. Unique participation remains the last defense against retries and concurrent sessions. No email, rendering, network call, or report generation occurs inside this transaction.

Check `clock_timestamp()` after acquiring all admission locks, immediately before accepting participation and choices. Client click time or HTTP arrival does not reserve acceptance. A transaction admitted strictly before the deadline may commit afterwards; one that waits past the cutoff is rejected.

If overdue reconciliation completes a vote while rejecting submission, commit reconciliation before returning the domain rejection; do not throw an exception that rolls the transition back. A database/invariant failure must instead roll back and surface an error.

Use `synchronous_commit = on` for accepted submissions and verify managed-service durability/failover guarantees. This does not by itself promise zero-data-loss regional recovery.

### Completion, cancellation, and results

- Supabase Cron invokes restricted, idempotent SQL maintenance initially once per minute. Authorized service reads/submission handling may invoke narrowly scoped overdue reconciliation; plain download responses perform no unrelated mutations. Deadline enforcement does not depend on Cron availability, and database pausing prevents Cron execution.
- All transitions take the same vote-row lock. Deadline completion is idempotent and uses the deadline as effective completion time.
- Early completion/cancellation require administrator confirmation and a reason. Reconcile overdue status first; cancellation cannot override a due completion. Include the early-completion label and reason in the shared screen/export projection.
- Before marking completed, verify participation/response/tally invariants. On mismatch, block completion/publication/exports and alert operators without exposing choices; submissions remain blocked by the deadline.
- Publish only `COMPLETED` results to enabled administrators or frozen eligible representatives. `ACTIVE` and `CANCELLED` choices remain inaccessible.
- Read a single completion-gated RPC projection for the page and CSV, plus PDF when implemented. Obtain multi-part data in one consistent database snapshot inside that RPC, not separate Supabase requests assumed to share a transaction; materialize the authorized projection before rendering outside the transaction.
- Eligible denominator is frozen electorate size, including suspended representatives. Submitted denominator is participation count. OPEN totals are grouped responses; CLOSED totals are protected counters.
- Election percentages use submitted ballots, including abstentions. Equally highest positive candidate or poll-option totals are labelled "Tie" without selecting a winner. Zero ballots have no winner; apply the proposed all-abstain "No candidate elected" outcome only after A5 approval. Zero denominators display not applicable/no-votes rather than invalid arithmetic.
- Do not persist turnout, rounded percentages, leaders, PDF generation time, or export files. Compute them deterministically from immutable completed data and the report generation clock.

## 6. Query-driven indexes

Primary keys and unique constraints create their own B-tree indexes. Avoid duplicates of those indexes.

| Query / enforcement | Index |
|---|---|
| Authentication identity / profile lookup | Supabase manages Auth email lookup/indexes; `profiles(id)` PK serves `auth.uid()` lookups. Do not add application email indexes or modify managed Auth indexes. |
| Register lookup / duplicate household rejection | Unique `households(identifier_normalized)`. |
| Current representative lookup / ambiguity prevention | Unique `households(representative_profile_id)`. |
| Own vote list and frozen entitlement authorization | Unique `electorate(vote_id, representative_profile_id)` plus `electorate(representative_profile_id, vote_id)` for profile-first lookup and policy checks. |
| Household history / FK checks | `electorate(household_id, vote_id)`; PK already serves vote-first reads. |
| Member submission status and turnout | `participation` composite PK `(vote_id, household_id)`; no extra status index. |
| Ballot ordering | Unique `offices(vote_id, position)`, `candidates(office_id, position)`, `poll_options(vote_id, position)`. |
| Composite ownership FKs | Unique `offices(vote_id, id)`, `candidates(office_id, id)`, `poll_options(vote_id, id)`. |
| OPEN option totals and complete named-response joins | `open_responses(vote_id, option_id, household_id)`; PK serves electorate/participation joins. |
| CLOSED counter lookup / ownership | Two partial unique indexes described above, plus `closed_tallies(vote_id, office_id)` for complete protected tally reads and parent FK access. |
| Administrator vote list with stable cursor | `votes(created_at DESC, id DESC)`; filter small status/type sets without speculative extra indexes. |
| Creator FK and profile cleanup | `votes(created_by_profile_id)`. |
| Due-vote scheduler | Partial `votes(closes_at, id)` where status is `ACTIVE`. |
| Audit history, newest first | `audit_events(occurred_at DESC, id DESC)`. |
| Profile audit references / FK cleanup | `audit_events(actor_profile_id)`; omit a separate general target-history index until a target-filtered journey needs it. |
| Rate-limit lookup and cleanup | Composite PK and `rate_limit_buckets(expires_at)`. |

Named-response pages use stable household-ID keyset pagination over the vote-prefixed primary key and join snapshots/options; exports deliberately read all authorized respondents. Audit and administrator vote lists use timestamp-plus-ID cursors. Do not add fuzzy search, JSON GIN indexes, materialized views, partitions, or cached tally tables for this MVP.

Verify plans with `EXPLAIN (ANALYZE, BUFFERS)` on synthetic 500-household data and load-test 100 concurrent users, including contention on one vote. Require p95 page/API latency below two seconds and acknowledgement below three seconds, excluding email/network conditions.

## 7. Ownership, authorization, and row-level security

### Database roles and object ownership

| Role | Privileges |
|---|---|
| Deployment/migration role | Deployment-only DDL and reviewed migrations; unavailable to the application. |
| Protected routine owner | Non-login role owning required routines, with minimum underlying data privileges. No operator credentials exposed to users. |
| `anon` | No application-data access or execution of protected user/maintenance RPCs. Authentication uses the supported Auth endpoints. |
| `authenticated` | User JWT context; only required RLS-filtered safe reads and explicitly granted user RPCs. No direct protected writes, choice-table reads, DDL, grants, or schema creation. |
| Privileged provisioning client | Server-only Supabase administrative credentials for controlled Auth provisioning/administration; never used for ordinary ballots, results, or exports. Bypasses RLS where applicable, so isolate and audit it. |
| Maintenance role | Supabase Cron scheduling role with narrowly scoped completion/retention entry points; not callable by `anon` or `authenticated` and not dependent on an end-user JWT. |
| Infrastructure operator | Restricted, audited break-glass/provider access; outside application-user anonymity assurance A2. |

Revoke `PUBLIC` execution on application routines and unsafe schema creation privileges. Use narrowly scoped `SECURITY DEFINER` routines with fixed trusted `search_path`, schema-qualified objects, no dynamic SQL, explicit argument validation, and no unrestricted helper execution grants.

Protected user-callable entry points explicitly validate non-null `auth.uid()`, the matching current profile's enabled status/role, required capability, and frozen entitlement. Never accept an actor/household argument as proof of identity or trust user-editable JWT metadata for role. Server routes verify identity through supported Auth methods before calling with the user's session; SQL permissions must independently remain safe against direct Supabase API calls. Do not pass custom session digests into RPCs.

No runtime routine returns CLOSED counters except the completion-gated aggregate result routine. Submission routines may increment them but return participation status only. Runtime cannot update/delete audit events; append occurs only inside approved administrative operations. Retention deletion is a separate restricted operation, not an audit-edit capability.

**Implementation notes (migrations `20261024100000`-`20261024100400`).**
- The protected routine owner is the non-login role `cp_owner`; it owns every application table and routine and has no privileges in the Supabase `auth` schema. `profiles` is created by the migration role (which holds `REFERENCES` on `auth.users`) and then transferred to `cp_owner`.
- Routines read the caller from the verified JWT claims through `app_private.current_uid()` (the same source as `auth.uid()`) so `cp_owner` never needs access to the managed `auth` schema. The validation requirement is unchanged: non-null identity, current enabled profile, role, entitlement.
- Submission and activation routines mark their transaction with the settings `cp.submission` / `cp.activation`. Triggers reject participation, response and counter writes without them. These are guards against ad hoc writes, not authorization.
- Protected routines raise an exception whose message is a stable code (`VOTE_FROZEN`, `FORBIDDEN`, `ACTIVATION_BLOCKED`, ...; SQLSTATE `P0001`). `src/server/db/errors.ts` maps allowlisted codes to API errors and never forwards database text.
- Server-only routines (`provision_profile`, `enable_profile`, `consume_rate_limit`) are executable by `service_role` alone and re-check the `service_role` claim. Deployment procedures live in `app_private` and are not exposed through the Data API (see `supabase/README.md`).

**Draft routines (migration `20261024120000`).** `create_draft`, `get_admin_vote`, `update_draft`, `preview_draft` and `get_rwa_display` are `SECURITY DEFINER`, executable by `authenticated` only, and re-derive the caller from the JWT (current enabled administrator; `get_rwa_display` needs any enabled member).
- `update_draft` locks the parent vote first, rejects non-drafts with `VOTE_FROZEN`, then checks the expected revision (`STALE_REVISION`). It validates every field itself (the database, not the web tier, is the authority), applies the change and its audit event in one transaction, and increments `draft_revision` exactly once. An empty change set is not an edit: no revision change, no audit event.
- A supplied collection replaces the whole collection. Supplied child ids must already belong to this draft and, for candidates, to the same office; new children get server-generated ids. Normalised names/labels and positions must be distinct within their scope. A type change deletes the other shape's children in the same transaction; offices on an OPEN draft (or options on a CLOSED one) are rejected, never reinterpreted.
- The three `position` uniqueness constraints are `DEFERRABLE INITIALLY IMMEDIATE`, so reordering or swapping positions inside one atomic replace works. The routines defer them only for the duration of the replace and verify them again before returning.
- Newly selected households must be eligible when added; a household that was already selected and later becomes ineligible may stay (preview flags it) so the administrator can see and fix the change. Draft electorate rows carry no representative snapshot; activation writes them.
- `preview_draft` takes a share lock, requires the exact revision, never changes data, and returns readiness plus safe blocker codes/messages. It mirrors the structural activation guard and adds the register and settings checks that activation will re-read under lock; it is advice, not a guarantee.
- `get_rwa_display` returns only the RWA name and time zone (never approvals or retention), because `rwa_settings` stays unreadable to every API role.

**Lifecycle routines (migrations `20261024130000`, `20261024130100`).** `activate_vote`, `complete_vote_early` and `cancel_vote` are administrator-session routines (current enabled administrator, explicit `confirmed`); `complete_due_votes` (Cron) and `reconcile_vote` (server-only) never accept a time, target list or batch size from a caller.
- **One lock order everywhere:** vote, then the selected households (by id), then their profiles (by id), then settings. Activation takes the register and settings under lock, re-runs the readiness checks, writes the frozen representative/household snapshot, initialises one zero counter per candidate plus one abstention counter per office, freezes the RWA name, time zone and A1-A7 versions, and sets `ACTIVE` with its audit event in one transaction. A register or settings change waits for an in-flight activation, so a snapshot cannot tear.
- **Deadlines belong to the database clock.** `complete_if_due` completes a vote whose deadline has passed, verifies the invariants first (a mismatch blocks completion and is logged, never exposing choices), and records the **deadline** as the completion time; the processing time is audit context only. `complete_due_votes` handles up to 50 due votes per run, each in its own subtransaction, so one failure never undoes the others and the result reports `{completed, blocked}`.
- **Overdue actions.** Early completion or cancellation of a vote whose deadline has passed completes it at the deadline and *commits* that, then returns `{applied: false, reason: "DEADLINE_PASSED"}` (the API answers `409 LIFECYCLE_CONFLICT`). Raising instead would roll the reconciliation back. A repeat against a terminal vote raises `LIFECYCLE_CONFLICT` with the current state as DETAIL.
- **Cron.** Migration `20261024130000` creates the non-login `cp_scheduler` role (it can execute `public.complete_due_votes()` and nothing else: no table access, no other routine) and, where `pg_cron` exists, schedules `set role cp_scheduler; select public.complete_due_votes()` every minute under the name `civic-pulse-complete-due-votes`. Where `pg_cron` is absent (a bare local PostgreSQL) scheduling is skipped with a notice; the deadline is still enforced by the database clock on every request. Verified on a hosted Supabase project: the job exists, runs each minute, and completes a due vote with the deadline as its completion time.
**Retention, monitoring and the health ping (migration `20261024160000`).**
- `run_maintenance()` is executable only by the non-login `cp_scheduler` role (Cron job `civic-pulse-maintenance`, daily). No arguments, so no time, target or batch size can be supplied. It deletes, in bounded batches under the current approved settings (a null value skips that task): expired terminal votes (≤10 per run, each in its own transaction, responses/counters, participation, electorate, ballot, then the vote, with a `RETENTION_DELETED` audit carrying only kind, voting type and status), expired audit events (≤1000, one count-only trace), expired rate buckets (≤5000, never one still inside its window) and deleted profiles nothing refers to (≤50). A failing item rolls back alone and is reported.
- The guards stay closed: deleting vote data needs the transaction flag `cp.retention` **and** the row's vote to be terminal and past `vote_retention_days`, re-checked in each trigger (`retention_delete_allowed`); an audit row can leave only with `cp.audit_retention` and only if older than `audit_retention_days` (`guard_audit_delete`); updates stay forbidden.
- A deleted profile leaves an orphaned Auth identity (`profiles -> auth.users` is restrictive, so the profile goes first). Removal is `npm run ops -- auth-orphans --apply` through the Auth administration API, never direct table cleanup, and never for an identity under 24 hours old.
- `operational_status()` (service role only) returns counts, never identities or choices: active and overdue votes, invariant failures, policy readiness, and pending retention work. `health_ping()` backs the health route.
- `list_audit_events` additionally allows the detail keys `kind`, `count` and `status`.

- **Deferred triggers must be `SECURITY DEFINER`.** The invariant checks are deferred constraint triggers that fire at commit. PostgreSQL 18 runs a deferred trigger as the role that queued it; PostgreSQL 17 (Supabase today) runs it as the role current at commit, i.e. the signed-in caller. A plain trigger function therefore passed on 18 and failed with "permission denied" on 17. `check_vote_invariants` and `check_vote_invariants_on_vote` are now `SECURITY DEFINER`, and a security test requires every deferred user trigger to be one.

**Submission routines (migration `20261024140000`).** `cast_vote(vote, submission)` and `get_my_participation(vote)` are member-session routines: identity comes only from the verified JWT and the household only from the frozen electorate.
- **Order of checks.** Shape (`confirmed: true`, only `optionId`/`selections`; identity, household, timestamp, count and idempotency fields are rejected) → entitlement read *without* locking (a caller outside the electorate, or naming a draft or unknown vote, gets `NOT_FOUND` and can never queue behind a vote's lock) → lock the vote, then the caller's profile (`FOR SHARE`, so a concurrent suspension serialises with admission) and recheck `ENABLED` → overdue/terminal check → prior participation (`ALREADY_SUBMITTED`) → full type-specific validation against the frozen ballot → a **final `clock_timestamp()` check after every admission lock, immediately before acceptance** → insert participation plus one OPEN response, or increment every CLOSED counter in stable office-id order.
- **Deadline semantics.** A request that waited past the cutoff for a lock is refused even though it was sent earlier; a transaction admitted strictly before the cutoff may commit afterwards (and is counted, because completion waits for the vote lock). An overdue vote is completed at its deadline and that is **committed** while the routine returns `{accepted: false, reason: "VOTING_CLOSED"}` rather than raising, which would roll the reconciliation back.
- **Bounded and durable.** The routine sets `lock_timeout = 5s`, `statement_timeout = 15s` and `synchronous_commit = on` for its transaction. A lock or statement timeout (`55P03`, `57014`) maps to `503 DEPENDENCY_UNAVAILABLE`, a retryable error that is never presented as a rejection; an uncertain outcome is resolved through `get_my_participation`.
- **Privacy.** The return value is participation only. There is no audit event, receipt, per-ballot CLOSED record, or timestamp joinable to a counter (`closed_tallies` has only aggregate columns; a test pins the column lists of `closed_tallies` and `participation`).
- **Cross-vote guard defects fixed here.** The Phase 4 structural activation guard (`assert_structurally_activatable`) and the Phase 9 `draft_blockers` inspected the offices and counters of *every* vote, so one CLOSED vote with a non-zero counter, or any other draft with an empty office, blocked the activation of every other CLOSED vote. This was invisible until ballots existed. Both are corrected, with a regression test.

**Member reads, results, monitoring and audit (migration `20261024150000`).** Five session routines, all `SECURITY DEFINER`, re-deriving identity from the JWT:
- `list_member_votes` / `get_member_vote` read only the caller's own frozen entitlement and own participation flag (an administrator outside the electorate may read a non-draft ballot but gets `entitled: false`). Listing order is active-by-deadline then finished-newest-first via a `(rank, key, id)` keyset.
- `get_vote_results` is the single source for the screen, API and CSV. It share-locks the vote (so retention cannot delete mid-read), requires `COMPLETED` (an active or cancelled vote never leaves the database, even as partial totals for an administrator), runs `verify_vote_invariants` and raises `RESULTS_INTEGRITY_ERROR` on a mismatch instead of repairing it, and counts the frozen electorate as the denominator (including households suspended later). OPEN named responses come from the frozen electorate snapshot, never the live register; CLOSED returns aggregates only. `p_limit` defaults to a bounded page; the export passes `null` for the complete list.
- `get_vote_participation` shows frozen name, household identifier and submitted flag only (never a choice or time) and refuses drafts. `list_audit_events` copies only allowlisted `details` keys.
- The security test's function allowlist lists all five. Choice storage (`open_responses`, `closed_tallies`) stays unreadable by every API role, administrators included.

### Application access

- Unauthenticated visitors cannot list members, votes, ballots, participation, or results.
- Enabled members access only votes whose frozen electorate names their profile; current reassignment does not transfer access to historical votes.
- Administrators manage register/drafts/lifecycle and inspect participation; their role does not permit voting for someone else.
- Completed OPEN named responses are available to the same authorized viewers as results. Never include registered email in result/export projections.
- Suspension/deletion overrides membership and administrative capability immediately. Every request, applicable RLS read, and protected database operation rechecks current profile state, even with a still-valid JWT.

### Row-level security decision

Enable RLS on **every application table**, including settings, profiles, audit, and rate-limit buckets. Start with revoked privileges/default-deny policies; RLS complements grants and guarded functions, not UI checks. Do not alter Supabase-managed Auth RLS or expose its tables.

| Table / surface | Authenticated direct-read policy | Mutation / protected access |
|---|---|---|
| `profiles` | Own enabled profile; enabled admins may read profiles needed for register administration. | Role, status, name, and assignments change only through guarded admin operations. Auth emails are obtained only through an authorized server-only register projection. |
| `households` | Enabled admin register access only; members obtain household labels through their authorized ballot/projection. | Guarded admin operations; representative uniqueness enforced. |
| `rwa_settings` | No direct client reads; public/ballot-safe metadata is projected without approval/retention administration details. | Guarded admin settings operation. |
| `votes` | Enabled admins may read all; enabled members only non-drafts with their own frozen entitlement. | Guarded draft/lifecycle operations; freeze guards apply independently. |
| `offices`, `candidates`, `poll_options` | Same parent-vote visibility as `votes`; no unrelated ballot discovery. | Guarded draft edits only. |
| `electorate` | Own frozen entitlement only for enabled members; enabled admins may inspect the electorate. | Guarded draft selection/activation, then frozen. |
| `participation` | Own entitlement's status only for enabled members; enabled admins may inspect participation without choices. | Submission RPC only; approved terminal retention is separate. |
| `open_responses`, `closed_tallies` | No direct read policies or client table grants, including for application admins. | Submission RPC writes; completed authorized result RPC reads. |
| `audit_events` | Enabled administrators only, with safe allowlisted fields. | Append within protected administrative operations; no user update/delete. |
| `rate_limit_buckets` | No client reads. | Server-only limiting operation and restricted cleanup; do not expose subject digests or allow callers to reset limits. |

RLS is row-based, not column redaction. Grant only safe columns where needed; otherwise return explicit RPC projections. Define enabled/admin and vote-visibility checks using narrowly scoped, non-recursive helper functions with trusted ownership/search paths; do not create circular `profiles`/`electorate`/`votes` policies. Helpers expose only necessary authorization decisions, never arbitrary records or choices.

`SECURITY DEFINER` owners may bypass RLS; therefore every exposed function must enforce its own identity, capability, type/state, and publication checks. Do not assume enabling RLS automatically constrains those owners or service credentials. Keep internal write/retention helpers non-executable by end users. Exclude private application tables from Realtime publications/change feeds, especially responses, participation, and counters.

Test anonymous/member/admin direct REST/RPC access, suspended profiles with existing JWTs, owner-bypass behavior, policy recursion, and function grants. Never weaken choice access by adding an "admin can read all tables" policy.

## 8. Sensitive data and privacy

- Names, household identifiers, registered emails, frozen identities, participation, and OPEN choices are restricted personal data. Minimize projections and access; do not collect additional resident attributes.
- Encrypt database connections, primary storage, replicas, WAL/backups, and provider exports. Keep encryption/HMAC keys in approved secret management, separate from database content and source control.
- Supabase Auth manages OTP/session material; do not copy it into application tables, audit events, logs, or exports. Keep administrative Auth credentials and rate-limit HMAC keys server-only.
- Disable request-body, SQL bind-parameter, cookie, email-content, and selection capture across the app, proxy, APM, error tracking, and database instrumentation. Operational logs contain allowlisted outcomes and safe support IDs only.
- Do not store CLOSED request payloads, per-response counter history, change feeds, ballot receipts, cross-office submission IDs, or tally snapshots. Do not allow administrators to sample active counters for differencing.
- CLOSED aggregate-only storage prevents ordinary stored identity-to-choice mappings but is not cryptographic anonymity. WAL/PITR, privileged instrumentation, backups at different instants, or a compromised process can correlate transactions/counter deltas. Low-turnout results can allow inference. Obtain A2 approval without promising stronger secrecy.
- On-demand CSV and optional PDF generation use the same authorization/projection as results; no public files, bearer download links, retained report copies, or emailed attachments. CLOSED reports exclude household/voter lists; OPEN reports include frozen name, household, and choice, not email. Exports are derived outcomes, never the authoritative database or a recovery substitute.
- Apply approved lifecycle-aware retention. Never remove participation while a vote can accept submissions. Do not delete identity snapshots independently of their still-required OPEN decision record.
- Downloaded/printed records cannot be remotely revoked or erased and are not signatures or legal certification.

## 9. Migration, provisioning, and seed strategy

1. Keep ordered, immutable SQL migrations under `supabase\migrations`. Use Supabase's supported migration history/tooling; do not add a parallel application migration ledger.
2. Apply using deployment-only credentials and a migration advisory lock. Use transactional migrations where PostgreSQL permits; separately stage operations such as concurrent index creation when required.
3. Create tables, constraints, indexes, guards, RLS policies, protected routines, and grants together. Default-deny access until all required entry points exist. Never run migrations automatically on every app start.
4. Test fresh installation and upgrade from the prior release with synthetic data on real Supabase/PostgreSQL. Verify Auth-linked profiles, RLS/direct API denial, function ownership/search paths, revoked public privileges, constraints, freezing, and existing result invariants.
5. Prefer backward-compatible expand/contract changes. Schedule incompatible changes in maintenance mode, preferably with no active votes. Never change submission/counting semantics during active voting.
6. Do not use an old database restore as deployment rollback after accepted submissions. Roll back only a schema-compatible application, or apply a reviewed forward fix.

If existing real accounts/votes exist, explicitly map legacy identities to Auth-linked profiles and preserve every historical reference before cutover. Do not drop old identity data or copy old custom-auth migrations unchanged. Reconcile foreign keys, RLS, functions, and result invariants in staging; cut over outside active votes. Documented target changes do not imply any existing implementation has already migrated.

### Production provisioning

- Insert the singleton settings row with the approved RWA name/timezone. Leave unapproved policies/retention explicitly unset; do not seed fictional approvals.
- Provision the first Auth identity and enabled administrator profile against an approved registered address through a controlled deployment operation, audit it, and require normal OTP authentication.
- Import the approved household register through validated administrative operations, rejecting duplicate normalized households/emails and ambiguous assignments. No public registration or default credentials.
- Record real approvals and configure matching provider retention before enabling activation.
- Do not seed demo votes, synthetic participation, candidate counts, real OTPs, or active sessions into production.

Use server-only privileged Auth credentials solely for provisioning/administrative Auth calls. Public signup remains disabled. Provisioning is retry-safe: create or identify the approved Auth user, then create/validate the profile and household assignment and append the application audit event in a database transaction. New profiles default to `SUSPENDED` during setup; enable them only after the intended assignment is valid (an administrator may intentionally have no household). An Auth user without a valid enabled profile has no application access. If a step fails, surface the partial state for controlled retry/cleanup; do not acknowledge completed provisioning or delete a pre-existing identity as a blind rollback.

### Local/test/staging fixtures

Use synthetic identities and a local mail sink or approved staging recipients only. Cover both voting types, incomplete drafts, activated frozen electorates, suspension/reassignment, zero turnout, all abstentions, ties, cancellation, and long/multiscript report content. Construct accepted fixture submissions through the same protected submission path. Use separate databases/credentials per environment; never copy production registers or backups into development.

## 10. Retention, backup, and recovery

### Retention execution

- Run bounded, repeatable maintenance batches using approved current policy. Require explicit settings, not null-as-infinite defaults.
- Delete expired terminal vote data as one transaction: OPEN responses or CLOSED counters, participation, electorate, candidate/office/option configuration, then the vote. Lock/revalidate terminal state first and write a minimal deletion audit event atomically.
- Keep audit evidence for its independently approved period; historical target identifiers intentionally remain without a target FK.
- Hard-delete an inactive profile only after its retention period and all electorate, vote-creator, household, and audit references permit removal. Prefer suspension/soft deletion until then; do not cascade historical evidence away. Coordinate later Auth identity removal through supported administration with explicit partial-failure recovery; `profiles -> auth.users` remains restrictive.
- Expire application rate buckets in bounded batches without resetting live abuse windows. Use supported Supabase Auth lifecycle/retention controls, not direct cleanup of managed session/OTP tables.
- Expire backups and WAL according to the approved backup policy. Deletion from primary storage does not imply immediate erasure from retained backups.

Maintain a restricted recovery record of deletions, suspensions, and revocations after each available restore point. This may use privacy-minimized administrative audit records exported into an approved encrypted operational recovery store; it must not contain ballots or secrets and is not a new resident-facing service. Its completeness, access, and expiry must be part of the approved runbook. Do not assume records in the restored database itself include later actions.

### Backups and recovery objectives

- Maintain automated encrypted off-site backups with restricted restore/export credentials and approved expiry. Supabase Free does not include automatic backups or PITR under the architecture's planning assumptions: arrange an external scheduled export and approved off-site storage. Supabase Cron alone is not an off-site backup. Validate actual quotas, costs, pausing, and provider capabilities before launch; approve a paid tier if required rather than weaken recovery.
- Enable provider-managed backups/WAL/PITR where available and approved. Daily backups or a paid tier alone do not prove completeness of acknowledged submissions.
- Agree and document RPO/RTO, backup cadence, restore window, geographic placement, replication/failover durability, and alerting in the operational runbook. No numerical recovery promise is inferred from this schema.
- Back up application data/schema, routines, RLS policies, grants, migration history, settings, and required Auth identities through a supported tested process. Do not assume a default database dump includes all Auth objects or external Auth/SMTP/Cron configuration. Capture necessary configuration securely and manage secret/key-version recovery separately in secret management.
- Restore initially into isolated maintenance-only infrastructure. Do not expose restored email jobs, sessions, ballots, or exports to users.
- Validate migration version, Auth-to-profile references, RLS/grants/direct API denial, Cron configuration, unique entitlements/participation, OPEN response ownership/counts, CLOSED office totals, frozen snapshots, and lifecycle timestamps.
- Reapply later deletion/suspension/revocation records before access resumes. Apply supported Auth recovery/revocation procedures and verify existing-token scenarios; restored access must remain blocked by current profile state even if a JWT remains valid. Verify rate limits rather than restoring unsafe authentication access.
- A transactionally consistent backup may still omit acknowledged submissions. Prove accepted-data completeness before resuming an interrupted active vote. If completeness cannot be proven, remain in maintenance mode and follow the approved cancellation/replacement procedure.
- Reconcile elapsed deadlines using effective deadline timestamps; outages do not extend deadlines. Preserve cancelled-choice confidentiality throughout recovery.
- Test restoration before launch and repeat on an approved schedule and after material infrastructure changes. Recovery evidence must not disclose CLOSED selections.
- PDFs/CSVs cannot restore Auth identities, frozen entitlements, participation, counter integrity, or permissions and must never substitute for database recovery.

## 11. Required implementation verification

This document specifies the intended schema; no executable schema or test evidence exists until implementation.

Required real-Supabase/PostgreSQL integration and release checks:

- Duplicate normalized register entries and ambiguous representatives are rejected.
- Draft revision conflicts, mixed voting-type configuration, invalid activation, and all post-activation configuration/electorate edits are rejected.
- A selected candidate/option cannot belong to a different office/vote.
- Concurrent submissions, retries, multiple sessions, and lost HTTP acknowledgements produce exactly one durable participation.
- Injected failure after participation and midway through CLOSED counter updates leaves no partial submission.
- Exact-deadline and lock-wait-past-deadline submissions are rejected; a transaction admitted before the cutoff may commit afterwards. Completion/cancellation races preserve invariants.
- Suspension/reassignment cannot transfer an existing entitlement or rewrite historical OPEN identities.
- Administrators without their own entitlement cannot cast; cross-profile/object access, disallowed direct table access, active/cancelled choices, and unauthorized exports are denied. Exercise anonymous/member/admin direct Supabase REST/RPC calls as well as Next.js routes.
- Six-digit OTP expiry/single use, configured Auth limits, generic acknowledgements, disabled signup, provisioning partial failure/retry, supported session refresh/sign-out, and shared application limits are verified.
- Existing JWTs cannot bypass suspension, changed role, or entitlement checks; normal user requests never use service-role credentials.
- Completed page/CSV projections agree exactly on counts, identities, abstentions, candidate/option ties, approved all-abstain outcomes, early-completion labels/reasons, denominators, and no-votes states. Apply equivalent projection, multi-page/A4/grayscale/script coverage and failure checks to PDF only if implemented.
- CLOSED ordinary records, APIs, reports, logs, and operational tooling reveal no individual choices or active tally snapshots.
- Query/load thresholds and backup restoration/completeness checks pass at the approved launch capacity.

Any lost/duplicate participation, partial submission, incorrect tally, unauthorized disclosure, or CLOSED identity-to-choice exposure blocks release.
