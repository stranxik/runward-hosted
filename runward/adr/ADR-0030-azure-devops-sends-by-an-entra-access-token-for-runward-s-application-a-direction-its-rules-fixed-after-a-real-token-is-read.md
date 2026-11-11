# ADR-0030: Azure DevOps sends by an Entra access token for runward's application: a direction, its rules fixed after a real token is read

**Date**: 2026-11-11
**Status**: proposed (written by an agent session). **A direction, not rules**: nothing of this record is to be implemented as a rule before a real Entra token has been read; the rules are then written in a record that refines this one.
**Depends on**: ADR-0029 (proposed), whose port, issuer keys, levels and confirmation this record uses
**Deciders**: Thibault Souris (author). Written by an agent session.
**Method**: decision-loop, stopped at its first step for want of a witness: the forge's documentation was read, no token was; the adversarial review of ADR-0029 (`runward/governance/reviews/2026-11-11_adr-review_49bf59d.md`) asked that this part be split out

## Context

The author decided on 2026-11-11 that the hosted service receives from Azure DevOps Services. Azure DevOps offers a pipeline two tokens. The pipeline's raw OIDC token has a fixed audience, `api://AzureADTokenExchange`, shared with every other relying party, and subjects made of names that can be renamed. An Entra access token, obtained through a service connection with workload identity federation, can be asked for an audience that is runward's own application. Neither names the pipeline definition that ran, nor signs a repository, a branch or a commit. No token of either kind was read for this record; the GitLab part of the plan was written from four real tokens, this one from documentation alone.

## Decision

**The direction is the Entra access token ("route A"): the customer's pipeline asks Entra for an access token for runward's ingestion application, and the service verifies it with Entra's public keys.** The pipeline's raw OIDC token is discarded.

What the direction expects, to be confirmed or corrected by the witness:

- The customer, once: an Entra administrator creates, in the customer's directory, the service principal of runward's ingestion application (a multi-tenant application the author registers, with one application role); a service connection with workload identity federation exists in the Azure DevOps project; the role is assigned to that connection's identity; the connection is restricted in Azure DevOps (pipeline permissions, the branch control check, the required template check); the repository is declared in runward with the directory's id and the identity's object id; the pipeline extends the product's template, whose send job asks for the token.
- The service would pin the directory (`tid`) and the identity (`oid`), require the application role, and use the token once.
- **The level is ADR-0029's P4, at best**: the holder of an identity the fleet pinned sent the file. Pipeline, repository, branch and commit would be sent beside the token, kept and shown as declared, never as signed. The connection's restrictions are the customer's, invisible to the service; they are said as declared and raise nothing.
- Entra's key host would join the egress list; a registered Entra directory would follow ADR-0029's rule for issuer keys.

**Open points, each settled on a real token before any rule is written:**

1. The token's version, and so the exact form of `iss` and `aud`; whether the application's identifier URI can be the one the snippet names.
2. Whether `roles` is present for a federated identity and for a managed identity, and how the role is assigned to each (the portal does not offer it for a managed identity).
3. Whether `uti` is present and unique per token; the token's lifetime; whether the CLI hands the same cached token to two calls of one job. ADR-0029 refuses a GitLab token more than 10 minutes old and uses its `jti` once: the same two rules must be shown to hold here, or their replacement written.
4. Whether one identity may send for one repository only, or for several named beside the token; what each choice lets a pipeline that may use the connection do.
5. Whether the service connection needs an Azure subscription; whether the send job can ask for the token without one.
6. The address of the key set, and whether it carries the directory's id.
7. Whether anything signed tells a hosted agent from a self-hosted one.
8. How a repository is named in the index when its project's name has characters runward-fleet refuses.
9. Azure DevOps Server (on premises): nothing is known of its issuer; out of this record.

## Alternatives discarded

- **The pipeline's raw OIDC token**: its audience is fixed and shared, so a token meant for another relying party would be accepted here, and ours there.
- **Write the rules now, from the documentation**: ADR-0029's review found that rules written before a token is read overstate what is proven.
- **Read the build's metadata with an application added to the customer's organisation**: an outbound call and a credential of runward's to hold; a later record, if the level must rise above P4.

## Consequences

- **Positive**: the direction is recorded with its unknowns, and no rule is built on an unread token.
- **Negative, accepted**: Azure DevOps is not built by this record; the public site says nothing of Azure DevOps until a witness exists; the customer's set-up has six steps, some of them an Entra administrator's.
- **On other boundaries**: none until the refining record.

## Reevaluation trigger (mandatory, dated)

Reopen as soon as a real Entra access token for runward's application has been read (the author's gestures: the application's registration, a directory, an Azure DevOps organisation and a pipeline), and on 2026-12-11 at the latest: if no token was read by then, the record says so and the site keeps its silence.

**Trigger set on**: 2026-11-11 · **Watched via**: `runward/JOURNAL.md` (the witness's entry)

## References

- ADR-0029, ADR-0001, ADR-0003
- Microsoft Learn: workload identity federation for Azure DevOps service connections; the `Oidctoken - Create` REST reference; application roles for applications
