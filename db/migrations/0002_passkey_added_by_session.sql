-- Expansion: which session added a passkey, so the banner "a passkey was added" shows in the OTHER
-- sessions only (PADR-0012 complement, T27), never in the one that made the gesture. A defect the local
-- witness found: the founder's own arrival showed the warning about its own second passkey.
alter table rw.passkey add column added_by_session uuid;
