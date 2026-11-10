-- Expansion: the security definer functions of 0001 resolve no name in the caller's temporary schema
-- (review finding of 2026-11-10, C1). With `search_path = rw, pg_catalog`, PostgreSQL still looks in pg_temp
-- first for a table or a type: a caller that may create temporary objects could plant `pg_temp.jsonb`, a
-- domain whose check calls its own function, and have it run as rw_resolve, which reads across tenants.
-- None of these fourteen names a type or a table without its schema in its body today; this closes the
-- path for the next edit. pg_catalog first (a built-in is never shadowed), then rw, and pg_temp named
-- last: named, it is searched there and no longer first. 0004's rw.daily_jobs() is created with the same
-- setting; test/pg/isolation.test.js holds every security definer function of rw to it.
alter function rw.resolve_repository(text, text, text) set search_path = pg_catalog, rw, pg_temp;
alter function rw.name_taken(text, text) set search_path = pg_catalog, rw, pg_temp;
alter function rw.resolve_credential(text) set search_path = pg_catalog, rw, pg_temp;
alter function rw.resolve_session(text) set search_path = pg_catalog, rw, pg_temp;
alter function rw.resolve_link(text) set search_path = pg_catalog, rw, pg_temp;
alter function rw.put_challenge(uuid, text, text, uuid, uuid, text, text) set search_path = pg_catalog, rw, pg_temp;
alter function rw.take_challenge(uuid) set search_path = pg_catalog, rw, pg_temp;
alter function rw.use_jti(text, timestamptz) set search_path = pg_catalog, rw, pg_temp;
alter function rw.take_rate(text, bigint, text, integer) set search_path = pg_catalog, rw, pg_temp;
alter function rw.count_refused(text, bigint) set search_path = pg_catalog, rw, pg_temp;
alter function rw.tenant_ids() set search_path = pg_catalog, rw, pg_temp;
alter function rw.operator_note(text, jsonb) set search_path = pg_catalog, rw, pg_temp;
alter function rw.maintenance() set search_path = pg_catalog, rw, pg_temp;
alter function rw.set_maintenance(jsonb) set search_path = pg_catalog, rw, pg_temp;
