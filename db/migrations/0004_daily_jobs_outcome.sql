-- Expansion: the last outcome of each daily job, readable by the service (review finding of 2026-11-10: a
-- failed daily job was noted in the operator journal, which nothing read and nothing alerted on). Per job,
-- the time of its last note and whether that run completed: no tenant failed, no chain broken, the tenant
-- list read. Never a tenant, an error or a head: /api/health shows it, the hourly probe alerts on it.
-- Its search_path names pg_catalog first and pg_temp last (review finding of 2026-11-10, C1: with
-- `rw, pg_catalog`, pg_temp was searched first for a type, so a caller's `pg_temp.jsonb`, a domain whose
-- check calls its own function, ran here as rw_resolve). The types are written with their schema as well.
create function rw.daily_jobs() returns jsonb
  language sql stable security definer set search_path = pg_catalog, rw, pg_temp as $$
  select coalesce(jsonb_object_agg(j.what, jsonb_build_object('at', j.at, 'ok', j.ok)), '{}'::pg_catalog.jsonb)
  from (
    select distinct on (o.what) o.what, o.at,
      coalesce((o.detail ->> 'failed')::integer, 0) = 0
        and not exists (
          select 1 from jsonb_array_elements(case when jsonb_typeof(o.detail -> 'report') = 'array' then o.detail -> 'report' else '[]'::pg_catalog.jsonb end) e
          where e ->> 'ok' = 'false' or e ->> 'failed' = 'true') as ok
    from rw.operator_journal o
    where o.what in ('retention', 'verify-chains')
    order by o.what, o.seq desc
  ) j
$$;
