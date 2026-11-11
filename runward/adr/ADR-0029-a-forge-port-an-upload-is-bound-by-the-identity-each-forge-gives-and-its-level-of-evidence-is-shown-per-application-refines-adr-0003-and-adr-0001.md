# ADR-0029: A forge port: an upload is bound by the identity each forge gives, and its level of evidence is shown per application (refines ADR-0003 and ADR-0001)

**Date**: 2026-11-11
**Status**: proposed (written by an agent session; the author decided on 2026-11-11 that the service receives from forges other than GitHub and validated the plan this record writes down; revised twice the same day after two passes of an adversarial review, `runward/governance/reviews/2026-11-11_adr-review_49bf59d.md`; it awaits his acceptance, and no code follows it in this pull request)
**Refines**: ADR-0003 (accepted 2026-11-06), whose trigger "a first GitLab repository" this record answers and whose rules for an upload stay in force, unchanged, for GitHub; ADR-0001 (accepted 2026-11-06) on one point: "the only destination outside the hoster is the OIDC issuer's keys" becomes the keys of two public issuers
**Scope**: the port, GitHub behind it, gitlab.com, and GitLab instances a tenant registers. Azure DevOps is ADR-0030, a direction without rules yet.
**Deciders**: Thibault Souris (author). Written by an agent session.
**Method**: decision-loop: reality-check (the code at `main@6686854`, and four real tokens and the key set of a self-managed GitLab CE 17.11.1 read on 2026-11-11), sourced state of the art (GitLab's documentation of its CI identity tokens), challenge (an adversarial review on another model), durable position

## Context

ADR-0003 accepted "GitHub only" as a cost and named its reopening signal: a first GitLab repository. The author decided on 2026-11-11 that the hosted service receives from GitLab (gitlab.com and self-managed instances). The decision is taken at a domain port and at two adapters' boundaries (the token verifier, the store), and it touches a founding property: ADR-0003 holds that "an agent of the repository cannot supply the file". GitLab signs nothing that says which code ran, so the property cannot be carried over by an adapter; what each path proves has to be said.

**What the code does today** (checked against `main@6686854`):

- One issuer per process: `src/main.js` reads `RW_OIDC_ISSUER` (default GitHub's) into `config.issuer`, builds one `githubVerifier`, and `compose` builds the egress list from that issuer's host and the object store's host. `src/operator-gateway.js` passes `RW_OIDC_ISSUER` to its children. The verifier (`src/adapters/oidc/github.js`) reads `${issuer}/.well-known/jwks`, accepts RS256 with a known `kid`, an exact `iss`, one exact `aud`, `exp`, `nbf` and `iat` within 60 s. It sets no bound on a token's age.
- `src/application/ingest.js#upload` reads the maintenance state in the database before it verifies the token.
- The claims are GitHub's by name: `src/domain/workload.js#readClaims` requires `repository`, a numeric `repository_id`, `run_id`, `run_number`, `run_attempt`; `checkGenericClaims` requires `event_name` push, `refs/heads/main`, `github-hosted`, and `job_workflow_ref` with a published `job_workflow_sha`; `placeUpload` orders by `run_number` then `run_attempt`, and opens an epoch when `run_number` goes back while `run_id` goes forward.
- The store has a `forge` column that admits one value: `rw.forge_repository.forge check (forge in ('github'))`. Its two unique indexes, `(forge, name_key)` while pending and `(forge, repository_id)` once pinned, carry no tenant: they are global (`db/migrations/0001_floor.sql`; `global: true` in `src/adapters/store/memory.js`), and `rw.resolve_repository` reads across tenants by design (ADR-0006). `rw.oidc_jti`, `rw.rate_counter` and `rw.refused_counter` carry neither a tenant nor an issuer.
- The confirmation pins what the last pending send carried, not the first: each pending send overwrites `repository.pendingSend` (`ingest.js`), and the gesture `repository-confirm` is bound to the repository's id alone (`repositories.js#confirm`, `src/domain/repository.js#confirmation`).
- A repository is declared as `owner/repo` (`repository.js#OWNER_REPO`) with a workflow under `.github/workflows/`; the pinned runward-fleet refuses a `repository` that does not read exactly `host/owner/repo` and a host that carries a port (`package/src/build.js` of `vendor/runward-fleet-0.46.0-d0528149.tgz`); `src/adapters/fleet/assembler.js` writes `github.com/` before the name.
- The declared branch is stored (`repository.defaultBranch`) and not read by the verification, which requires `main`.
- The commit an upload is recorded under is the token's `sha` claim, and the index says so (`assembler.js`: `commitSource`).
- The words are GitHub's. Seven refusals of the upload give a GitHub remedy or rule (`src/domain/refusals/floor.js`: `token-missing`, `token-unreadable`, `token-expired`, `token-replayed`, `called-workflow-not-pinned`, `ref-not-main`, `repository-malformed`), beside `runner-not-hosted`, `event-not-push`, `workflow-not-pinned` and `workflow-malformed`, which are GitHub's rules. The shell builds GitHub addresses and forms (`web/views/workflow.js`, `web/views/claims.js`, `web/views/declarer.js`, `web/views/lexique.js`), and `web/views/decision.js` refuses, for the command "verify by yourself", any host but `github.com`.

**What a real GitLab token says** (four pipelines on a self-managed GitLab CE 17.11.1 on the author's server, 2026-11-11; header `alg` RS256 with a `kid`, `exp - iat` = 3600 s, `nbf = iat - 5`):

- `ci_config_ref_uri` and `ci_config_sha` name the root pipeline definition. The first reads `host:port/group/project//.gitlab-ci.yml@refs/heads/<branch>`, with no scheme; the second equalled `sha` in the three pipelines whose definition lives in the project.
- When the definition lives in another project (`ci_config_path` = `file@other/project`), both claims are **absent** from the token.
- A job moved into a file brought in by `include: local` changes neither `sub` nor `ci_config_ref_uri`. Nothing in the token names an include from another project, from a URL, a template or a component.
- `ref_protected` is the string `"true"` or `"false"`. `project_id` and `namespace_id` are strings of digits; `runner_id` is a number.
- A pipeline started through the API on `main` carries the same claims as a push, with `pipeline_source` `api`; the variables such a call may pass were not exercised.
- The discovery document announces `jwks_uri` under `https` while `iss` reads `http`. The key set holds two RSA keys, of 4096 and 2048 bits; the CI tokens are signed by the 2048-bit one; each `kid` is the key's RFC 7638 thumbprint (recomputed).
- Not observed yet: a tag, a merge request, a child or triggered pipeline, a CI/CD component, a pipeline execution policy, variables passed at trigger, gitlab.com itself.

## Decision

**An upload is bound by the identity its forge signs, through one port with one adapter per forge; the service computes, at each upload, the level of evidence that identity reaches, journals it with what it rests on, and shows it on the application's screen with what it does not prove.** GitHub's upload path does not change: same rules, same refusal codes, same order.

### 1. The port

The `WorkloadVerifier` port becomes a registry of issuers, and each forge has two halves.

- **The adapter** (`src/adapters/oidc/<forge>.js`, the signature check shared in one module): given a token, it returns the verified claims with the issuer that signed them, the `kid` and the key's thumbprint, or a refusal code, or `VerifierUnavailable`. It holds the key set: read from a fixed address for a public issuer, read from the store for a registered one.
- **The forge's rules** (pure, in `src/domain/`, as `checkGenericClaims` is today): `normalize(claims)` gives one `WorkloadIdentity`: `forge`, `issuerKey`, `repositoryId`, `ownerId`, `path`, `ref`, `refType`, `refProtected`, `commit`, `definition { ref, sha }`, `order { major, minor, at }`, `replayId`, `issuedAt`, and the informative claims; `check(identity, repository)` applies the forge's pins; `level(identity, repository)` names the level reached and what it rests on.

What stays forge-agnostic: the tenant and its isolation (ADR-0006), the declaration and its missions, the confirmation by passkey, consent (ADR-0009), the order of the checks (headers and token, then the repository, then the body), the rate, the journal (ADR-0007), the assembly and the index (ADR-0004), the verdict, which is runward's and stays `ci-declared`.

**Several issuers in one process.** Two values of a token are read before its signature, only to choose a key set: `iss`, and for a registered instance `aud`. Both are compared by exact string equality, never by prefix and never normalised.

- Public issuers are a closed list in the code: GitHub's and `https://gitlab.com`. A token whose `iss` is one of them is checked with that issuer's keys, and the registered instances are never consulted for it.
- Any other token must carry the audience of a registration (section 4), and is checked with that registration's keys. The two never mix: a gitlab.com token must carry exactly `https://app.runward.dev`, and one that carries a registration's audience is refused `token-audience`.
- Everything else is answered `token-unreadable`: an unknown issuer, an unknown registration, an issuer that is not the registration's, an unknown `kid`, a bad signature. One code, one status, one text, and nothing written in any tenant's journal. That registrations cannot be enumerated rests on the 128 random bits of a registration's identifier. The answer's time is equalised as a best effort only: every failing case goes through exactly one signature check, against a fixed decoy key of the largest size admitted (4096 bits) where no key was found. The cost is new and is said: any token that names a registration costs one database read and one RSA check, after the call was counted for its address; T32's row is amended with the implementation.
- Nothing a token or a discovery document carries is ever fetched: no `jku`, `x5u` or `jwk` header, no `jwks_uri`.
- The egress list, built in `src/main.js#compose`, holds the object store's host and, instead of one issuer's host, two: GitHub's token host and `gitlab.com`. Only public keys are read there, and redirects stay refused (`src/adapters/system/egress.js`). `RW_OIDC_ISSUER` keeps its one meaning, the address of the GitHub adapter's issuer for a local witness; it never adds an issuer, and the gateway passes it as today.
- The witness tenant's exception (`fromProductMain`) and the witness reader (ADR-0012, audience `/read`) stay GitHub's alone.

**The store** (one expand-only migration): `forge in ('github', 'gitlab')`, and an **issuer key** on `rw.forge_repository`. For a public issuer the issuer key is the issuer's string. **For a registered instance it is the registration itself, a row of the tenant, never the issuer's string**: two tenants that register the same string hold two issuer keys. The issuer key enters every key that today has none: the pending index `(forge, issuer key, name_key)`, the pinned index `(forge, issuer key, repository_id)`, `rw.resolve_repository`, `rw.oidc_jti`, `rw.rate_counter`, `rw.refused_counter`. So a tenant that registers another's issuer string with its own key can neither take a project's identifier, nor block it, nor learn that it is declared elsewhere, nor spend its counters. The journal's workload reads `gitlab:<issuer key>:<id>`, and stays `github:<id>` for GitHub, whose chained entries are not rewritten.

**The repository's identity.** The stable identifier is the forge's (`repository_id`, `project_id`); the name is the full path, of two segments or more (`group/subgroup/project`). The index names it `host[:port]/full/path`, which the pinned runward-fleet refuses today: runward-fleet must admit more than three segments and a host with a port, then be re-pinned by the procedure of ADR-0021. Until that pin, such a path is refused at declaration with its reason, never truncated. The pipeline definition replaces the "workflow" of the declaration: a path in the repository, `.gitlab-ci.yml` by default. The verification reads the declared branch for GitLab; GitHub keeps `main` until `send.yml` reads it too.

**The confirmation, for every forge.** The gesture `repository-confirm` is bound to the repository and to a digest of the values to pin, which the screen shows (for GitLab: the issuer key, `project_id`, `namespace_id`, `project_path`, `ci_config_ref_uri`; for GitHub: `repository_id`, `repository_owner_id`). These values are the same from one push to the next, so a repository that keeps sending can still be confirmed. When the gesture arrives the service recomputes the digest from the pending send and refuses `confirmation-stale` if the values to pin are no longer those shown; the screen then shows the new ones. What is pinned is what the member saw. **This is the one change that reaches GitHub, and it is not purely an addition**: it refuses more, and the gesture's object becomes the repository's id with the digest (`src/application/identity.js`, where a grant is bound to a gesture and its object), so a shell page opened before the deploy is answered `gesture-required` once and asks for the verification again.

**The words.** A refusal keeps its code and status; its remedy is chosen by the forge of the token. `token-expired` and `token-replayed` ("re-run failed jobs"), `token-audience` ("the send workflow sets it": on GitLab the customer writes the audience, and the remedy gives the exact value), and `repository-malformed` take a remedy per forge, GitHub's unchanged. The two refusals answered before a forge is known (`token-missing`, `token-unreadable`) take a remedy that names no forge: the one rewording of an existing text. GitLab's rules get codes of their own, added (section 3); none of GitHub's rule codes (`ref-not-main`, `called-workflow-not-pinned`, `runner-not-hosted`, `event-not-push`, `workflow-not-pinned`) is ever answered to a GitLab token.

### 2. The levels of evidence

The level describes the path the file took, never its content, which stays `ci-declared` at every level. The screen shows the sentence first and the code after it.

| What the screen says the token proves | What it says is not proven | Code | Reached by |
|---|---|---|---|
| The product's send workflow, at a published commit, ran runward and sent the file. An agent of the repository cannot supply the file. | That the content is true. | P1 | GitHub |
| The pipeline this repository defines computed the verdict: gitlab.com signed that its root definition is the confirmed file, at the same commit as the code, on the declared branch, and that this branch is protected. | That the definition is the product's. Whoever can land a commit on that branch can change what the pipeline computes. Not signed, and able to change the result: what the definition includes from outside the repository; the CI/CD variables of the project, its groups and the instance, and those passed when a pipeline is started; the machine that ran the job, which holds the token while it runs; the protection's own rules, which the service does not read (who may push or merge, whether a forced push is allowed). | P3 | gitlab.com, protection required |
| The pipeline this repository defines computed the verdict: gitlab.com signed that its root definition is the confirmed file, at the same commit as the code, on the declared branch. This fleet chose not to require that the branch be protected. | Everything the line above does not prove; and that the branch is protected: anyone who may push to it, or create it, can send. | P3b | gitlab.com, protection lifted for the repository |
| The holder of a key this fleet registered sent the file, and that key signed the claims shown (project, branch, protection, definition, commit). | Everything those claims say: the service has not checked that the key belongs to a GitLab instance. Whoever holds the key can sign any claim, with no GitLab at all. | P4 | a registered GitLab instance |

- The level is computed from the verified token at each upload, never chosen, and never raised by something the customer declares. Lifting the protection requirement is a gesture bound to the repository (`protection-lift`), and it lowers the level to P3b; it does not add a note under P3. Requiring it again (`protection-restore`) withdraws an access: it is replayed by a restore (T24).
- It is written in the upload's journal entry with what it rests on: the issuer key and whether it is public or registered, the `kid` and the key's thumbprint, whether protection was required.
- It is shown by the shell on the application's screen, beside runward-fleet's reading, which stays byte for byte, and at declaration, before the customer adds a pipeline; in both languages (`web/views/lexique.js`). An application with no level shown is a defect.
- A level between P1 and P3 (a definition kept outside the repository, pinned by its digest, that the repository cannot override: GitLab's pipeline execution policies) is neither built nor observed. It is not shown anywhere while nothing reaches it.
- The index carries the level only when runward-fleet has a field for it (a decision of runward's).

### 3. GitLab's rules

Refused unless every line holds, fail closed, in this order. The same rules apply to gitlab.com and to a registered instance; only the level differs.

1. The token: `iss` exactly the issuer; `aud` single and exact; RS256 only, a known `kid`; `exp` and `iat` required, `nbf` when present, 60 s of skew; **refused `token-too-old` when it is more than 10 minutes old** (`now - iat`), whatever its `exp`. GitLab issues the token when the job starts (GitLab's documentation; not yet read on a token, the step-c witness measures it), not on demand: so the send job is separate from the job that computes, does not clone the repository and pulls a light image, and the witness of step c measures the time from `iat` to reception on a real runner before the bound of 10 minutes is frozen. The remedy names both causes: a send job that does more than send, and the instance's clock. `jti` is used once within its issuer key, and kept until `exp`.
2. The repository: `project_id` pinned at the confirmation, with `namespace_id` as the owner (`owner-changed` when it moves); while pending, resolved by `project_path` within the issuer key.
3. The definition: `ci_config_ref_uri` and `ci_config_sha` both present (else `definition-absent`); `ci_config_ref_uri` equal, as a whole string, to the pinned value; `ci_config_sha` equal to `sha`; `sha` is the commit the upload is recorded under. A token with neither claim (a definition in another project) is refused. At the confirmation, the service compares the pending send's `ci_config_ref_uri` with the declaration: it must end with `//<declared file>@refs/heads/<declared branch>`, and what precedes must end with the token's `project_path`; a mismatch is shown and cannot be confirmed. The declared file is a path of letters, digits, `.`, `_`, `-` and single `/`, with no `@` and no `//`. A renamed or moved project changes the value, is refused `definition-not-pinned`, and waits for a new confirmation; so does a change of the declared branch or file, which unpins the value: every upload is refused `definition-not-pinned` until the member confirms again, and the app says so when the declaration is changed.
4. The branch: `ref_type` is `branch`, `ref` is the declared branch, `ref_protected` is the string `"true"` unless the requirement was lifted for the repository.
5. The source: `pipeline_source` is `push`. Every other source is refused until a witness reads its token: `api` carries the same claims but may carry variables, which were not exercised; the others were not observed.
6. Informative, journaled and shown, never a pin: `user_access_level`, `runner_id`, `runner_environment`. `user_login` and `user_email` are dropped when the claims are read: no e-mail address is kept (ADR-0005), and GitHub's `actor` is not kept either.
7. The order of uploads: `pipeline_id`, then `job_id`, within an epoch; `job_id` never ties, so these two numbers are the whole order. `iat` is kept beside them for the signal below only, never to order. An instance restored from a backup counts again from lower numbers, and its uploads would all be ranked historical. No rule can tell that from a late job of an old pipeline, so the epoch is not opened by the service: whenever an upload issued later than the current one is ranked historical, the application's screen says so, with both orders, and a member opens a new epoch by a gesture bound to the repository (`order-epoch-open`), journaled.

New refusal codes, added to the contract: `token-too-old`, `definition-absent`, `definition-not-pinned`, `commit-mismatch`, `ref-not-declared`, `ref-not-protected`, `source-not-admitted`, `key-retired`, `confirmation-stale`.

`key-retired` is answered, and written in the tenant's journal, **only after the signature holds under the retired or expired key**, which the service keeps for that purpose. A token that names a registration and a `kid` without a valid signature is `token-unreadable` like any other: otherwise whoever holds a registration's identifier and a `kid` would get a distinct answer and could write refusals into a tenant's journal (T18).

**Includes from outside the repository: the service shows the level, it does not read the file.** Refusing them would mean reading `.gitlab-ci.yml` at each `sha`: a read access to the repository, a credential of the customer to hold, and a call to an instance that may not be reachable. The position is the level, said: P3's second sentence names them. The product's send component is offered for convenience and is never presented as pinned: a job of the same name overrides it.

### 4. Registered instances

- **Registration.** A member registers an instance by a passkey gesture (`issuer-register`, added to `src/domain/identity.js#GESTURES`) bound to the digest of what the screen shows, the issuer's string and the key's thumbprint, journaled and written to the security log before commit: the issuer, exactly as its tokens' `iss` reads, and **one key, the one whose `kid` a CI token's header names** (a job can print that header without printing the token). The member takes the key set from the instance's `/oauth/discovery/keys`, at the address he reaches inside his network; the service never calls it. The app shows the key's RFC 7638 thumbprint and requires the `kid` to equal it, as GitLab 17.11 makes it; the member compares it with the instance's.
- **What a key must be**, or the whole input is refused: `kty` RSA; a modulus of 2048 to 4096 bits; `e` 65537; `use` absent or `sig`; `alg` absent or RS256; no private or symmetric member (`d`, `p`, `q`, `dp`, `dq`, `qi`, `oth`, `k`); no `kid` twice. At most 4 live keys per registration and 5 registrations per tenant.
- **The audience names the registration.** For a registered instance the audience is `https://app.runward.dev/send/<id>`, where `<id>` is the registration's own identifier, 128 random bits or more, which is neither the tenant's identifier nor derivable from it; the path is disjoint from the reader's `/read`. The app writes it in the snippet it gives. The lookup by that identifier is an exact-key function (ADR-0006), made after the call is counted for its address (T32), and it answers nothing a caller can tell from a bad signature (section 1). `/send/` is a reserved prefix of the origin: no route is ever served under it.
- **The issuer's string is guarded at registration.** There, and only there, it is parsed: scheme `http` or `https`, no user info, no query, no fragment; the host lowercased, a trailing dot and a default port removed, an internationalised name refused. A host that is, or is under, a public issuer's host (`gitlab.com`, GitHub's token host), Entra's (`login.microsoftonline.com`, `sts.windows.net`: ADR-0030), or the service's own, is refused. The string stored and compared with `iss` is the one given, unchanged.
- **Rotation and compromise.** Add a key (`issuer-key-add`, bound to the digest of the key shown); retire a key (`issuer-key-retire`), **the last one included**: a registration with no live key receives nothing, and the app says so. This is the gesture for a key believed stolen, and it takes effect at once. A retired or expired key is kept, marked, so that a token it signed can be told `key-retired` (section 3). Retiring a key and removing a registration (`issuer-remove`) withdraw an access: they are replayed by a restore (T24), as `protection-restore` is. A key expires 365 days after it was added unless confirmed again by a gesture; the app warns 30 days before. Removing a registration is refused while a repository is declared on it.
- **What a retired key signed** stays: the uploads keep their place in the journal and the index, and each is marked, from its journaled `kid` and thumbprint, as signed by a key since retired, with the date. Erasing their content is the existing gesture (ADR-0009, ADR-0020).
- gitlab.com is a public issuer: its key set is read at a fixed address in the adapter and cached as GitHub's is.

### 5. Rollout, and the witness each step needs

| Step | Witness before it is called done | Depends on |
|---|---|---|
| a. The port, GitHub alone behind it; the confirmation bound to what is shown | the suites unchanged in name and result for the upload, the deploy's smoke-send, `/api/version` | this record accepted |
| b. runward-fleet admits long paths and a port; re-pin | `node scripts/verify-runward-fleet.mjs`, an index with a three-level path replayed | runward's pull request; its own record here |
| c. A registered GitLab instance | a real upload from the author's GitLab CE instance to production, shown P4; planted refusals: an unprotected branch, a definition in another project, a retired key, another registration's audience, a token 11 minutes old, a `pipeline_source` `api`, a retired key's `kid` with a bad signature (answered `token-unreadable`, nothing journaled); the time from `iat` to reception measured on the real runner; and on PostgreSQL, **two tenants that register the same issuer string and declare the same `project_id`: both pin, no upload crosses, no counter and no replay id is shared** | a, b |
| d. gitlab.com | the claims of a current gitlab.com token read first; then a real upload from a gitlab.com project on hosted runners, shown P3, and one with protection lifted, shown P3b | c; a gitlab.com account, the author's |

The public site names a forge only once its witness is in `runward/JOURNAL.md`. Later, each with its own record: Azure DevOps (ADR-0030), the level between P1 and P3 by an execution policy, sources other than `push`, Bitbucket, an upload signed by a registered key without a forge (Jenkins), key discovery with a guard against server-side request forgery.

### 6. Points of the security review

This is identity code: it is written and reviewed on the model the author reserves for critical code, and the review answers each line.

1. A key set is chosen by exact equality on unverified strings (`iss`, and `aud` for a registration); the signature is then checked with that set only; `iss` and `aud` are compared again after the check.
2. The algorithm comes from a per-issuer list (RS256); `none` and any HMAC are refused; a key's type, size and exponent are checked when it is registered and when it is read.
3. No value of a token or of a discovery document becomes an address.
4. Every claim is typed before it is compared (`ref_protected` a string, ids strings of digits); an absent claim refuses, never passes.
5. `ci_config_ref_uri` is compared whole at each upload; the comparison with the declaration, at the confirmation, uses string suffixes, no address parser.
6. Every key of the store that names a repository, a replay id or a counter carries the issuer key, which for a registration is the tenant's own row. The planted control of step c proves it.
7. Registered keys live in tenant tables under forced row-level security; the lookup before the tenant is set is a `SECURITY DEFINER` function by exact key with its `search_path` set (the lesson of T34).
8. Retiring a key, removing a registration and requiring a branch's protection again are replayed by a restore (T24); an upload's entry names the key that signed it; `key-retired` is answered and journaled only after a valid signature under that key.
9. Before a signature holds, the service reads no tenant's data except, for a registration's audience, that registration's keys, after the call was counted for its address (T32). The maintenance state is read before the token, as today. Before the tenant is known, one answer and nothing in any journal (T18); every failing case costs one signature check, the decoy's included; the equal time is a best effort, the 128-bit identifier is what keeps registrations from being listed.
10. Every new claim shown passes `cleanClaim` and the view's escaping (T20).
11. GitHub's refusals keep their codes, order and status: a parity suite on the existing cases, planted controls included.
12. The API contract changes by addition, with the two exceptions section 1 names and no other: two remedies reworded without a forge's name, and the object of `repository-confirm`. Its digest test says so.
13. A token older than 10 minutes is refused for GitLab whatever its `exp`; its `jti` is kept until `exp`; the bound is frozen on the measure of step c.
14. The confirmation refuses when the values to pin are not those the screen showed; a new push that carries the same values changes nothing.
15. `/send/` serves nothing; a gitlab.com token with a registration's audience is refused.
16. The gestures that register or add a key are bound to the digest of the key shown.

## Alternatives discarded

- **One process or one deployment per forge**: three services to deploy and prove for one human (ADR-0010), and the tenant's index is one.
- **Read the pipeline definition at each `sha` to refuse outside includes**: a read access to the code and a customer credential, and a call to instances that are not reachable.
- **Fetch a registered instance's keys from an address the tenant gives**: a request forged from the server's side, and most such instances are not reachable from the internet; kept for a later record with its guard.
- **Key the store by the issuer's string**: a tenant that registers another's string with its own key takes or blocks its projects, learns that they are declared, and spends their counters.
- **A registered issuer trusted service-wide, or reserved to the first tenant that registers it**: the first lets one tenant sign for another's repositories; the second lets a stranger reserve an instance's name and tells who registered it.
- **Show a registered instance at P3**: a key pair made on a laptop signs `ref_protected: "true"` as well as an instance does.
- **Register the whole key set of an instance**: the witness instance's set holds a second key that does not sign CI tokens.
- **Answer `key-retired` as soon as a retired `kid` is named**: a distinct answer without a signature, and a way to write into a tenant's journal.
- **Never retire the last key** (the passkeys' rule): a stolen key must be stoppable at once; for a machine's key the safe state is no upload.
- **Present the GitLab component as the equivalent of `send.yml`**: no claim says a component ran, and a job of the same name overrides it.
- **An API token per repository**: discarded by ADR-0003, still discarded.

## Consequences

- **Positive**: GitLab repositories enter with no customer secret held by the service; the difference between paths is a sentence on the application's screen instead of a silence; a registered instance needs no inbound access; no new production dependency; the confirmation pins what the member saw, on GitHub too.
- **Negative, accepted**: "an agent of the repository cannot supply the file" holds at P1 only, and the app says so below it; a registered instance is shown P4 however well it is run; two outside hosts instead of one; a token that names a registration costs a database read and an RSA check before anything is known of it; a shell page opened before the deploy asks once more for the verification of a confirmation; each registration has its own audience, so its snippet differs from gitlab.com's; a pipeline started by hand or by the API does not send; key rotation and a counter reset after an instance's restore are human gestures, and an expired key stops uploads until it is confirmed.
- **On other boundaries**: `runward/contracts/api-contract.json` grows by addition, two remedies reworded; the threat model gains the registered issuer, the squatted issuer string, the confused issuer and the shared counter; `runward/governance/observability-schema.md` gains the level, its basis and the key in the upload's entry; the runbook gains the key rotation and the stolen key; runward-fleet's path rule is a change in runward, then a re-pin.

## Reevaluation trigger (mandatory, dated)

Reopen on 2027-02-11, or earlier: a real token contradicts a rule of section 3 (a GitLab version that changes `ci_config_ref_uri`'s form, `ref_protected`'s type or the `kid`'s construction; a gitlab.com token that differs from the instance's); a first customer whose GitLab has execution policies; a first registered customer who cannot paste a key; a customer whose pipelines send only from a source other than `push`; a forged or crossed upload (incident); a forge that signs the definition that ran; runward-fleet gains a field for the level.

**Trigger set on**: 2026-11-11 · **Watched via**: the refusal codes of the journal by forge, the witnesses of section 5 in `runward/JOURNAL.md`, `test/unit/ingest.test.js`, `test/pg/isolation.test.js`

## References

- ADR-0001, ADR-0003, ADR-0004, ADR-0005, ADR-0006, ADR-0007, ADR-0009, ADR-0012, ADR-0020, ADR-0021, ADR-0030
- `src/adapters/oidc/github.js`, `src/domain/workload.js`, `src/application/ingest.js`, `src/application/repositories.js`, `src/domain/repository.js`, `src/domain/refusals/floor.js`, `src/main.js`, `src/operator-gateway.js`, `db/migrations/0001_floor.sql`, `src/adapters/store/memory.js`, `src/adapters/fleet/assembler.js`
- `runward/governance/reviews/2026-11-11_adr-review_49bf59d.md`
- GitLab Docs: OpenID Connect ID tokens in CI/CD (`id_tokens`, the token's claims); CI/CD components; pipeline execution policies; protected branches
- RFC 8725 (JSON Web Token best current practices), RFC 7638 (JWK thumbprint), RFC 9530 (digest fields)
