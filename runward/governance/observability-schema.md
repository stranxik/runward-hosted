# Observability Schema: runward hosted

**Date**: 2026-11-06

## 1. The three levels

- **Logs**: one JSON line per event on standard output (`src/adapters/system/log.js#jsonLog`), fields from a closed list: level, at, event, requestId, route, method, status, ms, refusal, tenant (a digest), detail, error. Never a body, a token, a name or a path.
- **Events**: the tenant's journal (`rw.ledger`), append only and chained (ADR-0007); the operator's journal (`rw.operator_journal`).
- **Measures**: the six of the framing note; the request budget per screen.

## 2. Propagated request ID

Created by the server for each request (`r-` and 12 hex), returned in `Runward-Request-Id`, written in the log line and in the journal entry, shown in every error state of the screen, and written by the send job in the job summary.

## 3. Provenance

Each upload's entry keeps the verified claims of its token (repository and owner by id, calling and called workflows with their SHA, event, ref, commit, runner), the run, attempt and order epoch, and each publication the runward-fleet version and the digests of the archive, the inventory and the index.

## 4. Unfolding a consolidated memory (audit)

No memory. The audit is the journal page (`GET /api/v0/journal`) and the export's `journal.jsonl`.

## 5. Cost ceilings

Budget 20 EUR excluding tax a month, billing alert at 15 EUR (author's decision); max scale 1; the probe hourly, not every 5 minutes; 30 runs an hour per repository.

## References

ADR-0007, ADR-0010.
