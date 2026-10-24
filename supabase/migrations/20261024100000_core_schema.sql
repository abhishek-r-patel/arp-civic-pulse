-- Civic Pulse core schema (docs/DATABASE.md sections 2-6).
--
-- All application objects are owned by the non-login role cp_owner, which holds
-- no privileges outside application objects. Application roles (anon,
-- authenticated) receive nothing here; access is granted explicitly in the
-- security migration. Supabase-managed schemas (auth) are not modified.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'cp_owner') then
    create role cp_owner nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
  end if;
end
$$;

grant cp_owner to current_user with inherit true, set true;

create schema if not exists app_private authorization cp_owner;
revoke all on schema app_private from public;
grant usage, create on schema public to cp_owner;

-- Routines are never executable by PUBLIC unless a later migration grants it.
alter default privileges for role cp_owner revoke execute on functions from public;

-- profiles is the only table that references Supabase-managed auth.users. It is
-- created by the migration role, which already holds REFERENCES on auth.users
-- (no privileges in auth are granted to cp_owner), then handed to cp_owner.
-- Referential checks run with the privileges of auth.users' owner.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete restrict on update restrict,
  representative_name text not null
    check (representative_name = btrim(representative_name)
           and char_length(representative_name) between 1 and 200
           and representative_name !~ '[\x00-\x1f\x7f-\x9f]'
           and representative_name !~* '</?[a-z!][^>]*>'),
  status text not null default 'SUSPENDED'
    check (status in ('ENABLED', 'SUSPENDED', 'DELETED')),
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check ((status = 'DELETED') = (deleted_at is not null))
);
alter table public.profiles owner to cp_owner;

set local role cp_owner;

-- ---------------------------------------------------------------------------
-- Helper functions used by constraints and routines
-- ---------------------------------------------------------------------------

-- Caller identity comes only from the JWT claims PostgREST sets from the
-- verified token for each request (the same source auth.uid() reads). It is
-- implemented here so application routines never need privileges in the
-- managed auth schema. Claims cannot be set through the Data API.
create function app_private.jwt_claims()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(
    nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb,
    '{}'::jsonb)
$$;

