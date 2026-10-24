-- Supplemental application rate limiting (docs/API.md section 9, docs/DATABASE.md 3.14).
--
-- Supabase Auth keeps its own OTP limits; these buckets only add endpoint-level
-- abuse protection. Each call is its own transaction, so a rejected request
-- still persists its count. Subjects arrive as keyed HMAC digests computed
-- server-side with the dedicated rate-limit key; raw emails/IPs are never seen
-- or stored here. During key rotation the caller passes the digests for every
-- still-live key version, so existing windows keep enforcing.

set local role cp_owner;

create function public.consume_rate_limit(
  p_scope text,
  p_subject_digests bytea[],
  p_key_versions smallint[],
  p_limit bigint,
  p_window_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_window_start timestamptz;
  v_count bigint;
  v_highest bigint := 0;
  v_index integer;
begin
  perform app_private.require_service_role();

  if p_limit is null or p_limit < 1
     or p_window_seconds is null or p_window_seconds not between 1 and 86400
     or p_subject_digests is null or p_key_versions is null
     or coalesce(array_length(p_subject_digests, 1), 0) not between 1 and 4
     or array_length(p_subject_digests, 1) is distinct from array_length(p_key_versions, 1) then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;

  v_window_start := pg_catalog.to_timestamp(
    pg_catalog.floor(extract(epoch from v_now) / p_window_seconds) * p_window_seconds);

  -- Stable subject order avoids deadlocks between concurrent callers.
  for v_index in
    select i from pg_catalog.generate_subscripts(p_subject_digests, 1) as i
    order by p_subject_digests[i], p_key_versions[i]
  loop
    insert into public.rate_limit_buckets
      (scope, subject_digest, digest_key_version, window_start, expires_at, request_count)
    values
      (p_scope, p_subject_digests[v_index], p_key_versions[v_index], v_window_start,
       v_window_start + pg_catalog.make_interval(secs => p_window_seconds), 1)
    on conflict (scope, subject_digest, digest_key_version, window_start)
    do update set request_count = public.rate_limit_buckets.request_count + 1
    returning request_count into v_count;

    v_highest := greatest(v_highest, v_count);
  end loop;

  return pg_catalog.jsonb_build_object(
    'allowed', v_highest <= p_limit,
    'count', v_highest,
    'retryAfterSeconds', case
      when v_highest <= p_limit then 0
      else greatest(1, pg_catalog.ceil(
        extract(epoch from (v_window_start + pg_catalog.make_interval(secs => p_window_seconds) - v_now)))::integer)
    end);
end
$$;

revoke all on function public.consume_rate_limit(text, bytea[], smallint[], bigint, integer)
  from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, bytea[], smallint[], bigint, integer)
  to service_role;

reset role;
