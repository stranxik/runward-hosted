# runward hosted

The fleet view of runward, behind a sign-in, fed by each repository's CI. A repository's CI runs
runward, then sends what runward wrote through the reusable workflow `.github/workflows/send.yml`
(GitHub Actions OIDC, no secret); the service keeps every upload in a per-tenant chained journal and
serves the fleet index that `runward-fleet` builds from them. People sign in with passkeys only.

Licence: FSL-1.1-MIT (`LICENSE`). Mission and decisions: `runward/` (the framing, the architecture, the
ADRs, the runbook); the project is delivered with the runward method and its gate (`runward check --strict`).

## Call the send workflow

A declared repository's workflow calls `send.yml` at the commit of a release (the app writes this file
for you, with the release's commit and your mission):

    name: runward
    on:
      push: { branches: [main] }
      pull_request:
    permissions: {}
    jobs:
      runward:
        permissions: { contents: read, id-token: write }
        uses: stranxik/runward-hosted/.github/workflows/send.yml@<sha of the release>
        with:
          mission: <mission>

Inputs: `mission` (required), `path` (the mission's directory, `.` by default), `send-strict` (fail the
run when the upload fails, `false` by default), `runward-version` (`0.46.0`) and `runner`.

`runner` says where the three jobs run, as a JSON string: `'"ubuntu-24.04"'` by default, or a list of
labels for a repository whose CI runs on its own runner:

        with:
          mission: <mission>
          runner: '["self-hosted","nas"]'

- The runner needs bash 4, curl, openssl, base64 and sha256sum (GNU coreutils), and must reach
  registry.npmjs.org and the service.
- It also needs Node.js 22 or later on its PATH. The check job installs its own; the send job installs
  nothing, because it runs no third-party step next to the upload's token, and uses the runner's. On a
  runner without one, the send job reports "not sent: this runner has no Node.js 22" in the run's summary:
  the run keeps runward's verdict, and fails only with `send-strict`.
- On a runner GitHub does not host, the machine is yours: whatever an earlier job of the repository left
  on it runs in the send job too. Use it only for a private repository, on a runner whose jobs start clean.
- The upload's token then says `runner_environment: self-hosted`. The service refuses that claim today
  (`runner-not-hosted`, 403; `runward/adr/ADR-0003`): with a self-hosted `runner`, the check runs and the
  run keeps runward's verdict, and the upload is reported "not accepted" in the run's summary.

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
