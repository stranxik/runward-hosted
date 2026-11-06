-- The four roles (PADR-0013 point 2, PADR-0018 point 7). Run once by the database administrator.
-- No password here: each is set out of band (ALTER ROLE ... PASSWORD, typed or read from the host's
-- secret store), never written to a file or a log.
create role rw_owner login;                       -- migrations only, never the service
create role rw_resolve nologin;                   -- owns the exact-key resolution functions
create role rw_app login nobypassrls;             -- the service
create role rw_maint login nobypassrls;           -- the hoster's scheduled and operator jobs
grant rw_resolve to rw_owner;                     -- so the migration can hand the functions over
-- then, on the service database: grant create, connect on database <db> to rw_owner; grant connect on database <db> to rw_app, rw_maint;
