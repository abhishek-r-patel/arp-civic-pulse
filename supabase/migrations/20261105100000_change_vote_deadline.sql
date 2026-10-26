-- Lets an administrator move the deadline of an ACTIVE vote, later (to extend
-- voting after a low turnout) or earlier. Every other frozen column stays
-- frozen, and a vote whose deadline has already passed is never reopened.
--
--   change_vote_deadline(vote, closesAt, confirmed, reason)
--     * current enabled administrator only;
--     * the vote must be ACTIVE and still before its current deadline. If that
--       deadline has passed, the vote is completed at it (committed) and the
--       caller gets {applied:false, reason:'DEADLINE_PASSED'}, like the
--       early-completion and cancellation routines;
--     * the new deadline must be at least five minutes after the database
--       clock (VALIDATION_FAILED / DEADLINE_TOO_SOON) and different from the
--       current one (VALIDATION_FAILED / DEADLINE_UNCHANGED). There is no upper
--       limit and no limit on how many times it is changed;
--     * the reason is required and recorded only in the audit history, as
--       VOTE_DEADLINE_CHANGED with the previous and new deadline.
--
-- The vote row lock serializes the change with submissions, Cron completion
-- and the other lifecycle routines; all of them read closes_at afresh, so
-- admission, countdowns and due completion follow the new deadline.

set local role cp_owner;

-- Same rules as before, except that closes_at of an ACTIVE vote may change
-- while the deadline routine has marked its own transaction.
create or replace function app_private.guard_vote_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id <> old.id then
    raise exception 'IMMUTABLE_IDENTITY' using errcode = 'P0001';
  end if;

  if old.status in ('COMPLETED', 'CANCELLED') then
    raise exception 'LIFECYCLE_CONFLICT' using errcode = 'P0001',
      detail = 'Terminal votes cannot change.';
  end if;

  if new.status <> old.status
     and not ((old.status = 'DRAFT' and new.status = 'ACTIVE')
           or (old.status = 'ACTIVE' and new.status in ('COMPLETED', 'CANCELLED'))) then
    raise exception 'LIFECYCLE_CONFLICT' using errcode = 'P0001',
      detail = 'That status transition is not allowed.';
  end if;

  if old.status = 'ACTIVE'
     and (new.voting_type is distinct from old.voting_type
       or new.title is distinct from old.title
       or new.instructions is distinct from old.instructions
       or (new.closes_at is distinct from old.closes_at
           and not (new.status = 'ACTIVE'
                    and new.closes_at is not null
                    and app_private.flag_is_on('cp.deadline_change')))
       or new.draft_revision is distinct from old.draft_revision
       or new.created_by_profile_id is distinct from old.created_by_profile_id
       or new.created_at is distinct from old.created_at
       or new.activated_at is distinct from old.activated_at
       or new.rwa_name_snapshot is distinct from old.rwa_name_snapshot
       or new.timezone_snapshot is distinct from old.timezone_snapshot
       or new.policy_versions_snapshot is distinct from old.policy_versions_snapshot) then
    raise exception 'VOTE_FROZEN' using errcode = 'P0001';
  end if;

  if old.status = 'DRAFT' then
    if new.created_by_profile_id is distinct from old.created_by_profile_id
       or new.created_at is distinct from old.created_at then
      raise exception 'IMMUTABLE_IDENTITY' using errcode = 'P0001';
    end if;
    -- Every draft edit advances the revision by exactly one; lifecycle changes may not.
    if new.status = 'DRAFT'
       and new.draft_revision not in (old.draft_revision, old.draft_revision + 1) then
      raise exception 'IMMUTABLE_RECORD' using errcode = 'P0001',
        detail = 'The draft revision can only advance by one.';
    end if;
    if new.status = 'ACTIVE' then
      if new.draft_revision is distinct from old.draft_revision
         or new.voting_type is distinct from old.voting_type then
        raise exception 'ACTIVATION_BLOCKED' using errcode = 'P0001',
          detail = 'Activation cannot change the draft.';
      end if;
      perform app_private.assert_structurally_activatable(new);
    end if;
  end if;

  new.updated_at := pg_catalog.now();
  return new;
end
$$;

alter table public.audit_events drop constraint audit_events_action_check;
alter table public.audit_events
  add constraint audit_events_action_check check (action in (
    'BOOTSTRAP_ADMIN', 'SETTINGS_INITIALIZED', 'POLICY_APPROVAL_RECORDED',
    'RETENTION_UPDATED', 'RWA_IDENTIFIER_LABEL_UPDATED', 'RWA_PROFILE_UPDATED',
    'PROFILE_PROVISIONED', 'PROFILE_UPDATED', 'PROFILE_STATUS_CHANGED',
    'PROFILE_ROLE_CHANGED', 'HOUSEHOLD_CREATED', 'HOUSEHOLD_UPDATED',
    'DRAFT_CREATED', 'DRAFT_UPDATED', 'VOTE_ACTIVATED', 'VOTE_COMPLETED',
    'VOTE_CANCELLED', 'VOTE_DEADLINE_CHANGED', 'RETENTION_DELETED'
  ));

create function public.change_vote_deadline(
  p_vote_id uuid,
  p_closes_at timestamptz,
  p_confirmed boolean,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_enabled_admin();
  v_reason text;
  v public.votes;
  v_previous timestamptz;
  v_now timestamptz;
begin
  if p_confirmed is distinct from true or p_closes_at is null
     or p_closes_at in ('infinity'::timestamptz, '-infinity'::timestamptz) then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;
  v_reason := app_private.clean_multiline(p_reason, 2000);

  v := app_private.lock_vote(p_vote_id);
  v_now := pg_catalog.clock_timestamp();

  if v.status = 'ACTIVE' and v.closes_at <= v_now then
    perform app_private.complete_if_due(p_vote_id);
    select * into v from public.votes where id = p_vote_id;
    return pg_catalog.jsonb_build_object(
      'applied', false, 'reason', 'DEADLINE_PASSED', 'vote', app_private.vote_detail_json(v));
  end if;
  if v.status <> 'ACTIVE' then
    raise exception 'LIFECYCLE_CONFLICT' using errcode = 'P0001', detail = v.status;
  end if;

  if p_closes_at < v_now + interval '5 minutes' then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001', detail = 'DEADLINE_TOO_SOON';
  end if;
  if p_closes_at = v.closes_at then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001', detail = 'DEADLINE_UNCHANGED';
  end if;

  v_previous := v.closes_at;
  perform pg_catalog.set_config('cp.deadline_change', 'on', true);
  update public.votes set closes_at = p_closes_at where id = p_vote_id returning * into v;
  perform pg_catalog.set_config('cp.deadline_change', 'off', true);

  perform app_private.append_audit(
    'PROFILE', v_actor, 'VOTE_DEADLINE_CHANGED', 'VOTE', p_vote_id::text, v_reason,
    pg_catalog.jsonb_build_object(
      'previousClosesAt', v_previous,
      'closesAt', p_closes_at,
      'direction', case when p_closes_at > v_previous then 'EXTENDED' else 'SHORTENED' end));

  return pg_catalog.jsonb_build_object('applied', true, 'vote', app_private.vote_detail_json(v));
end
$$;

revoke all on function public.change_vote_deadline(uuid, timestamptz, boolean, text)
from public, anon;
grant execute on function public.change_vote_deadline(uuid, timestamptz, boolean, text)
to authenticated;

reset role;
