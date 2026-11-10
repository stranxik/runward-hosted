-- Roles and grants (PADR-0013 point 2). Run after the migrations by the database administrator.
-- The roles exist beforehand (db/roles.sql); their passwords are set out of band, never in a file.
set search_path = rw, pg_catalog;
grant usage on schema rw to rw_app, rw_maint, rw_resolve;
grant create on schema rw to rw_resolve;          -- required to hand the functions to rw_resolve

-- The resolution functions belong to rw_resolve; the policies let rw_resolve read across tenants,
-- by the exact key each function takes, and never write a tenant table.
do $$
declare f text;
begin
  foreach f in array array[
    'resolve_repository(text,text,text)', 'name_taken(text,text)', 'resolve_credential(text)', 'resolve_session(text)',
    'resolve_link(text)', 'put_challenge(uuid,text,text,uuid,uuid,text,text)', 'take_challenge(uuid)',
    'use_jti(text,timestamptz)', 'take_rate(text,bigint,text,integer)', 'count_refused(text,bigint)',
    'tenant_ids()', 'operator_note(text,jsonb)', 'maintenance()', 'set_maintenance(jsonb)', 'daily_jobs()'] loop
    execute format('alter function rw.%s owner to rw_resolve', f);
    execute format('revoke all on function rw.%s from public', f);
  end loop;
end $$;
grant select on rw.tenant, rw.forge_repository, rw.passkey, rw.session, rw.link to rw_resolve;
grant select, insert, delete on rw.webauthn_challenge, rw.oidc_jti, rw.rate_counter to rw_resolve;
grant select, insert, update on rw.refused_counter to rw_resolve;
grant select, insert on rw.operator_journal to rw_resolve;
grant usage on sequence rw.operator_journal_seq_seq to rw_resolve;
grant select, update on rw.service_state to rw_resolve;

-- The service: no owner, no BYPASSRLS, no DELETE anywhere, no UPDATE on the journal.
grant execute on function rw.resolve_repository(text,text,text), rw.name_taken(text,text), rw.resolve_credential(text),
  rw.resolve_session(text), rw.resolve_link(text), rw.put_challenge(uuid,text,text,uuid,uuid,text,text),
  rw.take_challenge(uuid), rw.use_jti(text,timestamptz), rw.take_rate(text,bigint,text,integer),
  rw.count_refused(text,bigint), rw.maintenance(), rw.rw_tenant(), rw.daily_jobs() to rw_app;
grant select, update on rw.tenant to rw_app;
grant select, insert, update on rw.member, rw.passkey, rw.session, rw.forge_repository, rw.repository, rw.mission,
  rw.upload, rw.blob, rw.fleet_index, rw.reader, rw.archive to rw_app;
grant select, update on rw.link to rw_app;
grant select, insert on rw.ledger to rw_app;
revoke truncate on all tables in schema rw from rw_app, rw_maint;

-- Maintenance (PADR-0018 point 7): open a tenant and its links, erase expired bytes, append to the journal.
grant execute on function rw.tenant_ids(), rw.operator_note(text,jsonb), rw.set_maintenance(jsonb), rw.maintenance(),
  rw.resolve_link(text), rw.rw_tenant() to rw_maint;
grant select, insert on rw.tenant, rw.link to rw_maint;
grant update on rw.link to rw_maint;
grant select, update on rw.member, rw.passkey, rw.session, rw.upload, rw.blob, rw.archive, rw.repository, rw.forge_repository to rw_maint;
grant select on rw.mission, rw.fleet_index, rw.reader to rw_maint;
-- Erasure reaches the published versions of the index (0006): the retention job and the replay after a
-- restore empty the bytes of a version built from erased content. The trigger fleet_index_written_once
-- holds this UPDATE, and the service's, to that erasure: no other column moves, no byte is rewritten.
grant update on rw.fleet_index to rw_maint;
grant select, insert on rw.ledger to rw_maint;
