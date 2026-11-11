-- Expansion: the forge port (ADR-0029 section 1; the shape of the store is ADR-0031). A repository may be
-- GitLab's, on gitlab.com or on an instance its tenant registered, and the issuer key enters every key that
-- had none: the two resolution keys of a repository, the replay ids of tokens, the rate and refusal counters.
--
-- What an expansion cannot do, and what this file does instead. The check of 0001 on forge_repository.forge
-- admits 'github' alone, and its two unique indexes, (forge, name_key) while pending and
-- (forge, repository_id) once pinned, carry neither a tenant nor an issuer. None of the three can be
-- replaced without removing it, which this repository's migrations never do (the image of before keeps
-- running on the new schema). So:
--   - `forge` stays as it is, 'github' on every row, and is read by nothing from this migration on; the
--     forge is `forge_name`;
--   - `issuer_key` is the issuer's string for a public issuer, and for a registered instance the tenant's
--     own registration (rw.issuer.id), never the issuer's string: two tenants that register the same
--     string hold two issuer keys;
--   - `name_key` and `repository_id` are resolution keys. GitHub's stay bare, as they are. Every other
--     forge's read `<forge>:<issuer key>:<value>`, which the check forge_repository_keys_scoped holds: the
--     two indexes of 0001 are then unique within a forge and an issuer key, as ADR-0029 asks, by the value
--     they index. A tenant that registers another's issuer string with its own key can neither take a
--     project's identifier, nor block it, nor learn that it is declared elsewhere.
-- The image of before writes GitHub rows only; the defaults give them their forge name and issuer key.
alter table rw.forge_repository add column forge_name text not null default 'github' check (forge_name in ('github', 'gitlab'));
alter table rw.forge_repository add column issuer_key text not null default 'https://token.actions.githubusercontent.com';
alter table rw.forge_repository add column definition_ref text;
alter table rw.forge_repository add constraint forge_repository_keys_scoped check (
  (forge_name = 'github' and issuer_key = 'https://token.actions.githubusercontent.com')
  or (forge_name <> 'github'
      and starts_with(name_key, forge_name || ':' || issuer_key || ':')
      and (repository_id is null or starts_with(repository_id, forge_name || ':' || issuer_key || ':'))));
-- The requirement of a protected branch, lifted for a repository by a gesture (protection-lift): null while required.
alter table rw.repository add column protection_lifted_at timestamptz;

-- ---------------------------------------------------------------- registered instances (section 4)
-- Tenant tables, under forced row level security like the others. `id` is the registration: 128 random
-- bits, the last segment of the audience its tokens carry, and the issuer key of its uploads.
create table rw.issuer (
  tenant_id uuid not null default rw.rw_tenant() references rw.tenant(id),
  id text primary key check (id ~ '^[0-9a-f]{32}$'),
  forge text not null check (forge in ('gitlab')),
  issuer text not null check (length(issuer) between 1 and 200),
  added_at timestamptz not null default now(),
  removed_at timestamptz,
  unique (tenant_id, id)
);
-- One row per key ever registered: a retired key is kept, marked, so that a token it signed is told so
-- (key-retired), and so that the uploads it signed can be marked from their journaled kid.
create table rw.issuer_key (
  tenant_id uuid not null default rw.rw_tenant() references rw.tenant(id),
  id uuid primary key,
  issuer_ref text not null,
  kid text not null,
  jwk jsonb not null,
  thumbprint text not null,
  added_at timestamptz not null default now(),
  confirmed_at timestamptz not null default now(),
  retired_at timestamptz,
  unique (issuer_ref, kid),
  foreign key (tenant_id, issuer_ref) references rw.issuer (tenant_id, id)
);
alter table rw.issuer enable row level security;
alter table rw.issuer force row level security;
create policy issuer_tenant on rw.issuer as permissive for all using (tenant_id = rw.rw_tenant() or current_user = 'rw_resolve') with check (tenant_id = rw.rw_tenant());
alter table rw.issuer_key enable row level security;
alter table rw.issuer_key force row level security;
create policy issuer_key_tenant on rw.issuer_key as permissive for all using (tenant_id = rw.rw_tenant() or current_user = 'rw_resolve') with check (tenant_id = rw.rw_tenant());

