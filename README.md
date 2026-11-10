# runward hosted

The fleet view of runward, behind a sign-in, fed by each repository's CI. A repository's CI runs
runward, then sends what runward wrote through the reusable workflow `.github/workflows/send.yml`
(GitHub Actions OIDC, no secret); the service keeps every upload in a per-tenant chained journal and
serves the fleet index that `runward-fleet` builds from them. People sign in with passkeys only.

Licence: FSL-1.1-MIT (`LICENSE`). Mission and decisions: `runward/` (the framing, the architecture, the
ADRs, the runbook); the project is delivered with the runward method and its gate (`runward check --strict`).

## Run it locally

Node.js 22 (`.nvmrc`). No Docker on a workstation is needed for the unit suite.

    npm ci
    npm test                      # unit, application and HTTP tests (in memory)
    npm run lint                  # the hexagon (eslint.config.js), the security scan, the format
    RW_STORE=memory RW_ORIGIN=http://localhost:8080 RW_SEND_WORKFLOW_SHAS= npm start

The PostgreSQL suite needs a throwaway server: `PG_ADMIN_URL=postgres://postgres@<host>/postgres npm run test:pg`.
The configuration is described in `.env.example`; the service refuses to start half configured.

## Committed reports

`reports/` holds the evidence the manifest rows cite: `junit.xml` (the whole suite, unit and PostgreSQL),
`eslint.json` (the hexagon's lint), `eslint-security.sarif` and `secretlint.sarif` (the security scans,
the secrets scan with its sensitivity proved by `secretlint-control.json`). CI regenerates them and fails
when the committed ones no longer describe the tree (`npm run test:reports`); `npm run test:reports:write`
rewrites them, in the reference environment (Linux, Node.js 22, PostgreSQL).

## Layout

    src/domain        pure rules (imports only the domain and node:crypto)
    src/ports         the ports' shared types
    src/application   the use cases, from the ports
    src/adapters      PostgreSQL, S3, the OIDC verifier, WebAuthn, runward-fleet, the system
    src/http          the HTTP entry (node:http, a table router)
    src/main.js       the composition root; src/operator.js the operator's gestures and daily jobs
    db/               roles, grants, expansion-only migrations, the schema snapshot
    web/              the interface (no framework)
    infra/            Scaleway (OpenTofu) and a qualified-target description (Kubernetes)
