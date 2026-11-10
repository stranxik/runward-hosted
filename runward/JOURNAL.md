# Working journal

One entry per working session (process-adr-and-journal). Minor decisions and progress live here; a structural decision graduates to an ADR in `runward/adr/`. The commits of each day carry the detail.

## 2026-11-06 - the floor, end to end

- Done: the mission scaffolded with runward 0.46.0; the domain, the ports and the adapters; the upload path; the routes and the shell; the PostgreSQL isolation suite, the migrations and the operator gestures; the send workflow, the CI and the infrastructure description; runward-fleet re-pinned at 2ab48025; the defects the local witness found, each with its guard.
- Decided: ADR-0001 to ADR-0015 (proposed; 0002, 0014 and 0015 accepted on 2026-11-08).
- Blocked / to dig: the resources at the hoster are created by the infrastructure branch, not here.

## 2026-11-08 - the review findings, each with a test that fails if it comes back

- Done: TLS to PostgreSQL in verify-full against the instance's own certificate (an IP checked against the IP SANs), proved with a local authority and a local TLS server; the migration guard reads statements as the server does and refuses any contraction, gap or reordering; a deadline and a circuit breaker on every call out; rate limits on the public routes, per address and for the instance; the daily jobs journal their failures, isolate tenants and retry a bounded number of times; the API contract committed and compared; the lint, the security scans and the JUnit report committed and checked fresh in CI.
- Decided: ADR-0017 (no load test before the preview; the bounds are tested). The rows that concern a model (hexa-move-deterministic-out, resilience-retry-backoff, state-event-sourcing, hexa-typescript-native) are n/a: the service calls no model.
- Blocked / to dig: `scripts/roles.mjs` (infrastructure branch) must call `migrationTls` at integration, `test/unit/tls.test.js` refuses it otherwise; the number of proxies in front of the container (RW_TRUST_PROXY) is checked on the first deployment.

## 2026-11-10 - the CI test job ends, the deploy's merge is proven, runward-fleet pinned on main

- Done: the TLS test's fake server answers after the handshake (the test job hung until GitHub cancelled it at 6 h); the container deploy's environment merge proven against a stand-in of the hoster; runward-fleet re-pinned at main@5a9cdf0, the commit where PR #496 merged (same files, same tarball, same bytes; ADR-0002 updated).
- Decided: nothing structural (ADR-0002 updated in place: its own trigger fired).
- Blocked / to dig: phase 2 waits for the first image (push-image.yml runs from main only, after PR #1 merges) and the operator's token.