-- What a registration and a key are is written once; a removal and a retirement are final. The grants
-- give UPDATE to the service (a key confirmed again, retired; a registration removed) and to the
-- maintenance role (the replay after a restore): neither can change a key's material, bring a retired
-- key back, or move a row to another registration.
create function rw.issuer_written_once() returns trigger
  language plpgsql set search_path = pg_catalog, rw, pg_temp as $$
begin
  if (new.tenant_id, new.id, new.forge, new.issuer, new.added_at) is distinct from (old.tenant_id, old.id, old.forge, old.issuer, old.added_at) then
    raise exception 'a registration is written once: only its removal is recorded';
  end if;
  if old.removed_at is not null and new.removed_at is distinct from old.removed_at then
    raise exception 'a registration is written once: a removal is final';
  end if;
  return new;
end $$;
create trigger issuer_written_once before update on rw.issuer for each row execute function rw.issuer_written_once();
create function rw.issuer_key_written_once() returns trigger
  language plpgsql set search_path = pg_catalog, rw, pg_temp as $$
begin
  if (new.tenant_id, new.id, new.issuer_ref, new.kid, new.jwk, new.thumbprint, new.added_at) is distinct from (old.tenant_id, old.id, old.issuer_ref, old.kid, old.jwk, old.thumbprint, old.added_at) then
    raise exception 'a registered key is written once: it is confirmed again or retired, never changed';
  end if;
  if old.retired_at is not null and new.retired_at is distinct from old.retired_at then
    raise exception 'a registered key is written once: a retirement is final';
  end if;
  return new;
end $$;
create trigger issuer_key_written_once before update on rw.issuer_key for each row execute function rw.issuer_key_written_once();

-- A repository's issuer key is a public issuer's string or a live registration of the row's own tenant.
-- Not a security definer function: it reads rw.issuer as the role that writes, under that role's policies.
create function rw.forge_repository_issuer() returns trigger
  language plpgsql set search_path = pg_catalog, rw, pg_temp as $$
begin
  if new.forge_name = 'github' or new.issuer_key = 'https://gitlab.com' then return new; end if;
  if tg_op = 'UPDATE' and new.issuer_key = old.issuer_key and new.forge_name = old.forge_name and new.tenant_id = old.tenant_id then return new; end if;
  if not exists (select 1 from rw.issuer i where i.id = new.issuer_key and i.tenant_id = new.tenant_id and i.forge = new.forge_name and i.removed_at is null) then
    raise exception 'a repository''s issuer key is a public issuer or a live registration of its own tenant';
  end if;
  return new;
end $$;
create trigger forge_repository_issuer before insert or update on rw.forge_repository for each row execute function rw.forge_repository_issuer();

-- ---------------------------------------------------------------- tables with no tenant: functions only
-- The replay ids and the two counters of 0001 are keyed by a token's jti or a repository's id alone. Their
-- primary keys cannot gain a column in place, so three tables keyed by the issuer key take over; the
-- service reads and writes these from this migration on.
create table rw.token_use (issuer_key text not null, jti text not null, expires_at timestamptz not null, primary key (issuer_key, jti));
create table rw.send_rate (issuer_key text not null, repository_id text not null, bucket bigint not null, run_id text not null, primary key (issuer_key, repository_id, bucket, run_id));
create table rw.send_refused (issuer_key text not null, repository_id text not null, bucket bigint not null, n integer not null default 0, primary key (issuer_key, repository_id, bucket));

-- ---------------------------------------------------------------- functions, exact key only
-- Owned by rw_resolve (grants file). Each sets search_path = pg_catalog, rw, pg_temp (the lesson of T34).
-- A repository within an issuer key, by its scoped keys: pinned by id first, else pending by name.
create function rw.resolve_forge_repository(p_issuer_key text, p_id_key text, p_name_key text)
  returns table (tenant_id uuid, id uuid, state text, removed boolean)
  language sql stable security definer set search_path = pg_catalog, rw, pg_temp as $$
  (select f.tenant_id, f.id, f.state, f.removed_at is not null from rw.forge_repository f
     where f.issuer_key = p_issuer_key and f.repository_id = p_id_key limit 1)
  union all
  (select f.tenant_id, f.id, f.state, false from rw.forge_repository f
     where f.issuer_key = p_issuer_key and f.state = 'pending' and f.removed_at is null and f.name_key = p_name_key
       and not exists (select 1 from rw.forge_repository g where g.issuer_key = p_issuer_key and g.repository_id = p_id_key)
     limit 1)
