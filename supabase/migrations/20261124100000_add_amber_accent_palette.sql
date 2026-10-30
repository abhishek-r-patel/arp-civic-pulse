-- Add the contrast-checked Amber accent palette to RWA settings.

set local role cp_owner;

alter table public.rwa_settings
  drop constraint rwa_settings_accent_palette_check,
  add constraint rwa_settings_accent_palette_check
    check (accent_palette in ('TEAL', 'BLUE', 'FOREST', 'PLUM', 'SLATE', 'AMBER'));

do $migration$
declare
  v_definition text;
  v_old_palette_list constant text :=
    '(''TEAL'', ''BLUE'', ''FOREST'', ''PLUM'', ''SLATE'')';
  v_new_palette_list constant text :=
    '(''TEAL'', ''BLUE'', ''FOREST'', ''PLUM'', ''SLATE'', ''AMBER'')';
begin
  v_definition := pg_catalog.pg_get_functiondef(
    'public.update_rwa_profile(jsonb)'::regprocedure
  );
  if pg_catalog.strpos(v_definition, v_old_palette_list) = 0 then
    raise exception 'Could not find the expected accent palette validation in update_rwa_profile';
  end if;
  execute pg_catalog.replace(v_definition, v_old_palette_list, v_new_palette_list);
end;
$migration$;

reset role;
