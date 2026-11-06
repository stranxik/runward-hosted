-- runward hosted, the floor schema (PADR-0013, PADR-0014, PADR-0017, PADR-0019).
-- Run by rw_owner (the migration role, never the service). Expansion only: a later migration adds,
-- it never drops or renames, so the previous image keeps running on the new schema (PADR-0015 point 3).
--
-- Isolation: every tenant table carries tenant_id, defaulted from the server-set app.tenant, with row
-- level security enabled AND forced, USING and WITH CHECK on rw_tenant(). The resolution tables that
-- must be read before the tenant is known (repository by forge id, credential, session, link) are
-- tenant tables too; they are reached across tenants only by SECURITY DEFINER functions owned by
-- rw_resolve, each by an exact key (no scan, no list): the policies let rw_resolve read, never write.
-- The tables with no tenant at all (challenges, token ids, counters, the operator's journal) grant
-- nothing to rw_app: functions only.

create schema if not exists rw;
set search_path = rw, pg_catalog;

create function rw.rw_tenant() returns uuid language sql stable parallel safe
  as $$ select nullif(current_setting('app.tenant', true), '')::uuid $$;

-- ---------------------------------------------------------------- tenant tables
create table rw.tenant (
  id uuid primary key default rw.rw_tenant(),
  title text not null default 'runward hébergé',
  lang text not null default 'fr' check (lang in ('fr', 'en')),
  witness boolean not null default false,
  created_at timestamptz not null default now()
);
create table rw.member (
  tenant_id uuid not null default rw.rw_tenant() references rw.tenant(id),
  id uuid primary key,
  role text not null check (role in ('owner')),
  founder boolean not null default false,
  label text,
  added_at timestamptz not null default now(),
  removed_at timestamptz,
  single_passkey_at timestamptz
);
create unique index member_one_founder on rw.member (tenant_id) where founder;
create table rw.passkey (
  tenant_id uuid not null default rw.rw_tenant() references rw.tenant(id),
  id uuid primary key,
  member_id uuid not null references rw.member(id),
  credential_id text not null unique,
  public_key bytea not null,
  counter bigint not null default 0,
  transports jsonb not null default '[]',
  aaguid text,
  device text,
  via text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  removed_at timestamptz,
  lost boolean not null default false
);
create table rw.session (
  tenant_id uuid not null default rw.rw_tenant() references rw.tenant(id),
  id uuid primary key,
  token_hash text not null unique,
  member_id uuid not null references rw.member(id),
  passkey_id uuid references rw.passkey(id),
  device text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  fresh_at timestamptz,
  fresh_by uuid,
  "grant" jsonb,
  closed_at timestamptz
);
-- A link's dates are written by the database, never by its caller (PADR-0012 complement): a modified
-- workflow cannot shorten the recovery delay.
create table rw.link (
  tenant_id uuid not null default rw.rw_tenant() references rw.tenant(id),
  id uuid primary key,
  token_hash text not null unique,
  kind text not null check (kind in ('bootstrap', 'recovery', 'invitation')),
  member_id uuid,
  opened_at timestamptz not null default now(),
  usable_from timestamptz not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  cancelled_at timestamptz,
  meta jsonb not null default '{}'
);
create function rw.link_dates() returns trigger language plpgsql as $$
begin
  new.opened_at := now();
  new.usable_from := now() + case new.kind when 'recovery' then interval '24 hours' else interval '0' end;
  new.expires_at := new.usable_from + case new.kind when 'invitation' then interval '72 hours' else interval '24 hours' end;
  return new;
end $$;
create trigger link_dates before insert on rw.link for each row execute function rw.link_dates();
create function rw.link_dates_frozen() returns trigger language plpgsql as $$
begin
  if new.opened_at <> old.opened_at or new.usable_from <> old.usable_from or new.expires_at <> old.expires_at or new.kind <> old.kind or new.token_hash <> old.token_hash then
    raise exception 'a link''s dates, kind and token are written once';
  end if;
  return new;
end $$;
create trigger link_dates_frozen before update on rw.link for each row execute function rw.link_dates_frozen();

create table rw.forge_repository (
  tenant_id uuid not null default rw.rw_tenant() references rw.tenant(id),
  id uuid primary key,
  forge text not null default 'github' check (forge in ('github')),
  name_key text not null,
  name text not null,
  repository_id text,
  owner_id text,
  state text not null check (state in ('pending', 'pinned')),
  removed_at timestamptz
);
create unique index forge_repository_pending_name on rw.forge_repository (forge, name_key) where state = 'pending' and removed_at is null;
create unique index forge_repository_pinned_id on rw.forge_repository (forge, repository_id) where repository_id is not null;

create table rw.repository (
  tenant_id uuid not null default rw.rw_tenant() references rw.tenant(id),
  id uuid primary key references rw.forge_repository(id),
  name text not null,
  workflow text not null,
  epoch integer not null default 0,
  consent boolean not null default false,
  consent_at timestamptz,
  declared_at timestamptz not null default now(),
  confirmed_at timestamptz,
  removed_at timestamptz,
  pending_send jsonb
);
create table rw.mission (
  tenant_id uuid not null default rw.rw_tenant() references rw.tenant(id),
  id text not null,
  repository_ref uuid not null references rw.repository(id),
  path text not null default '.',
  added_at timestamptz not null default now(),
  removed_at timestamptz,
  primary key (tenant_id, id)
);
create table rw.upload (
  tenant_id uuid not null default rw.rw_tenant() references rw.tenant(id),
  id uuid primary key,
  repository_ref uuid not null references rw.repository(id),
  mission text not null,
  kind text not null,
  run_id text not null,
  run_number text not null,
  run_attempt text not null,
  epoch integer not null default 0,
  sha256 text not null,
  size integer not null,
  rank text not null check (rank in ('current', 'historical', 'pending', 'quarantine', 'superseded')),
  seq bigint,
  "commit" text,
  claims jsonb not null,
  received_at timestamptz not null default now(),
  erased_at timestamptz
);
create unique index upload_idempotence on rw.upload (tenant_id, run_id, run_attempt, mission, kind);
create table rw.blob (
  tenant_id uuid not null default rw.rw_tenant() references rw.tenant(id),
  sha256 text not null,
  refs integer not null default 0 check (refs >= 0),
  erased_at timestamptz,
  primary key (tenant_id, sha256)
);
create table rw.fleet_index (
  tenant_id uuid not null default rw.rw_tenant() references rw.tenant(id),
  version integer not null,
  sha256 text not null,
  bytes bytea not null,
  manifest_sha256 text not null,
  manifest bytea not null,
  fleet_version text not null,
  fleet_archive_sha256 text not null,
  seq bigint not null,
  published_at timestamptz not null default now(),
  primary key (tenant_id, version)
);
create table rw.reader (
  tenant_id uuid primary key default rw.rw_tenant() references rw.tenant(id),
  authorized_at timestamptz,
  withdrawn_at timestamptz
);
create table rw.archive (
  tenant_id uuid not null default rw.rw_tenant() references rw.tenant(id),
  id uuid primary key,
  prepared_at timestamptz not null default now(),
  size bigint not null,
  sha256 text not null,
  contains jsonb not null default '[]',
  erased_at timestamptz
);

-- The journal: append only for the service (PADR-0014 point 1).
create table rw.ledger (
  tenant_id uuid not null default rw.rw_tenant() references rw.tenant(id),
  seq bigint not null check (seq >= 1),
  prev text not null,
  hash text not null,
  body jsonb not null,
  at timestamptz not null default now(),
  primary key (tenant_id, seq)
);
create function rw.ledger_refuse() returns trigger language plpgsql as $$
begin raise exception 'the journal is append only (%)', tg_op; end $$;
create trigger ledger_no_update before update or delete on rw.ledger for each row execute function rw.ledger_refuse();
create trigger ledger_no_truncate before truncate on rw.ledger for each statement execute function rw.ledger_refuse();

-- ---------------------------------------------------------------- row level security, forced
do $$
declare t text;
begin
  foreach t in array array['member','passkey','session','link','forge_repository','repository','mission','upload','blob','fleet_index','reader','archive','ledger'] loop
    execute format('alter table rw.%I enable row level security', t);
    execute format('alter table rw.%I force row level security', t);
    execute format('create policy %I on rw.%I as permissive for all using (tenant_id = rw.rw_tenant() or current_user = ''rw_resolve'') with check (tenant_id = rw.rw_tenant())', t || '_tenant', t);
  end loop;
end $$;
alter table rw.tenant enable row level security;
alter table rw.tenant force row level security;
create policy tenant_tenant on rw.tenant as permissive for all using (id = rw.rw_tenant() or current_user = 'rw_resolve') with check (id = rw.rw_tenant());

-- ---------------------------------------------------------------- tables with no tenant: functions only
create table rw.webauthn_challenge (
  id uuid primary key,
  challenge text not null,
  purpose text not null,
  session_id uuid,
  link_id uuid,
  gesture text,
  object text,
  expires_at timestamptz not null default now() + interval '5 minutes'
);
create table rw.oidc_jti (jti text primary key, expires_at timestamptz not null);
create table rw.rate_counter (repository_id text not null, bucket bigint not null, run_id text not null, primary key (repository_id, bucket, run_id));
create table rw.refused_counter (repository_id text not null, bucket bigint not null, n integer not null default 0, primary key (repository_id, bucket));
create table rw.service_state (id integer primary key check (id = 1), maintenance jsonb);
insert into rw.service_state (id, maintenance) values (1, null);
create table rw.operator_journal (seq bigserial primary key, at timestamptz not null default now(), what text not null, detail jsonb not null default '{}');

-- ---------------------------------------------------------------- resolution functions, exact key only
-- Owned by rw_resolve (grants file); each sets its search_path so a caller cannot shadow a name.
create function rw.resolve_repository(p_forge text, p_repository_id text, p_name_key text)
  returns table (tenant_id uuid, id uuid, state text, removed boolean)
  language sql stable security definer set search_path = rw, pg_catalog as $$
  (select f.tenant_id, f.id, f.state, f.removed_at is not null from rw.forge_repository f
     where f.forge = p_forge and f.repository_id = p_repository_id limit 1)
  union all
  (select f.tenant_id, f.id, f.state, false from rw.forge_repository f
     where f.forge = p_forge and f.state = 'pending' and f.removed_at is null and f.name_key = p_name_key
       and not exists (select 1 from rw.forge_repository g where g.forge = p_forge and g.repository_id = p_repository_id)
     limit 1)
$$;
-- 'free', 'here' (this tenant) or 'elsewhere': one answer for absent-elsewhere, pending-elsewhere, pinned-elsewhere.
create function rw.name_taken(p_forge text, p_name_key text) returns text
  language sql stable security definer set search_path = rw, pg_catalog as $$
  select coalesce((select case when f.tenant_id = rw.rw_tenant() then 'here' else 'elsewhere' end
    from rw.forge_repository f where f.forge = p_forge and f.name_key = p_name_key and f.removed_at is null
    order by (f.tenant_id = rw.rw_tenant()) desc limit 1), 'free')
$$;
create function rw.resolve_credential(p_credential_id text) returns table (tenant_id uuid, passkey_id uuid)
  language sql stable security definer set search_path = rw, pg_catalog as $$
  select p.tenant_id, p.id from rw.passkey p where p.credential_id = p_credential_id limit 1
$$;
create function rw.resolve_session(p_token_hash text) returns table (tenant_id uuid, id uuid)
  language sql stable security definer set search_path = rw, pg_catalog as $$
  select s.tenant_id, s.id from rw.session s where s.token_hash = p_token_hash and s.closed_at is null limit 1
$$;
create function rw.resolve_link(p_token_hash text) returns table (tenant_id uuid, id uuid)
  language sql stable security definer set search_path = rw, pg_catalog as $$
  select l.tenant_id, l.id from rw.link l where l.token_hash = p_token_hash limit 1
$$;
create function rw.put_challenge(p_id uuid, p_challenge text, p_purpose text, p_session uuid, p_link uuid, p_gesture text, p_object text)
  returns void language sql volatile security definer set search_path = rw, pg_catalog as $$
  delete from rw.webauthn_challenge where expires_at < now();
  insert into rw.webauthn_challenge (id, challenge, purpose, session_id, link_id, gesture, object) values (p_id, p_challenge, p_purpose, p_session, p_link, p_gesture, p_object);
$$;
-- Consumed BEFORE the ceremony is verified: a replayed challenge fails even if the ceremony would pass.
create function rw.take_challenge(p_id uuid)
  returns table (challenge text, purpose text, session_id uuid, link_id uuid, gesture text, object text, live boolean)
  language sql volatile security definer set search_path = rw, pg_catalog as $$
  delete from rw.webauthn_challenge c where c.id = p_id
  returning c.challenge, c.purpose, c.session_id, c.link_id, c.gesture, c.object, c.expires_at > now()
$$;
create function rw.use_jti(p_jti text, p_expires_at timestamptz) returns boolean
  language plpgsql volatile security definer set search_path = rw, pg_catalog as $$
begin
  delete from rw.oidc_jti where expires_at < now() - interval '2 minutes';
  insert into rw.oidc_jti (jti, expires_at) values (p_jti, p_expires_at);
  return true;
exception when unique_violation then return false;
end $$;
-- One more run in this hour for this repository? The same run is counted once (T17).
create function rw.take_rate(p_repository_id text, p_bucket bigint, p_run_id text, p_limit integer) returns boolean
  language plpgsql volatile security definer set search_path = rw, pg_catalog as $$
begin
  perform pg_advisory_xact_lock(hashtext('rate:' || p_repository_id));
  if exists (select 1 from rw.rate_counter where repository_id = p_repository_id and bucket = p_bucket and run_id = p_run_id) then return true; end if;
  if (select count(*) from rw.rate_counter where repository_id = p_repository_id and bucket = p_bucket) >= p_limit then return false; end if;
  insert into rw.rate_counter values (p_repository_id, p_bucket, p_run_id);
  delete from rw.rate_counter where bucket < p_bucket - 2;
  return true;
end $$;
create function rw.count_refused(p_repository_id text, p_bucket bigint) returns integer
  language sql volatile security definer set search_path = rw, pg_catalog as $$
  insert into rw.refused_counter (repository_id, bucket, n) values (coalesce(p_repository_id, '?'), p_bucket, 1)
  on conflict (repository_id, bucket) do update set n = rw.refused_counter.n + 1 returning n
$$;
-- For the maintenance role only: the tenant ids, to walk them one at a time under their own app.tenant.
create function rw.tenant_ids() returns setof uuid
  language sql stable security definer set search_path = rw, pg_catalog as $$ select id from rw.tenant order by created_at $$;
create function rw.operator_note(p_what text, p_detail jsonb) returns bigint
  language sql volatile security definer set search_path = rw, pg_catalog as $$
  insert into rw.operator_journal (what, detail) values (p_what, p_detail) returning seq
$$;
create function rw.maintenance() returns jsonb
  language sql stable security definer set search_path = rw, pg_catalog as $$ select maintenance from rw.service_state where id = 1 $$;
create function rw.set_maintenance(p jsonb) returns void
  language sql volatile security definer set search_path = rw, pg_catalog as $$ update rw.service_state set maintenance = p where id = 1 $$;
