# ADR-0030: Azure DevOps sends by an Entra access token for runward's application: a direction, its rules fixed after a real token is read

**Date**: 2026-11-11
**Status**: accepted 2026-11-11 by the author in chat ("j'accepte ADR-0029 et ADR-0030") **as a direction, not rules**: nothing of this record is to be implemented as a rule before a real Entra token has been read; the rules are then written in a record that refines this one. Written by an agent session.
**Depends on**: ADR-0029 (proposed), whose port, issuer keys, levels and confirmation this record uses
**Deciders**: Thibault Souris (author). Written by an agent session.
**Method**: decision-loop, stopped at its first step for want of a witness: the forge's documentation was read, no token was; the adversarial review of ADR-0029 (`runward/governance/reviews/2026-11-11_adr-review_49bf59d.md`) asked that this part be split out

## Context

The author decided on 2026-11-11 that the hosted service receives from Azure DevOps Services. Azure DevOps offers a pipeline two tokens. The pipeline's raw OIDC token has a fixed audience, `api://AzureADTokenExchange`, shared with every other relying party, and subjects made of names that can be renamed. An Entra access token, obtained through a service connection with workload identity federation, can be asked for an audience that is runward's own application. Neither names the pipeline definition that ran, nor signs a repository, a branch or a commit. No token of either kind was read for this record; the GitLab part of the plan was written from four real tokens, this one from documentation alone.

## Decision

**The direction is the Entra access token ("route A"): the customer's pipeline asks Entra for an access token for runward's ingestion application, and the service verifies it with Entra's public keys.** The pipeline's raw OIDC token is discarded.

What the direction expects, to be confirmed or corrected by the witness:

- The customer, once: an Entra administrator creates, in the customer's directory, the service principal of runward's ingestion application (a multi-tenant application the author registers, with one application role); a service connection with workload identity federation exists in the Azure DevOps project; the role is assigned to that connection's identity; the connection is restricted in Azure DevOps (pipeline permissions, the branch control check, the required template check); the repository is declared in runward with the directory's id and the identity's object id; the pipeline extends the product's template, whose send job asks for the token.
- The service would pin the directory (`tid`) and the identity (`oid`), require the application role, require a token issued to an application alone (`idtyp` `app`, or `oid` equal to `sub`, and no `scp`), and use the token once.
- The token's version is set, not discovered: version 2, fixed by the author in the manifest of runward's Entra application (`accessTokenAcceptedVersion` 2).
- **The level is below every level of ADR-0029, with a sentence of its own.** ADR-0029's P4 says a registered key signed the project, the branch, its protection, the definition and the commit; here none of that is signed. The screen would say: "The holder of an identity this fleet pinned in the directory it declared sent the file." and, of what is not proven: "Which repository, pipeline, branch and commit it comes from, and its place among the uploads: all of that is what the sender says." Its code is P5. Pipeline, repository, branch and commit would be sent beside the token, kept and shown as declared, never as signed. The connection's restrictions are the customer's, invisible to the service; they are said as declared and raise nothing.
- Entra's key host would join the egress list. ADR-0029's registration guard already refuses Entra's hosts (`login.microsoftonline.com`, `sts.windows.net`) as a registered issuer.

**Open points, each settled before any rule is written, on a real token where it is a fact and by a decision where it is a choice:**

1. **The order of resolution is circular as written, and ADR-0029's section 1 has no place for it.** That section admits a public issuer or an audience that names a registration; Entra's issuer is neither: it carries the customer's directory, which is known only from a pin found after `tid` and `oid` are read. The way out to confirm: `iss` is matched to the one exact template filled with the token's own `tid`, the signature is checked with Entra's keys, the repository is then resolved by `(tid, oid)`, and `iss` is compared again with the pinned directory. ADR-0029 is refined to admit it.
2. **Who holds the identity.** As written, the first tenant that declares a `(tid, oid)` takes it. Both values can be read by any member of the customer's directory. A third party who declares them first blocks the customer and receives its first pending send, bytes included (`src/application/ingest.js`, the pending branch). To decide: what proves that the declaring tenant holds the identity (a value the tenant is given and the token must carry, as ADR-0029's audience names a registration), and what the confirmation shows and binds (`tid`, `oid`).
3. **The order of uploads has no signed source.** A build's number sent in a header lets the sender choose to be the current upload. The direction: order by `iat`, then by the time of reception, and say on screen that the order is not signed.
4. The token's `ver` claim (expected `2.0`, as the manifest sets, per Microsoft's documentation), and the exact form of `iss` and `aud` under it; whether the application's identifier URI can be the one the snippet names.
5. Whether `roles` is present for a federated identity and for a managed identity, and how the role is assigned to each (the portal does not offer it for a managed identity).
6. Whether `uti` is present and unique per token; the token's lifetime; whether the CLI hands the same cached token to two calls of one job. **If it does, ADR-0029's two rules do not hold here**: a token is older than 10 minutes when a later step sends it, and a token used once cannot carry a second file; and loosening the single use to one per mission and kind would let a captured token send for any other mission or kind. The replacement must be written before the adapter.
7. Whether one identity may send for one repository only, or for several named beside the token; what each choice lets a pipeline that may use the connection do.
8. Whether the service connection needs an Azure subscription; whether the send job can ask for the token without one.
9. The address of the key set, and whether it carries the directory's id.
10. Whether anything signed tells a hosted agent from a self-hosted one.
11. How a repository is named in the index when its project's name has characters runward-fleet refuses.
12. Azure DevOps Server (on premises): nothing is known of its issuer; out of this record.

## Alternatives discarded

- **The pipeline's raw OIDC token**: its audience is fixed and shared, so a token meant for another relying party would be accepted here, and ours there.
- **Write the rules now, from the documentation**: ADR-0029's review found that rules written before a token is read overstate what is proven.
- **Read the build's metadata with an application added to the customer's organisation**: an outbound call and a credential of runward's to hold; a later record, if the level must rise.

## Consequences

- **Positive**: the direction is recorded with its unknowns, and no rule is built on an unread token.
- **Negative, accepted**: Azure DevOps is not built by this record; the public site says nothing of Azure DevOps until a witness exists; the level shown will be the lowest of the service; the customer's set-up has six steps, some of them an Entra administrator's.
- **On other boundaries**: none until the refining record.

## Reevaluation trigger (mandatory, dated)

Reopen as soon as a real Entra access token for runward's application has been read (the author's gestures: the application's registration, a directory, an Azure DevOps organisation and a pipeline), and on 2026-12-11 at the latest: if no token was read by then, the record says so and the site keeps its silence.

**Trigger set on**: 2026-11-11 · **Watched via**: `runward/JOURNAL.md` (the witness's entry)

## References

- ADR-0029, ADR-0001, ADR-0003
- Microsoft Learn: workload identity federation for Azure DevOps service connections; the `Oidctoken - Create` REST reference; application roles for applications
