-- Let enabled RWA members find enabled RWA Admins without exposing account
-- names to anonymous visitors or exposing email/household data.
set local role cp_owner;

create function public.get_enabled_rwa_admin_names()
returns table (representative_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app_private.is_enabled_member()
     or exists (
       select 1
       from public.profiles p
       where p.id = app_private.current_uid()
         and p.is_app_support
     ) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  return query
    select p.representative_name
    from public.profiles p
    where p.status = 'ENABLED'
      and p.is_admin
    order by pg_catalog.lower(p.representative_name), p.id;
end
$$;

revoke all on function public.get_enabled_rwa_admin_names()
  from public, anon, service_role;
grant execute on function public.get_enabled_rwa_admin_names()
  to authenticated;

reset role;
