-- Expansion: the last outcome of each daily job, readable by the service (review finding of 2026-11-10: a
-- failed daily job was noted in the operator journal, which nothing read and nothing alerted on). Per job,
-- the time of its last note and whether that run completed: no tenant failed, no chain broken, the tenant
-- list read. Never a tenant, an error or a head: /api/health shows it, the hourly probe alerts on it.
-- Its search_path names pg_catalog first and pg_temp last (review finding of 2026-11-10, C1: with
-- `rw, pg_catalog`, pg_temp was searched first for a type, so a caller's `pg_temp.jsonb`, a domain whose
-- check calls its own function, ran here as rw_resolve). The types are written with their schema as well.
-- It reads the last note of each job, found by the index below, and evaluates that note only (review
-- finding of 2026-11-10, C4: it evaluated every retained note of both jobs on each call of the public
-- /api/health, a cost that grew with days and tenants towards the statement deadline).
create index operator_journal_what_seq on rw.operator_journal (what, seq desc);
create function rw.daily_jobs() returns jsonb
  language sql stable security definer set search_path = pg_catalog, rw, pg_temp as $$
  select coalesce(jsonb_object_agg(j.what, jsonb_build_object('at', j.at, 'ok', j.ok)), '{}'::pg_catalog.jsonb)
  from (
    select l.what, l.at,
      coalesce((l.detail ->> 'failed')::integer, 0) = 0
        and not exists (
          select 1 from jsonb_array_elements(case when jsonb_typeof(l.detail -> 'report') = 'array' then l.detail -> 'report' else '[]'::pg_catalog.jsonb end) e
          where e ->> 'ok' = 'false' or e ->> 'failed' = 'true') as ok
    from (values ('retention'), ('verify-chains')) as w (what)
    cross join lateral (
      select o.what, o.at, o.detail from rw.operator_journal o where o.what = w.what order by o.seq desc limit 1
    ) l
  ) j
$$;
