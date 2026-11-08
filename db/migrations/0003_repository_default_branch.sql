-- Expansion: the repository's default branch, declared with it (PADR-0021 point 8, proposed). The public API of
-- GitHub does not give the default branch of a private repository without a token, and the service holds none:
-- the member declares it, `main` by default. It names the branch of the link that opens GitHub's create-file
-- page; the upload's pin stays refs/heads/main until PADR-0021 is ratified.
alter table rw.repository add column default_branch text not null default 'main';
