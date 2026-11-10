# Port Contracts: the service's other secondary ports

Filled on 2026-11-10 (the independent review of a4ede14 found this file still the raw template). The IndexAssembler has its own contract (`index-assembler.md`); the entry's contract is the route table and the refusal codes, committed in `api-contract.json` and compared with the served one by a test (`test/unit/contract.test.js`). This file holds the five other secondary ports of the architecture note (§3), as the code implements them today, each with its two adapters where it has two.

## Port

| Port | Contract version | Port type | Known adapters |
|---|---|---|---|
| TenantStore and Ledger | v0 | secondary | `src/adapters/store/postgres.js` (production), `src/adapters/store/memory.js` (the reference adapter, ADR-0015) |
| ExportStore, SecurityLog, Archive (one object store) | v0 | secondary | `src/adapters/objects/objects.js`: `s3Objects` (aws4fetch, any S3), `memoryObjects` |
| WorkloadVerifier | v0 | secondary | `src/adapters/oidc/github.js` (GitHub Actions OIDC) |
| HumanAuthenticator | v0 | secondary | `src/adapters/webauthn/simplewebauthn.js`; a stand-in that checks the challenge in the tests (`test/helpers.js#fakeAuthn`) |
| Clock, Log | v0 | secondary | `src/adapters/system/clock.js`, `src/adapters/system/log.js` |

## Business intent

- **TenantStore and Ledger**: keep what a tenant owns (members, passkeys, sessions, links, repositories, missions, uploads, published indexes, archives) so that a read or a write under one tenant never reaches another, and append to each tenant's journal, whose entries are never changed. A few questions are asked before a tenant is known (which tenant a session, a credential, a link or a repository belongs to): they are answered by exact key only, one answer for absent and for elsewhere. "Tenant" means a fleet: the space one founder opened by a bootstrap link.
- **ExportStore, SecurityLog, Archive**: keep the bytes a CI sent, addressed by their sha256 under their tenant; keep the security log of the access gestures, written before the database commits, so a restore of the database can replay them; keep a prepared export 24 hours. The keys are computed from server values, never received.
- **WorkloadVerifier**: say whether a token is a GitHub Actions OIDC token of the pinned issuer, for this audience, now; and if it is not, name why, in one of four codes. "Workload" means a CI job, never a person.
- **HumanAuthenticator**: run the passkey ceremonies (registration, authentication) against a challenge the application stored and consumes; it never decides who may do what.
- **Clock, Log**: the service's time in UTC milliseconds, declared as the service's own; one JSON line per event, from a closed list of fields.

## Signature

```
TenantStore     tx(tenantId | null, fn(tx) -> T) -> T             one transaction under app.tenant; rolled back if fn throws
  tx (tenant)   get(table, key) | list(table, where) | insert(table, row) | update(table, key, patch) | lockTenant()
                ledgerHead() | ledgerAppend(entry) | ledgerPage({ before, limit }) | ledgerAll()
  tx (exact key, no tenant needed)
                resolveRepository({ forge, repositoryId, nameKey }) | nameTaken({ forge, nameKey }) | resolveCredential(id)
                resolveSession(tokenHash) | resolveLink(tokenHash) | putChallenge(c) | takeChallenge(id) | useJti(jti, expiresAt)
                takeRate(repositoryId, bucket, runId, limit) | countRefused(repositoryId, bucket) | maintenance() | setMaintenance(m)
                tenantIds() | operatorNote(what, detail) | dailyJobs()
                newId() | ping() | close()
ObjectStore     putBytes(tenant, sha256, bytes) | getBytes(tenant, sha256) -> bytes | null | removeBytes(tenant, sha256)
                writeSecurity(tenant, ulid, event) | securitySince(tenant, afterUlid) -> [{ id, event }]
                putArchive(tenant, id, bytes) | getArchive(tenant, id) -> bytes | null | removeArchive(tenant, id) | ping() -> boolean
WorkloadVerifier verify(token, { audience }) -> claims        throws TokenRefused(code) or KeysUnavailable
HumanAuthenticator registrationOptions({ memberId, label, exclude }) | verifyRegistration({ response, expectedChallenge }) -> credential | null
                authenticationOptions({ allow }) | verifyAuthentication({ response, expectedChallenge, credential }) -> { newCounter } | null
Clock           now() -> milliseconds (UTC)
Log             info | warn | error(event, { requestId, route, method, status, ms, refusal, tenant, detail, error })
```

