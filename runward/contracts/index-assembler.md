# Port Contract: IndexAssembler

## Port: IndexAssembler

**Contract version**: v0
**Port type**: secondary (driven by the application)
**Known adapters**: `src/adapters/fleet/assembler.js` (runward-fleet 0.46.0 at main@c9a886a4, archive sha256 `9c2f6090…a6fb`; pinned by ADR-0002, re-pinned on main by ADR-0018, at main@d05b5974 by ADR-0021, at main@d0528149 by ADR-0024, then at this commit by ADR-0033, proposed)

## Business intent

Turn what the service holds for a tenant (its declared missions and their current uploads) into the fleet index that runward-fleet's view reads, with runward-fleet's own builder, so the export rebuilds the same index at home. The service never reads a field of the index; nothing is raised.

## Signature

```
assemble({ title, lang, asOf, missions, read }) -> { ok: true, bytes, sha256, manifest, manifestSha256 } | { ok: false, refusal, field }
```

Synchronous, pure (no clock, no network, no process: `read` is a map of preloaded bytes), idempotent for the same inputs.

## Input schema

| Field | Type | Required | Constraint |
|---|---|---|---|
| title | string | yes | the tenant's title |
| lang | "fr" \| "en" | yes | the tenant's setting, never the browser's |
| asOf | string | yes | a label, said declared; runward-fleet reads no clock |
| missions[].id | string | yes | `^[a-z0-9][a-z0-9-]{0,62}$`, unique in the tenant |
| missions[].repository | string | yes | `owner/repo` |
| missions[].path | string | no | relative, without `..` |
| missions[].commit | string | no | the sha claim of the upload's token |
| missions[].uploads | object kind → sha256 | yes | the current uploads only |
| missions[].received | object kind → string | no | the date the service accepted each current upload, a label to the minute in the service's time with its offset (`2026-11-11 10:42 +01:00`, the form the app shows every time in), written as the export's `at` in fleet.json: the decision reading says it as the date of the last check received (runward's `docs/spec/runward-fleet-decision.md` §8); declared, never read from a clock by runward-fleet |
| read | (sha256) → bytes \| null | yes | synchronous |

## Output schema

| Field | Type | Always present | Constraint |
|---|---|---|---|
| ok | boolean | yes | |
| bytes | bytes | when ok | `JSON.stringify(index, null, 2)` and a line feed, as `runward-fleet build` writes |
| sha256 | hex | when ok | of bytes |
| manifest | bytes | when ok | the `fleet.json` assembled, named fleet.json |
| refusal | "index-build-refused" \| "index-rule-broken" | when not ok | |
| field | string | when not ok | the first problem, at most 300 characters |

## Invariants

The same inputs give the same bytes with the same archive of runward-fleet; another archive may give other bytes, under the same version (measured for 0.46.0, ADR-0021). An index never carries `machine-established` (no trust policy), nor a `names` field or a mission `not-available` (the adapter writes neither option); an export's `at` is the date the service accepted it, so the same uploads accepted at the same minutes give the same `fleet.json`; every export path is `exports/<mission>/<kind>-<sha256>.json`, so the archive replays (`scripts/replay-export.mjs`).

## Errors

| Error | Type | Meaning for the consumer |
|---|---|---|
| index-build-refused | business | keep the upload in quarantine, the fleet goes on |
| index-rule-broken | business | publish nothing, journal the entry |
| a missing byte | unavailable | `service-unavailable`, retried by the send job |

## Evolution rule

- **Versioned**: the runward-fleet version and archive digest are recorded on each published index (`fleet_index`). The archive digest names the build; the version alone does not (ADR-0021).
- **Additive by default**: `runward-fleet-index/0` is read tolerantly and never extended here.
- **Expand then contract**: a new runward-fleet archive is pinned by a new ADR, which measures whether the bytes change; a published index is never rebuilt by a re-pin, it keeps its bytes and its archive digest for replay. An index of an earlier archive is read by the pinned views as it is (ADR-0024: measured, every view renders; its refusals are shown one by one until the next publication, which carries the grouping by text). A re-pin that leaves the bytes the same (ADR-0033: measured) changes nothing of this: the digest still names the build.
- **Consumer-driven verification**: `test/unit/repositories.test.js` replays every published index, and checks that an index another archive built is reported `other-archive`, never matched and never said different; `test/unit/pin.test.js` checks that such a label counts only when the lock and the chained journal both know it (anything else is `label-refused`, never a pass), the replay's three exits, the witness reader's rule, and that `fleetPin` refuses an install that is not the pinned archive (npm's recorded integrity, then every file against the lock's `files`); `test/unit/http.test.js` checks the served `views.js` is the pinned one, that the router answers the views' `decision` route like an unknown one, and that `/api/version` serves the sha256 of the tarball npm installed.
- **Provenance**: `/api/version` serves the version, commit, archive digest and views digest.

## References

ADR-0002, ADR-0018, ADR-0021 (proposed), ADR-0004; PADR-0011.
