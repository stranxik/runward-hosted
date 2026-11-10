// The upload of a CI (PADR-0010): one machine route, a workload identity token instead of a session.
// Rows are [method, pattern, who, handler] (who: public | session | workload | reader); src/http/server.js#routes
// puts the files of this folder in the order of the API contract.

/** POST /api/v0/exports. */
export function ingestRoutes(app) {
  return [
    ["POST", "/api/v0/exports", "workload", (q) => app.ingest.upload({ headers: q.headers, readBody: q.readRaw, requestId: q.requestId })],
  ];
}
