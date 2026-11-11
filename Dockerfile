# runward hosted: one OCI image, built by a GitHub-hosted runner from a clean checkout at the exact commit
# (PADR-0015 point 2). Base pinned by digest (node:22-alpine, read 2026-11-06); never built on a workstation.
# Non-root, read-only file system at run time (the hoster mounts nothing writable), no shell entry point.
FROM node@sha256:0e1754758c2df4cfa3e68d59e2e1b7374bb7fd9ea6328eaaacf15cc934af8202 AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY vendor ./vendor
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

FROM node@sha256:0e1754758c2df4cfa3e68d59e2e1b7374bb7fd9ea6328eaaacf15cc934af8202
ARG RW_COMMIT=unknown
ENV NODE_ENV=production RW_COMMIT=${RW_COMMIT} PORT=8080
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY web ./web
COPY db ./db
COPY scripts/migrate.mjs scripts/roles.mjs scripts/grants.mjs scripts/isolation-deployed.mjs ./scripts/
COPY vendor/runward-fleet.lock.json ./vendor/runward-fleet.lock.json
USER node
EXPOSE 8080
# the service; the operator's gateway (ADR-0016) runs the same image with: node src/operator-gateway.js,
# which runs scripts/roles.mjs, scripts/migrate.mjs, scripts/grants.mjs, scripts/isolation-deployed.mjs and src/operator.js
ENTRYPOINT ["node"]
CMD ["src/main.js"]
