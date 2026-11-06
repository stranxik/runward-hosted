# Port Contract: IndexAssembler

## Port: IndexAssembler

**Contract version**: v0
**Port type**: secondary (driven by the application)
**Known adapters**: `src/adapters/fleet/assembler.js` (runward-fleet 0.46.0 at da888958, pinned by ADR-0002)

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

The same inputs give the same bytes; an index never carries `machine-established` (no trust policy); every export path is `exports/<mission>/<kind>-<sha256>.json`, so the archive replays (`scripts/replay-export.mjs`).

## Errors

| Error | Type | Meaning for the consumer |
|---|---|---|
| index-build-refused | business | keep the upload in quarantine, the fleet goes on |
| index-rule-broken | business | publish nothing, journal the entry |
| a missing byte | unavailable | `service-unavailable`, retried by the send job |

## Evolution rule

- **Versioned**: the runward-fleet version and archive digest are recorded on each published index (`fleet_index`).
- **Additive by default**: `runward-fleet-index/0` is read tolerantly and never extended here.
- **Expand then contract**: a new runward-fleet version is pinned by a new ADR; old indexes keep their version for replay.
- **Consumer-driven verification**: `test/unit/repositories.test.js` replays every published index; `test/unit/http.test.js` checks the served `views.js` is the pinned one.
- **Provenance**: `/api/version` serves the version, commit, archive digest and views digest.

## References

ADR-0002, ADR-0004; PADR-0011.
