-- Expansion: the erasure of content reaches the published versions of the index (design decision D5 of
-- 2026-11-10, lot E1). A version's bytes are the projection of the uploads it was built from: until now
-- erasing a repository's content removed the uploads' bytes and left every earlier version of the index
-- whole, which the export archive packed again. ADR-0009 promises the erasure, on demand or 30 days after
-- a removal.
-- erased_at marks a version whose bytes were erased. Its digests (sha256, manifest_sha256), its seq and
-- its manifest stay: the journal's entries name them, and replay.json says which index no longer replays.
-- The check holds an erased version to no byte at all. The trigger holds every version to what it is: a
-- row written once by its publication, whose only later change is that erasure. With it, the UPDATE the
-- grants give (rw_app since 0001, rw_maint from this migration on, for the retention job and the replay
-- after a restore) can empty a version and nothing else: not rewrite its bytes, not move a digest, not
-- bring an erased version back. The date of an erasure is the database's: the trigger writes now() over
-- whatever date the statement gives, so that neither role can date an erasure in the past, or at
-- infinity (review finding C24 of 2026-11-10).
alter table rw.fleet_index add column erased_at timestamptz;
alter table rw.fleet_index add constraint fleet_index_erased_holds_no_byte check (erased_at is null or octet_length(bytes) = 0);
create function rw.fleet_index_written_once() returns trigger
  language plpgsql set search_path = pg_catalog, rw, pg_temp as $$
begin
  if (new.tenant_id, new.version, new.sha256, new.manifest_sha256, new.manifest, new.fleet_version, new.fleet_archive_sha256, new.seq, new.published_at)
     is distinct from
     (old.tenant_id, old.version, old.sha256, old.manifest_sha256, old.manifest, old.fleet_version, old.fleet_archive_sha256, old.seq, old.published_at) then
    raise exception 'a published index version is written once: only its bytes are erased';
  end if;
  if new.bytes is distinct from old.bytes and (octet_length(new.bytes) <> 0 or new.erased_at is null) then
    raise exception 'a published index version is written once: its bytes are erased, never rewritten';
  end if;
  if old.erased_at is not null and new.erased_at is distinct from old.erased_at then
    raise exception 'a published index version is written once: an erasure is not undone';
  end if;
  if old.erased_at is null and new.erased_at is not null then
    new.erased_at := now();
  end if;
  return new;
end $$;
create trigger fleet_index_written_once before update on rw.fleet_index for each row execute function rw.fleet_index_written_once();
