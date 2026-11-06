# Evaluation Rubric: runward hosted

**Date**: 2026-11-06

## 1. Capabilities evaluated

The service has no model: nothing here is judged by a model. The capabilities are deterministic and evaluated by tests (listed per file below) and by the six measures of the framing note.

| Capability | What it verifies |
|---|---|
| Upload and order | a pinned upload is accepted, an old run stays history, each refusal has its code (`test/unit/ingest.test.js`) |
| Identity | links in seven states, single-use challenges, sessions, gestures, recovery (`test/unit/identity.test.js`) |
| Declarations and content | consent, erasure, quarantine, export and replay (`test/unit/repositories.test.js`, `test/pg/isolation.test.js`) |
| HTTP | hosts, origin, cookie, headers, assets (`test/unit/http.test.js`) |
| Isolation | 0 row across two real tenants, catalog, planted controls (`test/pg/isolation.test.js`) |
| The six measures | S1 to S6 on the deployed service (framing §3) |

## 2. Scoring scale

| Answer quality | Score |
|---|---|
| Complete: the test passes, or the measure meets its threshold | 1 |
| Partial: a measure below its threshold, published as it is | 0 |
| Vague but not wrong: does not apply, a test either passes or fails | 0 |
| Wrong: a test fails, or a measure is reported without its data | 0 |

## 3. Scenarios

### Scenario S1 — capability: same index, anchored outside the service

- **Multi-turn conversation**: seven consecutive days of real uploads from at least three repositories; each client job writes the anchor (seq, head, indexSha256) in its summary, an annotation and an artifact.
- **Final question**: is every anchored indexSha256 the index served, and the index runward-fleet rebuilds from the export with the version of that entry?
- **Expected terms**: "same" for every replayable version in replay.json; the served index equal to the last replayed.
- **Forbidden terms**: a "different" replay; an index served that no export rebuilds.

## 4. Hold-out (non-gameable)

- **Composition**: the anchors live in the customers' job summaries and artifacts, outside the service; the image served is read from the hoster's API, not from `/api/version` (S5).
- **Use**: the witness reader compares them each day (`scripts/witness-reader.mjs`).
- **Limit**: the head of a private repository needs a read token the public job does not hold; such a line reads "not compared".

## 5. Judge anchoring

- **Anchoring method**: no judge; nothing to anchor.
- **Judge scope**: none; safety, security, authorization and audit stay deterministic.
- **Action boundary**: the measures produce reports; nothing acts on them without the author.

## References

framing §3; ADR-0012.
