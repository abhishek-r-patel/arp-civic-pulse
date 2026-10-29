-- Allow administrators to permanently delete a draft through one audited routine.
set local role cp_owner;

alter table public.audit_events drop constraint audit_events_action_check;
alter table public.audit_events add constraint audit_events_action_check check (action in (
  'BOOTSTRAP_ADMIN', 'SETTINGS_INITIALIZED', 'POLICY_APPROVAL_RECORDED', 'RETENTION_UPDATED',
  'RWA_IDENTIFIER_LABEL_UPDATED', 'RWA_PROFILE_UPDATED', 'PROFILE_PROVISIONED', 'PROFILE_UPDATED',
  'PROFILE_STATUS_CHANGED', 'PROFILE_ROLE_CHANGED', 'HOUSEHOLD_CREATED', 'HOUSEHOLD_UPDATED',
  'DRAFT_CREATED', 'DRAFT_UPDATED', 'DRAFT_DELETED', 'VOTE_ACTIVATED', 'VOTE_COMPLETED',
  'VOTE_CANCELLED', 'VOTE_DEADLINE_CHANGED', 'RETENTION_DELETED', 'VOTE_SCHEDULED',
  'VOTE_SCHEDULE_WITHDRAWN', 'PROFILE_SELF_REGISTERED', 'APP_SUPPORT_ACCESS_ENABLED',
  'APP_SUPPORT_ACCESS_DISABLED'
));

create or replace function app_private.guard_vote_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'DRAFT' and app_private.flag_is_on('cp.draft_delete') then
    return old;
  end if;
  if app_private.retention_delete_allowed(old) then
    return old;
  end if;
  raise exception 'VOTE_FROZEN' using errcode = 'P0001';
end
$$;

create function public.delete_draft(
  p_vote_id uuid,
  p_expected_revision integer,
  p_confirmed boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_enabled_admin();
  v public.votes;
begin
  if p_confirmed is distinct from true
     or p_expected_revision is null
     or p_expected_revision < 1 then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;

  v := app_private.lock_vote(p_vote_id);
  if v.status <> 'DRAFT' then
    raise exception 'VOTE_FROZEN' using errcode = 'P0001';
  end if;
  if v.draft_revision <> p_expected_revision then
    raise exception 'STALE_REVISION' using errcode = 'P0001';
  end if;

  perform pg_catalog.set_config('cp.draft_delete', 'on', true);
  delete from public.open_responses where vote_id = p_vote_id;
  delete from public.closed_tallies where vote_id = p_vote_id;
  delete from public.participation where vote_id = p_vote_id;
  delete from public.electorate where vote_id = p_vote_id;
  delete from public.candidates c
    using public.offices o where c.office_id = o.id and o.vote_id = p_vote_id;
  delete from public.offices where vote_id = p_vote_id;
  delete from public.poll_options where vote_id = p_vote_id;
  delete from public.votes where id = p_vote_id;
  perform pg_catalog.set_config('cp.draft_delete', 'off', true);

  perform app_private.append_audit(
    'PROFILE', v_actor, 'DRAFT_DELETED', 'VOTE', p_vote_id::text, null,
    pg_catalog.jsonb_build_object(
      'votingType', v.voting_type, 'draftRevision', v.draft_revision));
  return true;
end
$$;

revoke all on function public.delete_draft(uuid, integer, boolean)
  from public, anon, authenticated;
grant execute on function public.delete_draft(uuid, integer, boolean)
  to authenticated;

reset role;