create function app_private.current_uid()
returns uuid
language sql
stable
set search_path = ''
as $$
  select nullif(
    coalesce(
      nullif(pg_catalog.current_setting('request.jwt.claim.sub', true), ''),
      nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'),
    '')::uuid
$$;

-- One versioned normalization policy for household keys: trim, Unicode NFKC,
-- collapse whitespace, case-fold.
create function app_private.normalize_key(value text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select pg_catalog.lower(
    pg_catalog.regexp_replace(
      normalize(pg_catalog.btrim(value), nfkc), '\s+', ' ', 'g'
    )
  )
$$;

create function app_private.is_valid_timezone(value text)
returns boolean
language sql
stable
strict
set search_path = ''
as $$
  select exists (select 1 from pg_catalog.pg_timezone_names where name = value)
$$;

-- ---------------------------------------------------------------------------
-- rwa_settings (singleton)
-- ---------------------------------------------------------------------------

create table public.rwa_settings (
  id smallint primary key check (id = 1),
  name text not null
    check (name = btrim(name) and char_length(name) between 1 and 200
           and name !~ '[\x00-\x1f\x7f-\x9f]'),
  timezone text not null check (app_private.is_valid_timezone(timezone)),
  policy_approvals jsonb not null default '{}'::jsonb
    check (
      jsonb_typeof(policy_approvals) = 'object'
      and policy_approvals - array['A1','A2','A3','A4','A5','A6','A7'] = '{}'::jsonb
    ),
  vote_retention_days integer check (vote_retention_days > 0),
  audit_retention_days integer check (audit_retention_days > 0),
  inactive_profile_retention_days integer check (inactive_profile_retention_days > 0),
  rate_limit_retention_days integer check (rate_limit_retention_days > 0),
  backup_retention_days integer check (backup_retention_days > 0),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- households
-- ---------------------------------------------------------------------------

create table public.households (
  id uuid primary key default gen_random_uuid(),
  identifier text not null
    check (identifier = btrim(identifier) and char_length(identifier) between 1 and 100
           and identifier !~ '[\x00-\x1f\x7f-\x9f]'
           and identifier !~* '</?[a-z!][^>]*>'),
  identifier_normalized text not null unique
    check (identifier_normalized = app_private.normalize_key(identifier)),
  representative_profile_id uuid not null unique
    references public.profiles (id) on delete restrict on update restrict,
  is_eligible boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- votes and ballot configuration
-- ---------------------------------------------------------------------------

create table public.votes (
  id uuid primary key default gen_random_uuid(),
  voting_type text not null check (voting_type in ('OPEN', 'CLOSED')),
  status text not null default 'DRAFT'
    check (status in ('DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED')),
  title text not null default ''
    check (title = btrim(title) and char_length(title) <= 300
           and title !~ '[\x00-\x1f\x7f-\x9f]' and title !~* '</?[a-z!][^>]*>'),
  instructions text
    check (instructions is null
           or (instructions = btrim(instructions) and char_length(instructions) <= 10000
               and instructions !~ '[\x01-\x08\x0b-\x1f\x7f-\x9f]'
               and instructions !~* '</?[a-z!][^>]*>')),
  closes_at timestamptz,
  draft_revision integer not null default 1 check (draft_revision > 0),
  created_by_profile_id uuid not null
    references public.profiles (id) on delete restrict on update restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  activated_at timestamptz,
  completed_at timestamptz,
  completion_mode text check (completion_mode in ('DEADLINE', 'EARLY')),
  completion_reason text
    check (completion_reason is null
           or (completion_reason = btrim(completion_reason)
               and char_length(completion_reason) between 1 and 2000
               and completion_reason !~ '[\x01-\x08\x0b-\x1f\x7f-\x9f]')),
  cancelled_at timestamptz,
  cancellation_reason text
    check (cancellation_reason is null
           or (cancellation_reason = btrim(cancellation_reason)
               and char_length(cancellation_reason) between 1 and 2000
               and cancellation_reason !~ '[\x01-\x08\x0b-\x1f\x7f-\x9f]')),
  rwa_name_snapshot text
    check (rwa_name_snapshot is null or char_length(rwa_name_snapshot) between 1 and 200),
  timezone_snapshot text
    check (timezone_snapshot is null or app_private.is_valid_timezone(timezone_snapshot)),
  policy_versions_snapshot jsonb
    check (policy_versions_snapshot is null
           or (jsonb_typeof(policy_versions_snapshot) = 'object'
               and policy_versions_snapshot ?& array['A1','A2','A3','A4','A5','A6','A7'])),
  check (activated_at is null or closes_at is null or activated_at < closes_at),
  constraint votes_lifecycle_state check (
    (status = 'DRAFT'
      and activated_at is null and completed_at is null and completion_mode is null
      and completion_reason is null and cancelled_at is null and cancellation_reason is null
      and rwa_name_snapshot is null and timezone_snapshot is null
      and policy_versions_snapshot is null)
    or (status = 'ACTIVE'
      and activated_at is not null and closes_at is not null
      and rwa_name_snapshot is not null and timezone_snapshot is not null
      and policy_versions_snapshot is not null
      and completed_at is null and completion_mode is null and completion_reason is null
      and cancelled_at is null and cancellation_reason is null)
    or (status = 'COMPLETED'
      and activated_at is not null and closes_at is not null
      and rwa_name_snapshot is not null and timezone_snapshot is not null
      and policy_versions_snapshot is not null
      and completed_at is not null and completion_mode is not null
      and cancelled_at is null and cancellation_reason is null
      and ((completion_mode = 'DEADLINE'
              and completed_at = closes_at and completion_reason is null)
        or (completion_mode = 'EARLY'
              and completion_reason is not null
              and completed_at >= activated_at and completed_at < closes_at)))
    or (status = 'CANCELLED'
      and activated_at is not null and closes_at is not null
      and rwa_name_snapshot is not null and timezone_snapshot is not null
      and policy_versions_snapshot is not null
      and cancelled_at is not null and cancellation_reason is not null
      and cancelled_at >= activated_at and cancelled_at < closes_at
      and completed_at is null and completion_mode is null and completion_reason is null)
  )
);

create table public.offices (
  id uuid primary key default gen_random_uuid(),
  vote_id uuid not null references public.votes (id) on delete restrict on update restrict,
  name text not null
    check (name = btrim(name) and char_length(name) between 1 and 200
           and name !~ '[\x00-\x1f\x7f-\x9f]' and name !~* '</?[a-z!][^>]*>'),
  position integer not null check (position > 0),
  unique (vote_id, position),
  unique (vote_id, id)
);

create table public.candidates (
  id uuid primary key default gen_random_uuid(),
  office_id uuid not null references public.offices (id) on delete restrict on update restrict,
  name text not null
    check (name = btrim(name) and char_length(name) between 1 and 200
           and name !~ '[\x00-\x1f\x7f-\x9f]' and name !~* '</?[a-z!][^>]*>'),
  position integer not null check (position > 0),
  unique (office_id, position),
  unique (office_id, id)
);

create table public.poll_options (
  id uuid primary key default gen_random_uuid(),
  vote_id uuid not null references public.votes (id) on delete restrict on update restrict,
  label text not null
    check (label = btrim(label) and char_length(label) between 1 and 200
           and label !~ '[\x00-\x1f\x7f-\x9f]' and label !~* '</?[a-z!][^>]*>'),
  position integer not null check (position > 0),
  unique (vote_id, position),
  unique (vote_id, id)
);

-- ---------------------------------------------------------------------------
-- electorate, participation and choices
-- ---------------------------------------------------------------------------

create table public.electorate (
  vote_id uuid not null references public.votes (id) on delete restrict on update restrict,
  household_id uuid not null references public.households (id) on delete restrict on update restrict,
  representative_profile_id uuid
    references public.profiles (id) on delete restrict on update restrict,
  representative_name_snapshot text
    check (representative_name_snapshot is null
           or char_length(representative_name_snapshot) between 1 and 200),
  household_identifier_snapshot text
    check (household_identifier_snapshot is null
           or char_length(household_identifier_snapshot) between 1 and 100),
  primary key (vote_id, household_id),
  unique (vote_id, representative_profile_id),
  -- Snapshots are all null while drafting and all present once frozen.
  check ((representative_profile_id is null) = (representative_name_snapshot is null)
     and (representative_profile_id is null) = (household_identifier_snapshot is null))
);

-- Contains no choice, ballot, request, IP or session identifier.
create table public.participation (
  vote_id uuid not null,
  household_id uuid not null,
  accepted_at timestamptz not null default clock_timestamp(),
  primary key (vote_id, household_id),
  foreign key (vote_id, household_id)
    references public.electorate (vote_id, household_id) on delete restrict on update restrict
);

create table public.open_responses (
  vote_id uuid not null,
  household_id uuid not null,
  option_id uuid not null,
  primary key (vote_id, household_id),
  foreign key (vote_id, household_id)
    references public.participation (vote_id, household_id) on delete restrict on update restrict,
  foreign key (vote_id, option_id)
    references public.poll_options (vote_id, id) on delete restrict on update restrict
);

-- Aggregate counters only: no household, ballot, timestamp, actor or history.
create table public.closed_tallies (
  id uuid primary key default gen_random_uuid(),
  vote_id uuid not null,
  office_id uuid not null,
  candidate_id uuid,
  accepted_count bigint not null default 0 check (accepted_count >= 0),
  foreign key (vote_id, office_id)
    references public.offices (vote_id, id) on delete restrict on update restrict,
  foreign key (office_id, candidate_id)
    references public.candidates (office_id, id) on delete restrict on update restrict
);

create unique index closed_tallies_candidate_key
  on public.closed_tallies (office_id, candidate_id) where candidate_id is not null;
create unique index closed_tallies_abstention_key
  on public.closed_tallies (office_id) where candidate_id is null;
create index closed_tallies_vote_office_idx on public.closed_tallies (vote_id, office_id);

-- ---------------------------------------------------------------------------
-- audit and rate limiting
-- ---------------------------------------------------------------------------

create table public.audit_events (
  id bigint generated always as identity primary key,
  actor_profile_id uuid references public.profiles (id) on delete restrict on update restrict,
  actor_kind text not null check (actor_kind in ('PROFILE', 'SYSTEM', 'DEPLOYMENT')),
  action text not null check (action in (
    'BOOTSTRAP_ADMIN', 'SETTINGS_INITIALIZED', 'POLICY_APPROVAL_RECORDED',
    'RETENTION_UPDATED', 'PROFILE_PROVISIONED', 'PROFILE_UPDATED',
    'PROFILE_STATUS_CHANGED', 'PROFILE_ROLE_CHANGED', 'HOUSEHOLD_CREATED',
    'HOUSEHOLD_UPDATED', 'DRAFT_CREATED', 'DRAFT_UPDATED', 'VOTE_ACTIVATED',
    'VOTE_COMPLETED', 'VOTE_CANCELLED', 'RETENTION_DELETED')),
  target_type text not null
    check (target_type in ('VOTE', 'HOUSEHOLD', 'PROFILE', 'SETTINGS', 'RETENTION')),
  target_id text not null check (char_length(target_id) between 1 and 100),
  occurred_at timestamptz not null default clock_timestamp(),
  reason text
    check (reason is null
           or (reason = btrim(reason) and char_length(reason) between 1 and 2000
               and reason !~ '[\x01-\x08\x0b-\x1f\x7f-\x9f]')),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  check ((actor_kind = 'PROFILE' and actor_profile_id is not null)
      or (actor_kind in ('SYSTEM', 'DEPLOYMENT') and actor_profile_id is null)),
  check (action <> 'VOTE_CANCELLED' or reason is not null),
  check (action <> 'VOTE_COMPLETED'
      or coalesce(details ->> 'completionMode', '') <> 'EARLY'
      or reason is not null)
);

create table public.rate_limit_buckets (
  scope text not null check (scope ~ '^[a-z][a-z0-9_.:-]{0,63}$'),
  subject_digest bytea not null check (octet_length(subject_digest) = 32),
  digest_key_version smallint not null check (digest_key_version > 0),
  window_start timestamptz not null,
  expires_at timestamptz not null,
  request_count bigint not null check (request_count > 0),
  primary key (scope, subject_digest, digest_key_version, window_start),
  check (expires_at > window_start)
);

-- ---------------------------------------------------------------------------
-- Query-driven indexes (docs/DATABASE.md section 6); PK/unique indexes above.
-- ---------------------------------------------------------------------------

create index electorate_representative_vote_idx
  on public.electorate (representative_profile_id, vote_id);
create index electorate_household_vote_idx on public.electorate (household_id, vote_id);
create index open_responses_option_idx
  on public.open_responses (vote_id, option_id, household_id);
create index votes_created_idx on public.votes (created_at desc, id desc);
create index votes_creator_idx on public.votes (created_by_profile_id);
create index votes_due_idx on public.votes (closes_at, id) where status = 'ACTIVE';
create index audit_events_occurred_idx on public.audit_events (occurred_at desc, id desc);
create index audit_events_actor_idx on public.audit_events (actor_profile_id);
create index rate_limit_buckets_expiry_idx on public.rate_limit_buckets (expires_at);

reset role;