All are asynchronous but the clock and the log. Idempotent: every read; `putBytes` (content-addressed); `useJti` and `takeChallenge` are single use by design; `ledgerAppend` refuses a sequence number that is not the next.

## Input schema

| Field | Type | Required | Constraint |
|---|---|---|---|
| table | name | yes | one of the closed list `src/adapters/store/tables.js#TABLES`; a column outside it is refused before any query |
| tenantId, tenant | uuid | for a tenant's data | set by the server from a resolved session, a resolved repository or an operator gesture, never read from a request |
| sha256 | 64 hex | yes (objects) | `putBytes` refuses bytes whose digest is not the one given |
| ulid | 26 Crockford | yes (security log) | ordered: `securitySince` replays in ULID order |
| token | compact JWS | yes (verifier) | RS256, a known key id; the audience is the service's origin, or its origin + `/read` for the witness reader |
| expectedChallenge | base64url | yes (authenticator) | taken from the store (single use) before the ceremony is verified |

## Output schema

| Field | Type | Always present | Constraint |
|---|---|---|---|
| a row | object | when found | the columns of its table, camelCase, never the tenant column |
| claims | object | when verified | iss pinned, a single audience equal to the one asked, exp, nbf and iat within 60 s |
| credential | object | when verified | credentialId, publicKey, counter, transports, aaguid |
| dailyJobs | { retention, verify-chains: { at, ok } } | yes | the last run of each daily job; never a tenant, an error or a head |
| a log line | JSON, one line | yes | only the fields of the schema; `detail` and `error` bounded and scrubbed |

## Invariants

- A transaction under a tenant reads and writes that tenant's rows only; with no tenant, it reads no tenant row at all (forced RLS on PostgreSQL, the same filter in memory; `test/pg/isolation.test.js`, ADR-0006).
- The journal is append only: no entry is updated or removed, by the service or by the owner's role (a trigger refuses it); each entry chains the hash of the one before (ADR-0007).
- The memory adapter answers what the PostgreSQL adapter answers, the same unique constraints included (ADR-0015; the application's paths run on both).
- An object's key is computed from validated server values: a malformed tenant, digest or ULID is refused before any call.
- The verifier never answers a refusal for a failure of its own: keys it could not read are `KeysUnavailable`, without a code (ADR-0003; review of 2026-11-10).
- Every call out of the process has a deadline and a circuit breaker (`src/adapters/system/egress.js`), the issuer's keys and the object store alike.
- The log never carries a body, a token, a name or a path.

## Errors

| Error | Type | Meaning for the consumer |
|---|---|---|
| StoreConflict(constraint) | business | a unique constraint refused the write (named as the database names it): the use case answers its own refusal (an existing repository, a token already used, a session closed) |
| any other store error | unavailable | `service-unavailable` (503); the send workflow retries; nothing half written (the transaction rolled back) |
| an object store error | unavailable | the upload or the access gesture fails closed (the security log is written before the commit); a read degrades to a named state |
| TokenRefused(token-missing, token-unreadable, token-audience, token-expired) | validation | answered as such (401); never retried |
| KeysUnavailable | unavailable | `service-unavailable` (503), retried by the send workflow; the next read of the keys is tried 5 s later |
| a ceremony that does not verify (null) | validation | `ceremony-failed` or `fresh-failed`; the challenge is already consumed |

## Evolution rule

- **Versioned**: each port is v0; a change of a signature above moves its version and this file in the same change.
- **Additive by default**: a new method or an optional field (as `dailyJobs` on 2026-11-10); the two store adapters gain it together, and the parity of ADR-0015 is kept by running the application on both.
- **Expand then contract**: a column comes by an expansion-only migration first (`scripts/migrate.mjs` refuses any contraction); the code stops using an old one before any removal, which would itself need a decision.
- **Consumer-driven verification**: the application is the one consumer; its suites run on the memory adapter (`npm test`) and on PostgreSQL (`npm run test:pg`), and the schema they build is the committed snapshot (`db/schema.snapshot.txt`).
- **Provenance**: the adapters are chosen in the composition roots only (`src/main.js#compose`, `src/operator.js`, `src/operator-gateway.js`) and named in the start line.

## References

- ADR-0001, ADR-0003, ADR-0005, ADR-0006, ADR-0007, ADR-0015; `runward/architecture.md` §3
- `src/ports/errors.js`, `src/adapters/store/tables.js`, `test/pg/isolation.test.js`, `test/unit/oidc.test.js`, `test/unit/egress.test.js`
