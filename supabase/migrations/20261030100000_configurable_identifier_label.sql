-- Configurable RWA-facing wording for household identifiers.
-- The stored identifier and its normalization/uniqueness rules are unchanged.

set local role cp_owner;

alter table public.rwa_settings
  add column identifier_label text not null default 'Household identifier'
  check (
    identifier_label = btrim(identifier_label)
    and char_length(identifier_label) between 1 and 80
    and identifier_label !~ '[\x00-\x1f\x7f-\x9f]'
    and identifier_label !~* '</?[a-z!][^>]*>'
  );

alter table public.audit_events drop constraint audit_events_action_check;
alter table public.audit_events
  add constraint audit_events_action_check check (action in (
    'BOOTSTRAP_ADMIN', 'SETTINGS_INITIALIZED', 'POLICY_APPROVAL_RECORDED',
    'RETENTION_UPDATED', 'RWA_IDENTIFIER_LABEL_UPDATED',
    'PROFILE_PROVISIONED', 'PROFILE_UPDATED', 'PROFILE_STATUS_CHANGED',
    'PROFILE_ROLE_CHANGED', 'HOUSEHOLD_CREATED', 'HOUSEHOLD_UPDATED',
    'DRAFT_CREATED', 'DRAFT_UPDATED', 'VOTE_ACTIVATED', 'VOTE_COMPLETED',
    'VOTE_CANCELLED', 'RETENTION_DELETED'
  ));

create function public.get_household_identifier_label()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_label text;
begin
  if not app_private.is_enabled_member() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select identifier_label into v_label
  from public.rwa_settings
  where id = 1;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  return v_label;
end
$$;

create function public.update_household_identifier_label(p_label text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_old_label text;
  v_label text;
begin
  v_actor := app_private.current_uid();
  if not app_private.is_enabled_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_label is null
     or p_label <> pg_catalog.btrim(p_label)
     or pg_catalog.char_length(p_label) not between 1 and 80
     or p_label ~ '[\x00-\x1f\x7f-\x9f]'
     or p_label ~* '</?[a-z!][^>]*>' then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;

  v_label := p_label;
  select identifier_label into v_old_label
  from public.rwa_settings
  where id = 1
  for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_old_label is distinct from v_label then
    update public.rwa_settings
    set identifier_label = v_label
    where id = 1;
    perform app_private.append_audit(
      'PROFILE', v_actor, 'RWA_IDENTIFIER_LABEL_UPDATED', 'SETTINGS', '1',
      null, pg_catalog.jsonb_build_object(
        'fields', pg_catalog.jsonb_build_array('identifierLabel')
      )
    );
  end if;
  return v_label;
end
$$;

revoke all on function
  public.get_household_identifier_label(),
  public.update_household_identifier_label(text)
from public, anon;
grant execute on function
  public.get_household_identifier_label(),
  public.update_household_identifier_label(text)
to authenticated;

reset role;
