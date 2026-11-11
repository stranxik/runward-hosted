# ADR-0029: A forge port: an upload is bound by the identity each forge gives, and its level of evidence is shown per application (refines ADR-0003 and ADR-0001)

**Date**: 2026-11-11
**Status**: proposed (written by an agent session; the author decided on 2026-11-11 that the service receives from GitLab and Azure DevOps, and validated the plan this record writes down; this record awaits his acceptance, and no code follows it in this pull request)
**Refines**: ADR-0003 (accepted 2026-11-06), whose trigger "a first GitLab repository" this record answers and whose rules stay in force, unchanged, for GitHub; ADR-0001 (accepted 2026-11-06) on one point: "the only destination outside the hoster is the OIDC issuer's keys" becomes a closed list of three issuers' keys
**Deciders**: Thibault Souris (author). Written by an agent session.
**Method**: decision-loop: reality-check (the code at `main@6686854`, and four real tokens of a self-managed GitLab CE 17.11.1 read on 2026-11-11), sourced state of the art (the forges' documentation of their identity tokens), challenge, durable position

## Context

ADR-0003 accepted "GitHub only" as a cost and named its reopening signal: a first GitLab repository. The author decided on 2026-11-11 that the hosted service receives from GitLab (gitlab.com and self-managed instances) and from Azure DevOps Services by 2026-11-17, and from Bitbucket and Jenkins later. The decision is taken at a domain port and at two adapters' boundaries (the token verifier, the store), and it touches a founding property: ADR-0003 holds that "an agent of the repository cannot supply the file". No other forge signs what GitHub signs, so the property cannot be carried over by an adapter alone; what each forge proves has to be said.

**What the code does today** (checked against `main@6686854`):

- One issuer per process: `src/main.js` reads `RW_OIDC_ISSUER` (default GitHub's) into `config.issuer`, builds one `githubVerifier` and opens the egress to that one host (`compose`). The verifier (`src/adapters/oidc/github.js`) reads `${issuer}/.well-known/jwks`, accepts RS256 with a known `kid`, an exact `iss`, one exact `aud`, `exp`, `nbf` and `iat` within 60 s.
- The claims are GitHub's by name: `src/domain/workload.js#readClaims` requires `repository`, a numeric `repository_id`, `run_id`, `run_number`, `run_attempt`; `checkGenericClaims` requires `event_name` push, `refs/heads/main`, `github-hosted`, and `job_workflow_ref` with a published `job_workflow_sha`; `placeUpload` orders by `run_number` then `run_attempt`.
- The store has a `forge` column that admits one value: `rw.forge_repository.forge check (forge in ('github'))`, unique on `(forge, repository_id)` once pinned and on `(forge, name_key)` while pending (`db/migrations/0001_floor.sql`); `src/application/ingest.js` and `src/application/repositories.js` pass `"github"` as a literal.
- Three keys are not scoped by issuer: `rw.oidc_jti (jti primary key)`, `rw.rate_counter` and `rw.refused_counter` (keyed by `repository_id` alone). With a second issuer, project `1` of any GitLab instance would share its counters with GitHub's repository `1` and with every other instance's project `1`.
- A repository is declared as `owner/repo` (`src/domain/repository.js#OWNER_REPO`) with a workflow under `.github/workflows/`; the pinned runward-fleet refuses a `repository` that does not read exactly `host/owner/repo` and a host that carries a port (`package/src/build.js` of `vendor/runward-fleet-0.46.0-d0528149.tgz`); `src/adapters/fleet/assembler.js` writes `github.com/` before the name.
- The declared branch is stored (`repository.defaultBranch`) and not read by the verification, which requires `main` (`workload.js`, and `send.yml`).
- The commit an upload is recorded under is the token's `sha` claim, and the index says so (`assembler.js`: `commitSource`).
- The shell builds GitHub addresses (`web/views/workflow.js`, `web/views/claims.js`, `web/views/decision.js`), and two refusals speak of GitHub (`src/domain/refusals/floor.js`: `runner-not-hosted`, `workflow-malformed`).

**What a real GitLab token says** (four pipelines on a self-managed GitLab CE 17.11.1 on the author's server, 2026-11-11; header `alg` RS256 with a `kid`, `exp - iat` = 3600 s, `nbf = iat - 5`):

- `ci_config_ref_uri` and `ci_config_sha` name the root pipeline definition. The first reads `host:port/group/project//.gitlab-ci.yml@refs/heads/<branch>`, with no scheme; the second equalled `sha` in the three pipelines whose definition lives in the project.
- When the definition lives in another project (`ci_config_path` = `file@other/project`), both claims are **absent** from the token.
- A job moved into a file brought in by `include: local` changes neither `sub` nor `ci_config_ref_uri`: that file is covered only because it is in the same repository at the same commit. Nothing in the token names an include from another project, from a URL, a template or a component.
- `ref_protected` is the string `"true"` or `"false"`. `project_id` and `namespace_id` are strings of digits; `runner_id` is a number.
- The instance's discovery document announces `jwks_uri` under `https` while `iss` reads `http`: the two do not agree on a real instance.
- Not observed yet: a tag, a merge request, a child or triggered pipeline, a CI/CD component, a pipeline execution policy, gitlab.com itself.

## Decision

**An upload is bound by the identity its forge signs, through one port with one adapter per forge; the service computes, at each upload, the level of evidence that identity reaches, journals it, and shows it on the application's screen with what it does not prove.** Nothing about GitHub changes: same rules, same refusals, same order.

### 1. The port

The `WorkloadVerifier` port becomes a registry of issuers, and each forge has two halves.

- **The adapter** (`src/adapters/oidc/<forge>.js`, the signature check shared in one module): given a token, it returns the verified claims with the issuer that signed them, or a refusal code, or `VerifierUnavailable`. It holds the forge's key set: read from a fixed address for a public issuer, read from the store for a registered one.
- **The forge's rules** (pure, in `src/domain/`, as `checkGenericClaims` is today): `normalize(claims)` gives one `WorkloadIdentity`: `forge`, `issuer`, `repositoryId`, `ownerId`, `path`, `ref`, `refType`, `refProtected`, `commit`, `definition { ref, sha }`, `order { major, minor }`, `replayId`, `issuedAt`, and the informative claims; `check(identity, repository)` applies the forge's pins; `level(identity, repository)` names the level reached.

What stays forge-agnostic and does not move: the tenant and its isolation (ADR-0006), the declaration and its missions, the first-send confirmation by passkey (`repositories.js#confirm`), consent (ADR-0009), the order of the checks (headers and token, then the repository, then the body), the rate, the journal (ADR-0007), the assembly and the index (ADR-0004), the verdict, which is runward's and stays `ci-declared`.

**Several issuers in one process.** The token's `iss` is read before the signature only to choose a key set, by exact string equality, never by prefix and never normalised. Public issuers are a closed list in the code: GitHub's, `https://gitlab.com`, and Entra's for Azure DevOps, one exact issuer per directory id a tenant declared (section 5). Any other `iss` is looked up among the registered issuers (section 4). An issuer found in neither is answered `token-unreadable`, before any signature check, the same answer as a bad signature. Nothing a token carries is ever fetched: no `jku`, `x5u` or `jwk` header, and not the discovery's `jwks_uri`. The egress list (`src/adapters/system/egress.js`) grows from one host to three: GitHub's token host, `gitlab.com`, `login.microsoftonline.com`; only public keys are read there, as today, and redirects stay refused. The witness tenant's exception (`fromProductMain`) and the witness reader (ADR-0012) stay GitHub's alone.

**The store** (one expand-only migration): `forge in ('github', 'gitlab', 'azure-devops')`; an `issuer` on `rw.forge_repository`, and the pinned key becomes `(forge, issuer, repository_id)`, the pending key `(forge, issuer, name_key)`; `rw.oidc_jti`, `rw.rate_counter` and `rw.refused_counter` are keyed by issuer too, so that no replay id, counter or resolution is shared between two issuers; the journal's workload reads `<forge>:<issuer>:<id>` for the new forges and stays `github:<id>` for GitHub, whose chained entries are not rewritten.

**The repository's identity.** The stable identifier is the forge's (`repository_id`, `project_id`, or the identity's object id on Azure DevOps); the name is the full path, of two segments or more: `group/subgroup/project` on GitLab, `organisation/project/repository` on Azure DevOps. The index names it `host[:port]/full/path`, which the pinned runward-fleet refuses today: runward-fleet must admit more than three segments and a host with a port, then be re-pinned by the procedure of ADR-0021. Until that pin, a path of more than two segments is refused at declaration with its reason, never truncated. The pipeline definition replaces the "workflow" of the declaration: a path in the repository, `.gitlab-ci.yml` by default on GitLab. The verification reads the declared branch for the new forges; GitHub keeps `main` until `send.yml` reads it too (a release of `send.yml`, the author's).

### 2. The levels of evidence

The level describes the path the file took, never its content, which stays `ci-declared` at every level.

| Level | What the token proves | What it does not prove | Reached by |
|---|---|---|---|
| P1 | the product's send workflow, at a published commit, ran runward and sent the file; an agent of the repository cannot supply the file | that the content is true | GitHub (`job_workflow_ref`, `job_workflow_sha`) |
| P2 | a definition kept outside the repository, pinned by its digest, that the repository cannot override, computed the verdict | what P1 does not; and nothing until a real token of such a job is read | GitLab with a pipeline execution policy (not built, not observed) |
| P3 | the pipeline the repository itself defines computed the verdict: its root definition is the declared file, at the same commit as the code, on the declared branch, which the forge says is protected | that the definition is the product's: whoever can land a commit on that branch can change what the pipeline computes, and the change is in the repository's history at that commit, except what the definition includes from outside the repository, which no claim pins | GitLab |
| P4 | the holder of an identity the tenant pinned sent the file | which pipeline, definition, branch or commit: none is signed; they are shown as declared | Azure DevOps, route A |

The level is computed from the verified token at each upload, written in the journal entry's detail, and shown by the shell on the application's screen, beside runward-fleet's reading, which stays byte for byte: the level's name, its sentence, and the sentence of what it does not prove, in both languages (`web/views/decision.js`, `web/views/claims.js`, `web/views/lexique.js`). It is shown at declaration too, before the customer adds a pipeline. A level is never raised by something the customer declares, and never hidden: an application with no level shown is a defect. The index carries the level only when runward-fleet has a field for it (a decision of runward's).

### 3. GitLab's rules

Refused unless every line holds, fail closed, in this order:

1. The token: `iss` exactly the issuer; `aud` single and exact (`https://app.runward.dev` for gitlab.com; section 4 for a registered instance); RS256 only, a known `kid`; `exp` and `iat` required, `nbf` when present, 60 s of skew; `jti` used once within its issuer.
2. The repository: `project_id` pinned at the first-send confirmation, with `namespace_id` as the owner (`owner-changed` when it moves, as today); while pending, resolved by `project_path`.
3. The definition: `ci_config_ref_uri` and `ci_config_sha` both present; `ci_config_ref_uri` exactly equal, as a string, to the value pinned for the repository; `ci_config_sha` equal to `sha`; `sha` is the commit the upload is recorded under. A token with neither claim (a definition in another project) is refused. The pinned value is the one the first send carried, shown to the member and confirmed by the passkey gesture that pins `project_id`; a renamed or moved project changes it, is refused, and waits for a new confirmation, as an owner change does.
4. The branch, the repository's policy: `ref_type` is `branch`, `ref` is the declared branch, `ref_protected` is the string `"true"`. A tenant may lift the protection requirement for a repository by a gesture; the level's line then says the branch is not protected.
5. Informative, journaled and shown, never a pin: `user_access_level`, `pipeline_source`, `runner_id`, `runner_environment` (`self-hosted` on a self-managed instance is not a refusal). `user_login` and `user_email` are dropped when the claims are read: no e-mail address is kept (ADR-0005), and GitHub's `actor` is not kept either. One guard: a `pipeline_source` whose claims have not been observed (anything but `push` and `api` on 2026-11-11) is refused until a witness says what its `ci_config_*` claims mean.
6. The order of uploads: `pipeline_id`, then `job_id`.

**Includes from outside the repository: the service shows the level, it does not read the file.** Refusing them would mean reading `.gitlab-ci.yml` at each `sha`: a read access to the repository, which ADR-0003 discarded, a credential of the customer to hold, and a call to an instance that may not be reachable. The position is the lower level, said: GitLab is P3, and P3's sentence names the includes that no claim pins. The product's send component is offered for convenience and is never presented as pinned: a job of the same name overrides it.

### 4. Self-managed instances

- A member registers the instance: its issuer, exactly as its tokens' `iss` reads, and its key set as a static JWKS, by a passkey gesture bound to the issuer (`issuer-register`, added to `src/domain/identity.js#GESTURES`), journaled and written to the security log before commit. The app shows each key's `kid` and RFC 7638 thumbprint to compare with the instance's.
- **The service never calls the instance**: no discovery, no key read. The instance only needs to reach `app.runward.dev`. Rotation is the member's: add a key (`issuer-key-add`), retire a key (`issuer-key-retire`), never the last one; removing the issuer is refused while a repository is declared on it. A registered key expires 365 days after it was added unless confirmed again by a gesture; the app warns 30 days before; a token signed by an expired or retired key is refused, in the tenant's journal.
- Accepted keys: RSA, 2048 bits or more, `kid` present, eight at most; a pasted set that carries a private member (`d`, `p`, `q`) is refused whole.
- **A registered issuer is trusted by its tenant alone.** Whoever holds the instance's signing key can sign any claim, so a registered issuer may only ever resolve repositories of the tenant that registered it. The token names that tenant: for a registered instance the audience is the origin followed by a path that names the tenant, which the app writes in the snippet it gives. The keys are looked up for that tenant, that issuer and that `kid`, by exact key (ADR-0006). Two tenants may register the same issuer; neither can receive, block or squat the other's repositories. An issuer of the closed list, or under one of its hosts, cannot be registered.
- gitlab.com is a public issuer: `iss` `https://gitlab.com`, its key set read at a fixed address in the adapter, cached as GitHub's is.

### 5. Azure DevOps Services, route A

The customer, once: (1) an Entra administrator creates, in the customer's directory, the service principal of runward's ingestion application (a multi-tenant application the author registers, with one application role, `Upload`); (2) a service connection with workload identity federation exists in the Azure DevOps project; (3) the role `Upload` is assigned to that connection's identity; (4) the connection is restricted in Azure DevOps: pipeline permissions, the branch control check, the required template check; (5) the repository is declared in runward with the Entra tenant id, the identity's object id, the organisation, project, repository and branch; (6) the pipeline extends the product's template, whose send job asks Entra for an access token for runward's application.

The service verifies: an issuer built from the pinned tenant id, an audience that is runward's application, `roles` containing `Upload`, `tid` and `oid` pinned, `uti` used once, the times. **The token proves that the identity the customer's administrator granted sent the file: P4.** It names no pipeline, repository, branch or commit; those are sent as headers, kept and shown as declared, and `commitSource` says so. The restrictions of step 4 are the customer's and invisible to the service: the app says them as declared and they never raise the level. One identity is pinned to one declared repository.

Discarded for Azure DevOps: the pipeline's raw OIDC token, whose audience is fixed (`api://AzureADTokenExchange`) and shared with every other relying party.

**Not witnessed, each to be settled on a real token before the adapter is merged**: the token version and so the exact `iss` and `aud`; the presence of `roles`, `uti` and `idtyp`; the lifetime; whether the CLI hands the same cached token to two calls of one job (then the single use counts per `uti`, mission and kind); whether the connection needs a subscription; the address of the key set.

### 6. Rollout, and the witness each step needs

| Step | Witness before it is called done | Depends on |
|---|---|---|
| a. The port, GitHub alone behind it | the suites unchanged in name and result, the deploy's smoke-send, `/api/version` | this record accepted |
| b. runward-fleet admits long paths and a port; re-pin | `node scripts/verify-runward-fleet.mjs`, an index with a three-level path replayed | runward's pull request; its own record here |
| c. GitLab, self-managed, registered keys | a real upload from the author's GitLab CE instance to production at P3, and four planted refusals: an unprotected branch, a definition in another project, a retired key, another tenant's audience | a, b |
| d. gitlab.com | a real upload from a gitlab.com project on hosted runners; the claims of a current gitlab.com token read first | c; a gitlab.com account, the author's |
| e. Azure DevOps Services, route A | a real upload at P4 from a real pipeline, and the list of section 5 settled | a; the author's gestures in Entra and Azure DevOps |

The public site names a forge only once its witness is in `runward/JOURNAL.md`. Later, each with its own record: GitLab P2 by an execution policy, a verified reading of Azure DevOps builds, Bitbucket, an upload signed by a registered key (Jenkins, closed instances), key discovery with a guard against server-side request forgery.

### 7. Points of the security review

This is identity code: it is written and reviewed on the model the author reserves for critical code, and the review answers each line.

1. The issuer is chosen by exact equality on an unverified string, and the signature is then checked with that issuer's keys only; `iss` is compared again after the check.
2. The algorithm comes from a per-issuer list (RS256); `none` and any HMAC are refused; key type and size are checked when a key is registered and when it is read.
3. No value of a token or of a discovery document becomes an address.
4. Every claim is typed before it is compared (`ref_protected` a string, ids strings of digits); an absent claim refuses, never passes.
5. `ci_config_ref_uri` is compared whole, never parsed.
6. Replay ids, rate and refusal counters and the resolution are keyed by issuer; a planted control proves project `1` of two issuers does not meet.
7. Registered keys live in tenant tables under forced row-level security; the lookup before the tenant is set is a `SECURITY DEFINER` function by exact key with its `search_path` set (the lesson of T34); the isolation suite gains two tenants that register the same issuer with different keys, 0 row and 0 upload crossing.
8. Retiring a key and removing an issuer withdraw an access: they join the gestures a restore replays (T24).
9. Before the tenant is known, one answer and nothing in any journal (T18); the cost of an unknown issuer is no signature check, and none of GitHub's or gitlab.com's tokens costs a database read before its signature holds (T32).
10. Every new claim shown passes `cleanClaim` and the view's escaping (T20).
11. GitHub's refusals keep their codes, order and status: a parity suite on the existing cases, planted controls included.
12. The API contract changes by addition only (new refusal codes, new fields), and its digest test says so.

## Alternatives discarded

- **One process or one deployment per forge**: three services to deploy and prove for one human (ADR-0010), and the tenant's index is one.
- **Read the pipeline definition at each `sha` to refuse outside includes**: a read access to the code and a customer credential (ADR-0003's third alternative), and a call to instances that are not reachable.
- **Fetch a self-managed instance's keys from an address the tenant gives**: a request forged from the server's side, and most such instances are not reachable from the internet; kept for a later record with its guard.
- **A registered issuer trusted service-wide, or reserved to the first tenant that registers it**: the first lets one tenant sign for another's repositories; the second lets a stranger reserve an instance's name and tells who registered it.
- **Present the GitLab component as the equivalent of `send.yml`**: no claim says a component ran, and a job of the same name overrides it.
- **Azure DevOps' raw pipeline token**: a fixed audience shared with other relying parties, subjects made of names that can be renamed.
- **An API token per repository**: discarded by ADR-0003, still discarded.
- **Wait for a forge that signs what GitHub signs**: the level, said on screen, is the honest form of the difference.

## Consequences

- **Positive**: GitLab and Azure DevOps repositories enter with no customer secret held by the service; the difference between forges is a sentence on the application's screen instead of a silence; a self-managed instance needs no inbound access; no new production dependency.
- **Negative, accepted**: "an agent of the repository cannot supply the file" holds at P1 and P2 only, and the app says so at P3 and P4; three outside hosts instead of one; a registered instance is as trustworthy as its administrators, for its own tenant; a tenant-bound audience makes the self-managed snippet differ from gitlab.com's; one Azure DevOps identity per repository is more work for the customer; key rotation on a self-managed instance is a human gesture, and an expired key stops uploads until it is made.
- **On other boundaries**: `runward/contracts/api-contract.json` grows by addition; the threat model gains the registered issuer, the confused issuer and the shared counter; `runward/governance/observability-schema.md` gains the level and the issuer in the upload's entry; the runbook gains the key rotation; ADR-0006's isolation suite and ADR-0012's reader are named above; runward-fleet's path rule is a change in runward, then a re-pin.

## Reevaluation trigger (mandatory, dated)

Reopen on 2027-02-11, or earlier: a real token contradicts a rule of sections 3 or 5 (a GitLab version that changes `ci_config_ref_uri`'s form or `ref_protected`'s type, an Entra token without `roles` or `uti`); a first customer whose GitLab has Ultimate (P2 to build); a first self-managed customer who cannot paste a key set; a forged or crossed upload (incident); a forge that signs the definition that ran; runward-fleet gains a field for the level.

**Trigger set on**: 2026-11-11 · **Watched via**: the refusal codes of the journal by forge, the witnesses of section 6 in `runward/JOURNAL.md`, `test/unit/ingest.test.js`, `test/pg/isolation.test.js`

## References

- ADR-0001, ADR-0003, ADR-0004, ADR-0005, ADR-0006, ADR-0007, ADR-0009, ADR-0012, ADR-0021
- `src/adapters/oidc/github.js`, `src/domain/workload.js`, `src/application/ingest.js`, `src/application/repositories.js`, `src/domain/repository.js`, `src/main.js`, `db/migrations/0001_floor.sql`, `src/adapters/fleet/assembler.js`
- GitLab Docs: OpenID Connect ID tokens in CI/CD (`id_tokens`, the token's claims); CI/CD components; pipeline execution policies
- Microsoft Learn: workload identity federation for Azure DevOps service connections; the `Oidctoken - Create` REST reference; application roles for applications
- RFC 8725 (JSON Web Token best current practices), RFC 7638 (JWK thumbprint), RFC 9530 (digest fields)