$$;
-- 'free', 'here' (this tenant) or 'elsewhere', within an issuer key.
create function rw.name_key_taken(p_issuer_key text, p_name_key text) returns text
  language sql stable security definer set search_path = pg_catalog, rw, pg_temp as $$
  select coalesce((select case when f.tenant_id = rw.rw_tenant() then 'here' else 'elsewhere' end
    from rw.forge_repository f where f.issuer_key = p_issuer_key and f.name_key = p_name_key and f.removed_at is null
    order by (f.tenant_id = rw.rw_tenant()) desc limit 1), 'free')
$$;
-- A registration and its keys, by the registration's exact identifier: read before the tenant is known,
-- to check the signature of a token whose audience names it (ADR-0029 section 6 points 7 and 9). One row
-- per key; a registration without a key gives one row whose key columns are null.
create function rw.resolve_issuer(p_id text)
  returns table (tenant_id uuid, forge text, issuer text, removed boolean, key_id uuid, kid text, jwk jsonb, thumbprint text, added_at timestamptz, confirmed_at timestamptz, retired_at timestamptz)
  language sql stable security definer set search_path = pg_catalog, rw, pg_temp as $$
  select i.tenant_id, i.forge, i.issuer, i.removed_at is not null, k.id, k.kid, k.jwk, k.thumbprint, k.added_at, k.confirmed_at, k.retired_at
    from rw.issuer i left join rw.issuer_key k on k.issuer_ref = i.id and k.tenant_id = i.tenant_id
   where i.id = p_id
$$;
-- A token's replay id, used once within its issuer key and kept until its expiry. `p_legacy`: also written
-- where the image of before 0007 looks (rw.oidc_jti), for GitHub's tokens, so that a token used on one
-- image is refused by the other while both run during a deploy. One failure undoes both writes.
create function rw.use_token(p_issuer_key text, p_jti text, p_expires_at timestamptz, p_legacy boolean) returns boolean
  language plpgsql volatile security definer set search_path = pg_catalog, rw, pg_temp as $$
begin
  delete from rw.token_use where expires_at < now() - interval '2 minutes';
  if p_legacy then
    delete from rw.oidc_jti where expires_at < now() - interval '2 minutes';
    insert into rw.oidc_jti (jti, expires_at) values (p_jti, p_expires_at);
  end if;
  insert into rw.token_use (issuer_key, jti, expires_at) values (p_issuer_key, p_jti, p_expires_at);
  return true;
exception when unique_violation then return false;
end $$;
-- One more run in this hour for this repository of this issuer key? The same run is counted once (T17).
create function rw.take_send_rate(p_issuer_key text, p_repository_id text, p_bucket bigint, p_run_id text, p_limit integer) returns boolean
  language plpgsql volatile security definer set search_path = pg_catalog, rw, pg_temp as $$
begin
  perform pg_advisory_xact_lock(hashtext('rate:' || p_issuer_key || ':' || p_repository_id));
  if exists (select 1 from rw.send_rate where issuer_key = p_issuer_key and repository_id = p_repository_id and bucket = p_bucket and run_id = p_run_id) then return true; end if;
  if (select count(*) from rw.send_rate where issuer_key = p_issuer_key and repository_id = p_repository_id and bucket = p_bucket) >= p_limit then return false; end if;
  insert into rw.send_rate values (p_issuer_key, p_repository_id, p_bucket, p_run_id);
  delete from rw.send_rate where bucket < p_bucket - 2;
  return true;
end $$;
create function rw.count_send_refused(p_issuer_key text, p_repository_id text, p_bucket bigint) returns integer
  language sql volatile security definer set search_path = pg_catalog, rw, pg_temp as $$
  insert into rw.send_refused (issuer_key, repository_id, bucket, n) values (p_issuer_key, coalesce(p_repository_id, '?'), p_bucket, 1)
  on conflict (issuer_key, repository_id, bucket) do update set n = rw.send_refused.n + 1 returning n
$$;
